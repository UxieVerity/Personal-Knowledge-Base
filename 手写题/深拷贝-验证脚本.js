/**
 * 深拷贝 - 验证脚本（Node）
 * 运行：node 深拷贝-验证脚本.js
 *
 * 验证 7 件事：
 *  [A] 基础版：对象/数组/嵌套都复制，改副本不影响原对象（真正"深"）
 *  [B] 浅拷贝对照：Object.assign / 展开运算符只复制一层，嵌套仍是引用
 *  [C] 函数/正则/Date：深拷贝后仍可用（基础版丢函数，进阶版保留）
 *  [D] 循环引用：基础版直接爆栈；WeakMap 版能处理
 *  [E] WeakMap 版：循环引用复制后，副本内部也保持环
 *  [F] 原型：deepClone 结果 instanceof 正确（原型链保留）
 *  [G] JSON 序列化的坑：undefined/函数丢、Date 变字符串、NaN 变 null
 *  [H] 函数带自定义属性：默认返回同一引用（属性共享），改进版真正复制
 *  [I] 箭头函数：function 包装会让克隆版可被 new（语义漂移），V3 用箭头包装保持一致
 *  [J] 闭包函数：状态在 [[Environment]] 里无 API 可达，包装只是调用转发 → 状态共享
 */
'use strict';

/* ---------- 基础版（递归，处理不了循环引用） ---------- */
function deepCloneBasic(obj) {
  if (obj === null || typeof obj !== 'object') return obj;   // 原始值直接返回
  const result = Array.isArray(obj) ? [] : {};
  for (const key of Object.keys(obj)) {
    result[key] = deepCloneBasic(obj[key]);                  // 递归复制每一层
  }
  return result;
}

/* ---------- 进阶版（WeakMap 处理循环引用 + 特殊类型） ---------- */
function deepClone(obj, map = new WeakMap()) {
  if (obj === null || typeof obj !== 'object') return obj;
  if (map.has(obj)) return map.get(obj);                     // 循环引用：返回已复制的副本
  let result;
  if (obj instanceof Date) result = new Date(obj);
  else if (obj instanceof RegExp) result = new RegExp(obj.source, obj.flags);
  else if (Array.isArray(obj)) result = [];
  else result = Object.create(Object.getPrototypeOf(obj));   // 保留原型（instanceof 正确）
  map.set(obj, result);                                      // 先登记，再递归（关键顺序）
  for (const key of Object.keys(obj)) {
    result[key] = deepClone(obj[key], map);
  }
  return result;
}

/* ---------- 进阶版 V2（函数也复制：函数带自定义属性时默认实现有坑） ----------
 * 坑：typeof fn === 'function' ≠ 'object'，函数被首行守卫拦截 → 直接返回原函数引用。
 * 函数若挂了自定义属性（缓存/计数器/静态配置），副本和原函数共享这些属性 → 改一个动两个。
 * 修复：函数分支必须放在守卫之前（或守卫改为 typeof !== 'object' && typeof !== 'function'），
 * 用包装函数 + getOwnPropertyDescriptors 复制自有属性（defineProperties 保 descriptors）。
 * 注意：函数属性值若是对象（如 cache Map），要继续递归才真正独立。
 */
function deepCloneV2(obj, map = new WeakMap()) {
  if (typeof obj === 'function') {                           // 先拦函数（守卫之前！）
    if (map.has(obj)) return map.get(obj);                   // 函数自引用（fn.self = fn）也要防环
    const fn = function (...args) { return obj.apply(this, args); };  // 包装：调用转发原函数
    Object.setPrototypeOf(fn, obj);                          // 原型链指向原函数（fn.prototype 链语义不变）
    Object.defineProperties(fn, Object.getOwnPropertyDescriptors(obj)); // 复制自有属性（含 getter/setter）
    map.set(obj, fn);                                        // 先登记再递归属性值
    for (const key of Object.keys(obj)) {
      fn[key] = deepCloneV2(obj[key], map);                  // 属性值是对象时也深拷贝（cache Map 独立）
    }
    return fn;
  }
  if (obj === null || typeof obj !== 'object') return obj;
  if (map.has(obj)) return map.get(obj);
  let result;
  if (obj instanceof Date) result = new Date(obj);
  else if (obj instanceof RegExp) result = new RegExp(obj.source, obj.flags);
  else if (Array.isArray(obj)) result = [];
  else result = Object.create(Object.getPrototypeOf(obj));
  map.set(obj, result);
  for (const key of Object.keys(obj)) {
    result[key] = deepCloneV2(obj[key], map);
  }
  return result;
}

/* ---------- 演示 ---------- */
const log = (...a) => console.log(...a);

/* A. 基础版深拷贝 */
log('=== A. 基础版深拷贝 ===');
const original = {
  name: '播放器', tags: ['WASM', 'H265'], config: { fps: 30, codec: { name: 'hevc' } },
};
const copyBasic = deepCloneBasic(original);
copyBasic.config.codec.name = 'avc';               // 改副本深层
log('A1 原对象深层:', original.config.codec.name, '| 副本深层:', copyBasic.config.codec.name, '← 互不影响（真深拷贝）');
log('A2 结构相同:', JSON.stringify(copyBasic) === JSON.stringify(original) ? '是' : '否');

