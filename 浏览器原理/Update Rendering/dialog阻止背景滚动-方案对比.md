# Dialog 打开时阻止背景滚动（滚动穿透锁）

> **问题**：弹窗（modal / dialog）打开时，背景页面仍可滚动，或滚动弹窗内部到底后"穿透"到背景——即 **滚动穿透 / scroll chaining / body scroll lock**。
>
> 可运行验证：[[dialog阻止滚动-方案实测.html]]（四种方案在一个页面里切换实测）

---

## 四种主流方案对比

| 方案 | 原理 | 优点 | 缺点 / 坑 | 适用 |
| --- | --- | --- | --- | --- |
| **0 · 原生 `<dialog>.showModal()`** | 浏览器原生 modal 态，自动锁背景滚动 + 焦点陷阱 + 遮罩 | 零 JS、语义化、可访问性好 | 样式定制受限制；移动端仍可能有穿透；**Chrome 144 前**不锁 overscroll | 现代浏览器、简单弹窗 |
| **1 · `body { overflow:hidden }` + fixed** | 让 body 不可滚动，记录 scrollY 用 fixed + top 保持位置 | 桌面端最可靠、兼容性好 | **移动端 iOS Safari 不可靠**；滚动条消失导致布局偏移（需 padding-right 补偿）；位置恢复逻辑繁琐 | 桌面、PC 端弹窗 |
| **2 · `overscroll-behavior: contain`** | 阻止滚动链（scroll chaining）—— 滚动到边界时不把滚动"传递"给父级 | 纯 CSS、性能好、不改变布局 | 只阻止"穿透到父级"，**内容不足时不生效**；Chrome 144+ 才对 dialog 有效 | 弹窗内部是独立滚动容器时 |
| **3 · `touchmove` preventDefault（passive:false）** | 拦截触摸滚动事件，禁止背景滚动；弹窗内部放行 | 移动端最可靠、可精细控制 | 需要 JS + passive:false（见 [[scroll中的强制同步布局]]）；弹窗内需白名单放行；可能与原生滚动冲突 | 移动端 H5 |

---

## 各方案详解

### 方案 0：原生 `<dialog>.showModal()`

```html
<dialog>
  <h3>弹窗</h3>
  <p>内容</p>
  <button onclick="this.closest('dialog').close()">关闭</button>
</dialog>
```

```javascript
const dlg = document.querySelector('dialog');
dlg.showModal();   // 进入 modal 态：自动锁背景 + 焦点陷阱 + 遮罩
dlg.close();       // 关闭
```

- **浏览器原生支持**：进入 modal 态后，背景页面默认不可交互（Inert），焦点被困在弹窗内
- **滚动**：Chrome 对 `showModal()` 的 dialog 有滚动行为处理，但**并非所有浏览器/情况都锁死**背景滚动
- **Chrome 144 起**：可以在 dialog 和 backdrop 上用 `overscroll-behavior: contain` 进一步阻止滚动穿透
- ⚠️ 已知 issue：规范尚未强制"modal dialog 时背景禁止滚动"（whatwg/html#7732 仍在讨论），所以不同浏览器表现有差异

### 方案 1：body overflow:hidden（经典做法）

```javascript
function openModal(){
  const scrollY = window.scrollY;
  document.body.style.overflow = 'hidden';
  document.body.style.position = 'fixed';
  document.body.style.top = `-${scrollY}px`;
  document.body.style.width = '100%';
}
function closeModal(){
  document.body.style.overflow = '';
  document.body.style.position = '';
  document.body.style.top = '';
  window.scrollTo(0, scrollY);
}
```

- **原理**：body 变 `position:fixed` + `overflow:hidden` 后**失去滚动能力**，视口位置用 `top:-scrollY` 保持
- ✅ 桌面端最可靠；❌ **iOS Safari 上 `overflow:hidden` 不可靠**（触摸滚动仍可能穿透）
- ⚠️ **滚动条消失 → 布局偏移**：锁定后 body 宽度变宽（滚动条腾出的空间），内容会横向抖动，需 `padding-right: scrollbar-width` 补偿
- ⚠️ 关闭时要把滚动位置**精确还原**，否则回到错误位置

### 方案 2：overscroll-behavior: contain（纯 CSS）

