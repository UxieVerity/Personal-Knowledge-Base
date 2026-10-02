# WebGL 渲染、画布合成与滤镜管线

> **结论：WebGL 是把「渲染」从 CPU 搬到 GPU 的技术——用 GLSL 着色器（GPU 上并行的迷你程序）替代 JS 逐像素循环。** 视频/图片滤镜必须用 WebGL 的根本原因：**Canvas 2D 的 `getImageData` 是 CPU 串行逐像素处理（O(N)），而 WebGL 片段着色器让 GPU 对每个像素并行执行（实测同图灰度滤镜：Canvas 2D 4.61ms vs WebGL 0.01ms，**461×**；headless 软件渲染下也有 2~7×）。** 画布合成（Canvas Composition）= 把多个图层（视频帧、字幕、特效、UI）按顺序绘制/混合到目标画布，是视频编辑器（时间轴/转场/滤镜）的核心。**岗位4 面试要点：能讲清「GPU 渲染管线 → 着色器 → 滤镜为什么用 WebGL 而不用 Canvas 2D 的 getImageData → 画布合成的分层思路 → YUV 直通 GPU（播放器实战）」。** ⚠️ **注意：WebGL 始终要画在 `<canvas>` 元素上（绕不开），"不用 Canvas 2D"指不用它的逐像素 API，不是不用 canvas 元素（见 §4.4）。**
>
> 可运行验证：[[WebGL滤镜vsCanvas2D-demo.html]]（可交互：同图同滤镜，Canvas 2D vs WebGL 对比效果与耗时，真实 GPU 下 461×）；[[WebGLvsCanvas2D-验证脚本.cjs]]（Chrome CDP 自动化测多滤镜耗时）

---

## 1. 背景：为什么渲染要上 GPU

浏览器里做像素级处理有两条路：

| 方案 | 原理 | 性能特征 | 适合 |
| ---- | ---- | -------- | ---- |
| **Canvas 2D `getImageData`** | JS 循环遍历每个像素，CPU 串行计算 | O(N)，像素越多越慢 | 小图、低频、简单处理 |
| **WebGL（GPU）** | 像素数据传 GPU，片段着色器**并行**处理所有像素 | 高度并行，像素多反而摊薄 | 大图、视频帧、实时滤镜 |
| **CSS filter** | 浏览器内置 GPU 加速的滤镜（`filter: grayscale()`） | 快，但**不可编程**（固定效果） | 简单滤镜，无需交互 |

- **CPU 是"少数强大的核"**：适合逻辑复杂、分支多的任务；但逐像素处理上百万像素时，串行循环是瓶颈。
- **GPU 是"成千上万个弱核"**：每个像素一个线程并行算，**吞吐量碾压 CPU**——这正是图像/视频处理的形态（像素间天然独立，可并行）。
- **CSS filter 的局限**：浏览器预置的滤镜（灰度/模糊/色调）够用但**不可编程**——你想做"只有左半屏模糊""根据时间变化的特效"就必须用 WebGL 写自定义着色器。

## 2. 核心机制：GPU 渲染管线（OpenGL/WebGL 的骨架）

### 2.0 OpenGL 是什么（谱系澄清）

> **OpenGL 是"老牌 GPU 渲染规范"，WebGL 是它在浏览器里的移植版，WebGPU 是新一代"去 OpenGL 化"的现代规范。** 面试常把这三者混着问，先理清谱系：

```
OpenGL（1992，桌面/工作站，C 语言 API，跨平台 GPU 标准）
 └─ OpenGL ES（2003，嵌入式/移动端精简版，去掉桌面遗留的冗余 API）
     └─ WebGL 1（2011，浏览器封装 OpenGL ES 2.0）
     └─ WebGL 2（2017，浏览器封装 OpenGL ES 3.0，新增 VAO/多渲染目标等）
WebGPU（2023，浏览器新一代 GPU API，基于现代图形 API：Vulkan/D3D12/Metal，与 OpenGL 无关）
```

