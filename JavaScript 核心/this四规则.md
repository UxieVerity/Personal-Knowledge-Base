# this 四规则

> **结论：`this` 不是「定义时」决定的，而是「调用时」由调用方式决定的动态绑定。四规则按优先级：① new 绑定 > ② 显式绑定（call/apply/bind）> ③ 隐式绑定（`obj.fn()`）> ④ 默认绑定（裸调用：非严格 `globalThis` / 严格 `undefined`）。箭头函数是个例外——它没有自己的 this，永远取「定义处外层词法环境」的 this，四规则对它全部失效，call/apply/bind 也改不动。**
>
> 可运行验证：[[this四规则-验证脚本.js]]（Node 实测：四规则 / 优先级 / 箭头函数 / 严格 vs 非严格）

---

## 1. 一句话定义（背诵版）

**this = 调用方式决定，不是定义位置决定。**

| 规则 | 触发方式 | this 指向 | 优先级 |
| ---- | ---- | ---- | ---- |
| ④ 默认绑定 | `fn()` 裸调用 | 非严格 `globalThis` / 严格 `undefined` | 最低 |
| ③ 隐式绑定 | `obj.fn()` 属性访问调用 | **调用者 obj** | 中 |
| ② 显式绑定 | `call/apply/bind` | 传入的目标 | 高 |
| ① new 绑定 | `new Fn()` | **新建对象** | **最高** |
| 箭头函数 | 任何方式 | 定义处外层词法 this（无自己的 this） | 例外 |

## 2. 四规则详解（实测）

### ④ 默认绑定：裸调用

```js
function defSloppy() { return this; }        // 非严格：globalThis（Node）/ window（浏览器）
function defStrict() { 'use strict'; return this; }  // 严格：undefined
```

实测：
```
[A1] 非严格函数裸调用 → globalThis（Node CJS）
[A2] 严格函数裸调用 → undefined
```

**面试要点**：模块/类默认严格（ES Module 恒严格），所以**裸调用的 this 大概率是 undefined**；ESM 里顶层 this 是 `undefined`，CJS 顶层 this 是 `module.exports`。

### ③ 隐式绑定：obj.fn()

```js
const obj = { name: '隐式对象', fn() { return this; } };
obj.fn() === obj;          // true：this = 调用者
const stolen = obj.fn;
stolen() === globalThis;   // true：方法被取走，绑定丢失，回默认绑定
```

实测：
```
[B1] obj.fn() === obj ? true
[B2] 取走后裸调用 → globalThis（绑定丢失，回默认绑定）
```

**经典坑（必考）**：`const fn = obj.fn; fn()` 的 this 不是 obj——**隐式绑定只在「通过对象属性访问」调用时生效**。取出来裸调用就丢了。React 类组件里 `onClick={this.handleClick}` 不 bind 就报错，就是这个原因。

### ② 显式绑定：call / apply / bind

```js
const target = { name: '显式目标' };
who.call(target, 'call');    // 显式目标+call  立即执行，逐个传参
who.apply(target, ['apply']);// 显式目标+apply 立即执行，数组传参
who.bind(target)('bind');    // 显式目标+bind  返回新函数，this 永久固定
```

实测：
```
[C1] call → 显式目标+call
[C2] apply → 显式目标+apply
[C3] bind → 显式目标+bind
```

详细对比见 [[call、apply、bind 详解]]。

### ① new 绑定：优先级最高

```js
function Person(name) { this.name = name; }
const BoundPerson = Person.bind({ name: 'bind固定' });
const p = new BoundPerson('new创建');
p.name;        // 'new创建' —— new 新建对象，忽略 bind 的 this
p === fixed;   // false
```

实测：
```
[D1] bind 后 new → name = new创建（new 优先于 bind 的 this）
[D2] new 结果 === bind 对象？ false（new 新建对象）
[D3] 显式 call 覆盖隐式 → 显式目标（显式 > 隐式）
```

**为什么 new 优先**：new 的语义是「构造一个全新对象并绑定到 this」——如果允许 bind 覆盖，`new` 构造出来的对象就没有意义了。所以规范规定：**可调用对象若带 `[[Construct]]`（普通函数可 new），new 时使用新对象，忽略 bind 的 this**。这也是手写 bind 必须处理 new 的原因（见 [[call、apply、bind 详解]] §5 D5）。

