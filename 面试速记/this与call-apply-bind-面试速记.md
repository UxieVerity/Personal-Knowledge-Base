# this 与 call/apply/bind · 面试速记

> this 是 JS 核心**必问**，且常和 call/apply/bind 一起考。本速记覆盖「四规则 → 优先级 → 箭头函数 → 三兄弟 → 手写要点」主线，30 秒能讲完，详细见 [[this四规则]] 和 [[call、apply、bind 详解]]。

---

## 1. 一句话定义（背诵版）

> **this 是「调用时」由调用方式决定的动态绑定，不是定义时决定的。** 四规则按优先级：**① new 绑定 > ② 显式绑定（call/apply/bind）> ③ 隐式绑定（obj.fn()）> ④ 默认绑定（裸调用）**。箭头函数是例外——没有自己的 this，取定义处外层词法 this，四规则全失效。

**为什么这样设计**：this 动态绑定 = 函数与方法解耦——一个方法可被任意对象借用（`Array.prototype.slice.call(arguments)`）。new 最高因为构造语义不可违背；显式 > 隐式因为用户明确指定理应覆盖「恰好属性访问」的巧合。

## 2. 四规则（30 秒版）

| 规则 | 触发 | this 指向 |
| ---- | ---- | ---- |
| ④ 默认 | `fn()` 裸调用 | 非严格 `globalThis`（浏览器 window）/ 严格 `undefined` |
| ③ 隐式 | `obj.fn()` | **调用者 obj**；`const fn = obj.fn; fn()` 就丢了（回默认） |
| ② 显式 | `call/apply/bind` | 传入的目标 |
| ① new | `new Fn()` | **新建对象**（new 优先于 bind） |
| 箭头 | 任何方式 | 定义处外层词法 this，call/apply 改不动 |

**经典坑**：`const fn = obj.fn; fn()` this 不是 obj——隐式绑定只在「属性访问调用」生效。React 类组件 `onClick={this.handleClick}` 不 bind 就报错，同因。

**ESM 恒严格**：裸调用 this 大概率 undefined；CJS 顶层 this = module.exports。

## 3. call / apply / bind（背诵版）

| | call | apply | bind |
| ---- | ---- | ---- | ---- |
| 传参 | 逐个 `(this, a, b…)` | **数组** `(this, [a,b…])` | 预置 `(this, a…)` |
| 执行 | 立即 | 立即 | **返回新函数** |
| this | 临时 | 临时 | **永久固定**（call 改不动） |

**记忆锚点**：call = **C**omma（逐个）；apply = **A**rray（数组）。

**手写原理（一句话）**：call/apply = 把函数临时挂到目标对象上 `obj[key]()` 调用（显式转隐式），用完 delete；bind = 返回闭包 `fn.apply(ctx, pre.concat(args))`。

## 4. 手写要点 + 边界（面试加分）

| 实现 | 关键点 |
| ---- | ---- |
| call/apply | `ctx == null ? globalThis : Object(ctx)`（兜底+装箱）；**Symbol 键**防覆盖；`Object.defineProperty` 不可枚举；用完 `delete` |
| bind | **`new.target ? this : ctx`**（new 优先）；`pre.concat(args)`；`bound.prototype = Object.create(fn.prototype)`（instanceof 正确）；length 收缩 |

**边界（实测）**：手写版是「非严格函数语义」——严格模式函数原生 `call(null)` **不兜底**（保持 null）、`call(42)` **不装箱**（保持 number）。检测函数是否严格：`fn.caller` 已废弃，用 `Function.prototype.toString()` 看 `"use strict"`。

## 5. 高频追问速答

- **this 怎么定？** 调用方式：new > 显式 > 隐式 > 默认；箭头函数无 this
- **隐式绑定怎么丢？** `const fn = obj.fn; fn()` 裸调用回默认
- **new 和 bind 谁优先？** new——构造语义不可违背
- **bind 手写难点？** new 兼容（new.target）+ 原型链 + length 收缩
- **手写和原生差异？** 非严格语义：严格函数 call(null) 不兜底、call(42) 不装箱

> 30 秒完整版：**this 四规则：new > 显式 > 隐式 > 默认**（严格裸调用 = undefined）。**call/apply 立即执行只差传参方式**（逐个 vs 数组）；**bind 返回新函数 this 永久固定**。**手写 call/apply = 临时挂载 + Symbol 防覆盖 + delete**；**bind 难点 = new.target 兼容 + 原型链 + length 收缩**。箭头函数无 this，四规则全失效。

---

## 深读入口

- [[this四规则]] —— 四规则 + 优先级 + 箭头函数（含实测）
- [[call、apply、bind 详解]] —— 三兄弟对比 + 手写实现 + 经典用法
- [[call]] · [[apply]] · [[bind]] —— 手写题详解（含边界实测）
- [[new]] —— new 四步 + 优先级原理
- [[JS闭包与作用域-面试速记]] —— JS 线第一篇（this 与闭包关联）
- [[面试速记-索引]] —— 返回主索引