| 概念 | 是什么 | 面向 | 状态 |
| ---- | ------ | ---- | ---- |
| **OpenGL** | 老牌**跨平台 GPU 渲染规范**（Khronos 组织维护），C API | 桌面/工作站/游戏 | 仍是图形学工业标准 |
| **OpenGL ES** | OpenGL 的**嵌入式/移动精简版**（ES = Embedded Systems） | 手机/嵌入式/浏览器 | 移动端主流 |
| **WebGL 1** | 浏览器里封装 **OpenGL ES 2.0**（2011） | 浏览器 JS | 兼容性最好，最老 |
| **WebGL 2** | 浏览器里封装 **OpenGL ES 3.0**（2017） | 浏览器 JS | 现代浏览器基本都支持 |
| **WebGPU** | 浏览器里的**新一代 GPU API**（基于 Vulkan/D3D12/Metal） | 浏览器 JS | 新，Chrome 113+ 可用 |

- **核心认知**：WebGL/WebGL2 本质是 **"OpenGL ES 的 JS 绑定"**——API 设计和 GLSL 着色器语言都继承自 OpenGL 家族。所以面试说"WebGL 基于 OpenGL ES 2.0/3.0"就是准确的。
- **WebGPU 是另起炉灶**：不再基于 OpenGL，而是吸收 **Vulkan/D3D12/Metal** 的现代设计（显式 GPU 控制、计算着色器、无全局状态），是浏览器的"次世代" GPU API。
- **OpenGL 本尊在浏览器里看不到**（浏览器只暴露 WebGL/WebGPU），但理解 OpenGL 的概念（管线、着色器、纹理）能直接迁移到 WebGL——它们共享同一套心智模型。

### 2.1 核心机制：GPU 渲染管线

> 面试常问"WebGL 是怎么把图渲染出来的"，答案就是这条固定管线（Pipeline）——**GPU 不是"你画什么出什么"，而是数据按固定阶段流过**：

```
顶点数据 → 顶点着色器 → 图元装配 → 光栅化 → 片段着色器 → 测试与混合 → 帧缓冲（屏幕）
  (坐标)     (变换位置)     (连成三角形)  (生成像素)   (给像素上色)   (透明/深度)   (输出)
```

| 阶段 | 干什么 | 谁执行 | 你能编程吗 |
| ---- | ------ | ------ | ---------- |
| **顶点着色器** | 处理每个顶点（位置变换），如把 3D 坐标投影到屏幕 | GPU | ✅ 可写 GLSL |
| 图元装配 | 把顶点连成三角形/线段 | GPU 固定 | ❌ |
| 光栅化 | 把三角形变成像素（片元），决定"哪些像素被覆盖" | GPU 固定 | ❌ |
| **片段着色器** | 给每个像素上色——**滤镜就在这里做** | GPU | ✅ 可写 GLSL（最关键） |
| 测试与混合 | 深度测试、透明度混合（alpha blend） | GPU 固定 | 混合可配 |

- **片段着色器（Fragment Shader）是滤镜的心脏**：它对**每一个被三角形覆盖的像素**执行一次，输入是纹理坐标 + 采样到的颜色，输出是该像素的最终颜色。**所有像素的着色器代码是同一份，但并行跑在成千上万个 GPU 核上**——这就是 461× 的来源。
- WebGL 是 OpenGL ES 的浏览器封装：**API 层面**你写 JS（`gl.drawArrays` 等），**计算层面**你写 GLSL 字符串，编译后上传 GPU。

## 3. 实测：Canvas 2D vs WebGL 滤镜

> 环境：本机 Chrome（真实 GPU）+ Node 26 起服务。同一张 480×320 测试图，同一种滤镜，两种实现，10 帧平均耗时。

### 3.1 真实 GPU（demo 页实测）

```
[预览面板实测] 灰度 | Canvas 2D 4.61 ms | WebGL 0.01 ms | 461.0× 🚀
```

- **461 倍**：Canvas 2D 逐像素 `for` 循环（15 万像素 × 3 通道）在 CPU 上跑；WebGL 让 GPU 一次性并行处理所有像素。
- 这个差距**随图片尺寸放大**：480×320 是 15 万像素，4K 是 830 万像素——Canvas 2D 线性变慢，WebGL 几乎不变（并行摊薄）。

### 3.2 headless 软件渲染（验证脚本实测）

```
滤镜      | Canvas 2D 耗时 | WebGL 耗时 | 加速比
灰度     | 0.68 ms      | 0.24 ms    | 3×
反转     | 0.64 ms      | 0.39 ms    | 2×
亮度     | 1.14 ms      | 0.16 ms    | 7×
```

