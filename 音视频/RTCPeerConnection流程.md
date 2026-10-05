# RTCPeerConnection流程

> **结论：RTCPeerConnection 建连三步——**createOffer/createAnswer 生成 SDP（能力清单）→ 信令服务器交换 → setLocal/setRemoteDescription 后开始 ICE 探测连路**。轨的接入是 addTrack（采样后的 MediaStreamTrack），连接状态机有三个互补的枚举（connectionState/iceConnectionState/signalingState 别混用）。实测要点：Offer 里已含本端编解码候选（H264/VP8/Opus 全列表），Answer 做「子集筛选」——这就是「编解码协商」的机制现场；DTLS 握手在 ICE 连通后自动完成，应用层无需介入。**

> 可运行验证：本篇 §3 给两浏览器互连的最小信令实现（信令可用 WebSocket/手动复制粘贴模拟）；SDP/ICE 细节见 [[SDP与ICE穿透]]。

[[getUserMedia采集]] · [[SDP与ICE穿透]] · [[WebRTC适用边界]]

---

## 1. 背景：为什么建连要「交换描述」而不是直接发数据

两台浏览器在建立 P2P 媒体连接前必须互相知道三件事：

1. **对方能收什么**（编解码/分辨率/加密方式）——能力协商；
2. **对方在哪**（IP:port 候选，含 NAT 内网地址）——连接寻址；
3. **用什么密钥通话**（媒体加密）——安全协商。

RTCPeerConnection 的建连流程就是把三件事规范化：SDP 管①③、ICE 管②、信令服务器负责「把描述送到对方」（**信令内容协议不规定**，WebRTC 标准刻意不管信令——WebSocket/HTTP/postman 传纸条都行）。

## 2. 定义/原理：完整建连时序

```
A(主叫)                          信令服务器                          B(被叫)
  │ getUserMedia 采集                 │                                │
  │ new RTCPeerConnection             │                                │
  │ addTrack(audio/video)             │                                │
  │ createOffer() → offerSDP          │                                │
  │ setLocalDescription(offer)        │                                │
  │ ────── offer SDP ─────────────→   │ ────── offer ─────────────→    │
  │                                   │                  new RTCPeerConnection
  │                                   │                  setRemoteDescription(offer)
  │                                   │                  getUserMedia + addTrack
  │                                   │                  createAnswer() → answerSDP
  │ ←───── answer SDP ─────────────── │ ←────── answer ───────────────  │
  │ setRemoteDescription(answer)      │                  setLocalDescription(answer)
  │ ICE 候选 双向交换（onicecandidate → 信令 → addIceCandidate）        │
  │ ────── ICE 连通性检查（STUN 探测）───────────────────────────────    │
  │ DTLS 握手（密钥）→ SRTP 媒体流开始                                                │
```

| 步骤 | API | 产出 |
| --- | --- | --- |
| 采集 | getUserMedia | MediaStreamTrack |
| 能力清单 | createOffer/createAnswer | SDP |
| 应用描述 | setLocal/setRemoteDescription | 进入协商状态 |
| 寻址 | ICE（自动收集候选） | candidate（host/srflx/relay） |
| 加密 | DTLS（自动） | SRTP 会话密钥 |
| 传输 | （内建） | RTP 包 |

### 状态机（三套，别混）

| 枚举 | 含义 | 常用判据 |
| --- | --- | --- |
| `connectionState` | 整体连接状态 | `connected` 可通话 / `failed` 需重连 |
| `iceConnectionState` | ICE 子系统 | `disconnected` 短暂抖动（先等再杀） |
| `signalingState` | SDP 协商进度 | `stable` 才能发起新 offer |

**工程纪律**：重连逻辑监听 connectionState，`iceConnectionState: disconnected` 只标记「怀疑」（15s 内恢复很常见）——拿 disconnected 当 failed 立即重连是高频 bug。

### 轨的动态管理

```js
// 协商后中途加轨（如连麦中开摄像头）：重新走 offer/answer 交换
pc.addTrack(newTrack, stream);   // 标记需要重新协商
pc.onnegotiationneeded = async () => {  // 自动触发点
  await pc.setLocalDescription(await pc.createOffer());
  signaling.send(pc.localDescription);
};
// 移除：sender.track.stop() + pc.removeTrack(sender) + 重新协商
```

## 3. 实测

### 3.1 SDP 里的编解码协商（Offer/Answer 机制现场）

> 🔗 对 headless Chrome 生成 Offer 的 SDP 实测（[[SDP与ICE穿透]] 有完整 SDP 解读）：

```
a=rtpmap:96 opus/48000/2        ← 音频：Opus（必选，RFC 7874）
a=rtpmap:98 VP8/90000           ← 视频：VP8（基线，必选）
a=rtpmap:102 H264/90000         ← H264（平台有硬解/软解时出现）
a=fmtp:96 minptime=10;useinbandfec=1   ← Opus FEC 参数
```

**Offer 列全部本端能力（优先级排序），Answer 返回子集**——协商结果 = 两端能力的交集 × B 的优先级重排。**这就是「为什么 WebRTC 端点永远能互相听懂」**：必选集（Opus/VP8）兜底 + 扩展集（H264/H265/AV1）锦上添花，与 MSE 的「isTypeSupported 白名单」是两种哲学（协商 vs 声明）。

