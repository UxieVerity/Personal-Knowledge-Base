# TLS 1.2 与 TLS 1.3 的区别

> **结论：TLS 1.3 最大的改进是「握手从 2-RTT 减到 1-RTT」+「去掉不安全的老密码套件」+「会话恢复 0-RTT」。** 实测同一站点强制 TLS1.2 vs TLS1.3：B站 79.2→56.9ms、抖音 106.9→67.3ms、淘宝 107.3→77.3ms，**TLS1.3 平均快 22~40ms ≈ 一个网络 RTT**。注意百度/QQ 只开 TLS1.2（强制 TLS1.3 报 `ERR_SSL_TLSV1_ALERT_PROTOCOL_VERSION`）——现实世界 TLS1.3 尚未全量部署。

> 可运行验证：[[TLS12vsTLS13-验证脚本.js]]（对真实站点分别强制 `TLSv1.2` / `TLSv1.3` 握手，多次采样对比平均耗时；顺带暴露哪些站点仍不支持 TLS1.3）

[[TLS1.3 AEAD + ECDHE]]

---

## 1. 背景：TLS 解决什么问题

HTTP 是明文协议，TLS（传输层安全）在其上提供四件事：**加密**（防窃听）、**完整性**（防篡改）、**身份认证**（防中间人）、**前向保密**（防历史流量被将来破解）。HTTPS = HTTP over TLS。TLS 1.2（2008）是服役最久的版本，TLS 1.3（2018，RFC 8446）是现行最新版。

## 2. 核心区别：一句话表

| 维度   | TLS 1.2                     | TLS 1.3                                       |
| ---- | --------------------------- | --------------------------------------------- |
| 握手往返 | **2-RTT**（完整握手）             | **1-RTT**                                     |
| 会话恢复 | Session ID / Session Ticket | **PSK + 0-RTT**（首包即数据）                        |
| 密码套件 | 几十个，含老弱算法（RSA 密钥交换、CBC 模式）  | **砍到 5 个**，全用 AEAD（AES-GCM / ChaCha20）+ ECDHE |
| 密钥交换 | RSA（无前向保密）/ ECDHE           | **仅 ECDHE**（强制前向保密）                           |
| 证书验证 | 允许自签/不安全链                   | **要求完整链 + 更多校验**                              |
| 签名算法 | SHA-1 也能用                   | 淘汰 SHA-1，最低 SHA-256                           |
| 扩展   | 零碎拼装                        | 统一扩展机制                                        |
| 兼容性  | 最广（2018 前设备）                | 现代主流，老设备不支持                                   |

## 3. 实测：握手耗时对比

> 环境：本机 Node 20+ `tls` 模块，`rejectUnauthorized:false` 仅测握手；对每个站点分别强制 `TLSv1.2` / `TLSv1.3`，各握手 5 次取平均。机器/网络不同数值有差异，**TLS1.3 相对更快这一方向稳定**。

| 站点 | TLS 1.2 | TLS 1.3 | 差值 | 说明 |
| ---- | ------- | ------- | ---- | ---- |
| `www.bilibili.com` | 79.2ms | 56.9ms | **22.4ms** | 差值 ≈ 一个 RTT |
| `www.douyin.com` | 106.9ms | 67.3ms | **39.5ms** | 差值 ≈ 一个 RTT |
| `www.taobao.com` | 107.3ms | 77.3ms | **30.1ms** | 差值 ≈ 一个 RTT |
| `www.baidu.com` | 104.3ms | ❌ 失败 | — | `ERR_SSL_TLSV1_ALERT_PROTOCOL_VERSION` |
| `www.qq.com` | 96.8ms | ❌ 失败 | — | `ERR_SSL_TLSV1_ALERT_PROTOCOL_VERSION` |

- **关键读数**：TLS1.3 平均快 **22~40ms ≈ 一个 RTT**——正对应「2-RTT → 1-RTT」省掉的那一次往返。
- **失败不是脚本 bug**：`ALERT_PROTOCOL_VERSION` 是**服务器主动拒绝** TLS1.3（百度/QQ 只开放 TLS1.2）。这本身就是 TLS1.3「未全量部署」的真实证据。

## 4. 深入：为什么这样设计？（背后取舍）

### 4.1 为什么握手从 2-RTT 变 1-RTT