- headless Chrome 用 **SwiftShader（CPU 模拟 GPU）**，并行优势被稀释到 2~7×——**印证了 WebGL 的优势依赖真实 GPU 硬件**。
- 这也是面试能讲的细节：**测试 WebGL 性能不能只看 headless**，真实 GPU 才是目标环境。

### 3.3 两种实现的代码对比（面试手写题级）

```js
// Canvas 2D：CPU 逐像素（O(N)，串行）
function grayscale2D(ctx, w, h) {
  const data = ctx.getImageData(0, 0, w, h).data;
  for (let i = 0; i < data.length; i += 4) {
    const gray = 0.299*data[i] + 0.587*data[i+1] + 0.114*data[i+2];
    data[i] = data[i+1] = data[i+2] = gray;   // 15 万像素循环 15 万次
  }
  ctx.putImageData(imageData, 0, 0);
}
```

```glsl
// WebGL 片段着色器：GPU 对每个像素并行执行同一份代码
precision mediump float;
varying vec2 v_uv;                 // 当前像素的纹理坐标
uniform sampler2D u_tex;           // 输入纹理（图像）
void main() {
  vec4 c = texture2D(u_tex, v_uv); // 采样当前像素颜色
  float gray = dot(c.rgb, vec3(0.299, 0.587, 0.114));  // 亮度公式
  gl_FragColor = vec4(vec3(gray), 1.0);  // 输出灰度
}
```

**关键差异**：Canvas 2D 是"**循环**"（代码跑 N 次，CPU 串行）；WebGL 是"**着色器**"（代码写一次，GPU 对 N 个像素同时跑）。

## 4. 画布合成（Canvas Composition）：视频编辑器的核心

> 岗位4 面试重点。**画布合成 = 把多个图层按顺序绘制到同一个目标画布**，是视频剪辑（时间轴/转场/滤镜/字幕）的渲染基础。

### 4.1 基本思路：图层栈（Layer Stack）

视频编辑器渲染一帧，本质是**从底到顶依次绘制多个图层**：

```
┌─────────────────────────────┐
│  UI 层（按钮/进度条，DOM/Canvas）│  ← 最顶层
├─────────────────────────────┤
│  字幕/贴纸层                  │
├─────────────────────────────┤
│  特效层（转场/滤镜叠加）        │
├─────────────────────────────┤
│  视频帧层（解码后的当前帧）      │
├─────────────────────────────┤
│  背景层（黑场/图片）           │  ← 最底层
└─────────────────────────────┘
```

```js
// 合成一帧：从底到顶依次 drawImage
function composeFrame(ctx, layers) {
  ctx.clearRect(0, 0, W, H);
  ctx.drawImage(layers.background, 0, 0);   // 1. 背景
  ctx.drawImage(layers.videoFrame, 0, 0);   // 2. 视频帧（解码输出）
  ctx.globalAlpha = 0.8;
  ctx.drawImage(layers.subtitleCanvas, 0, 0); // 3. 字幕（半透明）
  ctx.globalAlpha = 1.0;
  ctx.drawImage(layers.effectCanvas, 0, 0);  // 4. 特效层
  // 5. UI 层由 DOM 覆盖，不画进视频
}
```

### 4.2 两种合成架构（面试可讲）

| 架构 | 做法 | 优点 | 缺点 |
| ---- | ---- | ---- | ---- |
| **Canvas 2D 合成** | 多层 `drawImage` + `globalCompositeOperation` 混合 | 简单、直观 | 每层都是 CPU 光栅化，图层多时慢 |
| **WebGL 合成** | 每层 = 一个纹理，片段着色器里采样多个纹理混合 | GPU 并行，**滤镜/转场天然在着色器里** | 复杂、需要管理纹理/着色器 |

- **主流视频编辑器（剪映 Web 版、CapCut Web、字节的各类剪辑工具）都用 WebGL 合成**：把视频帧、字幕、滤镜作为纹理传入 GPU，一个片段着色器同时做"混合 + 滤镜 + 转场"。
- **转场本质**：两帧（A/B）在着色器里按时间比例混合——如淡入淡出 = `mix(A, B, t)`，滑动转场 = 按 t 偏移 UV 坐标。**转场/滤镜都是着色器数学，不是"画两张图"**。

