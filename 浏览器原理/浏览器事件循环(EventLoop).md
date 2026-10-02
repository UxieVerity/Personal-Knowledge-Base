
## 1. 事件循环总览

根据 HTML Living Standard §9.6 Processing Model，每一轮事件循环的完整流程如下：
[[浏览器事件循环流程图.canvas]]

```
┌─────────────────────────────────────────────────────────┐
│              一轮事件循环 (Event Loop Turn)               │
│                                                         │
│  ① 取出并执行一个宏任务 (Task)                             │
│     ↓                                                   │
│  ② 排空微任务队列 (Microtask Checkpoint)                  │
│     ↓                                                   │
│  ③ 判断是否需要更新渲染                                    │
│     ├─ 否 → 跳到 ⑤                                       │
│     └─ 是 ↓                                             │
│  ④ 🎨 Update Rendering（独立阶段）                        │
│     ↓                                                   │
│  ⑤ 运行空闲回调 (requestIdleCallback)                     │
│     ↓                                                   │
│  ↩️ 回到 ①                                               │
└─────────────────────────────────────────────────────────┘
```

[[宏任务（task）]]
[[微任务（microtask）]]
[[Update Rendering 阶段详解]]
[[ResizeObserver-vs-rAF-执行顺序]]
### 各阶段核心特征

| 阶段             | 队列/机制          | 执行保证     | 可被跳过 |
| ---------------- | ------------------ | ------------ | -------- |
| 宏任务           | Task Queue         | 队列非空即取 | ❌        |
| 微任务           | Microtask Queue    | 每轮必清空   | ❌        |
| Update Rendering | 浏览器内部调度     | 无保证       | ✅ 可跳过 |
| 空闲回调         | Idle Callback List | 无保证       | ✅ 可跳过 |

------

## 2. requestIdleCallback 的定位

### 结论

`requestIdleCallback`（rIC）**既不是微任务，也不是传统意义上的宏任务**，它是一个独立的、优先级最低的调度机制。

### 执行位置

```
[宏任务] → [微任务(必须做完)] → [渲染(必须做完)] → [空闲回调(有空才做)] → [下一个宏任务]
```

### 与其他机制的对比

| 维度       | 微任务                  | requestAnimationFrame         | requestIdleCallback        |
| -------- | -------------------- | ----------------------------- | -------------------------- |
| **规范归属** | HTML §8.6 Microtasks | HTML §9.3 Animation Frames    | W3C Cooperative Scheduling |
| **队列类型** | Microtask Queue      | Animation Frame Callback List | Idle Callback List         |
| **执行保证** | 每轮事件循环**必清空**        | 每帧渲染前**必执行**                  | **无保证**，仅在空闲时执行            |
| **阻塞渲染** | ✅ 是                  | ✅ 是（当帧内）                      | ❌ 否                        |
| **超时机制** | 无                    | 无                             | 有（`timeout` 选项）            |
| **回调参数** | 无                    | timestamp                     | `IdleDeadline` 对象          |

### 常见误解来源

1. 都是"异步回调"，表面上和 `Promise.then` 一样是延迟执行
2. 名字带 "Callback"，与微任务的命名风格相似
3. 部分教程将所有非宏任务的异步都笼统称为"微任务"

### 正确的心智模型

```
[宏任务] → [微任务(必须做完)] → [渲染(必须做完)] → [空闲回调(有空才做)] → [下一个宏任务]
                                    ↑                      ↑
                              用户体验的关键            可被完全跳过
```

> **一句话总结**：`requestIdleCallback` 是一个独立于微任务和宏任务之外的第三类调度机制，它的优先级低于两者，且不保证执行。

------

## 3. UI 渲染的独立性

### 结论

UI 渲染（Update Rendering）**既不是宏任务，也不是微任务**。它是事件循环中一个独立的、与任务队列平行的阶段。

### 与宏任务的本质区别

