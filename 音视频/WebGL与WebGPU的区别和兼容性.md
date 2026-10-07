# WebGL与WebGPU的区别和兼容性

> **结论：WebGL 和 WebGPU 是两代 API 架构，不是「快慢版的同一个东西」——WebGL 继承 OpenGL ES 2.0/3.0 的全局状态机 + 即时提交（2005 年代移动 API 的浏览器封装），WebGPU 对标 Vulkan/D3D12/Metal 的显式架构（管线预编译对象、bind group 显式绑定、命令录制批量提交），并新增 compute shader。兼容性口径（2026-10）：WebGL 2 全局 ~96% 全覆盖，WebGPU ~87% 且 Firefox/Safari 落地刚一年（Chrome 113 起全量 / FF 141 起 Win / Safari 26 起）——所以上屏渲染 WebGPU 仍当渐进增强、WebGL 兜底；WebGPU 的不可替代增量是 compute（AI 超分/插帧/3DGS 排序）。** 播放器视角一句话：YUV 上屏用 WebGL 就够，AI 实时处理必须 WebGPU——本篇把 [[WebGPU与渲染管线基础]]（概念篇）与 [[YUV格式与WebGL渲染]]（实战篇）拉通成选型表。

> 可运行验证：本机 adapter 实测复用 [[WebGPU与渲染管线基础]] §3 探针（`navigator.gpu` ✅ / 20 项 features / shader-f16 / compute 1024）；WebGL 渲染性能实测见 [[YUV格式与WebGL渲染]] §3 与 [[WebGL渲染、画布合成与滤镜管线]] §3（真实 GPU 461× vs headless 2~7× 的测量方法论）。

[[WebGPU与渲染管线基础]] · [[YUV格式与WebGL渲染]] · [[WebGL渲染、画布合成与滤镜管线]]

---

## 1. 背景：谱系先理清（WebGL 从哪来、WebGPU 为什么另起炉灶）

```
OpenGL（1992，桌面 C API，Khronos）
 └─ OpenGL ES（2003，嵌入式/移动精简版）
     ├─ WebGL 1（2011）= 浏览器封装 OpenGL ES 2.0
     └─ WebGL 2（2017）= 浏览器封装 OpenGL ES 3.0（VAO/浮点纹理/MRT）

WebGPU（2023 首发于 Chrome）—— 与 OpenGL 无关
    原型 = Vulkan / D3D12 / Metal（显式、队列化、可校验的现代 GPU API）
    着色器 = WGSL（新语言，可静态校验，非 GLSL）
```

核心认知：**WebGL 是「旧架构的 JS 绑定」，WebGPU 是「新架构的 Web 投影」**。浏览器做 WebGL 时每次都在把「全局状态机假象」翻译到真实的队列化硬件上；WebGPU 直接暴露队列模型，把翻译开销砍掉。这与 WASM 重构原生二进制同一逻辑——**平台级新标准都选择「显式、可校验的安全子集」路线**（[[WebGPU与渲染管线基础]] §5）。

## 2. 定义/原理：架构差异五维度

> 概念层的四件套（管线对象 / bind group / command encoder / compute）在 [[WebGPU与渲染管线基础]] §2 已有代码级展开，本篇收成对比表并补音视频视角。

| 维度 | WebGL (1/2) | WebGPU | 对音视频渲染的实际影响 |
| --- | --- | --- | --- |
| 状态管理 | 全局状态机（`bindTexture` 改的是「当前状态」，切换贵） | 管线对象不可变 + bind group 一次声明 | **多路播放器**：N 路视频各自「三纹理 + uniforms」，WebGPU 换一路 = 换一个 bind group，比 WebGL 逐个 bind 便宜 |
| 命令提交 | 即时（`gl.draw*` 直达驱动） | CommandBuffer 录制 → `queue.submit` 批量 | 高帧率/多轨合成：CPU 侧录制极轻，压力在 GPU 队列排队 |
| 着色器 | GLSL（运行时编译、方言碎片化） | WGSL（编译进管线对象，可缓存） | 管线启动快 → 播放器冷启动（首帧）少一分等待 |
| 通用计算 | ❌（fragment shader 硬凑「全屏三角形」） | ✅ compute shader 一等公民 | **AI 超分/插帧/降噪/3DGS 深度排序——WebGL 表达不了，唯一正解** |
| 错误模型 | 返回 null/`getError` 轮询（错误滞后） | 创建期同步验证（`pushErrorScope`/`uncapturederror`） | 配置错在启动时炸（好排）而不是渲染中静默花屏 |

**一次 draw 的代码形态对比**（YUV 三纹理渲染的 WebGPU 版骨架，对照 [[YUV格式与WebGL渲染]] §2.2 的 GLSL 版）：

