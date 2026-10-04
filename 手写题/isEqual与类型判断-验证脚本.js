/**
 * isEqual（深比较）+ 类型判断验证脚本（Node 真实输出）
 * 运行：node isEqual-类型判断-验证脚本.js
 *
 * 验证 6 件事：
 *  [A] 类型判断：typeof 局限（null/数组/Date）→ Object.prototype.toString 精准版
 *  [B] isEqual 基础：原始值 / NaN / -0
 *  [C] isEqual 对象/数组：深比较（嵌套结构）
 *  [D] isEqual 特殊类型：Date / RegExp / 循环引用
 *  [E] 手写 isEqual（递归 + WeakMap 防循环）
 *  [F] 与 JSON.stringify 对比（为什么 JSON 不够）
 */
'use strict';

const log = (...a) => console.log(...a);
const ok = (n, c) => log((c ? '✅' : '❌'), n);

/* ========== 精准类型判断 ========== */
function getType(v) {
  return Object.prototype.toString.call(v).slice(8, -1);  // [object Array] → Array
}

/* ========== 手写 isEqual（深比较，防循环） ========== */
function isEqual(a, b, seen = new WeakMap()) {
  // ① 原始值（含 NaN 特殊处理）
  if (a === b) return true;
  // NaN !== NaN，但 isEqual(NaN, NaN) 应为 true
  if (typeof a === 'number' && typeof b === 'number' && Number.isNaN(a) && Number.isNaN(b)) return true;

  // ② 类型不同直接 false（含 null 和对象区分）
  const ta = getType(a), tb = getType(b);
  if (ta !== tb) return false;

  // ③ 非对象（函数/undefined/symbol）→ 已经 a===b 判断过，这里不相等
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;

  // ④ Date / RegExp 特殊比较
  if (ta === 'Date') return a.getTime() === b.getTime();
  if (ta === 'RegExp') return a.source === b.source && a.flags === b.flags;

  // ⑤ 循环引用检测：同一对对象已经比过 → true（防无限递归）
  if (seen.has(a)) return seen.get(a) === b;
  seen.set(a, b);

  // ⑥ 数组 / 对象：递归比较键值
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if (!b.hasOwnProperty(k)) return false;          // 键缺失
    if (!isEqual(a[k], b[k], seen)) return false;    // 值不等
  }
  return true;
}

/* ---------- A. 类型判断 ---------- */
log('=== A. 精准类型判断（Object.prototype.toString）===');
log('A1 typeof null =', typeof null, '（期望 object：typeof 的坑）');
log('A2 typeof [] =', typeof [], '（期望 object：typeof 分不出数组）');
log('A3 getType(null) =', getType(null), '| getType([]) =', getType([]), '| getType(new Date) =', getType(new Date()));
log('A4 getType({}) =', getType({}), '| getType(/x/) =', getType(/x/), '| getType(()=>{}) =', getType(() => {}));
ok('A3 精准类型', getType(null) === 'Null' && getType([]) === 'Array' && getType(new Date()) === 'Date');
ok('A4 全类型', getType({}) === 'Object' && getType(/x/) === 'RegExp' && getType(() => {}) === 'Function');

/* ---------- B. 原始值 / NaN / -0 ---------- */
log('\n=== B. 原始值 / NaN ===');
log('B1 isEqual(1,1) =', isEqual(1, 1), '（期望 true）');
log('B2 isEqual("a","a") =', isEqual('a', 'a'), '（期望 true）');
log('B3 isEqual(NaN,NaN) =', isEqual(NaN, NaN), '（期望 true：=== 是 false，需特判）');
log('B4 isEqual(1,"1") =', isEqual(1, '1'), '（期望 false：类型不同）');
ok('B1 原始值', isEqual(1, 1) === true);
ok('B3 NaN 特判', isEqual(NaN, NaN) === true);
ok('B4 类型不同', isEqual(1, '1') === false);

