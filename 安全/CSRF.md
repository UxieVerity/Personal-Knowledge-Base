# CSRF（跨站请求伪造）

> **结论：CSRF = 攻击者诱导受害者在「已登录的站点 A」上执行非本意操作。** 根因是浏览器的一个"特性"：**发请求时自动携带目标站点的 Cookie，且不校验请求是从哪个页面发出的**——攻击站 B 的页面发请求到 A，浏览器照样带上 A 的登录 Cookie，服务器看到"已登录"就放行。所以**只要受害者登录着 A，攻击者就能借他的手转账/改密/发帖**。防护三件套：① **SameSite Cookie**（Lax/Strict，最省事，实测直接拦跨站 POST）② **CSRF Token**（服务器下发随机 token，攻击者猜不到）③ **校验 Origin/Referer**。记住：**CSRF 攻击者"不会读"响应，只在乎请求被执行**。
>
> 可运行验证：[[CSRF-验证脚本.cjs]]（Node 双站点 + Chrome CDP 实测：无 SameSite 攻击成功 / SameSite=Lax 拦截 / CSRF Token 拦截）

---

## 1. 背景：为什么浏览器"帮忙"发起了攻击

CSRF 能成功，靠的是三个浏览器机制的叠加：

1. **Cookie 自动携带**：浏览器对某个域名设置 Cookie 后，**任何请求这个域名的请求都会自动带上**（不管来自哪个页面）。
2. **跨站请求不被拦**：`<form>` 提交、`<img>`/`<script>` 加载、`fetch`（默认不带跨站凭据但表单/标签会带）**不阻止跨站**。
3. **服务器无法区分请求来源**：只要 Cookie 有效，服务器就认为"是本人操作"。

```
受害者浏览器                             攻击站 B                       受害站 A
    │  登录 A（Set-Cookie: session）       │                               │
    │────────────────────────────────────►│                               │
    │  点开 B 的恶意页面                    │                               │
    │────────────────────────────────────►│                               │
    │  页面上有 <form action="A/transfer">  │                               │
    │  表单自动提交（或 img 加载）            │                               │
    │──────────────────────────────────────────────────────────────────────►│
    │  （浏览器自动带上 A 的 Cookie）         │                         判断 Cookie 有效
    │  ◄────────────────────────────────────────────────────────────────────│  → 转账成功！
```

**关键认知**：CSRF 攻击者**完全不知道 Cookie 内容**，也**读不到响应**（跨域读取被同源策略拦）——他只需要**诱导浏览器发出请求**，剩下的交给浏览器自动带 Cookie。所以 CSRF 是"**请求伪造**"，不是"响应窃取"。

## 2. 实测：攻击与三种防护

> 环境：本机 Node v26.8.1，两个"站点"——受害站 `127.0.0.1:8133`（登录 Cookie + 转账接口）、攻击站 `localhost:8134`（恶意页面，与受害站**不同 hostname → 真正跨站**）。Chrome CDP 先登录受害站，再打开攻击站页面，观察受害站收到什么。攻击页同时有 `<img>`（GET）和自动提交的 `<form>`（POST）。

### 2.1 无 SameSite 属性：攻击成功（CSRF 根因）
[[]]
```
[登录] 受害站 Cookie: session=abc123（无 SameSite 属性）
[受害站日志] POST 向hacker 转9999元 | 带登录Cookie(已登录) | Referer:http://localhost:8134/
[结论] 攻击者能伪造转账吗? 是 🚨 CSRF 成功（Cookie 被自动携带）
```

- 攻击站页面加载后，自动提交的 `<form action="http://127.0.0.1:8133/transfer" method="POST">` **带着受害者的登录 Cookie** 到达受害站。
- 受害站看到 `session=abc123` 就认为"本人操作"，**转账成功**。
- Referer 显示 `http://localhost:8134/`（攻击站）——**如果服务器校验 Referer 就能发现来源可疑**，这正是防护③。

### 2.2 SameSite=Lax：跨站 POST 被拦截

