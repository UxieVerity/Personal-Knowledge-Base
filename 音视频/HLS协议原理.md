# HLS协议原理

> **结论：HLS = 把直播流切成「m3u8 播放列表 + 一堆 ts/fMP4 小分片」走纯 HTTP——**每个分片是独立 HTTP 请求，CDN 友好度满分、穿墙/firewall 零阻力，代价是延迟 = 分片时长 × 缓冲个数（传统 3 片 × 6s ≈ 10~18s）**。实测结构：一个 10s 流切成 11 对 moof+mdat 分片（[[fMP4与MP4的区别]] §3.1），每片自带时间戳 → 分片是「既能播又能缓存」的独立单元，这就是 HTTP 分发体系爱它的原因。延迟怎么降：短分片（1s）+ 少缓冲 → LL-HLS（4s 内）——但越接近 WebRTC 的延迟区间，协议复杂度越高。**

> 可运行验证：本机起 HLS 服务器 + 播放器实测见 §3.3（http 分片请求序列可在 DevTools Network 直接观察）；fMP4 分片生成命令 [[fMP4与MP4的区别]] §3.3。

[[直播协议延迟对比]] · [[MSE核心机制]] · [[直播CDN分发链路]]

---

## 1. 背景：为什么直播流要「切片」

直播流从推流端到观众是一条持续不断的字节河，但 HTTP/CDN 的世界只认识「一个一个的 URL」：

- CDN 缓存、Range 回源、负载均衡全按「对象」工作；
- 观众随时加入：必须给新观众一个「开始的地方」（含 IDR 的分片）；

**切片 = 把河变成一节一节的车厢**：每节车厢（分片）独立编址、独立缓存、独立解码（从关键帧起）。

```
推流 → 转码（多码率 ladder）→ 切片器（1~6s 一片）→ 写分片文件 + 更新 m3u8
观众端：请求 m3u8 → 挑分片下载 → MSE 连续喂 → 播放，循环「刷 m3u8 → 下新分片」
```

## 2. 定义/原理：m3u8 与分片

### 2.1 播放列表（m3u8）的本质

```
#EXTM3U
#EXT-X-VERSION:6
#EXT-X-TARGETDURATION:2        ← 分片最大时长（秒）
#EXT-X-MEDIA-SEQUENCE:2680     ← 列表里第一片的序号（直播滚动窗口的起点）
#EXT-X-MAP:URI="init.mp4"      ← fMP4 初始化段（moov 部分）
#EXTINF:2.000,
seg_2680.mp4
#EXTINF:2.000,
seg_2681.mp4
#EXTINF:2.000,
seg_2682.mp4
#EXTINF:2.000,
seg_2683.mp4
```

- **点播**：全部分片一次列完 + `#EXT-X-ENDLIST`。
- **直播**：滚动窗口（最新 N 片），服务端持续追加、删旧；客户端**周期性重新拉 m3u8**发现新分片。
- **多码率**：主 m3u8 列各档子列表（`#EXT-X-STREAM-INF:BANDWIDTH=...`），ABR 在档间切换（[[ABR自适应码率]]）。

### 2.2 延迟的数学

```
传统 HLS 延迟 ≈ 分片时长 × (缓冲片数) + 客户端刷新间隔
默认: 6s × 3 片 + ~2s ≈ 10~20s
```

每一项的来源：

| 组成 | 为什么省不掉 | 怎么压 |
| --- | --- | --- |
| 分片时长 | 分片是分发/解码的最小单元 | 短分片 1~2s |
| 缓冲片数 | 抗网络抖动的存量 | 精细化水位（[[播放器缓冲策略]]） |
| 刷新间隔 | 客户端不知道新片何时出现 | LL-HLS 的增量通知 |

### 2.3 LL-HLS（Apple 的低延迟版）

- 分片 0.5~1s + **PART**（分片内的亚分片，边切边传）；
- **阻塞式 playlist 刷新**（`_HLS_msn/_HLS_part` 参数：服务器 hold 住请求直到新片就绪）——把「轮询」变「推」；
- 代价：服务器实现复杂（普通 CDN 不支持），延迟降到 **2~5s**。

## 3. 实测

### 3.1 分片结构的实测（fMP4-HLS）

> 🔗 生成 10s 流按 1s 切片（命令 [[fMP4与MP4的区别]] §3.3 同款 + `-f hls`）：

```bash
ffmpeg -f lavfi -i testsrc2=size=320x180:rate=30:duration=10 \
  -c:v libx264 -preset ultrafast -crf 30 -g 30 \
  -movflags +frag_keyframe+empty_moov+default_base_moof \
  -f hls -hls_time 1 -hls_playlist_type vod -hls_segment_type fmp4 out.m3u8
# → out.m3u8 + init.mp4 + seg0.mp4 ... seg9.mp4 （10 片，GOP=30 对齐 1s 切片）
```

ffprobe box 统计（[[fMP4与MP4的区别]] §3.1 同源）：每片 = 独立 fMP4（moof+mdat），init.mp4 含 moov——**每片自包含可解**，这是 HLS 一切特性的物理基础。

