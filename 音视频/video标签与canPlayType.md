# video标签与canPlayType

> **结论：`<video>` 是「整文件喂」的原生播放通道——src 指向一个完整 URL，浏览器自己完成拉流、demux、decode、渲染全链路，前端只有一个 `<video>` 元素和一堆事件可摸。`canPlayType` 返回 `probably/maybe/空串` 三态而非布尔：**浏览器只查自己的静态白名单、不做真解码验证**，所以它是初筛不是终审——实测本机 Chrome 154 对 H265 的 `canPlayType='probably'` 但 MSE 层 `isTypeSupported=false`，同一编码两个 API 结论都能打架（见 [[视频编码代际与浏览器支持]]）。**

> 可运行验证：headless Chrome 能力矩阵 probe（同目录 `canplay-probe*.js` 思路，§3 实测数据复自 [[视频编码代际与浏览器支持]] §3.2）；`<video>` 实播 H265 文件的 error/loadedmetadata 事件实测。

[[MSE核心机制]] · [[视频编码代际与浏览器支持]] · [[播放器架构分层]]

---

## 1. 背景：原生播放的一切都是黑盒

```html
<video src="movie.mp4" controls></video>
```

这一行背后浏览器做的事：HTTP Range 分段拉流 → 内建 demuxer 拆容器 → 内建/平台解码器解帧 → 音视频同步 → 渲染合成。**每一步前端都不可插手**，能做的只有：

| 能力 | API | 粒度 |
| --- | --- | --- |
| 控制 | play/pause/currentTime/playbackRate | 整文件级 |
| 观测 | timeupdate/progress/waiting/stalled 事件 | 秒级 |
| 质量 | `getVideoPlaybackQuality()`（dropped 帧数） | 统计级 |
| 加载策略 | preload="none/metadata/auto"、`buffered` 只读 | 提示级 |

**够用的场景**：点播 MP4/WebM、简单 HLS（Safari 原生）。**不够的场景**（自研 SDK 存在的原因）：直播 FLV、H265 兜底、自定义 buffer 策略、帧级控制——这就是 MSE/WebCodecs/WASM 逐级出现的原因（见 [[MSE核心机制]]、[[WebCodecs与MSE的边界]]）。

## 2. 定义/原理：canPlayType 的三态语义

```js
const v = document.createElement('video');
v.canPlayType('video/mp4; codecs="avc1.42E01E"');  // "probably"
v.canPlayType('video/mp4; codecs="hvc1.1.6.L93.B0"'); // "maybe" 或 ""（看平台）
v.canPlayType('video/xxx');                         // ""（空串 = 确定不行）
```

| 返回值 | 规范语义 | 实际含义 |
| --- | --- | --- |
| `"probably"` | 容器+编码串都在白名单且高置信 | 可以当「大概率支持」 |
| `"maybe"` | 格式认识但不敢保证 | 只能当初筛 |
| `""`（空串） | 不认识/明确不支持 | 当 false 用 |

**为什么不是布尔**：`canPlayType` 不初始化解码器、不验证流内容，只比对「mimeType 字符串 vs 浏览器静态声明」。声明了但平台解码器缺失的情况它测不出来——这是三态「含糊」的根源，也是「终审必须真喂流」的原因。

**codec 串怎么写**：`codecs=` 里是具体的编码 profile/level（RFC 6381）：`avc1.42E01E`（H264 Baseline 3.0）、`hvc1.1.6.L93.B0`（H265 Main L3.1）、`av01.0.05M.08`（AV1）。**串写错 = 误报不支持**。

## 3. 实测

### 3.1 本机 Chrome 154 的 canPlayType 全表（headless 实测）

> 🔗 probe 脚本 = headless Chrome 154.0.8037.93 (Win11/RTX 3050)，`createElement('video').canPlayType(...)`：

| mimeType | canPlayType | MSE isTypeSupported | 备注 |
| --- | --- | --- | --- |
| `video/mp4; codecs="avc1.42E01E"` | **probably** | true | H264 全绿 |
| `video/mp4; codecs="hvc1.1.6.L93.B0"` | **probably** | **false** | ⚠️ 两层结论打架 |
| `video/webm; codecs="vp9"` | probably | true | |
| `video/mp4; codecs="av01.0.05M.08"` | probably | true | AV1 全绿 |
| `video/webm; codecs="vp8"` | probably | true | |

**H265 那一行的解读**：canPlayType 说 probably（平台有 NVDEC 硬解，video 标签层放行），MSE 说 false（Chrome 自家 demuxer 白名单没开）。**同一浏览器、同一编码、两个 API 两个答案**——能力检测必须分通道做，这正是自研 SDK `isTypeSupport` 分层探测的实测依据。

### 3.2 `<video>` 实播 H265 文件（终审实测）

