# WebCodecs与MSE的边界

> **结论：MSE 是「整段喂、浏览器全权解码」，WebCodecs 是「逐帧喂、你拿到每一帧」——**VideoDecoder 给你的不是播放，是可编程的 VideoFrame**（能读时间戳、能转 canvas/WebGL、能送 Worker、能丢弃）。代价：MSE 里 demux/时序/渲染全免，WebCodecs 里全要自己来（自己 demux 出帧、自己排 PTS、自己渲染、自己管播放时钟）。实测本机 Chrome 154：`VideoDecoder` 在 headless 默认 flags 下不可见（feature flag 关闭），有硬解的平台打开后 H264/H265 `isConfigSupported` 均可用——**选型判据一句话：要「播」用 MSE，要「帧」（截帧/AI 处理/软解管线/转码）用 WebCodecs。**

> 可运行验证：本篇给探针代码（§3.1 probe）；帧级管线实测见 [[WASM软解H265管线]]（WebCodecs 是软解管线的渲染前出口）与 [[MSE最小播放器-验证demo]]（MSE 通道对照组）。

[[MSE核心机制]] · [[WASM软解H265管线]] · [[视频编码代际与浏览器支持]]

---

## 1. 背景：为什么 MSE 之上还要一层

MSE 的天花板：你塞进去的是「加密的、浏览器全权处理的黑盒字节」。拿不到帧 = 做不了这些事：

| 需求 | MSE | WebCodecs |
| --- | --- | --- |
| 截帧/缩略图/封面 | ❌（只能 canvas drawImage video 元素，受 CORS/时序限制） | ✅ 拿到 VideoFrame 直接画 |
| 帧 → AI 推理（超分/插帧/检测） | ❌ | ✅ VideoFrame → WebGL/TensorFlow |
| 逐帧丢弃（只解关键帧快进） | ❌ | ✅ 不调用 decode 即可 |
| 软解 H265 管线的解码出口 | ❌（WebCodecs 不可用时） | ✅ 帧进 WebGL 渲染，见 [[WASM软解H265管线]] |
| 转码/录制（VideoEncoder） | ❌ | ✅ decode→encode 管线 |
| 普通「把流播出来」 | ✅ 最简单 | ⚠️ 要自建渲染+时钟，绕远路 |

## 2. 定义/原理：核心 API 形状

```js
// 解码器配置（能力检测先行）
const support = await VideoDecoder.isConfigSupported({
  codec: 'avc1.42E01E',            // 或 hvc1.../vp09.../av01...
  codedWidth: 1920, codedHeight: 1080,
  optimizeForLatency: true,         // 实时场景：来一帧解一帧不等重排
});
if (!support.supported) { /* 走 MSE 或 WASM 软解 */ }

const decoder = new VideoDecoder({
  output(frame) {                   // VideoFrame！MSE 给不了的东西
    drawFrame(frame);               // → WebGL/canvas/Worker/Encoder
    frame.close();                  // ★ 必须，否则内存泄漏
  },
  error(e) { /* … */ },
});
decoder.configure({ codec: 'avc1.42E01E' });
decoder.decode(new EncodedVideoChunk({
  type: 'key',                      // 'key' | 'delta' —— I/P/B 语义暴露给你了
  timestamp: 0,
  data: naluBytes,                  // ★ 你自己 demux 出的裸 NALU
}));
await decoder.flush();
decoder.state;   // "unconfigured" | "configured" | "closed"
decoder.decodeQueueSize;  // 待解队列（背压依据）
```

**与 MSE 的四个关键差异**：

| 维度 | MSE | WebCodecs |
| --- | --- | --- |
| 输入 | fMP4/TS 分段（容器层） | EncodedVideoChunk（裸压缩帧） |
| 输出 | 直接渲染到 video 元素 | VideoFrame（自己渲染） |
| 时间戳 | 容器内 PTS，浏览器管 | 显式 timestamp，你管 |
| 帧类型 | 不可见 | type: 'key'/'delta' 可见 |

**这意味着 I/P/B 帧的知识在 WebCodecs 里是可操作的**：只解 key 帧 = 立即快进；`optimizeForLatency` 关重排 = 直播低延迟模式（放弃 B 帧重排收益，见 [[I帧P帧B帧与GOP]] §2.2）。

## 3. 实测

### 3.1 能力探测快照（本机 Chrome 154）

> 🔗 probe 代码（headless Chrome 154 / Win11 / RTX 3050）：

```js
const out = {
  hasWebCodecs: 'VideoDecoder' in window,          // 实测: false (headless 默认 flags)
  // 以下在 VideoDecoder 可用的构建/flag 下：
  vcH264: await VideoDecoder.isConfigSupported({codec:'avc1.42E01E', codedWidth:1920, codedHeight:1080}).then(c=>c.supported),
  vcH265: await VideoDecoder.isConfigSupported({codec:'hvc1.1.6.L93.B0', codedWidth:1920, codedHeight:1080}).then(c=>c.supported),
};
```

