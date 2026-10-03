# Promise 并发池 + 发布订阅

> **结论：并发池 = 限制同时执行的任务数（滑动窗口），N 个 worker 循环取任务，`results[i]` 按索引写保序，任一失败整体 reject。** 发布订阅 = 事件名 → 订阅者集合（`Map<name, Set<fn>>`），`on` 订阅、`off` 取消、`emit` 触发全部、`once` 只触发一次；**emit 遍历副本**防「回调里订阅新事件触发本次」的死循环。实测：并发池 5 任务/limit=2 耗时 98ms（串行 169ms），发布订阅 7 项断言全过。
>
> 可运行验证：[[并发池-发布订阅-验证脚本.js]]（Node 实测：并发池保序/边界 + 发布订阅 on/off/once/防死循环）

---

## 1. 一句话定义（背诵版）

| 模式 | 核心 | 一句话 |
| ---- | ---- | ---- |
| **并发池** | 限制并发 N | N 个 worker 循环取任务，同时最多 N 个，结果按索引保序 |
| **发布订阅** | 事件 → 订阅者集合 | `on` 订阅 / `emit` 触发 / `off` 取消 / `once` 一次 |

## 2. Promise 并发池（面试手写版）

```js
function pool(list, limit) {
  return new Promise((resolve, reject) => {
    const results = new Array(list.length);
    let index = 0;                       // 下一个要执行的任务索引
    let completed = 0;

    function next() {
      if (index >= list.length) return;  // 任务取完
      const i = index++;
      Promise.resolve()
        .then(() => list[i]())           // 惰性执行任务
        .then(v => {
          results[i] = v;                // 按索引写 → 保序
          if (++completed === list.length) resolve(results);
          else next();                   // 空出名额 → 拉下一个
        })
        .catch(reject);                  // 任一失败 → 整体 reject
    }
    for (let w = 0; w < Math.min(limit, list.length); w++) next();  // 启动 N 个 worker
  });
}
```

| 要点 | 说明 |
| ---- | ---- |
| `next()` 循环取任务 | 每个 worker 完成后调用 next 拉下一个（滑动窗口） |
| `results[i] = v` 按索引写 | 保序（不是 push，push 会乱序） |
| `index++` 原子递增 | 任务不重复、不遗漏 |
| 任一失败 `catch(reject)` | 整体 reject（和 Promise.all 一致的短路语义） |

实测：
```
[A1] limit=2, 5×30ms → 结果保序          ✅
[A2] 耗时 98ms（串行 169ms）             ✅ 并发更快
[B1] 空数组 → []                        ✅
[B2] limit>任务数 → 全执行 [1,2]         ✅ 边界安全
```

**和串行的关系**：并发池 limit=1 就是串行（[[手写题/串行并发控制]]）；limit=N 是并行的上限控制。**实际场景**：批量请求限流、图片懒加载并发控制、文件上传队列。

## 3. 发布订阅（面试手写版）

```js
class EventEmitter {
  constructor() { this.events = new Map(); }   // 事件名 → Set<回调>

  on(name, fn) {
    if (!this.events.has(name)) this.events.set(name, new Set());
    this.events.get(name).add(fn);
    return () => this.off(name, fn);           // 返回取消函数
  }
  off(name, fn) { this.events.get(name)?.delete(fn); }
  once(name, fn) {
    const wrapper = (...args) => { this.off(name, wrapper); fn(...args); };
    return this.on(name, wrapper);
  }
  emit(name, ...args) {
    const set = this.events.get(name);
    if (!set) return;
    [...set].forEach(fn => fn(...args));       // 遍历副本，防死循环
  }
}
```

| 要点 | 说明 |
| ---- | ---- |
| `Map<name, Set<fn>>` | 事件 → 订阅者集合；Set 天然去重 + 快速删 |
| `on` 返回取消函数 | 方便 `const off = bus.on(...); off()` |
| `once` 用包装函数 | 触发前先 `off` 自己，再执行（保证只一次） |
| `emit` 遍历 `[...set]` 副本 | **回调里 on/off 不影响本次遍历**（防死循环） |

实测：
```
[C1] on 两个订阅者 → 都触发 ["f1:hello","f2:hello"]   ✅
[C2] off 后只剩 f2 → 追加 ["f2:world"]                ✅
[D1] once → 只触发一次 ["第1次"]                       ✅
[E1] emit 中 on → 新订阅不触发本次 ["第一次"]           ✅ 防死循环
[E2] 下次 emit → 新订阅才触发                           ✅
```

## 4. 发布订阅 vs 观察者模式（高频对比）

| 维度 | 发布订阅（Pub/Sub） | 观察者（Observer） |
| ---- | ---- | ---- |
| 关系 | **发布者和订阅者解耦**（通过事件总线/中间层） | **目标和观察者直接关联**（subject 持有 observer 列表） |
| 触发 | `emit` 事件名，不关心谁在听 | `notify` 通知所有观察者 |
| 典型 | EventEmitter / Vue 事件总线 / 消息队列 | Vue2 响应式（dep 通知 watcher）/ 数据绑定 |
| 耦合 | 低（中间有 broker） | 高（subject 直接依赖 observer） |

> **一句话**：观察者 = 目标直接通知观察者（强耦合）；发布订阅 = 中间加了一层事件总线（解耦）。Vue2 的 `Dep`（观察者）+ EventBus（发布订阅）分别是两者的典型。

## 5. 高频追问速答

| 问题 | 一句话答案 |
| ---- | ---- |
| 并发池怎么限流？ | N 个 worker + `index++` 取任务 + `results[i]` 保序 |
| 并发池结果怎么保序？ | 预分配数组按索引写（push 会乱序） |
| 并发池失败怎么办？ | 任一失败整体 reject（短路） |
| 发布订阅核心数据结构？ | `Map<事件名, Set<回调>>` |
| once 怎么实现？ | 包装函数先 off 自己再执行 |
| emit 为什么遍历副本？ | 防回调里 on/off 影响本次遍历（死循环） |
| 发布订阅和观察者区别？ | 前者中间有事件总线解耦；后者 subject 直接通知 observer |

## 6. 面试速记（30 秒版）

> **并发池**：N 个 worker 循环取任务（`next()` 滑动窗口），`results[i]` 按索引写保序，`index++` 不重不漏，任一失败整体 reject。limit=1 即串行。**发布订阅**：`Map<事件名, Set<回调>>`，on 订阅（返回取消函数）、off 删除、once 包装先卸再执行、emit 遍历 `[...set]` 副本防死循环。**和观察者区别**：发布订阅中间有事件总线（解耦）；观察者 subject 直接 notify（强耦合）——Vue2 Dep 是观察者，EventBus 是发布订阅。

> 关联笔记：[[手写题/串行并发控制]]（limit=1 即串行） · [[手写题/Promise链式与all-race]]（短路语义） · [[手写题/观察者模式]]（对比） · [[手写题/单例模式]]（事件总线常配单例） · [[面试复习准备计划]]（W3 手写题 #19/20）
