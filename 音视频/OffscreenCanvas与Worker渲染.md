# OffscreenCanvas 与 Worker 渲染

> **结论：OffscreenCanvas 解决的是「canvas 渲染绑死主线程」的问题——把 2D/WebGL 的绘制表面从 DOM 拆出来，塞进 Worker，让「解码 Worker → 渲染 Worker」全链路脱离主线程。** 但它不是性能银弹：实测本机 1080p YUV 三平面纹理上传+绘制，Worker 内 OffscreenCanvas（12~14ms/帧）与主线程可见 canvas（12~14ms/帧）**同量级**——GPU 干活的速度没变，变的是「谁在等它」。真正收益是：主线程零渲染参与（UI 永不掉帧）+ 解码渲染同 Worker 免跨线程传帧。**本质认知：WebGL 永远需要一个 canvas 当输出表面，OffscreenCanvas 只是把这个「canvas」从 DOM 里解绑**（[[YUV格式与WebGL渲染]] §2 的概念纠偏在这里落地）。

> 可运行验证：本篇 §3 全部为本机实测（headless Chrome 154 + 真实 GPU RTX 3050，CDP 零依赖脚本）；「解码渲染同 Worker 免传帧」的架构位置见 [[WASM软解H265管线]] §4、帧传递的三层通道见 [[解码Worker与SharedArrayBuffer]]。

[[解码Worker与SharedArrayBuffer]] · [[YUV格式与WebGL渲染]] · [[WASM软解H265管线]]

---

## 1. 背景：主线程渲染的三重绑死

普通 `<canvas>` 的渲染能力被 DOM 绑死在三处：

| 绑死点 | 后果 | OffscreenCanvas 的解法 |
| --- | --- | --- |
| 渲染在主线程事件循环里 | draw 前面排着布局/样式/长任务，rAF 掉帧全反映到画面 | 绘制表面搬进 Worker（独立事件循环） |
| canvas 是 DOM 元素 | Worker 里根本没有 DOM，`new Worker` 里拿不到 canvas | `new OffscreenCanvas(w, h)` 纯 JS 对象，Worker 可直接构造 |
| 解码↔渲染跨线程 | WASM 解码在 Worker，每帧 3.1MB 传回主线程再画（见 [[解码Worker与SharedArrayBuffer]] §3.2 的 93MB/s 账） | **解码 + 渲染同一个 Worker**，传递问题直接消失 |

两个 API 入口（用途不同，面试必分清）：

```
① new OffscreenCanvas(w, h)        —— 纯离屏：Worker 里自建画面，用于
                                      合成/缩略图/录制(convertToBlob)，
                                      或者「根本不需要显示」的绘制
② visibleCanvas.transferControlToOffscreen()
                                   —— 占位接管：页面里 <canvas> 只是占位，
                                      真正的绘制表面移交 Worker（transferable，
                                      一次所有权转移），用户看到的还是那个位置
```

## 2. 定义/原理

### 2.1 三条铁律（本机逐条实测，§3.1）

1. **transferControlToOffscreen 是单向门**：移交后再对原 canvas 调 `getContext('2d')` 直接抛 `InvalidStateError`（实测：`Failed to execute 'getContext' ... Cannot`）——主线程从此只能看着，不能画。
2. **Worker 里的 context 类型是独立探测面**：构造器存在 ≠ 每种 context 都能用。Safari 16.4 只给了 2D、Worker 内 WebGL 到 17 才全（§3.4 兼容性），**必须在 Worker 内部 `getContext` 实测返回值**，主线程探测不算数（WebKit bug 183720 的著名事故：主线程有 WebGL、Worker 里没有，Construct 3 全线内容报废）。
3. **它不改变渲染性能本身**：纹理上传/GPU 绘制的耗时由 GPU 和带宽决定，主线程还是 Worker 一样（§3.2 实测同量级）——OffscreenCanvas 优化的是**调度与隔离**，不是渲染速度。

### 2.2 播放器的标准用法：解码渲染同 Worker（多实例的终态）

