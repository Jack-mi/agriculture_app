#!/bin/bash
# 部署云函数后必跑：把 SCF timeout 改回正确值。
# 背景：CLI/IDE 部署不会应用 config.json 里的 timeout（微信云开发已知行为），
# 每次重新部署 advisorAgent/advisorChat 后 timeout 会回退默认 3s，agent 多轮调用直接被掐。
# 链路：.env(AppID/AppSecret) → stable_token → tcb/getqcloudtoken 换腾讯云凭证
#       → TC3-HMAC-SHA256 签名直调 SCF UpdateFunctionConfiguration。
# 用法：scripts/fix-fn-timeout.sh
set -euo pipefail
cd "$(dirname "$0")/.."

ENV_ID="cloud1-d5gzevmwkdff99eb5"
REGION="ap-shanghai"

eval "$(grep -v '^#' .env | sed 's/^/export /')"

AT=$(curl -s -X POST 'https://api.weixin.qq.com/cgi-bin/stable_token' \
  -H 'content-type: application/json' \
  -d "{\"grant_type\":\"client_credential\",\"appid\":\"$AppID\",\"secret\":\"$AppSecret\"}" \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['access_token'])")

curl -s -X POST "https://api.weixin.qq.com/tcb/getqcloudtoken?access_token=$AT" \
  -H 'content-type: application/json' -d "{\"lifespan\":7200}" > /tmp/guyuji_qcloud_token.json
python3 - <<'EOF'
import json
d = json.load(open('/tmp/guyuji_qcloud_token.json'))
assert d.get('errcode') == 0, d
print('[fix-fn-timeout] qcloud token OK, expired_time:', d['expired_time'])
EOF

python3 - "$ENV_ID" "$REGION" <<'EOF'
import sys, json, hmac, hashlib, datetime, urllib.request

env_id, region = sys.argv[1], sys.argv[2]
cred = json.load(open('/tmp/guyuji_qcloud_token.json'))
secret_id, secret_key, token = cred['secretid'], cred['secretkey'], cred['token']

def tc3(action, params):
    service, version, host = 'scf', '2018-04-16', 'scf.tencentcloudapi.com'
    payload = json.dumps(params)
    ts = int(datetime.datetime.now().timestamp())
    date = datetime.datetime.utcfromtimestamp(ts).strftime('%Y-%m-%d')
    headers = {'content-type': 'application/json', 'host': host}
    signed_headers = 'content-type;host'
    canonical_headers = ''.join(f'{k}:{headers[k]}\n' for k in sorted(headers))
    hr = f"POST\n/\n\n{canonical_headers}\n{signed_headers}\n{hashlib.sha256(payload.encode()).hexdigest()}"
    scope = f'{date}/{service}/tc3_request'
    sts = f'TC3-HMAC-SHA256\n{ts}\n{scope}\n{hashlib.sha256(hr.encode()).hexdigest()}'
    def sign(key, msg): return hmac.new(key, msg.encode(), hashlib.sha256).digest()
    sk = sign(sign(sign(('TC3' + secret_key).encode(), date), service), 'tc3_request')
    sig = hmac.new(sk, sts.encode(), hashlib.sha256).hexdigest()
    auth = (f'TC3-HMAC-SHA256 Credential={secret_id}/{scope}, '
            f'SignedHeaders={signed_headers}, Signature={sig}')
    req = urllib.request.Request('https://' + host, data=payload.encode(), method='POST', headers={
        'Authorization': auth, 'Content-Type': 'application/json',
        'X-TC-Action': action, 'X-TC-Version': version, 'X-TC-Timestamp': str(ts),
        'X-TC-Region': region, 'X-TC-Token': token})
    return json.load(urllib.request.urlopen(req))

for fn, timeout in [('advisorAgent', 60), ('advisorChat', 30)]:
    r = tc3('UpdateFunctionConfiguration',
            {'FunctionName': fn, 'Namespace': env_id, 'Timeout': timeout})
    err = r.get('Response', {}).get('Error')
    print(f'[fix-fn-timeout] {fn} -> {timeout}s:', 'FAIL ' + str(err) if err else 'OK')
    if err: sys.exit(1)
EOF
