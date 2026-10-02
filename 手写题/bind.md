# 手写 bind（含 new 兼容）

> **结论：`bind` 返回一个新函数，新函数的 this 被永久固定为传入对象，参数 = 预置参数 + 调用时参数。** 手写难点有两个：**① 支持 new**（被 `new` 调用时 this 是新对象、忽略 bind 的 ctx，且实例要 `instanceof` 原函数）；**② length 收缩**（预置 n 个参数 → length 减 n）。实测：用 `new.target` 判断调用方式可实现 new 兼容，普通调用和 new 调用行为都与原生 bind 一致。
>
> 可运行验证：[[bind-验证脚本.js]]（Node 实测：预置参数拼接 / new 兼容 / 原型链 / this 永久固定 / 与原生一致性 / length 收缩）

---

## 1. 一句话定义（背诵版）

`Function.prototype.bind(thisArg, ...presetArgs)` —— **返回一个新函数（不立即执行）**，新函数调用时 this 永远 = thisArg（不可被后续 call/apply 覆盖），参数 = 预置参数 + 调用时参数。**特殊：被 `new` 调用时 this = 新对象（忽略 thisArg）**。

| 维度 | 值 |
| ---- | ---- |
| 时机 | **不立即执行**，返回新函数 |
| this | **永久固定**（不可被 call/apply 覆盖） |
| 参数 | 预置参数 + 调用时参数（预置在前） |
| new | **new 优先**：this = 新对象，忽略固定 this |
| length | 预置 n 个参数 → length 减 n（下限 0） |

## 2. 标准实现（面试手写版 · new 兼容）

```js
Function.prototype.myBind = function (ctx, ...pre) {
  const fn = this;
  const bound = function (...args) {
    // new.target：被 new 调用时为 bound 自身；普通调用为 undefined
    return fn.apply(new.target ? this : ctx, pre.concat(args));
  };
  // 原型链：让 new bound() 的实例继承 fn.prototype（new 场景的 instanceof 正确）
  bound.prototype = Object.create(fn.prototype);
  // length 收缩：预置参数占位后，剩余形参个数（与原生 bind 一致）
  Object.defineProperty(bound, 'length', { value: Math.max(0, fn.length - pre.length) });
  return bound;
};
```

| 行 | 作用 | 面试要点 |
| ---- | ---- | ---- |
| `new.target ? this : ctx` | **new 兼容的核心** | new 调用时 `new.target` = bound 自身 → this 用新对象；普通调用为 undefined → 用固定 ctx |
| `pre.concat(args)` | 参数拼接 | 预置参数在前、调用时参数在后（顺序必须对） |
| `bound.prototype = Object.create(fn.prototype)` | 原型链 | 没有这行，`new bound()` 的实例 `instanceof Point` 为 false |
| `defineProperty length` | length 收缩 | 普通闭包返回的函数 length 恒 0，需显式补回 |

## 3. 实测数据（bind-验证脚本.js）

```
[A2] 调用 → 你好，张三！                    ✅ 指定 this + 预置参数
[B1] 预置(1,2)+调用(3,4) → 10              ✅ 参数拼接顺序正确
[C1] new bound(2) → [1,2]                  ✅ new 下预置 x=1 + 调用 y=2
[C2] new 结果 === bind 的 ctx？ false       ✅ new 新建对象，忽略 ctx
[D1] p instanceof Point → true             ✅ 继承原 prototype
[D2] p instanceof BoundPoint → true        ✅ bound.prototype 挂在原型链上
[E1] bound.call({name:"李四"}) → 仍是张三   ✅ this 永久固定，后续 call 改不动
[F2] new 行为与原生一致 → [2,3] vs [2,3]    ✅
[G1] length 收缩一致 → 1（2-1）             ✅
```

## 4. 为什么这么设计

- **为什么返回新函数而不是立即执行**：call/apply 是「一次性」，而「固定 this 并复用」是高频需求（事件监听、回调、React 类组件）。bind 把「绑定 this」延迟成可复用的函数。
- **为什么 new 要优先**：new 的语义是「构造一个全新对象并绑定到 this」。如果 bind 的 this 能覆盖，`new BoundPoint()` 构造出来的对象就没意义了。规范规定：**带 `[[Construct]]` 的函数被 new 时，用新对象，忽略 bind 的 this**。所以手写必须检测 new 调用。
- **为什么用 `new.target`**：ES6 提供的「当前函数是否被 new 调用」的检测手段。`new.target` 在被 new 调用时为函数自身，普通调用为 undefined。这是判断「是否构造调用」的可靠方式（`this instanceof fn` 是旧 hack，有边界问题）。
- **为什么补原型链**：`new bound()` 时，JS 用 `bound.prototype` 作为实例的原型。如果不把 `fn.prototype` 挂到 `bound.prototype` 上，实例的原型链就断了——`p instanceof Point` 为 false，`p.constructor` 也不对。`Object.create(fn.prototype)` 让 bound 的原型对象继承原函数的 prototype。
- **为什么 length 要收缩**：bind 的语义是「部分应用」——预置的参数在调用时无需再传。`fn.length` 是形参个数，预置 n 个后新函数还差 `length - n` 个。原生 bind 遵循这个语义，手写也要对齐（面试细节分）。

## 5. 高频追问速答

| 问题 | 一句话答案 |
| ---- | ---- |
| bind 和 call/apply 区别？ | bind 返回新函数不执行、this 永久固定；call/apply 立即执行 |
| 手写 bind 的难点？ | ① new 兼容（new.target 判断）② 参数拼接 ③ 原型链 ④ length 收缩 |
| 怎么判断被 new 调用？ | `new.target`：被 new 时为函数自身，否则 undefined |
| new 时 this 是谁？ | 新对象（忽略 bind 的 ctx）——new 优先于 bind |
| new 的实例 instanceof？ | 需要 `bound.prototype = Object.create(fn.prototype)` 补原型链 |
| bind 后还能被 call 改 this 吗？ | 不能，this 永久固定（实测 E1） |
| 预置参数和调用参数顺序？ | 预置在前、调用在后（`pre.concat(args)`） |
| length 会变吗？ | 会，预置 n 个 → length 减 n（下限 0） |

## 6. 面试速记（30 秒版）

> **bind = 返回新函数，this 永久固定，参数 = 预置 + 调用时拼接。** 手写四要点：**① `new.target ? this : ctx`** 做 new 兼容（new 优先于 bind，this 用新对象）；**② `pre.concat(args)`** 参数拼接；**③ `bound.prototype = Object.create(fn.prototype)`** 补原型链让 `instanceof` 正确；**④ `defineProperty length`** 做 length 收缩（预置 n 个减 n）。**面试追问**：怎么判断 new 调用？`new.target`（this instanceof fn 是旧 hack）。bind 的 this 能再被 call 覆盖吗？不能，永久固定。

> 关联笔记：[[call、apply、bind 详解]]（三兄弟对比 + 最简版 bind） · [[call]] · [[apply]] · [[this四规则]]（new 绑定优先级最高） · [[面试复习准备计划]]（W2 手写题 #5）
