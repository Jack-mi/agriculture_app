// 参谋回复里用到的少量 Markdown → 小程序 rich-text 节点。
// 只处理加粗、高亮、行内代码和换行，其余原文照显示。
function mdNodes(text) {
  const src = String(text || '');
  if (!src) return [];
  const children = [];
  src.split('\n').forEach((line, i) => {
    if (i) children.push({ name: 'br' });
    inline(line, children);
  });
  return [{ name: 'div', children }];
}

function inline(line, out) {
  const re = /\*\*(.+?)\*\*|==(.+?)==|`([^`]+)`/g;
  let last = 0;
  let m;
  while ((m = re.exec(line))) {
    if (m.index > last) out.push({ type: 'text', text: line.slice(last, m.index) });
    if (m[1] != null) out.push(span('strong', 'font-weight:700;background-color:#FFF3C4;', m[1]));
    else if (m[2] != null) out.push(span('span', 'font-weight:700;background-color:#FFF3C4;', m[2]));
    else out.push(span('span', 'background-color:#F3F0E6;', m[3]));
    last = m.index + m[0].length;
  }
  if (last < line.length) out.push({ type: 'text', text: line.slice(last) });
  else if (!line) out.push({ type: 'text', text: '' });
}

function span(name, style, text) {
  return { name, attrs: { style }, children: [{ type: 'text', text }] };
}

module.exports = { mdNodes };