### 4.3 和播放器的关系（你的强项衔接）

> 你已经做过**自研播放引擎**（解码 + 渲染播放），视频编辑是它的"上游/生产侧"延伸——面试可以这样讲：

```
播放器（你已做）：网络 → 解封装 → 解码(H265/WASM) → 渲染帧 → 播放
编辑器（岗位4）：解码帧 → 滤镜(WebGL) → 转场合成(WebGL) → 字幕 → 编码导出
```

- **共同底座**：解码器（你的 WASM 软解 H265 直接复用）、帧缓冲管理、渲染循环（rAF）。
- **新增能力**：滤镜/转场（着色器）、时间轴数据模型、多轨合成、导出编码（MediaRecorder/WebCodecs）。

### 4.4 YUV 直通 GPU 渲染管线（生产级 · 你的实战）

> **概念澄清**：WebGL **必须**画在 `<canvas>` 上，**绕不开 canvas 元素**——`getContext('webgl')` 拿到的 context 就绑定在 canvas 上，最终输出也是靠浏览器把这块 canvas 合成到屏幕。笔记前面说的"不用 Canvas 2D"指的是**不用 Canvas 2D 的 `getImageData` 逐像素 API**（CPU 处理），**不是不用 canvas 元素**。WASM 播放器流程 `WASM 解码 → YUV → WebGL → canvas` **完全正确，是生产级标准做法**。

生产级播放器（你的 H265 软解）的标准渲染管线：

```
WASM (H265 解码, CPU)
   │ 产出 YUV (I420) 帧
   ▼
上传 WebGL 纹理（Y/U/V 三个平面 → 3 张纹理，或打包 1 张）
   ▼
片段着色器：YUV → RGB 色彩空间转换（BT.601/BT.709 矩阵）+ 滤镜
   ▼
canvas 输出（GPU 合成到屏幕）
```

- **关键优化：YUV 不在 CPU 转 RGB**。而是把 YUV 直接传 GPU，**在着色器里做色彩转换**（`r = y + 1.402*(v-128)` 等矩阵运算）——省掉 CPU 端一次全图转换 + 一次内存拷贝，是 1080p/4K 实时播放的性能关键。
- **I420 处理**：Y/U/V 三个平面拆成 **3 张纹理**，着色器 `texture2D` 采样 3 次再按矩阵组合；或打包成一张纹理减少纹理切换。
- **分工理想**：解码（WASM/CPU）管逻辑密集型；像素处理（着色器/GPU）管数据并行——各干各擅长的。
- **对比**：如果 YUV 在 CPU 转 RGB 再用 `putImageData` 上屏，4K 每帧 830 万像素 × 转换，CPU 直接打满；GPU 直通则几乎零额外开销。

> **面试怎么讲**："我的播放器是 WASM 解 H265 出 YUV，然后直接把 YUV 传 WebGL 纹理，在片段着色器里做 YUV→RGB 转换再上 canvas——不在 CPU 转，省内存拷贝，4K 也能实时。WebGL 始终需要一个 canvas 当输出表面，我用的是 `<canvas>` + `getContext('webgl')`，不是 Canvas 2D 的逐像素 API。"

## 5. 深入：为什么这样设计？

### 5.1 为什么滤镜"必须"用 WebGL 而不是 Canvas 2D

不是"必须"，是**规模决定**：
- 处理 100×100 小图，Canvas 2D 完全够（几毫秒）。
- 处理 1080p 视频帧（207 万像素/帧），Canvas 2D 每帧几十毫秒 → **24fps 就卡死**（每帧预算 41ms，光滤镜就占满）；WebGL 亚毫秒完成，留给解码/合成充足预算。
- **实时性是分水岭**：视频编辑/直播滤镜要求 30-60fps 实时，只有 GPU 并行扛得住。这就是"为什么滤镜用着色器而不是 Canvas 2D"的完整答案。

### 5.2 为什么着色器是"数据并行"而不是"循环"

GPU 的架构（SIMT，单指令多线程）决定了它**擅长"对大量数据做同样的简单计算"**，不擅长"复杂的条件分支/递归"。着色器模型正是为此设计：
- **每个像素一个线程**，天然数据并行。
- 着色器**不能访问相邻像素**（除非显式采样），所以它天然适合"逐像素独立变换"（滤镜）——这既是约束（做不了需要邻域的算法如高斯模糊要多次采样），也是优势（并行无竞争）。
- 这就是为什么**滤镜（逐像素独立）是着色器的主场**，而复杂的 AI 分割等需要多次 pass。

