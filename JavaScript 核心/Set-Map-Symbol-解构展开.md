# Set / Map / Symbol / 解构 / 展开

> **结论：ES6+ 五大语法糖/数据结构解决五个痛点——`Set` 去重（严格相等、插入有序）、`Map` 任意类型键（对象键会被转字符串的陷阱）、`Symbol` 唯一属性键（不进 Object.keys）+ 协议钩子（Symbol.iterator）、解构批量取值（默认值/重命名/嵌套）、展开浅拷贝（替代 apply/concat 场景）。** 实测全部跑通，含对象键转字符串冲突、Symbol 键隐藏、浅拷贝共享引用三个易错点。
>
> 可运行验证：[[set-map-symbol-解构展开-验证脚本.js]]（Node 实测：Set 去重 / Map 任意键 / Symbol 唯一性 / 解构默认值 / 展开浅拷贝）

---

## 1. 一句话速览（背诵版）

| 特性 | 一句话 | 解决什么 |
| ---- | ---- | ---- |
| **Set** | 值唯一的集合，**严格相等**（`===`）判重，插入有序 | 去重、交集/差集、标记集合 |
| **Map** | **任意类型键**（对象/数字/Symbol），插入有序，`size` 直接取 | 对象当键、需有序遍历的字典 |
| **Symbol** | **唯一**的原始值（同描述也不同），可作属性键，不进 Object.keys | 私有属性、协议钩子（iterator/toStringTag） |
| **解构** | 按模式取值：数组按位、对象按名，支持默认值/重命名/嵌套/rest | 批量取值、交换变量、函数参数解构 |
| **展开** | `...` 摊开可迭代对象（数组/对象/字符串），浅拷贝 | 合并、复制、替代 apply/concat |

## 2. Set（实测）

```js
new Set([1, 2, 2, 3, '1']);          // {1, 2, 3, '1'}  2 和 '2' 不同（严格相等）
[...new Set(arr)];                   // 数组去重一行
```

实测：
```
[A1] 去重 → [1,2,3,"1"]              ✅ 严格相等：2 ≠ "2"
[A2] 数组去重 → [1,2,3]              ✅
[A3] 迭代顺序 = 插入顺序 → ["b","a","c"] ✅
[A4] WeakSet 只能存对象              ✅ 弱引用
```

**面试要点**：Set 判重用 `SameValueZero`（≈ 严格相等但 `NaN` 视为相等）——所以 `1` 和 `"1"` 不去重；**去重无法区分类型**（`[1,"1"]` 保留两个）。

## 3. Map（实测）

```js
const m = new Map();
m.set(42, '数字键'); m.set({id:1}, '对象键'); m.set(sym, 'Symbol键');
```

实测：
```
[B1] 任意类型键 → 数字键 / 字符串键 / true   ✅ 对象/数字/Symbol 都能当键
[B2] 遍历 = 插入顺序                        ✅
[B4] 对象键陷阱 → 两个 {} 键冲突成 "[object Object]" ✅
[B5] WeakMap 弱引用                        ✅ 衔接 [[Proxy-Reflect-WeakMap]]
```

**为什么 Map 比 Object 强**（高频对比题）：

| 维度 | Object | Map |
| ---- | ---- | ---- |
| 键类型 | 只能是字符串/Symbol | **任意类型**（对象/数字/函数） |
| 键冲突 | 对象键被 `toString` 成 `"[object Object]"` 冲突 | 引用相等，不冲突 |
| 顺序 | 整数键特殊排序 | 恒插入顺序 |
| size | 手动 `Object.keys().length` | `map.size` 直接取 |
| 原型 | 有 `Object.prototype`（`{}` 有污染面） | 无原型链 |

## 4. Symbol（实测）

```js
const s1 = Symbol('desc'), s2 = Symbol('desc');
s1 === s2;                    // false —— 唯一
obj[s1] = 'x';                // 属性键
Object.keys(obj);             // 不含 Symbol 键
```

实测：
```
[C1] 唯一性（同描述也不同）→ false  ✅
[C2] Symbol 键不进 Object.keys → ["normal"]  ✅
[C3] Object.getOwnPropertySymbols 能拿到 → 1  ✅
[C4] 自定义迭代器 Symbol.iterator → [1,2]  ✅
[C5] 内置 Symbol：iterator / toStringTag  ✅
```

