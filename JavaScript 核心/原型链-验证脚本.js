// 原型与原型链 —— 核心机制验证脚本
// 结论先行：
//   ① 每个对象都有 __proto__（内部 [[Prototype]]），指向其构造函数的 prototype 对象；
//   ② 访问属性时沿 __proto__ 链向上查找（对象自身 → 原型 → 原型的原型 → ... → null）；
//   ③ 函数有 prototype 属性（new 时作为实例的 [[Prototype]]），箭头函数没有；
//   ④ constructor 是 prototype 上的属性，指回构造函数本身。
//
// 运行：node "原型链-验证脚本.js"
console.log('========== 一、prototype / __proto__ / constructor 三角关系 ==========');

function Person(name) {
  this.name = name;
}
Person.prototype.sayHi = function () { return 'Hi, I am ' + this.name; };

const p = new Person('张三');

console.log('[1] p.__proto__ === Person.prototype ?', p.__proto__ === Person.prototype);
console.log('[2] Person.prototype.constructor === Person ?', Person.prototype.constructor === Person);
console.log('[3] p.constructor === Person ?', p.constructor === Person);
console.log('[4] Person.prototype.__proto__ === Object.prototype ?', Person.prototype.__proto__ === Object.prototype);
console.log('[5] Object.prototype.__proto__ === null ?', Object.prototype.__proto__ === null);
console.log('[6] p instanceof Person ?', p instanceof Person);
console.log('[7] p instanceof Object ?', p instanceof Object);
console.log('[8] 对象上没有 sayHi 时，沿原型链找到:', p.sayHi());
console.log('[9] p.hasOwnProperty("name") ?', p.hasOwnProperty('name'), '| hasOwnProperty("sayHi") ?', p.hasOwnProperty('sayHi'), '(sayHi 在原型上，不在自身)');

console.log('\n========== 二、原型链完整路径 ==========');
const chain = [];
let cur = p;
while (cur) {
  chain.push(cur === Person.prototype ? 'Person.prototype' : cur === Object.prototype ? 'Object.prototype' : (cur.constructor ? cur.constructor.name : 'null'));
  cur = cur.__proto__;
}
console.log('[10] p 的原型链:', chain.join(' → '), '→ null');

console.log('\n========== 三、箭头函数没有 prototype ==========');
const arrow = () => {};
console.log('[11] 普通函数有 prototype?', typeof function () {}.prototype);
console.log('[12] 箭头函数 prototype:', arrow.prototype, '(undefined)');
console.log('[13] new 箭头函数会怎样:', (() => { try { new arrow(); return '没报错'; } catch (e) { return e.constructor.name + ': ' + e.message.split('\n')[0]; } })());

console.log('\n========== 四、函数也是对象（有 __proto__ 链） ==========');
console.log('[14] Person.__proto__ === Function.prototype ?', Person.__proto__ === Function.prototype);
console.log('[15] Function.prototype.__proto__ === Object.prototype ?', Function.prototype.__proto__ === Object.prototype);

console.log('\n========== 五、属性遮蔽（shadowing） ==========');
const p2 = new Person('李四');
p2.sayHi = function () { return '我自己定义的 sayHi'; };
console.log('[16] p2 自身有 sayHi 属性 ?', p2.hasOwnProperty('sayHi'));
console.log('[17] p2.sayHi() =', p2.sayHi(), '| p.sayHi() =', p.sayHi(), '(p2 遮蔽了原型方法，p 没被影响)');

console.log('\n========== 六、instanceof 与 Symbol.hasInstance ==========');
class MyArray extends Array {}
const ma = new MyArray(1, 2, 3);
console.log('[18] ma instanceof MyArray ?', ma instanceof MyArray);
console.log('[19] ma instanceof Array ?', ma instanceof Array, '(原型链包含 Array.prototype)');
console.log('[20] Array.isArray(ma) ?', Array.isArray(ma));

console.log('\n========== 七、Object.create 指定原型 ==========');
const proto = { greet: () => 'hello' };
const obj = Object.create(proto);
console.log('[21] obj.__proto__ === proto ?', obj.__proto__ === proto);
console.log('[22] obj.greet() =', obj.greet(), '(来自原型)');
console.log('[23] obj.hasOwnProperty("greet") ?', obj.hasOwnProperty('greet'));
