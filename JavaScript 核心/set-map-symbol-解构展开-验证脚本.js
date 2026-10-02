/**
 * Set / Map / Symbol / 解构 / 展开 验证脚本（Node 真实输出）
 * 运行：node set-map-symbol-解构展开-验证脚本.js
 *
 * 验证 5 大块：
 *  [A] Set：去重 / 迭代 / 与数组互转 / WeakSet
 *  [B] Map：任意键 / 遍历 / 与对象对比 / WeakMap（衔接昨日）
 *  [C] Symbol：唯一性 / 作为属性键 / Symbol.iterator / 内置 Symbol
 *  [D] 解构：数组 / 对象 / 默认值 / 重命名 / 嵌套
 *  [E] 展开：数组 / 对象 / 浅拷贝 / 替代 apply 的场景
 */
'use strict';

const log = (...a) => console.log(...a);
const ok = (n, c) => log((c ? '✅' : '❌'), n);

/* ---------- A. Set ---------- */
log('=== A. Set ===');
const s = new Set([1, 2, 2, 3, 3, 3, '1']);
log('A1 去重 →', JSON.stringify([...s]), '（期望 [1,2,3,"1"]：2 和 "2" 不同，严格相等）');
ok('A1 去重', [...s].length === 4);

// Set 与数组互转
const arr = [1, 2, 2, 3];
const unique = [...new Set(arr)];
log('A2 数组去重 →', JSON.stringify(unique), '（期望 [1,2,3]）');

// 迭代顺序：插入顺序
const s2 = new Set(['b', 'a', 'c']);
log('A3 迭代顺序 = 插入顺序 →', JSON.stringify([...s2]), '（期望 ["b","a","c"]）');

// WeakSet：只能存对象
const ws = new WeakSet();
let wobj = { tag: 'x' };
ws.add(wobj);
log('A4 WeakSet.has →', ws.has(wobj), '（期望 true）');
wobj = null;
if (global.gc) global.gc();
log('A5 弱引用 → 无强引用后条目被 GC（不可遍历）', 'WeakSet 无 size/keys/values');

/* ---------- B. Map ---------- */
log('\n=== B. Map ===');
const m = new Map();
m.set('key', '字符串键');
m.set(42, '数字键');
m.set({ id: 1 }, '对象键');
const symKey = Symbol('s');
m.set(symKey, 'Symbol键');
log('B1 任意类型键 →', m.get(42), '|', m.get('key'), '|', m.has(symKey), '（期望 数字键/字符串键/true）');
ok('B1 任意键', m.get(42) === '数字键' && m.has(symKey));

// 遍历：插入顺序
log('B2 Map 遍历 = 插入顺序 →', JSON.stringify([...m.keys()].map(k => (typeof k === 'symbol' ? 'symbol' : String(k)))), '（期望 ["key","42","[object Object]","symbol"]）');

// Map vs Object
log('B3 Map 优势 → 键任意类型 / 有序 / size 直接取 / 无原型污染');
log('B4 对象键陷阱 → 对象的键会被转成字符串', (() => { const o = {}; o[{}] = 1; o[{}] = 2; return Object.keys(o); })(), '（期望 ["[object Object]"]：两个对象键冲突）');
ok('B4 对象键转字符串', (() => { const o = {}; o[{}] = 1; o[{}] = 2; return Object.keys(o).length === 1; })());

// WeakMap（衔接昨日）
const wm = new WeakMap();
let wkey = {};
wm.set(wkey, 'data');
log('B5 WeakMap 弱引用 →', wm.has(wkey), '（期望 true；无强引用后被 GC）');

/* ---------- C. Symbol ---------- */
log('\n=== C. Symbol ===');
const sym1 = Symbol('desc');
const sym2 = Symbol('desc');
log('C1 唯一性（同描述也不同）→', sym1 === sym2, '（期望 false）');
ok('C1 Symbol 唯一', sym1 !== sym2);

// 作为属性键
const objS = {};
objS[sym1] = '隐藏属性';
objS.normal = '普通属性';
log('C2 Symbol 键不进 Object.keys →', JSON.stringify(Object.keys(objS)), '（期望 ["normal"]）');
log('C3 Symbol 键可用 Object.getOwnPropertySymbols 拿到 →', Object.getOwnPropertySymbols(objS).length, '（期望 1）');
ok('C2 Symbol 键隐藏', Object.keys(objS).length === 1);
ok('C3 可单独枚举', Object.getOwnPropertySymbols(objS).length === 1);

// Symbol.iterator：让对象可迭代
const iterable = { a: 1, b: 2 };
iterable[Symbol.iterator] = function* () { yield* Object.values(this); };
log('C4 自定义迭代器 →', [...iterable], '（期望 [1,2]）');
ok('C4 Symbol.iterator 可迭代', JSON.stringify([...iterable]) === '[1,2]');

// 内置 Symbol
log('C5 内置 Symbol →', 'Symbol.iterator =', typeof Symbol.iterator, '| Symbol.toStringTag =', typeof Symbol.toStringTag);

/* ---------- D. 解构 ---------- */
log('\n=== D. 解构 ===');
const [d1, d2] = [10, 20];
log('D1 数组解构 →', d1, d2, '（期望 10 20）');
const [x1, , x3] = [1, 2, 3];
log('D2 跳位 →', x1, x3, '（期望 1 3）');
const { name: n, age } = { name: '张三', age: 28 };
log('D3 对象解构 + 重命名 →', n, age, '（期望 张三 28）');
const { a: aa = 100 } = {};           // 默认值
log('D4 默认值 →', aa, '（期望 100）');
const [q, ...rest] = [1, 2, 3, 4];
log('D5 rest 剩余 →', q, JSON.stringify(rest), '（期望 1 [2,3,4]）');
const { u: { v } } = { u: { v: 42 } };
log('D6 嵌套 →', v, '（期望 42）');
// 经典场景：交换变量
let sx = 1, sy = 2;
[sx, sy] = [sy, sx];
log('D7 交换变量 →', sx, sy, '（期望 2 1）');
ok('D3 重命名', n === '张三' && age === 28);
ok('D4 默认值', aa === 100);
ok('D7 交换', sx === 2 && sy === 1);

/* ---------- E. 展开 ---------- */
log('\n=== E. 展开 ===');
const eArr = [1, 2, 3];
log('E1 数组展开 →', Math.max(...eArr), '（期望 3：替代 apply 场景）');
ok('E1 展开替代 apply', Math.max(...eArr) === Math.max.apply(null, eArr));

const merged = [...[1, 2], ...[3, 4]];
log('E2 数组合并 →', JSON.stringify(merged), '（期望 [1,2,3,4]）');

const o1 = { x: 1, y: 2 };
const o2 = { ...o1, z: 3 };
log('E3 对象展开（浅拷贝+扩展）→', JSON.stringify(o2), '（期望 {"x":1,"y":2,"z":3}）');
ok('E3 对象展开', o2.x === 1 && o2.y === 2 && o2.z === 3);

// 浅拷贝：嵌套对象是引用
const nested = { list: [1] };
const shallow = { ...nested };
nested.list.push(2);
log('E4 浅拷贝（嵌套共享引用）→', shallow.list, '（期望 [1,2]：共享同一个数组）');
ok('E4 浅拷贝语义', shallow.list === nested.list);

// 展开 vs concat
log('E5 展开替代 concat →', JSON.stringify([...eArr, ...[4, 5]]), '（期望 [1,2,3,4,5]）');
