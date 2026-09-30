// 自绘数字键盘：4×4，右列 ⌫ / + / − / 完成(高两格)
// 事件：bind:input {expr, value}  bind:done {value}  bind:again {value}
const K = require('../../utils/keypad.js');

Component({
  properties: {
    expr: { type: String, value: '' },
    okText: { type: String, value: '完成' },
    showAgain: { type: Boolean, value: true },
    disabled: { type: Boolean, value: false }
  },
  data: { hasOp: false },
  observers: {
    expr(v) { this.setData({ hasOp: K.hasOp(v) }); }
  },
  methods: {
    vibe() { try { wx.vibrateShort({ type: 'light' }); } catch (e) {} },
    tap(e) {
      const key = e.currentTarget.dataset.k;
      this.vibe();
      const next = K.press(this.data.expr, key);
      this.triggerEvent('input', { expr: next, value: K.evalExpr(next) });
    },
    longDel() {
      this.vibe();
      this.triggerEvent('input', { expr: '', value: 0 });
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