- **TLS1.2 握手**（无恢复）：`ClientHello` → `ServerHello + 证书 + ServerKeyExchange` → `客户端算密钥 + Finished` → `服务器 Finished` = **2 次往返**才发数据。
- **TLS1.3 握手**：客户端在 `ClientHello` 里就带上 **key_share**（预测的 ECDHE 参数），服务器一个 `ServerHello + Finished` 就能回；**1 次往返**即出数据。
- 取舍：TLS1.3 要求客户端**提前猜**密钥交换算法（猜错则多一次 HelloRetryRequest 兜底，概率低）。

### 4.2 为什么砍密码套件

TLS1.2 支持几十种套件，其中 RSA 密钥交换**没有前向保密**（私钥泄露 → 历史流量全被解密）、CBC 模式有 padding oracle 攻击（BEAST/POODLE）。TLS1.3 直接**砍到 5 个套件、全用 AEAD + ECDHE**：安全集大幅度收敛，配置错误面变小。取舍：**放弃与老设备的兼容，换安全确定性**。

### 4.3 为什么 0-RTT 是双刃剑

- 0-RTT 让「上一次握手过的客户端」**首包就能带数据**（PSK 恢复），性能最好。
- 但 **0-RTT 数据无法防重放**（中间人可以重放客户端第一条请求）→ 只适用于幂等请求（GET），不能用于 POST 下单。取舍：**速度 vs 安全**，由应用层决定是否启用。

### 4.4 与 HTTP 版本的联动（面试加分点）

- **HTTP/2** 要求底层是 **TLS1.2+**（实际 h2 需 ALPN 协商），所以 **TLS1.3 让 HTTP/2 的「TCP+TLS」两步握手也变快**。
- **HTTP/3 (QUIC)** 直接把 **TLS1.3 内置进 QUIC 握手**（0-RTT/1-RTT 合一），不再有独立的 TLS 层——这也是 H3「连接建立更快」的另一半原因。见 [[HTTP1和HTTP2、HTTP3 的区别]]。

## 5. 规避 / 实践

| 问题 | 手段 |
| ---- | ---- |
| 首访握手慢 | TLS1.3 1-RTT（服务端开启 h3/1.3）、HTTP/2 keep-alive 复用 |
| 重复访问慢 | TLS1.3 **0-RTT** 会话恢复（仅幂等请求）、Session Ticket |
| 老站点不支持 1.3 | 服务端 `ssl_protocols TLSv1.2 TLSv1.3;` 同时开启，客户端协商 |
| 想验证站点支持哪些版本 | `openssl s_client -connect 域名:443 -tls1_3` / DevTools → Security |
| 安全基线 | 只开 TLS1.2+；禁用 RSA 密钥交换/CBC/SHA-1 |

```nginx
# Nginx 启用 TLS1.3（与 1.2 兼容并存）
ssl_protocols TLSv1.2 TLSv1.3;
ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256;
```

```bash
# 命令行查站点支持的 TLS 版本
openssl s_client -connect www.bilibili.com:443 -tls1_3 2>&1 | grep -E "Protocol|Cipher"
```

## 6. 面试速记

> **30 秒版**："TLS1.3 比 1.2 握手少一个 RTT（2-RTT→1-RTT），0-RTT 还能会话恢复；砍掉 RSA 密钥交换和 CBC，只留 AEAD+ECDHE，强制前向保密。实测同一站点 TLS1.3 比 1.2 快 22~40ms≈一个 RTT。代价是老设备不兼容、0-RTT 不能防重放。HTTP/3 把 TLS1.3 内置进 QUIC，所以连接建立更快。"

## 相关笔记

- [[HTTP1和HTTP2、HTTP3 的区别]] —— HTTP/2 依赖 TLS1.2+、HTTP/3 内置 TLS1.3（握手加速的协议层）
- [[TCP与UDP与QUIC的区别]] —— HTTP/3 的传输层 QUIC：可靠 + 独立流（队头阻塞的根源）
- [[TCP 三次握手（建立连接）+ 四次挥手（断开连接）]] —— TLS 握手上层是 TCP 连接（网络链顺序：TCP → TLS）
- [[从浏览器输入网址到页面完整展示全过程]] —— TLS 握手在「网络链」中的位置（§5 TLS 握手）
- [[Update Rendering 阶段详解]] —— 请求回来后的渲染链（TTFB 分界线之前是网络+TLS）

*本文档基于 RFC 8446（TLS 1.3）、RFC 5246/5246（TLS 1.2）、RFC 5705 及本机 Node 20+ `tls` 模块对真实站点实测整理。*
