// 回收站：软删的账目/记事，30 天内可恢复
const store = require('../../utils/store.js');
const U = require('../../utils/util.js');

Page({
  data: { rows: [], count: 0 },
  onShow() { this.render(); },
  render() {
    const rows = store.trash.all().map(r => Object.assign({}, r, { dateText: U.cnDate(r.dateText || '') }));
    this.setData({ rows, count: rows.length });
  },
  restore(e) {
    const d = e.currentTarget.dataset;
    store.trash.restore(d.col, d.id);
    U.toast('已恢复', 'success');
    this.render();
  },
  purge(e) {
    const d = e.currentTarget.dataset;
    wx.showModal({
      title: '彻底删除', content: '这条会从本机和云端一起删掉，删了就找不回来了。',
      confirmText: '彻底删除', confirmColor: '#B3372B',
      success: r => { if (r.confirm) { store.trash.purge(d.col, d.id); U.toast('已删除'); this.render(); } }
    });
  },
  empty() {
    if (!this.data.count) return U.toast('回收站是空的');
    wx.showModal({
      title: '清空回收站', content: '这 ' + this.data.count + ' 条会全部彻底删除，找不回来。',
      confirmText: '清空', confirmColor: '#B3372B',
      success: r => { if (r.confirm) { store.trash.empty(); U.toast('已清空'); this.render(); } }
    });
  }
});
