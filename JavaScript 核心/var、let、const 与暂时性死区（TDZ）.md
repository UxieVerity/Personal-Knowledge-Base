# var、let、const 与暂时性死区（TDZ）

> **结论：`var` 是函数级作用域，声明提升并初始化为 `undefined`；`let/const` 是块级作用域，声明也提升但**不初始化**，进入「暂时性死区（TDZ）」——TDZ 内访问变量会抛 `ReferenceError`，且 `typeof` 也一样抛错（区别于"未声明变量"返回 `undefined`）。`const` 额外要求：**声明时必须初始化，绑定不可重新赋值**（但**锁的是绑定，不是值**——`const obj` 的对象内容可以改）。**函数声明整体提升可直接调用，函数表达式（`var fn = ...`）不提升。** `class` 也有提升但处于 TDZ。
>
> 可运行验证：[[var-let-const与TDZ-验证脚本.js]]（Node 实测 9 项：var/函数声明/函数表达式/let TDZ/typeof 在 TDZ/const 赋值/const 绑定 vs 值/块级作用域/class TDZ）

---

## 1. 三种声明的全景对比

| 维度 | `var` | `let` | `const` |
| ---- | ---- | ---- | ---- |
| 作用域 | **函数级**（for 里声明，函数外可见） | **块级**（`{}` 内可见） | **块级** |
| 提升 | 提升 + 初始化为 `undefined` | 提升但**不初始化**（TDZ） | 提升但不初始化（TDZ） |
| 声明前访问 | `undefined`（不报错） | `ReferenceError` | `ReferenceError` |
| 重复声明 | 允许 | 禁止（`SyntaxError`） | 禁止 |
| 必须初始化 | 否 | 否 | **必须**（否则 `SyntaxError`） |
| 重新赋值 | 允许 | 允许 | **禁止**（`TypeError`） |
| 经典问题 | for 循环捕获同一变量 | — | — |

> 面试一句话总纲：**"`var` 函数级 + 提升为 undefined；`let/const` 块级 + TDZ；`const` 再锁绑定。"**

## 2. 提升（Hoisting）的三种形态（实测）

### 2.1 var：提升 + 初始化为 undefined

```
[A1] var 先访问后声明: x = undefined（不报错）
```

### 2.2 函数声明：整体提升，声明前可调用

```
[B1] 函数声明先调用后定义: Hi, 张三
```

### 2.3 函数表达式：不提升（赋值前是 undefined）

```
[C1] 函数表达式先调用后定义 → TypeError: shout is not a function
[C2] 赋值后 shout 可用: HI
```

| 写法 | 提升行为 | 声明前调用 |
| ---- | ---- | ---- |
| `function f(){}`（声明） | **整个函数**提升 | ✅ 可用 |
| `var f = function(){}`（表达式） | 只提升 `var f`（=undefined），赋值不提升 | ❌ `TypeError` |
| `const f = () => {}`（箭头表达式） | 提升但 TDZ | ❌ `ReferenceError` |

> 为什么这么设计：函数声明整体提升，是为了**互相调用**（A 调 B、B 调 A 的顺序无关紧要）；函数表达式本质是"赋值语句"，赋值当然在执行到才发生。

## 3. TDZ：暂时性死区（实测）

### 3.1 什么是 TDZ

```
[D1] let 声明前访问 → ReferenceError: Cannot access 'tdz' before initialization
[I1] class 声明前使用 → ReferenceError: Cannot access 'Demo' before initialization
```

- `let/const/class` 声明**会提升**（变量在作用域顶部就"存在"），但**绑定处于未初始化状态**。
- 从**作用域顶部**到**声明语句执行完**之间的区域 = 暂时性死区。这期间读/写都抛 `ReferenceError`。

### 3.2 typeof 在 TDZ 中（最易考的坑）

```
[E1] typeof 一个未声明变量 = undefined（不报错）      ← 未声明：安全返回 "undefined"
[E2] typeof 一个处于 TDZ 的变量 → ReferenceError     ← TDZ：照样抛错
```