```css
.modal {
  overscroll-behavior: contain;
  /* Chrome 144+ 可配合 dialog 使用 */
}
```

- **原理**：阻止"滚动链（scroll chaining）"——当滚动到达一个元素的边界时，默认会把滚动**继续传给父级/背景**；`contain` 切断这个传递
- ✅ 纯 CSS、不改布局、性能好
- ⚠️ **只解决"穿透"，不解决"背景本身滚动"**：如果背景没有独立滚动容器，或弹窗内容不足（不产生滚动），`contain` 不生效
- ⚠️ 需要浏览器支持（Chrome 63+；Chrome 144+ 才对 dialog 元素支持）

### 方案 3：touchmove preventDefault（移动端最可靠）

```javascript
function lockTouch(e){
  // 弹窗内部放行（不拦截）
  if (modalInner.contains(e.target)) return;
  e.preventDefault();
}
document.addEventListener('touchmove', lockTouch, {passive:false});  // ⚠️ 必须 passive:false
// 关闭时 removeEventListener 还原
```

- **原理**：拦截触摸滚动事件，禁止背景滚动；弹窗内部元素命中时放行
- ✅ 移动端（iOS/Android）最可靠，可精细控制
- ⚠️ **必须 `{passive:false}`**——因为 touchmove 现代默认 passive，preventDefault 会被忽略（详见 [[scroll中的强制同步布局]] 第八节）
- ⚠️ 弹窗内部需 `contains(target)` 白名单放行，否则弹窗自己也滚不了
- ⚠️ 需要精确的 add/removeEventListener 配对，防止泄漏

---

## 怎么选（决策建议）

| 场景 | 推荐 |
| --- | --- |
| 现代浏览器、简单弹窗 | **方案 0** 原生 dialog（零依赖、可访问性好） |
| 桌面 PC 弹窗（浏览器要全兼容） | **方案 1** overflow:hidden + fixed（最稳） |
| 弹窗内部有独立滚动列表 | **方案 2** overscroll-behavior:contain（纯 CSS 补充） |
| 移动端 H5 弹窗 | **方案 3** touchmove preventDefault（或组合方案 1） |
| 生产环境综合 | 方案 1 + 方案 2 组合；移动端加方案 3；弹窗内部滚动用 `overscroll-behavior:contain` 防止穿透到背景 |

---

## 与 passive / scroll 机制的联系

- 方案 3 的 `preventDefault` 有效的前提是 **`passive:false`**（touchmove 是"滚动前"事件、可取消）——这与 [[scroll中的强制同步布局]] 讨论的机制完全一致
- 方案 2 的 `overscroll-behavior:contain` 作用在**滚动链**上，不依赖事件，是更现代的纯 CSS 方案
- 原生 `<dialog>` 的 modal 态锁背景，是浏览器层面处理（Inert + 滚动隔离），但目前跨浏览器不完全一致

## 面试速记（30 秒版）

> **问：弹窗打开时怎么阻止背景滚动？**
>
> **答（一口说完）**：
> 1. **原生 `<dialog>.showModal()`** —— 浏览器自带 modal 锁（Inert + 焦点陷阱），现代浏览器首选，但样式定制受限、跨浏览器不完全一致
> 2. **`body { overflow:hidden; position:fixed }`** —— 桌面最可靠，记得记录/还原 scrollY，补滚动条消失的偏移
> 3. **`overscroll-behavior: contain`** —— 纯 CSS 切断滚动链，防"列表滚到底穿透到背景"，Chrome 144+ 对 dialog 生效
> 4. **`touchmove` preventDefault + `passive:false`** —— 移动端最可靠，弹窗内白名单放行
>
> **一句话总结**：桌面用 overflow:hidden，移动端用 touchmove preventDefault（必须 passive:false），弹窗内独立滚动用 overscroll-behavior:contain，现代简单场景直接 `<dialog>.showModal()`。

## 相关笔记

- [[scroll中的强制同步布局]] —— touchmove preventDefault 必须 passive:false 的原理
- [[验证scroll是滚动前还是后]] —— 为什么 scroll 事件本身拦不住滚动（滚动后的通知）
- [[Update Rendering 阶段详解]] —— 滚动 / 事件在渲染阶段的位置
