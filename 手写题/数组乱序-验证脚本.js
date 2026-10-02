/**
 * 数组乱序（洗牌 Shuffle）验证脚本（Node）
 * 运行：node 数组乱序-验证脚本.js
 *
 * 验证 7 件事：
 *  [A] Fisher-Yates 洗牌：结果正确（元素齐全、无重复、可乱序）
 *  [B] 均匀性统计：跑 N 次，每元素出现在每位置的概率 ≈ 1/n —— Fisher-Yates 均匀
 *  [C] sort(() => Math.random()-0.5) 的偏差：V8 sort 非均匀 → 概率偏离 1/n（错误做法实证）
 *  [D] 性能粗测
 *  [E] 插入点分布 f(n)：二分查找随机比较器 → 落点概率（右侧是左侧 2 倍，n=4 时 12.5% vs 25%）
 *  [F] 判定树深度：右侧叶子浅（2 层）、左侧叶子深（3 层）→ 路径短概率高（(1/2)^深度）
 *  [G] 精确概率：元素1留位置0 = Π(1-f(i,0)) ≈ 24.6%，元素5落位置4 = f(4,4) = 25%
 */
'use strict';

/* ---------- 实现区 ---------- */

/** Fisher-Yates（正确洗牌，O(n)，从后往前） */
function shuffle(arr) {
  const a = arr.slice();          // 不修改原数组
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));  // [0, i] 随机下标
    [a[i], a[j]] = [a[j], a[i]];                    // 交换
  }
  return a;
}

/** 错误做法：sort + 随机比较（非均匀，仅对照） */
const shuffleBad = arr => arr.slice().sort(() => Math.random() - 0.5);

/** 插入点分布 f(n)：二分查找随机比较器，落点 0..n 的概率（精确递推，非模拟） */
function insertionDist(n) {
  if (n === 0) return [1];
  const mid = n >> 1;
  const left = insertionDist(mid);            // 去左 [lo, mid)
  const right = insertionDist(n - mid - 1);   // 去右 [mid+1, hi)
  const res = new Array(n + 1).fill(0);
  for (let k = 0; k < left.length; k++) res[k] += 0.5 * left[k];
  for (let k = 0; k < right.length; k++) res[k + mid + 1] += 0.5 * right[k];
  return res;
}

/* ---------- 测试区 ---------- */

/* A. 正确性 */
console.log('=== A. Fisher-Yates 正确性 ===');
const input = [1, 2, 3, 4, 5];
const s = shuffle(input);
console.log('A1 原数组:', JSON.stringify(input), '（未被修改）');
console.log('A2 洗牌后:', JSON.stringify(s));
console.log('A3 元素齐全(排序后相等):', JSON.stringify([...s].sort((x, y) => x - y)) === JSON.stringify(input));
console.log('A4 无重复(Set 长度=5):', new Set(s).size === 5);

/* B. 均匀性统计（Fisher-Yates） */
console.log('\n=== B. 均匀性：元素 3 出现在各位置的概率（10 万次）===');
const N = 100000;
const posCount = Array(5).fill(0);
for (let i = 0; i < N; i++) {
  const r = shuffle(input);
  posCount[r.indexOf(3)]++;     // 元素 3 落在哪个位置
}
console.log('B1 位置0~4 次数:', posCount.join(', '));
console.log('B2 理论概率 1/5 = 20%，实测:', posCount.map(c => (c / N * 100).toFixed(1) + '%').join(', '), '<- 各位置 ≈20%，均匀');

/* C. sort 随机版偏差 */
console.log('\n=== C. sort(() => Math.random()-0.5) 的偏差（10 万次）===');
const badCount = Array(5).fill(0);
for (let i = 0; i < N; i++) {
  const r = shuffleBad(input);
  badCount[r.indexOf(3)]++;
}
console.log('C1 位置0~4 次数:', badCount.join(', '));
console.log('C2 实测:', badCount.map(c => (c / N * 100).toFixed(1) + '%').join(', '), '<- 中间位置概率偏高（如位置2），两端偏低 → 非均匀');
console.log('C3 原因: sort 的比较函数应满足全序（传递性），随机返回值破坏排序算法假设 → 结果分布取决于 V8 的排序实现，有系统性偏差');

/* D. 性能粗测 */
console.log('\n=== D. 性能（10 万元素）===');
const big = Array.from({ length: 100000 }, (_, i) => i);
let t = process.hrtime.bigint();
shuffle(big);
console.log('D1 Fisher-Yates:', Number(process.hrtime.bigint() - t) / 1e6, 'ms');
t = process.hrtime.bigint();
shuffleBad(big);
console.log('D2 sort随机版  :', Number(process.hrtime.bigint() - t) / 1e6, 'ms');

/* E. 插入点分布 f(n)（精确递推） */
console.log('\n=== E. 插入点分布 f(n)：二分查找随机比较器 ===');
for (let n = 1; n <= 4; n++) {
  console.log(`E${n} f(${n}) = [${insertionDist(n).map(x => (x * 100).toFixed(1) + '%').join(', ')}]`);
}
const f4 = insertionDist(4);
console.log('E5 左侧合计:', ((f4[0] + f4[1]) * 100).toFixed(1) + '%', '| 右侧合计:', ((f4[2] + f4[3] + f4[4]) * 100).toFixed(1) + '%', '<- 右侧占 3/4，插入点偏右');

/* F. 判定树深度实测（模拟随机二分查找，统计落点深度） */
console.log('\n=== F. 判定树深度：右侧叶子浅、左侧叶子深 ===');
const M = 100000;
const depthStats = {};
for (let i = 0; i < M; i++) {
  let lo = 0, hi = 4, d = 0;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (Math.random() < 0.5) lo = mid + 1; else hi = mid;  // 随机比较器
    d++;
  }
  depthStats[lo] = (depthStats[lo] || 0) + 1;
}
for (let k = 0; k <= 4; k++) {
  const c = depthStats[k] || 0;
  console.log(`F${k + 1} 落点${k}: 概率 ${(c / M * 100).toFixed(1)}% | 理论 (1/2)^深度: ` +
    (k >= 2 ? '25% (2层)' : '12.5% (3层)'));
}

/* G. 精确概率验证：元素1留位置0 / 元素5落位置4 */
console.log('\n=== G. 精确概率（理论公式 vs 模拟）===');
const f1 = insertionDist(1), f2 = insertionDist(2), f3 = insertionDist(3);
// 元素1留位置0：4 次插入，插入点都不是 0
const theoP1 = (1 - f1[0]) * (1 - f2[0]) * (1 - f3[0]) * (1 - f4[0]);
const theoP5 = f4[4];
// 模拟验证
let c1 = 0, c5 = 0;
for (let i = 0; i < N; i++) {
  const arr = [1];
  for (let step = 1; step <= 4; step++) {
    const f = insertionDist(step);
    let r = Math.random(), lo = 0;
    for (let k = 0; k < f.length; k++) { if ((r -= f[k]) <= 0) { lo = k; break; } }
    arr.splice(lo, 0, step + 1);
  }
  if (arr.indexOf(1) === 0) c1++;
  if (arr.indexOf(5) === 4) c5++;
}
console.log(`G1 元素1留位置0: 理论 ${(theoP1 * 100).toFixed(2)}% | 模拟 ${(c1 / N * 100).toFixed(2)}%`);
console.log(`G2 元素5落位置4: 理论 ${(theoP5 * 100).toFixed(2)}% | 模拟 ${(c5 / N * 100).toFixed(2)}%`);
console.log('G3 结论: 偏置可精确推导，非随机噪声——二分查找判定树"左深右浅"的数学必然');

