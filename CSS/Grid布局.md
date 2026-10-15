# Grid 布局

> **结论：Grid 是二维布局模型——同时管「行」和「列」，适合页面整体骨架。核心：`grid-template-columns/rows` 定义网格线轨道（`fr` = 剩余空间比例单位）、`grid-template-areas` 命名区域、`gap` 间距、`place-items/justify-content` 对齐。** 面试一句话：**「Flex 管一维（一行/一列内排列），Grid 管二维（行列网格骨架）；Flex 适合局部，Grid 适合整体。」**
>
> 可运行验证：[[CSS综合-demo.html]]（浏览器实测：居中 / Grid 自适应列数 / 两栏三栏 / 层叠陷阱 / transform-vs-left 动画 / 响应式断点）

---

## 1. 一句话定义（背诵版）

**Grid = 二维网格布局：`grid-template-columns` 定义列、`grid-template-rows` 定义行，子项按行列放置。**

| 概念 | 说明 |
| ---- | ---- |
| **网格线** | 划分行列的线（column line / row line） |
| **轨道** | 两条网格线之间（一列/一行） |
| **fr** | **剩余空间比例单位**（Grid 专属，`1fr` = 分 1 份） |
| **grid-template-areas** | 用命名区域描述布局（最直观） |
| **gap** | 轨道间距 |

## 2. 基础用法（实测）

### 2.1 定义网格

```css
.container {
  display: grid;
  grid-template-columns: 100px 1fr 2fr;   /* 列：100px 固定 + 1份 + 2份 */
  grid-template-rows: 50px 1fr;           /* 行：50px + 剩余 */
  gap: 10px;                              /* 间距 */
}
```

**fr 的理解**：`1fr 2fr` = 剩余空间分 3 份，第 2 列拿 2 份、第 1 列拿 1 份（类似 flex-grow，但 fr 管轨道）。

### 2.2 repeat + minmax

```css
grid-template-columns: repeat(3, 1fr);        /* 3 等分 */
grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));  /* 自适应列数：每列最小 200px，能塞几列塞几列 */
```

**`minmax(min, max)`**：轨道尺寸范围——`auto-fill + minmax` 是「响应式栅格」的关键（列数随容器宽度自动变化，不用媒体查询）。

### 2.3 grid-template-areas（最直观）

```css
.container {
  display: grid;
  grid-template-areas:
    "header header header"
    "sidebar main main"
    "footer footer footer";
  grid-template-columns: 150px 1fr 1fr;
  grid-template-rows: 60px 1fr 40px;
}
.header  { grid-area: header; }
.sidebar { grid-area: sidebar; }
.main    { grid-area: main; }
.footer  { grid-area: footer; }
```

**areas 用 ASCII 画布局**，一眼看出页面骨架——这是 Grid 比 Flex 表达「整体布局」更清晰的核心优势。

## 3. Grid vs Flex 选型（面试核心）

| 维度 | Flex | Grid |
| ---- | ---- | ---- |
| 维度 | **一维**（行/列之一） | **二维**（行列同时） |
| 适用 | 一行/一列内的**排列**（导航、按钮组、居中） | 页面**整体骨架**（顶栏+侧栏+主区+底栏） |
| 对齐 | justify/align（主轴/交叉轴） | place-items / justify-content（行列） |
| 特点 | 内容驱动（子项尺寸决定布局） | 容器驱动（先画网格再放内容） |
| 选型 | **Flex 管局部，Grid 管整体** | |

> **面试话术**：「Flex 是内容往一行里排（一维）；Grid 是先画好网格骨架再往格子里放（二维）。导航/列表/居中用 Flex；页面三栏骨架、复杂栅格用 Grid。两者可嵌套（Grid 容器里某格用 Flex）。」

## 4. 对齐（Grid 版）

```css
.container {
  justify-content: center;   /* 整个网格在容器内水平居中 */
  align-content: center;     /* 整个网格垂直居中 */
  justify-items: center;     /* 每个子项在格内水平居中 */
  align-items: center;       /* 每个子项在格内垂直居中 */
}
/* 简写 */
place-items: center;         /* align-items + justify-items */
place-content: center;       /* align-content + justify-content */
```

## 5. 为什么这么设计

- **为什么 Grid 是二维**：页面布局本质是「二维网格」——顶栏横跨、侧栏竖排、主区填充。Flex 只能排一行（要换行得 wrap + 对齐控制），Grid 直接声明「几行几列 + 谁占哪里」，和页面结构天然对应。
- **为什么有 fr**：`%` 依赖父容器、`auto` 依赖内容，都不好表达「把剩余空间分几份」。`fr` 是 Grid 专属的剩余空间比例单位，语义清晰（`1fr 2fr` = 1:2）。
- **为什么 areas 重要**：比手写行列号（`grid-column: 1/3`）直观得多——ASCII 图就是布局本身，改布局只改 areas 字符串。可读性/可维护性高。

## 6. 高频追问速答

| 问题 | 一句话答案 |
| ---- | ---- |
| Grid 和 Flex 区别？ | Flex 一维排列；Grid 二维网格骨架 |
| fr 是什么？ | 剩余空间比例单位（1fr = 1 份） |
| 怎么自适应列数？ | `repeat(auto-fill, minmax(200px, 1fr))` |
| areas 怎么用？ | `grid-template-areas` ASCII 画布局 + `grid-area` 指定 |
| 最常用骨架？ | header/sidebar/main/footer 四区 |
| 和 Flex 嵌套？ | Grid 容器里某格用 Flex（布局+排列） |
| 什么时候用 Grid？ | 页面整体骨架、复杂栅格 |

## 7. 面试速记（30 秒版）

> **Grid = 二维网格，管页面骨架。** `grid-template-columns/rows` 定义轨道；**`fr` = 剩余空间比例**（1fr 2fr = 1:2）；**`repeat(auto-fill, minmax(200px,1fr))` 自适应列数**（响应式栅格，免媒体查询）；**`grid-template-areas` ASCII 画布局最直观**。**选型：Flex 一维局部排列（导航/列表/居中），Grid 二维整体骨架（三栏/栅格）；可嵌套。** 对齐：`place-items/place-content` 简写。

> 关联笔记：[[Flex布局]]（对比） · [[两栏三栏布局]] · [[BFC]] · [[响应式设计]] · [[CSS与布局-面试速记]] · [[面试复习准备计划]]（W5 周一）
