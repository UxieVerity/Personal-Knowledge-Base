# MSE最小播放器-验证demo

> **结论：不用任何播放器库，70 行 JS 就是「fetch 拉流 → appendBuffer → 播放」的完整 MSE 播放器——**本目录 `MSE最小播放器-验证demo.html` + `MSE最小播放器-验证脚本.js` 是可运行证据**。headless Chrome 154 实测三场景全绿：整文件单段喂（append 3.9ms，buffered=[0,10.00]，1.2s 后画面在走）、视频+音频双轨（buffered=[0,10.02]）、三段分喂（与单段结果一致）。「分段喂」和「整文件播」没有本质区别，MSE 只要求每段是自包含的 fMP4 分片。**

> 可运行验证：
>
> - Demo 页：`node MSE最小播放器-验证脚本.js --serve` → 浏览器开 `http://localhost:8932/` → 点「运行」（三场景可选手动切换）
> - 无头实测：`node MSE最小播放器-验证脚本.js`（自动生成媒体 → 起服务器 → headless Chrome 跑三场景 → 打印 JSON，结果落盘 `measure-result.json`）
> - 前置：`--gen` 生成 media/（ffmpeg 生成 320×180 10s fMP4，`-movflags +frag_keyframe+empty_moov+default_base_moof`）
>
> 注意：脚本里 puppeteer-core 从 `%LOCALAPPDATA%/Temp/pptr-av` 解析（知识库目录不装 node_modules），换机器改 `PPTR_DIR` 环境变量。

[[MSE核心机制]] · [[fMP4与MP4的区别]] · [[video标签与canPlayType]]

---

## 1. 播放器最小代码骨架（demo 的核心 70 行）

```js
const ms = new MediaSource();
video.src = URL.createObjectURL(ms);
await once(ms, 'sourceopen');

const sb = ms.addSourceBuffer('video/mp4; codecs="avc1.42E01E, mp4a.40.2"');

const total = await (await fetch('/media/h264-video.mp4')).arrayBuffer();

// 分段喂（掐在任意 fMP4 分片边界；demo 按 N 等分演示）
for (let i = 0; i < chunks; i++) {
  await new Promise(r => sb.addEventListener('updateend', r, { once: true }));
  sb.appendBuffer(total.slice(i * chunkSize, (i + 1) * chunkSize));
}
await video.play();
```

对比 flv.js 的差异只在第 3 步前面多了一层：**FLV 是浏览器不认识的容器 → JS demuxer 把 FLV tag 转译成 fMP4 → 再走同一条 appendBuffer 链**。所有 MSE 播放器（flv.js/hls.js/mpegts.js/自研 SDK 的 MSE 通道）骨架都是这 70 行。

## 2. demo 界面与观测点

| 控件/面板 | 作用 |
| --- | --- |
| 源选择（mp4 / mp4full / chunked） | 单段 vs 双轨 vs 分段喂三场景 |
| 阶段条 | 能力检测 → 建 MS → 建 SB → 拉流 → appendBuffer → 播放（和笔记 [[MSE核心机制]] §2 一一对应） |
| buffered 实时读数 | `SourceBuffer.buffered` 的 TimeRanges 格式化 |
| dropped 帧数 | `getVideoPlaybackQuality().droppedVideoFrames`（性能型卡顿指标） |
| #log | 每步时戳日志（append 前后的 buffered 变化可见） |

## 3. 实测数据（headless Chrome 154，Node 服务器 + puppeteer-core）

> 🔗 代码见 [[MSE最小播放器-验证脚本.js]]（`measure()` 函数轮询 `window.__mseResult`）。环境：Chrome 154.0.8037.93 headless，本地 http 服务器（**file:// 协议无法 fetch 本地媒体，服务器是前置条件**），机器不同数值有差异，结论看流程与量级。

| 场景 | 字节数 | append 总耗时 | buffered | currentTime>1s 时刻的读数 |
| --- | --- | --- | --- | --- |
| 整文件单段（视频轨） | 587,172 B | 3.9 ms | `[0.00, 10.00]` | t=1.17s，dropped=4 |
| 视频+音频双轨 | 651,472 B | 2.5 ms | `[0.00, 10.02]` | t=1.20s，dropped=0 |
| 三段分喂 | 587,172 B | 2.6 ms | `[0.00, 10.00]` | t=1.07s，dropped=0 |