/* B. 浅拷贝对照 */
log('\n=== B. 浅拷贝对照（Object.assign / 展开）===');
const shallow = { ...original };
shallow.config.codec.name = '被改了';
log('B1 展开运算符改嵌套 → 原对象也被改:', original.config.codec.name, '← 浅拷贝只复制第一层');

/* C. 特殊类型 */
log('\n=== C. 特殊类型（进阶版）===');
const withSpecial = { d: new Date('2026-09-17'), r: /ab+c/gi, fn: () => 42 };
const c2 = deepClone(withSpecial);
log('C1 Date:', c2.d instanceof Date && c2.d.getTime() === withSpecial.d.getTime() ? '✅ 复制成功' : '❌');
log('C2 RegExp:', c2.r instanceof RegExp && c2.r.flags === 'gi' ? '✅ 复制成功' : '❌');
log('C3 函数:', typeof c2.fn, '（函数按引用保留——面试点：函数要不要深拷贝？一般保留引用）');

/* D. 循环引用 */
log('\n=== D. 循环引用 ===');
const cyclic = { name: 'root' };
cyclic.self = cyclic;                                 // 自己引用自己
try {
  deepCloneBasic(cyclic);
  log('D1 基础版: 没爆栈（意外）');
} catch (e) {
  log('D1 基础版 →', e.constructor.name + ':', e.message, '← 无限递归爆栈');
}
const cyclicCopy = deepClone(cyclic);
log('D2 WeakMap 版: 成功，副本自引用:', cyclicCopy.self === cyclicCopy ? '✅ 环保持' : '❌');
log('D3 副本与原对象不是同一个:', cyclicCopy !== cyclic ? '✅' : '❌');

/* E. 原型 */
log('\n=== E. 原型保留 ===');
class Player { constructor() { this.type = 'h265'; } play() { return 'playing'; } }
const p = new Player();
const pCopy = deepClone(p);
log('E1 instanceof Player:', pCopy instanceof Player ? '✅' : '❌', '| play():', typeof pCopy.play);

/* F. 性能粗测 */
log('\n=== F. 性能粗测 ===');
const big = { list: Array.from({ length: 10000 }, (_, i) => ({ i, v: i * 2 })) };
const t0 = Date.now();
const bigCopy = deepClone(big);
log('F1 1 万个对象深拷贝耗时:', Date.now() - t0, 'ms | 副本数量正确:', bigCopy.list.length === 10000 ? '✅' : '❌');

/* G. 面试延伸：深拷贝 vs JSON 序列化 */
log('\n=== G. JSON.parse(JSON.stringify()) 的坑 ===');
const jsonIssue = { a: undefined, b: () => {}, c: new Date(), d: /x/, e: NaN };
const jsonCopy = JSON.parse(JSON.stringify(jsonIssue));
log('G1 undefined/函数被丢弃:', 'a' in jsonCopy ? '❌' : '✅ 丢', '| b 丢:', !('b' in jsonCopy));
log('G2 Date 变字符串:', typeof jsonCopy.c, '| 正则变空对象:', JSON.stringify(jsonCopy.d), '| NaN 变 null:', jsonCopy.e);
log('G3 结论：JSON 深拷贝适合"纯数据"，有函数/Date/undefined/NaN 就得手写');

/* H. 函数带自定义属性（进阶追问点） */
log('\n=== H. 函数带自定义属性：默认版返回引用，V2 真复制 ===');
function fetchData(url) { return `data:${url}`; }
fetchData.cache = new Map([['a', 1]]);                 // 有状态的函数：缓存
fetchData.version = '1.0';                             // 静态配置
fetchData.self = fetchData;                            // 函数自引用（防环测试）

const h1 = deepClone({ fetchData });
log('H1 默认版克隆后 === 原函数:', h1.fetchData === fetchData ? '✅ 是（同一引用）' : '❌');
log('H2 默认版改 version → 原函数跟着变:', (h1.fetchData.version = '2.0', fetchData.version), '← 属性共享的坑');
try { structuredClone({ fetchData }); } catch (e) {
  log('H3 structuredClone(含函数) →', e.constructor.name + ':', e.message.slice(0, 40) + '…');
}

const h2 = deepCloneV2({ fetchData });
log('V1 V2 版是不同函数:', h2.fetchData !== fetchData ? '✅' : '❌');
log('V2 V2 版 version 已复制:', h2.fetchData.version, '| cache 独立:', h2.fetchData.cache !== fetchData.cache ? '✅ Map 也深拷贝' : '❌');
log('V3 V2 版调用转发正常:', h2.fetchData('u1'));
log('V4 V2 版改 calls 不影响原函数:', (h2.fetchData.calls = 99, fetchData.calls === undefined ? '✅ 原函数无此属性' : '❌'));
const h3 = deepCloneV2(fetchData);
log('V5 函数自引用不爆栈:', h3.self === h3 ? '✅ 环保持' : '❌');

