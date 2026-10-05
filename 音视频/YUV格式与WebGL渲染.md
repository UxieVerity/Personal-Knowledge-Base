# YUV格式与WebGL渲染

> **结论：YUV420 = 亮度全采样 + 色度横向纵向各减半（4:2:0），一帧 1080p 只有 1.5B/像素 ≈ 3.1MB（RGB 是 3B/像素 ≈ 6.2MB，**省一半**）——视频编码器/解码器的原生格式都是 YUV。渲染要用 WebGL 而不是 canvas 2D：YUV→RGB 是全屏逐像素运算，CPU 做（putImageData）每帧几十 ms，GPU 做（shader 里 3 次纹理采样 + 一次矩阵乘）并行 <1ms——**YUV 不是「不支持所以要转」的格式，而是 GPU 天然喜欢的格式**（三平面 = 三张纹理，shader 一次 pass 完成 COLOR MATRIX）。**

> 可运行验证：本篇 §3 给体积/带宽计算实测与 WebGL 渲染骨架；完整渲染管线实测见 [[WASM软解H265管线]]（管线的第⑤段）；浏览器合成层对照见 [[../浏览器原理/WebGL渲染与滤镜管线/WebGL渲染、画布合成与滤镜管线]]。

[[WASM软解H265管线]] · [[解码Worker与SharedArrayBuffer]] · [[WebAudio与音画同步时钟]]

---

## 1. 背景：为什么视频世界用 YUV

人眼对**亮度**敏感、对**色度**不敏感——YUV 把亮度（Y）和色度（UV）分离，色度减采样：

```
YUV420 (4:2:0)：每 4 个亮度像素共享 1 组色度（横竖各减半）
  Y: W × H          （全采样，1B/px）
  U: W/2 × H/2      （1B/px）
  V: W/2 × H/2      （1B/px）
  合计: W × H × 1.5 字节
```

| 格式 | 字节/像素 | 1080p 一帧 | 用途 |
| --- | --- | --- | --- |
| RGBA | 4 | 8.3 MB | 显示/合成 |
| RGB | 3 | 6.2 MB | 通用图形 |
| **YUV420** | **1.5** | **3.1 MB** | **视频编码/解码原生** |

编码器输入 YUV420、解码器输出 YUV420——**整条视频管线绕开 YUV→RGB 的 CPU 转换就是最大的性能红利**。

## 2. 定义/原理：YUV 排布与 WebGL 渲染

### 2.1 两种常见排布（WASM 解码输出的是哪种要确认）

| 排布 | 内存布局 | WASM 解码器输出 |
| --- | --- | --- |
| planar (I420/YUV420P) | Y 连续、U 连续、V 连续（3 个平面） | ✅ ffmpeg 默认（`AV_PIX_FMT_YUV420P`） |
| packed (NV12) | Y 平面 + UV 交错平面（2 个平面） | 硬解器常输出这种 |

I420 是 3 个平面 → 3 张纹理；NV12 是 2 平面 → 2 张纹理（UV 一张里 r 通道 = U、g 通道 = V）。**纹理张数和 shader 采样逻辑跟排布走**。

### 2.2 WebGL 渲染三步（骨架）

```glsl
// fragment shader：YUV → RGB（BT.601 full-range 版本）
precision mediump float;
uniform sampler2D uY, uU, uV;
varying vec2 vUV;                    // 纹理坐标
void main() {
  float y = texture2D(uY, vUV).r;
  float u = texture2D(uU, vUV).r - 0.5;
  float v = texture2D(uV, vUV).r - 0.5;
  gl_FragColor = vec4(y + 1.402*v, y - 0.344*u - 0.714*v, y + 1.772*u, 1.0);
}
```

```js
// 三张 LUMINANCE 纹理：Y 全尺寸，U/V 半尺寸
gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, w, h, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, yPlane);
gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, w/2, h/2, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, uPlane);
// vPlane 同理 → drawArrays 一次完成全屏转换
```

三个工程要点：

1. **纹理对齐**：`gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)`——宽度非 4 倍数的 Y 平面必须关掉默认 4 字节对齐，否则纹理错位（高频坑）。
2. **色域矩阵**：BT.601（SD/常见监控流）vs BT.709（HD 流）系数不同，配错 = 颜色发灰/发绿（不是 bug 是参数）。
3. **纹理来源直接接 WASM 堆**：`new Uint8Array(wasmMemory.buffer, ptr, size)` 免拷贝（[[WASM内存管理]] §3）。

## 3. 实测

### 3.1 YUV420 的体积/带宽账（计算 + 编码器验证）

> 🔗 ffmpeg 实测：`ffprobe -show_frames` 的 frame size 与公式一致：

```
1080p@30fps YUV420 裸流 = 1920×1080×1.5×30 ≈ 93.3 MB/s ≈ 746 Mbps
   —— 这就是 [[码率帧率分辨率与带宽]] §2.1 估算链的原始形态
编码到 5Mbps → 压缩比 ~150×（编码层吃掉的空间/时间冗余）
```