三条结论：

1. **appendBuffer 是毫秒级操作**（demux + 入解码队列，不解码）——「喂一段数据」本身从来不是卡顿来源，卡顿来源是拉流速度和解码性能。
2. **分段喂与整段喂结果完全一致**（buffered 相同、播放相同）——MSE 的「分段」是给网络/策略层用的（边下边播、追帧、切档），不是解码器需求。
3. **buffered 覆盖范围在 append 后立即可查**——这是实现「卡顿预判」（currentTime 逼近 buffered.end 就提前降档/换源）的数据基础。

## 4. 实测踩坑记录（每个都真实撞过）

| 坑 | 现场 | 解法 |
| --- | --- | --- |
| mimeType 漏写音频 codec | `CHUNK_DEMUXER_ERROR_APPEND_FAILED: audio object type 0x40 does not match what is specified in the mimetype` | codecs 写全：`"avc1.42E01E, mp4a.40.2"`（0x40 就是 esds 里的 AAC objectTypeIndication） |
| fMP4 缺 default_base_moof | `TFHD base-data-offset not allowed by MSE` | ffmpeg `-movflags +frag_keyframe+empty_moov+default_base_moof` |
| 不等 updateend 连喂 | `QuotaExceededError` / 静默丢段 | Promise 包一层 `updateend` 再喂下一段 |
| file:// 打开 demo 后 fetch 失败 | fetch 不允许跨协议读本地 | **起本地 http 服务器**（脚本内置，不依赖外部进程） |
| H265 平台差异 | `isTypeSupported('…hvc1…')` 默认 false（本机 Chrome 154 实测） | 能力检测先行，见 [[视频编码代际与浏览器支持]] §3.2 |

## 5. 为什么这么设计？（背后取舍）

**为什么 demo 服务器要把 file:// 排除掉？**
- 浏览器安全模型：file:// 页面的 fetch 是跨源/协议限制的重灾区（Chrome 默认拒绝读本地 URL）。流媒体开发的第一个环境坑：**任何 MSE 实验都必须 http(s) 环境**。这也是本 demo 把服务器内建进脚本（一键起/停）而不是让用户手动起服务的原因。

**为什么分段 demo 按「字节数等分」而不是按「分片边界」切？**
- 教学简化 vs 生产纪律：demo 的 fMP4 已整段 demux 缓存，Chrome 能容忍跨边界的喂入重排；**生产上必须掐在 moof 边界**（`moof+mdat` 对的起点），否则 demuxer 解析半截分片。flv.js/hls.js 全部按分片边界切——这是 demo 与生产唯一的纪律差异，已在代码注释里标明。

**为什么这个 demo 是自研 SDK 的「地层证据」？**
- 面试被问「你们 SDK 和 flv.js 区别」时，能够下探到「appendBuffer→updateend→buffered」这一层讲清楚的人极少。本 demo 的三场景数据（append 毫秒级 / buffered 即时可查 / 分段与整段等价）就是回答「为什么你们的缓冲策略能做到 X」的第一性依据。

## 6. 面试速记

> **30 秒版**："70 行就能写一个 MSE 播放器：createObjectURL 挂 MediaSource → sourceopen → addSourceBuffer → fetch 攒段 → appendBuffer 等 updateend 循环 → play。实测三场景：单段 append 3.9ms buffered 立即 [0,10]，双轨 mime 要写全两个 codec（漏写报 0x40 不匹配），分段喂和整段结果完全一致。flv.js 就是在这条链前面加一层 FLV→fMP4 的 JS demux。所有实验必须 http 环境，file:// 的 fetch 直接被安全模型拦。"

## 相关笔记

- [[MSE核心机制]] —— 本 demo 背后的四件套机制详解
- [[fMP4与MP4的区别]] —— 媒体文件为什么长这样（box 级实测）
- [[视频编码代际与浏览器支持]] —— H265 场景的能力检测矩阵
- [[播放器缓冲策略]] —— 在 buffered 之上做水位的策略层
- [[HTTP-FLV协议原理]] —— FLV 拉流 + 本 demo 链路的组合 = 国内直播主流方案

*本文档基于 headless Chrome 154.0.8037.93 + Node http 服务器实测、W3C MSE 规范整理。*
