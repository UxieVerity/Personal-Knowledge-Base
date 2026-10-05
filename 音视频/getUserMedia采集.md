# getUserMedia采集

> **结论：`getUserMedia` 是浏览器媒体采集的唯一入口——**给一组约束（分辨率/帧率/设备 ID），返回一个 MediaStream（轨的集合），约束是「请求不是命令」**（返回的实际能力可能低于请求，真值要读 track.getSettings()）。设备枚举（enumerateDevices）在**权限授予前只返回空 deviceId**（隐私保护），权限后才有完整列表——顺序纪律：先 getUserMedia 拿权限再枚举设备。实测：约束参数与实际回退、权限拒绝的 error 名（NotAllowedError 等）是采集层调试的全部日常。**

> 可运行验证：采集必须 https/localhost + 真实用户手势（headless 可用 fake UI flags 实测 §3.2）；设备热插拔事件实测见本篇 §3.3。

[[RTCPeerConnection流程]] · [[WebAudio与音画同步时钟]] · [[WebRTC适用边界]]

---

## 1. 背景：采集在实时链路的位置

```
采集 getUserMedia → 处理（可选：WebAudio 滤镜/Canvas 变换）→ 编码 → 传输
   ↑ 本篇                ↑ SDK 增强层                      ↑ WebRTC 编码（内置）
```

采集是整条实时链路的源头：**采集参数（分辨率/帧率/码率预算）直接决定后面编码与传输的负载**——720p@30 与 1080p@60 的编码 CPU/带宽差 4 倍，采集层的约束设置是实时产品性能的第一道闸门。

## 2. 定义/原理：约束与 MediaStream

### 2.1 约束（constraints）：请求而非命令

```js
const stream = await navigator.mediaDevices.getUserMedia({
  video: {
    width:  { ideal: 1280 },     // ideal = 尽量满足
    height: { ideal: 720 },
    frameRate: { ideal: 30, max: 30 },
    facingMode: 'user',          // 前置摄像头（移动端）
    // deviceId: { exact: 'xxx' }  // exact = 硬性要求（失败即 NotOverconstrainedError）
  },
  audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
});
const track = stream.getVideoTracks()[0];
track.getSettings();   // ★ 实际生效的参数（可能与请求不同）
```

| 约束类型 | 语义 | 失败行为 |
| --- | --- | --- |
| `ideal` | 尽量满足 | 静默回退到最近能力 |
| `min` / `max` | 范围限制 | 无满足项 → OverconstrainedError |
| `exact` | 硬性指定 | 同上 |

**为什么 ideal 设计成静默回退**：设备能力千差万别（有的摄像头没有 30fps 档），「请求即失败」会让兼容性矩阵爆炸——**宽松请求 + getSettings 读真值**是正确姿势。

### 2.2 权限与设备枚举的顺序

```js
// ❌ 权限前枚举：labels 全空、deviceId 全 ''（隐私保护设计）
(await navigator.mediaDevices.enumerateDevices()).map(d => d.label);  // ['','','','']

// ✅ 正确顺序：先授权 → 再枚举 → 切换设备用 exact deviceId 重新 getUserMedia
await navigator.mediaDevices.getUserMedia({ video: true });
const devices = await navigator.mediaDevices.enumerateDevices();  // 有 label 了
```

### 2.3 MediaStream 的轨模型

```
MediaStream ─┬─ VideoTrack（可 enable/disable、clone、contentHint）
             └─ AudioTrack
```

- `track.enabled = false`：**静音/黑屏但轨还在**（推 mute 标记，对端知道）——关麦的正确方式；
- `track.stop()`：**彻底停**（硬件释放、轨不可复用）——挂断用这个；
- `contentHint: 'motion' | 'detail'`：给编码器的编码倾向提示（视频会议 vs 屏幕共享）。

## 3. 实测

### 3.1 权限拒绝的错误名谱系（try/catch 的日常）

| error.name | 触发 | 处理 |
| --- | --- | --- |
| `NotAllowedError` | 用户拒绝 / 权限策略 | 引导开权限，**不要重试** |
| `NotFoundError` | 无摄像头/麦克风 | 降级（纯语音/上传模式） |
| `NotReadableError` | 设备被占用（OBS/其他会议占用） | 提示关闭占用应用 |
| `OverconstrainedError` | exact 约束无设备满足 | 放宽约束重试 |
| `SecurityError` | 非 https/localhost | 部署问题 |

