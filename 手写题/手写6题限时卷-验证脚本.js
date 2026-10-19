/**
 * 手写题 6 题限时模拟卷（5min/题）—— 自动断言版
 * 运行：node 手写6题限时卷-验证脚本.js
 *
 * 模拟考场：每题的实现 + 断言。计时由人来控制（5 分钟写一题）。
 * 6 题：① 防抖 ② 节流 ③ 深拷贝 ④ 数组扁平化 ⑤ Promise.all ⑥ 发布订阅
 */
'use strict';

const log = (...a) => console.log(...a);
let pass = 0, fail = 0;
const ok = (name, cond) => {
  if (cond) { pass++; log('✅', name); }
  else { fail++; log('❌', name); }
};

/* ══════════ ① 防抖（trailing + leading）══════════ */
function debounce(fn, delay = 300, immediate = false) {
  let timer = null;
  return function (...args) {
    const ctx = this;
    if (immediate && !timer) fn.apply(ctx, args);
    clearTimeout(timer);
    timer = setTimeout(() => {          // ← 定时器始终创建（if 在回调内）
      if (!immediate) fn.apply(ctx, args);
      timer = null;                     // ← 无条件置 null = 冷却标记
    }, delay);
  };
}

/* ══════════ ② 节流（时间戳版）══════════ */
function throttle(fn, delay = 300) {
  let last = 0;
  return function (...args) {
    const now = Date.now();
    const ctx = this;
    if (now - last >= delay) {
      last = now;
      fn.apply(ctx, args);
    }
  };
}

/* ══════════ ③ 深拷贝（WeakMap 防循环）══════════ */
function deepClone(obj, seen = new WeakMap()) {
  if (obj === null || typeof obj !== 'object') return obj;
  if (seen.has(obj)) return seen.get(obj);          // 循环引用
  if (obj instanceof Date) return new Date(obj.getTime());
  if (obj instanceof RegExp) return new RegExp(obj.source, obj.flags);
  const clone = Array.isArray(obj) ? [] : {};
  seen.set(obj, clone);                              // ← 必须先 set 再递归
  for (const key of Object.keys(obj)) {
    clone[key] = deepClone(obj[key], seen);
  }
  return clone;
}

/* ══════════ ④ 数组扁平化（递归 + 迭代）══════════ */
function flattenRecursive(arr) {
  return arr.reduce((acc, cur) =>
    Array.isArray(cur) ? acc.concat(flattenRecursive(cur)) : acc.concat(cur), []);
}
function flattenIterative(arr) {
  const stack = [...arr];
  const res = [];
  while (stack.length) {
    const cur = stack.pop();
    if (Array.isArray(cur)) stack.push(...cur);      // 展开孩子入栈
    else res.push(cur);
  }
  return res.reverse();                              // pop 逆序 → 需 reverse
}

/* ══════════ ⑤ Promise.all（保序 + 短路）══════════ */
function myAll(ps) {
  return new Promise((resolve, reject) => {
    if (ps.length === 0) return resolve([]);
    const results = new Array(ps.length);
    let done = 0;
    ps.forEach((p, i) => {
      Promise.resolve(p).then(v => {
        results[i] = v;                              // 索引写 → 保序
        if (++done === ps.length) resolve(results);
      }, reject);                                    // 任一失败 → 整体 reject
    });
  });
}

/* ══════════ ⑥ 发布订阅 ══════════ */
class EventEmitter {
  constructor() { this.events = new Map(); }
  on(name, fn) {
    if (!this.events.has(name)) this.events.set(name, new Set());
    this.events.get(name).add(fn);
    return () => this.off(name, fn);
  }
  off(name, fn) { this.events.get(name)?.delete(fn); }
  once(name, fn) {
    const w = (...a) => { this.off(name, w); fn(...a); };
    return this.on(name, w);
  }
  emit(name, ...args) {
    const set = this.events.get(name);
    if (!set) return;
    [...set].forEach(fn => fn(...args));             // 副本遍历防死循环
  }
}

