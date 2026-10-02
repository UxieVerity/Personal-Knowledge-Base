# class 手写实现（ES5 模拟）

> **结论：class 是 ES5「构造函数 + 原型链」的语法糖，手写就是四件事——① 构造函数（实例属性）；② 方法挂 `prototype`（实例方法）；③ 方法挂构造函数自身（静态方法）；④ 继承 = `子类.prototype = Object.create(父类.prototype)` + 构造借用 `父类.call(this)` + `Object.setPrototypeOf(子类, 父类)`（静态继承）。** 实测：手写版与原生 class 行为一致（属性/原型链/instanceof 全对），且能解释 class 三差异——**不能裸调用、方法不可枚举、内部恒严格模式**。
>
> 可运行验证：[[class手写实现-验证脚本.js]]（Node 实测：基础 / 继承 / 静态继承 / super / 与原生一致性 / 三差异）

---

## 1. 一句话定义（背诵版）

**class = 构造函数 + 原型链的语法糖**，手写拆解：

| class 语法 | ES5 等价 |
| ---- | ---- |
| `constructor(...)` | 构造函数本身 |
| `方法名() {}` | `Class.prototype.方法名 = function () {}` |
| `static 方法名() {}` | `Class.方法名 = function () {}` |
| `get/set 属性` | `Object.defineProperty(Class.prototype, '属性', {get, set})` |
| `extends 父类` | `子类.prototype = Object.create(父类.prototype)` + `父类.call(this)` |
| `super(...)` | `父类.call(this, ...)` |
| `super.方法()` | `父类.prototype.方法.call(this)` |
| 静态继承 | `Object.setPrototypeOf(子类, 父类)` |

## 2. 标准实现（面试手写版）

```js
/* ① 基础 class */
function Person(name, age) {
  this.name = name; this.age = age;              // constructor 体
}
Person.prototype.sayHi = function () {           // 实例方法
  return `你好，我是${this.name}`;
};
Person.create = function (name, age) {           // 静态方法
  return new Person(name, age);
};

/* ② 继承 */
function Student(name, age, grade) {
  Person.call(this, name, age);                  // super()：借用父构造器
  this.grade = grade;
}
Student.prototype = Object.create(Person.prototype);  // 原型链
Student.prototype.constructor = Student;              // 修复 constructor
Object.setPrototypeOf(Student, Person);               // 静态继承
```

## 3. 核心机制逐条讲（实测）

### 3.1 实例方法 → prototype（实测 A2）

```js
Person.prototype.sayHi = function () { ... };
```

**为什么**：实例方法要共享、不复制——放 prototype，所有实例通过原型链访问同一份。这正是 [[原型与原型链、继承]] 的核心。

### 3.2 继承三件套（实测 B4-B6）

```js
Student.prototype = Object.create(Person.prototype);  // ① 原型链
Student.prototype.constructor = Student;              // ② 修复 constructor
Object.setPrototypeOf(Student, Person);               // ③ 静态继承
```

实测：
```
[B4] instanceof Student → true     ✅
[B5] instanceof Person → true      ✅ 原型链走到父类
[B6] constructor === Student       ✅ 已修复
[C1] 子类用父类静态方法 → 赵六     ✅ 静态继承生效
[C2] Object.getPrototypeOf(Student) === Person → true ✅
```

**为什么 `Object.create` 而不是 `Student.prototype = Person.prototype`**：
- 直接用 `Person.prototype` → 子类加方法会**污染父类**（共享同一个对象）
- `Object.create(Person.prototype)` 新建一个「原型指向父类原型」的空对象 → 子类方法挂在自己身上，父类不受影响。这正是昨天 [[手写题/Object.create]] 的实战。

**为什么 `Object.setPrototypeOf(Student, Person)`**：`Student.create` 是静态方法，挂在构造函数上。要让 `Student.create` 能用（继承），得让 `Student` 的 `[[Prototype]]` 指向 `Person`——函数也是对象，静态继承就是「构造函数之间的原型链」。这正是昨天 [[Proxy-Reflect-WeakMap]] 里 `Reflect.construct` 的 newTarget 语义（class 继承的 super 内部靠它保持实例属于子类）。

