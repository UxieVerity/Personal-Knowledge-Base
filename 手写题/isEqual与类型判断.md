# isEqual（深比较）+ 类型判断

> **结论：手写 isEqual = 递归深比较，六个要点——① `a===b` 先判原始值；② NaN 特判（`===` 下 NaN≠NaN）；③ 类型不同直接 false（`Object.prototype.toString` 精准判断）；④ Date/RegExp 特殊比较；⑤ WeakMap 防循环引用死循环；⑥ 数组/对象递归比较键值。** 为什么不用 JSON.stringify：丢 undefined 属性、敏感键序、循环引用抛错——三个坑实测全中。
>
> 可运行验证：[[isEqual与类型判断-验证脚本.js]]（Node 实测：类型判断 / NaN / 深比较 / Date/RegExp/循环引用 / JSON 对比）

---

## 1. 一句话定义（背诵版）

**isEqual(a,b) = 递归比较两个值的深层结构是否相等。**

```js
function isEqual(a, b, seen = new WeakMap()) {
  if (a === b) return true;                                    // ① 原始值
  if (typeof a === 'number' && typeof b === 'number' && Number.isNaN(a) && Number.isNaN(b)) return true;  // ② NaN
  const ta = getType(a), tb = getType(b);
  if (ta !== tb) return false;                                 // ③ 类型不同
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (ta === 'Date') return a.getTime() === b.getTime();       // ④ Date
  if (ta === 'RegExp') return a.source === b.source && a.flags === b.flags;  // ④ RegExp
  if (seen.has(a)) return seen.get(a) === b;                   // ⑤ 循环引用
  seen.set(a, b);
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if (!b.hasOwnProperty(k)) return false;                    // 键缺失
    if (!isEqual(a[k], b[k], seen)) return false;              // ⑥ 递归
  }
  return true;
}
```

## 2. 类型判断（基础）

`typeof` 的三个坑：`typeof null === 'object'`、`typeof [] === 'object'`（分不出数组）、`typeof new Date === 'object'`（分不出 Date）。

**精准判断用 `Object.prototype.toString`**：

```js
Object.prototype.toString.call(v).slice(8, -1);
// [object Null] → Null, [object Array] → Array, [object Date] → Date ...
```

实测：
```
[A1] typeof null = object（坑）
[A3] getType(null)=Null | getType([])=Array | getType(new Date)=Date  ✅ 精准
[A4] Object/RegExp/Function 全识别                                     ✅
```

**为什么能精准**：每个内置类型都有 `Symbol.toStringTag`，`Object.prototype.toString` 会读取它——这是「类型标签」的标准入口。注意：`toString` 要 `.call(v)`，否则 this 不对。

## 3. isEqual 六要点（实测）

```
[B1] isEqual(1,1) = true                    ✅ 原始值
[B3] isEqual(NaN,NaN) = true                ✅ NaN 特判（=== 是 false）
[B4] isEqual(1,"1") = false                 ✅ 类型不同
[C3] 嵌套 {a:{b:[1,2]}} = true              ✅ 深比较
[C5] [1,2] vs [1,2,3] = false               ✅ 长度不同
[D1] Date 同刻 = true / 异刻 = false        ✅ Date 比时间戳
[D4] /ab/g vs /ab/i = false                 ✅ RegExp 比 source+flags
[D5] 循环引用对象 = true                     ✅ WeakMap 防死循环
```

**要点逐条**：
1. **`a === b` 先判**：原始值（数字/字符串/布尔/undefined/null）直接命中；同一引用也命中
2. **NaN 特判**：`NaN === NaN` 是 false，但语义上 NaN 应等于 NaN
3. **类型不同直接 false**：`1` 和 `"1"`、`{}` 和 `[]` 不等（先 `getType` 分流）
4. **Date/RegExp**：Date 比 `getTime()`（时间戳）；RegExp 比 `source + flags`
5. **循环引用**：`seen` WeakMap 记录已比对的 (a,b) 对，遇到重复直接 true——否则 `a.self === a` 无限递归爆栈
6. **键比较**：`Object.keys` 数量相同 + 每个键都存在 + 递归值相等

## 4. 为什么 JSON.stringify 不够（高频面试题）

```
[E1] JSON.stringify({a:1,b:undefined}) = {"a":1} === JSON.stringify({a:1})  → 误判相等
[E3] JSON.stringify 键序不同（{a,b} vs {b,a}）→ 误判不等
[E5] JSON 循环引用 → TypeError
```

| JSON.stringify 的坑 | 后果 |
| ---- | ---- |
| **丢掉 undefined/函数/Symbol 属性** | 两个不同对象序列化相同 → 误判相等 |
| **敏感于键顺序** | `{a,b}` 和 `{b,a}` 序列化不同 → 误判不等 |
| **循环引用抛 TypeError** | 直接崩 |

**isEqual 全部规避**：遍历键（不敏感键序）、`hasOwnProperty` 检查（不丢键）、WeakMap 防循环。

## 5. 高频追问速答

| 问题 | 一句话答案 |
| ---- | ---- |
| typeof 有什么坑？ | null/数组/Date 都返回 object，分不清 |
| 精准类型判断？ | `Object.prototype.toString.call(v).slice(8,-1)` |
| isEqual 核心？ | 递归比较：类型不同 false，Date/RegExp 特判，对象比键值 |
| NaN 怎么处理？ | `Number.isNaN(a) && Number.isNaN(b)` 特判为相等 |
| 循环引用怎么办？ | WeakMap 记录已比对对象对，重复直接 true |
| 为什么不用 JSON.stringify？ | 丢 undefined / 敏感键序 / 循环引用抛错 |
| Date/RegExp 怎么比？ | Date 比 getTime()；RegExp 比 source+flags |

## 6. 面试速记（30 秒版）

> **isEqual = 递归深比较。六要点：`===` 先判原始值；NaN 特判（=== 下 NaN≠NaN）；类型不同直接 false（`Object.prototype.toString.call(v).slice(8,-1)` 精准判断，typeof 分不清 null/数组/Date）；Date 比 `getTime()`、RegExp 比 `source+flags`；WeakMap 防循环引用；对象递归比键值（`hasOwnProperty` 查缺失）。** **为什么不用 JSON.stringify**：丢 undefined 属性（误判相等）、敏感键序（误判不等）、循环引用抛错——三坑全踩。

> 关联笔记：[[手写题/深拷贝]]（同为递归 + WeakMap 防循环） · [[手写题/数组去重]]（SameValueZero 语义） · [[手写题/数组扁平化]]（递归思想） · [[面试复习准备计划]]（W3 手写题 #25）
