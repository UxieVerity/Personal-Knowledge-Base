# CSS 与布局 · 面试速记

> CSS 面试必问。本速记覆盖「BFC → Flex → 居中 → 两栏三栏 → Grid → 响应式 → 层叠 → 重绘回流」主线，每项 30 秒能讲，详细见各笔记。

---

## 1. BFC（背诵版）

> **BFC = 独立块级渲染区域（结界），内部与外部隔离。** 三能力：**① 包含内部浮动（清浮动）；② 内部 margin 不穿透（防塌陷）；③ 不与浮动重叠（两栏）**。触发：**`overflow: hidden`（最常用）/ `display: flow-root`（最语义化）/ float / absolute / inline-block / flex / grid**。

## 2. Flex（背诵版）

> **Flex = 一维弹性布局。** 主轴 = `flex-direction`（row/column±reverse）。**flex 三兄弟**：`flex: 1` = `1 1 0%` 均分剩余（grow 管多分、shrink 管少缩、basis 管基准）；`flex: none` = 固定。对齐：**justify-content 管主轴、align-items 管交叉轴**。居中 = `justify-center + align-center`。**vs Grid**：Flex 一维、Grid 二维——局部排列 Flex，整体骨架 Grid。

## 3. 居中（背诵版）

> **首选 Flex：`justify-content: center + align-items: center`。** 尺寸未知用 `absolute + top/left 50% + translate(-50%,-50%)`；已知用 `absolute + inset:0 + margin:auto`（需定宽高）。水平：行内 `text-align`、块级 `margin: 0 auto`（定宽）。**加分**：Grid `place-items: center` 最简；`margin auto` 垂直不行（块级无剩余垂直空间，absolute 脱离文档流才行）。

## 4. 两栏三栏（背诵版）

> **两栏 = 侧边固定 + 主区自适应**：`flex: 0 0 200px + flex: 1`。**三栏 = `grid-template-columns: 200px 1fr 200px` 一行最简**。历史题双飞翼/圣杯：中间先写（SEO）+ 负 margin + float；双飞翼内层 margin 让位、圣杯父 padding 让位。**现代无脑 flex/grid**。

## 5. Grid（背诵版）

> **Grid = 二维网格骨架。** `grid-template-columns/rows` 定义轨道；**`fr` = 剩余比例**；**`repeat(auto-fill, minmax(200px,1fr))` 自适应列数**（响应式栅格免媒体查询）；`grid-template-areas` ASCII 画布局最直观。选型：**Flex 局部一维、Grid 整体二维**。

## 6. 响应式（背诵版）

> **三件套：媒体查询（`@media` 断点，推荐移动优先 min-width）+ 弹性单位（`rem` 相对根字号、`vw` 相对视口、`clamp()` 限幅）+ 移动端（`meta viewport` 必加、% flex 流式、图片 `max-width:100%` + srcset）。** rem 适配 = JS 设根字号（`width/设计稿宽*100`）或 `1rem = 100vw/N`。

## 7. 层叠上下文 + 优先级（背诵版）

> **z-index 只在同一层叠上下文内有效。** 触发：position+z-index / transform / opacity<1 / filter / will-change。**坑：子元素 z-index 999 盖不住父兄弟（跨上下文看父的）；transform 静默建上下文 → 内部 z-index 失效。** 顺序：背景 < 负z < 块级 < 浮动 < 行内 < z:0 < 正z。**优先级**：行内 > id > class/属性 > 元素，同级后写赢；**ID 碾压 class**。

## 8. 重绘回流（背诵版）

> **回流（几何重算）> 重绘（外观重画）；回流必带重绘。** 触发：尺寸/位置/增删节点/内容/读几何。**坑：强制同步布局——读改交替每次读都回流；先读后改只一次。** 优化：读改分离、批量 DOM、class 切换、**transform/opacity 动画（只走合成层 GPU）**、will-change、脱离文档流、防抖节流。**「能用 transform 绝不用 left/top」**。

---

## 深读入口

- [[BFC]] · [[Flex布局]] · [[居中方案全集]] · [[两栏三栏布局]] · [[Grid布局]] · [[响应式设计]] · [[层叠上下文]] · [[重绘回流]]
- 配套 demo：[[BFC-demo.html]] · [[Flex-demo.html]] · [[CSS综合-demo.html]]
- [[八股文列表]]（CSS 部分） · [[面试速记-索引]]（返回主索引）
