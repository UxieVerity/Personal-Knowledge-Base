# TS 基础：类型推断 / any vs unknown vs never

> **结论：`any` 和 `unknown` 都是「顶类型」（能接收任何值），但 `any` **关闭类型检查**（危险），`unknown` **必须先收窄才能用**（安全）；`never` 是「底类型」（表示不可能有值，能赋给任何类型，用于穷尽检查）。类型推断 = TS 自动推导，多数情况不用手写类型。** 实测：用 tsc --strict 跑 8 条错误代码 + 4 条对照，全部符合预期（错误码 TS2322/TS2588/TS18046/TS2339）。
>
> 可运行验证：[[逐条验证.sh]]（tsc 逐条实测，抓真实错误码）· [[基础类型-验证脚本.ts]]（正向类型标注，strict 零错误）

---

## 1. 一句话定义（背诵版）

| 类型 | 一句话 | 安全性 |
| ---- | ---- | ---- |
| **类型推断** | TS 自动从初始值推导类型，不用手写 | — |
| **any** | 关闭类型检查，能当任何类型用 | ❌ 危险（逃逸舱） |
| **unknown** | 安全版 any，**必须先收窄**才能用 | ✅ 安全 |
| **never** | 不可能有值的类型（最底类型） | 用于穷尽检查 |

**三者关系（面试核心）**：`any` 和 `unknown` 是**顶类型**（top type，收所有值）；`never` 是**底类型**（bottom type，可赋给所有类型）。

## 2. 类型推断（inference）

```ts
let a1 = 42;              // number
let a2 = 'hello';         // string
let a4 = [1, 2, 3];       // number[]
let a5 = { name: '张三' }; // { name: string }

const a6 = 'foo';         // "foo"（字面量类型，const 保留窄类型）
let a7 = 'foo';           // string（let 放宽）
```

**面试点**：`const` 推断为**字面量类型**（`"foo"`），`let` 推断为**宽类型**（`string`）——这是 TS 最常用的推断细节。

## 3. any（关闭检查，危险）

```ts
let b: any = 42;
b = 'str';              // ✅ 可赋任何值
b.foo.bar();            // ✅ 不报错（运行时才炸！）
const n: number = b;    // ✅ any 可赋给 number（不检查）
```

实测：`any` 赋给 `number` + 调用任意方法 → **都不报错**（符合预期）。

**为什么危险**：`any` 会把类型错误推迟到运行时。一个 `any` 传染整条链路（`any` 的返回值也是 `any`），等于放弃 TS 的价值。

## 4. unknown（安全版 any）

```ts
let c: unknown = 42;
c = 'str';                    // ✅ 可赋任何值（同 any）

c.foo;                        // ❌ TS18046: 'c' is of type 'unknown'
c();                          // ❌ TS18046
const n: number = c;          // ❌ TS2322: 'unknown' is not assignable to 'number'

// ✅ 必须先收窄（type guard）
if (typeof c === 'string') {
  c.toUpperCase();            // 收窄成 string，可用
}
```

实测真实错误码：
```
error TS18046: 'e3' is of type 'unknown'.        ← 直接访问属性
error TS18046: 'e4' is of type 'unknown'.        ← 直接调用
error TS2322: Type 'unknown' is not assignable to type 'number'.  ← 直接赋给具体类型
```

**为什么用 unknown 代替 any**：接收外部输入（`JSON.parse`、API 响应、`catch` 的 error）时，先当 `unknown` 接住，用类型守卫收窄后使用——**既不丢类型安全，又能接住任意值**。这是 TS 最佳实践。

## 5. never（不可能有值）

### 三种出现场景

```ts
// ① 永远抛错 / 死循环的函数
function throwError(msg: string): never { throw new Error(msg); }
function infiniteLoop(): never { while (true) {} }

// ② 穷尽性检查（最经典用途）
type Shape = 'circle' | 'square' | 'triangle';
function area(s: Shape): number {
  switch (s) {
    case 'circle': return 1;
    case 'square': return 2;
    default:
      const exhaustive: never = s;   // 若漏了 triangle → 这里报错
      return exhaustive;
  }
}

// ③ 底类型：可赋给任何类型
declare const n: never;
const n1: number = n;   // ✅
const n2: string = n;   // ✅
```

