#!/bin/bash
# 无人值守跑 wechatide 工具：自动点掉 IDE 的「MCP 客户端授权」弹窗，并等异步任务跑完。
#
# 用法:
#   scripts/wxrun.sh upload --project /Users/miller/Projects/Agriculture --upload-version 0.7.13 --desc "说明"
#   scripts/wxrun.sh simulator_refresh --project /Users/miller/Projects/Agriculture
#
# 令牌（不入库）：环境变量 WECHATIDE_TOKEN，或 ~/.wechatide-token
set -uo pipefail

CLIENT="${WECHATIDE_CLIENT:-codex}"
HERE="$(cd "$(dirname "$0")" && pwd)"

TOKEN="${WECHATIDE_TOKEN:-}"
if [ -z "$TOKEN" ] && [ -f "$HOME/.wechatide-token" ]; then
  TOKEN="$(tr -d '[:space:]' < "$HOME/.wechatide-token")"
fi
if [ -z "$TOKEN" ]; then
  echo "[wxrun] 缺少令牌：export WECHATIDE_TOKEN=... 或写入 ~/.wechatide-token" >&2
  exit 2
fi

jget() {
  python3 -c '
import sys, json
s = sys.stdin.read()
i = s.find("{")
d = json.loads(s[i:]) if i >= 0 else {}
print(eval(sys.argv[1], {"d": d}))' "$1"
}

BIN=/tmp/wx-allow-bin
if [ ! -x "$BIN" ] || [ "$HERE/wx-allow.swift" -nt "$BIN" ]; then
  swiftc -O -o "$BIN" "$HERE/wx-allow.swift" || { echo "[wxrun] 编译 wx-allow.swift 失败" >&2; exit 2; }
fi

out="$(wechatide -c "$CLIENT" "$@" --token "$TOKEN")"
printf '%s\n' "$out"

task="$(printf '%s' "$out" | jget 'd.get("result",{}).get("taskId","")')"
[ -z "$task" ] && { echo "[wxrun] 同步完成"; exit 0; }

taskType="$(printf '%s' "$out" | jget 'd.get("result",{}).get("taskType","")')"
case "$taskType" in
  confirmation_*) NEED_CONFIRM=1 ;;
  *) NEED_CONFIRM=0 ;;
esac

echo "[wxrun] 异步任务 ${task}，等执行结果…"
for _ in $(seq 1 40); do
  # 需要用户点「允许」的弹窗：直接按下去，不等人工
  if [ "$NEED_CONFIRM" = 1 ]; then
    clicker="$("$BIN" 2 2>&1)"
    case "$clicker" in *clicked*) printf '%s\n' "$clicker" | sed 's/^/[wxallow] /' ;; esac
  fi
  res="$(wechatide -c "$CLIENT" polling_task_result --task-id "$task" --token "$TOKEN")"
  status="$(printf '%s' "$res" | jget 'd.get("result",{}).get("status","")')"
  if [ "$status" != "pending" ]; then
    printf '%s\n' "$res"
    echo "[wxrun] 任务 ${task} -> ${status}"
    [ "$status" = "success" ] && exit 0 || exit 1
  fi
  sleep 1
done
echo "[wxrun] 任务超时未完成：${task}" >&2
exit 1
