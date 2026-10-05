# WASM内存管理

> **结论：WASM 的线性内存是一块可增长的 ArrayBuffer，解码器/帧数据全在里面——**内存管理的三个纪律：预分配不增长（grow 会换 buffer 底层指针，旧视图全废）、帧池复用不 new（30fps 下每次 3MB 分配 = GC 尖刺 + 内存峰值翻倍）、峰值封顶（直播播放一小时 = 无池化 335GB 的分配流，池化后固定 ~10 帧 = 31MB）**。实测：Node 里 grow 前后视图失效可复现（§3.1）；线性内存不参与 JS GC（§3.2），这既是性能优势也是泄漏高发区。**

> 可运行验证：§3.1/3.2 探针脚本 Node 直接跑（无依赖）；帧池与零拷贝的管线位置见 [[WASM软解H265管线]]（③段）与 [[解码Worker与SharedArrayBuffer]]（④段）。

[[WASM软解H265管线]] · [[解码Worker与SharedArrayBuffer]] · [[YUV格式与WebGL渲染]]

---

## 1. 背景：WASM 内存的特殊之处

```
JS 对象：     new → GC 托管 → 自动回收
WASM 内存：   linear memory（一大块手动管理的连续内存）→ 不参与 GC，谁用谁还
```

| 特性 | 含义 |
| --- | --- |
| 连续 | 指针算术可行（解码器 C 代码零改动编译） |
| 手动管理 | malloc/free（编译进 wasm 的分配器）——泄漏不会自动救 |
| 可增长 | `memory.grow` 扩容，但 **ArrayBuffer 底层会被换掉** |
| 与 JS 互操作 | `new Uint8Array(memory.buffer, ptr, size)` 直接视图化 |

**「视图失效」是 WASM 内存第一坑**：`memory.grow` 之后，所有之前创建的 `Uint8Array(memory.buffer,…)` 视图的 `buffer` 已经是旧世界——继续用要么报错要么读到旧数据。

## 2. 定义/原理：三个纪律

### 2.1 预分配，避免 grow

```js
// 实例化时声明初始内存（页 = 64KB），并设最大值
new WebAssembly.Memory({ initial: 256, maximum: 1024 });  // 16MB ~ 64MB
// 编译期 --initial-memory/--max-memory 同效
```

**为什么**：解码一帧 1080p YUV 3.1MB + 参考帧缓冲（解码器内部 ~8 帧）≈ 30~50MB 常态需求；预估峰值一次性给足，运行期零 grow。

### 2.2 帧池（固定槽位循环复用）

```c
// C 侧（编译进 wasm）：预分配 N 帧槽
static uint8_t* frame_pool[POOL_SIZE];      // POOL_SIZE=8~10
int pool_alloc()  { /* 取空闲槽位号 */ }
void pool_free(i) { /* 标记空闲 */ }
```

```js
// JS 侧：解码回调给「槽位号 + 指针」，渲染完 free
const ptr = wasm._pool_alloc();              // 固定槽，地址恒定
decoder.decode(nalu, ptr);                   // 解码器直接写进槽位
gl.texImage2D(..., new Uint8Array(mem.buffer, ptr, size));  // 零拷贝渲染
wasm._pool_free(ptr);                        // 渲染完归还
```

**为什么池化**：分配/释放的量恒定（槽位表 O(1)）、内存峰值恒定（POOL_SIZE 帧）、无 GC 参与。直播一小时 = 108,000 帧，池化把「10.8 万次 3MB 分配」变成「10 次初始化分配」。

### 2.3 峰值监控与封顶

```
峰值 = 初始内存 + 解码器内部缓冲 + 池帧数 × 帧大小 + 网络分片缓冲
```

直播长时间播放内存不涨的前提：**每个环节都有固定上限**。任何一处用了「按需 new」的写法（分片缓冲、帧、临时数组），峰值都会随时间线性增长——排查内存曲线是否「平的」是最快检验法。

## 3. 实测

### 3.1 grow 导致视图失效（Node 可复现）

> 🔗 探针（`node wasm-mem-probe.js`，用 WebAssembly.Memory 原生 API，无需真实 wasm 模块）：

```js
const mem = new WebAssembly.Memory({ initial: 1 });      // 1 页 = 64KB
const view1 = new Uint8Array(mem.buffer);                 // 视图 A
mem.grow(1);                                              // +1 页
const view2 = new Uint8Array(mem.buffer);
console.log('view1.buffer === mem.buffer:', view1.buffer === mem.buffer);
// 实测输出: false   ← grow 后旧视图的 buffer 已是 detach 的旧世界
console.log('view2 len:', view2.buffer.byteLength);       // 131072 (2 页)
```

| 步骤 | 实测结果 |
| --- | --- |
| grow 前 view1.buffer === mem.buffer | true |
| grow(1) 后 | **false**（view1 引用的是旧 ArrayBuffer） |
| 通过旧视图写入 | 不会出现在新 buffer（静默数据丢失路径） |

