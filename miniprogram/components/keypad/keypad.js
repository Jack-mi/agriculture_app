// 自绘数字键盘：4×4，右列 ⌫ / + / − / 完成(高两格)
// 事件：bind:input {expr, value}  bind:done {value}  bind:again {value}
// 按键震动 / ⌫ 长按清空 等行为读本机偏好（utils/pref.js）
const K = require('../../utils/keypad.js');
const pref = require('../../utils/pref.js');

Component({
  properties: {
    expr: { type: String, value: '' },
    okText: { type: String, value: '完成' },
    tone: { type: String, value: '' },          // '' 支出（麦金） | 'in' 收入（绿）
    showAgain: { type: Boolean, value: true },
    disabled: { type: Boolean, value: false }
  },
  data: { hasOp: false, fnKey: 'again', fnText: '再记', p: {} },
  lifetimes: {
    attached() { const p = pref.all(); this.setData({ p, fnKey: p.fnKey, fnText: fnLabel(p.fnKey) }); }
  },
  observers: {
    expr(v) { this.setData({ hasOp: K.hasOp(v) }); }
  },
  methods: {
    vibe() { if (this.data.p && this.data.p.vibrate === false) return; try { wx.vibrateShort({ type: 'light' }); } catch (e) {} },
    tap(e) {
      const key = e.currentTarget.dataset.k;
      this.vibe();
      const next = K.press(this.data.expr, key);
      this.triggerEvent('input', { expr: next, value: K.evalExpr(next) });
    },
    longDel() {
      if (!this.data.p || this.data.p.longClear === false) return;
      this.vibe();
      this.triggerEvent('input', { expr: '', value: 0 });
    },
    fn() {
      const k = this.data.fnKey;
      if (k === 'again') return this.again();
      if (k === 'clear') return this.longDel();
      this.triggerEvent('fn', { key: k });
    },
    ok() {
      if (this.data.disabled) return;
      this.vibe();
      // 有运算式：先求值
      if (this.data.hasOp) {
        const v = K.evalExpr(this.data.expr);
        this.triggerEvent('input', { expr: K.fromNumber(v), value: v, evaluated: true, from: this.data.expr });
        return;
      }
      this.triggerEvent('done', { value: K.evalExpr(this.data.expr) });
    },
    again() {
      if (this.data.disabled) return;
      this.vibe();
      this.triggerEvent('again', { value: K.evalExpr(this.data.expr) });
    }
  }
});

function fnLabel(k) {
  return { again: '再记', clear: '清空', today: '今天', tpl: '常用账', attach: '附件' }[k] || '再记';
}
