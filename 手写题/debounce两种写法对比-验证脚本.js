/**
 * 防抖两种写法对比验证（Node 真实输出）
 * 运行：node debounce两种写法对比-验证脚本.js
 *
 * 写法A：if (!immediate) 在外 → 决定"是否创建定时器"
 *   非 immediate：定时器回调 无条件执行 func
 *   immediate：不创建定时器 → timer 永远 null
 * 写法B：if (!immediate) 在内 → 决定"回调里是否执行 func"
 *   定时器总是创建；回调里 无论如何都 timer = null（冷却结束标记）
 *
 * 验证：两种写法 × 两种模式（trailing/leading）共 4 组
 */
'use strict';

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* 写法A：if (!immediate) 在外 */
function debounceA(fn, delay, immediate = false) {
  let timer = null;
  function debounced(...args) {
    const ctx = this;
    if (immediate && !timer) fn.apply(ctx, args);
    clearTimeout(timer);
    if (!immediate) {                        // ← 条件在外：决定创建定时器
      timer = setTimeout(() => {
        fn.apply(ctx, args);                 // 无条件执行
        timer = null;
      }, delay);
    }
  }
  return debounced;
}

/* 写法B：if (!immediate) 在内 */
function debounceB(fn, delay, immediate = false) {
  let timer = null;
  function debounced(...args) {
    const ctx = this;
    if (immediate && !timer) fn.apply(ctx, args);
    clearTimeout(timer);
    timer = setTimeout(() => {               // ← 总是创建定时器
      if (!immediate) fn.apply(ctx, args);   // 条件在内：决定执行
      timer = null;                          // 无论如何都置 null（冷却结束）
    }, delay);
  }
  return debounced;
}

const log = (...a) => console.log(...a);
const ok = (n, c) => log((c ? '✅' : '❌'), n);

async function run() {
  const t0 = Date.now();
  const rel = () => Date.now() - t0;

  /* A trailing（非 immediate） */
  log('=== A1. 写法A + 非 immediate（trailing）===');
  const a1 = [];
  const dA1 = debounceA(x => { a1.push({ t: rel(), x }); }, 60);
  for (let i = 1; i <= 5; i++) { dA1(i); await sleep(20); }
  await sleep(100);
  log('A1 执行次数 =', a1.length, '（期望 1：正常防抖）');

  /* A leading（immediate）—— 关键差异 */
  log('\n=== A2. 写法A + immediate（leading）===');
  const a2 = [];
  const dA2 = debounceA(x => { a2.push({ t: rel(), x }); }, 60, true);
  for (let i = 1; i <= 5; i++) { dA2(i); await sleep(20); }
  await sleep(100);
  log('A2 执行次数 =', a2.length, '（期望 1，实际看是否 bug）');
  log('A2 执行时刻 =', JSON.stringify(a2.map(e => e.t)), '（若 5 次都在 0-80ms = 每次触发都执行）');

  /* B trailing */
  log('\n=== B1. 写法B + 非 immediate（trailing）===');
  const b1 = [];
  const dB1 = debounceB(x => { b1.push({ t: rel(), x }); }, 60);
  for (let i = 1; i <= 5; i++) { dB1(i); await sleep(20); }
  await sleep(100);
  log('B1 执行次数 =', b1.length, '（期望 1：正常防抖）');

  /* B leading */
  log('\n=== B2. 写法B + immediate（leading）===');
  const b2 = [];
  const dB2 = debounceB(x => { b2.push({ t: rel(), x }); }, 60, true);
  for (let i = 1; i <= 5; i++) { dB2(i); await sleep(20); }
  await sleep(100);
  log('B2 执行次数 =', b2.length, '（期望 1：leading 只执行第一次）');
  log('B2 执行时刻 =', JSON.stringify(b2.map(e => e.t)), '（期望 ≈0：第一次立即执行）');

  /* 冷却后再次触发（leading 模式的"每轮暂停后都能再立即执行"） */
  log('\n=== C. leading 模式第二轮触发（写法B）===');
  const c = [];
  const dC = debounceB(x => c.push(x), 40, true);
  dC(1); await sleep(80);    // 第一轮：立即执行 1
  dC(2); await sleep(80);    // 冷却结束，第二轮：再立即执行 2
  log('C 执行 =', JSON.stringify(c), '（期望 [1,2]：每轮暂停后 leading 都能再触发）');

  /* 结论断言 */
  ok('A1 写法A trailing 正常', a1.length === 1);
  ok('A2 写法A leading 有 bug（执行多次）', a2.length > 1);
  ok('B1 写法B trailing 正常', b1.length === 1);
  ok('B2 写法B leading 正确（只 1 次）', b2.length === 1);
  ok('C leading 每轮可再触发', JSON.stringify(c) === '[1,2]');
}

run();
