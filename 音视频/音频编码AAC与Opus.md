# 音频编码AAC与Opus

> **结论：AAC 是 MP4/FLV/HLS 生态的「标配兼容编码」，Opus 是低延迟实时场景（WebRTC）的「效率之王」。同码率下 Opus 高频保真更好、延迟可低至 2.5ms、帧长 20ms——实测本机 64k 编码 8kHz 以上能量保有量 Opus -40.8dB vs AAC -41.4dB vs MP3 -41.5dB；但 Opus 装不进 MP4（生态壁垒），所以点播/直播分发给 AAC，实时通信给 Opus，这是场景选型不是技术优劣。**

> 可运行验证：ffmpeg 四编码同码率对比（§3 实测，命令即脚本）；帧长实测用 `ffprobe -show_entries frame=duration`。

[[编码与封装的区别]] · [[WebRTC适用边界]] · [[WebAudio与音画同步时钟]]

---

## 1. 背景：音频编码解决什么

音频原始码率（CD 音质）：44100 Hz × 16 bit × 2 声道 ≈ **1.41 Mbps**。编码压缩到 64~256 kbps（压缩比 5~20×），核心手段：心理声学模型——把人耳听不见/被掩蔽的频率成分扔掉。

| 标准 | 年份 | 专利 | 典型码率 | 主战场 |
| --- | --- | --- | --- | --- |
| MP3 | 1993 | 已过期 | 128~320k | 音乐历史遗产 |
| AAC-LC | 1997 | 收费（Via LA） | 96~256k | **MP4/FLV/HLS 全生态** |
| HE-AAC (v1/v2) | 2003/06 | 收费 | 32~64k | 低码率广播 |
| Vorbis | 2000 | 免费 | 96~160k | WebM 老搭档 |
| **Opus** | 2012 | **免费**（IETF RFC 6716） | 6~510k | **WebRTC/实时** |

## 2. 定义/原理：两强的本质差异

### 2.1 帧长与延迟（决定实时适用性）

- **AAC**：固定帧 1024 samples → 44.1kHz 下 **23.2ms**/帧，加上编解码器 lookahead 实际延迟 100ms+。
- **Opus**：帧长可选 2.5/5/10/20/40/60ms，默认 **20ms**；算法延迟仅 **2.5~5.5ms**。

实测（本机 ffmpeg）：

```
AAC 96k:  frame duration = 1024 samples (23.2ms @44.1k)   ×N 帧恒定
Opus 96k: frame duration = 960 samples  (20ms  @48k)      （首帧 648 为预滚帧）
```

**WebRTC 之所以选 Opus，20ms 帧长 + 5ms 算法延迟 + 自适应码率（网络抖动时无缝 6k→510k）是根本原因**——AAC 的 23ms 帧长 + 编码器 lookahead 在实时场景先天不合格。

### 2.2 码率自适应

- Opus 内部 SILK（语音）/CELT（音乐）混合模型，**可跨 6k~510k 无缝切换**，同一条流中途变码率不用重协商。
- AAC 码率在编码时定死，直播里变码率 = 重新初始化解码器。

## 3. 实测

### 3.1 同源同码率体积与质量对比

> 🔗 FFmpeg 9.0，源 = pink noise + 1kHz 正弦混音 6s 单声道，四种编码各 64k/96k/128k。**RMS/高频能量是粗粒度代理指标，绝对数值机器无关但源相关，结论看相对关系。**

体积（同样 96k 目标码率，容器开销不同）：

| 编码 | 64k | 96k | 128k |
| --- | --- | --- | --- |
| AAC-LC (m4a) | 50,338 | 74,459 | 97,973 |
| Opus (opus) | 47,969 | 69,728 | 93,196 |
| MP3 | 48,428 | 72,620 | 96,812 |
| Vorbis (ogg) | 50,266 | 64,298 | 89,536 |

高频保真（8kHz 以上能量，越接近源越好；源 = -39.92dB）：

| 编码 @64k | 8k+ RMS | 与源差距 |
| --- | --- | --- |
| **Opus** | -40.77 dB | **-0.85**（最佳） |
| Vorbis | -41.05 | -1.13 |
| AAC-LC | -41.39 | -1.47 |
| MP3 | -41.49 | -1.57（最差） |

总能量保真（RMS_level，源 = -25.54dB）：

| 编码 @96k | RMS | 与源差距 |
| --- | --- | --- |
| AAC-LC | -25.57 | -0.03 |
| Opus | -25.67 | -0.13 |
| Vorbis | -25.57 | -0.03 |
| MP3 | -26.00 | -0.46（最差） |

