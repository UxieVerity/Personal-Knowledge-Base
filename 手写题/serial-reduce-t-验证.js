/**
 * 串行 reduce 里 t() 为什么有 then —— 验证脚本
 * 运行：node serial-reduce-t-验证.js
 *
 * 验证 3 件事：
 *  [A] list 里的 t 是「函数」不是 Promise：typeof t === 'function'，t() 才是 Promise
 *  [B] t() 返回的确实是 Promise（有 .then）
 *  [C] 为什么不能直接 chain.then(t)：拿不到累积结果（对比两种写法）
 */
'use strict';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log(...a);

// 任务数组：每个元素是「返回 Promise 的函数」
const tasks = [1, 2, 3].map((id) => () => sleep(10).then(() => `任务${id}完成`));

/* ---------- A. t 是函数，t() 才是 Promise ---------- */
log('=== A. t 是函数，不是 Promise ===');
const t = tasks[0];
log('A1 typeof t =', typeof t, '（期望 function：t 是任务函数）');
log('A2 typeof t() =', typeof t(), '（期望 object：t() 调用后才返回 Promise）');
log('A3 t() instanceof Promise =', t() instanceof Promise, '（期望 true）');
log('A4 结论：t 是"函数"，t() 是"调用函数得到的 Promise"——所以 t() 才有 .then');

/* ---------- B. t() 确实有 then ---------- */
log('\n=== B. t() 返回 Promise，能 .then ===');
t().then(v => log('B1 t() 的 then 拿到 →', v));

/* ---------- C. 为什么不能直接 chain.then(t) ---------- */
log('\n=== C. chain.then(t) vs chain.then(res => t().then(...)) ===');

// 写法①：chain.then(t) —— 直接把 t 当回调
function serialWrong(list) {
  return list.reduce((chain, t) => chain.then(t), Promise.resolve());
}
serialWrong(tasks).then(r => {
  log('C1 chain.then(t) 最终结果 =', JSON.stringify(r));
  log('   （期望？只有最后一个任务的结果：因为每次 .then(t) 的返回值被下一个覆盖，且没有累积数组）');
});

// 写法②：chain.then(res => t().then(v => {res.push(v); return res}))
function serialRight(list) {
  return list.reduce((chain, t) =>
    chain.then(res => t().then(v => { res.push(v); return res; }))
  , Promise.resolve([]));
}
serialRight(tasks).then(r => {
  log('C2 chain.then(res => t().then(...)) 最终结果 =', JSON.stringify(r), '（期望 ["任务1完成","任务2完成","任务3完成"]）');
});

/* 关键分析 */
setTimeout(() => {
  log('\n=== 分析 ===');
  log('1. t 是函数，调用 t() 才得 Promise，所以 t() 才有 .then');
  log('2. chain.then(t) 的问题：t 是"() => Promise"零参函数，.then 会把 chain 的值传给它（被忽略），');
  log('   且它的返回值直接成为新的 chain —— 没有地方累积结果数组 → 拿不到全部结果');
  log('3. 正确写法：chain.then(res => ...) 先把累积数组 res 拿出来，t() 执行后把结果 push 进 res 再返回 → 数组一路累积');
}, 50);