/* ---------- 进阶版 V3（区分箭头函数：包装方式必须保持"不可 new"语义） ----------
 * V2 的坑：用 function 包装箭头函数 → 副本多了 prototype、可以被 new！
 * 原箭头 new 会抛 TypeError，克隆版却正常构造 → 行为语义改变。
 * 另：箭头函数词法 this 不受影响（obj.apply 改不了它，恰好无害）。
 * 修复：obj.prototype === undefined（箭头/方法简写/bound）→ 用箭头包装 + 恢复 name；
 *       有 prototype 的普通函数 → 保持 function 包装（可 new）。
 */
function deepCloneV3(obj, map = new WeakMap()) {
  if (typeof obj === 'function') {
    if (map.has(obj)) return map.get(obj);
    let fn;
    if (obj.prototype === undefined) {
      fn = (...args) => obj(...args);                          // 箭头包装：保持不可构造
      Object.defineProperty(fn, 'name', { value: obj.name, configurable: true });
    } else {
      fn = function (...args) { return obj.apply(this, args); }; // 普通函数：保持可 new
      Object.setPrototypeOf(fn, obj);
    }
    Object.defineProperties(fn, Object.getOwnPropertyDescriptors(obj));
    map.set(obj, fn);
    for (const key of Object.keys(obj)) fn[key] = deepCloneV3(obj[key], map);
    return fn;
  }
  if (obj === null || typeof obj !== 'object') return obj;
  if (map.has(obj)) return map.get(obj);
  let result;
  if (obj instanceof Date) result = new Date(obj);
  else if (obj instanceof RegExp) result = new RegExp(obj.source, obj.flags);
  else if (Array.isArray(obj)) result = [];
  else result = Object.create(Object.getPrototypeOf(obj));
  map.set(obj, result);
  for (const key of Object.keys(obj)) {
    result[key] = deepCloneV3(obj[key], map);
  }
  return result;
}

/* I. 箭头函数（追问点：包装不能改变"可不可 new"的语义） */
log('\n=== I. 箭头函数：V2 语义漂移 vs V3 修正 ===');
const arrow = (x) => `arrow:${x}`;
arrow.cache = new Map([['a', 1]]);

const i1 = deepCloneV2(arrow);
log('I1 V2 克隆箭头 → prototype:', typeof i1.prototype, `（原: ${arrow.prototype}）← 凭空多了 prototype`);
try { new i1(); log('I2 V2 new 克隆版 → 竟然成功 ❌（原箭头会抛 TypeError）'); }
catch (e) { log('I2 V2 new 克隆版 →', e.constructor.name); }
try { new arrow(); } catch (e) { log('   对照 new 原箭头 →', e.constructor.name); }

const i2 = deepCloneV3(arrow);
log('I3 V3 prototype 保持 undefined:', i2.prototype === undefined ? '✅' : '❌');
try { new i2(); log('I4 V3 new 克隆 → 没抛 ❌'); }
catch (e) { log('I4 V3 new 克隆 →', e.constructor.name, '✅ 与原函数一致'); }
log('I5 V3 调用/属性:', i2(2), '| cache 独立:', i2.cache !== arrow.cache ? '✅' : '❌');

function Foo(n) { this.n = n; }                                // 普通函数回归测试
const i3 = deepCloneV3(Foo);
log('I6 V3 普通函数仍可 new:', new i3(7).n, '| instanceof:', new i3(8) instanceof Foo ? '✅' : '❌');

/* J. 闭包函数（追问的终点：闭包状态在 [[Environment]] 里，无 API 可达 → 拷不了） */
log('\n=== J. 闭包函数：状态共享，无法真正复制 ===');
function makeCounter() {
  let count = 0;                            // 闭包变量：藏在词法环境，无任何 API 可枚举/访问
  const inc = () => ++count;
  inc.getCount = () => count;               // 自有属性（能复制的那部分）
  return inc;
}
const counter = makeCounter();
counter(); counter();                       // count = 2
const jClone = deepCloneV3(counter);
log('J1 克隆版调用:', jClone(), '→ 原函数 getCount():', counter.getCount(), '← 闭包状态共享（都走原函数的 [[Environment]]）');
log('J2 原函数调用:', counter(), '→ 克隆版 getCount():', jClone.getCount(), '← 双向互通，副本不独立');
// 对照：同样是私有状态，挂在函数属性上就拷得动
function makeCounterProp() { const inc = () => ++inc.count; inc.count = 0; return inc; }
const propCounter = makeCounterProp(); propCounter(); propCounter();
const pc = deepCloneV3(propCounter); pc();
log('J3 对照·状态挂函数属性 → 克隆独立:', pc.count, 'vs 原:', propCounter.count, '✅');
log('J4 结论：闭包状态拷不了（V3 的包装只是"调用转发"，状态仍走原函数）；能拷的只有自有属性');
