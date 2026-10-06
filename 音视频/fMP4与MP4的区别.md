# fMP4与MP4的区别

> **结论：fMP4 = 把普通 MP4 的「一整个 moov 索引 + 一整块 mdat」拆成「一个小 moov + 一堆 moof+mdat 分片」——从「下载完才知道怎么播」变成「下载一个分片就能播一段」**。MSE 只吃 fMP4（规范规定的唯一格式），因为流式喂入需要每个分片自带时间信息。实测：同一 H265 文件，普通 MP4 的 box 结构是 `ftyp → mdat(319KB) → moov(8KB)`，fMP4 是 `ftyp → moov(3.6KB) → moof+mdat × N`——moov 前置是流式的前提，moof 分片是 Seek/切档的粒度。

> 可运行验证：ffmpeg `-movflags +frag_keyframe+empty_moov+default_base_moof` 生成 fMP4，`ffprobe -v trace` 列 box 结构（§3 实测，命令即脚本）；MSE 喂流实测见 [[MSE最小播放器-验证demo]]；avc1/avc3 参数集位置实测见 §3.4（脚本 [[fMP4-avc1-avc3-验证脚本]]）。

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

### 3.4 avc1 vs avc3：SPS/PPS 到底放在哪（box 级实测）

> 🔗 FFmpeg 9.0，x264 `repeat-headers=1`（每个 IDR 前重复 SPS/PPS）生成 AnnexB 裸流，分别打 `-tag:v avc1` / `-tag:v avc3` 封装 fMP4，零依赖 Node 脚本逐 box 解析（[[fMP4-avc1-avc3-验证脚本]]，样本在 `media/avc1-fmp4.mp4`、`media/avc3-inband-fmp4.mp4`）。

**常见误解**：「avc1 把 SPS/PPS 放 moov，avc3 把 SPS/PPS 放 moof」——**错，moof 永远只装元数据（mfhd/tfhd/tfdt/trun），从不装码流**。实测两者的 moof 都解析不出任何 NAL：

```
avc1 封装:                                avc3 封装:
moov > stsd > avc1 > avcC                 moov > stsd > avc3 > avcC
  └ SPS x1 (24B) + PPS ←参数集在这里        └ SPS x1 (24B) + PPS ←参数集也在这里！
moof: 无 NAL（×2 分片）                   moof: 无 NAL（×2 分片）
mdat: nal6,IDR,slice... ×10               mdat: SPS,PPS,nal6,IDR,slice... ×10 ←关键帧前带参数集
      IDR,slice... ×10                          SPS,PPS,IDR,slice... ×10
```

**真正的区别不是「放哪」，而是 ISO 14496-15 规定的一句语义**：

| | sample entry | 参数集能否出现在 sample 里 | 实测 mdat |
| --- | --- | --- | --- |
| avc1 | 不允许 in-band 参数集 | ❌ 不允许（muxer 会剥掉） | 纯 slice/IDR |
| avc3 | 允许 in-band 参数集 | ✅ 允许（且通常保留） | 每个 **IDR 前**带一组 SPS/PPS |

三个要点（面试易错点）：

1. **avc1/avc3 的 avcC 里都有完整 SPS/PPS**——实测两个文件 avcC 大小、内容完全一样。区别不是「有没有头部参数集」，而是「允不允许参数集 additionally 出现在码流里」。（同 HEVC 的 hvc1/hev1 成对关系。）
2. **in-band 参数集在 mdat 的 sample 内部**，紧跟 NAL 数据（length-prefixed 格式），通常在每个关键帧前——不是每个 sample 都有，普通 slice sample 不带。
3. **moof 永远不含 SPS/PPS**：moof 是分片级索引（帧数、时长、偏移），码流只在 mdat。

**为什么这么设计**：avcC 的参数集在 init segment（moov）解析时给了 decoder 配置，这是 MSE「media segment 不依赖 init 独立可解」的前提——但前提是参数集不变。avc3 的价值是**参数集可以中途变化**（分辨率/profile 切换）：SPS 跟关键帧走在 mdat 里，decoder 解到新 SPS 就地应用，**不用换 init segment**。对 avc1 流，中途换参数必须 `changeType()` 重新喂 init；avc3 流天然支持 in-band 切换。这就是直播/低延迟场景常见 avc3 的原因——转码端参数一变，分片自带描述，客户端无感知。

MSE 侧注意：`codecs` 串里 `avc1.64001f` 与 `avc3.64001f` 是两个不同字符串，`isTypeSupported` 都返回 true，但 SourceBuffer 收到的字节流必须与声明一致（声明 avc1 却喂带 in-band 参数集的流，部分浏览器会报 decode error）。

