# scroll 中的强制同步布局（Forced Synchronous Layout）

> **结论：scroll 事件回调里的几何读取（`offsetTop/offsetHeight/getBoundingClientRect/scrollTop` 等）一旦遇到尚未应用的样式变更，就会立刻触发一次同步 Layout（Reflow），把本该合并到下一渲染帧的布局计算**提前**到当前 JS 执行中间。读得越频繁、布局树越大、读写交替越乱，卡顿越明显。**
>
> 最坏形态是 **Layout Thrashing**：在滚动回调里「写→读→写→读」反复交替，每次读都强制重排一次，一帧内重排几十上百次。

可运行验证：[[scroll中的强制同步布局-demo.html]]

---

## 一、背景：滚动是一个高频事件

- scroll 事件在**每次滚动偏移变化时**触发（现代浏览器为 passive，默认不阻止合成线程）。
- 一个普通的滚轮手势、拖动滚动条或 JS `scrollTop +=` 都会在**短时间内派发大量 scroll 事件**——实测 200 帧匀速滚动触发 **200 个** scroll 事件。
- 如果每个 scroll 事件回调里都做「先改样式、再读几何」，就等于**每次滚动都付一次全量 Reflow 的钱**。

---

## 二、什么是"强制同步布局"

正常情况下，渲染是**异步、批量**的：

```
[JS 修改样式] ──（打脏标记，不立即算）──> [本帧 Update Rendering] 统一算 Style + Layout
```

但当 JS 在两次渲染之间**读取几何属性**时，浏览器无法回答——因为答案取决于还没算的布局。于是浏览器被迫**放弃批处理，立刻算一遍布局**：

```
[JS 改样式 → 打脏标记] → [JS 读 offsetHeight] → ⚡ 立即 Reflow（同步、阻塞）→ 返回结果
```

- ✅ **不脏时读取**：样式无变化，布局缓存有效 → 近似 O(1)，几乎零成本
- ⚠️ **脏时读取**：有未应用的样式变更 → 必须同步重排 → 成本 = 一次完整 Layout
- 这一"被迫提前的布局"就叫 **Forced Synchronous Layout**；在 scroll 回调里反复做就叫 **Layout Thrashing**。

---

## 三、实测数据（Chrome headless，真实布局引擎）

> 环境：Chrome（系统安装版）headless，`--disable-gpu`，页面含 **500 个列表项**作为 Layout 成本来源。完整源码见 [[scroll中的强制同步布局-demo.html]]。

### 实验 1：单次读取 offsetHeight 的成本（2000 次受控对照，同一元素）

| 读取方式 | 总耗时 | 每读耗时 | 倍率 |
| -------- | ----- | ------- | ---- |
| 干净读取（样式无变化） | 2.3 ms | **≈ 1.2 µs** | 1× |
| 脏读取（读前改 width） | 563.5 ms | **≈ 282 µs** | **≈ 245×** |

> 💡 一次强制布局 ≈ **282 µs**。在 16.7ms 的帧预算里，**约 59 次**这样的强制布局就占满整帧。滚动回调往往一帧不止触发一次——代价立刻可见。

### 实验 2：四种 scroll 写法对比（同一容器，200 帧匀速滚动）

| 写法 | 平均每次 handler 耗时 | 相对 rAF 批处理 |
| ---- | -------------------- | -------------- |
| ① 只读不写（读 scrollTop + gBCR） | ≈ 33 µs | 1.6× |
| ② 只写不读（写 transform） | ≈ 30 µs | 1.5× |
| ③ 读写交替（读→写 top→再读 offsetHeight） | **≈ 256 µs** | **12.5×** |
| ④ rAF 批处理（scroll 只记值，rAF 写一次） | ≈ 20 µs | **1×（基线）** |

> 🔑 同一个页面、同样的滚动量，**只改变回调里的读写姿势**，最坏写法比最佳写法慢 **12 倍以上**。
> 注：① 的 33µs 含 scroll 事件本身派发 + 事件处理开销（gBCR 读取在容器未变时走缓存，故接近只写）；③ 因每次「写 top 使布局失效 → 读 offsetHeight 强制重排」，把强制布局成本吃满了。

