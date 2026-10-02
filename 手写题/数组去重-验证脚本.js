/**
 * 数组去重（Unique）验证脚本（Node）
 * 运行：node 数组去重-验证脚本.js
 *
 * 验证 6 件事：
 *  [A] 五种方法结果对比（Set / filter+indexOf / reduce+includes / 双层循环 / 排序相邻）
 *  [B] NaN 陷阱：indexOf 用 ===（NaN!==NaN 去不掉），includes 用 SameValueZero（能去）
 *  [C] 对象数组去重：Set 按引用（不同对象不去重），Map 按 key（按 id 去重）
 *  [D] 原地去重 vs 返回新数组（splice 版改原数组）
 *  [E] 性能粗测：Set / filter / 双层循环
 */
'use strict';

/* ---------- 实现区 ---------- */

/** ① Set（最推荐，一行） */
const uniqueSet = arr => [...new Set(arr)];

/** ② filter + indexOf（NaN 去不掉） */
const uniqueFilter = arr => arr.filter((v, i) => arr.indexOf(v) === i);

/** ③ reduce + includes */
const uniqueReduce = arr => arr.reduce((acc, v) => (acc.includes(v) ? acc : [...acc, v]), []);

/** ④ 双层循环 + splice（原地去重，改原数组） */
function uniqueSplice(arr) {
  for (let i = 0; i < arr.length; i++) {
    for (let j = i + 1; j < arr.length; j++) {
      if (arr[i] === arr[j]) { arr.splice(j, 1); j--; }
    }
  }
  return arr;
}

/** ⑤ 排序相邻去重（改变顺序） */
const uniqueSort = arr => arr.slice().sort().filter((v, i, a) => i === 0 || v !== a[i - 1]);

/** ⑥ Map 按 key 去重（对象数组按 id） */
const uniqueByKey = (arr, key) => [...new Map(arr.map(o => [o[key], o])).values()];

/* ---------- 测试区 ---------- */

/* A. 五种方法结果对比 */
const input = [1, 2, 2, 3, 4, 4, 5, 1];
console.log('=== A. 五种方法对比（[1,2,2,3,4,4,5,1]）===');
console.log('A1 Set        :', JSON.stringify(uniqueSet(input)));
console.log('A2 filter+idx :', JSON.stringify(uniqueFilter(input)));
console.log('A3 reduce+inc :', JSON.stringify(uniqueReduce(input)));
console.log('A4 双层循环    :', JSON.stringify(uniqueSplice(input.slice())), '<- 原地去重，这里用副本');
console.log('A5 排序相邻    :', JSON.stringify(uniqueSort(input)), '<- 改变顺序');
console.log('A6 原数组未动  :', JSON.stringify(input));

/* B. NaN 陷阱 */
console.log('\n=== B. NaN 陷阱 ===');
const withNaN = [NaN, NaN, 1, 2, 2];
console.log('B1 Set        :', JSON.stringify(uniqueSet(withNaN)), '<- NaN 去掉了（SameValueZero）');
console.log('B2 filter+idx :', JSON.stringify(uniqueFilter(withNaN)), '<- NaN 没去掉（indexOf 用 ===，NaN!==NaN）');
console.log('B3 reduce+inc :', JSON.stringify(uniqueReduce(withNaN)), '<- includes 用 SameValueZero，能去');
console.log('B4 解释: indexOf 用 === 比较，NaN !== NaN → 查不到自己；includes/Set 用 SameValueZero，NaN === NaN');

/* C. 对象数组去重 */
console.log('\n=== C. 对象数组去重 ===');
const objs = [{ id: 1, n: 'a' }, { id: 2, n: 'b' }, { id: 1, n: 'a2' }];
console.log('C1 Set(按引用) :', JSON.stringify(uniqueSet(objs).map(o => o.id)), '<- 三个都留（引用不同）');
console.log('C2 Map(按id)   :', JSON.stringify(uniqueByKey(objs, 'id').map(o => o.id)), '<- 按 id 去重，留第一个');

/* D. 原地去重 */
console.log('\n=== D. splice 原地去重 ===');
const orig = [1, 1, 2, 3, 3];
const spliced = uniqueSplice(orig);
console.log('D1 返回:', JSON.stringify(spliced), '| 原数组也被改了:', JSON.stringify(orig), '<- splice 版改原数组');

/* E. 性能粗测 */
console.log('\n=== E. 性能（10 万个元素，一半重复）===');
const big = Array.from({ length: 100000 }, (_, i) => i % 2);
let t = process.hrtime.bigint();
uniqueSet(big);
console.log('E1 Set       :', Number(process.hrtime.bigint() - t) / 1e6, 'ms');
t = process.hrtime.bigint();
uniqueFilter(big);
console.log('E2 filter+idx:', Number(process.hrtime.bigint() - t) / 1e6, 'ms <-- O(n²) 慢');
t = process.hrtime.bigint();
uniqueSplice(big.slice());
console.log('E3 双层循环   :', Number(process.hrtime.bigint() - t) / 1e6, 'ms <-- O(n²) 最慢');
