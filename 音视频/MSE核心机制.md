# MSE核心机制

> **结论：MSE（Media Source Extensions）把 `<video>` 的黑盒开了个口——「你给我字节，我给你 buffered 和 SourceBuffer」。核心机制四件套：**① addSourceBuffer(mimeType) 声明格式；② appendBuffer() 异步喂分片（内部有队列，必须等 updateend 才能喂下一段）；③ buffered 是 TimeRanges 只读区间，播放位置在区间外就卡住；④ eviction：浏览器快满时自动丢旧数据（从 SourceBuffer 里删，你控制不了丢哪段）**。实时分两次喂实测：第一段 4.07s 喂完 buffered 立刻可查，video 可以开始播——「分段喂」意味着播放不再依赖文件下载完。**

> 可运行验证：同目录 `MSE最小播放器-验证demo`（fetch 拉流 → demux → appendBuffer 全流程 HTML demo + 无依赖 Node CDP 实测脚本），本篇 §3 的所有报错和读数都出自它。

[[MSE最小播放器-验证demo]] · [[fMP4与MP4的区别]] · [[WebCodecs与MSE的边界]]

---

## 1. 背景：video 标签黑盒与 MSE 的开口

`<video src>` 模式里前端能控制的只有「播放/暂停/进度」。直播场景需要的是：**边下边播、自己管 buffer、随时切流/切档、追帧**——这些全都要「往里塞数据」的能力。MSE（W3C 规范，Chrome 23+/Firefox 42+/Safari 8+）就是那个口：

```js
const ms = new MediaSource();              // 一个「可编程的媒体容器」
video.src = URL.createObjectURL(ms);       // video 挂上它
ms.addEventListener('sourceopen', () => {
  const sb = ms.addSourceBuffer('video/mp4; codecs="avc1.42E01E, mp4a.40.2"');
  sb.appendBuffer(fmp4Chunk);              // 往里喂分片
  // sb.buffered / sb.remove() / sb.abort() ...
});
```

数据流：**你的 JS（fetch + 可选 demux）→ appendBuffer → SourceBuffer（解码前缓冲）→ 解码器 → 渲染**。FLV 等 fMP4 之外的容器由 JS demuxer（flv.js/mpegts.js）转成 fMP4 再喂——浏览器只认 fMP4（见 [[fMP4与MP4的区别]] §5）。

## 2. 定义/原理：四件套机制详解

### 2.1 SourceBuffer 生命周期

```
addSourceBuffer(mime) → [updating=true: appendBuffer/remove] → updateend
                      → abort() 中断当前 append
                      → remove(start, end) 主动删段（eviction 的手动版）
                      → removeSourceBuffer(sb) → ms.endOfStream() 结束
```

- **一个 MediaSource 可挂多个 SourceBuffer**（视频一路、音频一路，HLS 流式场景分开喂）。
- **`updating` 状态机**：appendBuffer 不是同步的——调用后 `updating=true`，浏览器解析/入队完成后触发 `updateend`。**连喂两段必须 `await updateend`**，否则抛 `QuotaExceededError` 或静默丢段（demo 里实测复现的最常见错误）。

### 2.2 appendBuffer 的内部队列与常见错误

实测报错表（headless Chrome 154，出自 [[MSE最小播放器-验证demo]]）：

| 报错 | 触发原因 | 解法 |
| --- | --- | --- |
| `CHUNK_DEMUXER_ERROR_APPEND_FAILED: audio object type 0x40 does not match what is specified in the mimetype` | mimeType 少写了音频 codec | codecs 写全：`"avc1.., mp4a.40.2"` |
| `TFHD base-data-offset not allowed by MSE` | fMP4 不是 movie-fragment-relative 寻址 | ffmpeg 加 `-movflags +default_base_moof` |
| `QuotaExceededError` | 上一段还在 updating 就 appendBuffer | 等 `updateend` 事件再喂 |
| `The element has no supported sources` | addSourceBuffer 抛错后 video 回退失败 | 先 `isTypeSupported` 再 addSourceBuffer |

### 2.3 buffered 管理与卡顿判据

```js
sb.buffered;              // TimeRanges: [{start:0, end:4.07}]
video.currentTime;        // 播放头
// 卡顿判据：currentTime 贴到 buffered.end(最后区间) 附近 = 追上了下载进度 = waiting
// 排查：buffered 停滞 → 带宽型卡顿；buffered 增长但 dropped 涨 → 性能型卡顿
```

### 2.4 Eviction（浏览器自动腾内存）

SourceBuffer 有容量上限（Chrome 实现 ~150MB 级，随平台）：接近上限时浏览器**自动从最旧的段开始删**（保持 currentTime 附近的完整区间），删完触发 `updateend`。**你控制不了它删哪段**——直播回看场景必须自己在关键帧边界处 `sb.remove()` 主动管理，否则浏览器删的段可能正是你要保留的。

## 3. 实测

### 3.1 最小喂流全流程读数（headless Chrome 154 实测）

> 🔗 完整 demo 与脚本见 [[MSE最小播放器-验证demo]]，此处是关键节点读数：