#### §3.4.1 追加实测：MSE 声明 avc1 + in-band 参数集，Chrome 能不能播？

> 🔗 Chrome (headless) + puppeteer-core，`MediaSource.addSourceBuffer` 分 3 段 appendBuffer + 播放 2.5s 统计 `getVideoPlaybackQuality()`（[[fMP4-avc1-inband-sps-验证脚本]]，结果存 `fMP4-avc1-inband-sps-实测结果.json`）。B 场景的构造方式：ffmpeg `-c copy -tag:v avc1` 会把 in-band 参数集剥掉，所以直接对 avc3 文件把 stsd 里 sample entry 的 4 字节 type 从 `avc3` 改成 `avc1`——字节流不变（I 帧前仍有 SPS/PPS），只有声明变了。

| 场景 | codecs 声明 | mdat 实际 | appendBuffer | buffered | 播放 2.5s | decoded |
| --- | --- | --- | --- | --- | --- | --- |
| A 基线 | avc1.42E01E | 无参数集 | ✅ | [0,10] | ✅ 74 帧 | dropped=0 |
| B **用户用法** | avc1.42E01E | **SPS×10 + IDR×10** | ✅ | [0,10] | ✅ **75 帧** | dropped=0 |
| C 规范写法 | avc3.42E01E | SPS×10 + IDR×10 | ✅ | [0,10] | ✅ 74 帧 | dropped=0 |
| D 反向错配 | avc3.42E01E | 无参数集 | ✅ | [0,10] | ✅ 74 帧 | dropped=0 |

**结论：Chrome 全部播通，包括错配的 B 和 D。** 为什么声明 avc1 还能容忍 in-band 参数集：Chrome 的 MP4 demuxer 初始化 decoder 只认 avcC（stsd 里的），对 sample 内多出来的 SPS/PPS 不做 avc1/avc3 语义校验，直接透传给解码器——而解码器本身就按「解到 SPS 就应用」工作，所以多一组参数集无害。反向的 D 同理：avcC 里有参数集就够初始化，sample 里没有 in-band 也不报错。

**但「能播」≠「合规」**，三个边界要知道：

1. **这只是 Chrome 的宽容，不是规范保证**。ISO 14496-15 里 avc1 的语义就是「不允许 in-band」；Safari/部分 TV/机顶盒的硬件解码链路对 sample entry 语义更严格，声明 avc1 却带 in-band 参数集可能在别的环境翻车。自己的产品只跑 Chrome 内核（Electron/WebView）可以接受；跨端（iOS Safari、电视端）应按流的真实形态声明：带 in-band 就写 avc3。
2. **中途参数变化的行为未定义**：B 场景声明 avc1 意味着向播放器承诺「参数集不会变」，如果之后真的在流里换分辨率，Chrome 能否应用新 SPS 没有规范依据（实测纯 avc1+avcC 的 init 已固定 decoder 配置），正确做法仍是 changeType + 重喂 init 或声明 avc3。
3. **自研 muxer/推送端的对齐点**：你控制不了客户端用什么浏览器时，最稳的是「码流和声明二选一对齐」——要么 ffmpeg 风格抽干 sample 里的参数集 + 声明 avc1（最通用），要么保留 in-band + 声明 avc3（直播/参数可变）。两头不占的「avc1 声明 + in-band 码流」能播但属于踩在宽容度上。

### 3.5 复现命令

```bash
# 1) 生成每个 IDR 前重复 SPS/PPS 的 AnnexB 裸流
ffmpeg -f lavfi -i testsrc=duration=2:size=128x96:rate=10 \
  -c:v libx264 -pix_fmt yuv420p -g 10 -x264-params repeat-headers=1 -f h264 raw.h264

# 2) 分别按 avc1 / avc3 tag 封装 fMP4
ffmpeg -i raw.h264 -c copy -movflags frag_keyframe+empty_moov+default_base_moof -tag:v avc1 avc1.mp4
ffmpeg -i raw.h264 -c copy -movflags frag_keyframe+empty_moov+default_base_moof -tag:v avc3 avc3.mp4

# 3) box 级验证（avcC 内容 / moof NAL / mdat NAL 序列）
node fMP4-avc1-avc3-验证脚本.js avc1.mp4 avc3.mp4
```

注意：`-c copy` 时 tag 只是改名，**码流里的参数集保留与否由源流决定**——所以第 1 步必须用 `repeat-headers=1` 先造出带重复参数集的源，否则 avc3 封装看不到 in-band SPS。

## 4. 规范位置