### 为什么 ③ 特别慢

```javascript
function onScroll() {
  const top = scroller.scrollTop;      // 读（此时干净，缓存有效）
  stick.style.top = top + 'px';        // 写 top → 使布局失效（脏）
  const h = stick.offsetHeight;        // 读 → ⚡ 必须强制重排
  // ↑ 下一次 onScroll 又重复这个循环 → 每帧 N 次全量 Reflow
}
```

每一对「失效 + 读取」都产生一次完整 Layout。500 个元素 × 反复重排 → 滚一屏做几十次全量布局。

---

## 四、哪些属性会触发强制同步布局

### 读取侧（读这些会迫使浏览器算布局）

- `offsetTop / offsetLeft / offsetWidth / offsetHeight`
- `clientTop / clientLeft / clientWidth / clientHeight`
- `scrollTop / scrollLeft / scrollWidth / scrollHeight`
- `getComputedStyle(el)`（读取 `width/height/left/top` 等**几何相关**样式时）
- `getBoundingClientRect()` / `getClientRects()`
- 部分 `range.getBoundingClientRect()` 等

> ⚠️ **关于 `getBoundingClientRect()` 的常见误解**：老文章常说"调 gBCR 就强制重排"。**不准确。** gBCR 和 `offsetWidth` 一样，**触不触发重排只看读取时布局是否失效**：
>
> | 读取方式 | 干净读耗时 | 弄脏后读耗时 |
> | --- | --- | --- |
> | `getBoundingClientRect()` | **0.56 µs**（命中缓存） | 8.86 µs（强制重排） |
> | `offsetWidth` | 0.34 µs | 10.2 µs |
>
> 实测（Chrome headless，2 万次）：gBCR **干净时 0.56 µs，不重排**；弄脏后才 8.86 µs。gBCR 干净读比 offsetWidth 略贵（0.56 vs 0.34 µs）只是**构造矩形对象的 API 开销**，不是布局成本。
>
> 滚动场景（LayoutCount 实测）：scroll 回调**只读 gBCR**（无脏数据）滚动 60 次 → 布局次数 = **1**（≈0 次/每次 scroll）；**写了 margin 再读 gBCR** → 60 次布局（每次 scroll 一次）。

### 写入侧（写这些会"弄脏"布局，使下一次读取必须重排）

- 改变盒模型几何：`width / height / margin / padding / border / top / left / right / bottom`
- 改变字体、字号、行高等影响行高的属性
- 增删 DOM 节点、改 `display`、改 `position` 等结构性变化
- 注意：**`transform` / `opacity` 不会弄脏布局**——这正是实验 ② 与 ④ 便宜的原因（走合成器）。

> ⚠️ 触发与否取决于**读取时布局是否已失效**。若读取时没有任何待应用的样式变更，浏览器直接用缓存，不重排。所以"读了就慢"是错的，**"弄脏后再读"才慢**。

---

### ⚠️ 关键澄清："读 width 但 width 没改，会重排吗？"

> 实测（Chrome headless，20000 次读取对照，同一页面）：

| 场景 | 每读耗时 | 是否重排 |
| --- | --- | --- |
| ① 全页干净，读 `offsetWidth` | 0.33 µs | ❌ 命中缓存 |
| ② 改了本元素 `width`，读 `offsetWidth` | 6.60 µs | ✅ 强制重排 |
| **③ 改了别的属性（margin），读 width** | **7.08 µs** | ✅ **重排（width 没被改也重排）** |
| **④ 改了别的元素的 width，读本元素 width** | **6.38 µs** | ✅ **重排（别的元素脏了也重排）** |
| ⑤ 改 `transform`（不脏布局），读 width | 3.05 µs | ⚠️ 仅 style 重算，无 layout |
| ⑥ 改 width，用 `getComputedStyle().width` 读 | 7.92 µs | ✅ 重排（读几何相关样式） |
| ⑦ 改 width，读 `el.style.width`（内联字符串） | 2.30 µs | ❌ 不重排（非布局属性） |