**两个用途**：
1. **唯一属性键**：防止键冲突（手写 call/bind 用 Symbol 防覆盖——见 [[call]]）。`Object.keys`/`for...in` 看不到，需 `Object.getOwnPropertySymbols` 单独拿。
2. **协议钩子**：`Symbol.iterator` 让对象可迭代（`[...obj]` 生效）、`Symbol.toStringTag` 自定义 `Object.prototype.toString` 结果、`Symbol.hasInstance` 自定义 `instanceof`。

## 5. 解构（实测）

```js
const [a, , b] = [1, 2, 3];            // 数组按位 + 跳位
const { name: n = '默认', age } = obj;  // 对象按名 + 重命名 + 默认值
const [x, ...rest] = [1, 2, 3];        // rest 剩余
[sx, sy] = [sy, sx];                    // 交换变量
const { u: { v } } = { u: { v: 42 } }; // 嵌套
```

实测：
```
[D1] 数组解构 → 10 20                    ✅
[D2] 跳位 → 1 3                          ✅
[D3] 对象解构 + 重命名 → 张三 28          ✅
[D4] 默认值 → 100                        ✅
[D5] rest 剩余 → 1 [2,3,4]               ✅
[D6] 嵌套 → 42                           ✅
[D7] 交换变量 → 2 1                      ✅
```

**面试要点**：解构的**默认值只在值为 `undefined` 时生效**（`null` 不触发默认值——`{a = 1}` 对 `{a: null}` 得到 null）。对象解构是「按 key 取」，数组是「按位置取」；重命名 `{a: b}` = 取 a 赋给 b。

## 6. 展开（实测）

```js
Math.max(...arr);            // 替代 apply
[...arr1, ...arr2];          // 合并
{ ...obj, z: 3 };            // 对象浅拷贝 + 扩展
```

实测：
```
[E1] 数组展开替代 apply → 3  ✅
[E2] 数组合并 → [1,2,3,4]    ✅
[E3] 对象展开 → {x,y,z}      ✅
[E4] 浅拷贝共享嵌套引用 → [1,2]  ✅ 嵌套对象是引用（不是深拷贝）
[E5] 展开替代 concat → [1,2,3,4,5]  ✅
```

**面试要点**：展开是**浅拷贝**——第一层复制，嵌套对象/数组仍是引用（实测 E4：改原数组，拷贝也跟着变）。深拷贝要 `structuredClone`/递归（见 [[深拷贝]]）。对象展开顺序 = 后展开覆盖先展开（`{...a, ...b}` b 覆盖 a 同名键）。

## 7. 高频追问速答

| 问题 | 一句话答案 |
| ---- | ---- |
| Set 怎么去重？ | `[...new Set(arr)]`；严格相等判重（1 ≠ "1"） |
| Map 和 Object 区别？ | Map 任意键/有序/size；Object 键只能字符串/Symbol，对象键会 toString 冲突 |
| Symbol 有什么用？ | 唯一属性键（防冲突）+ 协议钩子（iterator/toStringTag） |
| Symbol 键能被 Object.keys 看到吗？ | 不能，需 Object.getOwnPropertySymbols |
| 解构默认值什么时候生效？ | 仅值为 `undefined` 时（null 不触发） |
| 展开是深拷贝吗？ | 不是，浅拷贝——嵌套对象/数组共享引用 |
| 展开替代了什么？ | `Math.max(...arr)` 替代 apply；`[...a,...b]` 替代 concat |

## 8. 面试速记（30 秒版）

> **Set 去重（严格相等、插入有序）→ `[...new Set(arr)]`；Map 任意类型键、有序、size（对象键会 toString 冲突）；Symbol 唯一属性键 + 协议钩子（iterator/toStringTag），不进 Object.keys；解构批量取值，默认值仅 undefined 时生效，支持重命名/嵌套/rest/交换变量；展开 = 浅拷贝（替代 apply/concat），嵌套共享引用。** 三个易错：`1 ≠ "1"`（Set）、`{}` 当对象键冲突（Map vs Object）、展开不是深拷贝。

> 关联笔记：[[Proxy-Reflect-WeakMap]]（WeakMap/WeakSet 弱引用） · [[深拷贝]]（展开浅拷贝 → 深拷贝方案） · [[数组去重]]（Set 去重实战） · [[call]]（Symbol 防覆盖） · [[面试复习准备计划]]（W2 周四）
