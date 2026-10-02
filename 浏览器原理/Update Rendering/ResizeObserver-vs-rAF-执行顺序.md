
## ResizeObserver 与 requestAnimationFrame 的执行顺序

> **结论：同一渲染帧内，`requestAnimationFrame` 回调先执行，`ResizeObserver` 回调在其后**（位于 rAF 与 Paint 之间）。

### 验证 Demo

> 可运行验证：[[ResizeObserver-vs-rAF-demo.html]]
> 在浏览器中打开后，页面会每帧自动改变 `#box` 宽度，日志中可见二者在同一帧内的交错顺序（橙= rAF，蓝= RO）。

```
[ 341.30ms] [rAF] #1: 设置宽度 = 107px
[ 368.70ms] [RO] rAF#1 改的宽度已生效 → 在 rAF#2 之前送达: 107.0px
[ 375.90ms] [rAF] #2: 设置宽度 = 115px
[ 377.70ms] [RO] rAF#2 改的宽度已生效 → 在 rAF#3 之前送达: 115.0px
...
```

实测 2143 帧统计：RO 先于 rAF 记录 **2052 次**（≈100%），91 帧无尺寸变化、RO 未触发。

### 规范依据（HTML Living Standard §8.1.7.3 update the rendering）

`update the rendering` 内严格按序：

| 步骤      | 内容                                                                               |
| ------- | -------------------------------------------------------------------------------- |
| Step 8  | **resize 事件**（window 视口变化）                                                    |
| Step 9  | **scroll 事件**                                                                   |
| Step 14 | **Run the animation frame callbacks**（rAF 回调）                                    |
| Step 16 | Recalculate styles and update layout → **循环递送 ResizeObserver 通知**（布局之后、paint 之前） |
| Step 19 | IntersectionObserver 交叉状态计算                                                      |
| Step 22 | Update the rendering or UI（Paint / 呈现）                                           |

> ✅ **Chrome headless + CDP 实测**（逐帧时间戳，60 帧全部一致）：每帧稳定顺序为
> **scroll/resize 事件 → rAF → RO**：
> ```
> rAF-start(28.10) → rAF-end(28.50) → RO(28.60)     ← 同帧内 rAF 前、RO 后
> scroll(34.90) = 下一帧 rAF-start(34.90)            ← scroll 在下一帧 rAF 之前派发
> ```
> 可运行验证（含五种事件 + 操作表）：[[Update Rendering.html]]

### 为什么这么设计？

- **RO 必须读到"最新布局"**：它上报 `contentRect`（真实计算后的盒尺寸），而布局只发生在 rAF 之后。若 RO 在 rAF 前执行，读到的还是上一帧旧尺寸。
- **rAF 里改尺寸 → 本帧 RO 收不到**，要等下一帧。因为 rAF 改动后，RO 递送点在其后且需重新布局才算数。

### 三个重要推论

1. **RO 回调里改尺寸 → 同一帧内再递送一轮**（Step 16 是 `while` 循环）。规范用"每轮迭代只处理 DOM 更深层元素"防死循环；同层无限改尺寸会触发 **`ResizeObserver loop completed with undelivered notifications`** 报错。
2. **rAF 回调里注册 rAF → 下一帧执行**；RO/IO 回调里注册 rAF → 也是下一帧。所以 **RO 回调里再 `requestAnimationFrame(...)` 是把尺寸改动推迟到重绘后的官方解法**（MDN 推荐）。
3. **RO 不是每帧都触发**：只有被观察元素尺寸真的变化才递送（实测中宽度不变的帧没有 RO 日志）。

### 一个易混点（与 IO 对比）

| 观察器 | 回调执行位置 | 规范用语 |
| ------ | ------------ | -------- |
| ResizeObserver | Update Rendering 内部（rAF 后、paint 前） | run the resize observation steps |
| IntersectionObserver | **计算**在渲染阶段，**回调**通过 queue a task 派发到宏任务队列 | queue a task |

### 相关笔记

- [[Update Rendering 阶段详解]]
- [[HTML规范-update-the-rendering-原文]]
- [[浏览器事件循环(EventLoop)]]
