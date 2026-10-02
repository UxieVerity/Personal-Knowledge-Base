# XSS（跨站脚本攻击）

> **结论：XSS = 攻击者把「代码」注入到受害者页面中执行。** 根因是**「不可信数据被当作代码」**——用户输入/URL 参数/数据库内容等数据，在未转义的情况下被拼进 HTML、插入 DOM 或执行。按注入点分三类：**反射型**（URL 参数 → 服务器拼回 HTML，一次性）、**存储型**（数据存进数据库，每个访问者都中招，最危险）、**DOM 型**（纯前端漏洞，数据不进服务器，在 `innerHTML` 等 DOM 操作处执行）。防护铁律：**输出编码（HTML 转义 / `textContent` / 白名单）是唯一根治，CSP 只是纵深防御的兜底。**
>
> 可运行验证：[[XSS-验证脚本.cjs]]（Node + Chrome CDP 实测：反射型不转义 vs 转义、DOM 型 `innerHTML` vs `textContent`，用 `onerror` 载荷验证攻击是否真的执行）

---

## 1. 背景：XSS 是什么

**跨站脚本（Cross-Site Scripting）**——名字带"跨站"但攻击**不需要跨站**，它发生在**站点自己**：攻击者把自己的脚本注入进别人的页面，在**受害者的浏览器**里以受害者身份执行。

核心成因只有一个：**没有区分「数据」和「代码」**。

| 正常流程 | 被攻击流程 |
| -------- | ---------- |
| 用户输入 `你好` → 页面显示 `你好` | 用户输入 `<script>偷cookie</script>` → 页面把它当 HTML/JS 执行 |
| 输入是「数据」，只该被显示 | 输入被「当成代码」解析 |

浏览器**天生会把 HTML 字符串里的 `<script>`、`onerror` 解析成代码**。所以只要开发者把不可信数据直接塞进 HTML/JS 上下文，就打开了 XSS 大门。

## 2. 实测：三类 XSS 与防护

> 环境：本机 Node v26.8.1 起 HTTP 服务器 + Chrome CDP 打开页面，用真实浏览器验证攻击载荷是否执行。载荷：`<img src=x onerror="window.__pwned=1">`（图加载失败 → 触发 `onerror` → 执行 JS）。

### 2.1 反射型 XSS：服务器拼 HTML 不过滤

```
[反射型·不转义] 攻击执行? 是 🚨 | 页面文本: 你好, ! | img存在
[反射型·已转义] 攻击执行? 否 ✅ | 页面文本: 你好, <img src=x onerror="...">! | 无
```

- **触发链路**：`?name=<img onerror=...>` → 服务器 `res.end('<h1>你好, ' + name + '!</h1>')` → 浏览器解析 HTML → `onerror` 触发 → 攻击代码执行。
- **防护**：服务器输出前做 **HTML 转义**（`<` → `&lt;`），攻击载荷变成**纯文本**显示，不解析、不执行。实测「已转义」页面把 `<img onerror>` 原样显示成文字。
- 特点：**一次性**——受害者的 URL 里就带着攻击载荷，诱导点击链接即中招（常见于搜索框、错误页把输入回显）。

### 2.2 存储型 XSS：数据入库，人人中招

> 与反射型的**唯一区别**是数据来源：反射型来自**请求**，存储型来自**数据库**（上次别人提交的内容）。

- **触发链路**：攻击者提交评论/昵称/文章 `<script>` → 存进数据库 → 任何用户浏览该内容时被渲染执行。
- **最危险**：不需要受害者点特殊链接，**打开正常页面就中招**；且会**持续生效**（数据一直在库里），可被用来做 cookie 窃取、键盘记录、钓鱼弹窗。
- 反射型是「一次性攻击」，存储型是「持久化攻击」，后者危害指数级放大。

### 2.3 DOM 型 XSS：纯前端，数据不进服务器

```
[DOM型·innerHTML]  攻击执行? 是 🚨 | out.innerHTML: <b><img src="x" onerror="..."></b>
[DOM型·textContent] 攻击执行? 否 ✅ | 文本原样显示 | innerHTML: <b>&lt;img src=x ...&gt;</b>
```

- **触发链路**：`?q=<img onerror>` → 前端 JS `el.innerHTML = '<b>' + q + '</b>'` → DOM 解析 → `onerror` 触发。
- **关键**：DOM 型**数据不经过服务器**，服务器日志/WAF 都看不到攻击痕迹，纯粹是**前端代码把不可信数据当 HTML 解析**（`innerHTML`、`outerHTML`、`document.write`、`insertAdjacentHTML` 都是注入点）。
- **防护**：用 **`textContent`**（不解析 HTML，安全）或 `createElement` + 文本节点，实测 `textContent` 下载荷原样显示、`innerHTML` 里被转义成 `&lt;`。**能用 `textContent` 就别用 `innerHTML`**，必须用 `innerHTML` 时先做白名单过滤（如 DOMPurify）。

### 2.4 三类对比表