| 情况 | `typeof x` 结果 |
| ---- | ---- |
| `x` 完全未声明 | `"undefined"`（不报错） |
| `x` 已 `let` 声明但未执行到（TDZ） | **抛 `ReferenceError`** |
| `x` 已声明并初始化 | 正常类型 |

> 面试坑题：**"`typeof` 是不是绝对安全？"——不是。** `typeof` 只在"变量从未声明"时安全；一旦变量存在但处于 TDZ，`typeof` 同样抛错。经典题：`console.log(typeof a); let a = 1;` → 抛 `ReferenceError`。

### 3.3 TDZ 为什么存在

> 为什么这么设计：`var` 时代"声明前访问"静默返回 `undefined`，导致**用了才发现是 undefined** 的隐性 bug。TDZ 是 ES6 **故意**的严格化：把"声明前访问"从静默变成显式报错，逼你声明在前。代价是理解成本（提升 + TDZ 两个概念叠加），收益是消灭一类难以排查的错误。**这是 JS 从"宽容"走向"严格"的标志性设计。**

## 4. const：只读绑定，不是不可变值（实测）

```
[F1] const 重新赋值 → TypeError: Assignment to constant variable.
[F2] const 声明未初始化 → SyntaxError: Missing initializer in const declaration
[G1] const 对象可改内容: obj = {"n":2,"extra":3}
[G2] const 对象重新赋值 → TypeError
[G3] const 锁的是"绑定"，不是对象本身；真要不可变用 Object.freeze
```

- **const 锁的是「变量名 → 对象引用」的绑定**，不是对象本身。
- `const obj = {...}` 后：`obj.x = 1` ✅、`obj = {}` ❌。
- 要**值不可变**：`Object.freeze(obj)`（浅冻结；深层要递归 freeze）。

## 5. 块级作用域（实测）

```
[H1] 块外访问 var: var-穿透（var 函数级，穿透块）
[H2] 块外访问 let → ReferenceError: blockLet is not defined
[H3] 块外访问 const → ReferenceError: blockConst is not defined
```

- `var` 是**函数级**：`{}` 挡不住它。
- `let/const` 是**块级**：`if/for/while/{}` 都形成块，块外不可见。
- 面试延伸：**"ES5 没有块级作用域，靠 IIFE 模拟；ES6 用 let/const 原生解决。"**

## 6. 高频追问速答

| 问题 | 一句话答案 |
| ---- | ---- |
| var 和 let 区别？ | 作用域（函数级 vs 块级）+ 提升（undefined vs TDZ）+ 重复声明（允许 vs 禁止） |
| 什么是 TDZ？ | 声明到初始化之间的区域，期间访问抛 ReferenceError |
| typeof 绝对安全吗？ | 不是，TDZ 中变量 typeof 也抛错 |
| const 是"不可变"吗？ | 不是，锁绑定不锁值；要值不可变用 Object.freeze |
| 函数声明 vs 表达式提升？ | 声明整体提升可用；表达式只提升 var，赋值前调用报 TypeError |

---

## 7. 面试速记（30 秒版）

> **var：函数级 + 提升为 undefined；let/const：块级 + 提升但 TDZ（访问抛 ReferenceError）。** TDZ 是"作用域顶部到声明执行完"的死区，**`typeof` 在 TDZ 中也抛错**（只有"未声明变量"才安全返回 undefined）。**const 锁绑定不锁值**（`obj.x=1` 可以，`obj={}` 不行），声明必须初始化。**函数声明整体提升可提前调用；函数表达式不提升**（赋值前 TypeError）。class 也提升但 TDZ。ES6 用 TDZ 把"声明前访问"从静默 undefined 改成显式报错。

> 关联笔记：[[闭包与作用域链、执行上下文]]（2A.4 提升基础 + for 循环 var/let 陷阱） · [[原型与原型链、继承]] · [[面试复习准备计划]]（W1 第 3 天）
