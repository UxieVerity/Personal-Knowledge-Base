# fMP4与MP4的区别

> **结论：fMP4 = 把普通 MP4 的「一整个 moov 索引 + 一整块 mdat」拆成「一个小 moov + 一堆 moof+mdat 分片」——**从「下载完才知道怎么播」变成「下载一个分片就能播一段」**。MSE 只吃 fMP4（规范规定的唯一格式），因为流式喂入需要每个分片自带时间信息。实测：同一 H265 文件，普通 MP4 的 box 结构是 `ftyp → mdat(319KB) → moov(8KB)`，fMP4 是 `ftyp → moov(3.6KB) → moof+mdat × N`——moov 前置是流式的前提，moof 分片是 Seek/切档的粒度。**

> 可运行验证：ffmpeg `-movflags +frag_keyframe+empty_moov+default_base_moof` 生成 fMP4，`ffprobe -v trace` 列 box 结构（§3 实测，命令即脚本）；MSE 喂流实测见 [[MSE最小播放器-验证demo]]。

[[编码与封装的区别]] · [[MSE核心机制]] · [[HLS协议原理]]

---

## 1. 背景：普通 MP4 的两个「死穴」

普通（progressive）MP4 的 box 布局：

```
ftyp (文件类型) → mdat (全部媒体数据) → moov (全部索引/时间戳)
        319,631 B                  8,170 B
```

两个死穴：

1. **moov 在文件尾**：播放器必须拿到**整个文件**才能开始播（不知道索引就没法 demux）。流式场景 = 先下载全部，首开时间被文件大小绑架。
   - （`moov 前置` faststart 可以解决「能尽早播」，但解决不了「分段更新」。）
2. **索引是全局一次性结构**：想直播/边录边播/中途切码率，moov 没法预知后面的数据——结构上不支持流式写入。

## 2. 定义/原理：fMP4 怎么拆

fMP4（fragmented MP4，ISO/IEC 14496-12 附件）把结构改成：

```
ftyp → moov (小, 声明流参数: 3,660 B) → [moof (分片索引) + mdat (分片数据)] × N → (mfra 可选, 110 B)
                                          2,548 B + 319,631 B (总)
```

| box | 普通_MP4 | fMP4 | 作用 |
| --- | --- | --- | --- |
| moov | 大（全部索引） | **小**（只声明轨道参数：编码、分辨率、时长） | moov 里不再有每帧信息 |
| moof | ❌ 无 | ✅ **每分片一个**（Movie Fragment） | 声明「这一小段里有哪些帧、什么时间戳」 |
| mdat | 一整块 | **每分片一块** | 紧跟自己的 moof |
| mfra | ❌ | 可选（文件尾的分片索引） | 只给 Seek 加速用，不是播放必需 |

**播放器拿到 `moov + 第一个 moof+mdat` 就能播第一段**——流式的最小单元从「整个文件」变成「一个分片」。这就是 HLS fMP4 分片、DASH 分片、MSE appendBuffer 的共同地基。

## 3. 实测

### 3.1 box 结构对比（ffprobe -v trace）

> 🔗 同一 H265 4s 源，普通 vs 分片（`-movflags +frag_keyframe+empty_moov`）：

```
普通 MP4:  ftyp(28) → free(8) → mdat(319,631) → moov(8,170)
fMP4:      ftyp(32) → moov(3,660) → moof(2,548) → mdat(319,631) → mfra(110)
```

10s 源按 1s 分片（`-frag_duration 1000000`）后 box 统计：

```
ftyp ×1   moov ×1   moof ×11   mdat ×11   mfra ×1
（10s → 11 对 moof+mdat = 10 个整秒分片 + 1 个收尾分片）
```

**moov 从 8,170 B 缩到 3,660 B**（每帧索引移进了各 moof），moof 单个 ~2.5KB，分片粒度完全由推流端控制。

### 3.2 MSE 只吃 fMP4：两种喂法的实测结果

> 🔗 headless Chrome 154 + puppeteer-core，`MediaSource.addSourceBuffer` 喂 H265 fMP4：

| 喂入格式 | 结果 |
| --- | --- |
| fMP4（+default_base_moof） | `updateend` → `buffered=[0, 4.07]` → 播放正常 ✅ |
| 同文件缺 `default_base_moof` flag | `CHUNK_DEMUXER_ERROR_APPEND_FAILED: TFHD base-data-offset not allowed by MSE` ❌ |
| 普通（非分片）MP4 分段硬喂 | 直接无法按分片解析（moof 不存在，appendBuffer 语义不存在） |

**MSE 规范（byte-stream-format-isobmff）明确要求**：分片必须用「movie-fragment-relative addressing」（base-data-offset 禁止使用绝对偏移，分片必须自包含寻址）——`+default_base_moof` 就是让 ffmpeg 写出符合该约束的 tfhd。这是「MSE 只吃 fMP4 且有附加约束」的实测注脚。

