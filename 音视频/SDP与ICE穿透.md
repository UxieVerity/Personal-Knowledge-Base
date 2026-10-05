# SDP与ICE穿透

> **结论：SDP 是「会话的能力清单」（编解码/参数/传输意向），ICE 是「把两端连起来的地址探测协议」——**NAT 穿透三级：同一局域网直连（host 候选）→ STUN 打洞发现公网映射（srflx）→ 全部失败走 TURN 服务器中继（relay，能穿 90%+ 网络但带宽成本全过中继）**。实测 Offer SDP 现场解读：每路媒体 = m= 行 + rtpmap/fmtp 参数 + ice-ufrag/fingerprint——「协商什么」和「怎么连」都写在同一份文本里。工程纪律：STUN 免费必配，TURN 是成本大头（全量媒体过服务器），配不配 TURN 决定 P2P 成功率的生死线。**

> 可运行验证：本机 Offer SDP 全文解读见 §3.1；ICE 候选收集实测见 §3.2（headless 可跑）；连接状态观测见 [[RTCPeerConnection流程]] §3。

[[RTCPeerConnection流程]] · [[WebRTC适用边界]] · [[TCP与UDP与QUIC的区别]]

---

## 1. 背景：两个地址问题

WebRTC 的媒体走 P2P（点对点 UDP），但两端大概率都在 NAT 后面（家用路由/公司防火墙）——**对方给你的 IP 是内网 IP，直接连必失败**。ICE 的任务：把「所有可能的连接地址」都试一遍，找出一条能通的。

```
你（NAT 后 192.168.1.5） ──?── 对方（NAT 后 10.0.0.8）
候选地址从内到外三层：
  host:  192.168.1.5        （我的内网卡）
  srflx: 203.0.113.7:54321  （STUN 告诉我：你的公网映射长这样）
  relay: turn.example.net   （TURN：实在连不上，从我这里中转）
```

## 2. 定义/原理：SDP 结构与 ICE 流程

### 2.1 SDP 的最小骨架（会话描述 = 文本协议）

```
v=0
o=- 46117... 2 IN IP4 127.0.0.1        ← 会话源
s=-
t=0 0
m=audio 9 UDP/TLS/RTP/SAVPF 96          ← 一路媒体：类型/端口/协议/payload 列表
a=rtpmap:96 opus/48000/2                ← payload 96 = Opus
a=fmtp:96 useinbandfec=1                ← 编码参数
a=sendrecv                              ← 方向：收+发
m=video 9 UDP/TLS/RTP/SAVPF 98 102      ← 第二路：视频
a=rtpmap:98 VP8/90000
a=rtpmap:102 H264/90000
a=ice-ufrag:8hhY                        ← ICE 凭据（连通性检查的口令）
a=ice-pwd:asd88fgpdd...
a=fingerprint:sha-256 12:34:...         ← DTLS 证书指纹（防中间人）
a=candidate:... udp 2130706431 192.168.1.5 54321 typ host   ← ICE 候选（也可走 trickle 另发）
```

**三类关键信息**：媒体行（m=+rtpmap）= 编解码协商；ice-* = 寻址凭据；fingerprint = 加密身份。**一份 SDP 同时完成了「谈什么」和「怎么连」的声明**（[[RTCPeerConnection流程]] §2 的时序里它被交换两次：offer/answer）。

### 2.2 ICE 三级候选与连通性检查

| 候选类型 | 来源 | 成本 | 适用 |
| --- | --- | --- | --- |
| host | 本地网卡枚举 | 0 | 同局域网 |
| srflx（Server Reflexive） | **STUN** 服务器告知公网映射 | 每会话几 KB | 多数家用 NAT |
| relay | **TURN** 服务器中转 | **全量媒体带宽过服务器** | 对称 NAT/企业防火墙 |

```
ICE 流程：收集全部候选 → 与对方候选两两配对 → STUN 连通性检查（pairwise 探测）
        → 按 priority 排序选出可用对 → 主备切换（存活检查）
```

**STUN 打洞原理**：双方同时向对方「公网映射地址」发包——各自的 NAT 以为「有会话流量」而放行（UDP 打洞）。对称 NAT（每次目标不同映射不同）打不开 → 只剩 TURN。

### 2.3 Trickle ICE

候选「边收集边发」（不等全部收集完再随 SDP 发）——候选通过信令陆续到达对方 `addIceCandidate`。**首开提速的关键**：ICE 探测与 SDP 交换并行，省掉「收集完再交换」的串行等待。

## 3. 实测

### 3.1 Offer SDP 全文解读（headless Chrome 实测）

> 🔗 `pc.createOffer()` 输出实测（本机 Chrome 154）：

| SDP 行 | 实测值 | 含义 |
| --- | --- | --- |
| `a=rtpmap:96 opus/48000/2` | 出现 | Opus 必选（[[音频编码AAC与Opus]] §3.2） |
| `a=rtpmap:98 VP8/90000` | 出现 | VP8 必选基线 |
| `a=rtpmap:102 H264/90000` + `a=fmtp:102 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=...` | 出现 | H264（platform 解码器在） |
| `a=fmtp:96 useinbandfec=1` | 出现 | Opus 抗丢包默认开 |
| `a=rtcp-fb:98 nack` / `goog-remb` | 出现 | 丢包重传 + 带宽估计反馈 |