```js
// 主线程：canvas 只当占位
const oc = document.querySelector('canvas').transferControlToOffscreen();
renderWorker.postMessage({ canvas: oc }, [oc]);        // transfer 所有权

// 渲染 Worker：GL 上下文建在 OffscreenCanvas 上
const gl = msg.canvas.getContext('webgl');
// 解码 Worker 解出 YUV 帧 → SAB 零拷贝/transfer 乒乓递给本 Worker
// 本 Worker 直接 texImage2D → draw → 浏览器自动把这块表面合成到页面占位处
```

对照 [[解码Worker与SharedArrayBuffer]] §3.2 / 模拟面试追问的多路架构：**多路播放的四病根（主线程中转/无背压/每帧分配/context 上限）里，「worker 直连」这一味的终极形态就是渲染 Worker + OffscreenCanvas**——帧数据从解码 Worker 直达渲染 Worker，主线程只剩控制信令。

单路场景还有个更省的形态：**WASM 解码 + OffscreenCanvas 渲染放同一个 Worker**——解码出的 YUV 指针直接喂 WebGL，跨线程传递问题不存在，连 SAB/COOP/COEP 都不用部署（代价：解码忙时该 Worker 的消息循环排队，无多核并行）。

### 2.3 与 ImageBitmap 的配套（Worker 出口）

| API | 作用 | 实测耗时（本机） |
| --- | --- | --- |
| `oc.transferToImageBitmap()` | Worker 内把当前画面快照成 ImageBitmap（快照后画布清空） | 1080p **~2.1ms/帧** |
| `oc.convertToBlob({type,quality})` | Worker 内直接出 PNG/JPEG Blob——截帧/缩略图不必回主线程 | （IO 型，量级 ms） |
| `createImageBitmap(video/canvas)` | 主线程把 video 帧裁剪缩放进 ImageBitmap 递给 Worker | — |

`transferToImageBitmap` 的 2ms 意味着「快照一帧 1080p」对 33ms 帧预算占比 ~6%——截帧墙/缩略图服务可以按需高频做，但别每帧都转（那是无谓的 CPU 拷贝）。

## 3. 实测

> 🔗 环境：headless Chrome 154（`--headless=new`，**未加 --disable-gpu**，能力探测类实验的红线见 [[YUV格式与WebGL渲染]] 头注同源教训）+ Win11 + RTX 3050 Laptop GPU。GL renderer 实测为 `ANGLE (NVIDIA, ... Direct3D11)`——真实 GPU 路径，非 SwiftShader。脚本模式：CDP 零依赖（Node 26 内置 WebSocket），Worker 用 blob URL 内联（`file://` 页面外链 Worker 脚本被静默拦——**worker onmessage 不回、onerror 不触发**，本机踩过的坑）。

### 3.1 能力矩阵快照（主线程 + Worker，逐项实测）

| 探测项 | 主线程 | dedicated Worker |
| --- | --- | --- |
| `typeof OffscreenCanvas` | ✅ function | ✅ function |
| `getContext('2d')` | ✅ | ✅ |
| `getContext('webgl')` | ✅ | ✅ |
| `getContext('webgl2')` | ✅ | ✅ |
| `getContext('webgpu')` | ✅ | ✅（Chrome；Safari 26 才跟上，见 §3.4） |
| `transferToImageBitmap` / `convertToBlob` | ✅ / ✅ | ✅ / ✅ |
| `transferControlToOffscreen` 后原 canvas getContext | — | **❌ InvalidStateError（单向门）** |

**读法**：Chrome 全绿是「2026 年的 Chrome」，不是「跨浏览器可假设」——矩阵在 Safari/Firefox 是逐格补齐的（§3.4），所以生产探测必须「Worker 内 getContext 逐 context 实测」，与 [[WebCodecs与MSE的边界]] 的「能力检测三级走起」同一条纪律。

### 3.2 Worker 化渲染有没有额外开销？（同管线对照实测）

同一套 1080p I420 三平面 LUMINANCE 纹理上传 + draw（每帧 3.1MB 上传，预热 3 帧后计 30 帧均值，多轮取区间）：

