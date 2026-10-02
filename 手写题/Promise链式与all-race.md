# Promise.then 链式 + all / race

> **结论：then 链式的三个机制——返回值传递（普通值直接给下一个 then）、Promise 展平（返回 Promise 则等待其 resolve）、错误跳过（reject 跳过所有 onFulfilled 直到 catch）。** `Promise.all` = 全部成功才 resolve（**保序**）、任一失败整体 reject（短路）；`Promise.race` = **第一个 settle 的赢**（resolve 或 reject 谁先谁算）。手写 all 用「索引存值 + 计数」保序，race 用「每个 p.then(resolve, reject)」先到先得。实测 10 项全过。
>
> 可运行验证：[[Promise链式-all-race-验证脚本.js]]（Node 实测：链式/展平/错误跳过/all/race/手写对比）

---

## 1. 一句话定义（背诵版）

| 机制 | 一句话 |
| ---- | ---- |
| **链式传递** | `then` 回调的**返回值**成为下一个 then 的输入 |
| **Promise 展平** | 回调返回 Promise → 等待它 resolve，拿到内部值（不是 Promise 套 Promise） |
| **错误跳过** | reject 后跳过所有 onFulfilled，直达最近的 onRejected/catch |
| **Promise.all** | 全部成功 → 保序数组；任一失败 → 整体 reject（短路） |
| **Promise.race** | 第一个 settle 的结果（不管 resolve 还是 reject） |

## 2. then 链式三机制（实测）

```js
new Promise(res => res(1))
  .then(v => v + 1)                                   // 返回数字 → 下一个直接收
  .then(v => Promise.resolve(v + 1))                  // 返回 Promise → 展平等待
  .then(v => ...)                                     // v = 3（不是 Promise）
```

实测：
```
[A] 链式 = ["A1:1","A2:2","A3:3"]        ✅ 返回值传递 + Promise 展平
[B] 错误链 = ["捕获:中间出错"]            ✅ reject 跳过 onFulfilled 直达 catch
```

**为什么展平**：`.then(v => fetch(...))` 返回的是 Promise，如果不展平，下一个 then 拿到的是 Promise 对象而不是数据——要 `v.then()` 再解一层。展平让链式代码像同步一样连贯。

**为什么错误跳过**：Promise 链是「状态流」——一旦 reject，后续 onFulfilled 全部不执行，直到遇到 onRejected。这是**错误集中处理**（catch 放链尾兜底）的基础。

## 3. Promise.all（实测）

```js
Promise.all([p1, p2, p3])
```

实测：
```
[C1] 全部成功 → 全部:[1,2,3]      ✅ 保序（按传入顺序，不是完成顺序）
[C2] 任一失败 → reject:X          ✅ 短路（整体 reject，不等其他）
```

**手写实现（保序关键）**：

```js
function myAll(ps) {
  return new Promise((resolve, reject) => {
    const results = new Array(ps.length);   // 预分配，按索引存 → 保序
    let done = 0;
    if (ps.length === 0) return resolve([]);
    ps.forEach((p, i) => {
      Promise.resolve(p).then(v => {
        results[i] = v;                     // 用索引存（不是 push → 乱序）
        if (++done === ps.length) resolve(results);
      }, reject);                           // 任一失败 → 整体 reject（短路）
    });
  });
}
```

**为什么用 `results[i] = v` 而不是 `push`**：push 按完成顺序，快的先入队 → 结果乱序。**预分配数组 + 索引写入**保证结果顺序 = 传入顺序（Promise.all 的契约）。

## 4. Promise.race（实测）

```js
Promise.race([slow, fast])
```

实测：
```
[D1] 快的 resolve 先 → 先到:快的   ✅ 先到先得
[D2] 快的 reject 先 → 先败:立即失败 ✅ reject 也能赢（谁先 settle 谁算）
```

**手写实现**：

```js
function myRace(ps) {
  return new Promise((resolve, reject) => {
    ps.forEach(p => Promise.resolve(p).then(resolve, reject));  // 第一个 settle 的赢
  });
}
```

**为什么这么短**：`Promise.resolve(p)` 保证参数可以是普通值；`then(resolve, reject)` 让**任何一个先 settle**（无论成败）直接决定外层 Promise。race 不需要计数、不需要保序——「第一个」天然覆盖。

## 5. all vs race vs allSettled（对比）

| | all | race | allSettled |
| ---- | ---- | ---- | ---- |
| 结果 | 全部成功 → 保序数组 | 第一个 settle 的结果 | 全部完成 → `{status, value/reason}[]` |
| 任一失败 | **整体 reject**（短路） | 若失败者是第一个 → reject | **不 reject**，记录每个的 status |
| 适用 | 并行请求全成功 | 超时竞争（谁先谁用） | 不在乎成败，都要结果 |

> 面试加分：**race 做超时**——`Promise.race([fetch(url), sleep(3000).then(() => {throw '超时'})])`，3 秒没回来就 reject。这是 race 最经典的实战。

## 6. 高频追问速答

| 问题 | 一句话答案 |
| ---- | ---- |
| then 链式怎么传值？ | 回调返回值给下一个 then；返回 Promise 则展平 |
| 展平是什么？ | 返回 Promise 时等待 resolve，拿到内部值而非 Promise 对象 |
| 错误怎么在链里走？ | reject 跳过所有 onFulfilled，直达最近 onRejected/catch |
| all 怎么保序？ | 预分配数组 + 索引写入（push 会乱序） |
| all 任一失败？ | 整体 reject，短路不等其他 |
| race 是什么？ | 第一个 settle 的赢（resolve/reject 谁先谁算） |
| allSettled 区别？ | 不短路，全部完成返回 status 数组 |
| race 实战？ | 超时竞争（fetch vs sleep 抛错） |

## 7. 面试速记（30 秒版）

> **链式三机制：返回值传递、Promise 展平（返回 Promise 等 resolve）、错误跳过（reject 直达 catch）。** `Promise.all`：全成功 → **保序数组**（预分配索引写，不是 push），任一失败 → 整体 reject 短路。`Promise.race`：**第一个 settle 赢**（成败都算），`then(resolve, reject)` 一行实现。**经典实战**：race 做超时（`race([fetch, sleep 抛错])`）。

> 关联笔记：[[手写题/Promise基础版]]（状态机/链式基础） · [[浏览器事件循环(EventLoop)]]（微任务） · [[手写题/串行并发控制]] · [[手写题/Promise 并发池]] · [[面试复习准备计划]]（W3 手写题 #14/15/16）