**读法**：64k 低码率下 Opus 高频保真最好（语音场景的核心优势）；MP3 全面垫底（20 年前的技术）；AAC 中规中矩但生态无敌。

### 3.2 容器兼容性（生态现实）

| 容器 | AAC | Opus |
| --- | --- | --- |
| MP4 | ✅ 标配（`mp4a.40.2`） | ⚠️ 有规范（2018+）但工具链/播放器支持零碎 |
| FLV | ✅ | ❌ |
| MPEG-TS (HLS) | ✅ | ❌（HLS 生态） |
| WebM | ❌ | ✅ 标配 |
| WebRTC (SDP) | ⚠️ 可协商但非主流 | ✅ **强制必选**（RFC 7874：所有 WebRTC 端点必须支持 Opus） |

### 3.3 二进制结构：AAC 的 ADTS 头 vs Opus 的 TOC 字节

两者「裸流帧」的头结构对比最能说明设计哲学差异：**AAC 每帧 7~9 字节固定头，Opus 每包最少 1 字节头**。

#### AAC 裸流 = ADTS（Audio Data Transport Stream）

流式场景（TS/裸流解析）里每帧前有 ADTS 头，固定 7 字节（带 CRC 为 9）：

```
AAAAAAAA AAAABCCD EEFFFFGH HHIJKLMM MMMMMMMM MMMOOOOO OOOOOOPP
│          │         │          │              │           │
syncword   ID/layer/  profile/   channel_cfg/   frame_len   fullness/blocks
0xFFF      protect    sr_idx
```

| 字段 | 位 | 实测值（本机 ffmpeg 生成 48k 单声道 LC） | 含义 |
| --- | --- | --- | --- |
| syncword | 12 | `0xFFF` | 帧同步字，解析器靠它定位帧头 |
| ID | 1 | 0 | 0=MPEG-4 / 1=MPEG-2 |
| layer | 2 | 0 | 恒 0 |
| protection_absent | 1 | 1 | 1=无 CRC（头 7B）/ 0=有 CRC（头 9B） |
| profile | 2 | 1 | **AOT−1**：0=Main 1=**LC** 2=SSR 3=LTP |
| sampling_freq_idx | 4 | 3 | 查表：3=48000Hz（15 禁用） |
| channel_config | 3 | 1 | 1=单声道 2=立体声…7=8 声道 |
| aac_frame_length | 13 | 379 | **含头**的整帧长度（解析器据此跳帧） |
| buffer_fullness | 11 | 0x7FF | 0x7FF = VBR 标志 |
| number_of_blocks −1 | 2 | 0 | 每帧 raw block 数−1（通常 0） |

**MP4 里没有 ADTS**——参数集（AOT/采样率/声道 = AudioSpecificConfiguration，2 字节）提取到 esds/decSpecificInfo 带外存放，帧只留 raw data。**ADTS ↔ raw 的互转就是 MSE 喂流前的常见预处理**（Chrome MSE 的 AAC 要求 mp4a.40.2 封装，裸 ADTS 流要手动剥头/装 esds——flv.js 里就有这段）。

#### Opus 包 = TOC 字节 + 自描述分帧

Opus 没有「头」的概念——**每个包第一个字节就是 TOC（Table of Contents），自描述一切**：

```
 0 1 2 3 4 5 6 7
+-+-+-+-+-+-+-+-+
| config  |s| c |     ← TOC 字节：5 位 config + 1 位 stereo + 2 位帧数代码
+-+-+-+-+-+-+-+-+
```

| 字段 | 位 | 含义 |
| --- | --- | --- |
| config | 5 | 32 种组合 = **模式（SILK/CELT/混合）× 带宽 × 帧长**（如 config 0 = SILK NB 10ms，config 15 = CELT WB 20ms） |
| s | 1 | 0=单声道 1=立体声 |
| c | 2 | 帧数代码：0=1 帧 / 1=2 帧等长 / 2=2 帧变长 / 3=任意帧数（带 frame count 字节） |

后面跟压缩数据；code 2/3（变长多帧）用 1~2 字节长度前缀自描述分帧（252~255 是扩展转义，表示长度需要第二字节）。**码率切换（6k→510k）、帧长切换（2.5→60ms）、单双声道切换都不需要重新协商——TOC 字节每包自描述**，这就是 Opus「网络实时自适应」的协议基础。对照 AAC：改采样率/声道要换 SPS 级别的参数集，流中途切换 = 解码器重初始化。

