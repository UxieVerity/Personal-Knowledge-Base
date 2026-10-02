# 手写 apply

> **结论：`apply` 和 `call` 的作用完全相同——指定 this + 立即执行——唯一区别是传参方式：`apply(this, [参数数组])` 第二参是数组/类数组。** 手写实现与 call 只差一行（`...(args ?? [])` 展开数组），其余（兜底、装箱、Symbol 键、不可枚举、用完清理）完全一致。实测：`Math.max.apply` 数组取最大、`Array.prototype.concat.apply` 展平、`slice.apply(arguments)` 类数组转数组，手写版全部与原生一致。
>
> 可运行验证：[[apply-验证脚本.js]]（Node 实测：基本用法 / 经典用法 / 类数组 / 缺省 / 兜底 / 与 call 一致性）

---

## 1. 一句话定义（背诵版）

`Function.prototype.apply(thisArg, argsArray)` —— **立即调用**函数，this 指定为 `thisArg`，第二参是**数组或类数组**（逐个取作实参）。返回函数执行结果。

| 维度 | call | apply |
| ---- | ---- | ---- |
| 时机 | 立即执行 | 立即执行 |
| 传参 | 逐个 `(this, a, b…)` | **数组** `(this, [a, b…])` |
| this | 临时指定 | 临时指定 |
| 返回 | 函数返回值 | 函数返回值 |

**记忆锚点**：`call` = **C**omma（逗号逐个传）；`apply` = **A**rray（数组传）。

## 2. 标准实现（面试手写版）

```js
Function.prototype.myApply = function (ctx, args) {
  ctx = ctx == null ? globalThis : Object(ctx);   // ① null/undefined 兜底 + ② 原始值装箱
  const key = Symbol('myApply');                    // ③ Symbol 唯一键，不覆盖原属性
  Object.defineProperty(ctx, key, {                 // ④ 不可枚举
    value: this,
    enumerable: false,
    configurable: true,
    writable: true,
  });
  const r = ctx[key](...(args == null ? [] : args)); // ⑤ 展开数组/类数组（缺省 → 空）
  delete ctx[key];                                  // ⑥ 用完清理
  return r;
};
```

**和手写 call 只差一处**：call 用 `...args`（rest 收集逐个参数），apply 用 `...(args ?? [])`（第二参是数组直接展开）。其余 100% 相同——这也是为什么面试常说「call/apply 是同一道题」。

## 3. 实测数据（apply-验证脚本.js）

```
[A1] 手写 apply 指定 this + 数组传参 → 你好，张三！   ✅
[B1] Math.max.apply 数组取最大 → 9                   ✅
[B2] concat.apply 展平一层 → [1,2,3,4,[5]]            ✅
[C1] slice.apply(arguments) → [1,2,3]                 ✅ 类数组转数组
[D2] 不传 args → 0（与原生一致）                      ✅ 缺省安全
[E3] null 兜底 → globalThis（非严格，与原生一致）      ✅
[F4] call/apply 同参对比 3 组 → 全部一致               ✅
```

## 4. 为什么这么设计

- **为什么第二参是数组**：历史原因——有些场景参数天然在数组里（`Math.max` 要展平数组、`concat` 要拼多个数组）。ES6 展开符 `...` 出现后 `apply` 很多场景可被 `call` + 展开替代（`Math.max(...arr)`），但 **apply 对类数组（arguments）仍不可替代**——`...` 只能展开真数组，apply 的第二参接受任何类数组。
- **为什么和 call 分开**：接口设计上「参数个数确定」用 call、「参数装在数组/类数组里」用 apply，各取所需。规范上 call/apply 内部同一套 [[Call]] 逻辑，只差参数收集方式。
- **为什么手写要 `args == null ? []`**：原生 apply 第二参可省略，省略 = 不传任何参数。`...(args ?? [])` 保证缺省安全。

## 5. 高频追问速答

| 问题 | 一句话答案 |
| ---- | ---- |
| apply 和 call 区别？ | 传参方式：call 逐个，apply 数组/类数组；都是立即执行 |
| 数组取最大？ | `Math.max.apply(null, arr)`（或 `Math.max(...arr)`） |
| 数组展平一层？ | `Array.prototype.concat.apply([], arr)` |
| 类数组转数组？ | `Array.prototype.slice.apply(arguments)`（或 `Array.from`） |
| args 能省略吗？ | 能，省略 = 不传参（`args == null ? []`） |
| 手写 apply 与 call 差在哪？ | 只差参数收集：call `...args`，apply `...(args ?? [])` |

## 6. 面试速记（30 秒版）

> **手写 apply = 手写 call 只改一处：第二参是数组，展开传入（`...(args ?? [])`）。** 其余（兜底 `ctx == null ? globalThis`、装箱 `Object(ctx)`、Symbol 键、不可枚举、用完 delete）与 call 完全相同。**经典用法**：`Math.max.apply(null, arr)` 数组取最大、`Array.prototype.concat.apply([], arr)` 展平一层、`Array.prototype.slice.apply(arguments)` 类数组转数组。**ES6 后 `...` 可替代部分 apply 场景，但 apply 处理类数组（arguments）不可替代。**

> 关联笔记：[[call、apply、bind 详解]]（三兄弟对比） · [[call]]（同款实现） · [[bind]]（new 兼容版） · [[this四规则]]（显式绑定） · [[面试复习准备计划]]（W2 手写题 #4）
