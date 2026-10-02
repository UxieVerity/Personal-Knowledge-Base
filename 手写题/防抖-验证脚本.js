/**
 * 防抖（Debounce）验证脚本（Node，真实 setTimeout 时序）
 * 运行：node 防抖-验证脚本.js
 *
 * 验证 6 件事：
 *  [A] trailing 版：快速触发 5 次 → 只执行 1 次，且是最后一次（参数=最后一次）
 *  [B] leading 版：第一次立即执行，后续重置 → 只执行 1 次（第一次）
 *  [C] 冷却结束后再次触发 → 又能执行（防抖不是"只执行一次"，是"每次暂停后执行"）
 *  [D] 对比无防抖：5 次调用 = 5 次执行
 *  [E] this 绑定正确（setTimeout 里丢失 this 的经典坑）
 *  [F] cancel()：取消后不再执行
 */
'use strict';

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** 防抖（lodash 风格，可注入 immediate / 返回 cancel） */
function debounce(fn, delay = 300, immediate = false) {
  let timer = null;
  function debounced(...args) {
    const ctx = this;                 // 关键：先存 this（调用时是触发者）
    if (immediate && !timer) fn.apply(ctx, args);   // leading：无计时器=冷却完 → 立即执行
    clearTimeout(timer);              // 关键：每次触发都重置计时器
    timer = setTimeout(() => {
      if (!immediate) fn.apply(ctx, args);          // trailing：计时结束执行最后一次
      timer = null;
    }, delay);
  }
  debounced.cancel = () => { clearTimeout(timer); timer = null; };
  return debounced;
}

async function main() {
  const t0 = Date.now();
  const rel = () => Date.now() - t0;
  const log = (...a) => console.log(`[+${String(rel()).padStart(4)}ms]`, ...a);

  /* ---------- A. trailing 版：只执行最后一次 ---------- */
  log('=== A. trailing（尾执行）：20ms 间隔连发 5 次，delay=60ms ===');
  const execA = [];
  const debA = debounce((...args) => { execA.push({ t: rel(), args }); }, 60);
  for (let i = 1; i <= 5; i++) { debA(i); await sleep(20); }   // 触发点 0,20,40,60,80ms
  log('连发 5 次完毕（最后一次触发在 ~80ms），等待 100ms 看是否还有执行…');
  await sleep(100);
  log('A1 执行次数:', execA.length, '（期望 1）');
  log('A2 执行参数:', JSON.stringify(execA.map(e => e.args)), '（期望 [[5]]=最后一次）');
  log('A3 执行时刻:', JSON.stringify(execA.map(e => e.t)), 'ms（期望 ≈140ms=最后一次触发后 60ms）');

  /* ---------- B. leading 版：第一次立即执行 ---------- */
  log('\n=== B. leading（首执行）：同样连发 5 次，delay=60ms ===');
  const execB = [];
  const debB = debounce((...args) => { execB.push({ t: rel(), args }); }, 60, true);
  for (let i = 1; i <= 5; i++) { debB(i); await sleep(20); }
  await sleep(100);
  log('B1 执行次数:', execB.length, '（期望 1）');
  log('B2 执行参数:', JSON.stringify(execB.map(e => e.args)), '（期望 [[1]]=第一次）');
  log('B3 执行时刻:', JSON.stringify(execB.map(e => e.t)), 'ms（期望 ≈0ms=立即）');

  /* ---------- C. 冷却后再次触发 ---------- */
  log('\n=== C. 冷却结束后再次触发（trailing）===');
  const execC = [];
  const debC = debounce(x => execC.push(x), 60);
  debC(1); await sleep(100);          // 第一轮：执行 1 次
  debC(2); await sleep(100);          // 冷却结束，第二轮：再执行 1 次
  log('C1 总执行:', JSON.stringify(execC), '（期望 [1,2]：不是"只执行一次"，每轮暂停后都会执行）');

  /* ---------- D. 对比：无防抖 ---------- */
  log('\n=== D. 对比：不防抖，直接连发 5 次 ===');
  let d = 0;
  for (let i = 1; i <= 5; i++) { d++; await sleep(20); }
  log('D1 无防抖 5 次触发 → 执行', d, '次（期望 5）→ 防抖的价值：高频事件只留一次回调');

  /* ---------- E. this 绑定 ---------- */
  log('\n=== E. this 绑定（防抖后对象方法不丢 this）===');
  const btn = {
    label: '保存',
    clicks: 0,
    onClick: debounce(function () { this.clicks++; }, 30),   // 普通函数，this 应为 btn
  };
  btn.onClick(); btn.onClick(); btn.onClick();
  await sleep(80);
  log('E1 btn.clicks =', btn.clicks, '（期望 1：this 正确指向 btn；若 this 丢失会报错/计错）');

  /* ---------- F. cancel ---------- */
  log('\n=== F. cancel() 取消未执行的回调 ===');
  let f = 0;
  const debF = debounce(() => f++, 40);
  debF();
  debF.cancel();                        // 计时器被清掉
  await sleep(80);
  log('F1 cancel 后执行次数 =', f, '（期望 0）');
}

main();