**结论：触发与否不取决于"读哪个属性"，而取决于"读取那一刻布局是否已失效"。**

- 读 `width` 但 width 本身没改 → **只要页面有任何其他几何变更（改 margin / 改别的元素 / 增删节点 / 改字体）弄脏了布局，照样重排**（见 ③④）。
- 因为布局是**页面级、整体的**：任何一处失效，读取**任何元素**的几何都要先全量重算。
- 补充实验（F/G）：强制重排只发生在"失效后的**第一次**读取"，之后连续读同一布局全部命中缓存（0.4 µs），直到再次弄脏。

**区分两类读取：**

| 读取方式 | 本质 | 弄脏后 |
| --- | --- | --- |
| `offsetWidth / offsetHeight / clientHeight / gBCR` | 读取**布局结果** | ✅ 强制重排 |
| `getComputedStyle().width` | 读取**计算样式**（几何相关项） | ✅ 强制重排 |
| `el.style.width` | 读取**内联样式字符串** | ❌ 不重排（纯 JS 属性） |

---

## 五、scroll 场景的规范位置

scroll 事件本身是 **Update Rendering 阶段内的一个子步骤**（见 [[Update Rendering 阶段详解]] 的 Step 2.5 滚动事件），但 scroll **回调里的 JS 是在事件派发时同步执行的**：

```
[用户滚动] → 合成线程/主线程更新滚动偏移
         → 派发 scroll 事件（passive，不阻塞）
         → 回调里读几何 → 此刻若有脏样式 → 强制同步布局（挤占本帧预算）
         → … 下一帧 Update Rendering 正常执行
```

也就是说：强制同步布局不是 Update Rendering 的"正规子步骤"，而是**渲染阶段被 JS 中途劫持**产生的额外 Layout pass，不消耗在"正常的 Style+Layout"里，而是叠加在 JS 执行时间上。

### ⚠️ 关键澄清：scroll 本身会弄脏布局吗？（实测 LayoutCount）

> 常见误解："scroll 事件每次都改变布局，所以 scroll 回调里不管读什么几何都会强制重排。"
>
> **❌ 错。scroll 本身不弄脏布局** —— 滚动改的是滚动偏移量（scrollTop），走合成线程，盒子几何没变，布局树是干净的。

**实测（Chrome headless，`Performance.getMetrics` 的 LayoutCount = 真实布局执行次数，每场景滚动 60 次）：**

| 场景 | scroll 事件次数 | 布局次数 | 每次 scroll 的布局 |
| --- | --- | --- | --- |
| **A：scroll 回调只读 `offsetHeight`（不写样式）** | 59 | **1** | **≈ 0 次**（仅启动那次） |
| **B：scroll 回调写 `marginLeft` + 读 `offsetHeight`** | 59 | **60** | **≈ 1 次/每次 scroll** |
| **C：scroll 回调只读 `getBoundingClientRect()`** | 59 | **1** | **≈ 0 次** |

**结论（完整因果链）：**

```
scroll 回调里【写】了几何样式（margin/width/top...）→ 布局被弄脏
   ↓
scroll 回调里又【读】了几何属性（offsetHeight/gBCR...）
   ↓
浏览器无法回答（布局已失效）→ 强制同步重排
```

- **不是"scroll 弄脏了布局"，而是"scroll 回调里的『写』弄脏了布局"**。
- 场景 A/C 证明：scroll 回调里**只读不写**时，读多少几何属性都**不会**触发强制重排（布局一直干净，命中缓存）。
- 所以"scroll 里读几何必重排"是错的；正确的是"**scroll 里写了几何再读才重排**"。这也解释了为什么最恶心的写法（③读写交替）每次 scroll 都付一次全量 Reflow 的代价。

---

## 六、为什么这么设计？（背后取舍）

1. **JS 必须能读到"此刻"的几何**：`el.offsetHeight` 语义是"现在的实际高度"，浏览器不能给一个过期值，否则大量依赖几何运算的库（拖拽、虚拟滚动、图表）都会出错。**正确性优先于性能**。
2. **同步是为了 API 简单**：如果返回一个"过一会儿才填好的 Promise"，所有读取几何的代码都得变成异步，代价远大于偶尔的强制重排。
3. **批处理是默认的优化**：浏览器假定你不会在两次渲染间频繁读几何，所以默认把 Style/Layout 推迟到渲染阶段统一做；强制同步布局是对"意外读取"的兜底，而不是设计目标。

