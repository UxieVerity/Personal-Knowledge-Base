# CJS、UMD、ESM 的区别

> **结论：三者是 JS 模块化的三个时代（前面还有一个"零时代" IIFE）。** IIFE 是模块化**之前**浏览器最原始的封装——立即执行函数 + 闭包私有 + 挂全局变量，无加载器无依赖管理；CJS（CommonJS）是 **Node 服务端的同步模块系统**（`require`/`module.exports`，运行时动态解析，自带缓存单例）；ESM（ES Modules）是 **JS 语言标准里的静态异步模块系统**（`import`/`export`，编译期解析，支持 tree-shaking、live binding、顶层 await）；UMD **不是规范，是一种「环境检测三选一」的兼容包装**，让同一个库在 Node(CJS)、AMD(RequireJS) 和浏览器全局变量三种环境都能加载。核心区别一句话：**IIFE 只解决「不污染全局 + 私有化」，CJS 是动态的（运行时才知道导出了什么），ESM 是静态的（编译期就定死）——静态是 tree-shaking 与快速并行加载的前提，动态是灵活性但牺牲了可摇树。**
>
> 可运行验证：[[cjs，umd，esm的区别-验证脚本.cjs]]（Node 26 实测：加载导出、缓存单例、live binding、静态提升、顶层 await、链接期报错、循环引用、IIFE 闭包私有、UMD 环境检测、esbuild tree-shaking 体积对比）

---

## 1. 背景：三个时代

| 系统 | 诞生 | 由谁定义 | 适用环境 | 一句话 |
| ---- | ---- | -------- | -------- | ------ |
| **IIFE** | 2000s 早期（非规范，模式） | 社区约定 | 浏览器（模块化之前） | 立即执行函数 + 闭包私有 + 挂全局 |
| **CJS** (CommonJS) | 2009 | Node.js | Node 服务端 | 同步 `require`，运行时动态导出 |
| **AMD** | 2011 | RequireJS | 浏览器（异步加载） | `define`/`require([...])`，为浏览器异步而生 |
| **UMD** | 2014 前后 | 社区约定（非规范） | 全环境 | 检测环境三选一（CJS/AMD/全局变量） |
| **ESM** | 2015 (ES6) | ECMAScript 标准 | 浏览器 + Node | 静态 `import`/`export`，语言标准 |

- **IIFE（立即执行函数表达式）** 是模块化体系出现前，浏览器里靠**函数作用域**做的"伪模块"：`(function(){ ... })()` 立即执行，内部变量被闭包捕获、外部访问不到，只把公开 API 挂到 `window`。典型代表如 jQuery 插件模式 `(function($){ ... })(jQuery)`。**没有加载器、没有依赖声明、没有缓存**——靠手动 `<script>` 顺序保证依赖先加载，靠命名约定避免全局冲突。
- **AMD** 是为浏览器异步加载设计的（RequireJS），曾与 CJS 分裂社区。**UMD 就是为了弥合这个分裂**：一个包装函数检测当前环境，决定走 `module.exports`（Node）、`define.amd`（RequireJS）还是挂 `globalThis`（浏览器裸 script）。
- **ESM 是语言标准**，浏览器原生支持（`<script type="module">`），Node 从 12 起逐步原生支持，如今（Node 20+ / 26）**已是唯一推荐**。

## 2. 实测：关键行为对比

> 环境：本机 Node v26.8.1，同一目录下的 `.cjs`/`.mjs`/UMD `.js` 模块，`node "cjs，umd，esm的区别-验证脚本.cjs"` 一次跑完。

### 2.1 加载、导出与顶层 this

| 行为 | IIFE | CJS | ESM | UMD（Node 下） |
| ---- | ---- | --- | --- | -------------- |
| `add(1,2)` | `3`（挂全局） | `3`（`require` 同步返回） | `3`（`import` 静态加载） | `3`（走了 CJS 分支） |
| 顶层 `this` | `globalThis`（严格模式为 `undefined`，靠参数注入） | `=== module.exports`（**true**） | `undefined`（严格模式） | — |
| 加载方式 | 脚本立即执行，同步 | 同步 `require()` | 异步：静态 `import` 构建模块图、动态 `import()` 返回 **Promise** | 同步 `require`（检测到 CJS） |
| 私有状态 | ✅ 闭包私有（`count` 外部拿不到） | ❌ 无私有（导出对象全暴露） | ❌ 无私有（export 什么暴露什么） | ❌ 无私有 |