实测：
```
error TS2322: Type '42' is not assignable to type 'never'.         ← never 不能被赋值
error TS2322: Type '"triangle"' is not assignable to type 'never'. ← 穷尽检查抓到漏分支
```

### 关键区分：never vs void

| | never | void |
| ---- | ---- | ---- |
| 含义 | **永远不返回**（抛错/死循环） | **返回了但没值**（undefined） |
| 能赋值 | 只能赋给 never | 可赋 undefined |
| 例子 | `throwError()`、`infiniteLoop()` | `console.log()` |

## 6. 三者赋值关系（面试必画）

```
        任何值
          ↓
   ┌──────────────┐
   │  any（关检查）│ ← 可赋给任何类型（危险）
   │ unknown（安全）│ ← 必须先收窄才能用
   └──────────────┘
          ↑ 都是「顶类型」，收所有值

        never（底类型）
          ↓ 可赋给任何类型（永远不返回）
```

| 赋值方向 | 是否允许 |
| ---- | ---- |
| 任何值 → `any` | ✅ |
| 任何值 → `unknown` | ✅ |
| `any` → 具体类型 | ✅（不检查，危险） |
| `unknown` → 具体类型 | ❌（必须收窄） |
| `never` → 任何类型 | ✅（底类型） |
| 任何值 → `never` | ❌ |

## 7. 为什么这么设计

- **为什么需要 any**：给「迁移 JS 到 TS」留逃生舱——暂时不想写类型的复杂代码先标 any。但**应该逐渐减少 any**——它是技术债。
- **为什么加 unknown**：`any` 太危险（完全关闭检查），但很多场景又确实要「先接住未知值」。`unknown` 是折中：**能接住，但要收窄后才能用**——把「检查」强制拉到使用点。
- **为什么有 never**：类型系统需要「底类型」来表达「不可能发生」。最实际的用途是**穷尽检查**——当 union 增加新成员时，编译器帮你找出所有没处理的地方（这是 TS 相比 JS 最大的价值之一：重构安全性）。

## 8. 高频追问速答

| 问题 | 一句话答案 |
| ---- | ---- |
| any 和 unknown 区别？ | any 关检查可直接用；unknown 必须先收窄 |
| 什么时候用 unknown？ | 接收外部输入（JSON.parse/API/catch），收窄后使用 |
| never 是什么？ | 不可能有值的类型（抛错/死循环/穷尽检查） |
| never 和 void 区别？ | never 永不返回；void 返回了但没值 |
| 穷尽检查怎么写？ | default 分支 `const x: never = s`，漏分支就报错 |
| const 和 let 推断区别？ | const → 字面量类型；let → 宽类型 |
| any 有什么危害？ | 关检查、传染、错误推迟到运行时 |
| 三者是什么关系？ | any/unknown 顶类型（收所有值）；never 底类型（可赋给所有） |

## 9. 面试速记（30 秒版）

> **any = 关检查（危险，能当任何类型用、能赋给任何类型）；unknown = 安全版 any（能接住任何值，但必须先收窄——直接访问/调用/赋值具体类型都报 TS18046/TS2322）；never = 不可能有值（抛错/死循环函数的返回类型，也是穷尽检查的利器：default 里 `const x: never = s`，union 漏分支就报错）。** any/unknown 是**顶类型**（收所有值），never 是**底类型**（可赋给所有类型）。类型推断：`const` 推字面量、`let` 推宽类型。**最佳实践：外部输入用 unknown + 类型守卫，不用 any。**

> 关联笔记：[[类型断言与类型守卫]] · [[泛型与工具类型]] · [[TypeScript-面试速记]] · [[面试复习准备计划]]（W6 周一）