> 一句话：**浏览器用「批处理」换性能，用「强制同步布局」换正确性**——代价由写坏代码的人买单。

---

## 七、scroll 中如何避免强制同步布局

| 做法 | 原理 |
| ---- | ---- |
| **rAF 批处理（最推荐）** | scroll 回调里只记一个数，真正的读写挪到下一帧 rAF 统一做一次 → 每帧最多一次 Layout |
| **只读不写 / 只写不读 分离** | 不让"失效"和"读取"在同一回调里交替 |
| **用 `transform` 做跟随动画** | 不弄脏布局，走合成器，0 重排（吸顶条首选） |
| **缓存几何值** | 一帧内多次要读同一值，读一次存变量 |
| **批量 DOM 写** | 先全部改完，再一次读取（读写分离，见下方代码） |

```javascript
// ❌ Layout Thrashing
function onScroll() {
  const a = el.offsetHeight;          // 读
  el.style.height = (a * 0.5) + 'px'; // 写 → 失效
  const b = el.offsetHeight;          // 读 → 强制重排
  el.style.width  = (b * 0.5) + 'px'; // 写 → 失效
  const c = el.offsetWidth;           // 读 → 再次强制重排 💥
}

// ✅ rAF 批处理（scroll 只存值，rAF 一次性写）
let pending = null;
window.addEventListener('scroll', () => { pending = scroller.scrollTop; }, { passive: true });
requestAnimationFrame(() => {
  if (pending !== null) {
    stick.style.transform = `translateY(${pending}px)`;  // transform，不重排
    pending = null;
  }
});

// ✅ 读写分离：先读完，再一起写
const rects = items.map(el => el.getBoundingClientRect()); // 一次性读（缓存）
for (let i = 0; i < rects.length; i++) {
  items[i].style.top = (rects[i].top + offset) + 'px';     // 再一起写
}
```

---

## 八、补充：scroll 事件与 passive 的关系（什么时候加 passive 才有效）

> ⚠️ **核心结论**：给 **`scroll`** 事件加 `passive: true`，**永远没有优化效果**（scroll 不可取消，浏览器本来就不用等它）。passive 的优化价值只在 **`touchmove` / `touchstart` / `wheel`** 这些"滚动前、可被 preventDefault 拦截"的事件上体现。

### 为什么 scroll 加 passive 无效

`passive: true` 的本质是承诺"我不会 `preventDefault`，浏览器**不用等我的 JS 跑完就能提前开始滚动**"。但：

- **scroll 事件不可取消**（实测 `cancelable === false`），它只是"滚动已经发生"的**通知**，不存在"默认滚动行为"可以被 preventDefault
- 浏览器**从来不需要等 scroll 监听器**来判断要不要滚动 → passive 无从优化

> 实测（Chrome headless）：`scroll.cancelable === false`；scroll 回调里调 `preventDefault()` → `defaultPrevented === false`（无效）。

### 各事件的 passive 优化效果矩阵

| 事件 | 含义 | 可取消 | passive:true 有效？ | 默认值（现代浏览器） |
| --- | --- | --- | --- | --- |
| **`touchmove`** | 手指滑动中 | ✅ | 🔥 **最有效**（移动端滚动流畅关键） | document 级默认 passive（Chrome 56+） |
| **`touchstart`** | 手指按下 | ✅ | ✅ 有效（手势场景） | document 级默认 passive |
| **`wheel`** | 滚轮滚动 | ✅ | ✅ 有效（桌面滚轮） | 默认 passive（Chrome 73+） |
| **`scroll`** | 滚动已发生（通知） | ❌ | ❌ 无效（无害） | 总是 passive |
| `touchend`/`touchcancel` | 松手/取消 | ❌ | ❌ 无效 | 非 passive |

### ✅ 什么时候加 passive 有效果（应用场景）

