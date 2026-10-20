# TS 泛型：约束 / 条件类型 / 映射类型 + 手写工具类型

> **结论：泛型 = 类型层面的「参数化」——把类型当参数传，让一个实现适配多种类型。三块核心：① 泛型约束（`extends` 限制 T 的形状、`keyof` 限制 K 必须是 T 的键）；② 条件类型（`T extends U ? X : Y`，配 `infer` 提取内部类型）；③ 映射类型（`{ [K in keyof T]: ... }`，用 `+/-readonly`、`+/-?` 修饰）。** 实测：手写 Pick/Omit/Partial/Required/Readonly/Record 与内置类型**完全等价**（11 条 Equal 断言全过），7 条违反约束的错误逐条被 tsc 抓到。
>
> 可运行验证：[[泛型逐条验证.sh]]（7 条报错 + 4 条对照，抓真实错误码）· [[泛型反向验证-类型等价.ts]]（11 条类型等价断言）· [[泛型-验证脚本.ts]]（正向：约束/条件/映射/工具类型）

---

## 1. 一句话定义（背诵版）

| 概念 | 一句话 | 语法 |
| ---- | ---- | ---- |
| **泛型** | 类型参数化（类型当参数） | `<T>` |
| **约束** | 限制 T 必须满足的形状 | `<T extends Shape>` |
| **keyof 约束** | K 必须是 T 的键 | `<K extends keyof T>` |
| **条件类型** | 类型层面的 if-else | `T extends U ? X : Y` |
| **infer** | 在条件类型里提取类型 | `T extends (infer E)[] ? E : never` |
| **映射类型** | 遍历 T 的键生成新类型 | `{ [K in keyof T]: ... }` |

## 2. 泛型基础

```ts
function identity<T>(arg: T): T { return arg; }
identity('hello');        // T 推断为 string
identity<number>(42);     // 显式指定

function pair<K, V>(k: K, v: V): [K, V] { return [k, v]; }   // 多类型参数

interface Box<T> { value: T; get(): T; }                      // 泛型接口
```

## 3. 泛型约束

### 3.1 extends 约束（限制形状）

```ts
function getLength<T extends { length: number }>(x: T): number {
  return x.length;        // ✅ 约束保证一定有 length
}
getLength('abc');         // ✅ string 有 length
getLength(42);            // ❌ TS2345: number 不满足 { length: number }
```

实测错误码：
```
error TS2345: Argument of type 'number' is not assignable to parameter of type '{ length: number; }'.
```

### 3.2 keyof 约束（限制键名）

```ts
function getProp<T, K extends keyof T>(obj: T, key: K): T[K] {
  return obj[key];        // ✅ T[K] 精确返回属性类型
}
getProp(user, 'name');    // string ✅
getProp(user, 'email');   // ❌ TS2345: 'email' 不在 user 的键里
```

**为什么用 `T[K]` 而不是 `any`**：`getProp(user, 'age')` 自动返回 `number`——**键名决定了返回类型**，这是 keyof 约束的最大价值（类型安全的动态属性访问）。

## 4. 条件类型 + infer

### 4.1 基础条件类型

```ts
type IsString<T> = T extends string ? true : false;
type A = IsString<'hi'>;    // true
type B = IsString<42>;      // false
```

### 4.2 infer 提取（最常考）

```ts
// 提取数组元素类型
type ElementOf<T> = T extends (infer E)[] ? E : never;
type E1 = ElementOf<string[]>;         // string

// 提取函数返回值
type ReturnOf<T> = T extends (...args: any[]) => infer R ? R : never;
type R1 = ReturnOf<() => number>;      // number

// 提取函数参数（元组）
type ParamOf<T> = T extends (...args: infer P) => any ? P : never;
type P1 = ParamOf<(a: string, b: number) => void>;   // [string, number]
```

**`infer` 的作用**：在 `extends` 模式匹配里「声明一个待推断的类型变量」——匹配成功后该变量就被赋值。这是 `ReturnType`、`Parameters`、`Awaited` 等内置工具类型的实现原理。

### 4.3 分配条件类型（面试难点）

```ts
type ToArray<T> = T extends any ? T[] : never;
type D1 = ToArray<string | number>;      // string[] | number[]（分配后分别应用）

// 阻止分配：用 [T] 包裹（属性访问/数组包装 → 不再是 naked type parameter）
type ToArrayNoDist<T> = [T] extends [any] ? T[] : never;
type D2 = ToArrayNoDist<string | number>; // (string | number)[]（不分配）
```

**规则**：条件类型里的类型参数若是「裸的」（未被包装），对联合类型会**逐个分配**再合并。用 `[T]` 或 `T & {}` 包装可阻止。

## 5. 映射类型

```ts
// 基础：遍历键
type MyPartial<T> = { [K in keyof T]?: T[K] };

// 去除 readonly（-readonly）
type MyMutable<T> = { -readonly [K in keyof T]: T[K] };

// 去除可选（-?）
type MyRequired<T> = { [K in keyof T]-?: T[K] };

// 加 readonly
type MyReadonly<T> = { readonly [K in keyof T]: T[K] };

// 键重映射（as）—— TS 4.1+
type Getters<T> = { [K in keyof T as `get${Capitalize<string & K>}`]: () => T[K] };
```