```
[受害站日志] GET 向hacker 转9999元 | 未登录 | Referer:http://localhost:8134/
[受害站日志] POST 向hacker 转9999元 | 未登录 | Referer:http://localhost:8134/
[结论] SameSite=Lax 下跨站 POST 是否被带 Cookie? 否 ✅ (POST 不带 Cookie 被拦截)
```

- Cookie 加了 `SameSite=Lax` 后，**跨站 POST 请求不再携带 Cookie** → 受害站看到"未登录" → 拒绝。
- **Lax 的设计取舍**：它**允许跨站顶层导航 GET 带 Cookie**（保证用户从外部链接点进站点仍是登录态），但**阻止跨站 POST/iframe/img 等**。所以对"转账"这种 POST 操作，Lax 已经足够防 CSRF。
- 若用 `SameSite=Strict` 则连跨站 GET 导航也不带 Cookie（更严，但会影响外链直达体验）。

### 2.3 CSRF Token：服务器校验随机令牌

```
[受害站日志] POST 向hacker 转9999元 | 已登录 | token=FAKE_TOKEN
[结论] 假 token 能否得逞? 否 ✅ (Token 校验拦截)
```

- 注意这里 Cookie **被正常携带了**（已登录）——说明拦截**不是**靠 SameSite，而是服务器校验 token。
- 流程：正常页面加载时，服务器下发一个**随机 token**（存 session + 放表单隐藏字段/请求头）。提交时必须带这个 token，服务器比对通过才执行。
- 攻击站**拿不到 token**（跨域读不了，且 token 是随机的）→ 伪造请求带着假 token（`FAKE_TOKEN`）→ 校验失败 → 拦截。

### 2.4 SameSite=None 必须 Secure（知识点）

```
[登录] Cookie: (空 → SameSite=None 在非 https 下被 Chrome 拒绝!)
[知识点] SameSite=None 必须搭配 Secure（https）才能设置
```

- 想显式允许第三方携带 Cookie（跨站嵌入场景），用 `SameSite=None`——但 **Chrome 强制要求 None 必须配 `Secure`（仅 https）**，否则直接丢弃该 Cookie。
- 这是浏览器刻意的安全设计：**不允许在明文 http 下发送第三方 Cookie**。

### 2.5 防护对比表

| 防护 | 原理 | 实测效果 | 成本 | 局限 |
| ---- | ---- | -------- | ---- | ---- |
| **SameSite=Lax/Strict** | 浏览器按"同站/跨站"决定是否带 Cookie | ✅ 跨站 POST 不带 Cookie | 最低（一行响应头） | Lax 放行跨站顶层 GET；旧浏览器不支持 |
| **CSRF Token** | 服务器下发随机 token 并校验 | ✅ 假 token 被拦 | 中（前后端配合） | 需保证 token 不可预测且不泄露 |
| **校验 Origin/Referer** | 服务器检查请求来源头 | ✅（若攻击站会被识别） | 低 | Referer 可能缺失/被剥离，需配合 Origin |
| 自定义请求头（`X-Requested-With`） | 跨站表单/标签发不出自定义头 | ✅ | 低 | 仅限"从表单/标签发起的攻击"，fetch 可伪造同源……实际跨站 fetch 默认不带凭据 |

## 3. 深入：为什么这样设计？

### 3.1 为什么浏览器"自动带 Cookie"这么危险

Cookie 的设计初衷（1994）是**无状态 HTTP 的会话保持**：服务器靠 Cookie 认出"这是同一个用户"。但"自动携带"这个机制没有考虑"请求是从哪来的"——**浏览器无法知道这个请求是用户主动点的，还是恶意页面偷偷发的**。这是 CSRF 的根源，也是它和 XSS 的本质区别：

- **XSS**：攻击代码在**受害者页面里**执行（能读 Cookie、能改页面）——同源信任被攻破。
- **CSRF**：攻击请求从**攻击者页面**发出（浏览器帮忙带 Cookie）——跨站信任被利用。

> 所以 XSS 能**杀死** CSRF 防护（攻击代码能在受害页里读到 token、改 SameSite 属性、直接以用户身份请求），而 CSRF 反过来不能伤害 XSS。**先防 XSS，再防 CSRF**（关联 [[XSS]]）。

