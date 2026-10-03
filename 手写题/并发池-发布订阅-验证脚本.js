/**
 * Promise 并发池 + 发布订阅验证脚本（Node 真实输出）
 * 运行：node 并发池-发布订阅-验证脚本.js
 *
 * 验证 6 件事：
 *  [A] Promise 并发池：限制并发 N，最多 N 个同时跑，结果保序
 *  [B] 并发池：空数组 / 并发数 > 任务数 边界
 *  [C] 发布订阅：on/emit 触发所有订阅者 / off 取消订阅
 *  [D] 发布订阅：once 只触发一次
 *  [E] 发布订阅：emit 时新订阅不触发本次（防死循环）
 */
'use strict';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log(...a);
const ok = (n, c) => log((c ? '✅' : '❌'), n);

/* ========== Promise 并发池 ========== */
function pool(list, limit) {
  return new Promise((resolve, reject) => {
    const results = new Array(list.length);
    let index = 0;                       // 下一个要执行的任务索引
    let active = 0;                      // 当前并发数
    let completed = 0;

    function next() {
      if (index >= list.length) return;  // 任务取完
      const i = index++;
      active++;
      Promise.resolve()
        .then(() => list[i]())           // 执行任务（惰性）
        .then(v => {
          results[i] = v;
          completed++;
          active--;
          if (completed === list.length) resolve(results);
          else next();                   // 空出一个名额 → 拉下一个
        })
        .catch(e => { active--; reject(e); });  // 任一失败 → 整体 reject
    }
    // 启动 limit 个 worker（不足则全启动）
    for (let w = 0; w < Math.min(limit, list.length); w++) next();
  });
}

/* ---------- A. 基本：并发 2，结果保序 ---------- */
log('=== A. 并发池：limit=2，5 任务 × 30ms ===');
const tasksA = [1, 2, 3, 4, 5].map(id => () => sleep(30).then(() => `任务${id}`));
const t0 = Date.now();
pool(tasksA, 2).then(r => {
  const cost = Date.now() - t0;
  log('A1 结果 =', JSON.stringify(r), '（期望 保序）');
  log('A2 耗时 =', cost, 'ms（期望 ≈90ms：5/2×30，比串行 150ms 快）');
  ok('A1 并发池保序', JSON.stringify(r) === '["任务1","任务2","任务3","任务4","任务5"]');
  ok('A2 并发更快（<150ms）', cost < 150);
});

/* ---------- B. 边界：空数组 / 并发>任务数 ---------- */
log('\n=== B. 边界 ===');
pool([], 3).then(r => log('B1 空数组 →', JSON.stringify(r), '（期望 []）'));
const tasksB = [1, 2].map(id => () => sleep(10).then(() => id));
pool(tasksB, 5).then(r => log('B2 limit>任务数 →', JSON.stringify(r), '（期望 [1,2] 全执行）'));

/* ========== 发布订阅（EventEmitter 精简版） ========== */
class EventEmitter {
  constructor() { this.events = new Map(); }   // 事件名 → Set<回调>

  on(name, fn) {
    if (!this.events.has(name)) this.events.set(name, new Set());
    this.events.get(name).add(fn);
    return () => this.off(name, fn);           // 返回取消函数（方便）
  }
  off(name, fn) {
    this.events.get(name)?.delete(fn);
  }
  once(name, fn) {
    const wrapper = (...args) => { this.off(name, wrapper); fn(...args); };
    return this.on(name, wrapper);
  }
  emit(name, ...args) {
    const set = this.events.get(name);
    if (!set) return;
    // 遍历副本：允许回调里 on/off，不影响本次遍历
    [...set].forEach(fn => fn(...args));
  }
}

/* ---------- C. on / emit / off ---------- */
log('\n=== C. 发布订阅：on/emit/off ===');
const bus = new EventEmitter();
const got = [];
const f1 = (x) => got.push(`f1:${x}`);
const f2 = (x) => got.push(`f2:${x}`);
bus.on('msg', f1);
bus.on('msg', f2);
bus.emit('msg', 'hello');
log('C1 两个订阅者都触发 =', JSON.stringify(got), '（期望 ["f1:hello","f2:hello"]）');
bus.off('msg', f1);
bus.emit('msg', 'world');
log('C2 off 后只剩 f2 =', JSON.stringify(got), '（期望 追加 ["f2:world"]）');
ok('C1 多订阅者触发', JSON.stringify(got.slice(0, 2)) === '["f1:hello","f2:hello"]');
ok('C2 off 生效', got[2] === 'f2:world' && got.length === 3);

/* ---------- D. once 只触发一次 ---------- */
log('\n=== D. once 只触发一次 ===');
const onceGot = [];
bus.once('once', (x) => onceGot.push(x));
bus.emit('once', '第1次');
bus.emit('once', '第2次');
log('D1 once 结果 =', JSON.stringify(onceGot), '（期望 ["第1次"]：第二次不触发）');
ok('D1 once 只一次', JSON.stringify(onceGot) === '["第1次"]');

/* ---------- E. emit 中新订阅不触发本次（防死循环） ---------- */
log('\n=== E. emit 中 on 不触发本次 ===');
const eGot = [];
const eb = new EventEmitter();
eb.on('evt', () => {
  eGot.push('第一次');
  eb.on('evt', () => eGot.push('新订阅'));   // 本次 emit 不该触发它
});
eb.emit('evt');
const snapAfter1st = JSON.stringify(eGot);
log('E1 第一次 emit =', snapAfter1st, '（期望 ["第一次"]：新订阅不触发本次）');
eb.emit('evt');
log('E2 第二次 emit =', JSON.stringify(eGot), '（期望 ["第一次","第一次","新订阅"]：旧回调又触发一次 + 新订阅首次触发）');
ok('E1 新订阅不触发本次', snapAfter1st === '["第一次"]');
ok('E2 下次才触发', eGot.length === 3);
