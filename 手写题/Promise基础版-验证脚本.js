/**
 * 手写 Promise 基础版验证脚本（Node 真实输出）
 * 运行：node Promise基础版-验证脚本.js
 *
 * 验证 6 件事：
 *  [A] 状态机：pending → fulfilled/rejected，状态不可逆（一旦改变不再变）
 *  [B] then 微任务时序：then 回调异步执行（微任务，先于宏任务 setTimeout）
 *  [C] 链式调用：then 返回新 Promise（支持 .then().then()）
 *  [D] 值穿透：then 回调返回值会被下一个 then 收到（值传递）
 *  [E] resolve 后 then：状态已 settled 再 then → 立即（微任务）执行
 *  [F] 错误处理：reject 进入 then 的 onRejected（或不传 onRejected 时透传）
 */
'use strict';

/* ========== 手写 Promise 基础版 ==========
 * 核心：状态机 + 回调暂存/调度 + 链式返回新 Promise
 *  - executor 同步执行，立即调用 resolve/reject
 *  - then 回调通过 queueMicrotask 异步执行（模拟原生微任务）
 *  - then 返回新 Promise，回调返回值/抛错传递给下一个 then
 */
function MyPromise(executor) {
  this.state = 'pending';        // pending / fulfilled / rejected
  this.value = undefined;        // resolve 的值 / reject 的原因
  this.handlers = [];            // 挂起的 then 回调（状态未定时暂存）

  const resolve = (v) => this._settle('fulfilled', v);
  const reject = (r) => this._settle('rejected', r);
  try { executor(resolve, reject); } catch (e) { reject(e); }   // executor 同步抛错 → reject
}

// 状态迁移（幂等：非 pending 直接忽略 → 状态不可逆）
MyPromise.prototype._settle = function (state, value) {
  if (this.state !== 'pending') return;
  this.state = state;
  this.value = value;
  this.handlers.forEach(h => this._run(h));   // 状态定了，调度挂起的回调
  this.handlers = [];
};

MyPromise.prototype._resolve = function (v) { this._settle('fulfilled', v); };
MyPromise.prototype._reject = function (r) { this._settle('rejected', r); };

// 调度一个 handler：微任务里执行对应回调，结果/错误传给下一个 promise
MyPromise.prototype._run = function (handler) {
  queueMicrotask(() => {
    const isFulfilled = this.state === 'fulfilled';
    const cb = isFulfilled ? handler.onFulfilled : handler.onRejected;
    const next = handler.promise;
    if (typeof cb !== 'function') {
      // 没传回调 → 值/原因穿透给下一个 then
      isFulfilled ? next._resolve(this.value) : next._reject(this.value);
      return;
    }
    try {
      next._resolve(cb(this.value));   // 回调返回值 → 下一个 then 的输入
    } catch (e) {
      next._reject(e);                 // 回调抛错 → 下一个 then 的 onRejected
    }
  });
};

MyPromise.prototype.then = function (onFulfilled, onRejected) {
  const next = new MyPromise(() => {});          // 链式：返回新 Promise
  const handler = { onFulfilled, onRejected, promise: next };
  if (this.state === 'pending') {
    this.handlers.push(handler);                 // 未定 → 暂存
  } else {
    this._run(handler);                          // 已定 → 直接调度
  }
  return next;
};

const log = (...a) => console.log(...a);
const ok = (n, c) => log((c ? '✅' : '❌'), n);

/* ---------- A. 状态机 ---------- */
log('=== A. 状态机：不可逆 ===');
const pA = new MyPromise((res) => res(1));
log('A1 resolve 后 state =', pA.state, '（期望 fulfilled）');
const pA2 = new MyPromise((res, rej) => { res(1); rej(2); });
log('A2 先 resolve 再 reject → state =', pA2.state, '| value =', pA2.value, '（期望 fulfilled / 1：不可逆）');
ok('A1 状态正确', pA.state === 'fulfilled');
ok('A2 状态不可逆', pA2.state === 'fulfilled' && pA2.value === 1);

/* ---------- B. 微任务时序 ---------- */
log('\n=== B. 微任务时序（先于宏任务）===');
const order = [];
new MyPromise(res => res(1)).then(v => order.push(`微任务${v}`));
setTimeout(() => order.push('宏任务'), 0);
order.push('同步');
setTimeout(() => {
  log('B1 执行顺序 =', JSON.stringify(order), '（期望 ["同步","微任务1","宏任务"]）');
  ok('B1 微任务先于宏任务', order[1] === '微任务1' && order[2] === '宏任务');
}, 10);

/* ---------- C. 链式调用 ---------- */
log('\n=== C. 链式调用（then 返回新 Promise）===');
const cRes = [];
new MyPromise(res => res(1))
  .then(v => { cRes.push(`第1个:${v}`); return v + 1; })
  .then(v => { cRes.push(`第2个:${v}`); return v + 1; })
  .then(v => { cRes.push(`第3个:${v}`); });
setTimeout(() => {
  log('C1 链式结果 =', JSON.stringify(cRes), '（期望 ["第1个:1","第2个:2","第3个:3"]）');
  ok('C1 链式传递', JSON.stringify(cRes) === '["第1个:1","第2个:2","第3个:3"]');
}, 10);

/* ---------- D. 值穿透 ---------- */
log('\n=== D. 值穿透（无回调则透传）===');
const dRes = [];
new MyPromise(res => res('值'))
  .then()                          // 没传回调
  .then(v => dRes.push(v));
setTimeout(() => {
  log('D1 穿透结果 =', JSON.stringify(dRes), '（期望 ["值"]）');
  ok('D1 值穿透', dRes[0] === '值');
}, 10);

/* ---------- E. resolve 后 then ---------- */
log('\n=== E. 已 settled 再 then（立即微任务执行）===');
const eRes = [];
const pE = new MyPromise(res => res('已解决'));
pE.then(v => eRes.push(v));        // 状态已定，then 直接调度
pE.then(v => eRes.push(v + '!'));  // 多次 then 都执行
setTimeout(() => {
  log('E1 多次 then =', JSON.stringify(eRes), '（期望 ["已解决","已解决!"]）');
  ok('E1 settled 后 then 正常', eRes.length === 2);
}, 10);

/* ---------- F. 错误处理 ---------- */
log('\n=== F. reject / 抛错 → onRejected ===');
const fRes = [];
new MyPromise((res, rej) => rej('出错了'))
  .then(v => fRes.push(v), e => fRes.push(`捕获:${e}`));
setTimeout(() => {
  log('F1 reject 进 onRejected =', JSON.stringify(fRes), '（期望 ["捕获:出错了"]）');
  ok('F1 reject 处理', fRes[0] === '捕获:出错了');
}, 10);