/* ══════════ 断言 ══════════ */
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  log('═══════ 手写 6 题断言 ═══════');

  /* ① 防抖 */
  {
    const calls = [];
    const d = debounce(x => calls.push(x), 30);
    d(1); d(2); d(3);
    await sleep(60);
    ok('① 防抖 trailing 只执行最后一次', calls.length === 1 && calls[0] === 3);

    const leadingCalls = [];
    const dl = debounce(x => leadingCalls.push(x), 30, true);
    dl(1); dl(2); dl(3);
    await sleep(60);
    ok('① 防抖 leading 只执行第一次（且不重复）', leadingCalls.length === 1 && leadingCalls[0] === 1);
  }

  /* ② 节流 */
  {
    const calls = [];
    const times = [];
    const t = throttle(x => { calls.push(x); times.push(Date.now()); }, 30);
    for (let i = 0; i < 5; i++) { t(i); await sleep(10); }
    // 5 次触发（0/10/20/30/40ms），delay=30 → 执行 0ms、30ms 附近 → 2~3 次
    const gaps = times.slice(1).map((v, i) => v - times[i]);
    ok('② 节流执行次数 ≤3（降频生效）', calls.length >= 1 && calls.length <= 3);
    ok('② 节流执行间隔 ≥ delay', gaps.every(g => g >= 28));
  }

  /* ③ 深拷贝 */
  {
    const src = { a: 1, b: { c: [1, 2] }, d: new Date(0), e: /x/g };
    src.self = src;                                   // 循环引用
    const copy = deepClone(src);
    ok('③ 深拷贝嵌套对象不共享', copy.b !== src.b && JSON.stringify(copy.b) === JSON.stringify(src.b));
    ok('③ 深拷贝循环引用', copy.self === copy);
    ok('③ 深拷贝 Date/RegExp', copy.d instanceof Date && copy.e instanceof RegExp && copy.e.source === 'x');
  }

  /* ④ 扁平化 */
  {
    const arr = [1, [2, [3, [4, [5]]]], 6];
    ok('④ 递归扁平化', JSON.stringify(flattenRecursive(arr)) === '[1,2,3,4,5,6]');
    ok('④ 迭代扁平化（顺序一致）', JSON.stringify(flattenIterative(arr)) === '[1,2,3,4,5,6]');
  }

  /* ⑤ Promise.all */
  {
    const r1 = await myAll([1, Promise.resolve(2), sleep(10).then(() => 3)]);
    ok('⑤ all 保序（含 Promise/普通值）', JSON.stringify(r1) === '[1,2,3]');

    let rejected = false;
    await myAll([Promise.resolve(1), Promise.reject('err')]).catch(e => {
      if (e === 'err') rejected = true;
    });
    ok('⑤ all 任一失败整体 reject', rejected);

    const empty = await myAll([]);
    ok('⑤ all 空数组 → []', Array.isArray(empty) && empty.length === 0);
  }

  /* ⑥ 发布订阅 */
  {
    const bus = new EventEmitter();
    const got = [];
    const off1 = bus.on('evt', x => got.push(`a${x}`));
    bus.on('evt', x => got.push(`b${x}`));
    bus.emit('evt', 1);
    ok('⑥ on 多订阅者', JSON.stringify(got) === '["a1","b1"]');
    off1();
    bus.emit('evt', 2);
    ok('⑥ off 取消生效', got.length === 3 && got[2] === 'b2');

    const onceGot = [];
    bus.once('once', x => onceGot.push(x));
    bus.emit('once', 1); bus.emit('once', 2);
    ok('⑥ once 只触发一次', JSON.stringify(onceGot) === '[1]');

    // emit 中新订阅不触发本次
    const eGot = [];
    const bus2 = new EventEmitter();
    bus2.on('x', () => { eGot.push('1'); bus2.on('x', () => eGot.push('2')); });
    bus2.emit('x');
    ok('⑥ emit 中新订阅不触发本次', JSON.stringify(eGot) === '["1"]');
  }

  log(`\n═══════ 结果：${pass} 通过 / ${fail} 失败 ═══════`);
  if (fail > 0) process.exitCode = 1;
})();