| 维度             | 宏任务 (Task)                             | UI 渲染 (Update Rendering)         |
| ---------------- | ----------------------------------------- | ---------------------------------- |
| **来源**         | Task Queue（setTimeout、I/O、用户事件等） | 浏览器内部调度，不由任何队列驱动   |
| **触发条件**     | 队列非空即取                              | 由刷新率、脏标记、可见性等综合决定 |
| **可被跳过**     | ❌ 队列中的任务终会执行                    | ✅ 若无需更新或页面不可见，整轮跳过 |
| **执行时长**     | 无上限（可能阻塞）                        | 受帧预算约束（~16.7ms @60fps）     |
| **规范归属**     | HTML §8.7 Task Queues                     | HTML §9.6 Update the rendering     |
| **能否主动入队** | ✅ setTimeout / postMessage 等             | ❌ 只能通过修改 DOM/CSS 间接触发    |

### 常见误解来源

1. "渲染发生在宏任务之后" → 被简化为"渲染是下一个宏任务"
2. rAF 回调看起来像异步任务 → 但 rAF 只是注册到渲染阶段的回调列表
3. 早期资料不精确 → 将"非微任务的异步"统称为宏任务

### 关键推论

理解了渲染的独立性，以下现象就能自然解释：

- **连续修改 DOM 只触发一次渲染**：渲染不在每次 DOM 操作后执行，而是在当前宏任务+微任务全部完成后统一进行
- **`getComputedStyle` 强制同步布局**：它不是在"等待渲染"，而是在渲染阶段之前插入了一个即时 Layout 计算
- **`requestAnimationFrame` 比 `setTimeout(fn, 0)` 更适合动画**：rAF 挂在渲染阶段内，保证与屏幕刷新同步
- **页面隐藏时渲染被暂停**：浏览器检测到不可见时直接跳过渲染步骤，而宏任务队列仍会继续消费

------

## 4. 三大 Observer 的本质区别

### 常见误解

> "IntersectionObserver 和 ResizeObserver 是微任务，在 Update Rendering 阶段执行"

这个说法**不完全准确**：

- **ResizeObserver** ✅ 确实在 Update Rendering 阶段执行，但它**不是微任务**
- **IntersectionObserver** ❌ **不在** Update Rendering 阶段执行回调，它是**独立的宏任务**

### 详细分析

#### MutationObserver — 真正的微任务

- 规范用语：*queue a microtask*
- 执行位置：微任务检查点（渲染前）
- 回调中修改 DOM → 触发下一轮微任务 + 渲染

#### ResizeObserver — 渲染阶段内置步骤

- 规范用语：*run the resize observation steps*
- 执行位置：Update Rendering 阶段内部（rAF 之后、样式+布局完成后，Step 16 的递送循环内）
- 🔑 **关键特性**：回调执行后如果导致尺寸再次变化，浏览器会在**同一帧内重新运行 Layout + ResizeObserver**，形成循环
- 规范限制最大循环次数（Chrome 为 10 次），超出后抛出 `ResizeObserver loop limit exceeded` 错误

```javascript
// ResizeObserver 可以在同帧内响应自身引起的尺寸变化
const ro = new ResizeObserver((entries) => {
  // 这里修改容器尺寸 → 可能触发同帧第二轮 RO 回调
  container.style.height = `${entries[0].contentRect.width * 0.75}px`;
});
ro.observe(container);
```

#### IntersectionObserver — 独立宏任务

- 规范用语：*queue a task*（注意是 task，不是 microtask）
- 交叉状态**计算**在 Update Rendering 阶段完成（基于刚完成的 Layout 结果）
- 但回调**派发**是通过 `queue a task` 到宏任务队列，在**后续事件循环**中执行
- ⚠️ 计算和通知之间存在至少一个任务边界

### 完整对比表

