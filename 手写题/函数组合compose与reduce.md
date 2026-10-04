# 函数组合 compose + 手写 reduce

> **结论：compose = 从右到左组合函数（`compose(f,g)(x) = f(g(x))`），用 `reduce` 反向包裹实现；pipe = 从左到右（镜像）。** reduce 手写 = 循环累积，两个边界：**无初始值用第 0 个当 acc、空数组无初始值抛 TypeError**。实测：compose 三函数/多参/空组合全过，reduce 与原生一致且能表达 map/filter。
>
> 可运行验证：[[compose-reduce-验证脚本.js]]（Node 实测：compose/pipe 组合 + reduce 手写/边界/map-filter 表达）

---

## 1. 一句话定义（背诵版）

| 工具 | 方向 | 核心 |
| ---- | ---- | ---- |
| **compose** | 从右到左 | `compose(f, g)(x) = f(g(x))`（数学函数复合） |
| **pipe** | 从左到右 | `pipe(f, g)(x) = g(f(x))`（管道，更直观） |
| **reduce** | 累积 | 遍历数组，`acc = fn(acc, cur, i, arr)`，返回最终 acc |

## 2. compose / pipe（面试手写版）

```js
function compose(...fns) {
  if (fns.length === 0) return x => x;        // 空组合 = 恒等
  return fns.reduce((acc, fn) => (...args) => acc(fn(...args)));
}
function pipe(...fns) {
  if (fns.length === 0) return x => x;
  return fns.reduce((acc, fn) => (...args) => fn(acc(...args)));
}
```

**为什么 compose 是 reduce 反向包裹**：
- `compose(f, g)` → reduce 过程：先拿 `f` 当 acc，`(args) => f(...)`，再包 `g` → `(args) => f(g(...))`——**最右边的函数先执行**，结果传给左边。这就是「从右到左」。
- pipe 反过来：先拿 `f`，`(args) => f(...)`，再包 `g` → `(args) => g(f(...))`——**最左边先执行**。

实测：
```
[A1] compose(add1, double)(3) = 7      ✅ 先 double(3)=6 再 add1=7
[A3] 三函数 = 64                        ✅ 从右到左逐层
[A4] 空组合 = 5（恒等）                 ✅
[B1] pipe(add1, double)(3) = 8         ✅ 先 add1 再 double（和 compose 相反）
[C1] 第一个函数可多参 (1,2,3) → 结果:6  ✅
```

## 3. 手写 reduce（面试手写版）

```js
function myReduce(arr, fn, initial) {
  let i = 0;
  let acc;
  if (arguments.length >= 3) {          // 有初始值 → 从第 0 个开始
    acc = initial;
  } else {                              // 无初始值 → 第 0 个当 acc，从第 1 个开始
    if (arr.length === 0) throw new TypeError('空数组且无初始值');
    acc = arr[0];
    i = 1;
  }
  for (; i < arr.length; i++) {
    acc = fn(acc, arr[i], i, arr);      // 回调签名 (acc, cur, idx, arr)
  }
  return acc;
}
```

**两个边界（高频考）**：
1. **无初始值**：用 `arr[0]` 当 acc，从 `arr[1]` 开始（不调回调处理第 0 个）
2. **空数组 + 无初始值**：抛 TypeError（没有可当 acc 的元素）

实测：
```
[D1] 求和 = 15                         ✅
[E1] 无初始值 = 6（1 当 acc）          ✅
[E2] 空数组无初始值 → TypeError        ✅
[E3] 单元素 = 5（不调回调）            ✅
[F1] 与原生一致 = 20                   ✅
[F2] map 用 reduce = [2,4,6]          ✅
[F3] filter 用 reduce = [1,3,5]       ✅
```

**为什么 reduce 能表达 map/filter**：reduce 的回调可以自由操作 acc（数组）——map 就是「push 变换后的值」，filter 是「push 符合条件的值」。**reduce 是数组操作的「母函数」**，这是面试常考的点。

## 4. 高频追问速答

| 问题 | 一句话答案 |
| ---- | ---- |
| compose 方向？ | 从右到左：`compose(f,g)(x) = f(g(x))` |
| compose 怎么实现？ | `fns.reduce((acc, fn) => (...args) => acc(fn(...args)))` |
| pipe 和 compose 区别？ | pipe 从左到右（`g(f(x))`），compose 从右到左 |
| 空 compose？ | 返回恒等函数 `x => x` |
| reduce 无初始值？ | 第 0 个当 acc，从第 1 个开始 |
| reduce 空数组无初始值？ | 抛 TypeError |
| reduce 为什么能表达 map/filter？ | 回调自由操作 acc 数组（push 变换/过滤后的值） |

## 5. 面试速记（30 秒版）

> **compose = 从右到左**（`compose(f,g)(x)=f(g(x))`），实现 = `fns.reduce((acc,fn)=>(...args)=>acc(fn(...args)))`——reduce 反向包裹，最右先执行。**pipe = 从左到右镜像**。空组合返回恒等函数。**手写 reduce**：有初始值从 0 开始，**无初始值用第 0 个当 acc 从 1 开始，空数组无初始值抛 TypeError**，回调签名 `(acc,cur,idx,arr)`。**加分**：reduce 是数组操作母函数——map（push 变换值）/filter（push 过滤值）都能用 reduce 表达。

> 关联笔记：[[手写题/柯里化]]（compose 常配柯里化） · [[手写题/数组扁平化]]（reduce 应用） · [[手写题/数组去重]]（reduce 去重） · [[JS闭包与作用域-面试速记]]（闭包捕获） · [[面试复习准备计划]]（W3 手写题 #24/#12）
