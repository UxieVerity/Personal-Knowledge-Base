# 基础自测①（JS + CSS · 30 秒复述）

> 日期：2026-10-19（补 10.16 任务）。用法：**每题 30 秒口头复述，先自答再看答案要点**。卡壳的题号打 ✓ 标记，汇总到末尾卡壳清单。
> 覆盖：[[八股文列表]] 第 1 项（JS 核心）+ 第 2 项（CSS 与布局）。

---

## A. JavaScript 核心（12 题）

### 1. 什么是闭包？为什么 JS 必然有闭包？
> 闭包 = 函数 + 创建时词法环境的引用。一等公民 + 词法作用域 → 函数被传走时环境必须跟着走，是两条基础规则的必然推论。

### 2. 闭包会造成内存泄漏吗？
> 被真正引用的变量阻止 GC；V8 有无谓捕获优化（没引用的不锁）；用后 `= null` / 移除监听。泄漏三场景：事件监听、setInterval、全局大对象。

### 3. this 的四种绑定规则 + 优先级？
> **new > 显式(call/apply/bind) > 隐式(obj.fn()) > 默认(裸调用)**。默认非严格=globalThis，严格=undefined。箭头函数无 this，取定义处词法 this。

### 4. 隐式绑定什么时候丢失？
> `const fn = obj.fn; fn()` 裸调用 → 回默认绑定。React 类组件 `onClick={this.handler}` 不 bind 就丢。

### 5. call/apply/bind 区别？
> call 逐个传参立即执行；apply 数组传参立即执行；bind 返回新函数、this 永久固定、参数预置。

### 6. 手写 call 的原理 + 边界？
> 把函数临时挂到目标对象上 `obj[key]()` 调用（显式转隐式），用完 delete。边界：`ctx == null ? globalThis : Object(ctx)`（兜底+装箱）、Symbol 键防覆盖、不可枚举。

### 7. 手写 bind 的难点？
> ① new 兼容（`new.target ? this : ctx`）；② 参数拼接 `pre.concat(args)`；③ 原型链 `bound.prototype = Object.create(fn.prototype)`；④ length 收缩。

### 8. Promise 三件套是什么？
> 状态机（pending→fulfilled/rejected，**不可逆**）+ 回调暂存/微任务调度（`queueMicrotask`）+ 链式（then 返回新 Promise，值传递/展平/穿透/错误跳过）。

### 9. Promise.all 和 race 区别？
> all：全成功→保序数组，任一失败整体 reject（短路）；手写用 `results[i]=v` 索引写保序。race：第一个 settle 的赢。

### 10. async/await 本质？
> Generator（yield 暂停）+ 自执行器（自动 next）的语法糖。`await x` 编译成 `yield x`，引擎 `.then(值=>next(值))` 传回。手写 run() 即最小 co。

### 11. 微任务和宏任务时序？
> 微任务每轮**清空到空**才取下一个宏任务；微任务里加的微任务同批排空；then/async 续体同队列 FIFO；微任务太多会阻塞渲染。

### 12. 讲三个手写题的思路？
> 防抖（clearTimeout+setTimeout，`if(!immediate)` 必须在内）、节流（时间戳 `now-last>=delay` / 定时器）、深拷贝（递归+WeakMap 防循环引用）。

## B. CSS 与布局（8 题）

### 13. 什么是 BFC？解决什么问题？
> 独立块级渲染区域（结界），内部与外部隔离。三能力：包含内部浮动（清浮动）、内部 margin 不穿透（防塌陷）、不与浮动重叠（两栏）。触发：overflow:hidden / display:flow-root / float / absolute / inline-block / flex / grid。

### 14. Flex 的 flex: 1 是什么？
> `1 1 0%`：grow=1（多了按比例分）、shrink=1（少了按比例缩）、basis=0（基准 0）。即「均分剩余空间」。

### 15. Flex 和 Grid 怎么选？
> Flex 一维（一行/一列内排列，导航/列表/居中）；Grid 二维（行列网格骨架，页面整体）。**Flex 管局部，Grid 管整体**，可嵌套。

### 16. 水平垂直居中怎么做？
> 首选 `flex + justify-content:center + align-items:center`。尺寸未知用 `absolute + translate(-50%,-50%)`；已知用 `absolute + inset:0 + margin:auto`。Grid 最简 `place-items:center`。

### 17. 两栏/三栏布局？
> 两栏 `flex: 0 0 200px + flex: 1`；三栏 `grid-template-columns: 200px 1fr 200px`。历史题双飞翼/圣杯：中间先写（SEO）+ 负 margin + float。

### 18. z-index 在什么情况下失效？
> 跨层叠上下文时——子元素 z-index 只在父亲的上下文内有效，跨上下文看**父的层叠级别**（儿子再大不过父亲）。`transform`/`opacity<1`/`filter` 会静默创建上下文。

### 19. 回流和重绘的区别？怎么优化？
> 回流=几何重算（重走布局），重绘=外观重画；回流必带重绘。优化：**读改分离**（避免强制同步布局）、批量 DOM、class 切换、**transform/opacity 动画（只走合成层 GPU）**。

### 20. 响应式怎么做？
> 三件套：媒体查询（`@media` 断点，移动优先 min-width）+ 弹性单位（rem 相对根字号、vw 相对视口、clamp 限幅）+ 移动端适配（`meta viewport` 必加、流式宽度、图片 max-width:100% + srcset）。

---

## 卡壳清单（自测后填）

| 题号 | 卡壳点 | 对应笔记 |
| ---- | ---- | ---- |
| ___ | ___ | ___ |

**自测记录**：
- [ ] A 部分 12 题复述过一遍
- [ ] B 部分 8 题复述过一遍
- [ ] 卡壳清单已填

---

## 关联

- 详细笔记：[[JS闭包与作用域-面试速记]] · [[this与call-apply-bind-面试速记]] · [[JS异步与Promise-面试速记]] · [[CSS与布局-面试速记]]
- [[八股文列表]] · [[面试复习准备计划]]（10.16）
