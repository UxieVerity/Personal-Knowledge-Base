// call/apply/bind 验证脚本
// 运行: node 手写题/call-apply-bind-验证脚本.js (或直接 node 本文件)
// 分 3 大节: A.基本用法 B.差异 C.手写实现 D.边界/易错

const log = (tag, fn) => {
  try {
    console.log(`[${tag}]`, JSON.stringify(fn()));
  } catch (e) {
    console.log(`[${tag}] → 抛错: ${e.constructor.name}: ${e.message.split('\n')[0]}`);
  }
};

// ============ A. 基本用法 ============
console.log('=== A. 基本用法 ===');

const person = { name: '张三' };
function greet(prefix, suffix) {
  return `${prefix}${this.name}${suffix}`;
}

log('A1 call 指定 this + 逐个传参', () => greet.call(person, '你好，', '！'));
log('A2 apply 指定 this + 数组传参', () => greet.apply(person, ['你好，', '！']));
const bound = greet.bind(person, '你好，');
log('A3 bind 返回新函数（不立即执行）', () => typeof bound);
log('A4 bind 之后调用仍带 this 和预置参数', () => bound('！'));

// ============ B. 差异 ============
console.log('\n=== B. 差异 ===');

log('B1 call 传参逐个', () => Math.max.call(null, 1, 5, 3));
log('B2 apply 传参数组', () => Math.max.apply(null, [1, 5, 3]));
log('B3 bind 传参混合（预置 + 调用时）', () => {
  const f = (a, b, c) => a + b + c;
  return f.bind(null, 1, 2)(3);
});
log('B4 不传 this 时严格模式为 undefined / 非严格为 global', () => {
  'use strict';
  function who() { return this; }
  return who.call(undefined) === undefined;
});

// ============ C. 手写实现 ============
console.log('\n=== C. 手写实现 ===');

// C1. 手写 call
Function.prototype.myCall = function (ctx, ...args) {
  ctx = ctx ?? (typeof window !== 'undefined' ? window : globalThis);
  const key = Symbol('fn');
  ctx[key] = this;
  const r = ctx[key](...args);
  delete ctx[key];
  return r;
};
log('C1 手写 call', () => greet.myCall(person, '你好，', '！'));

// C2. 手写 apply
Function.prototype.myApply = function (ctx, args) {
  ctx = ctx ?? (typeof window !== 'undefined' ? window : globalThis);
  const key = Symbol('fn');
  ctx[key] = this;
  const r = ctx[key](...(args || []));
  delete ctx[key];
  return r;
};
log('C2 手写 apply', () => greet.myApply(person, ['你好，', '！']));

// C3. 手写 bind
Function.prototype.myBind = function (ctx, ...pre) {
  const fn = this;
  return function (...args) {
    return fn.apply(ctx, pre.concat(args));
  };
};
log('C3 手写 bind（预置 + 后传）', () => greet.myBind(person, '你好，')('！'));

// ============ D. 边界 / 易错 ============
console.log('\n=== D. 边界 / 易错 ===');

log('D1 数组展平（apply 经典用法）', () => {
  const arr = [1, [2, 3], [4, [5]]];
  return Array.prototype.concat.apply([], arr);
});
log('D2 bind 的 this 不能被后续 call/apply 覆盖（固定 this）', () => {
  const b = greet.bind(person, '你好，');
  return b.call({ name: '李四' }, '！'); // 仍是 张三
});
log('D3 箭头函数 this 固定，call/apply 无效', () => {
  const arrow = () => this;
  return arrow.call({ name: 'X' }) === (typeof globalThis !== 'undefined' ? globalThis : window);
});
log('D4 类数组转数组（slice 经典用法）', () => {
  function collect() { return Array.prototype.slice.call(arguments); }
  return collect(1, 2, 3);
});
log('D5 bind 可被 new（new 优先于 bind 的 this）', () => {
  function Point(x, y) { this.x = x; this.y = y; }
  const BoundPoint = Point.bind(null, 1);
  const p = new BoundPoint(2);
  return [p.x, p.y]; // [1, 2]
});