1. **移动端监听 `touchmove` 做滑动方向检测 / 视差 / 懒加载判断**，但不拦截滚动 → 加 passive，滚动立即开始不卡
2. **桌面监听 `wheel` 做上滑加载 / 滚轮节流**，不需要 preventDefault → 加 passive
3. **任何"只观察、不拦截"的 touch/wheel 监听** → 加 passive 消除"等待 JS 确认是否拦截"的延迟

### ❌ 什么时候 passive 无效 / 有坑

1. **`scroll` 事件**：加不加 passive 无差别（无害）。习惯性写上可以，但别指望它优化 scroll
2. **需要 `preventDefault` 的场景**（自定义滚动、弹窗滚动穿透控制、移动端橡皮筋、禁用页面滚动）：
   - ⚠️ 必须显式 **`{ passive: false }`**，否则 preventDefault 被静默忽略（touch/wheel 现代默认 passive）
   - 例子：想锁背景滚动却写成 `document.addEventListener('touchmove', e => e.preventDefault())` **无效**，要加 `{ passive: false }`

### ⚠️ 澄清："passive:false 时 preventDefault 能阻止滚动"说的是哪些事件？

> 常见困惑："scroll 是滚动后的，为什么 passive:false + preventDefault 能阻止滚动？"
>
> **答：能阻止滚动的是 `wheel` / `touchmove`（滚动前、可取消），不是 `scroll`。** `passive:false` 只是"解锁 preventDefault 的权限"，但前提是事件本身可取消（cancelable）。scroll 永远不可取消，passive:false 对它无济于事。

**preventDefault 能否阻止滚动 = 两个条件同时满足：**

```
① 事件可取消（cancelable === true）  ← 由事件类型决定：wheel/touchmove=true，scroll=false
② 监听器允许 preventDefault（passive:false） ← 由注册选项决定
```

**实测（Chrome headless，派发可取消的 WheelEvent）：**

| 场景 | defaultPrevented | dispatchEvent 返回 | 能阻止滚动？ |
| --- | --- | --- | --- |
| wheel `{passive:false}` + preventDefault | **true** | **false** | ✅ 生效 |
| wheel `{passive:true}` + preventDefault | **false** | **true** | ❌ 被忽略 |
| wheel 不传选项（默认） + preventDefault | true | false | ✅ 生效 |

**机制：**
- `wheel`/`touchmove` 是"滚动前"的驱动事件，它们的**默认动作就是"执行滚动"**，所以 preventDefault 能取消它
- `scroll` 是"滚动后"的通知，**没有"执行滚动"这个默认动作**（滚动已经发生了），所以 preventDefault 无处可取消
- `passive` 只控制第②条（preventDefault 是否被允许），不能改变第①条（事件是否可取消）

### passive 与强制同步布局是两回事

- passive 只解决"**浏览器要不要等 JS 再滚动**"（事件契约层）
- 回调里的读写（强制同步布局）**passive 管不到**——哪怕 passive:true，回调里写了几何再读照样重排
- 所以优化要分开：**passive 管滚动是否阻塞，rAF 批处理/transform 管回调里的布局抖动**

---

## 九、与知识库其他笔记的关联

- [[Update Rendering 阶段详解]] —— scroll 事件在渲染阶段的子步骤位置；Style/Layout 是其中独立步骤，强制同步布局是这些步骤被 JS 中途"提前触发"
- [[浏览器事件循环(EventLoop)]] —— 渲染阶段（含 scroll 派发）在宏任务+微任务之后统一进行，解释了为什么"不脏时读取"能命中缓存
- [[ResizeObserver-vs-rAF-执行顺序]] —— 同属"渲染阶段被 JS 触发额外计算"的话题，rAF 批处理思路一脉相承
- [[dialog阻止背景滚动-方案对比]] —— passive:false 的实战应用（移动端 touchmove 锁背景滚动）

---

*本文档基于 HTML Living Standard（update the rendering / scrolling）、CSSOM View Module（几何属性定义）、Performance API 实测整理。实测数据来自 Chrome（headless）真实布局引擎，环境不同数值会有差异，但相对倍率稳定。*
