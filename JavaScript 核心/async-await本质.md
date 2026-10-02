# async/await 本质（Generator 语法糖）

> **结论：`async/await` = `Generator`（`yield` 暂停/恢复）+ **自执行器**（自动 `next()` 驱动）的语法糖。** 编译器（Babel/TS）把 async 函数转成 Generator + 一个类似 co 的 `run()` 驱动：**`await x` 编译成 `yield x`，引擎自动 `.then(step)` 把 resolve 的值传回 Generator**。实测：手写 `run()` 驱动 Generator 的行为与原生 async/await **完全一致**（顺序/返回值/错误传播）。
>
> 可运行验证：[[async-await本质-验证脚本.js]]（Node 实测：Generator 双向传值 / 手写自执行器 / 与原生等价 / 错误传播）

---

## 1. 一句话定义（背诵版）

**async/await 不是新机制，是「Generator 暂停 + 自动恢复」的包装。**

| 概念 | 本质 |
| ---- | ---- |
| `async function` | 返回 Promise 的函数（内部可以有 await） |
| `await x` | = `yield x`（暂停，等 x 的 Promise resolve） |
| 自动恢复 | 引擎内部有「自执行器」：`.then(值 => next(值))` 把结果传回 |
| 返回值 | `return v` → 外层 Promise resolve v |

## 2. Generator 的双向传值（实测 A，基础）

```js
function* gen() {
  const a = yield '第一步';     // ① 向外吐 '第一步'，暂停
  return a + '!';               // ③ 收到 next('收到A') → a='收到A'
}
it.next();              // {value:'第一步', done:false}   吐值
it.next('收到A');       // {value:'收到A!', done:true}    传值回 Generator
```

实测：
```
[A1] 首次 next → {value:"第一步", done:false}   ← yield 向外吐值
[A2] next("收到A") → {value:"收到A!", done:false} ← next(值) 把值传回（赋给 yield 表达式）
[A3] next("收到B") → {value:"收到B!", done:true}  ← return 结束
```

**关键**：`yield` 是**双向通道**——向外吐值（next 的返回），也向内收值（next 的参数赋给 yield 表达式）。这就是 await 能「拿到 Promise 结果」的机制：引擎 `next(result)` 把 resolve 的值塞回来。

## 3. 手写自执行器（实测 B，核心）

```js
function run(genFn) {
  return new Promise((resolve, reject) => {
    const it = genFn();
    function step(arg) {
      let r;
      try { r = it.next(arg); }          // 恢复 Generator，传上次 await 的结果
      catch (e) { return reject(e); }    // Generator 内抛错 → Promise reject
      if (r.done) return resolve(r.value);      // 完成 → resolve 最终值
      Promise.resolve(r.value).then(step, reject);  // 等 yield 的 Promise，值传回再 step
    }
    step();
  });
}
```

**自执行器的灵魂**：`Promise.resolve(r.value).then(step)` —— yield 吐出一个 Promise，**等它 resolve 后，把值作为参数调 step（= next），恢复 Generator**。Generator 的 `yield 表达式` 就拿到了这个值。如此循环直到 `done: true`。

实测：
```
[B1] Generator+runner → {user:张三, posts:[2篇]}   ✅ 和原生 async 一样
[C1] 原生 async → 同样结果                         ✅ 等价
[D1] asyncToPromise 包装 → 用户李四，编号20         ✅ 可复用封装
[E1] Generator 抛错 → reject                       ✅ 错误传播（step 的 try/catch）
```

## 4. 手写 asyncToPromise（把 Generator 变成 async 函数，实测 D）

```js
function asyncToPromise(genFn) {
  return function (...args) {
    return run(genFn.bind(this, ...args));  // 透传 this + 参数
  };
}

const fetchUser = asyncToPromise(function* (id) {
  const user = yield fetchUserById(id);   // await 效果
  return user.name;
});
```

这就是 **co 库的最小形态**（co 还支持 yield 数组/对象/Generator 嵌套）。Babel 编译 async 函数时生成的 `_asyncToGenerator` 就是干这个的——**面试手写 async 转 Promise = 写这个 run()**。

## 5. async/await 错误处理（实测 E）

- `await` 的 Promise **reject** → 在 await 处**抛出异常**（不是穿透，是抛给当前函数）
- `try/catch` 包住 await 就能捕获（等价 Generator 里 try/catch 包 yield）
- 自执行器里 `it.throw(e)` 把错误抛回 Generator 内部（co 的做法），让 Generator 的 try/catch 生效

实测：
```
[E1] Generator 内部 throw → Promise reject: Generator 内部错误  ✅
```

## 6. 为什么这么设计

- **为什么需要 Generator**：JS 单线程，异步要靠回调。但回调嵌套（回调地狱）不可读。Generator 让函数能**中途暂停、外部恢复**——「暂停点」就是 await 的位置。
- **为什么自执行器是必要的**：Generator 自己不会自动跑（要手动 next）。async/await 的「魔法」就是**引擎内置自执行器**——你写 `await`，引擎负责 next 循环。手写 run() 就是把这个隐藏的引擎逻辑显式化。
- **为什么用 Promise 桥接**：yield 吐出的东西要能「等」——Promise 提供了统一的异步完成通知（then）。Generator + Promise + 自执行器 = 完整的 async/await。

## 7. 高频追问速答

| 问题 | 一句话答案 |
| ---- | ---- |
| async/await 本质？ | Generator（yield 暂停）+ 自执行器（自动 next）的语法糖 |
| await 编译成什么？ | `yield x`，引擎 `.then(step)` 把 resolve 值传回 |
| 手写 async 转 Promise？ | 写 run()：`it.next(arg)` + `Promise.resolve(value).then(step)` 循环直到 done |
| Generator 怎么双向传值？ | yield 向外吐（next 返回），next(值) 向内收（赋给 yield 表达式） |
| await 的 Promise reject 会怎样？ | 在 await 处抛异常，try/catch 可捕获 |
| co 是什么？ | 自执行器的库版（支持 yield 数组/对象/嵌套） |
| 和普通 Promise 区别？ | async/await 是 Promise 的语法糖，底层还是 Promise + 微任务 |

## 8. 面试速记（30 秒版）

> **async/await = Generator + 自执行器。** `await x` 编译成 `yield x`；引擎自动 `.then(值 => next(值))` 把结果传回 Generator（yield 是双向通道：向外吐值、向内收值）。**手写 async 转 Promise = 写 run()**：`it.next(arg)` → `Promise.resolve(r.value).then(step)` 循环，`done` 则 resolve，Generator 抛错则 reject（co 的最小形态）。**面试亮点**：说清「await 的 reject 在 await 处抛异常，try/catch 可捕获」+「自执行器是引擎隐藏的逻辑」。

> 关联笔记：[[手写题/Promise基础版]]（Promise 是 await 的底层） · [[浏览器事件循环(EventLoop)]]（微任务调度） · [[手写题/串行并发控制]]（await 循环 = 串行） · [[手写题/Promise 并发池]]（并发控制） · [[面试复习准备计划]]（W3 周四/国庆）
