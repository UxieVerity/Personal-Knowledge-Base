/**
 * 节流（Throttle）验证脚本（Node，真实 setTimeout 时序）
 * 运行：node 节流-验证脚本.js
 *
 * 验证 6 件事：
 *  [A] 时间戳版（leading）：连续触发 5 次（每 20ms）→ 约每 60ms 执行一次，立即执行第一次
 *  [B] 定时器版（trailing）：每次触发重置计时器 → 最后一次触发后执行（更接近"尾执行"）
 *  [C] 与防抖对比：同样 5 次连发，防抖只执行 1 次，节流执行多次 → 两者分工不同
 *  [D] 节流"冷却期内忽略中间触发"
 *  [E] this 绑定正确
 *  [F] cancel() 取消
 */
'use strict';

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** 节流-时间戳版（leading：第一次立即执行，之后固定间隔） */
function throttle(fn, delay = 300) {
  let last = 0;                 // 上次执行时刻
  return function (...args) {
    const now = Date.now();
    const ctx = this;
    if (now - last >= delay) {  // 距离上次执行已超过间隔 → 执行
      last = now;
      fn.apply(ctx, args);
    }
  };
}

/** 节流-定时器版（trailing：停止触发后 delay 执行最后一次） */
function throttleTimer(fn, delay = 300) {
  let timer = null;
  return function (...args) {
    const ctx = this;
    if (timer) return;          // 已有计时器 → 忽略（冷却期）
    timer = setTimeout(() => {
      fn.apply(ctx, args);
      timer = null;
    }, delay);
  };
}

/** 防抖（对照用，同前） */
function debounce(fn, delay = 300) {
  let timer = null;
  return function (...args) {
    const ctx = this;
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(ctx, args), delay);
  };
}

async function main() {
  const t0 = Date.now();
  const rel = () => Date.now() - t0;
  const log = (...a) => console.log(`[+${String(rel()).padStart(4)}ms]`, ...a);

  /* ---------- A. 时间戳版节流 ---------- */
  log('=== A. 时间戳版（leading）：每 20ms 触发，delay=60ms ===');
  const execA = [];
  const thA = throttle((...args) => execA.push({ t: rel(), args }), 60);
  for (let i = 1; i <= 5; i++) { thA(i); await sleep(20); }
  await sleep(100);
  log('A1 执行次数:', execA.length, '（期望 2-3：立即执行第1次 + 间隔后1-2次）');
  log('A2 执行时刻:', JSON.stringify(execA.map(e => e.t)), 'ms');
  log('A3 执行参数:', JSON.stringify(execA.map(e => e.args)));

  /* ---------- B. 定时器版节流 ---------- */
  log('\n=== B. 定时器版（trailing）：同样触发，delay=60ms ===');
  const execB = [];
  const thB = throttleTimer(x => execB.push({ t: rel(), x }), 60);
  for (let i = 1; i <= 5; i++) { thB(i); await sleep(20); }
  await sleep(100);
  log('B1 执行次数:', execB.length, '（期望 2：触发窗口 100ms > delay 60ms → 首段冷却后 1 次 + 冷却结束再触发 1 次）');
  log('B2 执行时刻:', JSON.stringify(execB.map(e => e.t)), 'ms（两次间隔 ≈ delay）');
  log('B3 关键：定时器版"冷却期忽略"只在冷却内有效，触发持续超过 delay 会分段执行');

  /* ---------- C. 与防抖对比 ---------- */
  log('\n=== C. 防抖 vs 节流（同样 5 次连发）===');
  let cDeb = 0, cTh = 0;
  const debC = debounce(() => cDeb++, 60);
  const thC = throttle(() => cTh++, 60);
  for (let i = 0; i < 5; i++) { debC(); thC(); await sleep(20); }
  await sleep(120);
  log('C1 防抖执行:', cDeb, '次 | 节流执行:', cTh, '次 ← 防抖"停后一次"，节流"间隔多次"');

  /* ---------- D. 冷却期忽略中间触发 ---------- */
  log('\n=== D. 冷却期（间隔内）中间触发被忽略 ===');
  const timesD = [];
  const thD = throttle(t => timesD.push(t), 60);
  thD(1);                // 0ms 执行
  thD(2); thD(3);        // 冷却期 → 忽略
  await sleep(70);
  thD(4);                // 冷却结束 → 执行
  await sleep(10);
  log('D1 执行时刻序列:', JSON.stringify(timesD), '（期望 [1,4]：2、3 被忽略）');

  /* ---------- E. this 绑定 ---------- */
  log('\n=== E. this 绑定 ===');
  const obj = { n: 0, inc: throttle(function () { this.n++; }, 30) };
  obj.inc(); obj.inc(); obj.inc();
  await sleep(50);
  log('E1 obj.n =', obj.n, '（期望 1：this 正确指向 obj）');

  /* ---------- F. cancel（定时器版） ---------- */
  log('\n=== F. cancel()（定时器版）===');
  let fCount = 0;
  let fTimer = null;
  const thF = function (...args) {
    const ctx = this;
    if (fTimer) return;
    fTimer = setTimeout(() => { fCount++; fTimer = null; }, 40);
  };
  thF.cancel = () => { clearTimeout(fTimer); fTimer = null; };
  thF();                        // 挂一个计时器
  thF.cancel();                 // 取消 → 不执行
  await sleep(80);
  log('F1 cancel 后执行次数 =', fCount, '（期望 0）');
}

main();