/* ---------- C. 对象 / 数组深比较 ---------- */
log('\n=== C. 深比较 ===');
log('C1 isEqual({a:1},{a:1}) =', isEqual({ a: 1 }, { a: 1 }), '（期望 true）');
log('C2 isEqual({a:1},{a:2}) =', isEqual({ a: 1 }, { a: 2 }), '（期望 false）');
log('C3 isEqual({a:{b:[1,2]}},{a:{b:[1,2]}}) =', isEqual({ a: { b: [1, 2] } }, { a: { b: [1, 2] } }), '（期望 true：嵌套）');
log('C4 isEqual([1,2,3],[1,2,3]) =', isEqual([1, 2, 3], [1, 2, 3]), '（期望 true）');
log('C5 isEqual([1,2],[1,2,3]) =', isEqual([1, 2], [1, 2, 3]), '（期望 false：长度不同）');
ok('C1 对象相等', isEqual({ a: 1 }, { a: 1 }) === true);
ok('C3 嵌套相等', isEqual({ a: { b: [1, 2] } }, { a: { b: [1, 2] } }) === true);
ok('C5 长度不同', isEqual([1, 2], [1, 2, 3]) === false);

/* ---------- D. Date / RegExp / 循环引用 ---------- */
log('\n=== D. 特殊类型 + 循环引用 ===');
const d1 = new Date('2024-01-01'), d2 = new Date('2024-01-01'), d3 = new Date('2025-01-01');
log('D1 isEqual(Date,Date同刻) =', isEqual(d1, d2), '（期望 true）');
log('D2 isEqual(Date,Date异刻) =', isEqual(d1, d3), '（期望 false）');
log('D3 isEqual(/ab/g,/ab/g) =', isEqual(/ab/g, /ab/g), '（期望 true）');
log('D4 isEqual(/ab/g,/ab/i) =', isEqual(/ab/g, /ab/i), '（期望 false：flags 不同）');
// 循环引用
const ca = { name: 'a' }; ca.self = ca;
const cb = { name: 'a' }; cb.self = cb;
log('D5 isEqual(循环引用对象) =', isEqual(ca, cb), '（期望 true：WeakMap 防死循环）');
ok('D1 Date 同刻', isEqual(d1, d2) === true);
ok('D2 Date 异刻', isEqual(d1, d3) === false);
ok('D4 RegExp flags', isEqual(/ab/g, /ab/i) === false);
ok('D5 循环引用', isEqual(ca, cb) === true);

/* ---------- E. 为什么 JSON.stringify 不够 ---------- */
log('\n=== E. 为什么 JSON.stringify 不够 ===');
const j1 = { a: 1, b: undefined };        // undefined 属性被 JSON 丢掉
const j2 = { a: 1 };
log('E1 JSON.stringify({a:1,b:undefined}) =', JSON.stringify(j1), '=== JSON.stringify({a:1}) =', JSON.stringify(j2), '→ 误判相等');
log('E2 isEqual 正确 =', isEqual(j1, j2), '（期望 false：b 键缺失）');
// 键顺序不同
const j3 = { a: 1, b: 2 }, j4 = { b: 2, a: 1 };
log('E3 JSON.stringify 键序不同 →', JSON.stringify(j3) === JSON.stringify(j4), '（期望 false：JSON 敏感于键序，误判不等）');
log('E4 isEqual 正确 =', isEqual(j3, j4), '（期望 true：isEqual 不敏感键序）');
// 循环引用 JSON 直接抛错
try { JSON.stringify(ca); log('E5 JSON 循环引用 → 没抛错（意外）'); }
catch (e) { log('E5 JSON 循环引用 →', e.constructor.name, '（期望 TypeError）'); }
ok('E2 JSON 丢 undefined 误判', isEqual(j1, j2) === false);
ok('E4 isEqual 不敏感键序', isEqual(j3, j4) === true);
