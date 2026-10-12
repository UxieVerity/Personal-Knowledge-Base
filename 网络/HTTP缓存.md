# HTTP 缓存（强缓存 / 协商缓存 / Cache-Control）

> **结论：HTTP 缓存是「重复访问时把网络请求降为 0」的最优手段。两级缓存——强缓存（新鲜期内直接本地读，**0 网络请求**）和协商缓存（过期后带校验头问服务器，`304` 只回 0B 响应体）。** 控制全靠 `Cache-Control` 指令（`max-age` / `no-cache` / `no-store` / `immutable` 等）+ 校验头（`ETag/If-None-Match`、`Last-Modified/If-Modified-Since`）。**最优策略 = hash 文件名 + 长缓存**（把新鲜度判断从服务器转移到 URL 层）。实测：二次访问 max-age 资源 0 网络请求、no-cache 每次校验但 304 省响应体、no-store 每次都全量下载。
>
> 可运行验证：[[重定向与缓存-验证脚本.js]]（Node 实测：强缓存命中 / 协商 304 / no-store / If-Modified-Since / 重定向缓存）

---

## 1. 一句话定义（背诵版）

**HTTP 缓存 = 浏览器把响应存本地，重复访问时**「新鲜就直接用（0 请求），过期就带校验头问服务器（304 省响应体）」**。**

| 概念 | 一句话 |
| ---- | ---- |
| **强缓存** | 新鲜期内（`max-age` 未过期）→ 直接本地读，**不发请求** |
| **协商缓存** | 过期后 → 带 `If-None-Match`/`If-Modified-Since` 问服务器 → `304` 复用本地 或 `200` 全量更新 |
| **Cache-Control** | 服务器声明「缓存策略」的指令集 |
| **校验头** | `ETag`（内容指纹）+ `Last-Modified`（时间戳） |

## 2. 强缓存 vs 协商缓存（核心对比）

| 维度 | 强缓存 | 协商缓存（条件请求） |
| --- | --- | --- |
| 触发 | 新鲜期内（`max-age` 未过期） | 过期后 / `no-cache` |
| 是否发请求 | **否，0 网络请求** | 是，但只带校验头 |
| 响应 | 直接本地读 | 服务器回 **304**（0B）或 **200**（变了） |
| 关键头 | `Cache-Control: max-age`、`Expires` | `ETag/If-None-Match`、`Last-Modified/If-Modified-Since` |

**为什么强缓存更优**：强缓存命中 = 整个网络链（DNS/TCP/TLS/请求/响应）**全部短路**，0 RTT；协商缓存虽省响应体，但**仍要发一次请求**（1 RTT）。

## 3. Cache-Control 指令全解（面试逐条背）

| 指令 | 含义 | 实测 |
| --- | --- | --- |
| `max-age=秒` | 新鲜期（从响应时间算起） | `/new` max-age=60 → 二次访问 **0 请求** |
| `no-cache` | **每次都要校验**（但可复用本地副本省响应体） | `/must-revalidate` → 每次 304 |
| `no-store` | **永不缓存**（连副本都不留） | `/no-store` → 每次都 200 全量 |
| `immutable` | 新鲜期内**永不重新校验**（配合 hash 文件名） | 静态资源用 |
| `public/private` | 中间缓存能否缓存 / 仅浏览器缓存 | CDN vs 浏览器 |
| `must-revalidate` | 过期后必须校验，不能直接用过期副本 | 强一致场景 |
| `max-age=0` | 立即过期 → 每次都校验 | 等价 no-cache（配 ETag） |

**实测**（重定向与缓存-验证脚本.js）：
```
/new max-age=60：第二次访问 → 内存缓存命中，0 网络请求
/must-revalidate (no-cache)：每次 → 带 If-None-Match → 304 (0B)
/no-store：每次 → 200 全量 100B（服务器每次都收到）
/expired (max-age=0)：过期 → 条件请求 → 304
汇总：12 次真实请求 vs 5 次缓存命中，304 全部 0B 响应体
```

