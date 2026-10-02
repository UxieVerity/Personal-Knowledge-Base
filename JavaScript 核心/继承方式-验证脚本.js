// 继承方式 —— 验证脚本（原型链继承 / 构造函数继承 / 组合继承 / 寄生组合继承 / class 继承）
// 结论先行：
//   ① 原型链继承：子.prototype = 父实例 —— 最简单，但引用类型属性被所有实例共享（致命坑）；
//   ② 构造函数继承：子内调 Parent.call(this) —— 属性独立，但方法无法复用（都在自身）；
//   ③ 组合继承：①②结合 —— 属性独立 + 方法复用，但父构造函数被调了 2 次（多余属性）；
//   ④ 寄生组合继承：用 Object.create 切掉第二次调用 —— 目前最完美的 ES5 继承；
//   ⑤ class 继承（extends）：语法糖，内部等价寄生组合继承，且必须 super() 先于 this。
//
// 运行：node "继承方式-验证脚本.js"
console.log('========== 一、原型链继承：子.prototype = 父实例 ==========');
function Animal() { this.colors = ['red', 'green']; }
Animal.prototype.eat = function () { return 'eating'; };
function Dog() {}
Dog.prototype = new Animal();          // 关键：把父实例当原型
Dog.prototype.constructor = Dog;       // 修复 constructor 指向（否则指向 Animal）
const d1 = new Dog();
const d2 = new Dog();
console.log('[1] d1.eat() =', d1.eat(), '(方法来自父原型)');
console.log('[2] d1 instanceof Dog ?', d1 instanceof Dog, '| instanceof Animal ?', d1 instanceof Animal);
d1.colors.push('blue');
console.log('[3] 🚨 引用共享坑: d1.colors 加 blue 后, d2.colors =', d2.colors, '(d1/d2 共享同一个 colors 数组!)');
console.log('[4] d1.hasOwnProperty("colors") ?', d1.hasOwnProperty('colors'), '(colors 在父实例上，不在 d1 自身)');

console.log('\n========== 二、构造函数继承：Parent.call(this) ==========');
function Animal2() { this.colors = ['red', 'green']; }
Animal2.prototype.eat = function () { return 'eating'; };
function Dog2() { Animal2.call(this); }   // 关键：把父的实例属性复制到 this
const e1 = new Dog2();
const e2 = new Dog2();
e1.colors.push('blue');
console.log('[5] e1.colors =', e1.colors, '| e2.colors =', e2.colors, '(✅ 属性独立，互不影响)');
console.log('[6] 🚨 方法不能复用: e1.eat =', typeof e1.eat, '(父原型方法拿不到，undefined!)');
console.log('[7] e1 instanceof Animal2 ?', e1 instanceof Animal2, '(❌ 不是 Animal2 实例!)');

console.log('\n========== 三、组合继承：call + 原型链 ==========');
function Animal3(name) { this.name = name; this.colors = ['red']; }
Animal3.prototype.eat = function () { return this.name + ' eating'; };
function Dog3(name) {
  Animal3.call(this, name);   // 第一次调用父构造函数
}
Dog3.prototype = new Animal3(); // 第二次调用父构造函数（产生多余属性）
Dog3.prototype.constructor = Dog3;
const c1 = new Dog3('旺财');
console.log('[8] c1.eat() =', c1.eat(), '(✅ 方法复用)');
console.log('[9] c1.name =', c1.name, '| c1 instanceof Dog3 ?', c1 instanceof Dog3, '| instanceof Animal3 ?', c1 instanceof Animal3);
console.log('[10] 🚨 父构造被调 2 次: c1 自身有 name, 原型上也有 name（多余）');
console.log('    c1.hasOwnProperty("name") =', c1.hasOwnProperty('name'), '| Dog3.prototype.hasOwnProperty("name") =', Dog3.prototype.hasOwnProperty('name'));

console.log('\n========== 四、寄生组合继承：Object.create 切掉第二次调用 ==========');
function Animal4(name) { this.name = name; this.colors = ['red']; }
Animal4.prototype.eat = function () { return this.name + ' eating'; };
function Dog4(name) {
  Animal4.call(this, name);   // 只调用一次父构造函数
}
// 关键：用 Object.create(父.prototype) 复制原型，而不是 new 父实例
Dog4.prototype = Object.create(Animal4.prototype);
Dog4.prototype.constructor = Dog4;
const d4 = new Dog4('小黑');
console.log('[11] d4.eat() =', d4.eat(), '(✅ 方法复用)');
console.log('[12] d4.hasOwnProperty("name") =', d4.hasOwnProperty('name'), '| Dog4.prototype.hasOwnProperty("name") =', Dog4.prototype.hasOwnProperty('name'), '(✅ 原型上没多余属性)');
console.log('[13] d4 instanceof Dog4 ?', d4 instanceof Dog4, '| instanceof Animal4 ?', d4 instanceof Animal4);
console.log('[14] Dog4.prototype.__proto__ === Animal4.prototype ?', Dog4.prototype.__proto__ === Animal4.prototype);

console.log('\n========== 五、class 继承（ES6 extends） ==========');
class Animal5 {
  constructor(name) { this.name = name; }
  eat() { return this.name + ' eating'; }
}
class Dog5 extends Animal5 {
  constructor(name, breed) {
    super(name);        // 必须先 super() 才能用 this
    this.breed = breed;
  }
  bark() { return '汪汪'; }
}
const d5 = new Dog5('大黄', '金毛');
console.log('[15] d5.eat() =', d5.eat(), '(继承的方法)');
console.log('[16] d5.bark() =', d5.bark(), '(子类自己的方法)');
console.log('[17] d5 instanceof Dog5 ?', d5 instanceof Dog5, '| instanceof Animal5 ?', d5 instanceof Animal5);
console.log('[18] Object.getPrototypeOf(Dog5) === Animal5 ?', Object.getPrototypeOf(Dog5) === Animal5, '(静态方法也能继承)');
console.log('[19] 不调 super 会怎样:', (() => {
  try {
    class Bad extends Animal5 { constructor() { /* 忘调 super */ } }
    new Bad();
    return '没报错';
  } catch (e) { return e.constructor.name + ': ' + e.message.split('\n')[0]; }
})());

console.log('\n========== 六、Object.create 与原型链继承的本质 ==========');
console.log('[20] Object.create(null) 的原型:', Object.getPrototypeOf(Object.create(null)), '(无原型，没有 toString 等)');
console.log('[21] Object.create(null) 有 toString ?', typeof Object.create(null).toString, '(undefined → 真·空对象)');
console.log('[22] 原型链继承 vs class 继承关系: class 是语法糖，底层仍是原型链');
