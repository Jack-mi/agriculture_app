const store = require('../../utils/store.js');
const U = require('../../utils/util.js');

Page({
  data: { id: '', name: '', area: '', lat: '', lng: '', address: '', isEdit: false },

  onLoad(q) {
    if (q.id) {
      const p = store.plots.get(q.id);
      if (p) {
        this.setData({ id: p.id, name: p.name, area: String(p.area || ''), lat: p.lat, lng: p.lng, address: p.address || '', isEdit: true });
        wx.setNavigationBarTitle({ title: '编辑地块' });
      }
    }
  },

  onName(e) { this.setData({ name: e.detail.value }); },
  onArea(e) { this.setData({ area: e.detail.value }); },

  // 地图选点（需真机/开发者工具授权位置）
  pickLoc() {
    const opts = {
      success: r => this.setData({
        lat: Math.round(r.latitude * 1000) / 1000, lng: Math.round(r.longitude * 1000) / 1000,
        address: r.name || r.address || '已定位'
      }),
      fail: () => this.useCurrent()
    };
    if (this.data.lat !== '' && this.data.lat !== undefined) { opts.latitude = this.data.lat; opts.longitude = this.data.lng; }
    wx.chooseLocation(opts);
  },

  // 站在地头，用当前位置
  useCurrent() {
    wx.getLocation({
      type: 'gcj02',
      success: r => this.setData({ lat: Math.round(r.latitude * 1000) / 1000, lng: Math.round(r.longitude * 1000) / 1000, address: '当前位置' }),
      fail: () => U.toast('没拿到位置，请在设置里允许定位')
    });
  },

  save() {
    const d = this.data;
    if (!d.name.trim()) return U.toast('请填写地块名称');
    const area = parseFloat(d.area);
    if (!(area > 0)) return U.toast('请填写亩数');
    store.plots.save({ id: d.id || undefined, name: d.name.trim(), area, lat: d.lat, lng: d.lng, address: d.address });
    U.toast('已保存', 'success');
    setTimeout(() => wx.navigateBack(), 500);
  },

  del() {
    wx.showModal({
      title: '删除地块', content: '该地块下所有种植季、账目、记事都会一起删除，且不能恢复。',
      confirmText: '删除', confirmColor: '#B3372B',
      success: r => {
        if (!r.confirm) return;
        store.plots.remove(this.data.id);
        wx.navigateBack();
      }
    });
  }
});
