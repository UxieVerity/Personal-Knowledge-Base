/**
 * Promise.then 链式 + all + race 验证脚本（Node 真实输出）
 * 运行：node Promise链式-all-race-验证脚本.js
 *
 * 验证 6 件事：
 *  [A] then 链式：返回值传递 / 返回 Promise 则等待其 resolve（展平）
 *  [B] 链式错误传递：中间 reject → 跳过后续 onFulfilled 直到 onRejected
 *  [C] Promise.all：全部 resolve 才 resolve（数组保序）/ 任一 reject 则整体 reject
 *  [D] Promise.race：第一个 settle 的结果（resolve 或 reject）
 *  [E] all/race 手写实现（与原生行为对比）
 */
'use strict';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log(...a);
const ok = (n, c) => log((c ? '✅' : '❌'), n);

/* ---------- A. then 链式 + 返回 Promise 展平 ---------- */
log('=== A. then 链式：返回值传递 + 返回 Promise 展平 ===');
const aRes = [];
new Promise(res => res(1))
  .then(v => { aRes.push(`A1:${v}`); return v + 1; })     // 返回数字 → 下一个 then 直接收到
  .then(v => { aRes.push(`A2:${v}`); return Promise.resolve(v + 1); })  // 返回 Promise → 等待 resolve（展平）
  .then(v => aRes.push(`A3:${v}`));
setTimeout(() => {
  log('A 链式 =', JSON.stringify(aRes), '（期望 ["A1:1","A2:2","A3:3"]）');
  ok('A 链式+展平', JSON.stringify(aRes) === '["A1:1","A2:2","A3:3"]');
}, 20);

/* ---------- B. 错误传递（跳过 onFulfilled） ---------- */
log('\n=== B. 链式错误传递 ===');
const bRes = [];
new Promise((res, rej) => rej('中间出错'))
  .then(v => { bRes.push(`不该执行:${v}`); return v; })          // onFulfilled 被跳过
  .then(v => { bRes.push(`也不该执行:${v}`); return v; })
  .catch(e => bRes.push(`捕获:${e}`));                           // 跳到最近的 onRejected
setTimeout(() => {
  log('B 错误链 =', JSON.stringify(bRes), '（期望 ["捕获:中间出错"]）');
  ok('B 错误跳过到 catch', JSON.stringify(bRes) === '["捕获:中间出错"]');
}, 20);

/* ---------- C. Promise.all ---------- */
log('\n=== C. Promise.all ===');
const allRes = [];
Promise.all([Promise.resolve(1), Promise.resolve(2), Promise.resolve(3)])
  .then(v => allRes.push(`全部:${JSON.stringify(v)}`));
Promise.all([Promise.resolve(1), Promise.reject('X'), Promise.resolve(3)])
  .then(v => allRes.push(`不该:${v}`), e => allRes.push(`reject:${e}`));
setTimeout(() => {
  log('C1 全部成功 →', allRes[0], '（期望 ["全部:[1,2,3]"]）');
  log('C2 任一失败 →', allRes[1], '（期望 ["reject:X"]）');
  ok('C1 全部成功保序', allRes[0] === '全部:[1,2,3]');
  ok('C2 任一失败整体 reject', allRes[1] === 'reject:X');
}, 20);

/* ---------- D. Promise.race ---------- */
log('\n=== D. Promise.race：第一个 settle 的结果 ===');
const raceRes = [];
Promise.race([
  sleep(30).then(() => '慢的'),
  Promise.resolve('快的'),
]).then(v => raceRes.push(`先到:${v}`));
Promise.race([
  sleep(30).then(() => '不该到'),
  Promise.reject('立即失败'),
]).then(v => raceRes.push(`不该:${v}`), e => raceRes.push(`先败:${e}`));
setTimeout(() => {
  log('D1 快的 resolve 先 →', raceRes[0], '（期望 先到:快的）');
  log('D2 快的 reject 先 →', raceRes[1], '（期望 先败:立即失败）');
  ok('D1 race 先到先得', raceRes[0] === '先到:快的');
  ok('D2 race 先败先得', raceRes[1] === '先败:立即失败');
}, 60);

/* ---------- E. 手写 all / race 与原生对比 ---------- */
log('\n=== E. 手写 all / race ===');
function myAll(ps) {
  return new Promise((resolve, reject) => {
    const results = new Array(ps.length);
    let done = 0;
    if (ps.length === 0) return resolve([]);       // 空数组 → 立即 resolve []
    ps.forEach((p, i) => {
      Promise.resolve(p).then(v => {
        results[i] = v;                            // 按索引存（保序）
        if (++done === ps.length) resolve(results);
      }, reject);                                  // 任一失败 → 整体 reject（短路）
    });
  });
}
function myRace(ps) {
  return new Promise((resolve, reject) => {
    ps.forEach(p => Promise.resolve(p).then(resolve, reject));  // 第一个 settle 的赢
  });
}

const eRes = [];
myAll([Promise.resolve(1), sleep(10).then(() => 2), Promise.resolve(3)])
  .then(v => eRes.push(`all:${JSON.stringify(v)}`));
myRace([sleep(20).then(() => '慢'), Promise.resolve('快')])
  .then(v => eRes.push(`race:${v}`));
setTimeout(() => {
  log('E1 手写 all =', eRes.find(x => x.startsWith('all')), '（期望 all:[1,2,3] 保序）');
  log('E2 手写 race =', eRes.find(x => x.startsWith('race')), '（期望 race:快）');
  ok('E1 手写 all 保序', eRes.find(x => x.startsWith('all')) === 'all:[1,2,3]');
  ok('E2 手写 race', eRes.find(x => x.startsWith('race')) === 'race:快');
}, 60);
