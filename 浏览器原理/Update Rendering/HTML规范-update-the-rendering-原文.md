# HTML Living Standard — Update the Rendering（规范原文）

> **来源**：[HTML Standard §8.1.7.3 Event loops — update the rendering](https://html.spec.whatwg.org/multipage/webappapis.html#update-the-rendering)
> 以下为 whatwg 官方规范原文（英文），步骤后 `` `// 中文` `` 为复习注释。
> 关联笔记：[[Update Rendering 阶段详解]] · [[ResizeObserver-vs-rAF-执行顺序]] · [[Update Rendering.html]]

---

## To update the rendering — 处理步骤原文

**01.** Let frameTimestamp be eventLoop's last render opportunity time. `// 取帧时间戳`

**02.** Let docs be all fully active `Document` objects whose relevant agent's event loop is eventLoop, sorted arbitrarily except that the following conditions must be met:

- Any `Document` B whose container document is A must be listed after A in the list.
- If there are two documents A and B that both have the same non-null container document C, then the order of A and B in the list must match the shadow-including tree order of their respective navigable containers in C's node tree.

In the steps below that iterate over docs, each `Document` must be processed in the order it is found in the list. `// 收集待渲染文档，按容器关系排序`

**03.** Filter non-renderable documents: Remove from docs any `Document` object doc for which any of the following are true: `// 过滤不可渲染文档`

- doc is render-blocked;
- doc's visibility state is "hidden";
- doc's rendering is suppressed for view transitions; or
- doc's node navigable doesn't currently have a rendering opportunity.

We have to check for rendering opportunities here, in addition to checking that in the in parallel steps, as some documents that share the same event loop might not have a rendering opportunity at the same time.

**04.** Unnecessary rendering: Remove from docs any `Document` object doc for which all of the following are true: `// 无可见变化且无 rAF → 跳过本帧渲染`

- the user agent believes that updating the rendering of doc's node navigable would have no visible effect; and
- doc's map of animation frame callbacks is empty.

**05.** Remove from docs all `Document` objects for which the user agent believes that it's preferable to skip updating the rendering for other reasons.

The step labeled *Filter non-renderable documents* prevents the user agent from updating the rendering when it is unable to present new content to the user.

The step labeled *Unnecessary rendering* prevents the user agent from updating the rendering when there's no new content to draw.

This step enables the user agent to prevent the steps below from running for other reasons, for example, to ensure certain tasks are executed immediately after each other, with only microtask checkpoints interleaved (and without, e.g., animation frame callbacks interleaved). Concretely, a user agent might wish to coalesce timer callbacks together, with no intermediate rendering updates.

**06.** For each doc of docs, reveal doc. `// 显示文档`

**07.** For each doc of docs, flush autofocus candidates for doc if its node navigable is a top-level traversable. `// 自动聚焦`

**08.** For each doc of docs, **run the resize steps** for doc. `// 🎯 resize 事件在此派发（先于 rAF）` [CSSOMVIEW]

**09.** For each doc of docs, **run the scroll steps** for doc. `// 🎯 scroll 事件在此派发（先于 rAF）` [CSSOMVIEW]

**10.** For each doc of docs, evaluate media queries and report changes for doc. `// 媒体查询上报` [CSSOMVIEW]

**11.** For each doc of docs, **update animations and send events** for doc, passing in relative high resolution time given frameTimestamp and doc's relevant global object as the timestamp. `// CSS 动画/过渡推进` [WEBANIMATIONS]

**12.** For each doc of docs, run the fullscreen steps for doc. [FULLSCREEN]

**13.** For each doc of docs, if the user agent detects that the backing storage associated with a `CanvasRenderingContext2D` or an `OffscreenCanvasRenderingContext2D`, context, has been lost, then it must run the context lost steps for each such context:

1. Let canvas be the value of context's `canvas` attribute, if context is a `CanvasRenderingContext2D`, or the associated `OffscreenCanvas` object for context otherwise.
2. Set context's context lost to true.
3. Reset the rendering context to its default state given context.
4. Let shouldRestore be the result of firing an event named `contextlost` at canvas, with the `cancelable` attribute initialized to true.
5. If shouldRestore is false, then abort these steps.
6. Attempt to restore context by creating a backing storage using context's attributes and associating them with context. If this fails, then abort these steps.
7. Set context's context lost to false.
8. Fire an event named `contextrestored` at canvas.

**14.** For each doc of docs, **run the animation frame callbacks** for doc, passing in the relative high resolution time given frameTimestamp and doc's relevant global object as the timestamp. `// 🎯 rAF 回调在此执行`

**15.** Let unsafeStyleAndLayoutStartTime be the unsafe shared current time. `// LoAF 计时起点`

**16.** For each doc of docs: `// 🎯 核心：样式/布局 + ResizeObserver 递送循环`

1. Let resizeObserverDepth be 0.
2. **While true:**
   1. **Recalculate styles and update layout for doc.** `// 先算样式 + 布局`
   2. Let hadInitialVisibleContentVisibilityDetermination be false.
   3. For each element element with "auto" used value of "content-visibility":
      1. Let checkForInitialDetermination be true if element's proximity to the viewport is not determined and it is not relevant to the user. Otherwise, let checkForInitialDetermination be false.
      2. Determine proximity to the viewport for element.
      3. If checkForInitialDetermination is true and element is now relevant to the user, then set hadInitialVisibleContentVisibilityDetermination to true.
   4. If hadInitialVisibleContentVisibilityDetermination is true, then continue.
   5. **Gather active resize observations at depth resizeObserverDepth for doc.** `// 收集本深度活动观察`
   6. **If doc has active resize observations:**
      1. Set resizeObserverDepth to the result of **broadcasting active resize observations** given doc. `// 递送 RO 回调`
      2. Continue. `// 循环：回调改尺寸 → 重新布局 → 再递送`
   7. Otherwise, break.
3. If doc has **skipped resize observations**, then **deliver resize loop error** given doc. `// 触发 ResizeObserver loop error`

**17.** For each doc of docs, if the focused area of doc is not a focusable area, then run the focusing steps for doc's viewport, and set doc's relevant global object's navigation API's focus changed during ongoing navigation to false. `// 焦点修正`

For example, this might happen because an element has the `hidden` attribute added, causing it to stop being rendered. It might also happen to an `input` element when the element gets disabled. This will usually fire `blur` events, and possibly `change` events.

**18.** For each doc of docs, perform pending transition operations for doc. [CSSVIEWTRANSITIONS]

**19.** For each doc of docs, **run the update intersection observations steps** for doc, passing in the relative high resolution time given now and doc's relevant global object as the timestamp. `// 🎯 IO 交叉状态计算（回调异步派发）` [INTERSECTIONOBSERVER]

**20.** For each doc of docs, record rendering time for doc given unsafeStyleAndLayoutStartTime. `// LoAF 记录渲染耗时`

**21.** For each doc of docs, mark paint timing for doc.

**22.** For each doc of docs, **update the rendering or user interface** of doc and its node navigable to reflect the current state. `// 🎯 Paint 呈现`

**23.** For each doc of docs, process top layer removals. `// 清理 top layer`

---

## 关键步骤速查（面试用）

| 规范步骤 | 内容 | 中文名 |
| --- | --- | --- |
| 01-07 | 文档收集 / 过滤 / reveal / 聚焦 | 预处理 |
| **08** | **run the resize steps** | **resize 事件**（先于 rAF） |
| **09** | **run the scroll steps** | **scroll 事件**（先于 rAF） |
| 10 | evaluate media queries | 媒体查询 |
| **11** | **update animations** | CSS 动画 / 过渡 |
| 12-13 | fullscreen / canvas 恢复 | 其他 |
| **14** | **run the animation frame callbacks** | **rAF 回调** |
| 15-16 | style+layout → **ResizeObserver 递送循环** | **布局 + RO** |
| 17-18 | 焦点 / View Transitions | 其他 |
| **19** | **run the update intersection observations** | **IO 计算**（回调异步） |
| 20-21 | 渲染计时 / paint timing | 统计 |
| **22** | **update the rendering / UI** | **Paint 呈现** |
| 23 | top layer removals | 清理 |

### Step 16 的 RO 递送循环（原文翻译）

> 规范在 Step 16 用 `While true` 循环：
> **1. 重算样式 + 更新布局 → 2. 按深度收集活动的 resize 观察 → 3. 若有则广播递送 RO 回调，深度+1，continue → 4. 无则 break**
>
> 这意味着 **RO 回调在布局之后、同帧内可能递送多轮**；若回调改尺寸导致再次变化，浏览器会重新布局并再递送一轮。若同一深度反复变化（无法收敛），则触发 `ResizeObserver loop error`（Chrome 显示为 "ResizeObserver loop completed with undelivered notifications"）。

---

## 实测对照

> ✅ **Chrome headless + CDP 逐帧时间戳实测**（60 帧一致）：
> ```
> rAF-start(28.1) → rAF-end(28.5) → RO(28.6)     ← 同帧：rAF 前、RO 后（Step 14 < 16）
> scroll(34.9) = 下一帧 rAF-start(34.9)           ← scroll 在下一帧 rAF 前（Step 9 < 14）
> ```
> 与规范完全吻合：`resize/scroll 事件 → rAF → 样式/布局 → RO → IO 计算 → Paint`
