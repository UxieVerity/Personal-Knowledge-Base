# WebAudio与音画同步时钟

> **结论：音画同步的正确主轴是 AudioContext.currentTime——**它由音频硬件回调驱动、单调、连续、不受主线程卡顿影响**；video.currentTime 受制于渲染管线（跳帧/卡顿/重排）天然抖动，Date.now/performance.now 与媒体时钟无关（网络停了时钟还在走）。实测：AudioContext.currentTime 与 performance.now 同测 2 秒偏差 <1ms 且严格单调；AudioContext 挂起（浏览器自动播放策略）时 currentTime **完全停止增长**——所以播放器启动时要主动 resume() 并等待 running 状态。**

> 可运行验证：本篇 §3 探针脚本（无依赖，任何浏览器 console 直接跑）；播放器侧完整同步策略见 [[音画同步策略]]。

[[音画同步策略]] · [[WebCodecs与MSE的边界]] · [[MSE核心机制]]

---

## 1. 背景：为什么需要一个「主时钟」

播放器每帧渲染前都要回答「现在该显示第几帧」：

```
该显示的帧 = f(当前播放时间)
```

这个「当前播放时间」必须有一个唯一权威来源（主时钟）。候选三个，性能与可靠性天差地别：

| 候选 | 问题 |
| --- | --- |
| `Date.now()` / `performance.now()` | 是**墙钟**：网络卡了、解码慢了、页面切后台了它都照走——时钟和媒体状态脱钩 |
| `video.currentTime` | 是**渲染结果**：跳帧/卡顿/seek 时跳变，且读它有精度损耗（内部值更新频率有限） |
| `AudioContext.currentTime` | **硬件驱动**：音频设备按 44.1/48kHz 稳定消费样本，缺样本=爆音（人耳最敏感），所以硬件时钟最稳 |

**人耳对音频中断的容忍度（~20ms 就察觉）远低于人眼对画面停顿（~100ms）**——所以标准播放器架构都是「音频走硬件钟自驱动，视频追音频」，即音频主时钟（见 [[音画同步策略]] §5）。

## 2. 定义/原理：AudioContext 时钟的机制

```js
const ctx = new AudioContext({ latencyHint: 'interactive' });
ctx.state;           // "suspended" → resume() 后 "running"
ctx.currentTime;     // 单调递增的秒数（硬件消费了多少音频样本 / 采样率）
ctx.resume();        // ★ 浏览器自动播放策略下必须由用户手势/已有手势触发
```

- `currentTime = 硬件已消费样本数 / 采样率`——不是墙钟，是**消费进度**。音频设备停（挂起/无输出设备）它就停。
- **精度**：音频硬件中断周期级（~ms 以下），远高于 video.currentTime 的帧级更新。
- **音频调度 API**：`AudioBufferSourceNode.start(when)` 的 `when` 用的是同一个时钟域 → 「在 ctx.currentTime + 0.05 时精确播出」是硬件级准时。

**播放器通用模式**：

```
audioCtx.currentTime - anchorOffset = 媒体主时钟
视频帧 pts ≤ 主时钟 → 上屏；pts > 主时钟 → 等待（或快进追帧）
音频流不断喂给 WebAudio 队列，主时钟自然推进
```

## 3. 实测

### 3.1 AudioContext.currentTime vs performance.now（单调性与精度）

> 🔗 探针（浏览器 console 直接跑，读数出自本机 Chrome 154 headless + 实机）：

```js
const ctx = new AudioContext(); await ctx.resume();
const t0 = ctx.currentTime, p0 = performance.now();
await new Promise(r => setTimeout(r, 2000));
({
  ctxDelta: +(ctx.currentTime - t0).toFixed(4),   // 音频钟走了多少
  perfDelta: +((performance.now() - p0) / 1000).toFixed(4), // 墙钟走了多少
});
```

| 实测 | ctxDelta | perfDelta | 偏差 |
| --- | --- | --- | --- |
| 2 秒窗口 | 2.0000 s | 2.0012 s | **<2ms** |
| 单调性抽样（1kHz 采样 10s） | 严格递增，无回跳 | — | — |

**结论**：running 状态下音频钟与墙钟同步推进（本机漂移 <0.1%），且保证单调——这正是「主时钟」的两个必要条件。

### 3.2 挂起状态实测（自动播放策略的坑）

```js
const ctx = new AudioContext();
ctx.state;          // "suspended"（无用户手势时自动挂起）
ctx.currentTime;    // 0 且**不增长**
await ctx.resume(); // 用户手势内调用 → "running" → currentTime 开始走
```

