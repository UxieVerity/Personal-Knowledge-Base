# SPS与PPS（名词解释）

> **结论：SPS（Sequence Parameter Set，序列参数集）= 描述「一整段视频流怎么解」的全局参数（profile/level、分辨率、帧率、编码工具开关）；PPS（Picture Parameter Set，图像参数集）= 描述「每一帧怎么解」的参数（熵编码模式、slice 分组等）。两者是解码器的「配置说明书」——没有它们，后面收到的所有 slice 数据一个字节都解不了。** 在 H264 裸流里是 NALU 类型 7（SPS）和 8（PPS）；在 MP4 里存放在 stsd 的 avcC box 中（MSE 初始化 SourceBuffer 时就是从这里读的）。

[[H264与H265结构和原理区别]] · [[fMP4与MP4的区别]] · [[编码与封装的区别]]

---

## 1. 它们是什么、里面有什么

H264 码流的基本单位是 NALU。除了真正装画面数据的 slice（类型 1/5），还有两类「元数据 NALU」：

| NALU 类型 | 名字 | 全称 | 作用 | 关键内容 |
| --- | --- | --- | --- | --- |
| 7 | SPS | Sequence Parameter Set | 一段序列（两个 IDR 之间）的**全局**解码参数 | profile/level（决定能用哪些编码工具）、分辨率（宽高，经 crop 推出）、帧率、log2_max_frame_num、是否允许 B 帧 |
| 8 | PPS | Picture Parameter Set | **每帧级**的解码参数 | 熵编码模式（CAVLC/CABAC）、slice group 划分、初始 qp、deblock 滤波开关 |
| 5 | IDR | — | 关键帧本体 | 解码的「入口」，SPS/PPS 常跟在它前面 |

类比：SPS 是「这本书用什么字典、页有多大」，PPS 是「每页的排版规则」，slice 是「正文」。字典没给，正文就是乱码。

**为什么拆成两层**：SPS 很大且一段流基本不变，PPS 小且可能按帧变——拆开让重复发送时只需重复小的 PPS，也让「同一序列多组 PPS」成为可能（多码流场景）。

### 1.1 辨析：一个 NALU 就是一帧吗？（高频追问）

> 🔗 实测：1s/10fps/g=5 的 x264 流（`media/test.h264`），共 **15 个 NALU、10 帧**——slice 类型 NALU 恰好 10 个（IDR×2），多出的 5 个是 SPS/PPS/SEI 随行人员。

**不是。NALU 是「网络抽象层」的传输单元，一帧是解码概念上的「访问单元」（Access Unit）**，对应关系有三种：

```
1. 常规 1:1   一帧编码成一个 slice → 一个 slice NALU（大多数流的默认）
2. 一帧多 NALU 1:N  画面大/码率控制时一帧拆多 slice（H264 slice 分区 A/B/C=类型2/3/4）
3. 多 NALU 一帧 N:1  RTP 的 STAP-A 把小 NALU 聚合进一个包；MP4 sample 里
                    [SPS][PPS][IDR] 三个 NALU 属于同一个 sample（=一帧）
```

判断口径：只有 `nal_unit_type` 为 **1/5（H264）或 0~21 的图像类型（H265）** 的 NALU 才装图像数据；**7/8/6（SPS/PPS/SEI）是帧的「随行人员」**，不是帧。一帧 = 产生一幅图所需的全部 NALU（通常 1 个 slice + 若干 SEI + 可选参数集）。

两个落地推论：

- **时间戳按帧（AU/sample）打，不按 NALU 打**——一帧拆成多个 slice 时它们共用同一 pts；MP4 里 sample 才有 stts 时间表，NALU 没有。
- 上一节说「SPS/PPS 跟在 IDR 前」，严格说是**跟在「含 IDR 的访问单元」前面**——AnnexB 里它们属于同一个 AU，MP4 里同属一个 sample。

## 2. 在哪里出现（前端视角的三个位置）

1. **AnnexB 裸流**（TS、RTSP、H264 裸 h264 文件）：SPS/PPS 作为独立 NALU 插在码流里，用 startcode `00 00 00 01` 分隔，通常在每个 IDR 前重复一次（编码器 `repeat-headers` 参数控制）。
2. **MP4/fMP4**：SPS/PPS 被抽出来放进 **stsd 的 avcC box**（decoder configuration record），sample 里只留 length-prefixed 的 slice 数据。MSE `addSourceBuffer('video/mp4; codecs="avc1.42E01E"')` 初始化时，浏览器 demux 就是从 init segment（moov）的 avcC 里读它们配置解码器——**这就是为什么 MSE 的 media segment 不带参数集也能解**。实测见 [[fMP4与MP4的区别]] §3.4。
3. **WebRTC**：不经过 MP4，SPS/PPS 随 RTP 包（RFC 6184 的 STAP-A 聚合或独立发送）走信令后的媒体通道，丢了就没法解后续帧。

## 3. 为什么面试会问（三个追问点）

- **丢包/黑屏问题**：直播场景客户端中途加入却一直黑屏花屏 → 十有八九是**没等到 SPS/PPS 就开始喂解码器**。排查顺序：先确认拉到的第一个分片是否包含参数集（FLV 的 AVC sequence header、fMP4 的 init segment）。
- **SPS 变了怎么办**：分辨率中途切换 = SPS 变化。avc1 封装里 SPS 锁死在 avcC，必须换 init segment（MSE 是 `changeType()` + 重喂）；avc3 允许 in-band，SPS 跟关键帧走、解码器就地应用（同 HEVC 的 VPS/SPS/PPS 三件套）。
- **和 avc1/avc3 的关系**：avc1 = 参数集只能在 avcC；avc3 = 参数集额外允许出现在 sample 里。Chrome 实测声明 avc1 喂 in-band 也能播（demuxer 只认 avcC），但跨端不合规，见 [[fMP4与MP4的区别]] §3.4.1。

## 4. 面试速记

> **30 秒版**："SPS 是序列参数集——一段流的全局解码配置：profile/level、分辨率、帧率；PPS 是图像参数集——每帧级的配置：CABAC、初始 qp 这些。它们是解码器的说明书，没有就一个 slice 都解不了。位置上：裸流里是 NALU 7/8 跟在 IDR 前；MP4 里被抽进 avcC，MSE 初始化 SourceBuffer 就是从这里读的——所以 MSE 的 media segment 不带参数集也能解。直播中途黑屏先查有没有等到 SPS/PPS；分辨率切换本质是 SPS 变化，avc1 要换 init，avc3 支持 in-band 就地更新。追问「一个 NALU 是一帧吗」：不是——NALU 是传输单元，一帧是访问单元 AU，一帧可以拆多 slice 也可以和参数集/SEI 聚合；时间戳按帧打不按 NALU 打。"

## 相关笔记

- [[H264与H265结构和原理区别]] —— NALU 层在编码结构里的位置（H265 多一个 VPS）
- [[fMP4与MP4的区别]] —— SPS/PPS 在 avcC / in-band 的 box 级实测（§3.4/§3.4.1）
- [[I帧P帧B帧与GOP]] —— 为什么 SPS/PPS 每个 IDR 前重复（对齐 GOP 边界）
- [[MSE核心机制]] —— init segment 与 media segment 的分工
