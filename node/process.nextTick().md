
## 为什么设计成 nextTick 优先级高于 Promise？

### 1. 历史原因：nextTick 早于 Promise

`process.nextTick` 在 Node 0.1 就存在；Promise 是后来 ES6 才加入。 早期没有标准微任务，nextTick 用来做 “异步插队”，把回调放到当前操作完成之后、IO / 定时器之前执行。

### 2. 设计目的：允许在继续 I/O 之前做状态修正

官方设计意图：**允许用户在把控制权交还给事件循环（交给 IO、定时器）之前，优先完成一些关键状态更新、错误回调、内部状态清理**。

举个场景：

```
function bar() {
  console.log('bar');
}
function foo() {
  process.nextTick(bar);
  return;
}
foo();
console.log('end');
```

执行顺序：`foo同步执行完毕 → 立刻执行nextTick回调bar → 再执行console.log('end')`

> 含义：函数返回了，但还没把事件循环放走，先把 nextTick 的任务干完。 适合：事件 emit、错误回调、内部状态同步，保证在任何 IO、定时器触发前通知用户。

### 3. 和浏览器微任务模型的区别

- **浏览器**：所有微任务统一队列，`Promise.then`、`queueMicrotask` 按入队顺序执行，没有哪个微任务优先级更高。
- **Node.js ≥v11**：拆分两套微任务队列
    1. nextTick 专属队列（优先级最高）
    2. Promise/queueMicrotask 微任务队列

> Node v10 及以前行为不一样：nextTick 会把队列全部清空，再跑一轮事件循环，再跑 Promise，行为怪异，v11 对齐浏览器宏观模型，但保留 nextTick 更高优先级。


### node中cjs和mjs的nextTick执行差异

- 在cjs中严格按照nextTick先执行再执行其他微任务
- 再mjs中，ESM 顶层被 V8 的微任务检查点 “插队”，所以会先执行promise，再执行nextTick，不过在具体的事件回调中还是会按照先执行nextTick的顺序执行