> **实测（闭包私有）**：IIFE 里 `count` 被 `bump()` 改了两次后，外部 `iife.count` 是 `undefined`（访问不到），只有 `iife.getCount()` 能读到 `2`。**IIFE 是唯一真正有"私有变量"的方案**——靠闭包。CJS/ESM 没有私有，`module.exports`/`export` 暴露什么外部就拿到什么（当然也可以用 `#` 私有字段或 `WeakMap` 自己实现）。

### 2.2 模块缓存（单例）

```
[CJS] require 两次是否同一对象? true
[CJS] require.cache 命中条目: 1
```

- **CJS 和 ESM 都按路径缓存（单例）**：同一个模块多次 `require`/`import` 只执行一次，后续拿缓存。
- 区别在**机制**：CJS 用 `require.cache` 对象（运行时可见、可清空、可操纵）；ESM 的缓存由模块加载器内部管理，规范层面不可见不可操纵。

### 2.3 live binding：CJS 拿对象 vs ESM 拿绑定

```
[CJS] 初始 value = 1   → 80ms 后 value = 999  (模块内部改 exports 属性，拿到同一对象)
[ESM] 初始 value = 1   → 80ms 后 value = 999  (live binding，绑定本身更新)
```

- **CJS**：`require` 返回的是 `module.exports` 对象的**引用**。模块内部改自己的导出对象属性，外部能看到——因为大家指向同一个对象。但这是「改对象的属性」，不是「改绑定」。
- **ESM**：`import { value }` 拿的不是副本，而是**指向模块内部变量的 live binding**。模块内部 `value = 999` 改的是绑定本身，外部 `value` 同步变成 999。**规范要求 import 到的名字永远与源模块的最新值一致**（哪怕值是 `undefined`，只要模块还没初始化）。
- 实测两者表现相同（1→999），但**本质不同**：CJS 是"同一个对象"，ESM 是"活绑定"——差异在循环引用场景下才会真正显现（见 2.7）。

### 2.4 静态提升（import hoisting）

```
[hoisted-demo] 在 import 语句文本位置之前使用导入: add(20, 22) = 42
```

- **ESM 的 `import` 会被提升到模块顶部**：即使在文件最顶部（import 语句**之前**）使用导入的值也合法。因为 ESM 是**链接期（link time）**解析，所有 `import` 在模块执行前就已绑定完成。
- **CJS 没有提升**：`require()` 是运行时函数调用，在它之前的代码拿不到模块——必须在调用之后。

### 2.5 顶层 await（Top-level await）

```
[ESM] 顶层 await 拿到数据 = TLA-DATA-42
```

- **ESM 支持顶层 `await`**（ES2022 正式进标准）：模块顶层可以直接 `await`，模块变成一个异步模块，依赖它的模块会等它 resolve。
- **CJS 不支持**：`module.exports` 是同步完成的，`require` 也是同步的，没有"挂起"的语义。想用 await 必须包 `async function`。
- 这也是前面提到的坑：一个文件里同时出现顶层 `await` 和 `require`，Node 会报 `ERR_AMBIGUOUS_MODULE_SYNTAX`，无法判断模块格式。

### 2.6 链接期静态校验

```
[bad-import] 抛错: The requested module './math-util.mjs' does not provide an export named 'nope'
```

- **ESM 在链接期（模块执行前）就校验导出是否存在**：`import { nope }` 一个不存在的导出，整个模块图直接拒绝加载，**根本不会执行**。
- **CJS 不会**：`require('./x').nope` 只是一个普通属性访问，运行到那一行才返回 `undefined`。写错不报错，只有用到时才露馅。这就是"编译期安全"与"运行时容忍"的差异。

### 2.7 循环引用：CJS 容忍部分执行 vs ESM 的 TDZ

```
[cycle] b.cjs 中 a.done = undefined   ← a 还没执行完，拿到"部分执行"的对象
[cycle] b.cjs 结束
[cycle] a.cjs 开始执行, a.done = true ← a 此时才执行完
```

- **CJS**：循环引用时，`require` 返回**尚未执行完的模块的当前（部分）状态**。Node 用"先填充空对象，执行完再填"的策略，所以 b 里读 `a.done` 得到 `undefined`（a 还没跑到 `exports.done = true`）。**不会死循环、不报错，但拿到的是不完整数据**——这是 CJS 为"同步 + 缓存 + 容忍循环"付出的代价。
- **ESM**：循环引用下，导入的名字在源模块**初始化完成前是 TDZ（暂时性死区）**，访问会抛 `ReferenceError`。规范用 live binding + 挂起等待保证**不会拿到半初始化状态**，但也意味着"在模块初始化完成前用它"会直接报错。

