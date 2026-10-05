# 手写 Promise（基础版）

> **结论：Promise 本质是「状态机 + 回调暂存/调度 + 链式返回新 Promise」。** 核心三件事：**① 状态不可逆**（pending → fulfilled/rejected，一旦改变不再变）；**② then 回调微任务异步执行**（`queueMicrotask` 模拟，先于宏任务）；**③ then 返回新 Promise**（回调返回值传给下一个 then，抛错进下一个 onRejected——这就是链式 + 值穿透的来源）。实测：状态机/微任务时序/链式/穿透/错误处理 6 组全过。
>
> 可运行验证：[[Promise基础版-验证脚本.js]]（Node 实测：状态机 / 微任务时序 / 链式 / 穿透 / settled 后 then / 错误处理）

---

## 1. 一句话定义（背诵版）

**Promise = 状态机（不可逆）+ 回调队列（暂存 + 微任务调度）+ 链式（then 返回新 Promise）。**

```js
function MyPromise(executor) {
  this.state = 'pending';        // pending / fulfilled / rejected
  this.value = undefined;
  this.handlers = [];            // 挂起的 then 回调
  const resolve = (v) => this._settle('fulfilled', v);
  const reject = (r) => this._settle('rejected', r);
  try { executor(resolve, reject); } catch (e) { reject(e); }  // 同步抛错 → reject
}

MyPromise.prototype._settle = function (state, value) {
  if (this.state !== 'pending') return;        // ① 状态不可逆
  this.state = state;
  this.value = value;
  this.handlers.forEach(h => this._run(h));    // ② 状态定了 → 调度挂起回调
  this.handlers = [];
};

MyPromise.prototype._run = function (handler) {
  queueMicrotask(() => {                       // ③ 微任务异步执行
    const isFulfilled = this.state === 'fulfilled';
    const cb = isFulfilled ? handler.onFulfilled : handler.onRejected;
    const next = handler.promise;
    if (typeof cb !== 'function') {            // ④ 值穿透
      isFulfilled ? next._resolve(this.value) : next._reject(this.value);
      return;
    }
    try { next._resolve(cb(this.value)); }     // ⑤ 返回值 → 下一个 then
    catch (e) { next._reject(e); }             // ⑥ 抛错 → 下一个 onRejected
  });
};

MyPromise.prototype.then = function (onFulfilled, onRejected) {
  const next = new MyPromise(() => {});        // ⑦ 链式：返回新 Promise
  if (this.state === 'pending') this.handlers.push({ onFulfilled, onRejected, promise: next });
  else this._run({ onFulfilled, onRejected, promise: next });
  return next;
};

MyPromise.prototype.catch = function (onRejected) {
  return this.then(null, onRejected);          // ⑧ catch = 只处理失败的 then
};
```

## 2. 核心机制逐条讲（实测）

### ① 状态机不可逆（实测 A）

```js
if (this.state !== 'pending') return;   // 幂等：非 pending 直接忽略
```

```
[A1] resolve 后 state = fulfilled
[A2] 先 resolve 再 reject → state = fulfilled | value = 1（reject 被忽略）
```

**为什么**：Promise 的契约是「结果只定一次」。`resolve(1)` 后 `reject(2)` 无效——第一个决定结果的操作生效。这是和回调风格（可能被调两次）的本质区别。

### ② 微任务调度（实测 B）

```js
queueMicrotask(() => { ... });   // 模拟原生 Promise 的微任务
```

```
[B1] 执行顺序 = ["同步","微任务1","宏任务"]
```

**为什么**：then 回调必须**异步**执行（等当前同步代码跑完），且优先级**高于宏任务**（setTimeout）。`queueMicrotask` 就是微任务队列的入口，和原生 Promise 内部用的同一个队列。这关联 [[浏览器事件循环(EventLoop)]] 的「微任务先于渲染、先于宏任务」。

### ③ 链式 + 值穿透 + 错误传递（实测 C/D/F）

```
[C1] 链式结果 = ["第1个:1","第2个:2","第3个:3"]   ← 返回值传递
[D1] 穿透结果 = ["值"]                           ← 没传回调就透传
[F1] reject 进 onRejected = ["捕获:出错了"]       ← 错误进入 onRejected
```

**为什么 then 返回新 Promise**：如果 then 返回 this，链式就断了（同一个 Promise 不能改状态）。返回**新** Promise，回调返回值/抛错决定新 Promise 的状态——这是 `.then().then().then()` 能无限链的原因。

**值穿透**：`.then()` 没传回调时，`undefined` 不是「值」——要把当前的值/原因原样传给下一个 then。否则 `.then().then(v => ...)` 会拿到 undefined（实测 D1 拿到"值"）。

## 3. 与原生 Promise 的差距（面试追问）

| 差距 | 说明 |
| ---- | ---- |
| resolve 一个 Promise | 原生会**展平**（吸收外部 Promise 状态）；手写基础版没处理 |
| Promise.resolve/race/all 静态方法 | 基础版只有 then，没有静态方法 |
| catch/finally | 原生是 `then(null, onRej)` 的语法糖 + finally。基础版已补 catch（实测 G） |
| 微任务 | 用 `queueMicrotask` 模拟，原生用内部微任务队列（行为一致） |

> 面试话术：「基础版验证了状态机/链式/穿透三个核心；完整的还要处理 resolve 展平（Promise 吸收）、静态方法（all/race）、catch/finally。基础版够讲清原理，追问再展开。」

## 4. 高频追问速答

| 问题 | 一句话答案 |
| ---- | ---- |
| Promise 核心是什么？ | 状态机（不可逆）+ 回调暂存/调度 + 链式返回新 Promise |
| 状态为什么不可逆？ | 结果只定一次，这是和回调风格的区别 |
| then 为什么返回新 Promise？ | 返回 this 状态不能改，链就断了；新 Promise 让链无限延续 |
| 回调为什么异步？ | then 回调进微任务队列，先于宏任务（关联事件循环） |
| 值穿透是什么？ | 没传回调时把当前值/原因原样传下去，不是 undefined |
| 回调抛错怎么办？ | 下一个 then 的 onRejected 收到（try/catch 捕获 → reject） |
| catch 怎么实现？ | `then(null, onRejected)` 的语法糖——跳过成功回调、只接失败（实测 G） |
| 和原生差距？ | resolve 展平、静态方法（all/race）、catch/finally（catch 基础版已补） |

## 5. 面试速记（30 秒版）

> **手写 Promise 核心三件套：状态机（`_settle` 幂等，非 pending 忽略 → 不可逆）、微任务调度（`queueMicrotask`，then 回调异步且先于宏任务）、链式（then 返回新 Promise，返回值传给下一个，抛错进 onRejected，没传回调就值穿透）。** executor 同步执行 + try/catch 捕获同步抛错。**catch = `then(null, onRejected)` 语法糖**。**面试追问**：和原生差距 = resolve 展平（Promise 吸收）、静态方法 all/race、finally。

> 关联笔记：[[浏览器事件循环(EventLoop)]]（微任务队列） · [[微任务（microtask）]]（then 回调为何是微任务） · [[手写题/Promise.then 链式]] · [[手写题/Promise.all]] · [[面试复习准备计划]]（W3 手写题 #13）
