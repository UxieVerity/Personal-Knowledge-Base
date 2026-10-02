/**
 * t() 不返回 Promise 时串行链的行为 —— 验证脚本
 * 运行：node serial-t不返回promise-验证.js
 *
 * 验证 3 件事：
 *  [A] t() 返回普通值 → t().then(...) 直接 TypeError
 *  [B] 同步 t() 换个写法（不用 t().then）→ 链也能跑，顺序也保持
 *  [C] 结论：链的本质是"等上一个完成"，同步函数没有"完成"可等 → 失去意义
 */
'use strict';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log(...a);

/* ---------- A. t() 返回普通值 → t().then 崩溃 ---------- */
log('=== A. t() 返回普通值 → t().then(...) TypeError ===');
const syncTasks = [1, 2, 3].map(id => () => `同步结果${id}`);  // t() 返回字符串，不是 Promise
const t = syncTasks[0];
log('A1 typeof t() =', typeof t(), '（期望 string：不是 Promise）');
try {
  t().then(v => log('A2 拿到 →', v));
} catch (e) {
  log('A2 t().then 直接 →', e.constructor.name + ':', e.message.split('\n')[0], '（期望 TypeError: t(...).then is not a function）');
}

/* ---------- B. 同步 t() 换个写法：不依赖 t().then ---------- */
log('\n=== B. 同步任务换个写法（不调 t().then）===');
// 把 t() 的结果同步 push，不需要 t().then —— 链照样串起来
function serialSync(list) {
  return list.reduce((chain, t) =>
    chain.then(res => { res.push(t()); return res; })   // 同步 push，无 t().then
  , Promise.resolve([]));
}
serialSync(syncTasks).then(r => {
  log('B1 同步串行结果 =', JSON.stringify(r), '（期望 ["同步结果1","同步结果2","同步结果3"]）');
  log('B2 注意：这里 t() 返回的是"值"直接 push，没有 .then 也能跑');
});

/* ---------- C. 关键：链的本质是"等上一个完成" ---------- */
log('\n=== C. 链的本质 = 等待异步完成 ===');
// 混合：既有异步任务又有同步任务 —— 同步任务的"值"会被 then 自动包成已 resolve 的 Promise
const mixed = [
  () => sleep(20).then(() => '异步A'),
  () => '同步B',                    // 同步，返回普通值
  () => sleep(20).then(() => '异步C'),
];
// 用标准写法（t().then）→ 同步的那个会崩
function serialStd(list) {
  return list.reduce((chain, t) =>
    chain.then(res => t().then(v => { res.push(v); return res; }))
  , Promise.resolve([]));
}
try {
  // 同步部分不会崩（t().then 在异步回调里才执行），崩溃发生在微任务里 → try/catch 抓不到
  serialStd(mixed).then(r => log('C1 混合+标准写法 =', JSON.stringify(r)))
    .catch(e => log('C1 混合+标准写法 → 同步任务处 reject：', e.constructor.name, e.message.split('\n')[0]));
} catch (e) {
  log('C1 外层 try/catch → 抓不到（异步回调里的 throw 不被外层同步 try 捕获）');
}
// 但如果是 then 自动包装：chain.then(t) 会让同步返回值被自动包成 Promise
function serialAuto(list) {
  return list.reduce((chain, t) =>
    chain.then(res => t()).then(v => v)   // 同步值被自动包，但 res 丢失
  , Promise.resolve([]));
}
serialAuto(mixed).then(v => log('C1b 自动包装版结果 =', JSON.stringify(v), '（能跑但不累积）'));

/* ---------- D. 结论汇总 ---------- */
setTimeout(() => {
  log('\n=== D. 结论 ===');
  log('D1 t().then(...) 要求 t() 返回 Promise/thenable —— 返回普通值/undefined 直接 TypeError');
  log('D2 同步 t() 换个写法（同步 push，不调 t().then）也能串起来 —— 顺序仍保持');
  log('D3 但串行链存在的意义 = "等上一个异步完成再启动下一个"；同步函数没有完成可等 → 没必要用链（直接 map 即可）');
  log('D4 所以：不返回 Promise 不是"不能玩"，是"没必要玩"——串行链天生为异步任务设计');
}, 50);