- ISO/IEC 14496-12（ISOBMFF）§3.1 「movie fragment」；§8.8.6 tfhd 的 base-data-offset 语义。
- ISO/IEC 14496-15 §5.3.3：AVCSampleEntry（avc1）与 AVCInbandParameterSetCapture...（avc3）的语义区别——avc3 允许参数集 NAL 出现在 sample 内（in-band），avc1 禁止。
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

**为什么 avc3 允许 in-band 参数集（而 avc1 禁止）？**
- avc1 的假设是「参数集属于流的全局描述」，放 avcC 一次声明终身有效——省每个关键帧几十字节的 overhead，适合点播（参数永不变）。
- avc3 的假设是「参数集可能中途变」：直播转码切分辨率、adaptive streaming 换 profile。参数集跟关键帧走，decoder 解到就应用，**不需要客户端重新 append init segment**。代价是每个 IDR 多 ~40B overhead——对秒级 GOP 的直播完全可忽略。
- 两者是同一份数据的两种分发策略，不是二选一：avc3 文件的 avcC 里依然有参数集（实测 §3.4），in-band 是「冗余但换来中途可变」。

## 6. 规避 / 实践

| 场景 | 手段 |
| --- | --- |
| MSE 喂流报 TFHD 错 | ffmpeg 加 `-movflags +default_base_moof`（§3.2 实测） |
| mimeType 报 codec 不匹配 | 音轨必须显式写入 codecs 串：`codecs="avc1.42E01E, mp4a.40.2"` |
| 直播分片粒度 | 1~2s 一片（frag_duration），与 GOP 对齐（见 [[I帧P帧B帧与GOP]]） |
| 点播快速 Seek | 生成时加 sidx（`-write_tmcd`/dash 工具链），或靠 mfra |
| 检查 box 结构 | `ffprobe -v trace -i file 2>&1 \| grep "parent:'root'"` |
| 想验证 SPS/PPS 在哪个 box | `node fMP4-avc1-avc3-验证脚本.js file.mp4`（§3.4，逐 box 打 avcC/mdat NAL） |
| 直播中途可能切分辨率/参数 | 封装用 avc3（in-band 参数集），或客户端 `changeType()` + 重喂 init |

## 7. 面试速记

> **30 秒版**："普通 MP4 是 moov+mdat 两段式，moov 全局索引在尾部，必须下完才能播；fMP4 把索引拆进每个 moof，一小段就能解一段，流式的最小单元从文件变成分片。MSE 规范只认 fMP4 且要求 movie-fragment-relative addressing——实测缺 default_base_moof 会报 TFHD base-data-offset not allowed。moov 从 8KB 缩到 3.6KB、每秒一个 moof+mdat 对就是实测结构。HLS 用 fMP4 取代 TS 也是同个理由：开销小、Seek 原生。"

> **avc1/avc3 追问版**："常见误解是 avc3 把 SPS/PPS 放 moof——错，moof 永远只装元数据，码流只在 mdat。实测两者 stsd 里的 avcC 都有完整 SPS/PPS，真正的区别是 ISO 14496-15 的语义：avc1 禁止参数集出现在 sample 里，avc3 允许——所以 avc3 的 mdat 里每个关键帧前带一组 SPS/PPS（length-prefixed，跟 NAL 数据在一起）。价值是直播中途切分辨率不用换 init segment：decoder 解到新 SPS 就地应用。同 HEVC 的 hvc1/hev1。加分项：实测 Chrome MSE 声明 avc1 却喂 in-band 码流也能播（demuxer 只认 avcC、不校验 sample entry 语义），但这是宽容不是合规——跨端按流的真实形态声明，带 in-band 写 avc3。"

## 相关笔记

- [[编码与封装的区别]] —— 容器层的上游概念
- [[MSE核心机制]] —— appendBuffer 为什么必须 fMP4（浏览器视角）
- [[MSE最小播放器-验证demo]] —— 全流程喂流实测（含本篇所有报错复现）
- [[HLS协议原理]] —— fMP4 分片在 HLS 里的角色（EXT-X-MAP）
- [[I帧P帧B帧与GOP]] —— 分片粒度为什么对齐 GOP
- [[fMP4-avc1-avc3-验证脚本]] —— §3.4 的 box 级实测脚本（avcC / moof / mdat NAL 定位）
- [[fMP4-avc1-inband-sps-验证脚本]] —— §3.4.1 的 MSE 喂流实测脚本（avc1 声明 + in-band 参数集四场景）

*本文档基于 ISO/IEC 14496-12/-15 (ISOBMFF)、W3C MSE ISOBMFF Byte Stream Format、FFmpeg 9.0 box 级实测整理。*
