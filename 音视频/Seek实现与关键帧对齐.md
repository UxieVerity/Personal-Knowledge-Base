# Seek实现与关键帧对齐

> **结论：Seek 的最小实现是「定位 → 从关键帧重新开始喂」——**目标时间点必须对齐到 ≤ 它的最近关键帧（IDR）**，因为解码器离开 I 帧无法开始（P/B 帧全是参考）。实测：GOP=300（10s）的文件 Seek 到 t=4.5s 要从 t=0 快进解码 135 帧才出画面，GOP=30 的只需 15 帧——**「Seek 后转圈久」和「Seek 粒度粗」都是 GOP 的代价**。黑屏/花屏的直接原因：黑屏 = 只 seek 了时间戳没重喂关键帧起的数据；花屏 = 从非关键帧（或丢参数集）开始解码。**

> 可运行验证：GOP 与 Seek 的量化实测见 [[I帧P帧B帧与GOP]] §3.2/3.3（ffprobe 逐帧验证）；MSE 通道的 Seek 代码骨架见本篇 §2.2。

[[I帧P帧B帧与GOP]] · [[播放器缓冲策略]] · [[MSE核心机制]]

---

## 1. 背景：Seek 在解码层意味着什么

解码器状态机：`等待参数集 → 收到 IDR → 参考链开始 → 连续解 P/B 帧`。Seek 打断这个链条后，**唯一合法的重启点 = IDR**（或先收到 SPS/PPS 的参数集再收 IDR）。

| Seek 后现象 | 解码层原因 |
| --- | --- |
| 正常 | 对齐 IDR 且参数集完整 |
| **花屏**（马赛克） | 从 P/B 帧开始解（参考帧缺失 → 残差解码出垃圾画面） |
| **黑屏转圈久** | 在等下一个 IDR（GOP 太长） |
| 有声音没画面 | 音频轨对齐成功、视频轨还在等 IDR（音轨无关键帧概念） |

## 2. 定义/原理：两条实现路径

### 2.1 点播整文件（Range 请求，浏览器内建）

```
moov 索引里有每帧的字节偏移 + 关键帧表
seek(t) → 找 ≤t 的最近关键帧偏移 → HTTP Range: bytes=offset- 拉取 → 解码快进到精确 t
```

浏览器 `<video>` 的 seek 已内置这套（这就是整文件 MP4 好用的原因）。快进解码量 = t 与关键帧的间隔（快进解 P 帧比完整播放快，但仍要逐帧过解码器）。

### 2.2 MSE 分段流（自研播放器的 Seek）

```js
async function seek(t) {
  video.pause();
  const keyTime = findKeyframeBefore(t);   // demux 索引里查 ≤t 的关键帧
  await sb.remove(keyTime, buffered.end);  // 1. 清掉旧数据（掐关键帧边界）
  const chunks = await loadFrom(keyTime);  // 2. 从关键帧所在分片重新拉流
  for (const c of chunks) {
    await once(sb, 'updateend');
    sb.appendBuffer(c);                    // 3. 从关键帧起喂（含参数集）
  }
  video.currentTime = t;                   // 4. 时间戳设回精确位置
  video.play();
}
```

四个步骤缺一不可，生产级还要加：Seek 竞态保护（连续拖拽只认最后一次）、预取目标分片、音频轨独立对齐（音频无关键帧，按 pts 切）。

## 3. 实测

### 3.1 GOP 决定 Seek 成本（ffprobe 实测）

> 🔗 [[I帧P帧B帧与GOP]] §3.2/3.3 实测数据（libx264 同源，只改 `-g`）：

| GOP | 关键帧位置 | Seek 到 t=4.5s 的快进解码帧数 |
| --- | --- | --- |
| 30（1s） | 0s, 1s, 2s, … | **15 帧**（从 t=4s 起） |
| 120（4s） | 0s, 4s, 8s | **15 帧**（恰好 4s 是关键帧） |
| 300（10s） | 0s（唯一） | **135 帧**（从 t=0 起，覆盖 4.5s） |

**Seek 粒度 = GOP 长度**：GOP=300 的文件 Seek 到任意非零时间都要从头快进—— Seek 体验的最优解在推流端（短 GOP），播放器只能在给定流上做最优。