| 渲染位置 | 1080p 每帧（上传+draw） | 上传吞吐 |
| --- | --- | --- |
| 主线程可见 `<canvas>` WebGL | 12.0 ~ 14.4 ms | ~230 MB/s |
| **Worker 内 OffscreenCanvas WebGL** | 11.1 ~ 16.1 ms | ~210-270 MB/s |
| Worker 内 `transferToImageBitmap`（出帧快照） | ~2.1 ms | — |

**结论：同量级，Worker 化零额外渲染开销**（波动为机器噪声，非系统性差）。这从机制上就该如此——texImage2D 的成本在 CPU→GPU 拷贝与驱动提交，与调用方在哪个线程无关。**所以「渲染搬 Worker」的理由从来不是更快，而是主线程解绑**：主线程渲染 12ms/帧意味着 30fps 下主线程 36% 时间在给视频打工（rAF 全被挤占），搬走后主线程归零。

（与 [[YUV格式与WebGL渲染]] §3.2 的对照：<1ms 是「纯 GPU 绘制 pass」的耗时，本表 12ms 是「CPU 3.1MB 上传 + draw」全链路——瓶颈在上传带宽，不在 GPU 计算，两表不矛盾。）

### 3.3 为什么这管线上面还差一层（架构定位）

```
解码 Worker(WASM) ──SAB/transfer──▶ 渲染 Worker(OffscreenCanvas+WebGL) ──合成──▶ 页面
        ▲                                                                    │
        └────────────── 主线程只发 play/seek/调参 控制信令 ─────────────────────┘
```

- 单路：解码+渲染合一 Worker（§2.2），最简。
- 多路：N 个解码 Worker + 1 个共享渲染 Worker（GL context 有 ~16 个上限，一 context 管所有路），帧池 + 有界队列背压。
- 何时**不用** OffscreenCanvas：画面就是一整个 `<video>`/MSE 播放（浏览器内部管线全托管）；或低频 2D 绘制（主线程完全够）——**它解的是「高频逐帧渲染 + 主线程要保交互」的组合问题**。

## 4. 兼容性矩阵（2026-10 查证 caniuse / WebKit bug 跟踪）

| 浏览器 | OffscreenCanvas 基础 | Worker 内 WebGL | Worker 内 WebGPU |
| --- | --- | --- | --- |
| Chrome / Edge | ✅ 69+（2018 起） | ✅ 69+ | ✅（随 WebGPU 113+） |
| Firefox | ✅ 105+（2022） | ✅ 105+ | ⚠️ 部分（FF 141+ 逐步） |
| Safari | ⚠️ 16.4+（2023-03）**仅 2D** | ⚠️ **17.0+ 才全**；17.1 Ventura 仍有 OS 级差异（bug 183720） | Safari 26+ |
| iOS WKWebView | 跟随系统 WebKit（iOS 16.4+） | 同上 | iOS 26+ |

**三个著名兼容性坑（面试可讲的血泪史）**：

1. **Safari 16.4「半实现」事故**：只给 2D 不给 Worker WebGL，导致 `typeof OffscreenCanvas !== 'undefined'` 探测通过、实际 Worker 里 `getContext('webgl')` 返回 null——**全行业（Construct 3 等）内容报废**，WebKit 不得不给单一引擎加专属 quirk。教训：**探测必须在 Worker 内对具体 context 做，且拿返回值判 null**。
2. **主线程探测 ≠ Worker 能力**：同一浏览器同一版本，主线程 WebGL context 可用而 Worker 内不可用（Safari 17.1 Ventura 实例）——两个执行环境是独立探测面。
3. **transferControlToOffscreen 单向门**：移交后主线程 `getContext` 抛 InvalidStateError（本机实测复现）——「还想偶尔自己画一下」的方案走不通，占位 canvas 的控制权要一次想清楚。

**兜底链**：Worker 内 getContext 实测可用 → OffscreenCanvas 渲染；不可用 → 帧回主线程、主线程可见 canvas 渲染（退回 [[YUV格式与WebGL渲染]] 的主线程管线）；`transferControlToOffscreen` 不存在 → 占位 canvas 由主线程自己画。**「渲染在不在 Worker」是性能优化，「能不能播」永远不押在它上面**。