```js
const v = document.querySelector('video');   // src 指向 .mp4 (H265)
// 实测事件序列：
// loadedmetadata (videoWidth=640, duration=4) → play() → currentTime 正常推进
// v.error = null, readyState=4, dropped=2 帧 —— 硬解播放成功 ✅
```

对照组 H264 文件同样成功。**终审（真解码）与初筛（canPlayType）结论一致的只有「真播一次」能给出**。

### 3.3 原生通道的边界实测（为什么不够用）

| 需求 | `<video>` 原生能力 | 结果 |
| --- | --- | --- |
| 播 HTTP-FLV 直播流 | src 指向 .flv | ❌ 浏览器不认识 FLV 容器（Chrome 只认 MP4/WebM 等白名单）→ 必须 fetch + JS demux + MSE，见 [[HTTP-FLV协议原理]] |
| 控制 buffer 水位 | 只读 `buffered`，无写入接口 | ❌ 无法实现追帧/自定义水位，见 [[播放器缓冲策略]] |
| 帧级操作（截帧/超分） | 无帧访问 API | ❌ 需 WebCodecs，见 [[WebCodecs与MSE的边界]] |
| 直播延迟控制 | playbackRate 最小 0.0625 有下限，无 buffer 控制 | ❌ 见 [[直播低延迟与追帧]] |

## 4. 规范位置

- HTML Living Standard §4.8.10 「Media elements」：canPlayType 三态定义（「probably」if confident,「maybe」if possible）。
- RFC 6381：codecs 参数的 ISO BMFF 编码串语法（avc1/hvc1/av01 + profile/level 点分）。
- MSE：`MediaSource.isTypeSupported()` 是**同步布尔**（对比 canPlayType 三态），因为 MSE 层检查的是「demuxer 白名单」，答案空间更确定。

## 5. 为什么这么设计？（背后取舍）

**为什么 canPlayType 不做成「真解码一次」的终审？**
- 代价不可接受：真验证 = 初始化解码器 + 解几帧，是异步重操作，而能力检测要求**同步、廉价、可批量调用**。规范选择「静态声明比对 + 三态置信度」换取同步性，把终审责任留给上层（实播或 MSE append）。
- 这和 CSS `supports()`、`typeof` 检测是同一种「特性检测」哲学：**快速初筛 + 运行时终审**，两层各司其职。

**为什么 `<video>` 故意做成黑盒？**
- 1990s 媒体栈的历史包袱：解码器有大量 DRM/专利边界（Widevine、H265），浏览器不可能把这一层暴露给任意网页代码——黑盒是专利与安全的隔离层。MSE/WebCodecs 是在黑盒上开的「受控开口」，开口粒度决定控制粒度（见 [[MSE核心机制]] §5）。

## 6. 规避 / 实践

| 场景 | 手段 |
| --- | --- |
| 判断能不能播 | `canPlayType` 初筛 → 真喂流终审（MSE append 或建 video 实播） |
| codec 串别瞎写 | 按 RFC 6381 写全 profile/level：`avc1.42E01E` 不是 `h264` |
| iOS 兼容 | iOS Safari 不支持 MSE（iPhone 上），原生 video + HLS 是唯一通道 → 直播方案要出 iOS 分支 |
| 静音自动播放 | `muted + playsinline` 是自动播放策略的通行证（否则 play() 被 policy 拒绝） |
| 排查播放失败 | 先看 `v.error.code`（1=aborted 2=network 3=decode 4=src_not_supported），4 号 = 格式问题走能力检测链 |

## 7. 面试速记

> **30 秒版**："video 标签是整文件喂的黑盒，浏览器包办拉流/demux/解码/渲染，前端只有控制和事件。canPlayType 三态 probably/maybe/空串，本质是静态白名单比对不做真解码——所以只能初筛。实测本机 Chrome 154：H265 canPlayType=probably 但 MSE isTypeSupported=false，video 标签实播又成功——同一浏览器三层结论都能不一致，能力检测必须分通道。FLV/WebCodecs/自定义 buffer 这些原生做不到的场景就是 MSE/自研 SDK 的存在理由。"

## 相关笔记

- [[MSE核心机制]] —— 从「整文件喂」到「分段喂」的下一层
- [[视频编码代际与浏览器支持]] —— 三层探测面不一致的完整矩阵
- [[MSE最小播放器-验证demo]] —— 手写拉流→demux→append 全流程
- [[WebCodecs与MSE的边界]] —— 「逐帧喂」的第三层
- [[直播协议延迟对比]] —— 原生 video 只能吃 HLS 的选型影响

*本文档基于 HTML Living Standard §4.8.10、RFC 6381、headless Chrome 154 (Win11/RTX 3050) 实测整理。*