| 维度 | 反射型 | 存储型 | DOM 型 |
| ---- | ------ | ------ | ------ |
| 数据来源 | URL 参数 / 表单（请求） | 数据库（他人提交） | 前端 `location`/`innerHTML` 等（不进服务器） |
| 服务器是否参与 | ✅ 服务器拼进响应 | ✅ 服务器存+取 | ❌ 纯前端 |
| 触发方式 | 诱导点击恶意链接 | 打开正常页面 | 打开带恶意参数的页面 |
| 持久性 | 一次性 | **持久**（人人中招） | 一次性 |
| 检测难度 | 中（日志可见） | 中 | **高**（服务器无痕） |
| 典型场景 | 搜索框回显 | 评论/昵称/富文本 | SPA 路由参数、`innerHTML` 渲染 |

## 3. 深入：为什么 XSS 防不住？

### 3.1 为什么"转义"能防，但很多人不转义

转义的本质是**告诉浏览器「这是数据，不是代码」**：把 HTML 里特殊字符 `< > & " '` 换成实体。但有两个现实坑：
1. **上下文不同，转义规则不同**：HTML 文本节点要转义 `<>&`，属性值要额外转 `"'`，JS 字符串里要转 `\` 和引号，URL 里要转 `javascript:` 等。**一套转义函数通吃是错的**（比如把 `<` 转义了，但塞进 `onclick="..."` 属性里照样能闭合属性注入）。
2. **框架默认转义，但开发者常用逃逸口**：React/Vue 默认把 `{}` 内容当文本转义，但 `dangerouslySetInnerHTML` / `v-html` 就是逃逸口——**一用就回到裸 HTML**。

### 3.2 为什么 CSP 是兜底而不是根治（关联 [[CSP]]）

CSP 能拦「**没有经过转义的内联脚本/onerror**」这类 XSS（实测见 [[CSP]]：`script-src 'self'` 下 `onerror` 不执行），但：
- 它**拦不住合法用途**——开发者确实需要内联脚本时加上 `unsafe-inline` 就全放开了（等于没防）；
- 它**管不到 DOM 型**里通过 `element.setAttribute` 等「非脚本注入」的某些绕过（虽然多数能拦）；
- **转义是「让数据永远安全」，CSP 是「即便漏了也能挡一层」**——纵深防御，两层都要。

### 3.3 为什么存储型最危险

因为它是**注入一次、执行永久**，且攻击面扩散到**所有访问者**。反射型要靠受害者点链接（有交互），DOM 型要有恶意参数（也是点链接），唯独存储型——**评论区的恶意脚本存进库后，管理员、其他用户打开页面就中招**。历史大案（Samy 蠕虫、MySpace 蠕虫）都是存储型，一个脚本能自我复制传播。

## 4. 框架层面的防御（Vue / React / Element Plus）

> 结论：**Vue 和 React 默认插值（`{{ }}` / `{x}`）都会做 HTML 转义**，XSS 载荷只显示、不执行；**Element Plus 组件（如 `el-input`）的 `v-model` 值也是纯文本**，默认安全。**但逃逸口 `v-html` / `dangerouslySetInnerHTML` 会原样解析 HTML，注入即执行** —— 这是框架给开发者的"后门"，用之前必须自己做白名单过滤。
>
> 可运行验证：[[XSS框架防御-验证脚本.cjs]]（Node + Chrome CDP，CDN 加载 Vue3/React18/ElementPlus，实测 5 个注入点）；demo 见 [[XSS框架防御-demo.html]]

### 4.1 实测：默认转义 vs 逃逸口

> 环境：本机 Node v26.8.1 + Chrome CDP，CDN 加载 Vue 3 / React 18 / Element Plus。载荷：`<img src=x onerror="window.__pwned=1">`。

```
[全局] window.__pwned = 1 🚨 逃逸口执行了 XSS
[Vue  {{  }} 默认插值]   显示: "<img src=x onerror=...>" | 出现 <img> 元素: 否 → ✅ 转义为文本
[React {x} 默认插值]     显示: "<img src=x onerror=...>" → ✅ 转义为文本
[Vue  v-html 逃逸口]     出现 <img> 元素: 是 → 🚨 XSS 执行
[React dangerouslySetInnerHTML] 出现 <img> 元素: 是 → 🚨 XSS 执行
[Element el-input v-model] value = "<img src=x onerror=...>" → ✅ DOM value 纯文本
```

| 框架 | 默认插值 | 结果 | 逃逸口 | 结果 |
| ---- | -------- | ---- | ------ | ---- |
| **Vue 3** | `{{ userInput }}` | ✅ 转义（无 `<img>` 元素） | `v-html` | 🚨 执行（`<img>` 出现 + `__pwned=1`） |
| **React 18** | `{userInput}` | ✅ 转义 | `dangerouslySetInnerHTML` | 🚨 执行 |
| **Element Plus** | `el-input` 的 `v-model` | ✅ 纯文本（DOM value） | — | — |

> **关键读数**：`window.__pwned = 1` 证明逃逸口里的 `onerror` **真的执行了**；而默认插值下攻击载荷只作为**文本字符串**显示（浏览器里看不到 `<img>` 元素）。同样一份数据，插值安全、逃逸口危险——差异全在"框架是否把它当 HTML 解析"。

### 4.2 框架是怎么转义的

- **Vue**：模板里的 `{{ expr }}` 渲染时把字符串经 **HTML 实体转义**（`<` → `&lt;` 等）后作为文本插入；属性绑定 `:attr` 也只写属性值（但注意 `v-bind` 到 `href`/`src` 不会拦截 `javascript:` 协议，仍需自己校验）。
- **React**：`{expr}` 渲染时**把所有字符串转义**，包括 `&<>"'`；JSX 里没有原生的 `innerHTML`，必须显式用 `dangerouslySetInnerHTML`。
- **Element Plus**：基于 Vue，`el-input` 的 `v-model` 最终写入 DOM 的 `input.value`（**属性值，不是 innerHTML**），天然是纯文本；`el-table` 的列渲染同样默认转义。