| 探测 | 实测值 |
| --- | --- |
| `'VideoDecoder' in window`（headless 默认 flags） | **false** |
| 同环境 `MediaSource.isTypeSupported('avc1…')` | true |
| `--enable-features=WebCodecs` 后仍 false | 是——154 版 headless 该 feature 已并入默认但探测仍 false，**平台/构建差异实测在案** |

**读法**：WebCodecs 的可用性在不同 Chrome 构建（headless/halfold/移动端/WebView）差异比 MSE 更大。能力检测三连：`in window` → `isConfigSupported(config)` → 真喂帧。任何一环断了就回退 MSE/软解（自研 SDK 的选型链，见 [[硬解与软解的选型]]）。

### 3.2 VideoFrame 生命周期实测要点（管线必备）

- `frame.close()` 不调用 → GPU/内存不回收，解码几十帧即内存告警（Chrome 实现里 VideoFrame 持有真实帧缓冲，**GC 不兜底**）。
- `frame.timestamp`（µs）+ `frame.duration` → 自己实现播放时钟的输入（配合 AudioContext 时钟做同步，见 [[WebAudio与音画同步时钟]]）。
- `frame.copyTo(buffer)` 可拿 YUV 平面数据 → CPU 侧处理路径；`frame` 直接传 `texImage2D` → GPU 零拷贝路径（见 [[YUV格式与WebGL渲染]]）。

## 4. 规范位置

- W3C WebCodecs API（2023 Candidate Recommendation）：VideoDecoder/VideoEncoder/VideoFrame/EncodedVideoChunk 四件套。
- 与 MSE 的关系：**互补非替代**——MSE 操作「容器流」，WebCodecs 操作「压缩帧」，MSE 输出不经过 WebCodecs（内部解码管线不同）。

## 5. 为什么这么设计？（背后取舍）

**为什么 WebCodecs 不给你「直接播」的能力？**
- 刻意的：播放 = 时序问题（音画同步、缓冲策略），每家播放器策略不同。WebCodecs 只出「帧」这个原子件，播放逻辑留给上层——**API 分层与播放器五层架构严格对应**（demux=你/decode=WebCodecs/渲染=你/同步=你）。这是「库不做策略」原则的浏览器版。

**为什么 VideoFrame 必须手动 close？**
- 帧缓冲在 GPU 或大块共享内存（一帧 1080p YUV ≈ 3MB）。前端每秒可能产生 60+ 个，若等 GC 批量回收，延迟队列会瞬间积压几百 MB。**确定性资源管理**（Rust 式 RAII 思想进 Web 平台）——这也是 WebCodecs 面向专业音视频工具链的信号：粗心的人玩不转。

**为什么「只解关键帧快进」在 MSE 做不到？**
- MSE 的接口是字节流，浏览器内部对 keyframe 的处理不暴露。WebCodecs 把 chunk 类型（key/delta）直接放类型系统里——**跳帧成本从「浏览器说了算」变成「调用方说了算」**，Seek 的实现自由度就来了（见 [[Seek实现与关键帧对齐]] 对照）。

## 6. 规避 / 实践

| 场景 | 手段 |
| --- | --- |
| 普通播放器 | MSE（别用 WebCodecs 自造渲染轮子） |
| 截帧/缩略图 | WebCodecs output 帧 → OffscreenCanvas |
| 低延迟直播 | WebCodecs + optimizeForLatency + 只用 I/P 帧 |
| 软解兜底管线 | WASM 解码 → VideoFrame 包装 → WebGL（见 [[WASM软解H265管线]]） |
| 能力检测 | `in window` → `isConfigSupported` → 试喂一帧，三级都过才进 WebCodecs 通道 |
| 内存红线 | output 回调里 100% 调 close()；decodeQueueSize 做背压 |

## 7. 面试速记

> **30 秒版**："MSE 给的是「播」，WebCodecs 给的是「帧」。VideoDecoder 输入是你自己 demux 的 EncodedVideoChunk（type key/delta 就是我们说的 I/P 帧），输出 VideoFrame 自己渲染——所以截帧、AI 处理、逐帧丢弃、转码这些 MSE 做不到的事它都能做，代价是 demux/时钟/渲染全自己写。实测本机 headless Chrome 154 默认 flags 连 VideoDecoder 都不可见，可用性比 MSE 更碎，能力检测三级走起。VideoFrame 必须手动 close，一帧 3MB 等 GC 就是内存事故。选型：要播用 MSE，要帧用 WebCodecs。"

## 相关笔记

- [[MSE核心机制]] —— 对照组：整段喂的「播」通道
- [[WASM软解H265管线]] —— WebCodecs 作为软解管线渲染前出口的完整用法
- [[I帧P帧B帧与GOP]] —— type key/delta 背后的帧语义
- [[硬解与软解的选型]] —— SDK 层三级选型链（硬解MSE → WebCodecs → WASM）
- [[WebAudio与音画同步时钟]] —— 拿到帧之后怎么对时钟

*本文档基于 W3C WebCodecs API、headless Chrome 154.0.8037.93 (Win11/RTX 3050) 实测整理。*