### 3.3 普通转 fMP4 的完整命令（实践直接抄）

```bash
# 视频轨 fMP4（MSE 直播/点播通用）
ffmpeg -i in.mp4 -c:v copy -an \
  -movflags +frag_keyframe+empty_moov+default_base_moof out-fmp4.mp4

# 视频音频都要（MSE mimeType 必须声明双编码）
ffmpeg -i in.mp4 -c copy \
  -movflags +frag_keyframe+empty_moov+default_base_moof out-fmp4-full.mp4
# mimeType: 'video/mp4; codecs="hvc1.1.6.L93.B0, mp4a.40.2"'
```

## 4. 规范位置

- ISO/IEC 14496-12（ISOBMFF）§3.1 「movie fragment」；§8.8.6 tfhd 的 base-data-offset 语义。
- W3C MSE Byte Stream Format for ISOBMFF：「movie-fragment-relative addressing」小节（base-data-offset 禁令的出处）。
- HLS：`EXT-X-MAP`（初始化段 = moov 部分）+ fMP4 媒体分片（2016 起与 TS 并列的一等公民）。

## 5. 为什么这么设计？（背后取舍）

**为什么 MSE 不支持普通 MP4 / 不支持裸 FLV？**
- MSE 的核心 API 语义是 `appendBuffer(一段字节)` → `buffered` 更新 → `currentTime` 继续走。这要求**每段字节自带时间戳、自包含可解析**——fMP4 的 moof 天生如此，普通 MP4 的全局 moov 天生不满足（一段 mdat 脱离 moov 无从解读）。FLV 是另一个有 tag 自包含寻址的格式，浏览器选择不内置（生态交给 JS demuxer，见 [[MSE最小播放器-验证demo]] 的 flv.js 思路）。
- 设计哲学：**把「容器格式」从浏览器原生支持里降级成「唯一指定 fMP4 + 其他格式 JS 转封装」**——浏览器少背一个格式包袱，生态用 JS 补齐灵活性。

**为什么 moof 和 mdat 成对而不是先全 moof 再全 mdat？**
- 网络流式写入的顺序友好性：编码器边产帧边写（moof 声明→mdat 装数据），下载端边收边播。如果分两块，下载端还是得等「全部索引」到齐——等于把全局 moov 的问题复制到分片层。

**为什么 fMP4 在 HLS 里正在取代 TS？**
- TS 是广播出身（188B 包、抗丢包），overhead ~5~10%；fMP4 无固定包开销、 muxer/demuxer 更省 CPU、Seek 索引（mfra/sidx）原生。YouTube/Netflix 早已 fMP4 化。

## 6. 规避 / 实践

| 场景 | 手段 |
| --- | --- |
| MSE 喂流报 TFHD 错 | ffmpeg 加 `-movflags +default_base_moof`（§3.2 实测） |
| mimeType 报 codec 不匹配 | 音轨必须显式写入 codecs 串：`codecs="avc1.42E01E, mp4a.40.2"` |
| 直播分片粒度 | 1~2s 一片（frag_duration），与 GOP 对齐（见 [[I帧P帧B帧与GOP]]） |
| 点播快速 Seek | 生成时加 sidx（`-write_tmcd`/dash 工具链），或靠 mfra |
| 检查 box 结构 | `ffprobe -v trace -i file 2>&1 | grep "parent:'root'"` |

## 7. 面试速记

> **30 秒版**："普通 MP4 是 moov+mdat 两段式，moov 全局索引在尾部，必须下完才能播；fMP4 把索引拆进每个 moof，一小段就能解一段，流式的最小单元从文件变成分片。MSE 规范只认 fMP4 且要求 movie-fragment-relative addressing——实测缺 default_base_moof 会报 TFHD base-data-offset not allowed。moov 从 8KB 缩到 3.6KB、每秒一个 moof+mdat 对就是实测结构。HLS 用 fMP4 取代 TS 也是同个理由：开销小、Seek 原生。"

## 相关笔记

- [[编码与封装的区别]] —— 容器层的上游概念
- [[MSE核心机制]] —— appendBuffer 为什么必须 fMP4（浏览器视角）
- [[MSE最小播放器-验证demo]] —— 全流程喂流实测（含本篇所有报错复现）
- [[HLS协议原理]] —— fMP4 分片在 HLS 里的角色（EXT-X-MAP）
- [[I帧P帧B帧与GOP]] —— 分片粒度为什么对齐 GOP

*本文档基于 ISO/IEC 14496-12 (ISOBMFF)、W3C MSE ISOBMFF Byte Stream Format、FFmpeg 9.0 box 级实测整理。*