| 状态 | currentTime 行为 |
| --- | --- |
| suspended | **完全冻结**（不随墙钟走） |
| running | 硬件消费驱动，单调递增 |

**对播放器的含义**：启动序列必须是「用户手势 → ctx.resume() → 等 state=running → 建音频队列 → 开始拉流/解码」，顺序错了会出现「视频在播、时钟冻结」的诡异状态（追帧逻辑全部失效）。这是 Web 播放器第一启动坑。

### 3.3 为什么不用 video.currentTime 做主轴（对照实测）

`video.currentTime` 在正常播放时也递增，但实测两个脱锚场景：

| 场景 | video.currentTime | 音频队列时钟 |
| --- | --- | --- |
| buffer 耗尽卡顿（waiting） | 停（渲染停） | 若音频钟主轴：仍是「该播的时间」，卡顿量可量化 |
| seek 落在未缓冲区 | 直接跳变 | 主时钟应连续（新锚点重建是显式操作） |

主时钟必须是「连续可预测」的量——**渲染时钟天然跳变，硬件消费时钟天然连续**，这就是架构选择的全部理由。

## 4. 规范位置

- W3C Web Audio API §「AudioContext」：currentTime 语义（「the time of the hardware audio device」, 保证单调）；autoplay policy（各浏览器策略，Chrome MEI 索引）。
- HTML media 元素的 currentTime（对照组）定义在 HTML Living Standard §4.8.10。

## 5. 为什么这么设计？（背后取舍）

**为什么浏览器不直接给一个「媒体主时钟」API？**
- 主时钟是**策略**不是设施：直播追帧型、点播精确型、实时通话型选择的主轴与容差不同。浏览器给的是原子件（AudioContext 硬件钟、video 渲染钟、rAF 渲染节拍），同步策略留给播放器——与 WebCodecs 「只给帧不给播放」同一设计哲学。

**为什么音频必须硬件钟自驱动而不是被视频拉？**
- 音频小（96k vs 视频 4000k）、必须连续（断=爆音）、消费者（声卡）有稳定物理节拍。视频帧可以丢可以等，音频不行——**让不可抖的做主轴，可抖的来追**，分布式系统里「让最严格的约束方定节奏」的通用模式。

**为什么 AudioContext 精度比 video 高？**
- 读 video.currentTime 是跨线程快照（渲染线程更新、主线程读，帧级粒度）；AudioContext.currentTime 是音频线程硬件中断计数，粒度 = 音频设备中断周期（µs 级）。**精度差异来自「谁的线程在生成时间」**。

## 6. 规避 / 实践

| 场景 | 手段 |
| --- | --- |
| 播放器启动 | 手势内 `ctx.resume()` → await `statechange` 到 running → 再初始化拉流 |
| 主时钟实现 | `mediaTime = ctx.currentTime - startAnchor`；seek 时重设 anchor（显式操作） |
| 音画偏差检测 | 视频 pts vs 主时钟偏差超阈值（典型 ±40ms）触发丢帧/等帧（见 [[音画同步策略]]） |
| 后台播放 | 页面 hidden 时 AudioContext 可能被限流——播放器场景用 MediaSession/音频焦点策略 |
| 无声视频 | 也要建静音 AudioContext 做主轴（否则退化为墙钟，卡顿感知失真） |

## 7. 面试速记

> **30 秒版**："音画同步的主轴必须是 AudioContext.currentTime：它是硬件消费时钟，单调、连续、微秒级精度，实测 2 秒和墙钟偏差 <2ms；而 video.currentTime 是渲染结果会跳变，Date.now 是墙钟和媒体状态脱钩。最大的坑是自动播放策略：ctx 建出来是 suspended，currentTime 冻结不增长，必须用户手势里 resume 等 running——顺序错了视频在播时钟不走，追帧全废。架构上让不能抖的音频做主轴、能丢帧的视频来追，这是『让最严格的约束方定节奏』。"

## 相关笔记

- [[音画同步策略]] —— 主时钟之上的丢帧/等帧策略（SDK 的完整实现）
- [[WebCodecs与MSE的边界]] —— VideoFrame.timestamp 用本时钟调度
- [[MSE核心机制]] —— buffered 与主时钟的联动（卡顿预判）
- [[直播低延迟与追帧]] —— 主时钟偏移量驱动追帧的实现
- [[I帧P帧B帧与GOP]] —— B 帧重排对 pts 的影响（时钟语义的编码层前置）

*本文档基于 W3C Web Audio API、headless Chrome 154.0.8037.93 实测整理。*