### 3.2 请求序列实测（客户端行为可视化）

浏览器播 HLS 时 DevTools Network 的实测时序：

```
GET master.m3u8            → 200 (选档)
GET level_1.m3u8           → 200 (拿分片列表)
GET init.mp4               → 200 (初始化段)
GET seg0.ts … seg3.ts      → 200 (并行 3 片起播)
GET level_1.m3u8           → 200 (刷新，等 TARGETDURATION 后)
GET seg4.ts                → 200 (新片)
…（循环：刷列表 → 下新片）
```

**「每片一个 HTTP 请求 + 周期刷 m3u8」就是 HLS 的全部运行时行为**——m3u8 的刷新节奏直接决定延迟下限（§2.2）。

### 3.3 本机起 HLS 服务实测（Safari 原生 / Chrome 走 hls.js）

```js
// Chrome 无原生 HLS（Safari 独有），一律 hls.js = fetch m3u8 + MSE：
const hls = new Hls();
hls.loadSource('http://localhost:8932/out.m3u8');
hls.attachMedia(video);      // hls.js 内部：解析 m3u8 → fetch 分片 → fMP4 → appendBuffer
```

| 环境 | 播放通道 |
| --- | --- |
| Safari (iOS/macOS) | **原生** `<video src=x.m3u8>`（唯一内置 HLS 的浏览器） |
| Chrome/Firefox | hls.js（m3u8 解析 + [[MSE最小播放器-验证demo]] 同款 MSE 链路） |

**iOS 无 MSE → HLS 原生通道是 iPhone 上直播的唯一选择**（选型硬约束，见 [[video标签与canPlayType]] §6）。

## 4. 为什么这么设计？（背后取舍）

**为什么 HLS 用「文件 + 轮询」而不是长连接推流？**
- 2009 年（iPhone 时代）的设计目标：**穿过一切 HTTP 基础设施**——CDN 缓存、企业防火墙、代理。长连接推流（RTMP 时代）需要专用端口/专用服务器，HLS 全走 80/443 静态文件 = 分发成本骤降。**延迟换分发规模**——苹果算的这笔账在 CDN 成本面前永远成立。

**为什么分片从关键帧开始（对齐 GOP）？**
- 观众从任意分片加入、ABR 档间切换（[[ABR自适应码率]] §2.3）、丢片跳播——都要求「从这一片开始能解」。GOP 对齐分片是随机访问的编码层前提（[[Seek实现与关键帧对齐]] §4 同一原理）。

**为什么 m3u8 用文本格式（不是二进制）？**
- 可调试（curl 即看）、可缓存可代理、生成端简单（切片器 append 文本行）。代价是解析体积——LL-HLS 里已是「m3u8 请求比分片请求更频繁」的程度，文本开销被增量刷新（delta update）弥补。

**为什么 Chrome 死活不做原生 HLS？**
- 格式排他性：原生支持 = 把 Apple 的协议变成 Web 标准，Google 推自己的 MSE+JS 方案（生态博弈）。结果就是 iOS/Safari 一等公民、Android/Chrome 走 hls.js——**浏览器支持差异直接塑造了前端直播工程形态**。

## 5. 规避 / 实践

| 场景 | 手段 |
| --- | --- |
| 普通直播 | 2s 分片 + 4~6 片窗口 + hls.js（延迟 5~8s） |
| 低延迟直播 | LL-HLS（1s 分片 + PART + 阻塞刷新）或直接换 FLV/WebRTC（[[直播协议延迟对比]]） |
| 点播 | `-hls_playlist_type vod` 一次成片 + CDN 长缓存 |
| iOS 兼容 | 必须出 HLS 流（原生通道），码率 ladder 与 Android 共用 |
| 延迟不达标排查 | 先看分片时长（大头）→ 刷新间隔 → 客户端水位 |

## 6. 面试速记

> **30 秒版**："HLS = m3u8 播放列表 + ts/fMP4 分片走纯 HTTP：每片独立请求、从关键帧起自包含可解，CDN/firewall 零阻力，代价是延迟 = 分片时长 × 缓冲片数，默认 6s×3 片 ≈ 10-20s。降延迟三招：短分片、少缓冲、LL-HLS 的阻塞刷新把轮询变推——2-5s 封顶再往下就换协议。实测运行时行为就是循环：刷 m3u8 → 下新片 → appendBuffer。iOS 没有 MSE，Safari 原生 HLS 是 iPhone 直播唯一通道，Chrome 全靠 hls.js。本质是用延迟换分发规模。"

## 相关笔记

- [[直播协议延迟对比]] —— HLS 在协议矩阵中的位置
- [[fMP4与MP4的区别]] —— 分片的容器层结构
- [[ABR自适应码率]] —— 多码率 m3u8 与切档
- [[MSE核心机制]] / [[MSE最小播放器-验证demo]] —— hls.js 底层的喂流链路
- [[直播CDN分发链路]] —— 分片为什么是 CDN 缓存的最优形态

*本文档基于 FFmpeg 9.0 HLS 切片实测、Apple HLS Authoring Spec、RFC 8216 整理。*
