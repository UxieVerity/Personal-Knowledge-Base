/**
 * 手写 apply 验证脚本（Node 真实输出）
 * 运行：node apply-验证脚本.js
 *
 * 验证 6 件事：
 *  [A] 基本：指定 this + 数组传参 + 返回值
 *  [B] 经典用法：Math.max.apply 数组取最大 / concat 展平
 *  [C] 类数组 arguments
 *  [D] args 缺省 → 不传参调用（与原生一致）
 *  [E] null/undefined 兜底 + 与原生一致性
 *  [F] 与手写 call 同参对比一致性
 */
'use strict';

/* 手写 apply：与 call 只差参数处理（第二参是数组/类数组，展开传入） */
Function.prototype.myApply = function (ctx, args) {
  ctx = ctx == null ? globalThis : Object(ctx);   // ① null/undefined 兜底 + ② 原始值装箱
  const key = Symbol('myApply');                    // ③ Symbol 唯一键
  Object.defineProperty(ctx, key, {
    value: this,
    enumerable: false,
    configurable: true,
    writable: true,
  });
  const r = ctx[key](...(args == null ? [] : args)); // ④ 展开数组/类数组（缺省 → 空）
  delete ctx[key];
  return r;
};

const log = (...a) => console.log(...a);
const ok = (name, cond) => log((cond ? '✅' : '❌'), name);

/* ---------- A. 基本用法 ---------- */
log('=== A. 基本：指定 this + 数组传参 + 返回值 ===');
const person = { name: '张三' };
function greet(prefix, suffix) { return `${prefix}${this.name}${suffix}`; }
log('A1 手写 apply →', greet.myApply(person, ['你好，', '！']), '（期望 你好，张三！）');
ok('A1 返回正确', greet.myApply(person, ['你好，', '！']) === '你好，张三！');

/* ---------- B. 经典用法：数组操作 ---------- */
log('\n=== B. 经典用法：数组操作 ===');
log('B1 Math.max.apply 数组取最大 →', Math.max.myApply(null, [1, 5, 3, 9, 2]), '（期望 9）');
ok('B1 Math.max 数组', Math.max.myApply(null, [1, 5, 3, 9, 2]) === 9);

const arr = [1, [2, 3], [4, [5]]];
const flat = Array.prototype.concat.myApply([], arr);
log('B2 concat 展平一层 →', JSON.stringify(flat), '（期望 [1,2,3,4,[5]]）');
ok('B2 展平一层', JSON.stringify(flat) === '[1,2,3,4,[5]]');

/* ---------- C. 类数组 arguments ---------- */
log('\n=== C. 类数组 arguments ===');
function collect() { return Array.prototype.slice.myApply(arguments); }
log('C1 slice.apply(arguments) →', JSON.stringify(collect(1, 2, 3)), '（期望 [1,2,3]）');
ok('C1 类数组转数组', JSON.stringify(collect(1, 2, 3)) === '[1,2,3]');

/* ---------- D. args 缺省 ---------- */
log('\n=== D. args 缺省（第二参不传）===');
function argCount() { return arguments.length; }
log('D1 原生 apply 不传 args →', argCount.apply(null), '（期望 0）');
log('D2 手写 apply 不传 args →', argCount.myApply(null), '（期望 0：一致）');
ok('D2 缺省一致', argCount.myApply(null) === argCount.apply(null));

/* ---------- E. null 兜底 + 与原生一致性 ---------- */
log('\n=== E. null 兜底 + 与原生一致性 ===');
const sloppyWho = new Function('return this === globalThis ? "globalThis" : String(this)');
log('E1 非严格 myApply(null) →', sloppyWho.myApply(null), '（期望 globalThis）');
log('E2 非严格 原生 apply(null) →', sloppyWho.apply(null), '（期望 globalThis：一致）');
ok('E3 非严格场景一致', sloppyWho.myApply(null) === sloppyWho.apply(null));

/* ---------- F. 与手写 call 一致性 ---------- */
log('\n=== F. 与手写 call 同参对比 ===');
Function.prototype.myCall = function (ctx, ...args) {
  ctx = ctx == null ? globalThis : Object(ctx);
  const key = Symbol('myCall');
  Object.defineProperty(ctx, key, { value: this, enumerable: false, configurable: true, writable: true });
  const r = ctx[key](...args);
  delete ctx[key];
  return r;
};
const results = [];
for (let i = 0; i < 3; i++) {
  results.push([greet.myCall(person, '同参', i), greet.myApply(person, ['同参', i])]);
}
results.forEach(([c, a], i) => log(`F${i + 1} call=${c} | apply=${a} | 一致=${c === a ? '✅' : '❌'}`));
ok('F4 call/apply 全部一致', results.every(([c, a]) => c === a));
console.log('   ※ 本质：call 和 apply 只差传参方式，其余逻辑完全相同。');
