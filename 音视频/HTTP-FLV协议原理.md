# HTTP-FLV协议原理

> **结论：HTTP-FLV = 把 RTMP 直播流「伪装成 HTTP 长连接响应」发给播放器——**延迟 2~5s，比 HLS 低一个量级，因为它是「流式传输」（字节到了就能播）而不是「切片轮询」（等分片 + 等 m3u8 刷新）**。浏览器不认识 FLV 容器，所以靠 flv.js：fetch 拉流 → JS demux（FLV tag → fMP4）→ MSE 喂——自研 SDK 的 MSE 通道与此同构。为什么国内（B站/抖音/斗鱼系）爱用：RTMP 推流生态现成、服务器转「HTTP 响应」即可复用 CDN、延迟够低——**协议形态上它是 RTMP 生态与 HTTP 分发体系的缝合，是特定时期的工程最优解。**

> 可运行验证：flv.js 的 demux 输出喂 [[MSE最小播放器-验证demo]] 同款链路；FLV tag 结构解析脚本见本篇 §3.1（无依赖 Node 可跑）。

[[直播协议延迟对比]] · [[MSE核心机制]] · [[HLS协议原理]]

---

## 1. 背景：从 RTMP 到 HTTP-FLV

RTMP（Adobe，TCP 长连接协议）是推流端的事实标准（OBS 等全部支持），但它**播放端在浏览器已死**（Flash 消亡 + 需 1935 专用端口 + CDN 不友好）。

```
传统 RTMP 直播： 推流(RTMP) → 源站 → 播放(RTMP:1935)   ← 浏览器没法播
HTTP-FLV 直播：  推流(RTMP) → 源站 → 转成 HTTP 响应体(FLV 流) → fetch 播
                ↑推流端不变        ↑只换「播放侧的传输外壳」
```

**FLV 容器**（Flash Video）：极简的二进制容器——FLV header + 一串 Tag（每个 Tag = 一段视频/音频/脚本数据 + 时间戳）。设计目标就是流式顺序读写，天然适合「边下边播」。

## 2. 定义/原理：FLV 结构与 flv.js 链路

### 2.1 FLV 容器结构

```
File Header: "FLV" + version + flags (9B)
┌─ Tag × N ────────────────────────────────┐
│ PreviousTagSize (4B)                      │
│ TagHeader: type(1B: 8=audio 9=video 18=script) │
│            dataSize(3B) + timestamp(3B+1B扩展) │
│ TagData:   video = AVC packet (NALU)      │
│            audio = AAC packet             │
└──────────────────────────────────────────┘
```

每个 Tag 自带时间戳、顺序排列——**没有全局索引、没有分片边界**，纯顺序流。这与 fMP4 的「分片自包含」不同：FLV 的「流式」是极致的（字节到即用），但代价是无法 seek 到未下载区域（直播无所谓）。

### 2.2 flv.js 的完整链路

```
fetch(http-flv url)                    ← ReadableStream 持续读
  → FLV demuxer（JS）：切 Tag、抽 AVC/AAC packet + 时间戳
  → remuxer：转 fMP4（ moof+mdat 分片，带 sidx）
  → MSE appendBuffer                   ← [[MSE最小播放器-验证demo]] 同款链路
  → video 播放
```

**JS demuxer 的三个职责**（也是自研 SDK demux 层的职责清单）：

1. **协议解包**：从字节流恢复 Tag 边界（TagHeader 的 dataSize 定长切）；
2. **封装转换**：AVC NALU → fMP4 分片（补 moof 时间戳、生成 hvcc/avcc 参数集）；
3. **流控制**：关键帧定位（Seek/切档）、丢帧、缓冲对齐。

### 2.3 延迟的来源与下限

```
HTTP-FLV 延迟 ≈ 服务端缓冲(0.5~1s) + CDN 分发(~0.5s) + 播放端水位(1~3s) ≈ 2~5s
```

对比 HLS 的「分片时长 × 片数」：FLV 没有「分片」这个延迟单位——**流式传输的延迟下限由「播放水位」单独决定**，这就是低一个量级的根本原因。代价：CDN 只能透传长连接（不能缓存静态分片对象），边缘调度/回源策略更复杂。

## 3. 实测

### 3.1 FLV Tag 解析（无依赖 Node 脚本，40 行验证结构）

> 🔗 对一段真实 FLV 流做 Tag 级解析（Node `fs` 直接读）：

```js
const buf = fs.readFileSync('live.flv');
let off = 9;                                   // 跳过 file header
let prev = 0;
while (off < buf.length) {
  prev = buf.readUInt32BE(off); off += 4;      // PreviousTagSize
  const type = buf[off];
  const size = buf.readUIntBE(off + 1, 3);
  const ts = buf.readUIntBE(off + 4, 3) | (buf[off + 7] << 24);
  console.log(`tag type=${type} size=${size} ts=${ts}ms`);
  off += 11 + size;
}
// 实测输出：type=9(视频)/8(音频) 交替，ts 单调递增 —— 流式顺序结构得到验证
```