### 箭头函数：四规则全部失效

```js
const arrow = { name: '箭头', fn: () => this };  // 箭头 this = 定义处外层（模块顶层）
arrow.fn.call(target) === target;  // false：改不动
```

实测：
```
[E1] 箭头.call(target) 改不动 → ✅仍是定义处 this
[E2] 箭头函数 this === 模块顶层 this？ true
[E3] 方法内箭头函数 → 继承this（箭头继承外层函数的动态 this）
```

**箭头函数的 this 规则**：创建时捕获外层词法环境的 `this`（类似闭包捕获变量），之后**永远不变**——call/apply/bind 都改不了（`[E1]`）。**方法内箭头函数**继承外层普通函数的动态 this（`[E3]`），这是 React 类组件 `onClick={() => this.handleClick()}` 能工作的原理。

## 3. 优先级汇总（背诵）

> **new > 显式(bind/call/apply) > 隐式(obj.fn()) > 默认(裸调用)**；箭头函数无 this，全失效。

```
[F1] new > 显式(bind) > 隐式(obj.fn()) > 默认(裸调用)
[F2] 箭头函数：以上四规则全部失效，this 取定义处外层词法环境
```

## 4. 为什么这么设计

- **为什么 this 是动态绑定**：JS 的设计目标是「函数可被任意对象借用」——一个方法可以挂在任何对象上复用（如 `Array.prototype.slice.call(arguments)`）。如果 this 在定义时固定，就无法借用。**动态绑定 = 函数与方法解耦**。
- **为什么有优先级**：绑定方式可能叠加（`obj.fn.call(target)` = 隐式 + 显式）。规则必须有确定次序，否则代码无法预测。**new 最高**是因为构造语义不可违背（见上）；**显式 > 隐式**是因为显式是「用户明确指定」，理应覆盖「调用位置恰好是属性访问」这种巧合。
- **为什么箭头函数特殊**：回调场景（定时器、事件、Promise）里「调用者」经常不是想要的 this。箭头函数用**词法捕获**解决——不再有动态 this，写回调永远不会踩「this 丢失」的坑。代价是它不能做构造函数、没有 `arguments`、不能动态绑定。

## 5. 高频追问速答

| 问题 | 一句话答案 |
| ---- | ---- |
| this 到底怎么定？ | 调用方式决定：new / 显式 / 隐式 / 默认，优先级从高到低 |
| 默认绑定严格 vs 非严格？ | 非严格 `globalThis`（浏览器 window）；严格 `undefined` |
| 隐式绑定丢失？ | `const fn = obj.fn; fn()` 裸调用 → 回默认绑定（this 丢失） |
| 显式和隐式谁优先？ | 显式（call/apply/bind 用户明确指定） |
| new 和 bind 谁优先？ | new——构造语义不可违背 |
| 箭头函数 this？ | 定义处外层词法 this，四规则全失效，call/apply 改不动 |
| 方法内箭头函数？ | 继承外层普通函数的动态 this（React 回调常用） |
| 模块顶层 this？ | ESM 恒 `undefined`；CJS 顶层是 `module.exports` |

## 6. 面试速记（30 秒版）

> **this 是调用时动态绑定，优先级：new > 显式(call/apply/bind) > 隐式(obj.fn()) > 默认(裸调用)。** 默认绑定非严格 = `globalThis`、严格 = `undefined`；隐式绑定只在「属性访问调用」生效，`const fn = obj.fn; fn()` 就丢了；**new 优先于 bind**（构造语义不可违背）；**箭头函数无 this**，取定义处外层词法 this，call/apply/bind 改不动——方法内箭头函数继承外层动态 this，是 React 回调不丢 this 的原理。

> 关联笔记：[[call、apply、bind 详解]]（显式绑定三兄弟） · [[闭包与作用域链、执行上下文]]（this 与执行上下文） · [[原型与原型链、继承]]（new 绑定与构造） · [[call]]（手写 call 用隐式绑定实现显式绑定） · [[面试复习准备计划]]（W2 周一）
