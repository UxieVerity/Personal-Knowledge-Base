# Flex 布局

> **结论：Flex 是一维布局模型——沿主轴（main axis）排列子项，一行/一列搞定弹性布局。核心三个概念：① 主轴/交叉轴（方向由 `flex-direction` 决定）；② `flex-grow/shrink/basis`（放大/缩小/基准，合起来 = 空间分配规则）；③ 对齐（justify-content 主轴 / align-items 交叉轴）。** 面试一句话：**Flex = 容器把子项沿一个轴弹性排列，flex 三兄弟决定「空间多了怎么分、少了怎么缩」。**
>
> 可运行验证：[[Flex-demo.html]]（浏览器实测：flex-direction / grow-shrink-basis / 对齐 / 常用布局）

---

## 1. 一句话定义（背诵版）

**Flex（Flexible Box）= 一维弹性布局：容器沿主轴排列子项，子项按 flex 规则分配空间。**

| 概念 | 说明 |
| ---- | ---- |
| **主轴 main axis** | 子项排列方向，由 `flex-direction` 决定 |
| **交叉轴 cross axis** | 与主轴垂直的方向 |
| **flex-grow** | 空间**多**了，子项按比例放大（默认 0 不放大） |
| **flex-shrink** | 空间**少**了，子项按比例缩小（默认 1 可缩小） |
| **flex-basis** | 子项**基准尺寸**（默认 auto=内容宽） |

## 2. flex-direction：主轴方向（面试必背四方向）

| 值 | 主轴方向 | 子项排列 |
| ---- | ---- | ---- |
| `row`（默认） | 从左到右 | 水平排列 |
| `row-reverse` | 从右到左 | 水平反向 |
| `column` | 从上到下 | 垂直排列 |
| `column-reverse` | 从下到上 | 垂直反向 |

> **面试点**：flex-direction 决定主轴 → 主轴变了，`justify-content`（主轴对齐）和 `align-items`（交叉轴对齐）的方向也跟着变。**row 下 justify=水平居中；column 下 justify=垂直居中**。

## 3. flex 三兄弟：grow / shrink / basis（核心难点）

**简写 `flex: grow shrink basis`**，常用值：

| 写法 | 含义 |
| ---- | ---- |
| `flex: 1` | `1 1 0%`：平均分配剩余空间 |
| `flex: auto` | `1 1 auto`：按内容分配 |
| `flex: none` | `0 0 auto`：不放大不缩小（固定） |
| `flex: 0 0 200px` | 固定 200px，不伸缩 |

**计算规则（面试手写）**：
1. 先按 `flex-basis` 算每个子项的基准尺寸
2. 所有基准加起来 vs 容器剩余空间：
   - **多了**（容器比内容大）→ 剩余空间按 `flex-grow` 比例分给各子项
   - **少了**（内容超容器）→ 超出部分按 `flex-shrink` 比例从各子项扣

**经典例子**：
```css
/* 3 个子项，flex: 1, 1, 2 → 剩余空间按 1:1:2 分配 */
.container { display: flex; width: 600px; }
.a { flex: 1; } .b { flex: 1; } .c { flex: 2; }
/* 基准都是 0 → 600px 按 1:1:2 分 = 150 / 150 / 300 */
```

## 4. 对齐：justify-content / align-items / align-self

| 属性 | 作用 | 常用值 |
| ---- | ---- | ---- |
| `justify-content` | **主轴**对齐 | flex-start / center / space-between / space-around / space-evenly |
| `align-items` | **交叉轴**对齐（所有子项） | stretch（默认）/ center / flex-start / flex-end |
| `align-self` | 单个子项覆盖 align-items | 同上 |
| `align-content` | 多行时的交叉轴对齐 | 只有 flex-wrap 多行时有效 |

**面试点**：`space-between`（两端对齐，间距在中间）vs `space-around`（每项两侧等距）vs `space-evenly`（间距完全相等）——三选一的经典追问。

## 5. flex-wrap：换行

| 值 | 行为 |
| ---- | ---- |
| `nowrap`（默认） | 不换行，子项被压缩 |
| `wrap` | 换行，多行排列 |
| `wrap-reverse` | 反向换行 |

> `flex-wrap: wrap` + `align-content` 是「多行 flex」的关键——单行时 align-content 无效。

## 6. 常用布局（面试直接背）

### 6.1 水平垂直居中（最常用）

```css
.container { display: flex; justify-content: center; align-items: center; }
```

### 6.2 圣杯/两栏（侧边栏固定 + 主内容自适应）

```css
.layout { display: flex; }
.sidebar { flex: 0 0 200px; }   /* 固定 200px */
.main { flex: 1; }              /* 占剩余 */
```

### 6.3 等分 / 平均分布

```css
.item { flex: 1; }   /* N 个子项平分容器 */
```

## 7. 为什么这么设计

- **为什么 Flex 是一维**：CSS 布局分两派——Flex 管**一维**（一行/一列内的排列），Grid 管**二维**（行列网格）。Flex 解决「一行内怎么排/怎么分」；Grid 解决「整个页面的行列骨架」。选型：**单行/单列弹性用 Flex，整体网格骨架用 Grid**。
- **为什么有三兄弟**：布局的核心问题是「空间多了分给谁、少了从谁扣」——grow 管多了、shrink 管少了、basis 管基准，三者拆开才能精确控制。`flex: 1` 是「均分剩余」的便捷表达。
- **为什么默认 shrink=1**：防止内容溢出容器（宁可压缩子项也不溢出）。这也是 flex 子项默认会比内容窄的原因（新手常见困惑）。

## 8. 高频追问速答

| 问题 | 一句话答案 |
| ---- | ---- |
| flex-direction 有哪些？ | row / row-reverse / column / column-reverse |
| flex: 1 是什么？ | 1 1 0%：均分剩余空间 |
| grow/shrink/basis 区别？ | 多了按 grow 分、少了按 shrink 扣、basis 是基准 |
| 水平垂直居中？ | justify-content: center + align-items: center |
| space-between / around / evenly？ | 两端对齐 / 每项两侧等距 / 完全相等 |
| Flex vs Grid？ | Flex 一维排列；Grid 二维网格骨架 |
| 为什么子项默认被压缩？ | 默认 shrink=1，防止溢出 |

## 9. 面试速记（30 秒版）

> **Flex = 一维弹性布局。** 主轴方向 = `flex-direction`（row/column ± reverse）。**flex 三兄弟**：`flex: 1` = `1 1 0%` 均分剩余（多了 grow 分、少了 shrink 扣、basis 是基准）；`flex: none` = 固定不伸缩。对齐：**justify-content 管主轴**（center/space-between…）、**align-items 管交叉轴**。**常用布局**：居中 = justify-center + align-center；侧边栏固定 = `flex: 0 0 200px` + 主内容 `flex: 1`。**和 Grid 区别**：Flex 一维、Grid 二维——单行排列用 Flex，页面骨架用 Grid。

> 关联笔记：[[BFC]]（Flex 容器也建 BFC） · [[居中方案全集]] · [[两栏三栏布局]] · [[Grid布局]]（对比） · [[CSS与布局-面试速记]] · [[面试复习准备计划]]（W4 周二）