### 2.8 IIFE：模块化之前的"伪模块"

```
[IIFE] add(1,2) = 3 | name = iife-module
[IIFE] 私有 count 外部访问 = undefined   ← 闭包私有，外部拿不到
[IIFE] getCount() = 2                    ← 只有公开方法能读到闭包内 count
[IIFE] 依赖注入 = injected-dependency    ← 全局依赖作为参数显式传入
```

核心形态（本目录 `math-util-iife.js`）：

```js
(function (global) {
  'use strict';
  var count = 0;                    // 私有：被闭包捕获
  function add(a, b) { return a + b; }
  // ...
  global.MathUtilIIFE = { add, getCount /* 只暴露公开 API */ };  // 挂全局
})(typeof globalThis !== 'undefined' ? globalThis : this);
```

- **它是"模块化之前"的方案**：靠函数作用域隔离、闭包私有、挂全局暴露，**没有导出系统、没有依赖声明、没有缓存**。
- 依赖靠**注入**：jQuery 插件 `(function($){ ... })(jQuery)` 就是 IIFE + 依赖注入，比裸全局更可控。
- 最大痛点：**全局命名空间冲突**、**加载顺序靠手动** `<script>` 排列、**无法声明依赖关系**。这些痛点正是 CJS/AMD/ESM 要解决的。

### 2.9 UMD：环境检测三选一

```
[UMD/CJS 环境] add(1,2) = 3 | name = umd-module
```

UMD 包装的核心（本目录 `math-util-umd.js`）：

```js
(function (root, factory) {
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory();          // ① Node / CommonJS
  } else if (typeof define === 'function' && define.amd) {
    define([], factory);                 // ② AMD (RequireJS)
  } else {
    root.MathUtilUMD = factory();        // ③ 浏览器全局变量
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  return { /* 库的导出 */ };
});
```

- 实测在 Node 下走了 **① CJS 分支**（检测到 `module.exports` 存在）。
- 在浏览器裸 `<script>` 下会走 ③ 挂到 `window.MathUtilUMD`；在 RequireJS 下走 ②。
- 如今 **webpack/rollup/esbuild 打包时都会自动生成这种 UMD 外壳**，库作者通常不用手写。

### 2.10 tree-shaking：ESM 可摇树 vs CJS 全保留

```
[tree-shaking] ESM 打包体积 = 0.05 KB, 含 subtract 次数: 0   ← subtract 被摇掉
[tree-shaking] CJS 打包体积 = 0.32 KB, 含 subtract 次数: 1   ← 全保留
```

- 同一个只用了 `add(1,2)` 的入口（`tree-esm-entry.mjs` vs `tree-cjs-entry.cjs`），用 esbuild 打包 minify：**ESM 0.05KB（subtract 出现 0 次）vs CJS 0.32KB（subtract 出现 1 次）**，体积差 **~6.4×**。
- 原因：ESM 的 `export` 是静态声明，打包器能确定 `subtract` 没被 import → 整段删掉；CJS 的 `module.exports` 是动态对象，打包器**无法证明** `subtract` 没被用到 → 全保留。库越大、实际用到的越少，差距越夸张。

## 3. 核心区别：一句话表

