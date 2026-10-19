# HTTP 缓存与跨域 · 面试速记

> 网络层必考两块：缓存（性能）和跨域（安全/联调）。30 秒各讲完，详细见 [[HTTP缓存]] / [[跨域]]。

---

## 1. HTTP 缓存（背诵版）

> **两级：强缓存（新鲜期内 0 网络请求）+ 协商缓存（过期后带 ETag/Last-Modified 问服务器 → 304 省响应体）。**
> 指令：`max-age`（新鲜期）、`no-cache`（每次校验）、`no-store`（永不缓存）、`immutable`（不校验）。
> **ETag 精度高（内容指纹）vs Last-Modified 秒级**。
> **最优策略**：静态资源 = **hash 文件名 + max-age 一年 + immutable**（内容变 URL 变，消灭 304）；HTML = `no-cache`；接口 = `no-store`。没配头走**启发式缓存**（`(Date−Last-Modified)×10%`）。

| | 强缓存 | 协商缓存 |
| --- | --- | --- |
| 触发 | 新鲜期内 | 过期 / no-cache |
| 请求 | **不发** | 发（带校验头） |
| 响应 | 本地读 | 304（0B）/ 200 |
| 头 | Cache-Control max-age | ETag/If-None-Match、Last-Modified/If-Modified-Since |

**关键区分**：`no-cache`（缓存但每次校验）≠ `no-store`（完全不缓存）。

## 2. 跨域（背诵版）

> **同源 = 协议+域名+端口三者相同；跨域限制的是「JS 读响应」，不是「发请求」。**
> **CORS**（服务端加 `Access-Control-Allow-Origin` 等头；非简单请求先 `OPTIONS` 预检；**带凭据时 ACAO 不能 `*`**）；**JSONP**（script 标签绕过同源，只 GET、有 XSS 风险）；**代理**（同源服务器转发，开发 vite/webpack proxy、生产 nginx）；**postMessage**（iframe/窗口通信，**必须校验 e.origin**）。

**简单请求条件**：GET/HEAD/POST + Content-Type 仅 text/plain / multipart/form-data / x-www-form-urlencoded + 无自定义头。否则先预检。

| 方案 | 方法 | 凭据 | 适用 |
| --- | --- | --- | --- |
| CORS | 全部 | ✅ | 生产首选 |
| JSONP | 仅 GET | ❌ | 老方案 |
| 代理 | 全部 | ✅ | 开发/nginx |
| postMessage | — | — | iframe 通信 |

## 3. 两块的联系（面试加分）

- **缓存是「重复访问的性能」**，跨域是「跨源访问的权限」——都在**网络请求发出前/响应读取后**介入。
- 组合场景：CDN 回源（跨域？不——CDN 与源站是服务端通信，不受同源限制）；但 CDN 返回的资源要带 CORS 头才能被 `fetch` 读取（`<script>`/`<img>` 加载不受限，但 `fetch` 受限）。
- **缓存 + 预检**：`Access-Control-Max-Age` 让预检结果缓存，减少 OPTIONS 请求（这是「预检的缓存」）。

## 4. 高频追问速答

| 问题 | 一句话答案 |
| ---- | ---- |
| 强缓存 vs 协商缓存？ | 强缓存不发请求；协商缓存发校验请求得 304 |
| no-cache vs no-store？ | 前者缓存但校验；后者完全不缓存 |
| 静态资源最优缓存？ | hash 文件名 + max-age 一年 + immutable |
| 同源的定义？ | 协议+域名+端口三者相同 |
| 跨域限制什么？ | JS 读响应（请求能发出去） |
| 什么时候触发预检？ | 非简单请求（PUT/DELETE、json、自定义头） |
| JSONP 为什么只能 GET？ | 靠 script 标签加载，script 只有 GET |
| 带 cookie 跨域要注意？ | Allow-Credentials: true + ACAO 必须具体源 |

---

## 深读入口

- [[HTTP缓存]] —— 强缓存/协商缓存/Cache-Control 全解
- [[跨域]] —— CORS/JSONP/代理/postMessage
- [[重定向与缓存-验证脚本.js]] · [[跨域-验证脚本.js]] —— 实测脚本
- [[网络层优化]] —— 网络链整体优化
- [[面试速记-索引]] —— 返回主索引
