// 类型管理：支出细分类型（5 大类下自定义）+ 收入类型 + 记事类型（名称/颜色/默认记账类别）+ 常用账
const store = require('../../utils/store.js');
const C = require('../../utils/const.js');
const U = require('../../utils/util.js');
const stats = require('../../utils/stats.js');

// 模板里单价输入框的单位提示
function priceLabel(mode) {
  return mode === 'perMu' ? '元/亩' : mode === 'perJin' ? '元/斤' : mode === 'perMuPrice' ? '元/亩' : mode === 'perDay' ? '元/人·天' : '元';
}

Page({
  data: {
    tab: 'cost', cats: C.COST_CATS, incomeCats: C.INCOME_CATS, cat: 'agri', costList: [], logList: [], incomeList: [],
    colors: C.TAG_COLORS, logFields: C.LOG_FIELDS, matTypes: C.MATERIAL_TYPES, edit: null, costCatOpts: [], tplList: [], tpl: null, modes: C.CALC_MODES, tplModes: C.INCOME_CALC_MODES.concat(C.CALC_MODES), tplSplits: [{ key: 'current', name: '只记当前季' }, { key: 'area', name: '按亩均摊' }, { key: 'even', name: '平均分' }], logStock: true
  },

  onLoad(q) {
    this.setData({ tab: q.tab || 'cost', cat: q.cat || 'agri' });
  },
  onShow() { this.render(); },

  render() {
    const d = store.db();
    const cat = this.data.cat;
    const costList = store.tags.cost(cat).map(n => ({ name: n, count: d.costs.filter(c => c.cat === cat && c.sub === n).length }));
    const logList = store.tags.log().map(t => ({
      name: t.name, color: t.color, count: d.logs.filter(l => (l.ops || []).indexOf(t.name) >= 0).length,
      costText: t.costCat ? C.catOf(t.costCat).name + (t.costSub ? ' · ' + t.costSub : '') : '不关联',
      fieldText: (t.fields || []).map(k => (C.LOG_FIELDS.find(f => f.key === k) || {}).name).filter(Boolean).join('、') || '只填具体情况'
    }));
    const tplList = store.tags.templates().map(t => ({ id: t.id, name: t.name, icon: C.iconOf(t.sub, t.cat), color: C.catOf(t.cat).color, catName: C.catOf(t.cat).name, sub: t.sub, desc: stats.tplDesc(t) }));
    const incomeList = store.tags.income().map(n => ({
      name: n, key: C.incomeKeyOf(n),
      count: d.costs.filter(c => !c.deletedAt && c.dir === 'in' && c.sub === n).length,
      modeText: ((C.INCOME_CATS.find(x => x.key === C.incomeKeyOf(n)) || {}).mode === 'perJin' ? '默认按斤×价' : '默认直接填')
    }));
    this.setData({ costList, logList, tplList, incomeList, logStock: store.tags.logStock() });
  },

  setTab(e) { this.setData({ tab: e.currentTarget.dataset.t }); },
  pickCat(e) { this.setData({ cat: e.currentTarget.dataset.k }); this.render(); },
  toggleLogStock() { store.tags.setLogStock(!this.data.logStock); this.render(); U.toast(this.data.logStock ? '已开：填农资用量会自动扣库存' : '已关：只记录不扣库存'); },

  // ---- 收入类型 ----
  addIncome() {
    wx.showModal({
      title: '新增收入类型', editable: true, placeholderText: '如：青贮、农机服务',
      success: r => {
        if (!r.confirm) return;
        if (!store.tags.addIncome(r.content)) return U.toast('名称为空或已存在');
        this.render();
      }
    });
  },
  incomeAction(e) {
    const name = e.currentTarget.dataset.n;
    wx.showActionSheet({
      itemList: ['改名', '删除'],
      success: r => {
        if (r.tapIndex === 0) {
          wx.showModal({
            title: '改名', editable: true, content: name,
            success: m => {
              if (!m.confirm) return;
              if (!store.tags.renameIncome(name, m.content)) return U.toast('改名失败：重名或为空');
              this.render(); U.toast('改好了，历史流水也一起改了');
            }
          });
        } else {
          const used = this.data.incomeList.find(x => x.name === name);
          wx.showModal({
            title: '删除收入类型', content: used && used.count ? '有 ' + used.count + ' 笔账用了它，删掉类型不影响那些账，只是以后不再出现。' : '',
            confirmText: '删掉', confirmColor: '#B3372B',
            success: m => { if (m.confirm) { store.tags.removeIncome(name); this.render(); } }
          });
        }
      }
    });
  },

  // ---- 记账细分类型 ----
  addCost() {
    wx.showModal({
      title: '新增「' + C.catOf(this.data.cat).name + '」类型', editable: true, placeholderText: '输入类型名称',
      success: r => {
        if (!r.confirm) return;
        if (!store.tags.addCost(this.data.cat, r.content)) return U.toast('名称为空或已存在');
        this.render();
      }
    });
  },
  costAction(e) {
    const name = e.currentTarget.dataset.n;
    const cat = this.data.cat;
    wx.showActionSheet({
      itemList: ['改名', '上移', '下移', '删除'],
      success: r => {
        if (r.tapIndex === 0) {
          wx.showModal({
            title: '改名', editable: true, content: name,
            success: m => {
              if (!m.confirm || m.content.trim() === name) return;
              if (!store.tags.renameCost(cat, name, m.content)) return U.toast('名称为空或已存在');
              U.toast('已改名，历史账目同步更新'); this.render();
            }
          });
        } else if (r.tapIndex === 1 || r.tapIndex === 2) {
          store.tags.move('cost', cat, name, r.tapIndex === 1 ? -1 : 1); this.render();
        } else if (r.tapIndex === 3) {
          wx.showModal({
            title: '删除「' + name + '」', content: '已记的账目保留原类型名，只是以后不再出现在选项里。',
            confirmText: '删除', confirmColor: '#B3372B',
            success: m => { if (m.confirm) { store.tags.removeCost(cat, name); this.render(); } }
          });
        }
      }
    });
  },

  // ---- 记事类型 ----
  addLog() { this.openEdit({ isNew: true, name: '', color: C.TAG_COLORS[store.tags.log().length % C.TAG_COLORS.length], costCat: '', costSub: '', fields: [], matType: '' }); },
  editLog(e) {
    const t = store.tags.logTag(e.currentTarget.dataset.n);
    this.openEdit({ isNew: false, from: t.name, name: t.name, color: t.color, costCat: t.costCat || '', costSub: t.costSub || '', fields: (t.fields || []).slice(), matType: t.matType || '' });
  },
  openEdit(ed) {
    ed.subs = ed.costCat ? store.tags.cost(ed.costCat) : [];
    ed.fmap = {}; (ed.fields || []).forEach(f => { ed.fmap[f] = true; });
    this.setData({ edit: ed });
  },
  onEName(e) { this.setData({ 'edit.name': e.detail.value }); },
  pickColor(e) { this.setData({ 'edit.color': e.currentTarget.dataset.c }); },
  pickCostCat(e) {
    const k = e.currentTarget.dataset.k;
    const costCat = this.data.edit.costCat === k ? '' : k;
    this.setData({ 'edit.costCat': costCat, 'edit.costSub': '', 'edit.subs': costCat ? store.tags.cost(costCat) : [] });
  },
  pickCostSub(e) {
    const s = e.currentTarget.dataset.s;
    this.setData({ 'edit.costSub': this.data.edit.costSub === s ? '' : s });
  },
  toggleField(e) {
    const k = e.currentTarget.dataset.k;
    const fmap = Object.assign({}, this.data.edit.fmap); fmap[k] = !fmap[k];
    this.setData({ 'edit.fmap': fmap, 'edit.fields': C.LOG_FIELDS.map(f => f.key).filter(x => fmap[x]) });
  },
  pickMatType(e) { const v = e.currentTarget.dataset.v; this.setData({ 'edit.matType': this.data.edit.matType === v ? '' : v }); },
  closeEdit() { this.setData({ edit: null }); },
  noop() {},
  saveEdit() {
    const ed = this.data.edit;
    const patch = { name: ed.name, color: ed.color, costCat: ed.costCat, costSub: ed.costSub, fields: ed.fields || [], matType: (ed.fields || []).indexOf('mat') >= 0 ? ed.matType : '' };
    const ok = ed.isNew ? store.tags.addLog(patch) : store.tags.updateLog(ed.from, patch);
    if (!ok) return U.toast('名称为空或已存在');
    this.setData({ edit: null }); this.render();
    U.toast(!ed.isNew && ed.from !== ed.name.trim() ? '已改名，历史记事同步更新' : '已保存');
  },
  moveLog(e) { store.tags.move('log', '', this.data.edit.from, +e.currentTarget.dataset.d); this.render(); },
  delLog() {
    const name = this.data.edit.from;
    wx.showModal({
      title: '删除「' + name + '」', content: '已记的记事保留原类型名，只是以后不再出现在选项里。',
      confirmText: '删除', confirmColor: '#B3372B',
      success: m => { if (m.confirm) { store.tags.removeLog(name); this.setData({ edit: null }); this.render(); } }
    });
  },

  // ---- 常用账 ----
  addTpl() { this.openTpl({ dir: 'out', name: '', cat: 'mach', sub: store.tags.cost('mach')[0] || '', mode: 'perMu', unitPrice: '', amount: '', people: '', split: 'current', note: '' }); },
  editTpl(e) { const t = store.tags.template(e.currentTarget.dataset.id); if (t) this.openTpl(Object.assign({}, t, { unitPrice: t.unitPrice ? String(t.unitPrice) : '', amount: t.amount ? String(t.amount) : '', people: t.people ? String(t.people) : '' })); },
  openTpl(t) {
    if (!t.dir) t.dir = 'out';
    t.subs = t.dir === 'in' ? store.tags.income() : store.tags.cost(t.cat);
    t.modeList = t.dir === 'in' ? C.INCOME_CALC_MODES : C.CALC_MODES;
    t.priceLabel = priceLabel(t.mode);
    this.setData({ tpl: t });
  },
  pickTplDir(e) {
    const dir = e.currentTarget.dataset.k;
    const cat = dir === 'in' ? 'grain' : 'mach';
    const subs = dir === 'in' ? store.tags.income() : store.tags.cost(cat);
    this.setData({
      'tpl.dir': dir, 'tpl.cat': cat, 'tpl.subs': subs, 'tpl.sub': subs[0] || '',
      'tpl.mode': dir === 'in' ? 'fixed' : 'perMu', 'tpl.people': '',
      'tpl.modeList': dir === 'in' ? C.INCOME_CALC_MODES : C.CALC_MODES, 'tpl.priceLabel': dir === 'in' ? '元' : '元/亩'
    });
  },
  onTplName(e) { this.setData({ 'tpl.name': e.detail.value }); },
  onTplNum(e) { this.setData({ ['tpl.' + e.currentTarget.dataset.k]: e.detail.value }); },
  onTplNote(e) { this.setData({ 'tpl.note': e.detail.value }); },
  pickTplCat(e) {
    if (this.data.tpl.dir === 'in') {
      const name = e.currentTarget.dataset.n;
      const key = C.incomeKeyOf(name);
      const mode = (C.INCOME_CATS.find(x => x.key === key) || {}).mode || 'fixed';
      return this.setData({ 'tpl.cat': key, 'tpl.sub': name, 'tpl.mode': mode, 'tpl.priceLabel': priceLabel(mode) });
    }
    const cat = e.currentTarget.dataset.k; const subs = store.tags.cost(cat);
    this.setData({ 'tpl.cat': cat, 'tpl.subs': subs, 'tpl.sub': subs[0] || '', 'tpl.mode': cat === 'labor' ? 'perDay' : this.data.tpl.mode });
  },
  pickTplSub(e) {
    const s = e.currentTarget.dataset.s;
    if (this.data.tpl.dir === 'in') return this.setData({ 'tpl.sub': s, 'tpl.cat': C.incomeKeyOf(s) });
    this.setData({ 'tpl.sub': s });
  },
  pickTplMode(e) { const m = e.currentTarget.dataset.m; this.setData({ 'tpl.mode': m, 'tpl.priceLabel': priceLabel(m) }); },
  pickTplSplit(e) { this.setData({ 'tpl.split': e.currentTarget.dataset.k }); },
  closeTpl() { this.setData({ tpl: null }); },
  saveTpl() {
    const t = this.data.tpl;
    if (t.mode === 'fixed' ? !(parseFloat(t.amount) > 0) : !(parseFloat(t.unitPrice) > 0)) return U.toast(t.mode === 'fixed' ? '请填写金额' : '请填写单价');
    const rec = store.tags.saveTemplate(t);
    if (!rec) return U.toast('请填写名称');
    this.setData({ tpl: null }); this.render(); U.toast('已保存');
  },
  moveTpl(e) { store.tags.moveTemplate(this.data.tpl.id, +e.currentTarget.dataset.d); this.render(); },
  delTpl() {
    const id = this.data.tpl.id;
    wx.showModal({ title: '删除常用账', content: '已记的账不受影响。', confirmText: '删除', confirmColor: '#B3372B',
      success: m => { if (m.confirm) { store.tags.removeTemplate(id); this.setData({ tpl: null }); this.render(); } } });
  },

  reset() {
    wx.showModal({
      title: '恢复默认类型', content: '自定义的类型会被清除（已记的账目、记事不受影响）。',
      success: m => { if (m.confirm) { store.tags.resetDefault(); this.render(); U.toast('已恢复'); } }
    });
  }
});
