// 附件：先存本机（离线可用），联网后传云存储拿 fileID 回填到那笔账
// 上传失败不阻塞保存，条目留在本机并在列表里显示「待传」
const store = require('./store.js');

function cloudReady() {
  try { return !!(wx && wx.cloud && typeof wx.cloud.uploadFile === 'function'); } catch (e) { return false; }
}

// 把这笔账里还没有 fileID 的附件依次传上去；返回已传成功数
function flush(costId) {
  const c = store.costs.get(costId);
  if (!c || !Array.isArray(c.attachments) || !c.attachments.length || !cloudReady()) return Promise.resolve(0);
  const pending = [];
  c.attachments.forEach((a, i) => { if (a && a.localPath && !a.fileID) pending.push({ a, i }); });
  if (!pending.length) return Promise.resolve(0);
  return pending.reduce((p, x) => p.then(done => new Promise(res => {
    wx.cloud.uploadFile({
      cloudPath: 'attach/' + costId + '/' + x.i + '_' + Date.now() + '.jpg',
      filePath: x.a.localPath,
      success: r => { store.costs.setAttachmentFile(costId, x.i, r.fileID); res(done + 1); },
      fail: () => res(done)
    });
  })), Promise.resolve(0));
}

// 附件是否已上传（列表里用来标「待传」）
function pendingCount(c) {
  return ((c && c.attachments) || []).filter(a => a && a.localPath && !a.fileID).length;
}

module.exports = { flush, pendingCount, cloudReady };
