# call、apply、bind 详解

> **结论：三兄弟作用相同——改变函数执行时的 `this` 指向。** 区别只在传参和时机：**`call(this, 参数1, 参数2…)` 逐个传参、立即执行**；**`apply(this, 数组)` 以数组/类数组传参、立即执行**；**`bind(this, 预置参数…)` 返回一个新函数（不立即执行），新函数的 `this` 被永久固定，调用时参数 = 预置参数 + 调用时参数。** 手写实现原理都是「把函数临时挂到目标 this 对象上再调用」。箭头函数、`new` 的 this 不可被覆盖。
>
> 可运行验证：[[call-apply-bind-验证脚本.js]]（Node 实测 16 项：基本用法 / 差异 / 手写实现 / 边界易错）

---

## 1. 一句话定义（背诵版）

| | `call` | `apply` | `bind` |
| ---- | ---- | ---- | ---- |
| 传参方式 | **逐个** `(this, a, b…)` | **数组** `(this, [a, b…])` | 预置参数 `(this, a…)` |
| 是否立即执行 | ✅ 立即 | ✅ 立即 | ❌ **返回新函数** |
| this 指向 | 临时 | 临时 | **永久固定** |
| 返回值 | 函数结果 | 函数结果 | **新函数** |

> 面试总纲一句话：**"call/apply 立即执行只差传参方式；bind 返回新函数且 this 永久固定。"**

## 2. 三者的本质区别（实测）

```js
const person = { name: '张三' };
function greet(prefix, suffix) { return `${prefix}${this.name}${suffix}`; }

greet.call(person, '你好，', '！');   // "你好，张三！"  ← 逐个传参，立即执行
greet.apply(person, ['你好，', '！']); // "你好，张三！"  ← 数组传参，立即执行
greet.bind(person, '你好，')('！');    // "你好，张三！"  ← 返回新函数，调用时再传
```

实测：
```
[A1] call 指定 this + 逐个传参 → "你好，张三！"
[A2] apply 指定 this + 数组传参 → "你好，张三！"
[A3] bind 返回新函数（不立即执行）→ "function"
[A4] bind 之后调用仍带 this 和预置参数 → "你好，张三！"
```

**记忆锚点**：`call` = **C**omma（逗号逐个传）；`apply` = **A**rray（数组传）。

## 3. 手写实现（面试必考）

> 原理：**call/apply 就是把函数临时挂到 `this` 对象上再调用，用完删除。** bind 则是返回闭包，闭包内用 apply 调用原函数。

```js
// 手写 call
Function.prototype.myCall = function (ctx, ...args) {
  ctx = ctx ?? globalThis;          // 兜底 this
  const key = Symbol('fn');          // 避免覆盖原属性
  ctx[key] = this;                   // 临时挂载
  const r = ctx[key](...args);       // 以 ctx 为 this 调用
  delete ctx[key];                   // 用完清理
  return r;
};

// 手写 apply（只差参数处理）
Function.prototype.myApply = function (ctx, args) {
  ctx = ctx ?? globalThis;
  const key = Symbol('fn');
  ctx[key] = this;
  const r = ctx[key](...(args || []));
  delete ctx[key];
  return r;
};

// 手写 bind（返回闭包）
Function.prototype.myBind = function (ctx, ...pre) {
  const fn = this;
  return function (...args) {
    return fn.apply(ctx, pre.concat(args)); // 预置参数 + 调用时参数
  };
};
```

实测：
```
[C1] 手写 call → "你好，张三！"
[C2] 手写 apply → "你好，张三！"
[C3] 手写 bind（预置 + 后传）→ "你好，张三！"
```

**面试追问：bind 的手写难点？** ① 要能 `new`（新对象优先于 bind 的 this）；② 预置参数 + 调用时参数要拼接。上面是最简版，完整版还要处理 `new` 的情况（见 §5 D5）。

## 4. 为什么这么设计

- **this 是动态绑定**：函数调用方式决定 this（`obj.fn()` 指向 obj，`fn()` 指向全局/undefined）。但有时你需要**强行指定** this——比如把类数组当数组用、把某个对象的方法借给另一个对象。于是 JS 给了这三个「显式绑定」工具。
- **call vs apply 分开**：历史原因，一个照顾「参数已知逐个传」，一个照顾「参数在数组里（如 `Math.max.apply` 展平数组、`arguments` 类数组）」。ES6 展开符 `...` 出现后 `apply` 的很多场景可被 `call` + 展开替代，但 `apply` 处理类数组仍有一席之地。
- **bind 存在**：因为 call/apply 是「一次性」，而「固定 this 并复用」是高频需求（事件监听、回调函数、React 类组件）。bind 把「绑定 this」延迟成可复用的函数。
- **为什么手写用 Symbol**：用字符串键可能覆盖原对象属性；Symbol 唯一，不会冲突。

## 5. 高频追问速答（实测）

| 问题 | 一句话答案 |
| ---- | ---- |
| call 和 apply 区别？ | 传参方式：call 逐个，apply 数组；都是立即执行 |
| bind 和 call/apply 区别？ | bind 返回新函数不执行、this 永久固定；call/apply 立即执行 |
| 手写 bind 注意什么？ | 预置参数拼接 + 支持 new |
| 数组展平怎么用 apply？ | `Array.prototype.concat.apply([], arr)` → 实测 `[1,[2,3],[4,[5]]]` → `[1,2,3,4,[5]]` |
| 类数组转数组？ | `Array.prototype.slice.call(arguments)` → 实测 `[1,2,3]` |
| bind 后还能被 call 改 this 吗？ | **不能**，bind 的 this 永久固定（实测 D2 仍是"张三"） |
| 箭头函数能被 call/apply 改 this 吗？ | **不能**，箭头函数 this 词法固定（实测 D3 无效） |
| bind 的函数能被 new 吗？ | 能，且 **new 优先**于 bind 的 this（实测 D5 `[1,2]`） |

实测支撑：
```
[D1] 数组展平 apply → [1,2,3,4,[5]]
[D2] bind 的 this 不能被后续 call/apply 覆盖 → "你好，张三！"
[D3] 箭头函数 this 固定，call/apply 无效 → false（改不动）
[D4] 类数组转数组 slice.call(arguments) → [1,2,3]
[D5] bind 可被 new，new 优先于 bind 的 this → [1,2]
```

## 6. 面试速记（30 秒版）

> **call/apply/bind 都是改 this。** call 逐个传参立即执行；apply 数组传参立即执行；bind 返回新函数、this 永久固定、参数预置。**手写原理：把函数临时挂到目标对象上调用（call/apply），bind 返回闭包**。经典用法：`Math.max.apply` 数组取最大、`Array.prototype.slice.call(arguments)` 类数组转数组、bind 固定回调 this。**箭头函数 this 不可改；bind 的 this 不可被 call 覆盖；bind 支持 new 且 new 优先。**

> 关联笔记：[[闭包与作用域链、执行上下文]]（this 绑定） · [[原型与原型链、继承]] · [[JS闭包与作用域-面试速记]] · [[面试复习准备计划]]