### 3.2 为什么 SameSite=Lax 是"够用的默认"

Chrome 从 80 起**默认把无 SameSite 属性的 Cookie 当 Lax** 处理（实测 2.1 里"无属性"能被攻击，是因为本机测试场景/豁免窗口的特殊性；正式环境现代浏览器默认已挡跨站 POST）。Lax 平衡了：
- **安全**：跨站 POST/iframe/子资源不带 Cookie → 挡住绝大多数 CSRF。
- **体验**：跨站**顶层导航 GET**（用户从搜索引擎/外链点进来）仍带 Cookie → 登录态不丢。

### 3.3 为什么 Token 方案依然必要

SameSite 解决了"浏览器不自动带 Cookie"的问题，但**不是所有场景都靠 Cookie 认证**（JWT 放 localStorage、OAuth token 等）。且 **SameSite 是"浏览器帮忙"**，如果未来浏览器行为变化或攻击者用其他方式（如浏览器插件、恶意软件）就不可靠。**CSRF Token 是服务器主动校验，与浏览器机制无关**——这是纵深防御里"服务端不信任客户端"的体现。

## 4. 规避 / 实践

| 场景 | 做法 |
| ---- | ---- |
| 一切 Cookie 认证的站点 | **`SameSite=Lax`**（现代默认，显式写更稳）；涉及敏感操作可 `Strict` |
| 第三方嵌入场景（跨站 iframe） | `SameSite=None; Secure`（必须 https） |
| 敏感操作（转账/改密） | **CSRF Token**（POST body 或 `X-CSRF-Token` 头）+ 校验 **Origin** |
| 老浏览器（无 SameSite 支持） | 回退 **Token 方案**（不依赖浏览器机制） |
| 重要接口 | 校验 `Origin` 头（比 Referer 更可靠，Referer 可能被 `no-referrer` 剥掉） |
| 全局策略 | 只对**有副作用的操作**（POST/PUT/DELETE）防护；GET 应为幂等只读 |
| 先防 XSS | **XSS 能绕过一切 CSRF 防护**，先堵 [[XSS]] |

```js
// Node/Express 中间件：CSRF Token 校验（简化示意）
const csrf = require('csrf')();
app.use((req, res, next) => {
  res.cookie('csrf-token', csrf.secretSync());      // 下发随机 secret
  res.locals.csrfToken = csrf.create('csrf-secret'); // 渲染进表单隐藏字段
  next();
});
// 提交时校验：req.body._csrf === csrf.create('csrf-secret') 才放行
```

```http
# 响应头：SameSite=Lax（一行挡住跨站 POST 的 CSRF）
Set-Cookie: session=abc123; Path=/; HttpOnly; SameSite=Lax
```

## 5. 面试速记

> **30 秒版**："CSRF 是跨站请求伪造——受害者登录着 A 站，打开攻击者 B 站的页面，B 上的表单/图片自动向 A 发请求，浏览器自动带上 A 的 Cookie，A 看到已登录就执行了转账等操作。根因是 Cookie 自动携带 + 跨站请求不被拦。攻击者读不到响应，只求请求被执行。防护三件套：SameSite Cookie（Lax 拦跨站 POST，实测生效）、CSRF Token（服务器下发随机令牌，攻击者猜不到）、校验 Origin/Referer。注意先防 XSS——XSS 能绕过所有 CSRF 防护。"

## 相关笔记

- [[XSS]] —— XSS 能绕过 CSRF 防护，必须先防；两者常配合利用
- [[CSP]] —— 纵深防御的另一层（拦 XSS 脚本，间接降低 XSS 窃取能力）
- [[CJS，UMD，ESM 的区别]] —— 现代前端框架的依赖来源可信度（供应链攻击与安全）
- [[从浏览器输入网址到页面完整展示全过程]] —— Cookie 在请求/响应链路中的携带时机

*本文档基于 OWASP CSRF 指南、RFC 6265bis（SameSite）及本机 Node v26.8.1 + Chrome CDP 实测整理。验证脚本位于同目录。*