### 5.3 为什么合成要"分层"而不是"画一张"

- **可编辑性**：分层后每一层可独立修改（换字幕、调滤镜、改转场），不用重画整帧——这是"非破坏性编辑"的基础。
- **性能**：只重绘变化的层，静止层缓存（off-screen canvas 复用）。
- **WebGL 里分层 = 多纹理**：GPU 天然支持一次采样多个纹理混合，分层成本极低。

### 5.4 WebGL 1 vs WebGL 2 vs WebGPU（演进与选型）

> **一句话：WebGL 1 是"能用的老 API"，WebGL 2 是"补全功能的主流"，WebGPU 是"次世代但生态未熟"。** 你的播放器/编辑器现在用 WebGL 1/2 完全够，WebGPU 是趋势但不必急着迁移。

| 维度 | WebGL 1 | WebGL 2 | WebGPU |
| ---- | ------- | ------- | ------ |
| 底层规范 | OpenGL ES 2.0（2011） | OpenGL ES 3.0（2017） | **Vulkan/D3D12/Metal**（2023，与 OpenGL 无关） |
| 着色器语言 | GLSL ES 1.0 | GLSL ES 3.0 | **WGSL**（全新语言） |
| 顶点缓冲 | 需手动 `vertexAttribPointer` | **VAO（顶点数组对象）** 内置 | 更现代的绑定组模型 |
| 多渲染目标（MRT） | ❌ | ✅（一次渲染多张纹理） | ✅ |
| 实例化绘制 | 扩展 | ✅ 内置 | ✅ |
| 纹理格式 | 有限（RGB/RGBA/深度） | 更多（浮点、半浮点、整数） | 极全（含压缩纹理原生） |
| 计算着色器（GPU 通用计算） | ❌ | ❌（仅 WebGL2 扩展可近似） | ✅ **第一等公民** |
| 状态管理 | 全局状态（`gl.enable` 等） | 同左（继承） | **显式管线对象**（无全局状态） |
| 兼容性 | 全平台（包括老设备） | 现代浏览器基本都支持 | Chrome 113+/Edge/Firefox 部分，Safari 刚起步 |
| 性能 | 低（CPU 校验多、状态切换贵） | 中（比 WebGL1 好但仍受 OpenGL 模式限制） | **高**（接近原生，驱动开销小） |
| 生态 | 最成熟（three.js 老版本） | 主流（three.js r118+ 默认） | 新（three.js WebGPURenderer 实验性） |

**对你（音视频/播放器）的意义：**

- **WebGL 1 完全够渲染 YUV 视频帧**：纹理采样 + 片段着色器 + 全屏三角形——你的播放器现在用 WebGL 1 就很稳（兼容性最好，老设备也能播）。
- **WebGL 2 的增益**：VAO 让顶点设置更简洁、浮点纹理、MRT（一次渲染多张特效层）——做视频编辑器时值得升级，**代码迁移成本低**（GLSL ES 3.0 改动小）。
- **WebGPU 的价值（未来）**：
  - **计算着色器**：把 YUV→RGB 转换、甚至**部分解码后处理**（去隔行、降噪）在 GPU 上跑，比 WebGL 的"渲染管线硬凑"高效；
  - **更低驱动开销**：大量小纹理/频繁状态切换的场景（视频帧上传）性能更好；
  - **但生态未熟**：three.js 的 WebGPU 渲染器还是实验性，Safari 支持差——**生产项目现在别上，先掌握概念等生态**。

> **面试话术**："WebGL 1 基于 OpenGL ES 2.0、WebGL 2 基于 ES 3.0 加了 VAO/浮点纹理/MRT；WebGPU 是全新的，基于 Vulkan/D3D12/Metal，有计算着色器和显式管线。我的播放器用 WebGL 1 渲染 YUV 就够稳（兼容性最好），做编辑器会升 WebGL 2 用 VAO/MRT；WebGPU 是趋势，等 Safari 和生态成熟再迁移。"

## 6. 规避 / 实践

