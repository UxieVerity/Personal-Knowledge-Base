/**
 * Object.create 手写验证脚本（Node 真实输出）
 * 运行：node Object.create-验证脚本.js
 *
 * 验证 5 件事：
 *  [A] 基本：新对象原型指向 proto
 *  [B] props 第二参：defineProperties 定义属性
 *  [C] null 原型：Object.create(null)（无原型对象）
 *  [D] 与原生一致性（原型/属性/instanceof）
 *  [E] 手写原理：临时构造函数 F，F.prototype = proto
 */
'use strict';

/* 手写 Object.create：临时构造函数桥接原型 */
Object.myCreate = function (proto, props) {
  if (proto !== null && typeof proto !== 'object') {
    throw new TypeError('proto 必须是对象或 null');
  }
  function F() {}                        // ① 临时构造函数
  F.prototype = proto;                    // ② 原型指向 proto
  const obj = new F();                    // ③ new 一个对象（原型链已接好）
  if (props) Object.defineProperties(obj, props);  // ④ 定义属性（可选）
  return obj;
};

const log = (...a) => console.log(...a);
const ok = (n, c) => log((c ? '✅' : '❌'), n);

/* ---------- A. 基本：原型指向 ---------- */
log('=== A. 基本：新对象原型指向 proto ===');
const animal = { speak() { return '动物叫'; } };
const dog = Object.myCreate(animal);
log('A1 dog.speak() →', dog.speak(), '（期望 动物叫：从原型继承）');
log('A2 Object.getPrototypeOf(dog) === animal →', Object.getPrototypeOf(dog) === animal, '（期望 true）');
ok('A1 原型方法继承', dog.speak() === '动物叫');
ok('A2 原型正确', Object.getPrototypeOf(dog) === animal);

/* ---------- B. props 第二参 ---------- */
log('\n=== B. props 第二参：定义属性 ===');
const objB = Object.myCreate(animal, {
  name: { value: '旺财', writable: true, enumerable: true },
  age: { value: 3, enumerable: true },
});
log('B1 objB.name =', objB.name, '（期望 旺财）');
log('B2 Object.keys(objB) =', JSON.stringify(Object.keys(objB)), '（期望 ["name","age"]）');
ok('B1 props 属性', objB.name === '旺财' && objB.age === 3);

/* ---------- C. null 原型：手写版的经典局限 ---------- */
log('\n=== C. null 原型：new 桥接法的经典局限 ===');
const nullProto = Object.myCreate(null);
const nativeNull = Object.create(null);
log('C1 手写版原型 =', Object.getPrototypeOf(nullProto) === null ? 'null' : 'Object.prototype', '（期望 Object.prototype：new 桥接法做不到 null 原型）');
log('C2 原生版原型 =', Object.getPrototypeOf(nativeNull) === null ? 'null' : 'Object.prototype', '（期望 null）');
log('C3 手写版有 toString →', typeof nullProto.toString, '（期望 function：fallback 到 Object.prototype）');
log('C4 原生版无 toString →', nativeNull.toString, '（期望 undefined）');
ok('C1 手写版 fallback 到 Object.prototype', Object.getPrototypeOf(nullProto) !== null);
ok('C2 原生版才是真 null 原型', Object.getPrototypeOf(nativeNull) === null);
console.log('   ※ 面试追问点：为什么手写 new 桥接法做不了 Object.create(null)？');
console.log('     new F() 时若 F.prototype 不是对象（null），按 new 规则 fallback 到 Object.prototype。');
console.log('     原生 Object.create 走内部 [[ObjectCreate]](null)，直接造无原型对象。');
console.log('     这是手写实现的原生边界——知道这个差异比写出代码更显深度。');

/* ---------- D. 与原生一致性 ---------- */
log('\n=== D. 与原生 Object.create 一致性 ===');
const protoD = { greet() { return 'hi'; } };
const nativeD = Object.create(protoD, { x: { value: 1, enumerable: true } });
const mineD = Object.myCreate(protoD, { x: { value: 1, enumerable: true } });
log('D1 原型一致 →', Object.getPrototypeOf(mineD) === Object.getPrototypeOf(nativeD), '（期望 true）');
log('D2 属性一致 →', mineD.x === nativeD.x, '（期望 true）');
log('D3 方法一致 →', mineD.greet() === nativeD.greet(), '（期望 true）');
ok('D1 原型一致', Object.getPrototypeOf(mineD) === Object.getPrototypeOf(nativeD));
ok('D2 属性一致', mineD.x === nativeD.x);
ok('D3 方法一致', mineD.greet() === nativeD.greet());

/* ---------- E. 手写原理说明 ---------- */
log('\n=== E. 手写原理：临时构造函数桥接 ===');
log('E1 本质：new F() 时 F.prototype = proto → 新对象原型链挂到 proto 上');
log('E2 边界：proto 不是对象/null → 抛 TypeError（与原生一致）');
log('E3 面试点：Object.create(proto) 与 {} 的区别 → {} 原型是 Object.prototype，create 可指定任意原型（含 null）');