| 特性             | MutationObserver      | ResizeObserver               | IntersectionObserver |
| ---------------- | --------------------- | ---------------------------- | -------------------- |
| **队列类型**     | 微任务                | 渲染阶段内置步骤             | 宏任务 (Task)        |
| **执行阶段**     | 微任务检查点          | Update Rendering 内          | 独立 Task            |
| **与渲染的关系** | 渲染前完成            | 渲染中执行，可触发同帧重排   | 渲染后异步通知       |
| **回调中改 DOM** | 触发下一轮微任务+渲染 | 可能触发同帧额外 Layout pass | 延迟到下一轮渲染     |
| **规范用语**     | queue a microtask     | run resize observation steps | queue a task         |
| **典型用途**     | DOM 变更监听          | 元素尺寸响应式布局           | 懒加载、曝光埋点     |

### 实践影响

```javascript
// ResizeObserver：回调中读取尺寸是"当前帧"的值
ro.observe(el);
// 回调里 entry.contentRect → 反映本帧最新布局

// IntersectionObserver：回调中的信息可能是"上一帧"的快照
io.observe(el);
// 回调里 entry.boundingClientRect → 不保证是当前帧的值
// 且回调本身作为宏任务，执行时渲染早已完成
```

------

## 6. 性能优化实践指南

### 时间预算

以 60fps 为例，整个 Update Rendering 必须在 **~16.7ms** 内完成：

```
理想分配（经验值）：
  JS (rAF + RO)    ≈ 4-6ms
  Style            ≈ 2-3ms  
  Layout           ≈ 3-5ms
  Paint + Composite ≈ 2-3ms
  ─────────────────────
  总计             ≤ 16.7ms

超出 → 掉帧 → 用户感知卡顿
```

### 核心优化原则

| 原则                                | 说明                                       |
| ----------------------------------- | ------------------------------------------ |
| **rAF 只做视觉写入**                | 不做数据计算，不读取几何属性               |
| **RO 回调使用 entry.contentRect**   | 避免在回调中读取 `getBoundingClientRect()` |
| **IO 不用于精确布局联动**           | 其异步性质决定了存在时序偏差               |
| **批量 DOM 操作**                   | 减少 Style/Layout 触发次数                 |
| **优先使用 transform/opacity 动画** | 跳过 Layout/Paint，仅 Compositing          |
| **避免读写交替**                    | 防止 Forced Synchronous Layout             |

### 调试工具

- **Performance API**：`PerformanceObserver` 监听 `layout-shift` / `long-animation-frame` 等条目
- **DevTools Performance 面板**：录制后可直观看到 Update Rendering 内每个子步骤的火焰图
- **Rendering 面板**：开启 Paint Flashing / Layout Shift Regions 可视化渲染区域

------

## 附录：完整概念速查表

| 概念                            | 类型     | 执行阶段           | 执行保证       |
| ----------------------------- | ------ | -------------- | ---------- |
| setTimeout / setInterval      | 宏任务    | 事件循环步骤 ①       | 有（延迟后）     |
| Promise.then / queueMicrotask | 微任务    | 事件循环步骤 ②       | 有（当轮必清空）   |
| MutationObserver              | 微任务    | 事件循环步骤 ②       | 有          |
| requestAnimationFrame         | 渲染阶段回调 | 事件循环步骤 ④ (Step 14) | 有（每帧）      |
| ResizeObserver                | 渲染阶段步骤 | 事件循环步骤 ④ (Step 16，rAF 之后) | 有（尺寸变化时）   |
| IntersectionObserver 计算       | 渲染阶段步骤 | 事件循环步骤 ④ (Step 19) | 有          |
| IntersectionObserver 回调       | 宏任务    | 后续事件循环步骤 ①     | 有（异步延迟）    |
| requestIdleCallback           | 空闲回调   | 事件循环步骤 ⑤       | **无**      |
| UI 渲染本身                       | 独立阶段   | 事件循环步骤 ④       | **无**（可跳过） |

------

*本文档基于 HTML Living Standard §8.6 / §8.7 / §9.3 / §9.6、CSSOM View Module、Intersection Observer Spec、Resize Observer Spec 整理。*