#### 结构差异的本质

| | AAC (ADTS) | Opus (TOC) |
| --- | --- | --- |
| 帧头开销 | 7~9 B/帧（1024 采样 ≈ 23ms） | 1~2 B/包（20ms 默认） |
| 参数集 | 带外（ASC in esds）或 ADTS 内重复 | **无**——TOC 逐包自描述 |
| 中途变参 | 需重初始化 | TOC 换 config 即可 |
| 解析模型 | 同步字定位 + 固定字段 | 单字节自描述 + 自定义变长分帧 |

**一句话**：AAC 的结构是「广播思维」——参数集一次声明、帧头携带冗余同步信息保证流内可恢复；Opus 的结构是「包思维」——每包独立自描述，丢一包不影响后续解析。这个差异直接决定了各自的主场（分发光播 vs 实时通话）。

## 4. 为什么这么设计？（背后取舍）

**为什么 WebRTC 强制 Opus 而不是 AAC？**
- 实时通信的三个硬约束：低延迟（算法延迟 5ms vs 100ms+）、抗丢包（Opus 内建 FEC/PLC 丢包补偿）、变码率（带宽波动时码率跟着抖，不重协商）。AAC 三项全不合格——它为「存储和广播」设计，Opus 为「实时网络」设计。
- **免费**是第二重原因：IETF 标准无专利税，WebRTC 这种内嵌在每台浏览器里的功能选收费编码会重演 H265 的僵局（见 [[视频编码代际与浏览器支持]]）。

**为什么 AAC 至今是分发标配？**
- 路径依赖：MP4/FLV/TS 容器 2000 年代就绑定 AAC，全球解码器部署率 100%。Opus 进 MP4 太晚（2018 规范化），工具链（ffmpeg/剪辑软件/CDN 转码）和存量播放器不支持——**技术上更好的编码打不过生态在位的编码，这和 H265 vs H264 的分发格局是同一个故事。**

**为什么 Opus 高频好？**
- CELT 模型用 MDCT + 频带复制，对语音的 4~12kHz 共振峰保留策略优于 AAC 的纯心理声学裁剪；且 64k 落在 SILK/CELT 切换的甜点区。

## 5. 规避 / 实践

| 场景 | 手段 |
| --- | --- |
| 点播/直播分发 | AAC-LC（128~256k 音乐类 / 96k 语音类），容器 MP4/FLV/TS 全兼容 |
| 实时通话 | Opus（帧长 20ms，`useinbandfec=1` 开抗丢包，DTX 静音检测省带宽） |
| 低码率语音 | Opus 6~16k 或 HE-AAC v2（广播场景） |
| MSE 喂流 | mimeType 必须写全音频 codec：`'video/mp4; codecs="hvc1.., mp4a.40.2"'`——实测漏写音频 codec 会报 `audio object type 0x40 does not match`（见 [[MSE最小播放器-验证demo]]） |
| WebAudio 播放 | AAC/Opus 都走 `decodeAudioData`，采样率对齐 AudioContext（见 [[WebAudio与音画同步时钟]]） |

## 6. 面试速记

> **30 秒版**："AAC 帧长 1024 采样 ≈23ms 加 lookahead 延迟 100ms+，为存储广播设计，是 MP4/FLV/HLS 生态标配；Opus 默认 20ms 帧长、算法延迟 5ms、内建 FEC 抗丢包、码率 6k~510k 无缝自适应、免专利——WebRTC 强制必选。实测 64k 下 Opus 高频能量最接近源（-0.85dB vs AAC -1.47dB）。选型逻辑：分发给 AAC（生态），实时给 Opus（延迟），本质是场景约束不是技术优劣。"

## 相关笔记

- [[编码与封装的区别]] —— 音频编码装进容器的两层模型
- [[fMP4与MP4的区别]] —— AAC 参数集（ASC）在 esds 里的位置与 MSE mimeType 报错实测
- [[WebRTC适用边界]] —— 为什么实时场景强制 Opus（生态视角）
- [[WebAudio与音画同步时钟]] —— 解码后的音频怎么对时钟播放
- [[RTCPeerConnection流程]] —— SDP 协商里 Opus 的位置
- [[码率帧率分辨率与带宽]] —— 音频码率在总带宽里是小头（96k vs 视频 4000k）

*本文档基于 FFmpeg 9.0 (aac/libopus/libmp3lame/libvorbis) 本机实测、RFC 6716 (Opus)、RFC 7874 (WebRTC 音频强制集) 整理。*
