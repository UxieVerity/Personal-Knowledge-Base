# 验证 scroll 事件是滚动前还是滚动后

> **结论：`scroll` 事件是【滚动后】的通知**（滚动偏移已应用、异步派发、不可取消）；而 `wheel` / `touchmove` 是【滚动前】的事件（偏移未变、可 `preventDefault` 拦截滚动）。
>
> 可运行验证：[[验证scroll前后.html]]（含下面全部四种方法的自动演示）

---

## 四种验证方法（按说服力从弱到强）

### 方法 1：`scrollTop` 同步应用 vs 事件异步派发

```javascript
scroller.scrollTop = 100;
console.log(scroller.scrollTop);   // 100  ← 同步立即读到新值（滚动已应用）
console.log(scrollCount);          // 0    ← scroll 回调还没触发（异步派发）
```

- **滚动偏移是同步生效的**：`scrollTop = 100` 一赋值，立即读就是 100
- **scroll 事件是异步派发的**：赋值后同步检查，回调还没跑；要等 `setTimeout` 后才触发
- → 说明 scroll 事件是在滚动**已经发生之后**才派发的通知

### 方法 2：回调里读到的 scrollTop 是滚动后的新值

```javascript
scroller.addEventListener('scroll', e => {
  console.log(scroller.scrollTop);  // 100（新值）
});
scroller.scrollTop = 100;           // 从 0 滚动到 100
```

- 若 scroll 是"滚动前"事件，回调里应读到**旧值 0**（滚动还没开始）
- 实测回调里读到的是**新值 100**（滚动已完成）
- → 滚动发生在先，scroll 通知在后

### 方法 3：`cancelable === false`，`preventDefault` 无效

```javascript
scroller.addEventListener('scroll', e => {
  console.log(e.cancelable);        // false
  e.preventDefault();               // 无效
  console.log(e.defaultPrevented);  // 仍为 false
});
scroller.scrollTop = 150;           // 滚动照常发生
```

- `scroll.cancelable === false`（实测确认）→ 没有"默认滚动行为"可以被取消
- 回调里调 `preventDefault()` → `defaultPrevented` 仍为 false，滚动照常
- 对比：`wheel` / `touchmove` 的 `cancelable === true`，preventDefault 能取消滚动
- → scroll 不是"滚动前拦截"事件，而是"滚动后通知"

### 方法 4：scroll 回调里再滚动 → 触发【新的】scroll 事件（反馈循环）

```javascript
scroller.addEventListener('scroll', () => {
  scroller.scrollTop += 20;   // 在回调里再滚动
  // 会再次触发 scroll 事件 → 又滚动 → 又触发… 形成反馈循环
});
```

- 若 scroll 是"滚动前"事件：回调里改位置应在**同一默认动作中生效**，不会产生新事件
- 实测：在 scroll 回调里再设置 `scrollTop`，会**反复触发新的 scroll 事件**（反馈循环跑了多次才停）
- → 每个 scroll 事件对应**一次已完成的滚动**，回调里新滚动产生新通知——证明 scroll 是滚动后的反馈

---

## 对比表：滚动前 vs 滚动后

| 事件 | 触发时机 | 偏移已应用？ | cancelable | preventDefault | passive 优化 |
| --- | --- | --- | --- | --- | --- |
| `wheel` | 滚动**前** | ❌ 未变 | ✅ true | ✅ 可取消滚动 | ✅ 有效 |
| `touchmove` | 滚动**前** | ❌ 未变 | ✅ true | ✅ 可取消滚动 | ✅ 有效 |
| `touchstart` | 手势开始 | ❌ 未变 | ✅ true | ✅ 可取消 | ✅ 有效 |
| **`scroll`** | 滚动**后** | ✅ **已应用** | ❌ **false** | ❌ 无效 | ❌ 无效 |

## 为什么这样设计？

- **wheel/touchmove 是"驱动"事件**：它们决定滚动是否发生，浏览器需要 JS 确认（要不要 preventDefault），所以它们在滚动前派发、可取消——这是 passive 优化的价值所在
- **scroll 是"结果"事件**：它报告"滚动已经发生了，现在位置是这个"，供 JS 做后续处理（吸顶、懒加载、进度条），所以它在滚动后派发、不可取消
- 一个滚动交互的完整顺序：
  ```
  wheel/touchmove（前，可拦截）
     ↓ 浏览器应用滚动偏移
  scroll（后，通知，偏移已变）
  ```

---

## 与 passive 的联系

正因为 **scroll 是滚动后、不可取消**，所以给 scroll 加 `passive: true` 没有优化效果（详见 [[scroll中的强制同步布局]] 第八节）——passive 优化的前提是"浏览器要等 JS 判断是否拦截"，而 scroll 从不参与这个判断。

## 相关笔记

- [[scroll中的强制同步布局]] —— scroll 后置通知的特性，与强制同步布局、passive 的关系
- [[Update Rendering 阶段详解]] —— scroll 事件在渲染阶段 Step 9 的派发位置
- [[dialog阻止背景滚动-方案对比]] —— 为什么 scroll 拦不住滚动、得靠 wheel/touchmove（滚动前事件）+ passive:false 来锁