### 3.3 super() 和 super.方法（实测 D1）

```js
Person.call(this, name, age);              // super()：以子类实例为 this 跑父构造
Person.prototype.sayHi.call(this);          // super.方法()：从父原型取方法，绑 this 调
```

实测：
```
[D1] 覆盖后 → 你好，我是孙七，35岁，教数学   ✅ 父类方法 + 子类扩展拼接
```

**super 的本质**：`super()` = 父构造器**借用**（call 指定 this）；`super.方法()` = 从父类原型**显式取方法**再绑 this 调——因为子类原型链上同名方法会遮蔽父类（覆盖），要绕过遮蔽只能显式 `父类.prototype.方法.call(this)`。

## 4. 与原生 class 一致性（实测 E）

```
[E1] 属性一致 → true        ✅
[E2] 原型链一致 → true      ✅
[E3] 原型方法可用 → true    ✅
```

手写版在**功能层面**与原生 class 完全等价。

## 5. class 与 ES5 构造的三差异（实测 F，高频面试题）

| 差异 | 原生 class | ES5 构造函数 | 实测 |
| ---- | ---- | ---- | ---- |
| **裸调用** | ❌ 必须 `new`，裸调抛 TypeError | ✅ 可裸调（非严格 this=global，静默污染） | F1 |
| **方法枚举** | ❌ 方法**不可枚举**（`Object.keys(prototype)` 为空） | ✅ 赋值的方法**可枚举** | F3/F4 |
| **严格模式** | ✅ 内部恒严格（裸调 this=undefined） | ❌ 取决于外部 | F5 |

```
[F1] 原生 class 裸调用 → TypeError
[F3] class 原型方法可枚举? → 否
[F4] ES5 手写原型方法可枚举? → 1 个
```

> **为什么 class 要这三条**：① 防止 `Person('x')` 忘 new 导致的全局污染（ES5 最大坑）；② 方法不该被 `for...in` 枚举（那是数据不是方法）；③ 严格模式避免 this 静默指向全局。这三条是 class 相对 ES5 的「纠错升级」。

## 6. 高频追问速答

| 问题 | 一句话答案 |
| ---- | ---- |
| class 是什么？ | 构造函数 + 原型链的语法糖 |
| 继承怎么手写？ | `子.prototype = Object.create(父.prototype)` + `父.call(this)` + `Object.setPrototypeOf(子, 父)` |
| 为什么 Object.create 不用父.prototype 直接赋值？ | 直接赋值会共享对象，子类加方法污染父类 |
| 为什么修 constructor？ | `Object.create` 后 prototype.constructor 丢了，不修则 `instance.constructor` 指向父类 |
| super() 是什么？ | `父.call(this)`——以子实例为 this 跑父构造 |
| super.方法() 是什么？ | `父.prototype.方法.call(this)`——绕过子类遮蔽取父方法 |
| 静态方法怎么继承？ | `Object.setPrototypeOf(子, 父)`——构造函数之间也走原型链 |
| class 和 ES5 构造的差异？ | class 不能裸调 / 方法不可枚举 / 内部恒严格 |

## 7. 面试速记（30 秒版）

> **class = 语法糖。基础：方法挂 prototype（实例方法）、挂构造函数（静态方法）。继承三件套：`子.prototype = Object.create(父.prototype)`（原型链，防污染）、`子.prototype.constructor = 子`（修复指向）、`Object.setPrototypeOf(子, 父)`（静态继承）。`super()` = `父.call(this)`；`super.方法()` = `父.prototype.方法.call(this)`。** 三差异：**不能裸调**（防全局污染）/ **方法不可枚举** / **内部恒严格**。

> 关联笔记：[[原型与原型链、继承]]（原型链基础） · [[手写题/Object.create]]（继承的钥匙） · [[Proxy-Reflect-WeakMap]]（Reflect.construct 的 newTarget = class 继承 super 内部原理） · [[手写题/new]]（new 四步） · [[this四规则]]（super 里的 this 绑定） · [[面试复习准备计划]]（W2 补充）