## 4. ETag vs Last-Modified（协商缓存两个校验头）

| | `ETag / If-None-Match` | `Last-Modified / If-Modified-Since` |
| --- | --- | --- |
| 依据 | **内容指纹**（hash） | **修改时间** |
| 精度 | 精确（内容变即变） | 秒级（同一秒改两次不敏感） |
| 缺陷 | 服务端要算 hash | 精度低、时间可伪造 |
| 实测 | `/must-revalidate` 用 ETag → 304 | `/ims` 用 Last-Modified → 304 |

> **面试点**：ETag 精度更高（内容级），Last-Modified 有秒级精度局限——所以**强一致场景用 ETag，Last-Modified 是补充**。两者可并存，浏览器先发 If-None-Match。

## 5. 最优策略（面试必答「缓存怎么配」）

| 资源类型 | 策略 | 为什么 |
| --- | --- | --- |
| **静态资源**（JS/CSS/图） | `Cache-Control: max-age=31536000, immutable` + **hash 文件名** | 内容变 → URL 变 → 天然失效，可永久缓存 |
| **HTML** | `no-cache` 或 `max-age=0` | 必须每次校验，避免拿到旧页面 |
| **用户数据/接口** | `no-store` 或 `private, no-store` | 不进共享缓存 |
| 未配缓存头 | 浏览器**启发式缓存** `(Date−Last-Modified)×10%` | 「没配却被缓存」的原因，尽量显式配置 |

> **核心思想**：hash 文件名 + 长缓存把「新鲜度判断」从服务器端（304 校验）转移到 **URL 层**（内容变 URL 就变）——**彻底消灭 304**。这是静态资源缓存的最优解。

## 6. 缓存查找顺序（浏览器内部）

```
Service Worker(Cache API) → 内存缓存(最快) → 磁盘缓存(持久) → 网络
              ↑ 命中即短路，不发网络请求
```

- **内存缓存**：当前页面会话，最快，关页清空
- **磁盘缓存**：跨会话持久，容量大
- **Service Worker**：可编程控制（离线优先、预缓存）

## 7. 高频追问速答

| 问题 | 一句话答案 |
| ---- | ---- |
| 强缓存和协商缓存区别？ | 强缓存新鲜期内不发请求（0 网络）；协商缓存发请求但 304 省响应体 |
| Cache-Control 常用指令？ | max-age / no-cache / no-store / immutable / public / private |
| no-cache 和 no-store 区别？ | no-cache 缓存但每次校验；no-store 完全不缓存 |
| ETag 和 Last-Modified 区别？ | ETag 内容指纹精度高；Last-Modified 秒级精度低 |
| 304 是什么？ | 协商缓存校验通过，服务器说「没变」，复用本地副本（0B 响应体） |
| 静态资源怎么配缓存？ | hash 文件名 + max-age 一年 + immutable（内容变 URL 变） |
| HTML 怎么配？ | no-cache（必须每次校验拿新页面） |
| 没配缓存头会被缓存吗？ | 会——启发式缓存（Date−Last-Modified）×10% |

## 8. 面试速记（30 秒版）

> **HTTP 缓存两级：强缓存（新鲜期内 0 网络请求）+ 协商缓存（过期后带 ETag/Last-Modified 问服务器 → 304 省响应体）。** 指令：`max-age`（新鲜期）、`no-cache`（每次校验）、`no-store`（永不缓存）、`immutable`（不校验）。**ETag 精度高（内容指纹）vs Last-Modified 秒级**。**最优策略**：静态资源 = **hash 文件名 + max-age 一年 + immutable**（内容变 URL 变，消灭 304）；HTML = no-cache；接口 = no-store。没配头会走启发式缓存（`(Date−Last-Modified)×10%`）。

> 关联笔记：[[网络层优化]]（网络链整体） · [[从浏览器输入网址到页面完整展示全过程]]（缓存查找位置） · [[HTTP1和HTTP2、HTTP3 的区别]] · [[面试复习准备计划]]（W5 周二）
