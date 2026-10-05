# 解码Worker与SharedArrayBuffer

> **结论：解码必须出主线程（1080p 单帧软解 10~30ms，主线程做 = UI 全卡），帧传递要零拷贝（一帧 3MB，拷贝 ×2 = 带宽 ×3）——**SharedArrayBuffer 是 Worker↔主线程的零拷贝共享内存，代价是页面必须加 COOP/COEP 跨域隔离头**。SAB 不可用时的降级链：transferable ArrayBuffer（postTransfer 所有权，零拷贝但移交后不可再写）→ 结构化克隆（有拷贝，兜底）。实测：本机 Node/Chrome 的 SAB 可用性与 three 通道对比见 §3。**

> 可运行验证：§3 的 Node 实测脚本（SAB + Atomics 无依赖可跑）；Worker 管线的完整位置见 [[WASM软解H265管线]]（③④段）；COOP/COEP 是部署项不是代码项（§2.3）。

[[WASM软解H265管线]] · [[WASM内存管理]] · [[YUV格式与WebGL渲染]]

---

## 1. 背景：解码为什么放 Worker、帧怎么递回来

```
主线程：UI/渲染/时钟 ———— 10~30ms/帧的解码放这里 = 交互全卡
解码线程（Worker）：WASM 解码器 + 帧缓冲池 ———— 独立事件循环，UI 无感
```

问题在「递回来」：1080p YUV 帧 3.1MB，30fps = 每秒 93MB 的跨线程数据流。

| 传递方式 | 拷贝次数 | 机制 | 限制 |
| --- | --- | --- | --- |
| **SharedArrayBuffer** | **0** | 两线程同一块内存 + Atomics 同步 | 需 COOP/COEP 头 |
| postMessage(Transferable) | 0（所有权移交） | ArrayBuffer 的 ownership 转移 | 移交后原线程不可访问；每次新分配 |
| postMessage(克隆) | 1 | 结构化克隆 | 有拷贝但兼容性 100% |

## 2. 定义/原理：三种通道的机制

### 2.1 SharedArrayBuffer + Atomics（首选）

```js
// 主线程：分配共享帧缓冲池
const pool = new SharedArrayBuffer(3 * frameSize);      // 3 帧循环池
worker.postMessage({ type: 'init', pool }, []);          // SAB 不可 transfer（本来就共享）

// Worker：解码完写入池，Atomics 通知帧号
Atomics.store(header, 0, frameIdx);                      // 写元数据
Atomics.notify(header, 0);                               // 唤醒等待方（或主线程 rAF 轮询）

// 主线程：直接读同一块内存
const frame = new Uint8Array(pool, frameIdx * frameSize, frameSize);
gl.texImage2D(..., frame);                               // 喂纹理
```

**关键语义**：SAB 是「同一块内存的两个视图」，没有传输没有拷贝；同步靠 Atomics（防止读到写了一半的帧）。工程上用「N 帧环形池 + Atomics 序号」实现生产者-消费者。

### 2.2 transferable 降级（SAB 不可用时）

```js
// Worker：拷贝到一次性 buffer 后移交所有权（零拷贝，但对方拿走后自己没了）
const buf = new ArrayBuffer(frameSize);
new Uint8Array(buf).set(yuvFromWasm);
postMessage({ type: 'frame', buf, pts }, [buf]);         // transfer list

// 主线程：直接可用；用完**必须**还给 Worker 或丢弃
```

移交语义 = 「拿走」：原 Worker 不再能访问 → 想复用缓冲池就得把 buffer 再 transfer 回去（乒乓），或者每次新分配（GC 压力）。**SAB 可用时永远优先 SAB**。

### 2.3 COOP/COEP（SAB 的门票）

SAB 在 2018 年 Spectre 漏洞后被默认禁用，启用条件是页面处于跨域隔离：

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

| 检测 | 代码 |
| --- | --- |
| 运行时判断 | `typeof SharedArrayBuffer !== 'undefined' && crossOriginIsolated` |

**注意**：`crossOriginIsolated === false` 时 `typeof SharedArrayBuffer` 可能仍是 'function'（构造器在但使用受限）——**必须用 crossOriginIsolated 判断**，这是高频踩坑点。加了头之后，页面引用的第三方资源必须带 CORP/且 CORS 允许（第三方 CDN 不配合 = 白屏，部署时全站排查）。

## 3. 实测

### 3.1 SAB 可用性与 zero-copy 验证（Node 实测，无需浏览器）

> 🔗 脚本可直接跑（`node sab-probe.js`）：

```js
const { Worker } = require('worker_threads');
const sab = new SharedArrayBuffer(8);
const arr = new Int32Array(sab);
// 主线程写，worker 线程立即可见（同一内存）：
Atomics.store(arr, 0, 42);
new Worker(`const {workerData}=require('worker_threads');
  const a=new Int32Array(workerData);
  Atomics.wait(a,0,42);                       // 阻塞等待值变化
  console.log('worker saw:', Atomics.load(a,0));`, {eval:true, workerData:sab});
Atomics.add(arr,0,1); Atomics.notify(arr,0);    // →42→43, 唤醒
// 输出: worker saw: 43  （无拷贝、同步语义完整）
```