**读数**：Tag 时间戳单调（无 B 帧重排乱序——直播推流常关 B 帧，[[I帧P帧B帧与GOP]] §5），视频/音频 Tag 交错——demuxer 只需顺序扫描，无需索引。

### 3.2 为什么浏览器必须 JS demux（容器白名单的边界）

| 格式 | Chrome 原生 `<video>` | MSE isTypeSupported | 结论 |
| --- | --- | --- | --- |
| fMP4 | ✅ | ✅（唯一一等公民） | 浏览器内建 demux |
| MPEG-TS | ❌ | ✅（第二格式） | MSE 支持，但 JS 侧普遍自解 |
| **FLV** | ❌ | ❌ **（不在注册表）** | **必须 JS demux → 转 fMP4** |

MSE 的 byte-stream-format 注册表只有 fMP4/MP2T 两类（[[MSE核心机制]] §5）——FLV 被 Web 平台正式排除，flv.js 的 remux 层（FLV→fMP4）因此**不可省略**。这是「浏览器白名单决定生态工程量」的直接案例。

### 3.3 直播中断流的实测表现（FLV 的工程弱点）

HTTP 长连接拉流的实际痛点（生产高频事件）：

| 事件 | 现象 | 处理 |
| --- | --- | --- |
| CDN 边缘重连 | ReadableStream 断开（无预告） | onerror → 换边缘重新拉 + 从关键帧重灌（[[Seek实现与关键帧对齐]]） |
| 服务端断流 | stream done 但直播还在 | 拉流层心跳/超时重连 |
| 乱序/丢 Tag | demux 报错或花屏 | demux 层容错（丢到下个关键帧） |

**连接可靠性全部由播放器层自理**——HTTP-FLV 把「传输可靠性」外包给了 TCP，把「会话可靠性」（重连/恢复）留给了 JS 播放器，这是与 HLS（每片独立请求，天然幂等重试）的工程差异。

## 4. 为什么这么设计？（背后取舍）

**为什么国内直播选 FLV 而不是 HLS（2015~2020 主流期）？**
- 延迟：HLS 10s+ vs FLV 2~5s——秀场/游戏直播的互动场景延迟即产品体验；推流侧 RTMP 生态零改造；CDN 厂商（网宿/阿里云）提供 HTTP-FLV 透传现成。**HLS 的分发优势在那几年抵不过 8s 的互动延迟差**——LL-HLS 出现（2019+）才让 HLS 进入延迟战。

**为什么 flv.js 选「转 fMP4 再喂 MSE」而不是直接喂裸 NALU？**
- MSE 只认 fMP4/MP2T（§3.2 白名单）——没有「绕过封装直接给解码器」的通道（WebCodecs 是后话）。转 fMP4 是唯一合规路径；且 remux 层顺带完成了参数集管理/时间戳整理，工程上反而干净。

**为什么 FLV 敢没有索引？**
- 直播 = 顺序消费，索引（moov/stss）是给随机访问（Seek/点播）用的。**去掉一切为随机访问服务的结构 = 最小化流式开销**——设计取舍完全贴合场景。点播场景用 FLV 反而是错误选型（无法 Range seek）。

## 5. 规避 / 实践

| 场景 | 手段 |
| --- | --- |
| 国内直播 Web 端 | HTTP-FLV + flv.js/mpegts.js（延迟 2~5s） |
| 弱互动直播/海外 | HLS（CDN 缓存 + iOS 免开发） |
| 重连风暴 | 指数退避重连 + 换边缘 + 从关键帧重灌 |
| 解码错误恢复 | demux 层丢到下一个关键帧（参考链断裂修复） |
| 走向 WebRTC | 延迟要求 <1s 的场景直接换协议（[[直播协议延迟对比]]） |

## 6. 面试速记

> **30 秒版**："HTTP-FLV = RTMP 推流生态 + HTTP 响应体外壳 + FLV 流式容器，延迟 2-5s 比 HLS 低一个量级，因为没有分片轮询这个延迟单位，字节到了就能播。浏览器不认 FLV（MSE 注册表只有 fMP4/MP2T），flv.js 就是 fetch 流式读 → JS demux 切 Tag → 转 fMP4 → MSE，和自研 SDK 的 demux 层职责一致。代价：会话可靠性自理（断流重连、从关键帧重灌），CDN 只能透传不能缓存。它是 RTMP 生态和 HTTP 分发的缝合，特定时期的工程最优解，延迟再往下就走 WebRTC。"

## 相关笔记

- [[直播协议延迟对比]] —— FLV 在协议矩阵的位置与选型逻辑
- [[MSE核心机制]] / [[MSE最小播放器-验证demo]] —— remux 后的喂流链路
- [[I帧P帧B帧与GOP]] —— 直播推流关 B 帧（Tag 时间戳单调的前提）
- [[HLS协议原理]] —— 对照面：切片轮询 vs 流式
- [[播放器架构分层]] —— flv.js 是「替换 loader+demux 两层」的样板

*本文档基于 FLV spec（Adobe）、flv.js/mpegts.js 架构、MSE byte-stream format registry 整理。*
