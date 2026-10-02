# TCP 连接生命周期 · 面试速记

> **速记定位**：面试被问到「三次握手 / 四次挥手 / 为什么挥手 4 次 / FIN vs RST / 什么是 ISN / TIME_WAIT」时，30 秒答完。详细见 [[TCP 三次握手（建立连接）+ 四次挥手（断开连接）]]、[[TCP FIN 和 RST：正常关闭 vs 异常断开]]、[[TCP 初始序列号 ISN（Initial Sequence Number）]]。

---

## 1. 三次握手 —— 建立连接

**目的**：双方确认自己和对方的发送、接收能力都正常，协商初始序列号 ISN。

```
① Client → Server:  SYN=1, seq=x          （x 是客户端随机 ISN）
② Server → Client:  SYN=1, ACK=1, seq=y, ack=x+1   （y 是服务端随机 ISN）
③ Client → Server:  ACK=1, ack=y+1        ✅ 连接建立
```

- 第三次握手的 ACK 报文**可以携带业务数据**，前两次不能
- 状态：Client `CLOSED→SYN_SENT→ESTABLISHED`；Server `LISTEN→SYN_RCVD→ESTABLISHED`

## 2. 四次挥手 —— 断开连接（全双工）

**重点：TCP 是全双工，一方关闭只是不再发送数据，但还可以接收对方剩下的数据，所以要 4 次。**

```
① Client → Server:  FIN=1, seq=u     （我这边不再给你发数据）  Client: FIN_WAIT_1
② Server → Client:  ACK=1, ack=u+1   （收到，但还能继续给你发剩余数据） Server: CLOSE_WAIT
③ Server → Client:  FIN=1, seq=v     （我剩余数据发完了，也关）  Server: LAST_ACK
④ Client → Server:  ACK=1, ack=v+1   Client: TIME_WAIT（等 2MSL）→ CLOSED；Server: 立即 CLOSED
```

> **等待 2MSL 目的**：保证最后那个 ACK 能到达服务端；如果 ACK 丢包，服务端会重传 FIN，客户端还能再回 ACK。

## 3. 为什么握手 3 次、挥手 4 次（面试必问）

> 握手时服务端的 **SYN + ACK 可以合并成一个报文**，所以 3 次；
> 挥手时，收到 FIN 后的 ACK，和自己业务做完才发的 FIN **不能合并**（中间可能要传数据），所以分成两个报文，一共 4 次。

## 4. FIN vs RST（正常关闭 vs 异常断开）

> **FIN = 礼貌「我说完了，再见」；RST = 直接挂断「不谈了」。**

| | FIN | RST |
| --- | --- | --- |
| 场景 | 正常 `close()` | 进程崩溃/端口不存在/往失效连接写数据/防火墙切断 |
| 善后 | 有序，缓冲区数据尽量发完 | 丢弃所有未发送/未接收数据，不做善后 |
| 走流程 | 完整四次挥手 | 无，直接断开 |
| 表现 | 正常收尾 | `recv()` 返回 -1、`send()` 报错 |

## 5. TIME_WAIT vs CLOSE_WAIT（易混点）

| | TIME_WAIT | CLOSE_WAIT |
| --- | --- | --- |
| 哪一方 | **主动关闭方** | **被动关闭方** |
| 是什么 | 发完最后 ACK 等 2MSL，防丢包（正常状态） | 收到 FIN 但应用**忘了 close()**，占着连接（代码 bug） |

> 服务端大量 CLOSE_WAIT = 业务代码没关 fd，会泄露 socket。

## 6. ISN（初始序列号）一句话

> **seq 不是从 0/1 顺序递增，而是随机生成初始值，之后再顺序累加。** 随机 ISN 用来区分不同连接、避免旧连接迟到的报文干扰新连接；现代系统基于「时间 + 四元组哈希」生成伪随机 ISN，防 RST 劫持预测攻击。

- SYN 占 1 个序号：ISN=x，发完 SYN 后下一次 seq = x+1
- 发 100 字节业务数据后，seq = (x+1)+100；FIN 也消耗 1 个序号
- seq 是 32 位无符号整数，协议允许 0~2³²-1 任意值

## 7. UDP 对照（快速感受差距）

- TCP 对方进程崩溃 → 收到 **RST**，send 立刻报错
- UDP 对方进程崩溃 → `sendto()` 返回成功，**完全不报错**（只有 ICMP 端口不可达且防火墙不拦才可能感知）
- QUIC 跑在 UDP 上自己模拟：优雅关闭发 `CONNECTION_CLOSE` 帧（≈FIN），异常断开超时判定死亡，不依赖 ICMP

---

## 深读入口

- [[TCP 三次握手（建立连接）+ 四次挥手（断开连接）]] —— 握手/挥手细节
- [[TCP FIN 和 RST：正常关闭 vs 异常断开]] —— FIN/RST + TIME_WAIT/CLOSE_WAIT
- [[TCP 初始序列号 ISN（Initial Sequence Number）]] —— ISN 原理与算法
- [[TCP与UDP与QUIC的区别]] —— 传输层全貌
- [[面试速记-索引]] —— 返回主索引