```js
// WebGPU：一次声明，反复使用
const pipeline = device.createRenderPipeline({ /* vertex+fragment+布局 一次性预编译 */ });
const bindGroup = device.createBindGroup({ layout, entries: [
  { binding: 0, resource: sampler },
  { binding: 1, resource: yTex.createView() },
  { binding: 2, resource: uTex.createView() },
  { binding: 3, resource: vTex.createView() },
]});
// 每帧：
const enc = device.createCommandEncoder();
const pass = enc.beginRenderPass({ colorAttachments: [{ view: context.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: {r:0,g:0,b:0,a:1} }] });
pass.setPipeline(pipeline); pass.setBindGroup(0, bindGroup); pass.draw(3); pass.end();
device.queue.submit([enc.finish()]);
// 视频帧入口：device.queue.copyExternalImageToTexture({ source: videoFrame }, { texture }, size)
// —— VideoFrame 直接进纹理，与 WebCodecs 对接是显式一等能力
```

WGSL 片段着色器里 YUV→RGB 与 GLSL 数学完全一致（1.402/1.772/0.344/0.714 那套系数，推导见 [[YUV格式与WebGL渲染]] §2.3）——**换 API 不换色彩科学**。

## 3. 实测 / 兼容性数据

### 3.1 本机实测快照（headless Chrome 154 / Win11 / RTX 3050）

| 探测项 | 实测值 |
| --- | --- |
| `'gpu' in navigator`（页面上下文） | ✅ true |
| `requestAdapter()` | ✅ 成功，20 项 features |
| 关键 features | `shader-f16`、`subgroups`、`timestamp-query`、`texture-compression-bc`、`float32-filterable` |
| limits 抽样 | maxTextureDimension2D=16384、maxComputeWorkgroupSizeX=1024 |
| 同环境 WebGL / Worker 内 OffscreenCanvas WebGL | ✅（`ANGLE NVIDIA RTX 3050 D3D11`） |

**注意**：`'gpu' in navigator` 在 `about:blank` 直接 evaluate 曾为 false、真实页面上下文才为 true——探测结果随启动上下文漂移（[[WebGPU与渲染管线基础]] §3 的教训同源：**能力探测必须页面上下文运行时做**）。

### 3.2 兼容性矩阵（2026-10 caniuse 口径）

| 浏览器 | WebGL 1 | WebGL 2 | WebGPU |
| --- | --- | --- | --- |
| Chrome / Edge | ✅ 全量 | ✅ 56+ | ✅ 113+（2023-05 起；Windows=D3D12、macOS、ChromeOS；Android 121+） |
| Firefox | ✅ 全量 | ✅ 51+ | ✅ 141+（2025-07，Windows 起；macOS ARM 145+） |
| Safari | ✅ 全量 | ✅ 15+ | ◐ **26+**（2025-09，macOS Tahoe 26/iOS 26 起，仍标 partial） |
| 全局覆盖率 | ~98% | **~96%** | **~87%** |
| 小厂/WebView | 全量 | 基本全量 | 国产壳/企业 WebView 最碎 |

**读法**：

- **WebGL 2 的 ~96% 是「可以假设存在」**；WebGPU 的 ~87% 是「Chromium 世界基本齐、WebKit 世界刚开门」——生产 2026 年仍需 WebGL 兜底（[[WebGPU与渲染管线基础]] §3 的结论在兼容性维度的展开）。
- Firefox/Safari 的 WebGPU 是 **2025 下半年才稳定落地**（web.dev 2025-11 宣布「major browsers 全支持」），距今一年——存量设备、旧 WebView 的长尾还没消化完。
- 与 OffscreenCanvas 组合时兼容面再打折一次：Safari 26 才有 Worker 内 WebGPU context（见 [[OffscreenCanvas与Worker渲染]] §3.4 矩阵）。
- **探测三连**：`'gpu' in navigator` → `requestAdapter()` → `requestDevice()`，任何一环断就走 WebGL——与 [[硬解与软解的选型]] 的通道选型同一条纪律。

### 3.3 性能实测的方法论警告（不是数字表）

WebGL vs WebGPU 的渲染性能对比在本机做不出干净结论，原因有二：

1. **headless/软渲染稀释**：SwiftShader 环境连 WebGL 的并行优势都压成 2~7×（[[WebGL渲染、画布合成与滤镜管线]] §3.2 实测），WebGPU 路径更没有可比性——GPU 类对比只能在真实 GPU 环境做。
2. **瓶颈不在「API 快慢」**：YUV 上屏管线的每帧成本 ~12ms 里大头是 **CPU→GPU 纹理上传带宽**（1080p 3.1MB，实测见 [[OffscreenCanvas与Worker渲染]] §3.2），shader pass 本身 <1ms——换更现代的提交模型省的是 CPU 侧调度开销（多路/多 pass 场景才放大），单路播放瓶颈 unchanged。

所以本篇对性能只下相对结论：**单路播放 = 无感差异；多路合成/高频状态切换 = WebGPU 命令批量提交占优；AI 计算 = 只有 WebGPU 能做**。这个口径比编一张伪精确的 benchmark 表诚实。