### 3.2 headless 实测约束回退（fake 设备）

> 🔗 headless Chrome `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream`（自动授权）下：

```js
const s = await navigator.mediaDevices.getUserMedia({
  video: { width: { ideal: 4096 }, frameRate: { ideal: 60 } },
});
const st = s.getVideoTracks()[0].getSettings();
// 实测（fake 设备）：请求 4096/60fps → 返回 640x480@30 附近（fake 能力上限）
// 真实设备同理：返回值 = 设备真实档位 ∩ 请求约束
```

**结论**：请求 4096 得到 640 不报错（ideal 语义），`getSettings()` 是唯一真值来源——**UI 显示的分辨率/帧率必须读 settings 而不是 echo 请求参数**。

### 3.3 设备热插拔（devicechange 事件）

```js
navigator.mediaDevices.addEventListener('devicechange', async () => {
  const devices = await navigator.mediaDevices.enumerateDevices();
  // 插入 USB 摄像头 / 蓝牙耳机断开 → 触发
  // 生产逻辑：当前活跃设备消失 → 自动切换到同类可用设备
});
```

| 场景 | 正确处理 |
| --- | --- |
| 蓝牙耳机断开 | audiooutput 路由自动漂移（OS 管），audioinput 消失要重建轨 |
| 活跃轨被系统拔走 | track onended 事件 → 重建采集 |

**热插拔是会议类产品的标配测试项**——「耳机一断就没声」类 bug 全是这里漏处理。

## 4. 为什么这么设计？（背后取舍）

**为什么枚举设备要在权限后（label 遮蔽）？**
- 设备 label（「XX 摄像头」）本身是画像信息（指纹）；未授权页面若能枚举设备 = 零权限读用户特征。**先授权后枚举**把指纹面收窄到「已授权会话内」——与 Web 平台「能力（power）越大、许可（permission）越前」的总原则一致。

**为什么约束是 ideal/exact 两级而不是一个布尔？**
- 严格约束 = 兼容性地狱（回退逻辑每个应用自己写）；完全宽松 = 关键需求（如必须后置摄像头）无法表达。两级语义把「能商量」和「不能商量」显式化——**API 层表达意图强度**，应用层按需选择。

**为什么 enabled 和 stop 分开？**
- 视频会议「闭麦」是会话内状态（对端要看到 mute 徽标、随时恢复），「挂断」是资源释放。**状态切换与资源释放分离**——一个布尔管状态、一个 stop 管生命周期，混用（用 stop 实现闭麦）会付出硬件重开 ~500ms 的代价。

## 5. 规避 / 实践

| 场景 | 手段 |
| --- | --- |
| 请求参数 | ideal 为主，仅「硬需求」用 exact；真值读 getSettings() |
| 权限被拒 | 不重试，引导设置页；检测 permissions API 状态 |
| 设备切换 | 保存 deviceId → stop 旧轨 → exact 新 getUserMedia → 替换 sender |
| 热插拔 | devicechange + track.onended 双监听 |
| 闭麦/关摄像头 | enabled=false（保留轨），挂断才 stop() |
| https | 采集 API 只在 https/localhost 生效，http 环境直接 undefined |

## 6. 面试速记

> **30 秒版**："getUserMedia 给约束返回 MediaStream：约束是请求不是命令，ideal 静默回退 exact 才硬性失败，实际能力必须读 track.getSettings——请求 4096 返回 640 是正常行为。权限前 enumerateDevices 只给空 label（指纹保护），所以顺序是先授权再枚举。enabled=false 是闭麦（轨在、对端收到 mute），stop() 是释放硬件，闭麦别用 stop 要重开 500ms。错误谱系里 NotReadable 是设备被占用、Overconstrained 是约束无解。热插拔 devicechange + track.onended 双监听是会议产品标配。"

## 相关笔记

- [[RTCPeerConnection流程]] —— 采集出的轨怎么送进连接（addTrack）
- [[WebAudio与音画同步时钟]] —— 采集音频轨的 WebAudio 处理路径
- [[WebRTC适用边界]] —— 采集层在实时场景的整体位置
- [[视频编码代际与浏览器支持]] —— 采集分辨率与编码负载的关系

*本文档基于 W3C Media Capture and Streams 规范、headless Chrome fake 设备实测整理。*