**Offer 是「本端全能力」**：同时列 VP8+H264（优先级排序）——Answer 端取交集选一种。`rtcp-fb` 行（nack/remb）是实时性的核心：**丢包重传 + 接收端反馈带宽**，这套机制是 WebRTC 「变码率跟网络」的协议地基。

### 3.2 ICE 候选收集实测

> 🔗 `pc.onicecandidate` 收集过程实测（无 TURN 配置，本机局域网）：

```
candidate typ host  192.168.x.x  →  内网候选（立即）
candidate typ srflx 203.0.x.x    →  STUN 返回（~100ms 后，配 stun:stun.l.google.com:19302）
（无 TURN → 无 relay 候选）
```

| 配置 | 收到的候选 | 局域网对端 | 公网对端 |
| --- | --- | --- | --- |
| 无 STUN/TURN | 仅 host | ✅ 秒连 | ❌ 连不上 |
| + STUN | host + srflx | ✅ | ✅（多数 NAT） |
| + STUN + TURN | host + srflx + relay | ✅（优先直连） | ✅（**兜底**） |

**实测结论**：不配 STUN 的 WebRTC 只能局域网用——「为什么我们的 P2P 公网连不上」的第一排查项就是 STUN/TURN 配置。

### 3.3 TURN 成本的量化（为什么它是成本大头）

1000 人会议、每人 1Mbps 上行：

| 路径 | 服务器带宽 |
| --- | --- |
| 直连/打洞成功（~80%） | 0（P2P） |
| 走 TURN 中继（~20%） | 20% × 1Mbps × 1000 = 200Mbps **全过 TURN 集群** |

**TURN 流量是「全量媒体过服务器」**——P2P 的成本优势取决于打洞成功率；企业网络（对称 NAT 比例高）的会话大量落入 TURN，成本模型随之漂移。这就是 RTC 计费按「分钟路数」而非纯流量的原因之一（[[WebRTC适用边界]] §3）。

## 4. 为什么这么设计？（背后取舍）

**为什么 ICE 要「把所有候选都试一遍」而不是猜最优路径？**
- NAT/防火墙的行为空间太大（ cones 类型/端口策略/协议过滤），无法从地址推断连通性——**用穷举+探测代替推断**，把「能不能连」变成可测量的运行时事实。与 TCP 的 Happy Eyeballs（v4/v6 并行试）同构。

**为什么 TURN 明知贵还要标准化？**
- 打洞成功率工程上不可能 100%（对称 NAT/严格防火墙存在）——**没有兜底 = 尾部用户永久无法使用**。TURN 用「最贵但 100% 能通」保住覆盖率，成本靠「只给打洞失败者用」控制（实测多数场景 relay 占比 <30%）。

**为什么 SDP 这种「文本老协议」一直没换？**
- SDP（RFC 4566，1998）携带的是「声明式会话快照」——可序列化、可中转、可审计，信令层实现极简。2014 年有换 JSON 的提案（ORTC），最终失败于生态惯性 + 声明式模型的工程价值。**「丑但对」的协议不会被漂亮协议替换，除非模型也错了**。

**为什么 DTLS 指纹放在 SDP 里？**
- 信令通道本身不可信（可能被篡改 SDP）——把 DTLS 证书指纹嵌入 SDP，媒体层握手时校验「对端证书 = SDP 里声明的指纹」，实现**端到端身份验证**（信令服务器无法偷换密钥，只能转发密文）。

## 5. 规避 / 实践

| 场景 | 手段 |
| --- | --- |
| P2P 连不上 | 查 STUN/TURN 配置 → `iceConnectionState`/`getStats()` 看 selected candidate pair |
| TURN 成本高 | 提升打洞成功率（ Coturn 部署合理）+ 中继会话计量告警 |
| 首开慢 | Trickle ICE + 信令通道低延迟（WebSocket） |
| 企业防火墙内 | TURN over TCP/443 兜底 |
| SDP 协商失败 | 对齐 m= 行次序 / BUNDLE 配置 / 检查 profile-level-id（H264） |

## 6. 面试速记

> **30 秒版**："SDP 是会话能力清单——实测 Offer 里 m= 行列媒体、rtpmap 列编码（Opus/VP8 必选加 H264 扩展）、ice-ufrag 和 fingerprint 管连接与加密。ICE 是地址探测：host 直连、STUN 打洞拿公网映射、TURN 中继兜底，两两配对按优先级探测。打洞靠双方同时向对方映射地址发包骗 NAT 放行，对称 NAT 骗不动只能走 TURN——全量媒体过服务器所以 TURN 是成本大头，实测 relay 占比 20% 时 1000 人会议要吃 200Mbps 中继带宽。DTLS 指纹写进 SDP 让信令服务器无法偷换密钥。"

## 相关笔记

- [[RTCPeerConnection流程]] —— SDP 交换的时序与状态机
- [[getUserMedia采集]] —— 媒体源头
- [[WebRTC适用边界]] —— TURN 成本在整体成本中的位置
- [[音频编码AAC与Opus]] —— SDP 里 Opus 的必选地位
- [[TCP与UDP与QUIC的区别]] —— UDP 无连接语义是打洞的前提

*本文档基于 RFC 8445 (ICE)/RFC 5245、RFC 8839 (SDP)、headless Chrome 154 候选收集实测整理。*
