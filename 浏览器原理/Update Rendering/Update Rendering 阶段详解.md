
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
│  Step 2: 对每个文档，按以下顺序执行：                         │
│    ├─ 2.1  (resize/scroll)滚动事件                        │
│    ├─ 2.2  ResizeObserver 回调                            │
│    ├─ 2.3  rAF 回调 (Animation Frame Callbacks)           │
│    ├─ 2.4  CSS 动画/过渡 状态更新                           │
│    ├─ 2.5  Style Recalculation (样式计算)                  │
│    ├─ 2.6  Layout (布局/重排)                              │
│    ├─ 2.7  Paint (绘制)                                   │
│    ├─ 2.8  IntersectionObserver 交叉状态计算*              │
│    └─ 2.9  Compositing (合成)                             │
│    ↓                                                     │
│  Step 3: 通知各文档渲染已完成                               │
└──────────────────────────────────────────────────────────┘

*注：IO 的状态计算在此阶段完成，但回调通过 queue a task 异步派发，
   不在本阶段内执行。
```

### 各子步骤详解

#### Step 2.1 — rAF 回调

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

#### Step 2.2 — ResizeObserver 回调

- 检查所有被观察元素的内容框尺寸是否与上次记录不同
- 若有变化，执行回调，传入 `ResizeObserverEntry[]`
- 🔑 回调执行后如果导致尺寸再次变化，浏览器会在**同一帧内重新运行 Layout + ResizeObserver**
- Chrome 限制最大循环次数为 **10 次**

#### Step 2.3 — 滚动事件

- 派发 `scroll` / `scrollend` 事件
- 现代浏览器默认将 scroll 事件标记为 **passive**
- 可能在 compositing 线程处理

#### Step 2.4 — CSS 动画/过渡状态更新

- 推进所有 active 的 CSS Animation / Transition 的时间线
- 计算当前帧对应的插值
- 触发 `animationstart` / `animationiteration` / `transitionend` 等事件
- Web Animations API (`element.animate()`) 也在此步更新

#### Step 2.5 — Style Recalculation（样式计算）

- 遍历脏节点，重新匹配 CSS 选择器
- 计算 computed style
- 构建/更新 Style Tree
- 优化：Bloom Filter、Rule Map 加速选择器匹配；未变更子树被跳过

#### Step 2.6 — Layout（布局 / Reflow）

- 根据 Style Tree 计算每个盒子的几何信息（位置、大小）
- 构建 Layout Tree
- 增量布局：仅重新计算脏节点及其受影响祖先
- 🔴 **性能瓶颈高发区**

#### Step 2.7 — IntersectionObserver 交叉状态计算

- 基于刚完成的 Layout 结果，计算所有被观察元素与 root 的交叉比例
- 将状态变更记录到内部队列
- ⚠️ **仅计算，不执行回调**
- 回调通过 `queue a task` 派发到宏任务队列

#### Step 2.8 — Paint（绘制）

- 将 Layout Tree 转换为 Paint Instructions（绘制指令列表）
- 生成 Layer Tree（分层）
- 栅格化（Rasterization）：将矢量绘制指令转为位图纹理
- 通常在 GPU 进程/Compositor Thread 上异步栅格化

#### Step 2.9 — Compositing（合成）

- 将所有图层合成为最终的屏幕帧
- 应用 transform / opacity 等 GPU 加速属性
- 提交给显示系统（VSync 信号对齐）
- ✅ 这一步完成后，用户才能看到视觉更新