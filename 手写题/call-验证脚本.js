/**
 * 手写 call 验证脚本（Node 真实输出）
 * 运行：node call-验证脚本.js
 *
 * 验证 6 件事：
 *  [A] 基本：指定 this + 逐个传参 + 返回值
 *  [B] null/undefined 兜底：非严格函数 → globalThis（与原生一致）；严格函数 → 差异（追问点）
 *  [C] 原始值 this 装箱：Object(42) → Number 对象（与原生一致）
 *  [D] 不覆盖原属性（Symbol key + 不可枚举）
 *  [E] 用完清理（delete，无残留）
 *  [F] 与原版 call 行为一致性对照
 */
'use strict';

/* 手写 call：把函数临时挂到目标 this 上调用，用完删除 */
Function.prototype.myCall = function (ctx, ...args) {
  ctx = ctx == null ? globalThis : Object(ctx);  // ① null/undefined 兜底 + ② 原始值装箱
  const key = Symbol('myCall');                    // ③ Symbol 唯一键，不覆盖原属性
  Object.defineProperty(ctx, key, {                // ④ 不可枚举：for...in / Object.keys 看不到
    value: this,
    enumerable: false,
    configurable: true,
    writable: true,
  });
  const r = ctx[key](...args);                    // ⑤ 以 ctx 为 this 调用
  delete ctx[key];                                // ⑥ 用完清理
  return r;                                       // ⑦ 透传返回值
};

const log = (...a) => console.log(...a);
const ok = (name, cond) => log((cond ? '✅' : '❌'), name);

/* ---------- A. 基本用法 ---------- */
log('=== A. 基本：指定 this + 传参 + 返回值 ===');
const person = { name: '张三' };
function greet(prefix, suffix) { return `${prefix}${this.name}${suffix}`; }
log('A1 手写 call →', greet.myCall(person, '你好，', '！'), '（期望 你好，张三！）');
ok('A1 返回正确', greet.myCall(person, '你好，', '！') === '你好，张三！');

/* ---------- B. null/undefined 兜底 ---------- */
log('\n=== B. null / undefined 兜底 ===');
// new Function 构造的是「非严格函数」（除非体内写 'use strict'）
const sloppyWho = new Function('return this === globalThis ? "globalThis" : String(this)');
const strictWho = function () { return this === globalThis ? 'globalThis' : String(this); }; // 模块级 = 严格

log('B1 非严格函数 myCall(null) →', sloppyWho.myCall(null), '（期望 globalThis）');
log('B2 非严格函数 原生 call(null) →', sloppyWho.call(null), '（期望 globalThis：一致）');
log('B3 严格函数 原生 call(null) →', strictWho.call(null), '（期望 null：严格模式不兜底）');
log('B4 严格函数 myCall(null) →', strictWho.myCall(null), '（期望 globalThis：手写固定非严格语义 ← 差异点）');
ok('B5 非严格场景下与原生一致', sloppyWho.myCall(null) === sloppyWho.call(null));
console.log('   ※ 面试追问：手写版无条件兜底=非严格函数语义；严格模式函数原版 call(null) 保持 null。' +
  ' 要完全一致需检测函数是否严格（fn.caller 已废弃，可用 Function.prototype.toString 看 "use strict"）。');

/* ---------- C. 原始值 this 装箱 ---------- */
log('\n=== C. 原始值 this（装箱：仅非严格函数）===');
// new Function 构造的是非严格函数 → 原生 call(42) 会装箱为 Number 对象
const sloppyTypeOf = new Function('return typeof this');
function strictTypeOf() { 'use strict'; return typeof this; }   // 模块内定义，严格
log('C1 手写 myCall(42) → typeof =', sloppyTypeOf.myCall(42), '（期望 object：装箱）');
log('C2 非严格函数 原生 call(42) → typeof =', sloppyTypeOf.call(42), '（期望 object：一致）');
log('C3 严格函数 原生 call(42) → typeof =', strictTypeOf.call(42), '（期望 number：严格模式不装箱，透传原始值）');
ok('C4 非严格函数场景下与原生一致', sloppyTypeOf.myCall(42) === sloppyTypeOf.call(42));
console.log('   ※ 面试追问：手写版 Object(ctx) 恒装箱=非严格函数语义。严格函数原生 call 不装箱（this 透传原始值）。' +
  ' 原生 call 内部对 this 做 ToObject 与否取决于函数是否严格。');

/* ---------- D. 不覆盖原属性 ---------- */
log('\n=== D. Symbol key 不覆盖 ===');
const obj = { name: '原对象', length: 999 };
function takeLen() { return this.length; }
log('D1 myCall 前 obj.length =', obj.length);
takeLen.myCall(obj);
log('D2 myCall 后 obj.length 仍 =', obj.length, '（期望 999：未被覆盖）');
log('D3 Object.keys(obj) =', JSON.stringify(Object.keys(obj)), '（期望 ["name","length"]：临时键不可枚举）');
ok('D4 原属性未被覆盖', (() => { const o = { length: 999 }; takeLen.myCall(o); return o.length === 999; })());

/* ---------- E. 用完清理 ---------- */
log('\n=== E. 用完删除临时键 ===');
const obj2 = { name: '干净对象' };
greet.myCall(obj2, 'Hi, ', '');
log('E1 调用后残留 Symbol 键 =', JSON.stringify(Object.getOwnPropertySymbols(obj2)), '（期望 []：临时键已删）');
ok('E2 无残留', Object.getOwnPropertySymbols(obj2).length === 0);

/* ---------- F. 行为一致性对照 ---------- */
log('\n=== F. 手写 vs 原生 一致性（10 组交替，同参对比）===');
const pairs = [];
for (let i = 0; i < 5; i++) {
  const native_ = greet.call(person, '同参', i);
  const mine = greet.myCall(person, '同参', i);
  pairs.push([native_, mine]);
}
pairs.forEach(([native_, mine], i) => log(`F${i + 1} 原生=${native_} | 手写=${mine} | 一致=${native_ === mine ? '✅' : '❌'}`));
ok('F6 全部一致', pairs.every(([n, m]) => n === m));
