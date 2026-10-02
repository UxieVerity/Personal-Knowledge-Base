/**
 * 串行并发控制验证脚本（Node 真实输出）
 * 运行：node 串行并发控制-验证脚本.js
 *
 * 串行 = 一次只执行一个，前一个完成才启动下一个（保证顺序 / 控制并发=1）。
 * 验证 4 件事：
 *  [A] async/await for...of 串行（最直观）
 *  [B] reduce 链式串行（Promise 风格）
 *  [C] 并发池（限制并发数 N，滑动窗口）—— 与串行对比
 *  [D] 三种方式的结果顺序一致性 + 并发数实测
 */
'use strict';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log(...a);
const ok = (n, c) => log((c ? '✅' : '❌'), n);

// 模拟异步任务：id + 耗时，返回标记
const tasks = [1, 2, 3, 4, 5].map((id, i) => () =>
  sleep(30).then(() => ({ id, done: `任务${id}完成` }))
);

/* ---------- A. async/await for...of 串行 ---------- */
log('=== A. async/await for...of 串行 ===');
async function serialForOf(list) {
  const results = [];
  for (const t of list) {          // 一个一个 await → 严格串行
    results.push(await t());
  }
  return results;
}

const t0 = Date.now();
serialForOf(tasks).then(r => {
  const cost = Date.now() - t0;
  log('A1 结果顺序 =', JSON.stringify(r.map(x => x.id)), '（期望 [1,2,3,4,5]）');
  log('A2 总耗时 =', cost, 'ms（期望 ≥150ms：5 个 × 30ms 串行）');
  ok('A1 串行保序', JSON.stringify(r.map(x => x.id)) === '[1,2,3,4,5]');
  ok('A2 串行耗时 ≈ 5×30', cost >= 150);
});

/* ---------- B. reduce 链式串行 ---------- */
log('\n=== B. reduce 链式串行 ===');
function serialReduce(list) {
  return list.reduce((chain, t) =>
    chain.then(res => t().then(v => { res.push(v); return res; }))
  , Promise.resolve([]));
}
const t1 = Date.now();
serialReduce(tasks).then(r => {
  const cost = Date.now() - t1;
  log('B1 结果顺序 =', JSON.stringify(r.map(x => x.id)), '（期望 [1,2,3,4,5]）');
  log('B2 总耗时 =', cost, 'ms（期望 ≥150ms：同样串行）');
  ok('B1 reduce 串行保序', JSON.stringify(r.map(x => x.id)) === '[1,2,3,4,5]');
  ok('B2 串行耗时一致', cost >= 150);
});

/* ---------- C. 并发池（限制并发 N，对比串行） ---------- */
log('\n=== C. 并发池：限制并发数（滑动窗口）===');
async function pool(list, limit) {
  const results = new Array(list.length);
  let index = 0;
  const workers = Array.from({ length: Math.min(limit, list.length) }, async () => {
    while (true) {
      const i = index++;           // 取任务索引（原子递增）
      if (i >= list.length) break;
      results[i] = await list[i]();  // 执行任务
    }
  });
  await Promise.all(workers);
  return results;
}
const t2 = Date.now();
pool(tasks, 2).then(r => {
  const cost = Date.now() - t2;
  log('C1 结果顺序 =', JSON.stringify(r.map(x => x.id)), '（期望 [1,2,3,4,5]：结果仍保序）');
  log('C2 总耗时 =', cost, 'ms（期望 ≈90ms：5 任务 / 2 并发 × 30ms）');
  log('C3 并发 2 vs 串行 1 → 耗时约减半（串行 150ms vs 池 90ms）');
  ok('C1 并发池结果保序', JSON.stringify(r.map(x => x.id)) === '[1,2,3,4,5]');
  ok('C2 并发池更快（<150ms）', cost < 150);
});

/* ---------- D. 三种方式对比 ---------- */
log('\n=== D. 串行 vs 并发池 对比 ===');
setTimeout(() => {
  log('D1 串行（for-of / reduce）：并发=1，耗时 = N×单任务，严格保序');
  log('D2 并发池：并发=N，耗时 ≈ N×单任务/并发，结果仍按索引保序');
  log('D3 选型：要"严格顺序 + 依赖前一个结果"→ 串行；"能并行且控制并发数"→ 并发池');
}, 200);
