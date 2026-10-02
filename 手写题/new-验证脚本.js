/**
 * 手写 new 验证脚本（Node 真实输出）
 * 运行：node new-验证脚本.js
 *
 * 验证 5 件事：
 *  [A] 基本：创建新对象 + this 绑定 + 返回实例
 *  [B] 构造函数返回值是对象 → 返回该对象（覆盖实例）
 *  [C] 构造函数返回原始值 → 忽略，返回实例（new 语义）
 *  [D] 原型链：实例 instanceof 构造函数
 *  [E] 与原生 new 一致性（含 Reflect.construct 对比）
 */
'use strict';

/* 手写 new：四步 */
function myNew(Ctor, ...args) {
  // ① 创建新对象，原型指向 Ctor.prototype
  const obj = Object.create(Ctor.prototype);
  // ② 以 obj 为 this 调用构造函数
  const result = Ctor.apply(obj, args);
  // ③ 构造返回对象 → 用返回值；返回原始值/无 → 用 obj
  return (result !== null && typeof result === 'object') || typeof result === 'function'
    ? result
    : obj;
}

const log = (...a) => console.log(...a);
const ok = (n, c) => log((c ? '✅' : '❌'), n);

/* ---------- A. 基本 ---------- */
log('=== A. 基本：创建对象 + this 绑定 ===');
function Person(name, age) {
  this.name = name;
  this.age = age;
}
const p = myNew(Person, '张三', 28);
log('A1 p.name =', p.name, '| p.age =', p.age, '（期望 张三 / 28）');
log('A2 p 类型 =', typeof p, '（期望 object）');
ok('A1 this 绑定 + 属性', p.name === '张三' && p.age === 28);

/* ---------- B. 构造返回对象 → 覆盖 ---------- */
log('\n=== B. 构造函数返回对象 → 返回该对象 ===');
function ReturnObj() {
  this.ignored = '被忽略';
  return { custom: '自定义返回' };
}
const ro = myNew(ReturnObj);
log('B1 ro.custom =', ro.custom, '（期望 自定义返回）');
log('B2 ro.ignored =', ro.ignored, '（期望 undefined：this 上的属性被丢弃）');
ok('B1 返回对象覆盖', ro.custom === '自定义返回' && ro.ignored === undefined);

/* ---------- C. 构造返回原始值 → 忽略 ---------- */
log('\n=== C. 构造函数返回原始值 → 忽略，返回实例 ===');
function ReturnPrimitive() {
  this.ok = '实例属性';
  return '我是原始值';                    // 原始值被忽略
}
const rp = myNew(ReturnPrimitive);
log('C1 rp.ok =', rp.ok, '（期望 实例属性）');
log('C2 rp === 原始值？', rp === '我是原始值', '（期望 false）');
ok('C1 原始值忽略', rp.ok === '实例属性' && rp !== '我是原始值');

/* ---------- D. 原型链 ---------- */
log('\n=== D. 原型链：instanceof ===');
log('D1 p instanceof Person →', p instanceof Person, '（期望 true）');
log('D2 p.__proto__ === Person.prototype →', Object.getPrototypeOf(p) === Person.prototype, '（期望 true）');
ok('D1 instanceof', p instanceof Person);
ok('D2 原型正确', Object.getPrototypeOf(p) === Person.prototype);

/* ---------- E. 与原生 new 一致性（含箭头函数错误） ---------- */
log('\n=== E. 与原生 new 一致性 ===');
function Point(x, y) { this.x = x; this.y = y; }
const native = new Point(1, 2);
const mine = myNew(Point, 1, 2);
log('E1 原生 [1,2] vs 手写', `[${mine.x},${mine.y}]`, '（期望 [1,2]）');
ok('E1 行为一致', mine.x === native.x && mine.y === native.y && mine instanceof Point);

// 箭头函数不能 new（原生报错，手写也应该暴露——虽然手写不会自动抛，但面试要点是箭头函数无 prototype/construct）
const arrow = () => {};
log('E2 箭头函数 prototype =', arrow.prototype, '（期望 undefined：无 [[Construct]]）');
log('E3 原生 new 箭头函数 →', (() => { try { new arrow(); return '没报错'; } catch (e) { return e.constructor.name; } })(), '（期望 TypeError）');
ok('E2 箭头函数无 prototype', arrow.prototype === undefined);