| 通道 | Node worker_threads | 浏览器 Worker |
| --- | --- | --- |
| SAB + Atomics | ✅（本机 Node 26 实测如上） | ✅ 但需 crossOriginIsolated |
| transferable | ✅ | ✅ |
| Atomics.wait 在主线程 | ❌（worker 内才行） | ❌（主线程禁用，用 notify+轮询或 message 事件） |

**Atomics.wait 主线程禁用**是设计决定的：主线程绝不允许阻塞等待（会冻死 UI）——同步模式必须是「Worker wait / 主线程 notify」或双方都事件驱动。

### 3.2 拷贝开销的量化（为什么零拷贝值得）

1080p YUV 3.1MB/帧 × 30fps：

| 方案 | 每秒跨线程搬运 | 30fps 预算占比（假设 memcpy ~5GB/s 单核） |
| --- | --- | --- |
| 结构化克隆（1 次拷贝） | 93 MB + 序列化开销 | ~2% 纯拷贝 + GC 压力 |
| **SAB（0 拷贝）** | **0** | 0%（只剩 Atomics 同步，ns 级） |

拷贝本身的 CPU 占比看似不高，但**每次克隆都是一次 3MB 分配 + GC 对象**——30fps 下 GC 频率翻倍引发的卡顿尖刺才是主要伤害（与 [[WASM内存管理]] 的帧池思想同源：固定内存复用，杜绝分配）。

### 3.3 WASM 多线程解码的部署条件（实测量级）

ffmpeg wasm `-pthread` 构建：WASM 内部再开 N 个解码线程（Worker 子集），**同一份 SAB 机制支撑**——所以 COOP/COEP 是 WASM 软解管线（[[WASM软解H265管线]] §3.2）的部署前置，不只是帧传递的前置。

## 4. 为什么这么设计？（背后取舍）

**为什么浏览器默认禁 SAB（要加头才给）？**
- Spectre 类侧信道攻击：共享内存 + 高精度计时 = 跨源数据泄露通道。COOP/COEP 是「声明我的页面只加载愿意配合隔离的资源」的承诺，浏览器才敢重新放开 SAB。**安全模型收紧 → 部署义务增加**，这是 Web 平台近年的整体走向。

**为什么 postMessage 不直接零拷贝？**
- 普通 postMessage 的语义是「值传递」（结构化克隆）：发送方的修改不影响接收方——这是安全的默认。Transferable 是例外（所有权语义），SAB 是更大的例外（共享可变状态）。**默认安全、例外显式**——与语言层 const/let 的哲学一致。

**为什么帧同步用 Atomics 而不是 postMessage 通知？**
- postMessage 跨线程走事件队列（µs~ms 级延迟 + 序列化）；Atomics.notify/wait 是 futex 级原语（ns~µs 级）。音视频管线对「帧就绪」的通知延迟敏感（30fps 帧间隔 33ms，通知开销必须可忽略）——**同步原语的粒度要匹配数据流的节拍**。

## 5. 规避 / 实践

| 场景 | 手段 |
| --- | --- |
| 部署 SAB | COOP/COEP 双头 + 第三方资源 CORP 排查清单 |
| 判断可用 | `crossOriginIsolated`（别用 typeof SAB） |
| 帧池 | N 帧 SAB 环形池 + Atomics 序号（生产者-消费者） |
| SAB 不可用降级 | transferable 乒乓（复用 buffer）→ 克隆（最后兜底） |
| 主线程同步 | 永远事件驱动（Atomics.wait 禁用），或 rAF 轮询序号 |
| 调试竞态 | 帧头写 magic + 序号，渲染前校验（防读到半帧） |

## 6. 面试速记

> **30 秒版**："解码出主线程因为单帧 10-30ms 会卡死 UI；帧传递首选 SAB 零拷贝——两线程同一块内存加 Atomics 同步，3MB 一帧 30fps 免了每秒 93MB 的拷贝和 GC 压力。代价是页面要 COOP/COEP 跨域隔离头（Spectre 后的安全门票），判断可用用 crossOriginIsolated 别用 typeof。降级链 transferable 乒乓再兜底克隆。还有个细节：Atomics.wait 主线程禁用，同步必须事件驱动。WASM 的 pthread 多线程解码也靠同一套 SAB，所以这头是软解管线部署的前置项。"

## 相关笔记

- [[WASM软解H265管线]] —— 本篇是管线线程模型的展开
- [[WASM内存管理]] —— 帧池与线性内存（同源的固定内存思想）
- [[YUV格式与WebGL渲染]] —— 帧递回主线程后的渲染终点
- [[../浏览器原理/浏览器事件循环(EventLoop)]] —— Worker 与主线程事件循环的隔离模型

*本文档基于 Node 26 worker_threads 实测、W3C Workers/SAB 规范、Emscripten pthread 构建实践整理。*