**四个修饰符**（面试必背）：

| 写法 | 作用 |
| ---- | ---- |
| `?` | 加可选 |
| `-?` | **去掉**可选 |
| `readonly` | 加只读 |
| `-readonly` | **去掉**只读 |

## 6. 手写工具类型（面试必考）

```ts
// Pick：选键
type MyPick<T, K extends keyof T> = { [P in K]: T[P] };

// Omit：排除键（用 Exclude + Pick 组合）
type MyOmit<T, K extends keyof any> = MyPick<T, Exclude<keyof T, K>>;

// Partial：全可选
type MyPartial<T> = { [P in keyof T]?: T[P] };

// Required：全必填
type MyRequired<T> = { [P in keyof T]-?: T[P] };

// Readonly：全只读
type MyReadonly<T> = { readonly [P in keyof T]: T[P] };

// Record：键值映射
type MyRecord<K extends keyof any, V> = { [P in K]: V };
```

**关键点**：
- `Pick` 的 `K extends keyof T` 约束——只能选 T 有的键（选不存在的键报 **TS2344**）
- `Omit` 必须用 `Exclude<keyof T, K>` 先算差集，再 Pick
- `-?` / `-readonly` 是「去除修饰符」的语法（不是「加负号」）

## 7. 实测数据

**类型等价验证**（`泛型反向验证-类型等价.ts`，11 条全过）：
```
[1] MyPick   === Pick      ✅
[2] MyOmit   === Omit      ✅
[3] MyPartial === Partial  ✅
[4] MyRequired === Required ✅
[5] MyReadonly === Readonly ✅
[6] MyRecord === Record    ✅
[7] ElementOf<string[]> === string ✅
[8] ReturnOf<() => number> === number ✅
[9] ParamOf<(a,b)=>void> === [string, number] ✅
[10] ToArray<string|number> === string[] | number[] ✅
[11] ToArrayNoDist === (string|number)[] ✅
```

**错误逐条实测**（`泛型逐条验证.sh`，7 条全报错）：
```
TS2345: number 不满足 { length: number }
TS2345: "email" 不是 keyof user
TS2322: string 不能赋给 number
TS2344: "email" 不满足 keyof User 约束
TS2322: 42 不能赋给 never（infer 失败）
TS2540: readonly 属性不能改
TS2741: Required 后缺字段 id
```

## 8. 为什么这么设计

- **为什么需要泛型**：没有泛型，`identity` 只能返回 `any`（丢类型信息）或为每种类型写一遍（重复）。泛型让「一个实现 + 类型参数」——**复用实现，保留类型**。
- **为什么约束用 extends**：泛型体内要访问 `T` 的属性/方法，编译器需要知道 T 有什么。`extends` 就是「承诺 T 至少长这样」——否则报 `Property does not exist on type 'T'`。
- **为什么条件类型能提取**：`T extends Pattern ? infer X` 本质是**类型级模式匹配**——就像正则匹配提取分组。`infer X` 声明一个「占位变量」，匹配成功自动填入。这是 TS 类型编程的基础。
- **为什么映射类型要 `-?`/`-readonly`**：修饰符是「属性状态」的一部分。要「反转状态」（可选→必填）必须有「去除」语法——`-` 前缀就是移除。

## 9. 高频追问速答

| 问题 | 一句话答案 |
| ---- | ---- |
| 泛型是什么？ | 类型参数化，一个实现适配多种类型 |
| extends 约束的作用？ | 限制 T 的形状，保证能访问属性 + 报错早 |
| keyof 约束怎么用？ | `<K extends keyof T>` + `T[K]` 返回精确类型 |
| 条件类型语法？ | `T extends U ? X : Y`（类型级 if-else） |
| infer 作用？ | 在条件类型里提取类型（ReturnType/Parameters 原理） |
| 分配条件类型？ | 裸类型参数对联合类型逐个应用；`[T]` 包裹阻止 |
| 映射类型语法？ | `{ [K in keyof T]: ... }` |
| `-?` 和 `-readonly`？ | 去除可选/只读修饰符 |
| Omit 怎么实现？ | `Pick<T, Exclude<keyof T, K>>` |
| 手写 Pick？ | `{ [P in K]: T[P] }` + `K extends keyof T` |

## 10. 面试速记（30 秒版）

> **泛型 = 类型参数化。** 三块：**约束**（`<T extends Shape>` 限制形状、`<K extends keyof T>` 限制键名，配 `T[K]` 返回精确类型）；**条件类型**（`T extends U ? X : Y`，`infer` 提取——`ReturnType`/`Parameters` 原理；裸类型参数对联合**分配**，`[T]` 包裹阻止）；**映射类型**（`{ [K in keyof T]: ... }`，修饰符 `?`/`-?`/`readonly`/`-readonly`）。**手写工具类型**：Pick=`{[P in K]: T[P]}`、Omit=`Pick<T, Exclude<keyof T, K>>`、Partial=`?`、Required=`-?`、Readonly=`readonly`。实测手写版与内置**类型完全等价**。

> 关联笔记：[[TS基础-类型推断与any-unknown-never]] · [[类型断言与类型守卫]] · [[TypeScript-面试速记]] · [[面试复习准备计划]]（W6 周二）
