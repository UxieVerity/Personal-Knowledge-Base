# JS 异步与 Promise · 面试速记

> 异步是 JS 核心**必问**，常和事件循环一起考。本速记覆盖「Promise 状态机 → 链式 → 静态方法 → async/await 本质 → 微任务时序 → 手写要点」主线，30 秒能讲完，详细见 [[手写题/Promise基础版]] 和 [[async-await本质]]。

---

## 1. Promise 核心（背诵版）

> **Promise = 状态机（pending → fulfilled/rejected，不可逆）+ 回调暂存/调度 + 链式返回新 Promise。**

| 特性 | 一句话 |
| ---- | ---- |
| 状态 | 三种，**一旦改变不再变**（结果只定一次） |
| then | 返回**新** Promise → 链式；回调返回值给下一个 then |
| 展平 | 回调返回 Promise → 等待 resolve（不套 Promise） |
| 穿透 | 没传回调 → 值/原因原样传给下一个 |
| 错误 | reject 跳过所有 onFulfilled 直达 catch |

**手写核心三件套**：`_settle`（幂等，非 pending 忽略 → 不可逆）、`queueMicrotask`（then 回调微任务异步）、then 返回新 Promise（链不断）。

## 2. 静态方法（对比）

| 方法 | 行为 | 适用 |
| ---- | ---- | ---- |
| `all` | 全成功 → **保序数组**；任一失败 → 整体 reject（短路） | 并行请求全成功 |
| `race` | **第一个 settle 的赢**（成败都算） | 超时竞争 |
| `allSettled` | 全部完成 → `{status, value/reason}[]`，不短路 | 都要结果 |
| `resolve/reject` | 快速包装值/错误 | 工具 |

**手写要点**：all 用 `results[i] = v` 索引写保序（push 乱序）+ 计数；race 用 `then(resolve, reject)` 先到先得。

## 3. async/await 本质（Generator 语法糖）

> **async/await = Generator（yield 暂停）+ 自执行器（自动 next）语法糖。** `await x` 编译成 `yield x`，引擎 `.then(值 => next(值))` 把结果传回。

```js
// 手写自执行器（co 最小形态）
function run(genFn) {
  return new Promise((resolve, reject) => {
    const it = genFn();
    function step(arg) {
      try { const r = it.next(arg); }
      catch (e) { return reject(e); }
      if (r.done) return resolve(r.value);
      Promise.resolve(r.value).then(step, reject);  // yield 的 Promise resolve → 传回 Generator
    }
    step();
  });
}
```

**面试话术**：「await = yield 一个 Promise，引擎自动 next 传值；手写 run() 就是最小 co，Babel 编译 async 生成的 `_asyncToGenerator` 就是这个。」

## 4. 微任务时序（Promise 视角）

| 论断 | 要点 |
| ---- | ---- |
| 每轮必清空 | 宏任务后一口气清完所有微任务才取下一个宏任务 |
| 嵌套同批 | 微任务里加的微任务同批排空（清到空，不插队宏任务） |
| 同队列 FIFO | then / async 续体 / queueMicrotask 一个队列，按注册顺序 |
| 多 then | 都执行，按注册顺序（handlers 数组） |
| 不被宏任务打断 | 微任务一口气跑完 |
| Node 特例 | `process.nextTick` 是「当前宏任务尾部」独立优先队列，**先于** Promise 微任务 |
| 阻塞渲染 | 渲染在微任务清空后；微任务无限循环 → 页面卡死 |

## 5. 手写题串联（异步线 8 题）

| 题 | 一句话要点 |
| ---- | ---- |
| Promise 基础版 | 状态机 + 微任务 + 链式三件套 |
| then 链式 | 展平 + 错误跳过 |
| all / race | 保序索引写 / 先到先得 |
| async 转 Promise | run() 自执行器 |
| 串行 | `for...of + await`（forEach 不行）/ reduce 链式 |
| 并发池 | N 个 worker + index++ + results[i] 保序 |
| 并发控制 | 串行 = limit 1；池 = limit N |

## 6. 高频追问速答

- **Promise 状态可逆吗？** 不可逆，结果只定一次（`_settle` 幂等）
- **then 为什么返回新 Promise？** 返回 this 状态不能改，链会断
- **await 本质？** yield 一个 Promise，引擎自动 next 传值（Generator + 自执行器）
- **微任务会阻塞渲染吗？** 会——渲染在微任务清空后，无限微任务不渲染
- **nextTick 和 Promise 谁先？** Node 里 nextTick 先（独立优先队列）
- **async 函数返回什么？** Promise；`return v` → resolve v；throw → reject

> 30 秒完整版：**Promise 三件套 = 状态机（不可逆）+ 微任务调度 + 链式（返回新 Promise，展平+穿透+错误跳过）。all 保序短路、race 先到先得。async/await = Generator + 自执行器（await 编译成 yield，引擎 next 传值，手写 run() 即最小 co）。微任务每轮清空到空才取下一个宏任务，嵌套同批、FIFO、不被宏任务打断、会阻塞渲染；Node 的 nextTick 先于 Promise 微任务。**

---

## 深读入口

- [[手写题/Promise基础版]] —— 状态机/链式/微任务手写
- [[手写题/Promise链式与all-race]] —— then 链 + all/race/allSettled
- [[async-await本质]] —— Generator + 自执行器
- [[微任务时序深度]] —— Promise 视角微任务时序（实测）
- [[浏览器事件循环-面试速记]] —— 事件循环主线
- [[手写题/串行并发控制]] · [[手写题/Promise并发池与发布订阅]] —— 并发控制
- [[面试速记-索引]] —— 返回主索引
