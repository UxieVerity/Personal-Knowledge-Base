/**
 * 数组扁平化（Flatten）验证脚本（Node）
 * 运行：node 数组扁平化-验证脚本.js
 *
 * 验证 6 件事：
 *  [A] 递归版 vs 迭代版结果一致
 *  [B] 指定层级 flat(depth) 语义：只拍 N 层，层级用尽保留嵌套
 *  [C] 空位处理：flat 跳过空位
 *  [D] 超深数组（1 万层）：递归版爆栈 vs 迭代版（栈）成功 —— 迭代版的理由
 *  [E] JSON 正则版边界：纯数字可用，含 "[]" 字符串会坏
 *  [F] 性能粗测：递归 / 迭代 / 内置 flat
 */
'use strict';

/* ---------- 实现区 ---------- */

/** 递归版（最直观） */
function flatten(arr) {
  const result = [];
  for (const item of arr) {
    if (Array.isArray(item)) result.push(...flatten(item));
    else result.push(item);
  }
  return result;
}

/** 指定层级版（flat(depth) 语义） */
function flattenDepth(arr, depth = Infinity) {
  if (depth <= 0) return arr.slice(); // 层级用尽 → 原样返回（浅拷贝）
  const result = [];
  for (const item of arr) {
    if (Array.isArray(item) && depth > 0) result.push(...flattenDepth(item, depth - 1));
    else result.push(item);
  }
  return result;
}

/** 迭代版（栈，不依赖递归深度） */
function flattenIter(arr) {
  const stack = [...arr];
  const result = [];
  while (stack.length) {
    const item = stack.pop();
    if (Array.isArray(item)) stack.push(...item);
    else result.push(item);
  }
  return result.reverse(); // pop 是倒序取的 → 反转恢复顺序
}

/** 迭代版 + 指定深度（栈元素 = [值, 剩余深度]） */
function flattenDepthIter(arr, depth = Infinity) {
  if (depth <= 0) return arr.slice();
  const stack = arr.map(item => [item, depth]);
  const result = [];
  while (stack.length) {
    const [item, d] = stack.pop();
    if (Array.isArray(item) && d > 0) {
      for (const child of item) stack.push([child, d - 1]);
    } else {
      result.push(item);
    }
  }
  return result.reverse();
}

/* ---------- 测试区 ---------- */

/* A. 递归版 vs 迭代版 */
const input = [1, [2, [3, [4, [5]]]], 6];
console.log('=== A. 递归 vs 迭代 ===');
console.log('A1 递归版: ', JSON.stringify(flatten(input)));
console.log('A2 迭代版: ', JSON.stringify(flattenIter(input)), '<- 两版一致');

/* B. 指定层级 */
const nested = [1, [2, [3, [4]]]];
console.log('\n=== B. 指定层级 flat(depth) ===');
console.log('B1 flat(2):', JSON.stringify(flattenDepth(nested, 2)), '<- 只拍两层，第三层保留');
console.log('B2 flat(3):', JSON.stringify(flattenDepth(nested, 3)), '<- 层级用尽后全平');
console.log('B3 原数组未改动:', JSON.stringify(nested), '<- 返回副本');

/* C. 空位处理 */
console.log('\n=== C. 空位 ===');
console.log('C1 内置 flat 跳过空位:', JSON.stringify([1, , 2, [3, , 4]].flat()));
console.log('C2 for...of 不跳过:', JSON.stringify((() => {
  const r = [];
  for (const item of [1, , 2, [3, , 4]]) r.push(item);
  return r;
})()), '<- 迭代版 for...of 会保留 undefined');

/* D. 超深数组：递归 vs 迭代 */
console.log('\n=== D. 1 万层嵌套（递归 vs 迭代）===');
const deep = [0];
let cursor = deep;
for (let i = 0; i < 10000; i++) {
  cursor.push([]);
  cursor = cursor[cursor.length - 1];
}
try {
  flatten(deep);
  console.log('D1 递归版: 成功');
} catch (e) {
  console.log('D1 递归版 ->', e.constructor.name + ':', e.message, '<- 爆栈');
}
const it = flattenIter(deep);
console.log('D2 迭代版: 成功，长度', it.length, '<- 显式栈不爆栈');

/* E. JSON 正则版边界 */
console.log('\n=== E. JSON 正则版 ===');
const jsonFlat = arr => JSON.parse('[' + JSON.stringify(arr).replace(/\[|\]/g, '') + ']');
console.log('E1 纯数字:', JSON.stringify(jsonFlat([1, [2, [3]]])));
const tricky = ['[2]', 1, [3]]; // 字符串里含 [ ]
try {
  console.log('E2 含字符串"[2]":', JSON.stringify(jsonFlat(tricky)), '<- 输出坏掉，只适合纯数字');
} catch (e) {
  console.log('E2 含字符串"[2]":', e.constructor.name, '<- 直接报错');
}

/* F. 性能粗测 */
console.log('\n=== F. 性能（1 万个元素，5 层嵌套）===');
const big = [];
for (let i = 0; i < 10000; i++) big.push([i, [i + 1, [i + 2]]]);
let t = process.hrtime.bigint();
flatten(big);
console.log('F1 递归版:', Number(process.hrtime.bigint() - t) / 1e6, 'ms');
t = process.hrtime.bigint();
flattenIter(big);
console.log('F2 迭代版:', Number(process.hrtime.bigint() - t) / 1e6, 'ms');
t = process.hrtime.bigint();
big.flat(Infinity);
console.log('F3 内置flat:', Number(process.hrtime.bigint() - t) / 1e6, 'ms');

/* G. 迭代版 + 指定深度（与递归版 flattenDepth 对照） */
console.log('\n=== G. 迭代版指定深度 flattenDepthIter ===');
const deepG = [1, [2, [3, [4]]]];
console.log('G1 depth=2:', JSON.stringify(flattenDepthIter(deepG, 2)), '| 递归版:', JSON.stringify(flattenDepth(deepG, 2)), '<- 一致');
console.log('G2 depth=1:', JSON.stringify(flattenDepthIter(deepG, 1)), '| 递归版:', JSON.stringify(flattenDepth(deepG, 1)), '<- 一致');
console.log('G3 depth=0:', JSON.stringify(flattenDepthIter(deepG, 0)), '<- 返回副本，原样');
console.log('G4 1万层+depth大:',
  (() => { const r = flattenDepthIter(deep, 20000); return '成功，长度 ' + r.length; })(),
  '<- 超深也不爆栈');
