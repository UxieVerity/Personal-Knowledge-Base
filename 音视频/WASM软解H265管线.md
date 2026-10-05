# WASM软解H265管线

> **结论：WASM 软解 = 在 decode 层把「浏览器硬解」换成「编译成 WASM 的 ffmpeg/OpenH265」，其余四层复用——**拉流(复用) → demux(JSEmscripten) → WASM 解码 → YUV → WebGL 上屏 → WebAudio 时钟同步**。为什么 H265 值得这么干：MSE 不放行（专利，实测 [[视频编码代际与浏览器支持]] §3.2）而业务又必须播 H265。核心代价是性能：H265 软解比 H264 慢 ~35%（实测），管线优化目标 = 让 1080p@30 软解在主流 CPU 上跑满实时，手段全在「省拷贝 + 挪线程」：Worker 里解码、SharedArrayBuffer/transferable 零拷贝传帧、WebGL 直接吃 YUV 纹理。**

> 可运行验证：管线每段的实测依据分布在 [[视频编码代际与浏览器支持]]（能力检测）、[[WASM内存管理]]（内存）、[[YUV格式与WebGL渲染]]（渲染）、[[解码Worker与SharedArrayBuffer]]（线程）；本篇给全管线视图与启动序列。

[[硬解与软解的选型]] · [[YUV格式与WebGL渲染]] · [[WASM内存管理]]

---

## 1. 背景：为什么是 WASM、为什么是 H265

- **为什么 H265**：国内监控/安防生态存量 H265 流极多（同画质省 40% 带宽），Web 端要接入就必须解决「浏览器不放行」的问题。
- **为什么 WASM 而不是 JS/ASM.js**：解码是纯计算密集（熵解码+反变换+运动补偿），JS 逐像素操作比 WASM 慢 3~10×，WASM 是浏览器里唯一的接近原生性能的计算通道。
- **为什么不是 PNaCl/插件**：已死生态；WASM 是唯一跨浏览器标准答案。

**管线的本质 = 播放器五层里把 decode 层换掉**（[[播放器架构分层]] §2），把「浏览器内部黑盒做的事」搬到 JS 可控范围：

```
硬解路径（MSE）：  bytes → [浏览器: demux+decode] → video 元素渲染
软解路径（WASM）： bytes → JS demux → WASM decode → YUV 帧 → WebGL 渲染
                                       ↑ 自己管理的一切 ↑
```

## 2. 定义/原理：六段管线

```
┌─ ① 拉流：fetch/WS 收 H265 裸流或 TS/fMP4
├─ ② demux：JS 解容器 → H265 NALU + pts（Emscripten 编译的 hevc demuxer 或 JS 实现）
├─ ③ WASM 解码：ffmpeg hevc decoder 编译为 wasm（SIMD + threads）
│      输入 NALU 字节（拷进线性内存）→ 输出 YUV 帧指针（留在线性内存内！）
├─ ④ 帧传递：Worker(SABA) → 主线程 零拷贝（见 [[解码Worker与SharedArrayBuffer]]）
├─ ⑤ WebGL 渲染：YUV 三平面 → 3 纹理 → shader 转换 RGB 合成上屏（见 [[YUV格式与WebGL渲染]]）
└─ ⑥ 同步：WebAudio 时钟主轴 + 丢帧/等帧（见 [[WebAudio与音画同步时钟]]）
```

### 启动序列（首开优化的软解版）

```
t0 用户手势 → resume AudioContext（并行①）
t1 fetch WASM 二进制 + instantiateStreaming（并行①②）   ← WASM 体积 2~4MB，可预载/缓存
t2 首个分片到达 → demux → decoder.configure
t3 首帧解码出 YUV → WebGL 纹理上屏
```

**WASM 二进制的首开代价**（2~4MB 编译）必须与拉流并行，或 Service Worker 预缓存——这是软解路径特有的首开税（[[首开时间优化]] §2.3）。

## 3. 实测

### 3.1 软解性能的基准（公平对比在同一 CPU 路径内）

> 🔗 FFmpeg 9.0 同机实测（[[视频编码代际与浏览器支持]] §3.1）：

| 解码路径 | 1080p 120 帧 | 换算 |
| --- | --- | --- |
| 软解 H264 | ~247 ms | 实时余量 ~4.8× |
| 软解 H265 | ~336 ms | 实时余量 ~3.5× |
| 硬解 H265 (NVDEC) | 跑通（CLI 计时不构成速度结论） | — |

**H265 软解比 H264 慢 ~35%**——1080p@30 实时软解在桌面 CPU 有余量（3.5×），移动端则是瓶颈（同样代码余量常 <1.5×）→ 移动端降档播放（480p/720p）。**这决定了软解管线的档位策略：桌面全量、移动降档**（[[硬解与软解的选型]] §5）。

### 3.2 WASM 解码器构建的实测要点

