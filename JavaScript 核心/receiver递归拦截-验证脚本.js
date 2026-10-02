/**
 * receiver 递归拦截验证：为什么不会死循环（Node 真实输出）
 * 运行：node receiver递归拦截-验证脚本.js
 *
 * 验证 3 件事：
 *  [A] 拦截序列：proxy.val → 只拦 val、_v 两次，然后终止（数据属性是递归终点）
 *  [B] 嵌套对象懒代理（Vue3 风格）：proxy.a.b.c → 每层各拦一次，共 3 次终止
 *  [C] 真正的死循环：getter 自引用 this.val → RangeError（那是 getter 的 bug，不是 receiver 机制）
 */
'use strict';

const log = (...a) => console.log(...a);

/* ---------- A. 拦截序列：为什么只拦 2 次就停 ---------- */
log('=== A. proxy.val 的完整拦截过程 ===');
const target = { _v: 7, get val() { return this._v; } };
let depth = 0;
const proxy = new Proxy(target, {
  get(t, k, r) {
    depth++;
    const who = r === proxy ? '代理' : '其他';
    log(`  [拦截 #${depth}] key=${String(k)}  | receiver是${who}`);
    const res = Reflect.get(t, k, r);
    log(`  [返回 #${depth}] key=${String(k)} → ${res}`);
    depth--;
    return res;
  },
});
const r1 = proxy.val;
log('A1 最终结果 =', r1, '| 最大拦截深度 =', depth === 0 ? '0（已全部返回）' : depth);
log('A2 拦截总次数 = 2（val + _v），然后终止 —— 没有死循环\n');

/* ---------- B. 嵌套对象懒代理（Vue3 风格） ---------- */
log('=== B. 嵌套对象懒代理：proxy.a.b.c ===');
function reactive(o) {
  return new Proxy(o, {
    get(t, k, r) {
      const res = Reflect.get(t, k, r);
      if (res && typeof res === 'object') {
        log(`  [拦截] key=${String(k)} → 值是对象，包一层 reactive（懒代理）`);
        return reactive(res);              // 关键：返回嵌套代理，不是原对象
      }
      log(`  [拦截] key=${String(k)} → 数据属性 ${res}，直接返回（终止）`);
      return res;
    },
  });
}
const nested = reactive({ a: { b: { c: 1 } } });
log('B1 nested.a.b.c =', nested.a.b.c);
log('B2 拦截次数 = 3（a、b、c 各一次），每层向下一层，到数据属性终止\n');

/* ---------- C. 真正的死循环：getter 自引用 ---------- */
log('=== C. 什么情况才会死循环：getter 自引用 ===');
const loopTarget = { get val() { return this.val; } };   // getter 里又读自己
const loopProxy = new Proxy(loopTarget, { get: (t, k, r) => Reflect.get(t, k, r) });
try {
  loopProxy.val;
  log('C1 没报错？（意外）');
} catch (e) {
  log('C1 loopProxy.val →', e.constructor.name, '（期望 RangeError：自引用真死循环）');
}
log('C2 死循环根源 = getter 写死自引用（this.val 又回到同一个 getter），不是 receiver 机制的问题');
log('C3 原生对象同样死循环：', (() => { try { loopTarget.val; return '没报错'; } catch (e) { return e.constructor.name; } })());