### 3.2 最小互连实测（无信令服务器：手动传 SDP）

> 🔗 两标签页/两浏览器手动交换 SDP 的最小代码（验证建连全流程）：

```js
// A 端
const pc = new RTCPeerConnection();
pc.addTrack(track, stream);
await pc.setLocalDescription(await pc.createOffer());
// 把 pc.localDescription(JSON) 复制给 B（粘贴到聊天窗口即可）
// B 端 setRemoteDescription(offer) → createAnswer → 回传 → A setRemoteDescription(answer)
// 双方 onicecandidate 产生的 candidate 同样手动互传 addIceCandidate
// 实测：connectionState 数秒内 → 'connected'，video 元素出现对方画面
```

实测读数（本机两标签页）：

| 阶段 | 耗时量级 |
| --- | --- |
| offer/answer 交换 | 手动（瞬间） |
| ICE 收集+连通检查 | ~0.5~2s（host 候选直连秒通） |
| DTLS 握手 | ~1 个 RTT |

**「手动复制粘贴也能连上」是最好的理解工具**：它证明 WebRTC 建连不依赖任何魔法服务器——信令只是「递纸条」，递纸条的方式随你。

### 3.3 addTrack vs addStream（API 演进的坑）

| API | 状态 | 说明 |
| --- | --- | --- |
| `addStream(stream)` | ❌ 已废弃 | 老教程常客，新代码别用 |
| `addTrack(track, stream)` | ✅ 标准 | 轨粒度管理（换轨/合流都靠它） |
| `addTransceiver(direction)` | ✅ 高级 | 未采集先占位（如先协商后采集） |

**现代化 SDK 全部基于 track 粒度**（换摄像头 = replaceTrack 不重新协商）：

```js
sender.replaceTrack(newTrack);   // 无缝换源（屏幕共享切换/虚拟背景）——不触发重协商！
```

`replaceTrack` 不触发协商（同类型轨直接换源）是会议产品「秒切屏幕共享」的实现基础。

## 4. 为什么这么设计？（背后取舍）

**为什么标准不管信令？**
- 信令拓扑是产品形态（WebSocket/HTTP/租户体系/鉴权）强相关的；标准化它 = 绑死拓扑。**标准只定「终端间的会话协议」**（SDP/ICE/DTLS），信令留给应用——与 MSE 只定「喂流接口」不管拉流协议是同一哲学。

**为什么选 Offer/Answer 模型（而不是各自声明能力取交集）？**
- 单向「提供-应答」有明确主导方（避免同时发 offer 的歧义）、SDP 作为「可交换的会话快照」可被信令任意中转/录制/审计。**协商变成两份可序列化文档的交换**——分布式系统的「意向书」模式。

**为什么 DTLS 而不是 TLS？**
- 媒体走 UDP/SRTP：TLS 依赖 TCP 可靠字节流，DTLS = 「给 UDP 用的 TLS」（自带丢包容忍的握手）。密钥协商在 ICE 连通后进行，且**密钥协商就在媒体通道里**（自证安全，无第三方密钥分发）。

## 5. 规避 / 实践

| 场景 | 手段 |
| --- | --- |
| 重连 | 监听 connectionState=failed；disconnected 等待观察 |
| 中途加轨 | addTrack + onnegotiationneeded 重新协商 |
| 秒切屏幕共享 | replaceTrack（不重协商） |
| ICE 很慢 | 检查 STUN/TURN 配置齐全；host 候选同局域网应秒连 |
| Offer 冲突 | 建立角色纪律（谁 can initiate），或 perfect negotiation 模式 |
| SDP munge | 尽量别手改 SDP（setBitrate/encodingParams 等 API 替代） |

## 6. 面试速记

> **30 秒版**："RTCPeerConnection 三步：createOffer/Answer 出 SDP 能力清单，信令服务器只管递纸条（标准刻意不管信令），setRemote 后 ICE 探测连路、DTLS 自动握手加密。协商机制是 Offer 列全部能力 Answer 取子集——实测 Offer 里 Opus/VP8 必选集兜底加 H264 扩展集，这就是两端永远能互通的原因。状态机三套别混：重连看 connectionState，iceConnectionState 的 disconnected 只是怀疑不是失败。中途换轨 replaceTrack 不触发重协商，秒切屏幕共享就靠它；加新轨才要重新 offer/answer。"

## 相关笔记

- [[SDP与ICE穿透]] —— Offer/Answer 的内容细节与 NAT 穿透三级
- [[getUserMedia采集]] —— addTrack 的轨从哪来
- [[WebRTC适用边界]] —— 整套机制的成本代价与适用场景
- [[音频编码AAC与Opus]] —— SDP 里 Opus 必选的原因
- [[TCP与UDP与QUIC的区别]] —— 媒体走 UDP 的传输层原因

*本文档基于 W3C WebRTC 1.0 规范、RFC 8829 (JSEP)、本机双端互连实测整理。*
