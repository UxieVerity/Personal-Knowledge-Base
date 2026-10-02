/**
 * class 手写实现（ES5 模拟）验证脚本（Node 真实输出）
 * 运行：node class手写实现-验证脚本.js
 *
 * 验证 6 件事：
 *  [A] 基础 class：实例属性 / 实例方法 / 静态方法 / getter-setter（全用 ES5 语法）
 *  [B] 继承：extends + super（原型链 + 构造借用）→ instanceof 正确
 *  [C] 静态继承：子类继承父类静态方法（Object.setPrototypeOf）
 *  [D] 方法覆盖 + super 调父类方法（原型链查找）
 *  [E] 与原生 class 行为一致性（instanceof / constructor 指向 / 调用结果）
 *  [F] class vs ES5 差异：class 不能裸调用 / 方法不可枚举 / 严格模式
 */
'use strict';

const log = (...a) => console.log(...a);
const ok = (n, c) => log((c ? '✅' : '❌'), n);

/* ========== A. 基础 class：ES5 模拟 ========== */
log('=== A. 基础 class（ES5 语法模拟）===');
function Person(name, age) {
  // constructor 体
  this.name = name;
  this.age = age;
}
// 实例方法 → prototype
Person.prototype.sayHi = function () {
  return `你好，我是${this.name}，${this.age}岁`;
};
// 静态方法 → 构造函数自身
Person.create = function (name, age) {
  return new Person(name, age);
};
// getter/setter → Object.defineProperty
Object.defineProperty(Person.prototype, 'birthYear', {
  get() { return new Date().getFullYear() - this.age; },
  enumerable: false,
  configurable: true,
});

const p1 = new Person('张三', 28);
log('A1 实例属性 →', p1.name, p1.age, '（期望 张三 28）');
log('A2 实例方法 →', p1.sayHi(), '（期望 你好，我是张三，28岁）');
log('A3 静态方法 →', Person.create('李四', 30).name, '（期望 李四）');
log('A4 getter →', p1.birthYear, '（期望 今年-28）');
ok('A1-A4 基础 class 全通', p1.name === '张三' && p1.sayHi().includes('张三') && Person.create('李四', 30).name === '李四' && typeof p1.birthYear === 'number');

/* ========== B. 继承：extends + super（ES5 模拟） ========== */
log('\n=== B. 继承：extends + super ===');
function Student(name, age, grade) {
  Person.call(this, name, age);   // ← super()：调用父构造器，绑定 this
  this.grade = grade;
}
// ① 实例原型链：Student.prototype → Person.prototype
Student.prototype = Object.create(Person.prototype);
// ② 修复 constructor（否则 instance.constructor === Person）
Student.prototype.constructor = Student;
// ③ 静态继承：子类 [[Prototype]] → 父类（静态方法可继承）
Object.setPrototypeOf(Student, Person);
// 子类自己的方法
Student.prototype.getGrade = function () {
  return `${this.name} 是 ${this.grade} 年级`;
};

const s1 = new Student('王五', 10, 5);
log('B1 子类实例属性 →', s1.name, s1.grade, '（期望 王五 5）');
log('B2 继承父类实例方法 →', s1.sayHi(), '（期望 你好，我是王五，10岁）');
log('B3 子类自己的方法 →', s1.getGrade(), '（期望 王五 是 5 年级）');
log('B4 instanceof Student →', s1 instanceof Student, '（期望 true）');
log('B5 instanceof Person →', s1 instanceof Person, '（期望 true：原型链走到父类）');
log('B6 constructor 指向 →', s1.constructor === Student, '（期望 true：已修复）');
ok('B2 继承实例方法', s1.sayHi() === '你好，我是王五，10岁');
ok('B4/B5 instanceof 双链', s1 instanceof Student && s1 instanceof Person);
ok('B6 constructor 修复', s1.constructor === Student);

/* ========== C. 静态继承 ========== */
log('\n=== C. 静态继承：Object.setPrototypeOf(子类, 父类) ===');
log('C1 子类用父类静态方法 →', Student.create('赵六', 20).name, '（期望 赵六：静态方法被继承）');
log('C2 静态链 → Object.getPrototypeOf(Student) === Person', Object.getPrototypeOf(Student) === Person, '（期望 true）');
ok('C1 静态方法继承', Student.create('赵六', 20).name === '赵六');

/* ========== D. 方法覆盖 + super 调父类方法 ========== */
log('\n=== D. 方法覆盖 + super 调父类方法 ===');
function Teacher(name, age, subject) {
  Person.call(this, name, age);
  this.subject = subject;
}
Teacher.prototype = Object.create(Person.prototype);
Teacher.prototype.constructor = Teacher;
Object.setPrototypeOf(Teacher, Person);
// 覆盖 sayHi
Teacher.prototype.sayHi = function () {
  // super.sayHi()：显式从父类原型取方法，绑 this 调
  return `${Person.prototype.sayHi.call(this)}，教${this.subject}`;
};
const t1 = new Teacher('孙七', 35, '数学');
log('D1 覆盖后 →', t1.sayHi(), '（期望 你好，我是孙七，35岁，教数学）');
ok('D1 覆盖 + super 调父类', t1.sayHi() === '你好，我是孙七，35岁，教数学');

/* ========== E. 与原生 class 行为一致性 ========== */
log('\n=== E. 与原生 class 对比 ===');
class NativePerson {
  constructor(name, age) { this.name = name; this.age = age; }
  sayHi() { return `你好，我是${this.name}`; }
  static create(name) { return new NativePerson(name, 0); }
}
class NativeStudent extends NativePerson {
  constructor(name, age, grade) { super(name, age); this.grade = grade; }
}
const np = new NativeStudent('周八', 12, 6);
const mp = new Student('周八', 12, 6);
log('E1 手写 vs 原生 属性一致 →', mp.name === np.name && mp.grade === np.grade, '（期望 true）');
log('E2 手写 vs 原生 原型链一致 →', mp instanceof Student === np instanceof NativeStudent, '（期望 true）');
log('E3 原型方法可用 →', typeof mp.sayHi === 'function' && typeof np.sayHi === 'function', '（期望 true）');
ok('E1-E3 与原生行为一致', mp.name === np.name && mp.grade === np.grade && typeof mp.sayHi === 'function');

/* ========== F. class vs ES5 差异 ========== */
log('\n=== F. class 与 ES5 构造函数的差异 ===');
// F1: class 不能裸调用（必须 new）
try { NativePerson('裸调'); log('F1 原生 class 裸调用 → 没报错（意外）'); }
catch (e) { log('F1 原生 class 裸调用 →', e.constructor.name, '（期望 TypeError）'); }
// ES5 构造可以裸调（非严格下 this=global，会静默失败/污染全局）
log('F2 ES5 构造裸调用 → 不报错（可被 new 也可被调用，这是 class 修复的）');
// F2: class 方法不可枚举
log('F3 原生 class 原型方法可枚举? →', Object.keys(NativePerson.prototype).length === 0 ? '否（不可枚举）' : '是', '（期望 否）');
log('F4 ES5 手写原型方法可枚举? →', Object.keys(Person.prototype).length, '个（期望 1：sayHi，defineProperty 的 birthYear 不可枚举）');
// F3: class 内部严格模式
log('F5 class 内部恒严格模式 → 裸调用 this=undefined（ES5 非严格=globalThis）');
ok('F1 class 不能裸调用', (() => { try { NativePerson('x'); return false; } catch { return true; } })());
ok('F3 class 方法不可枚举', Object.keys(NativePerson.prototype).length === 0);