### 3.2 关键帧对齐查询的实测方法

```bash
# 列出关键帧时间（Seek 对齐点的来源）
ffprobe -v error -select_streams v -show_entries packet=pts_time,flags -of csv gop-30.mp4 | grep K
# packet,0.000000,K__ / packet,1.000000,K__ / ...
```

生产 demux 层等价物：fMP4 的 moof/trun 里解析 sync sample 表（或 MP4 索引的 stss box），建 `keyframeTimes[]` 有序表 → `findKeyframeBefore(t)` 二分查找。

### 3.3 黑屏/花屏的复现实验（理解成本最低的证据）

```bash
# 从非关键帧起「解码」——ffmpeg 指定无 I 帧的输入段
ffmpeg -v error -ss 4.5 -i gop-300.mp4 -frames:v 1 -f null -
# 输入端 seek 会自动对齐到关键帧（播放器语义）
# 若 demux 层错切了 4.5s 处的字节从 P 帧开始喂 MSE → 浏览器报 DECODE_ERROR 或花屏
```

**结论**：花屏不是「网络坏了」的专利，本质是**参考链断裂**——丢包、Seek 错位、参数集丢失都是同一个根因。

## 4. 为什么这么设计？（背后取舍）

**为什么解码器不支持「从任意帧开始」？**
- 压缩的全部收益来自「帧间参考」；支持任意起点 = 每帧都要能独立解码 = 等于全 I 帧 = 压缩率崩塌（实测全 I 编码体积 3~10×，见 [[I帧P帧B帧与GOP]] §5）。**随机访问能力和压缩率是编码标准的底层对立**，GOP/IDR 就是这个对立的折中产物。

**为什么 Seek 后要 remove 旧 buffer？**
- 从旧位置残留的 P/B 帧（参考链指向已不存在的旧序列）继续解 = 花屏；且旧数据占 SourceBuffer 容量触发不可控 eviction。**Seek 后的数据面必须干净重启**，如同事务回滚后重放。

**为什么音频轨不需要关键帧对齐？**
- AAC 每帧独立解码（无帧间参考，见 [[音频编码AAC与Opus]] §2），按 pts 直接切。这就是 Seek 时「声音先恢复、画面还在转圈」的原因——视频在等 IDR。

## 5. 规避 / 实践

| 场景 | 手段 |
| --- | --- |
| Seek 粒度粗 | 推流端缩短 GOP（直播 1~2s）；点播接受 2~5s GOP |
| 连续拖拽卡顿 | Seek 竞态保护：只执行最后一次 seek 的数据面操作 |
| Seek 后花屏 | 检查是否从 keyframe 起 appendBuffer + 参数集（SPS/PPS/hvcc）是否随分片重发 |
| 转圈久 | 关键帧预取（hover 进度条时预取最近关键帧分片）+ 缩短 GOP |
| 精确 Seek | 对齐关键帧起喂 → 快进解到精确 t（渲染丢弃非目标帧） |

## 6. 面试速记

> **30 秒版**："Seek 必须对齐关键帧：P/B 帧全是参考，解码器离开 I 帧没法开始。实测 GOP=30 的流 Seek 15 帧就出画面，GOP=300 要快进 135 帧——Seek 粒度就是 GOP 长度，最优解在推流端。花屏=参考链断裂（从 P 帧开始解/丢参数集），黑屏=在等 IDR。MSE 实现：remove 旧段掐关键帧边界→从关键帧分片重喂→currentTime 设精确位置，连续拖拽要竞态保护只认最后一次。音频无关键帧概念按 pts 切，所以 Seek 后声音先恢复。"

## 相关笔记

- [[I帧P帧B帧与GOP]] —— 关键帧与 GOP 的编码层机制（本篇的地基）
- [[播放器缓冲策略]] —— Seek 与水位的联动（Seek 后水位重建）
- [[MSE核心机制]] —— remove/appendBuffer 的 API 语义
- [[直播低延迟与追帧]] —— 直播「Seek 到边缘」= 追帧的特殊形式
- [[首开时间优化]] —— 首开就是「从零开始的 Seek」

*本文档基于 ffprobe 关键帧实测（FFmpeg 9.0）、W3C MSE 规范、工业播放器 Seek 实现整理。*