### 4.3 为什么逃逸口这么危险（和 3.1 呼应）

框架默认转义是"安全默认"，但**逃逸口把判断权还给了开发者**：

- `v-html` / `dangerouslySetInnerHTML` 让框架**跳过转义**，把字符串当 HTML 解析 → **和裸 `innerHTML` 一样**，用户数据里若含 `<img onerror>` 就执行。
- **危险场景**：富文本编辑器、动态模板、拼接 HTML 字符串的代码，最容易把用户数据送进逃逸口。
- **安全用法**：必须用逃逸口时，先过 **DOMPurify**（白名单，只留安全标签），或保证数据源绝对可信（服务端已转义/已过滤）。

## 5. 规避 / 实践

| 场景 | 正确做法 | 错误做法 |
| ---- | -------- | -------- |
| 渲染用户输入到 HTML 文本 | **输出编码**（框架默认即可，React `{}` / Vue `{{ }}` 已转义） | 直接拼字符串 |
| 需要插入 HTML | 白名单过滤（**DOMPurify**），保留安全标签 | `dangerouslySetInnerHTML` / `v-html` 直接上 |
| 插入纯文本 | **`textContent`**（不解析 HTML） | `innerHTML` |
| URL 属性（`src`/`href`） | 校验协议白名单（只允许 `http/https`，拒绝 `javascript:`） | 直接拼用户输入 |
| 富文本编辑器 | 服务端也做一遍过滤 + CSP | 只信前端过滤 |
| 全局兜底 | 上 **CSP**（纵深防御）+ 设置 **HttpOnly Cookie**（防 JS 偷 cookie） | 只靠转义 |
| Cookie | `HttpOnly`（JS 读不到）+ `Secure` + `SameSite` | 裸 cookie |

```html
<!-- 最容易犯的错：innerHTML 直接拼用户输入（DOM XSS） -->
<div id="comment"></div>
<script>
  // 🚨 危险：q 里若含 <img onerror=...> 会执行
  document.getElementById('comment').innerHTML = '<p>' + userInput + '</p>';
</script>
```

```html
<!-- ✅ 安全：textContent 不解析 HTML -->
<script>
  const el = document.createElement('p');
  el.textContent = userInput;   // 原样显示，永不当代码
  document.getElementById('comment').appendChild(el);
</script>
```

```js
// ✅ 服务端输出编码（Node/Express 示例）：HTML 实体转义
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
```

## 6. 面试速记

> **30 秒版**："XSS 就是攻击者把代码注入进页面执行，根因是不可信数据被当成代码。三类：反射型（URL 参数→服务器拼回，一次性）、存储型（进数据库，人人中招，最危险）、DOM 型（纯前端，innerHTML 注入，服务器无痕）。核心防御是输出编码——用框架默认转义、textContent、DOMPurify 白名单，绝不用 innerHTML 拼用户输入；再加 CSP 兜底、HttpOnly Cookie 防偷 cookie。实测不转义时 `<img onerror>` 直接执行，转义或 textContent 后就只显示纯文本。"
>
> **框架追问版**："Vue/React 默认插值（`{{ }}`/`{x}`）都自动转义，实测 `<img onerror>` 只显示为文本不执行；Element Plus 的 `v-model` 走 DOM value 也安全。真正的洞是逃逸口——`v-html`、`dangerouslySetInnerHTML` 会跳过转义原样解析 HTML，注入即执行（实测 `__pwned=1`）。所以铁律：默认插值放心用，逃逸口必须过 DOMPurify 或确保数据绝对可信。"

## 相关笔记

- [[CSRF]] —— XSS 常与 CSRF 配合（XSS 窃取 token / 发起请求）；XSS 能绕过 CSRF 防护
- [[CSP]] —— XSS 的纵深防御：`script-src` 拦截内联/onerror 脚本（实测佐证）
- [[CJS，UMD，ESM 的区别]] —— 现代前端框架（ESM 生态）的转义与依赖安全
- [[XSS框架防御-demo.html]] —— Vue/React/Element Plus 默认转义 vs 逃逸口实测（可交互 demo）
- [[从浏览器输入网址到页面完整展示全过程]] —— 注入的代码在「解析 HTML → 执行 JS」链路中触发的位置

*本文档基于 OWASP XSS 指南及本机 Node v26.8.1 + Chrome CDP 实测整理。验证脚本位于同目录。*
