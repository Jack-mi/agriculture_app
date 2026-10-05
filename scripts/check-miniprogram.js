#!/usr/bin/env node
// 小程序静态自检（无需开发者工具）：
//   1) app.json 里每个页面的 4 个文件都在
//   2) wxml 里 bind*/catch* 绑定的事件处理函数在页面 js 里存在
//   3) 页面/组件里用到的 store / stats / C / U / pref 上的方法确实存在
// 用法：node scripts/check-miniprogram.js
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'miniprogram');
const errors = [];
const warns = [];

function read(p) { return fs.readFileSync(p, 'utf8'); }

const app = JSON.parse(read(path.join(ROOT, 'app.json')));
const pages = app.pages || [];

// 1) 文件齐不齐
pages.forEach(rel => {
  ['js', 'json', 'wxml', 'wxss'].forEach(ext => {
    const f = path.join(ROOT, rel + '.' + ext);
    if (!fs.existsSync(f)) errors.push(`缺文件：${rel}.${ext}`);
  });
});
(app.tabBar && app.tabBar.list ? app.tabBar.list : []).forEach(t => {
  if (pages.indexOf(t.pagePath) < 0) errors.push(`tabBar 指向未注册页面：${t.pagePath}`);
});

// 静态模块的方法表
const mem = {};
global.wx = { getStorageSync: k => mem[k], setStorageSync: (k, v) => { mem[k] = v; }, removeStorageSync: k => { delete mem[k]; } };
global.getApp = () => null;
function methodsOf(mod) {
  const out = new Set();
  (function walk(o, prefix, depth) {
    if (!o || typeof o !== 'object' || depth > 2) return;
    Object.keys(o).forEach(k => {
      const v = o[k];
      out.add(prefix + k);
      if (v && typeof v === 'object') walk(v, prefix + k + '.', depth + 1);
    });
  })(mod, '', 0);
  return out;
}
const MODS = {
  store: require(path.join(ROOT, 'utils/store.js')),
  stats: require(path.join(ROOT, 'utils/stats.js')),
  C: require(path.join(ROOT, 'utils/const.js')),
  U: require(path.join(ROOT, 'utils/util.js')),
  K: require(path.join(ROOT, 'utils/keypad.js')),
  pref: require(path.join(ROOT, 'utils/pref.js'))
};
const TABLES = {};
Object.keys(MODS).forEach(k => { TABLES[k] = methodsOf(MODS[k]); });

// 2)+3) 逐页检查
pages.forEach(rel => {
  const jsPath = path.join(ROOT, rel + '.js');
  const wxmlPath = path.join(ROOT, rel + '.wxml');
  if (!fs.existsSync(jsPath) || !fs.existsSync(wxmlPath)) return;
  const js = read(jsPath);
  const wxml = read(wxmlPath);
  // 去掉注释和 require('...') 里的路径，避免把注释里的 store.js 当成方法调用
  const code = js
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .replace(/require\([^)]*\)/g, 'require()');

  // 事件处理函数
  const handlers = new Set();
  const re = /\b(?:bind|catch|capture-bind|capture-catch)[:]?([a-zA-Z]+)\s*=\s*"([^"{}]+)"/g;
  let m;
  while ((m = re.exec(wxml))) handlers.add(m[2].trim());
  handlers.forEach(h => {
    const declared = new RegExp('(^|[\\s,{])' + h + '\\s*[(:=]', 'm').test(js);
    if (!declared) errors.push(`${rel}.wxml 绑定了 ${h}，但 ${rel}.js 里没有`);
  });

  // 模块方法
  Object.keys(TABLES).forEach(mod => {
    const re2 = new RegExp('\\b' + mod + '\\.([a-zA-Z_$][\\w$]*)', 'g');
    let mm;
    while ((mm = re2.exec(code))) {
      const name = mm[1];
      if (!TABLES[mod].has(name)) errors.push(`${rel}.js 用了 ${mod}.${name}，但该方法不存在`);
    }
  });
});

// 组件同理（只查方法）
['components/keypad/keypad'].forEach(rel => {
  const js = read(path.join(ROOT, rel + '.js'));
  const wxml = read(path.join(ROOT, rel + '.wxml'));
  const handlers = new Set();
  const re = /\b(?:bind|catch)[:]?([a-zA-Z]+)\s*=\s*"([^"{}]+)"/g;
  let m;
  while ((m = re.exec(wxml))) handlers.add(m[2].trim());
  handlers.forEach(h => {
    const declared = new RegExp('(^|[\\s,{])' + h + '\\s*[(:=]', 'm').test(js);
    if (!declared) errors.push(`${rel}.wxml 绑定了 ${h}，但组件 js 里没有`);
  });
});

console.log(`检查 ${pages.length} 个页面 + keypad 组件`);
if (warns.length) console.log('警告：\n  ' + warns.join('\n  '));
if (errors.length) {
  console.log(`\n✖ 发现 ${errors.length} 个问题：`);
  errors.forEach(e => console.log('  - ' + e));
  process.exit(1);
}
console.log('✔ 全部通过');