| 场景 | 选型 | 原因 |
| ---- | ---- | ---- |
| 简单滤镜（灰度/模糊/色调），无需交互 | **CSS filter** | 浏览器内置 GPU 加速，一行搞定 |
| 小图低频处理 | Canvas 2D `getImageData` | 简单直接，无需 GPU 管线 |
| 大图/视频帧/实时滤镜 | **WebGL 片段着色器** | GPU 并行，实测快 2~3 个数量级 |
| 视频编辑器合成 | **WebGL 多纹理合成** | 滤镜/转场天然在着色器，图层混合高效 |
| 需要邻域算法（高斯模糊、边缘检测） | WebGL **多次 pass**（FBO） | 一次采样取不到邻域，分多趟渲染 |

```js
// WebGL 滤镜最小骨架（面试手写级别）
const gl = canvas.getContext('webgl');
// 1. 编译着色器（vs: 全屏三角形；fs: 采样纹理 + 灰度）
// 2. 上传顶点 + 纹理
gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
// 3. 设置 uniform（滤镜类型）
gl.uniform1i(gl.getUniformLocation(program, 'u_filter'), 1);
// 4. 绘制 —— GPU 并行处理所有像素
gl.drawArrays(gl.TRIANGLES, 0, 3);
```

```js
// 转场 = 两纹理按时间混合（片段着色器片段）
// uniform sampler2D u_frameA;  // 上一段视频
// uniform sampler2D u_frameB;  // 下一段视频
// uniform float u_t;           // 0→1 过渡进度
// vec4 color = mix(texture2D(u_frameA, v_uv), texture2D(u_frameB, v_uv), u_t);
```

## 7. 面试速记

> **30 秒版**："WebGL 是浏览器里的 GPU 渲染 API，核心是**着色器**——顶点着色器处理坐标，片段着色器给每个像素上色。**滤镜必须用 WebGL 的原因**：Canvas 2D 的 getImageData 是 CPU 逐像素循环（O(N) 串行），而片段着色器让 GPU 对每个像素并行执行。实测同图灰度滤镜 Canvas 2D 4.61ms vs WebGL 0.01ms，**461 倍**，而且图越大差距越大——视频帧 200 万像素，Canvas 2D 一帧就几十毫秒扛不住 24fps，WebGL 亚毫秒。画布合成就是分层绘制：背景→视频帧→字幕→特效→UI，视频编辑器用 WebGL 把每层当纹理，一个着色器同时做混合+滤镜+转场（转场本质是 mix(A,B,t)）。"
>
> **追问版**："headless 用 SwiftShader 软件渲染，GPU 优势被稀释到 2~7×，所以测 WebGL 性能必须看真实 GPU。高斯模糊这类需要邻域像素的算法，着色器一次采样拿不到邻居，要做**多次 pass**（FBO 中间缓冲）。CSS filter 是内置的 GPU 滤镜但不可编程，自定义效果必须 WebGL。"
>
> **谱系追问版**："OpenGL 是 1992 年的跨平台 GPU 渲染规范（C API），OpenGL ES 是它的移动/嵌入式精简版，**WebGL 1 = 浏览器封装 OpenGL ES 2.0，WebGL 2 = 封装 ES 3.0**（加了 VAO/浮点纹理/MRT）。WebGPU 和 OpenGL 无关，基于 Vulkan/D3D12/Metal，是次世代——有计算着色器、显式管线、驱动开销低，但生态未熟（Safari 差、three.js 还实验性）。**选型：播放器渲染 YUV 用 WebGL 1 最稳（兼容性最好），编辑器升 WebGL 2，WebGPU 等生态成熟再说。**"

## 相关笔记

- [[Update Rendering 阶段详解]] —— rAF 里做渲染循环（合成/绘制时机）
- [[浏览器事件循环(EventLoop)]] —— rAF 调度与帧预算（每帧 16.7ms 内完成解码+滤镜+合成）
- [[从浏览器输入网址到页面完整展示全过程]] —— GPU 合成（compositor）在渲染链末端的作用
- [[原型与原型链、继承]] —— WebGL API 的对象模型（同属 JS 对象体系）

*本文档基于 WebGL/OpenGL ES 规范、MDN WebGL 文档及本机 Chrome（真实 GPU + headless）实测整理。demo 与验证脚本位于同目录。*
