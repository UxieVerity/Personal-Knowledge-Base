# 手写 call

> **结论：`call` 的作用是「指定 this + 逐个传参 + 立即执行」。手写原理就一句：把函数临时挂到目标对象上，以目标对象为 this 调用，用完删除。** 完整实现要考虑 4 个边界：**null/undefined 兜底、原始值装箱、不覆盖原属性（Symbol）、用完清理**。实测显示手写版是「非严格函数语义」：`myCall(null)` → `globalThis`、`myCall(42)` → 装箱为 Number 对象，与原生 `call` 在**非严格函数**下完全一致；严格模式函数的原生 `call` 不兜底、不装箱（面试追问点）。
>
> 可运行验证：[[call-验证脚本.js]]（Node 实测：基本用法 / 兜底 / 装箱 / Symbol 不覆盖 / 用完清理 / 与原生一致性）

---

## 1. 一句话定义（背诵版）

`Function.prototype.call(thisArg, arg1, arg2, …)` —— **立即调用**函数，把 this 指定为 `thisArg`，剩余参数**逐个**传入。返回函数执行结果。

| 维度 | 值 |
| ---- | ---- |
| 时机 | **立即执行** |
| 传参 | 逐个 `(this, a, b…)` |
| this | 临时指定 |
| 返回 | 函数返回值 |

## 2. 标准实现（面试手写版）

```js
Function.prototype.myCall = function (ctx, ...args) {
  ctx = ctx == null ? globalThis : Object(ctx);  // ① null/undefined 兜底 + ② 原始值装箱
  const key = Symbol('myCall');                   // ③ Symbol 唯一键，不覆盖原属性
  Object.defineProperty(ctx, key, {               // ④ 不可枚举：for...in / Object.keys 看不到
    value: this,
    enumerable: false,
    configurable: true,
    writable: true,
  });
  const r = ctx[key](...args);                   // ⑤ 以 ctx 为 this 调用
  delete ctx[key];                               // ⑥ 用完清理
  return r;                                      // ⑦ 透传返回值
};
```

| 行 | 作用 | 面试要点 |
| ---- | ---- | ---- |
| ① `ctx == null ? globalThis : ...` | null/undefined 兜底 | 非严格函数语义：裸 `fn()` 的 this = globalThis |
| ② `Object(ctx)` | 原始值装箱 | `myCall(42)` 时 this 变成 Number 对象（`typeof === 'object'`） |
| ③ `Symbol()` | 唯一键 | 不用字符串键 → 不覆盖目标对象已有属性 |
| ④ `enumerable: false` | 不可枚举 | `for...in` / `Object.keys` 看不到临时键（更干净） |
| ⑥ `delete` | 用完清理 | 对象不留垃圾属性，可反复调用 |

## 3. 实测数据（call-验证脚本.js）

```
[A1] 手写 call 指定 this + 传参 → 你好，张三！        ✅
[B1] 非严格函数 myCall(null) → globalThis             ✅ 与原生一致
[B3] 严格函数 原生 call(null) → null                  ← 严格模式不兜底（对照）
[C1] 非严格函数 myCall(42) → typeof = object          ✅ 装箱（与原生一致）
[C3] 严格函数 原生 call(42) → typeof = number         ← 严格模式不装箱（对照）
[D2] 调用后原属性 length 仍 = 999                      ✅ 不覆盖
[D3] Object.keys(obj) = ["name","length"]              ✅ 临时键不可枚举
[E2] 调用后残留 Symbol 键 = []                         ✅ 用完删除
[F6] 手写 vs 原生 10 组交替同参对比 → 全部一致          ✅
```

## 4. 为什么这么设计

- **为什么需要 call**：函数调用方式决定 this（`obj.fn()` → obj，`fn()` → 全局）。但有时你要**强行指定**——比如类数组 `arguments` 没有数组方法，`Array.prototype.slice.call(arguments)` 借方法。call 就是「显式绑定」入口。
- **为什么用 Symbol 键**：字符串键可能覆盖对象原属性（如目标对象恰好有 `'fn'` 属性）。Symbol 唯一，绝不冲突。
- **为什么用完要 delete**：不清理的话对象上会残留一个指向函数的临时属性，影响 `Object.keys`、内存、以及下一次调用。**挂载 → 调用 → 删除** 是完整生命周期。
- **为什么「挂到对象上调用」能改 this**：JS 的 this 由调用方式决定——`obj[key]()` 这种**属性访问调用**就是隐式绑定，this = obj。手写 call 的本质是**把显式绑定转换成隐式绑定**。

## 5. 高频追问速答

| 问题 | 一句话答案 |
| ---- | ---- |
| call 手写核心原理？ | 把函数临时挂到目标对象上，`obj[key]()` 调用（隐式绑定），用完 delete |
| null/undefined 兜底？ | `ctx == null ? globalThis : ctx`——裸调用语义（非严格函数） |
| 原始值 this 怎么办？ | `Object(ctx)` 装箱成对象（非严格函数语义；严格函数原生不装箱） |
| 为什么用 Symbol？ | 唯一键，不覆盖目标对象已有属性 |
| 为什么不可枚举？ | `for...in` / `Object.keys` 不该看到临时属性，更干净 |
| 用完为什么要 delete？ | 不清理会残留垃圾属性；`delete` 保证对象干净 |
| 手写和原生有什么差异？ | 手写固定「非严格函数语义」：严格函数原生 `call(null)` 保持 null、`call(42)` 不装箱 |
| 怎么检测函数是否严格？ | `fn.caller` 已废弃；用 `Function.prototype.toString()` 看有没有 `"use strict"` |

## 6. 面试速记（30 秒版）

> **手写 call = 把函数临时挂到目标对象上调用，用完删除。** `ctx = ctx == null ? globalThis : Object(ctx)` 兜底 + 装箱；**Symbol 键**防覆盖；`Object.defineProperty` 不可枚举；`delete` 清理；透传返回值。**面试追问点**：手写版是「非严格函数语义」——严格函数原生 `call(null)` 不兜底（保持 null）、`call(42)` 不装箱（保持 number）；检测严格可用 `Function.prototype.toString()`。**和 apply 只差传参方式**（call 逐个 / apply 数组），和 bind 差在执行时机（call 立即 / bind 返回新函数）。

> 关联笔记：[[call、apply、bind 详解]]（三兄弟对比 + 完整手写） · [[this四规则]]（this 绑定四规则） · [[闭包与作用域链、执行上下文]]（手写用闭包存 `this`） · [[面试复习准备计划]]（W2 手写题 #3）