| 维度 | IIFE | CJS (CommonJS) | ESM (ES Modules) | UMD |
| ---- | ---- | -------------- | ---------------- | --- |
| 性质 | 模式（非规范） | Node 运行时的模块系统 | **语言标准** | 兼容包装（非规范） |
| 语法 | `(function(){ ... })(...)` + 挂全局 | `require` / `module.exports` / `exports.x` | `import` / `export` / `export default` | 环境检测 + `factory()` |
| 解析时机 | 立即执行 | **运行时**（动态） | **编译期/链接期**（静态） | 运行时 |
| 加载 | 同步（手动 `<script>`） | **同步** | **异步**（模块图构建） | 同步（取决于走哪个分支） |
| 私有变量 | ✅ 闭包私有 | ❌ | ❌ | ❌ |
| 缓存 | ❌ 无（每次重新执行） | `require.cache`（可见可清） | 内部管理（不可见） | 依分支 |
| live binding | ❌ | ❌ 拿对象引用 | ✅ 活绑定 | ❌ |
| 静态提升 | ❌ | ❌ | ✅ | ❌ |
| 顶层 await | ❌ | ❌ | ✅（ES2022） | ❌ |
| 导入不存在导出 | ❌ 无导入概念 | 运行时 `undefined`（不报错） | **链接期报错**（不执行） | 依分支 |
| 循环引用 | ❌ 无加载器 | 容忍部分执行（拿到半成品） | TDZ，未初始化即用报错 | 依分支 |
| 条件导入 / 动态路径 | ✅（任意） | ✅（`if` 里 `require`、变量路径） | ❌（`import` 必须顶层静态） | ❌ |
| tree-shaking | ❌ | ❌ 基本无效 | ✅ 完全支持 | ❌ |
| 浏览器原生 | ✅ 裸 script 可用 | ❌（需打包） | ✅ `<script type="module">` | ✅ 裸 script 可用 |
| 依赖管理 | ❌ 手动 `<script>` 顺序 | ✅ `require` 声明 | ✅ `import` 声明 | 依分支 |
| 使用建议 | 历史遗留（内联脚本/老库） | 历史遗留 / Node 老库 | **现代唯一推荐** | 发布给"什么环境都可能"的库 |

## 4. 深入：为什么这样设计？

### 4.0 为什么 IIFE 是"零时代"的必然选择？

在 ES6 之前，JS **没有语言级的模块机制**，浏览器里所有 `<script>` 共享同一个全局作用域。直接裸写的话，每个文件定义的 `var`、函数都会挂到 `window`——**变量名一旦撞车，后者覆盖前者，悄无声息**。IIFE 用函数作用域解决了两件事：

1. **不污染全局**：`(function(){ ... })()` 里的一切只活在函数内部，不会漏到 `window`。
2. **闭包私有**：函数内部的 `var count` 被闭包捕获，外部永远拿不到，只能通过返回的公开方法操作（实测 `iife.count === undefined`，只有 `getCount()` 能读）。这是模块化里"私有性"的第一次实现。

但它**治标不治本**：没有导出系统、没有依赖声明、没有加载器，靠手动 `<script>` 顺序 + 命名约定来维系。当应用规模变大（多文件、复杂依赖），这种"全局命名空间约定"必然崩塌——**这正是 CJS/AMD/ESM 出现的根本动力**。所以理解 IIFE，就是理解"模块化到底解决了什么问题"。

### 4.1 为什么 CJS 是同步的？

Node 诞生时（2009）面向**服务端**：模块从本地磁盘读取，`readFileSync` 毫秒级返回，同步无感知。而且 CJS 设计成 `require` 是个**普通函数**——可以放 `if` 里、可以用变量路径、可以运行时决定加载什么，极度灵活。代价就是：**因为是函数调用 + 动态对象，导出的内容运行时才能确定** → 打包工具没法静态分析出"你只用到了哪个函数" → **tree-shaking 失效**。

### 4.2 为什么 ESM 必须静态 + 异步？

ESM 诞生于浏览器语境，解决 CJS 的两大问题：

1. **异步**：浏览器加载模块要经过**网络**（不像本地磁盘），不可能同步阻塞。所以 ESM 是异步构建模块图——这也是为什么 `import` 语句要求顶层、为什么动态 `import()` 返回 Promise。
2. **静态**：让 `import`/`export` 成为**语法结构**（编译期可知），从而：
   - **tree-shaking**：打包器能精确知道"这个模块只用 `add`，`subtract` 可以删"，按需打包（实测见 2.10）；
   - **快速并行加载**：所有依赖在模块执行前就并行 fetch 好，无嵌套串行等待；
   - **链接期校验**：导出不存在直接报错，错误前置。

### 4.3 为什么 ESM 用 live binding 而不是拷贝？

循环引用下，如果 `import` 是拷贝，A↔B 相互引用时 B 拿到的 A 永远是"半成品"（像 CJS）。**live binding**（活绑定）让每个模块在初始化完成后，所有引用方自动看到最新值；配合 **TDZ**（未初始化前访问报错，而不是给垃圾值），既安全又支持循环依赖。这是 ESM 比 CJS 更健壮的设计——但代价是引入 TDZ 这个新的出错点。

### 4.4 为什么会有 UMD 这种东西？

因为**历史的分裂**：Node 用 CJS，浏览器端 RequireJS 推 AMD，还有人直接裸 `<script>` 用全局变量。库作者想让"一个包在哪儿都能用"，就得手写判断。UMD 本质是**打包工具的兼容层**，是 ESM 统一江湖**之前**的过渡产物。如今 ESM 是标准、Node 和浏览器都原生支持，新库（除需要兼容老环境的）**不再需要 UMD**。