## 5. 为什么这么设计？（背后取舍）

**为什么 canvas 要先被 DOM 绑死、再费劲解绑？**
- Canvas 2D/WebGL 1.0 诞生时（2004/2011）Web Worker 尚未普及，绘制表面天然是 DOM 的一部分。OffscreenCanvas（Chrome 69, 2018）是「把图形上下文从 DOM 独立出来」的架构修正——同期 [[WebGPU与渲染管线基础]] 里 WebGPU 的 `canvas` 配置只是「可选输出目标」而非宿主本体，**新一代 API 从设计之初就把「绘制表面」降格为附件**。方向一致：计算与呈现解耦。

**为什么 transferControlToOffscreen 是单向门？**
- 双向可画 = 两个线程并发写同一块 GPU 表面 = 同步灾难。所有权转移（transferable 语义）与 postMessage transfer ArrayBuffer 同一哲学：**默认安全（不共享可变状态），要共享走显式机制**（SAB 或所有权移交）——与 [[解码Worker与SharedArrayBuffer]] §4 的取舍完全同构。

**为什么 Worker 里的 context 要独立探测、不能主线程探完带结论过去？**
- context 的可用性绑定在「全局对象 + GPU 进程连接」上，Worker 是独立的全局对象。WebKit 的半实现把这点变成了真实的兼容性地雷——**能力探测的黄金法则「在哪用在哪测」在 OffscreenCanvas 上有了最贵的反例**。

## 6. 规避 / 实践

| 场景 | 手段 |
| --- | --- |
| 多路播放器主线程卡 | 渲染 Worker + transferControlToOffscreen，主线程只留控制信令 |
| 单路软解播放器 | 解码 + OffscreenCanvas 渲染同 Worker（免 SAB 免 COOP/COEP） |
| Safari 兼容 | Worker 内逐 context 探测拿返回值；2D-only 旧机回退主线程渲染 |
| 截帧/缩略图 | Worker 内 `convertToBlob` 直出 Blob（不回主线程） |
| 调试 Worker 渲染 | CDP 的 worker target 上开 session；`file://` 外链 worker 脚本会被静默拦（用 blob URL） |
| 别押上「能不能播」 | OffscreenCanvas 是优化层，兜底永远是主线程 canvas |

## 7. 面试速记

> **30 秒版**："OffscreenCanvas 把 canvas 绘制表面从 DOM 解绑进 Worker，解决的是「渲染绑死主线程」——注意它不提升渲染速度本身，我实测 1080p YUV 纹理上传+绘制 Worker 内和主线程都是 12 到 14 毫秒同量级，收益是主线程归零、UI 永不掉帧，多路播放「帧不过主线程」的终态就是渲染 Worker 加 OffscreenCanvas。两个用法：new 纯离屏、transferControlToOffscreen 占位接管——后者是单向门，移交后主线程 getContext 直接抛 InvalidStateError，实测复现过。兼容性最大的坑在 Safari：16.4 只给 2D 不给 Worker WebGL，构造器存在但 getContext 返回 null，Construct 3 全线报废，所以探测必须在 Worker 内对具体 context 拿返回值实测，主线程探完不算数。兜底永远是主线程 canvas——渲染在不在 Worker 是优化问题，能不能播不押在它上面。"

## 相关笔记

- [[解码Worker与SharedArrayBuffer]] —— 帧怎么跨线程到这里（三通道对比）
- [[YUV格式与WebGL渲染]] —— GL 管线本体（本篇只管「在哪跑」）
- [[WASM软解H265管线]] —— 解码渲染同 Worker 的架构位置（管线④⑤段合并）
- [[WebGPU与渲染管线基础]] —— 新一代 API 里「绘制表面是附件」的设计
- [[WebCodecs与MSE的边界]] —— 帧（VideoFrame）从哪来

*本文档基于 headless Chrome 154（Win11/RTX 3050，真实 GPU 路径）CDP 实测、W3C HTML 规范 OffscreenCanvas 章、caniuse 2026-10 数据与 WebKit bug 183720/253431 事故记录整理。*