## 4. 为什么这么设计？（背后取舍）

**为什么浏览器不把 WebGL 做快，要另造 WebGPU？**
- 不是实现不行，是**架构原型到头了**：OpenGL 的全局状态机是 1992 年「单线程独占 GPU」时代的假设，现代硬件是队列化 + 多进程共享 + 显式同步。浏览器每次 `gl.draw` 都在维护假象，省不掉。WebGPU 把控制权交给应用、开销从运行期挪到声明期——**替换的是模型，不是调优**。

**为什么 WGSL 不直接用 GLSL？**
- GLSL 30 年方言碎片化（各驱动各解释）+ 无内存安全模型。浏览器要的是「可静态校验、分发即安全」——WGSL 之于 GLSL ≈ WASM 之于原生二进制（[[WASM软解H265管线]] 的同构）。代价是迁移成本（新语言），收益是跨驱动行为一致。

**为什么 compute shader 对「AI 视频创作」是生死线？**
- 超分/插帧/风格化是矩阵乘与卷积——「计算」不是「绘制」。WebGL 想做只能假装画全屏三角形、把数据当纹理糊弄过去，表达扭曲且拿不到共享内存/workgroup 语义。WebGPU 的 compute（本机实测 workgroup 1024 + shader-f16）是 Transformer.js/ONNX Runtime Web 跑浏览器端推理的底座。**这正是 JD 里「WebGPU」的真实指向**。

## 5. 规避 / 实践（选型决策表）

| 场景 | 选型 | 理由 |
| --- | --- | --- |
| 单路 YUV 上屏播放 | **WebGL 1**（现有引擎） | 兼容 98%，管线简单，性能瓶颈在上传不在 API |
| 视频编辑器多路合成 | WebGL 2（VAO/MRT）→ 特效栈复杂后迁 WebGPU | bind group 对「一帧多纹理多 pass」更友好 |
| AI 实时处理（超分/插帧/降噪） | **WebGPU compute，无替代** | WebGL 表达不了计算 |
| 浏览器端 AI 推理 | WebGPU（ONNX Runtime Web / Transformers.js 后端） | 生态已就位 |
| 3DGS/大规模并行（排序/仿真） | WebGPU compute（bitonic 排序） | [[3D表达认知-Mesh点云NeRF-3DGS]] 的落点 |
| 兜底链 | WebGPU 探测三连 → 失败走 WebGL → 再失败 Canvas 2D | 渐进增强，不是替换 |

```js
// 运行时选型骨架（与 isTypeSupport 决策链同款纪律）
async function pickRenderer(canvas) {
  if ('gpu' in navigator) {
    try {
      const adapter = await navigator.gpu.requestAdapter();
      if (adapter) return new WebGPURenderer(canvas);       // compute/多路场景
    } catch (e) { /* 探测随环境漂移，失败降级 */ }
  }
  const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
  if (gl) return new WebGLRenderer(gl);                     // 主力通道
  return null;                                               // Canvas 2D 兜底在更上层
}
```

## 6. 面试速记

> **30 秒版**："WebGL 和 WebGPU 是两代架构：WebGL 是 OpenGL ES 2.0/3.0 的浏览器封装，全局状态机加即时提交；WebGPU 对标 Vulkan/D3D12/Metal——管线预编译成不可变对象、bind group 显式绑定、命令录制后批量提交，还新增了 compute shader 和 WGSL。兼容性 2026 年的口径：WebGL 2 全局 96% 可以当全量，WebGPU 87%——Chrome 113 起三年、Firefox 141 和 Safari 26 都是 2025 下半年才落地，所以生产仍要 WebGL 兜底。对视频场景我实际测过：单路 YUV 上屏瓶颈在纹理上传带宽不在 API，两者无感差异；多路合成 WebGPU 的 bind group 占优；AI 超分插帧是 compute 的独占地盘，WebGL 表达不了。选型是渐进增强不是替换：WebGPU 探测三连过了走 WebGPU，失败走 WebGL，能播永远不押在新 API 上。"

## 相关笔记

- [[WebGPU与渲染管线基础]] —— 管线对象/bind group/compute 四件套的代码级展开（先读概念篇）
- [[YUV格式与WebGL渲染]] —— WebGL 渲染管线本体与色彩科学（系数换 API 不换）
- [[OffscreenCanvas与Worker渲染]] —— 渲染表面在哪跑（Worker 化矩阵 + 兼容性坑）
- [[WebGL渲染、画布合成与滤镜管线]] —— GPU 渲染管线通用机制与合成层
- [[硬解与软解的选型]] —— 「运行时逐通道探测 + 兜底」纪律的出处

*本文档基于 caniuse 2026-10 数据、web.dev「WebGPU is now supported in major browsers」（2025-11）、W3C WebGPU 规范、本机 headless Chrome 154 adapter 实测（20 features / compute 1024）与 [[WebGPU与渲染管线基础]] 探针数据整理。*
