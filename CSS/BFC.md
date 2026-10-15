# BFC（块级格式化上下文）

> **结论：BFC 是页面一块独立的渲染区域，内部布局与外部隔离。三个核心能力——① 内部浮动不溢出到外部（清浮动）；② 外边距不穿透（垂直方向 margin 不合并）；③ 不与浮动元素重叠（可实现两栏）。** 触发 BFC 的常见条件：`overflow: hidden`、`float`、`position: absolute/fixed`、`display: inline-block/flex/grid/table-cell`、`display: flow-root`（最语义化）。**面试一句话：BFC = 一个「结界」，里面怎么乱都不影响外面。**
>
> 可运行验证：[[BFC-demo.html]]（浏览器实测：清浮动 / 外边距塌陷 / 两栏布局，开/关 BFC 对比）

---

## 1. 一句话定义（背诵版）

**BFC（Block Formatting Context）= 一块独立的块级渲染区域，内部布局规则自成一体，与外部隔离。**

| 特性 | 表现 |
| ---- | ---- |
| **内部浮动不溢出** | BFC 内的浮动元素被包含，不冲破容器（天然清浮动） |
| **外边距不穿透** | BFC 内子元素的 margin 不会与外部 margin 合并 |
| **不与浮动重叠** | BFC 元素不会与左侧/右侧浮动元素重叠（两栏关键） |
| **隔离** | BFC 内部与外部的布局互不影响 |

## 2. 触发 BFC 的条件（面试必背）

| 触发方式 | 写法 | 备注 |
| ---- | ---- | ---- |
| **`overflow` 非 visible** | `overflow: hidden/auto/scroll` | 最常用 |
| **`display: flow-root`** | `display: flow-root` | **最语义化**（专为 BFC 设计） |
| `float` | `float: left/right` | 副作用：脱离文档流 |
| `position` | `absolute/fixed` | 副作用：脱离文档流 |
| `display: inline-block` | `display: inline-block` | 副作用：行内块 |
| `display: flex/grid` | `display: flex/grid` | 子项会建立 BFC 上下文 |
| `display: table-cell/table-caption` | 表格单元格 | 少用 |

> **推荐用 `display: flow-root`**——它没有副作用（不像 overflow/float/absolute 会带来其他行为），语义就是「建立 BFC」。兼容性现代浏览器全支持。

## 3. 解决三大问题（实测）

### 3.1 清浮动（防止浮动元素撑破父容器）

```html
<!-- 问题：子元素 float 后，父容器高度塌陷 -->
<div class="parent">
  <div class="child" style="float: left">浮动</div>
</div>
<!-- 解决：父容器加 overflow: hidden 或 display: flow-root → 建立 BFC 包含浮动 -->
```

**原理**：浮动元素脱离文档流 → 父容器不计算其高度 → 塌陷。BFC 的规则是「**BFC 必须包含其内部所有浮动元素**」→ 加 BFC 后父容器重新包含浮动子元素，高度恢复。

### 3.2 外边距塌陷（垂直 margin 合并）

```css
/* 问题：父 .parent 里子 .child 的 margin-top 会穿透到父容器外部 */
.parent { }
.child { margin-top: 20px; }   /* 实际作用到 .parent 外面了 */

/* 解决：给 .parent 建立 BFC → 子元素 margin 被包含在内部 */
.parent { display: flow-root; }
```

**原理**：垂直方向相邻的 margin 会合并（取较大值），父子间的 margin-top 也会合并穿透。BFC 隔离后，BFC 内部的 margin 不会与外部合并。

### 3.3 两栏布局（BFC 不与浮动重叠）

```css
/* 左侧固定，右侧自适应：右栏 overflow: hidden 建立 BFC → 不与左浮动重叠 */
.left { float: left; width: 200px; }
.right { overflow: hidden; }   /* BFC → 占据剩余空间 */
```

**原理**：普通块级元素会与浮动元素重叠（浮动元素盖在它上面）；BFC 元素**不与浮动元素重叠**，而是让开浮动区域 → 右栏自动占满剩余宽度。

## 4. 为什么这么设计

- **为什么需要 BFC**：CSS 的布局规则在复杂页面里互相干扰——浮动会让父容器塌陷、margin 会穿透合并、块会与浮动重叠。BFC 提供**隔离边界**：边界内按块级规则布局，边界外不受内部影响。它是「局部作用域」的布局版。
- **为什么 overflow 能触发**：overflow 非 visible 需要知道内容边界（裁剪/滚动），所以浏览器给它建一个独立的布局上下文——这是历史原因，overflow: hidden 是「顺带获得 BFC 能力」。
- **为什么 flow-root 最语义化**：它是 CSS2.1 之后专门新增的、唯一「没有副作用、纯粹为了建 BFC」的触发方式——之前只能用 overflow/float 这些「附带效果」的方式。

## 5. 高频追问速答

| 问题 | 一句话答案 |
| ---- | ---- |
| BFC 是什么？ | 独立块级渲染区域，内部与外部隔离 |
| 怎么触发？ | overflow 非 visible / flow-root / float / absolute / inline-block / flex / grid |
| 清浮动原理？ | BFC 必须包含内部浮动元素 → 父容器高度恢复 |
| 解决 margin 塌陷？ | BFC 内部 margin 不与外部合并 |
| 两栏布局怎么用？ | 右栏 overflow: hidden 建立 BFC，不与左浮动重叠 |
| 最推荐哪种触发？ | `display: flow-root`（无副作用、语义化） |
| 和 IFC/FFC 区别？ | BFC=块级、IFC=行内、FFC=flex（都是格式化上下文） |

## 6. 面试速记（30 秒版）

> **BFC = 独立块级渲染区域（结界），内部布局与外部隔离。** 三能力：**① 包含内部浮动（清浮动）；② 内部 margin 不穿透（防塌陷）；③ 不与浮动重叠（两栏布局）**。触发：**`overflow: hidden`（最常用）/ `display: flow-root`（最语义化）/ float / absolute / inline-block / flex / grid**。面试话术：「BFC 是局部作用域的布局版，用一个容器把内部布局规则和外部隔开」。

> 关联笔记：[[Flex布局]]（BFC 与 Flex 容器） · [[居中方案全集]] · [[两栏三栏布局]]（BFC 两栏） · [[层叠上下文]]（另一个「上下文」概念） · [[CSS与布局-面试速记]] · [[面试复习准备计划]]（W4 周一）