### 4.5 为什么 tree-shaking 是 ESM 的杀手锏（实测见 2.10）

ESM 的 `export` 是**静态声明**，打包器在编译期就能确定 `subtract` 没被任何 `import` 引用 → 整段删除。CJS 的 `module.exports` 是**运行时动态对象**，打包器无法证明 `subtract` 没被用到 → 全保留。实测同样只用 `add(1,2)` 的入口：**ESM 0.05KB vs CJS 0.32KB，差 ~6.4×**（见 2.10 完整输出）。这是**静态分析**带来的核心收益，也是现代前端体积优化（按需引入 lodash 等）的地基。

## 5. 规避 / 实践

| 场景 | 做法 |
| ---- | ---- |
| 新项目写库/写业务 | **只用 ESM**（`"type": "module"`，Node 20+ 原生） |
| 老浏览器 / 内联脚本 / 老库（jQuery 插件时代） | **IIFE**（裸 `<script>` 直接可用，但别手动管依赖） |
| 需要兼容老 Node / 老打包链 | 源码写 ESM，交给 **打包器输出 CJS/UMD**（webpack `output.library.type`、rollup `output.format`） |
| 发 npm 包给"什么环境都可能"的用户 | 打包成 **UMD + ESM + CJS 三份**（`exports` 字段分流：`"import"` / `"require"` / `"default"`） |
| 想用 tree-shaking | 必须 ESM 入口（`package.json` `exports` 里 `import` 指向 `.mjs`） |
| 需要条件/动态加载 | 用 **`import()`**（动态 import 在 ESM 里也是 Promise，可用于代码分割） |
| 老代码的 CJS | 可以 `import cjsModule from './x.cjs'`（Node 的 CJS/ESM 互操作：CJS 可被 ESM import，反之 `require` ESM 需要 `--experimental-require-module` 或 `createRequire`） |

```jsonc
// package.json —— 同时给 ESM 和 CJS 消费者分流（bundler 优先走 import 字段）
{
  "name": "my-lib",
  "type": "module",            // 本包默认按 ESM 解析
  "main": "./dist/index.cjs",  // 老工具兜底
  "exports": {
    "import": "./dist/index.mjs",  // ESM 消费者（可 tree-shaking）
    "require": "./dist/index.cjs"  // CJS 消费者
  }
}
```

```html
<!-- 浏览器：模块脚本 vs 传统脚本 -->
<script type="module" src="main.js"></script>   <!-- ESM：默认 defer、支持 import、CORS 跨域 -->
<script nomodule src="legacy.js"></script>      <!-- 老浏览器回退（UMD/传统脚本） -->
```

## 6. 面试速记

> **30 秒版**："模块化演进有个'零时代'——IIFE，用立即执行函数 + 闭包私有 + 挂全局，解决不污染全局和私有化，但没有依赖管理，靠手动 script 顺序。然后 CJS 是 Node 的同步模块系统，`require` 是运行时函数，动态解析、带缓存单例、`this === module.exports`，但运行时才知道导出啥 → 没法 tree-shaking，循环引用还会拿到半成品。ESM 是语言标准，`import`/`export` 静态解析、异步加载模块图，支持 tree-shaking（实测同样只用一个函数，ESM 0.05KB vs CJS 0.32KB，差 6.4 倍）、live binding、顶层 await、链接期就能发现导入不存在的导出。核心区别就是'动态 vs 静态'。UMD 不是规范，是 CJS/AMD/全局变量三选一的环境检测包装，ESM 统一之前的历史产物，现在新代码用 ESM 就行。"

## 相关笔记

- [[process.nextTick()]] —— Node 模块执行与事件循环的微任务细节（CJS 是 Node 的模块机制）
- [[浏览器事件循环(EventLoop)]] —— ESM 异步模块加载 / 动态 `import()` 在事件循环中的调度位置
- [[宏任务（task）]] / [[微任务（microtask）]] —— `import()` 返回 Promise、顶层 await 的异步语义
- [[从浏览器输入网址到页面完整展示全过程]] —— `<script type="module">` 与普通脚本在网络链/渲染链中的加载差异

*本文档基于 ECMAScript 2022+（ES Modules 规范）、CommonJS 规范（Node.js 文档）及本机 Node v26.8.1 + esbuild 实测整理。验证脚本与全部夹具文件位于同目录。*
