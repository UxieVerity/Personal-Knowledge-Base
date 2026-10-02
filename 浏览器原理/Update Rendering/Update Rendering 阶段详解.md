
### 触发条件

并非每轮事件循环都会执行渲染。浏览器会先判断：

1. **帧预算检查**：距离上次渲染是否已达到刷新率间隔（60Hz → ~16.7ms）
2. **脏标记检查**：是否有 DOM/CSS 变更、rAF 注册、ResizeObserver 监听等"渲染需求"
3. **可见性检查**：页面是否处于后台/隐藏标签页（`document.hidden === true` 时通常跳过）
4. **节能策略**：低电量/低功耗模式下可能降频

### 完整子步骤（严格按序）

```
┌──────────────────────────────────────────────────────────┐
│              Update Rendering 阶段                        │
│                                                          │
│  Step 1: 获取待渲染文档列表                                 │
│    ↓                                                     │
│  对每个文档，按以下【规范步骤号】顺序执行：                    │
│    ├─ Step 8   resize 事件（视口变化）                     │
│    ├─ Step 9   scroll 事件（scrollend 也在附近）           │
│    ├─ Step 11  CSS 动画 / 过渡 状态更新                    │
│    ├─ Step 14  rAF 回调 (Animation Frame Callbacks)       │
│    ├─ Step 16  强制样式 + 布局 → ResizeObserver 递送循环     │
│    ├─ Step 19  IntersectionObserver 交叉状态计算*          │
│    └─ Step 22  Paint / 呈现                                │
│    ↓                                                     │
│  Step 3: 通知各文档渲染已完成                               │
└──────────────────────────────────────────────────────────┘

*注：IO 的状态计算在此阶段完成，但回调通过 queue a task 异步派发，
   不在本阶段内执行。
```

> ✅ **顺序速记（已实测验证）**：`resize / scroll 事件 → rAF → 样式/布局 → RO → IO 计算 → Paint`
> scroll、resize 事件在 **rAF 之前**派发（规范 Step 8/9 < 14）；RO 在 **rAF 之后**（Step 16 > 14）。
> 规范原文见 [[HTML规范-update-the-rendering-原文]]；实测见 [[Update Rendering.html]] 和 [[ResizeObserver-vs-rAF-执行顺序]]

[[Update Rendering.html]]
### 各子步骤详解

#### Step 8 — resize 事件

- 视口（window / iframe 子视口）尺寸变化时派发 `resize` 事件
- ⚠️ 只能通过**真实改变视口**触发（拖动窗口/面板宽度），程序无法伪造 window resize
- 位于渲染阶段最开头，**先于 scroll 和 rAF**
- 实测：iframe 子视口变化时 `[resize-iframe]` 日志出现在 rAF 之前

#### Step 9 — scroll 事件

- 派发 `scroll` / `scrollend` 事件
- 现代浏览器默认将 scroll 事件标记为 **passive**
- ⚠️ 位于 **rAF 之前**（Step 9 < Step 14），是渲染阶段最早的步骤之一
- 可能在 compositing 线程处理（同步 scroll 事件仍走主线程）
- 实测日志（headless 逐帧时间戳）：
  ```
  scroll(34.9) = rAF-start#2(34.9)   ← scroll 恰在下一帧 rAF 之前派发
  ```

#### Step 11 — CSS 动画 / 过渡状态更新

- 推进所有 active 的 CSS Animation / Transition 的时间线
- 计算当前帧对应的插值
- 触发 `animationstart` / `animationiteration` / `transitionend` 等事件
- Web Animations API (`element.animate()`) 也在此步更新

#### Step 14 — rAF 回调

- 执行所有通过 `requestAnimationFrame(cb)` 注册的回调
- 传入参数为当前帧的 **DOMHighResTimeStamp**
- ✅ 回调中修改 DOM/CSS **会影响本帧渲染**
- ❌ 回调中读取几何属性会触发**强制同步布局**
- 若回调中再次调用 rAF，新回调注册到**下一帧**

```javascript
// ✅ 正确：只写不读
requestAnimationFrame(() => {
  el.style.transform = `translateX(${x}px)`;
});

// ❌ 危险：读写交替触发 Forced Reflow
requestAnimationFrame(() => {
  const width = el.offsetWidth;       // 强制 Layout
  el.style.width = `${width + 10}px`; // 使 Layout 失效
  const height = el.offsetHeight;     // 再次强制 Layout 💥
});
```

#### Step 16 — 样式/布局 + ResizeObserver 递送循环

- 重新计算样式（Style Recalculation）→ 更新布局（Layout / Reflow）
- 布局完成后，检查所有被观察元素的内容框尺寸是否与上次记录不同
- 若有变化，执行 ResizeObserver 回调，传入 `ResizeObserverEntry[]`
- 🔑 回调执行后如果导致尺寸再次变化，浏览器会在**同一帧内重新运行 Layout + ResizeObserver**（`while` 循环）
- Chrome 限制最大循环次数为 **10 次**

> ⚠️ **执行顺序提醒**：ResizeObserver 回调在 **rAF 回调之后**递送（Step 16 > Step 14），rAF 改的尺寸本帧 RO 收不到，要到下一帧。详见 [[ResizeObserver-vs-rAF-执行顺序]]

#### Step 19 — IntersectionObserver 交叉状态计算

- 基于刚完成的 Layout 结果，计算所有被观察元素与 root 的交叉比例
- 将状态变更记录到内部队列
- ⚠️ **仅计算，不执行回调**
- 回调通过 `queue a task` 派发到宏任务队列

#### Step 22 — Paint（绘制 / 呈现）

- 将 Layout Tree 转换为 Paint Instructions（绘制指令列表）
- 生成 Layer Tree（分层）
- 栅格化（Rasterization）：将矢量绘制指令转为位图纹理
- 通常在 GPU 进程/Compositor Thread 上异步栅格化
- 合成（Compositing）：应用 transform / opacity 等 GPU 加速属性，提交给显示系统
- ✅ 这一步完成后，用户才能看到视觉更新