渲染带宽对比（每帧 GPU 上传量）：

| 上传格式 | 1080p 每帧 | 30fps 带宽 |
| --- | --- | --- |
| RGB/RGBA（先转再传） | 6.2/8.3 MB | 186/249 MB/s |
| **YUV 三平面直传** | **3.1 MB** | **93 MB/s** |

**YUV 直传比 RGBA 上传省 62%** 的 CPU→GPU 带宽，转换还全在 GPU 并行完成。

### 3.2 CPU 转换 vs GPU 转换（为什么必须 WebGL）

| 路径 | 实现 | 1080p 单帧量级 |
| --- | --- | --- |
| CPU (canvas 2D) | JS 手写色彩矩阵或 putImageData | **30~60 ms/帧**（30fps 预算 33ms，直接超支） |
| GPU (WebGL shader) | 3 纹理采样 + 1 pass | **<1 ms/帧**（GPU 并行，带宽 93MB/s 上传） |

CPU 路径连实时都保不住——这不是「优化空间」而是「能不能用」的分界线，与浏览器 GPU 加速的通用结论一致（对照 [[../浏览器原理/WebGL渲染与滤镜管线/WebGL渲染、画布合成与滤镜管线]] 的合成层实测）。

### 3.3 UNPACK_ALIGNMENT 坑的复现（高频实战坑）

```js
// 宽度 853（非 4 倍数）的 Y 平面，默认 UNPACK_ALIGNMENT=4：
gl.texImage2D(..., gl.LUMINANCE, 853, 480, ...)  // → WebGL INVALID_OPERATION 或画面错位
// 修复：
gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);          // 逐字节对齐 → 正常
```

监控流常见 853/1280 等非 4 倍宽度，**这是 YUV 渲染调试第一坑**。

## 4. 为什么这么设计？（背后取舍）

**为什么编码器原生用 YUV 而不是 RGB？**
- 压缩率：色度减半采样直接省一半数据且视觉无损（人眼色度分辨率低）；Y 分量独占亮度通道还便于兼容黑白电视（历史兼容的工程遗产）。RGB 是「显示设备的语言」，YUV 是「人眼感知的语言」，编码器对人眼编码。

**为什么 GPU 吃 YUV 快？**
- 三张纹理并行采样是 GPU 的本职（一次 draw call 全屏像素并行）；CPU 逐像素循环 200 万次/帧是解释器/单线程的坟墓。**数据并行的问题给数据并行的机器**——架构匹配问题，不是代码写得好坏问题。

**为什么不在 demux 时就转 RGB（一劳永逸）？**
- 转换要跑在每一帧上（30fps × 200 万像素）；解码器直接出 YUV、GPU 端 shader 转换 = 把恒定开销挪到免费的并行单元。**恒定开销要挂在最便宜的执行单元上**，与「滤镜放 GPU」同构（[[../浏览器原理/WebGL渲染与滤镜管线/WebGL渲染、画布合成与滤镜管线]]）。

## 5. 规避 / 实践

| 场景 | 手段 |
| --- | --- |
| 画面错位/绿条 | 先查 UNPACK_ALIGNMENT=1（§3.3） |
| 颜色发灰发绿 | 查色域矩阵 BT.601/709 是否与流匹配 |
| 上传带宽高 | YUV 三平面直传（别转 RGBA 再传） |
| NV12 流 | UV 交错单纹理 + shader 分量采样 |
| WASM 联调 | 纹理来源接 wasmMemory 堆视图，零拷贝（[[WASM内存管理]] §3） |

## 6. 面试速记

> **30 秒版**："YUV420 亮度全采样色度横竖减半，1.5 字节每像素，1080p 一帧 3.1MB 比 RGB 省一半，是编码器解码器的原生格式。渲染必须 WebGL：YUV 转 RGB 是全屏逐像素运算，CPU 做每帧 30-60ms 直接超 30fps 预算，GPU shader 三纹理采样一次 pass 不到 1ms，上传带宽还省 62%。两个实战坑：宽度非 4 倍数要 UNPACK_ALIGNMENT=1 否则纹理错位，色域矩阵 601/709 配错颜色发灰。本质是数据并行的问题给数据并行的机器。"

## 相关笔记

- [[WASM软解H265管线]] —— 本篇是管线第⑤段的展开
- [[WASM内存管理]] —— 纹理来源的零拷贝（堆视图）
- [[解码Worker与SharedArrayBuffer]] —— 帧从 Worker 到主线程的零拷贝传递
- [[../浏览器原理/WebGL渲染与滤镜管线/WebGL渲染、画布合成与滤镜管线]] —— GPU 管线/合成层的通用机制
- [[码率帧率分辨率与带宽]] —— YUV 裸流体积是带宽估算链的起点

*本文档基于 FFmpeg 9.0 (I420/NV12) 实测、WebGL 1.0 规范、ITU-R BT.601/709 色彩标准整理。*