**结论**：grow 不是「扩容原 buffer」而是「换新 buffer 拷贝内容」。运行期 grow 的每次发生都是一次全量复制 + 所有 JS 视图作废——这就是纪律 2.1 的全部理由。

### 3.2 线性内存不参与 GC（泄漏的形态）

```js
// JS 侧每帧 new 一个大视图（错误示范）：
function onFrame(ptr, size) {
  const view = new Uint8Array(mem.buffer, ptr, size);  // 视图本身是轻对象
  // 视图会被 GC，但 wasm 内存里的数据永远在（直到 _free）
}
```

| 泄漏形态 | 现象 |
| --- | --- |
| C 侧 malloc 后忘 free | 线性内存单调上涨，JS 堆看不出来（DevTools memory 面板查不到！要用 `performance.memory`/wasm 内存字节数自监控） |
| JS 侧缓存视图 | 视图持有 buffer 引用 → 阻止 detach 后的回收（小问题） |
| 分配器碎片 | 长期运行后 malloc 变慢（尽管总量没涨）——池化顺带解决 |

**监控要点**：WASM 内存泄漏在 JS 堆快照里**不可见**，自监控代码必须读 `memory.buffer.byteLength` 与池占用数——这是排查「直播越播越卡」的第一入口。

### 3.3 帧池 vs 无池的分配流量（量化）

1080p@30fps 直播 1 小时：

| 方案 | malloc/free 次数 | 分配总量 | 峰值 |
| --- | --- | --- | --- |
| 无池（每帧 malloc 3.1MB） | 216,000 次 | ~672 GB 累计流量 | 分配器峰值 ≈ 数帧 + 碎片 |
| **池化（10 槽）** | 0 次（初始化 10 次） | ~31 MB | **恒定 ~31 MB** |

累计流量差 4 个数量级——分配器与内存带宽的压力差就是「软解播放器跑久了变卡」的第一来源。

## 4. 为什么这么设计？（背后取舍）

**为什么 WASM 内存不进 GC？**
- 目标用户是 C/C++/Rust 程序：GC 的 stop-the-world 与他们的内存模型不兼容；线性内存 = 一块连续 malloc 空间，指针算术/静态布局假设全部保留——**为移植存量代码而设计**，手动管理是移植性的代价也是收益（行为完全确定，无 GC 尖刺）。

**为什么 grow 要换 buffer 而不是就地扩容？**
- JS ArrayBuffer 一旦创建长度不可变（语言层不变量）；WebAssembly.Memory.grow 选择「detach 旧的 + 给新 buffer」来满足它。这个设计的副作用就是视图失效——**底层是语言不变量的妥协，工程上必须用预分配绕开**。

**为什么帧池是音视频管线的标配（而不是 JS 惯用的按需分配）？**
- 帧节奏是恒定的硬实时流（33ms 一帧），分配策略必须 O(1) 且无尖刺；GC 触发的 50~200ms 停顿直接掉帧。**硬实时管线 = 固定内存 + 无分配热路径**，与 [[解码Worker与SharedArrayBuffer]] 的 SAB 环形池是同一思想在线程间/线程内的两次应用。

## 5. 规避 / 实践

| 场景 | 手段 |
| --- | --- |
| 初始化 | 预估峰值一次性预分配 + maximum 封顶 |
| 解码输出 | 池化槽位 + 指针传递（永不按帧 malloc） |
| JS 视图 | 每帧临时创建视图 OK（轻对象会 GC），但**grow 后必须重建** |
| 泄漏排查 | 自监控 `memory.buffer.byteLength` 曲线（JS 堆快照看不到） |
| 直播长期运行 | 全链路固定内存（分片缓冲也环形池化） |
| 碎片 | 池化天然免疫；非池化路径长期运行后 malloc 变慢 |

## 6. 面试速记

> **30 秒版**："WASM 线性内存不参与 GC，手动管理，三个纪律：①预分配不 grow——实测 grow 会换掉底层 ArrayBuffer，所有旧视图失效，静默丢数据；②帧池复用——1080p 一帧 3MB，30fps 每帧 malloc 一小时是 21.6 万次分配，池化 10 槽归零，峰值恒定 31MB；③自监控——WASM 泄漏在 JS 堆快照里不可见，必须读 memory.buffer.byteLength 曲线。为什么池化：硬实时管线 33ms 一帧，GC 的 50-200ms 停顿直接掉帧，固定内存无分配热路径是唯一解。"

## 相关笔记

- [[WASM软解H265管线]] —— 内存管理所在的完整管线
- [[解码Worker与SharedArrayBuffer]] —— SAB 环形池（同一思想的线程间版本）
- [[YUV格式与WebGL渲染]] —— 帧数据的渲染终点（堆视图零拷贝）
- [[播放器架构分层]] —— decode 层的内存策略在五层中的位置

*本文档基于 Node 26 WebAssembly.Memory 实测、Emscripten 内存模型文档、工业 WASM 播放器实践整理。*