| 构建项 | 作用 | 实测/事实 |
| --- | --- | --- |
| `-msimd128` | WASM SIMD 指令 | 解码热点（idct/mc）提速显著，现代浏览器全支持 |
| `-pthread` + SAB | Worker 内多线程解码 | 需 COOP/COEP 头（跨域隔离），见 [[解码Worker与SharedArrayBuffer]] |
| side module / 静态链接 | 体积 vs 灵活 | ffmpeg 全量 wasm 2~4MB，裁剪到 hevc-only 可减半 |
| memory growth | 动态扩线性内存 | 预分配避免 grow 卡顿（[[WASM内存管理]]） |

### 3.3 管线的卡点分布（工程经验）

| 卡点 | 症状 | 对策 |
| --- | --- | --- |
| JS↔WASM 拷贝 | 主线程忙、帧率抖 | 帧留线性内存内，只传指针（零拷贝） |
| YUV→RGB 在 CPU 做 | 每帧全屏像素运算 | 挪 GPU：WebGL shader（[[YUV格式与WebGL渲染]] §5） |
| 主线程解码 | UI 卡死 | Worker 线程（[[解码Worker与SharedArrayBuffer]]） |
| 每帧 new 内存 | GC 压力、峰值翻倍 | 帧缓冲池复用（[[WASM内存管理]] §2） |

## 4. 为什么这么设计？（背后取舍）

**为什么解码放 Worker 而不是主线程？**
- 1080p 单帧软解 10~30ms，主线程做 = 每帧都掉帧、UI 全卡。Worker 里解码 + 主线程只渲染，是「计算与交互隔离」的标准做法（[[解码Worker与SharedArrayBuffer]] §5 的取舍详述）。

**为什么渲染选 WebGL 而不是 canvas 2D？**
- YUV→RGB 转换是全屏逐像素运算：CPU 做（canvas 2D putImageData）每帧几十 ms；GPU 做（shader）并行 <1ms。**YUV 不是「不支持的格式要转换」而是「GPU 天然喜欢的格式」**（三平面纹理 + 一次矩阵采样）——见 [[YUV格式与WebGL渲染]] §5。

**为什么帧数据「留在 WASM 线性内存内」？**
- 一次 1080p YUV 帧 ≈ 3MB：WASM→JS 拷贝 + JS→纹理拷贝的额外两次拷贝让带宽 ×3。正确姿势：解码器输出固定在 WASM 内存（堆分配的缓冲池），JS 拿「指针 + 尺寸」直接喂 WebGL（`texImage2D` 接受 WASM 堆视图）——**数据不动，引用移动**（[[WASM内存管理]] §3）。

**为什么不用 WebCodecs 解 H265 就好了？**
- WebCodecs 的解码器仍然来自浏览器/平台（同一批专利与支持矩阵约束），H265 不可用时 WebCodecs 也帮不上——它只是「更可控的硬解入口」。软解必须自带解码器实现（WASM ffmpeg），这是**不可外包的一层**。

## 5. 规避 / 实践

| 场景 | 手段 |
| --- | --- |
| 首开慢 | WASM 预载/预编译（Service Worker 缓存 + instantiateStreaming） |
| 帧率不稳 | 解码入 Worker、帧缓冲池、SIMD 开启 |
| 移动端跑不动 | 降档 720p/480p + 考虑 hvc 裁剪解码器（去掉扩展特性） |
| 内存峰值 | 帧池固定 + 线性内存预分配（[[WASM内存管理]]） |
| 跨域隔离报错 | SAB 需 COOP/COEP 响应头（部署清单项） |

## 6. 面试速记

> **30 秒版**："WASM 软解管线就是播放器五层里把 decode 层换成 ffmpeg 编译的 WASM：拉流复用、JS demux 出 NALU、Worker 里 WASM 解码出 YUV、帧留线性内存只传指针零拷贝、WebGL 三纹理 shader 转 RGB 上屏、WebAudio 时钟做同步。为什么：MSE 不放行 H265 是专利问题，WebCodecs 也救不了因为它用的还是平台解码器。实测 H265 软解比 H264 慢 35%，桌面 1080p 有 3.5 倍实时余量、移动端要降档。三个性能要点：解码出主线程、帧不拷贝、YUV 转 RGB 挪 GPU。"

## 相关笔记

- [[硬解与软解的选型]] —— 本管线的选型入口（决策链最后一环）
- [[解码Worker与SharedArrayBuffer]] —— ③④段线程模型的完整取舍
- [[YUV格式与WebGL渲染]] —— ⑤段渲染的完整实现与实测
- [[WASM内存管理]] —— 线性内存/帧池/峰值的实测
- [[播放器架构分层]] —— 五层架构里本管线替换了哪层

*本文档基于本库音视频系列实测（FFmpeg 9.0 / headless Chrome 154）、Emscripten 工具链文档与工业 WASM 播放器实践整理。*