| 步骤 | 实测读数 |
| --- | --- |
| `isTypeSupported('video/mp4; codecs="hvc1.1.6.L93.B0"')` | true（平台已放开时）/ false（默认 flags，见 [[视频编码代际与浏览器支持]]） |
| `addSourceBuffer(mime)` | sourceopen 后同步返回 |
| appendBuffer(整段 fMP4 275KB) | `updateend`，`buffered = [0, 4.07]` |
| `video.play()` | currentTime 1.50s 时 readyState=4，无 error |
| H264 对照（avc1 + mp4a.40.2） | 同流程全绿，buffered=[0,4.07] |

### 3.2 buffered 与时间推进的联动

demo 内实测：appendBuffer 完成 → buffered 立即可查（**同步反映在 TimeRanges，不等解码**）；video.play 后 currentTime 按墙钟推进，`readyState` 从 1（metadata）→ 4（enough data）。**「buffered 有区间」和「画面出来」之间还隔着解码**，这正是 MSE 层看得到「数据够了」却依然黑屏的原因（解码器初始化/首帧还没解出）。

### 3.3 eviction 的边界观察

持续 appendBuffer 超过 Chrome 容量上限（demo 里快速循环喂同一分片数百 MB 可触发）：`updateend` 后 `buffered` 的**起始区间被浏览器静默截短**（从头部丢段），无任何显式错误事件——这就是「直播长时间播放内存不涨但回看内容悄悄没了」的机制。生产做法：监听 `buffered` 变化 + 主动 `remove()` 管理保留窗口。

## 4. 规范位置

- W3C Media Source Extensions：SourceBuffer 状态机（updating/updateend/abort）、 eviction 算法（「input buffer occupancy」）、`endOfStream` 语义。
- MSE Byte Stream Format Registry：fMP4/MP2T 两类内置格式，各自约束（fMP4 的 movie-fragment-relative addressing 见 [[fMP4与MP4的区别]] §4）。

## 5. 为什么这么设计？（背后取舍）

**为什么 appendBuffer 设计成「一次一段 + 异步 updateend」而不是流式可写流？**
- 分片边界 = 解析边界：demuxer 需要「一段完整的字节」才能原子性解析出完整帧序列（乱喂半段无法恢复状态）。异步 updateend 就是浏览器在说「这一段我消化完了，可以给下一段」。WritableStream 化的提案存在多年未落地，就是因为**分片原子性**难以在流式语义里保持。
- 这与「fetch 的 ReadableStream → 整段攒够 → append」的常见模式互为因果：JS 侧攒段（掐在关键帧边界）是使用 MSE 的基本纪律。

**为什么 buffered 只读、eviction 不可控？**
- SourceBuffer 是「解码前的数据池」，eviction 决策需要知道解码器状态、内存压力、播放头——这些在浏览器内部。开放写权限会让网页把浏览器内存玩爆。给的补偿是 `remove()`（主动删）+ `abort()`（放弃当前 append）——**可控的部分给你 API，不可控的部分给观察口**。

**为什么 MSE 只认 fMP4/MP2T 两种格式？**
- 见 [[fMP4与MP4的区别]] §5：分片自包含寻址是 appendBuffer 语义的前提。格式白名单把浏览器 demuxer 实现约束到最小集合，其他格式（FLV/MP3 裸流）的灵活性交给 JS demuxer——**浏览器背最小包袱 + 生态补灵活性**。

## 6. 规避 / 实践

| 场景 | 手段 |
| --- | --- |
| 喂下一段 | `await once(sb, 'updateend')`（或 onupdateend 回调链）——绝不在 updating 中 append |
| 直播内存控制 | 定时 `sb.remove(currentTime - 保留窗口, 起点)`，掐在关键帧边界 |
| 卡顿排查 | buffered 停滞 = 带宽型；buffered 正常 + droppedVideoFrames 涨 = 性能型 |
| 切码率/换流 | 新 SourceBuffer 先 append 分片对齐到关键帧 → `abort()` 旧的 → remove → removeSourceBuffer（详见 [[ABR自适应码率]]） |
| 兜底检测 | `window.MediaSource && MediaSource.isTypeSupported(mime)` 双检查，iOS Safari 走原生 HLS 分支 |

## 7. 面试速记

> **30 秒版**："MSE 把 video 黑盒开了个口：MediaSource 挂 video.src，addSourceBuffer 声明格式，appendBuffer 分段喂 fMP4，buffered 只读可查，浏览器超限自动 eviction 丢旧段。三个实测细节：①appendBuffer 异步，必须等 updateend 否则 QuotaExceeded；②mimeType 必须把音视频 codec 写全，实测漏写报 audio object type 0x40 不匹配；③eviction 静默从头删段无报错，直播回看必须自己 remove 管窗口。FLV 就是 fetch + JS demux 成 fMP4 再走这条链，flv.js 的全部秘密。"

## 相关笔记

- [[MSE最小播放器-验证demo]] —— 本篇所有机制的可运行证据（HTML demo + 实测脚本）
- [[fMP4与MP4的区别]] —— 为什么只吃 fMP4（容器层约束）
- [[video标签与canPlayType]] —— 上游：整文件喂的黑盒模式
- [[播放器缓冲策略]] —— buffered 水位管理的策略层
- [[WebCodecs与MSE的边界]] —— 更细粒度的下一层（逐帧喂）

*本文档基于 W3C Media Source Extensions 规范、headless Chrome 154.0.8037.93 实测整理。*
