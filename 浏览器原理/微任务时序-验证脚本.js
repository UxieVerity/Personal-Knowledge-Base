/**
 * 微任务时序深度验证脚本（Node 真实输出）
 * 运行：node 微任务时序-验证脚本.js
 *
 * 验证 6 个经典时序论断：
 *  [A] 宏任务之后：先排空全部微任务，才取下一个宏任务
 *  [B] 微任务嵌套微任务：同批次排空（新加的微任务也在这轮清完，不插队宏任务）
 *  [C] Promise.then / async-await 续体都是微任务（同队列，顺序 FIFO）
 *  [D] Promise 的 then 是"排队"不是"立即"：多个 then 按注册顺序执行
 *  [E] 微任务先于渲染/宏任务：连续微任务不会被打断
 *  [F] Node 特有：process.nextTick 先于 Promise 微任务（同轮）
 */
'use strict';

const log = (...a) => console.log(...a);
const ok = (n, c) => log((c ? '✅' : '❌'), n);

/* ---------- A. 宏任务 → 排空微任务 → 下一个宏任务 ---------- */
log('=== A. 宏任务之间排空所有微任务 ===');
const a = [];
setTimeout(() => { a.push('宏任务1'); Promise.resolve().then(() => a.push('宏任务1的微任务')); }, 0);
setTimeout(() => { a.push('宏任务2'); }, 0);
Promise.resolve().then(() => a.push('脚本级微任务'));
a.push('同步');
setTimeout(() => {
  log('A 顺序 =', JSON.stringify(a));
  log('A 期望 = ["同步","脚本级微任务","宏任务1","宏任务1的微任务","宏任务2"]');
  ok('A 宏任务后先清微任务', a[3] === '宏任务1的微任务' && a[4] === '宏任务2');
}, 10);

/* ---------- B. 微任务嵌套：同批排空，不插队宏任务 ---------- */
log('\n=== B. 微任务嵌套微任务：同批次排空 ===');
const b = [];
setTimeout(() => b.push('宏任务'), 0);
b.push('同步');
Promise.resolve().then(() => {
  b.push('微任务1');
  Promise.resolve().then(() => b.push('微任务1产生的微任务'));  // 微任务里的微任务
  b.push('微任务1后');
});
setTimeout(() => {
  log('B 顺序 =', JSON.stringify(b));
  log('B 期望 = ["同步","微任务1","微任务1后","微任务1产生的微任务","宏任务"]');
  ok('B 微任务同批排空（不插队宏任务）', b[1] === '微任务1' && b[2] === '微任务1后' && b[3] === '微任务1产生的微任务' && b[4] === '宏任务');
}, 10);

/* ---------- C. Promise.then 与 async 续体都是微任务（FIFO） ---------- */
log('\n=== C. then 与 async 续体：同一微任务队列，FIFO ===');
const c = [];
Promise.resolve().then(() => c.push('then续体'));
(async () => { await undefined; c.push('async续体'); })();
c.push('同步');
setTimeout(() => {
  log('C 顺序 =', JSON.stringify(c));
  log('C 期望 = ["同步","then续体","async续体"]（注册顺序 FIFO）');
  ok('C then 和 async 都是微任务同队列', c[1] === 'then续体' && c[2] === 'async续体');
}, 10);

/* ---------- D. 多 then 按注册顺序 ---------- */
log('\n=== D. 多个 then 按注册顺序排队 ===');
const d = [];
const p = Promise.resolve('值');
p.then(v => d.push(`第1个then:${v}`));
p.then(v => d.push(`第2个then:${v}`));
p.then(v => d.push(`第3个then:${v}`));
d.push('同步');
setTimeout(() => {
  log('D 顺序 =', JSON.stringify(d));
  log('D 期望 = ["同步","第1个then:值","第2个then:值","第3个then:值"]');
  ok('D then 按注册顺序', d[1] === '第1个then:值' && d[2] === '第2个then:值' && d[3] === '第3个then:值');
}, 10);

/* ---------- E. 微任务连续执行不被宏任务打断 ---------- */
log('\n=== E. 微任务连续执行（中间插宏任务也等微任务排空）===');
const e = [];
setTimeout(() => e.push('宏任务'), 0);
e.push('同步');
for (let i = 0; i < 3; i++) Promise.resolve().then(() => e.push(`微${i}`));
setTimeout(() => {
  log('E 顺序 =', JSON.stringify(e));
  log('E 期望 = ["同步","微0","微1","微2","宏任务"]（微任务一口气跑完）');
  ok('E 微任务连续不被打断', e[1] === '微0' && e[3] === '微2' && e[4] === '宏任务');
}, 10);

/* ---------- F. Node 特有：process.nextTick 先于 Promise ---------- */
log('\n=== F. Node: process.nextTick 先于 Promise 微任务 ===');
if (typeof process !== 'undefined' && process.nextTick) {
  const f = [];
  Promise.resolve().then(() => f.push('Promise微任务'));
  process.nextTick(() => f.push('nextTick'));
  f.push('同步');
  setTimeout(() => {
    log('F 顺序 =', JSON.stringify(f), '（期望 同步 → nextTick → Promise微任务）');
    ok('F nextTick 先于 Promise', f[1] === 'nextTick' && f[2] === 'Promise微任务');
  }, 10);
} else {
  log('F 浏览器环境无 process.nextTick，跳过');
}

/* ---------- G. 面试要点总结 ---------- */
setTimeout(() => {
  log('\n=== G. 总结 ===');
  log('G1 微任务队列"每轮必清空"：排空后才取下一个宏任务');
  log('G2 微任务里加的微任务 → 同一批继续清（不插队宏任务）');
  log('G3 Promise.then / async 续体 / queueMicrotask / MutationObserver 同队列 FIFO');
  log('G4 Node 的 nextTick 是"当前宏任务尾部"的独立优先队列（先于微任务）');
  log('G5 渲染在微任务清空之后：微任务太多会阻塞渲染/掉帧（面试点）');
}, 20);
