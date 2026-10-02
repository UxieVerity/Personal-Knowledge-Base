# Grunt / Gulp / Webpack / FIS / Rollup 的异同

> **结论：五个工具分属「两代范式」。** **grunt / gulp 是「任务运行器」（Task Runner）**——把文件当**流**搬运、转换、合并，**不理解模块依赖图**（不做依赖解析、不做 tree-shaking、不产出"打包后"的单文件）；**webpack / rollup 是「模块打包器」（Bundler）**——从入口出发**解析整个模块依赖图**，产出可运行的打包产物（支持 tree-shaking、代码分割）。**fis 是百度系「一体化工程方案」**（资源定位 + 依赖声明 + 打包 + 发布），是"模块打包器"思想的国产早期实现，对应今天的 webpack 全家桶。演进主线：**grunt（2012，任务流）→ gulp（2014，代码即配置的流）→ webpack（2014，模块图）→ rollup（2015，ESM 库打包）→ vite（2020，基于 ESM 的开发服务器）**。
>
> 可运行验证：[[构建工具-验证脚本.cjs]]（同一份源码 `src/index.mjs` 分别跑 rollup / webpack / gulp，对比产物：gulp 原样拷贝 221B、rollup 摇掉 unused、webpack 压缩到 46B）；实验目录 [[_build-tools-lab]]

---

## 1. 背景：构建工具的演进史

| 工具          | 发布   | 定位         | 配置风格                             | 时代背景                                 |
| ----------- | ---- | ---------- | -------------------------------- | ------------------------------------ |
| **Grunt**   | 2012 | 任务运行器      | JSON 配置（`grunt.initConfig`）      | 前端工程化萌芽，把"压缩/合并/编译"脚本化               |
| **Gulp**    | 2014 | 任务运行器      | **代码即配置**（`gulp.task` + 管道）      | 流式处理，内存中管道，比 grunt 快、可读              |
| **Webpack** | 2014 | 模块打包器      | 配置对象（`module.rules` / `plugins`） | 前端应用变复杂，需要**模块系统 + 依赖图**             |
| **FIS**     | 2013 | 一体化工程方案    | 资源定位 + 声明依赖 + 命令                 | 百度内部工程实践开源，国产早期"全家桶"                 |
| **Rollup**  | 2015 | 模块打包器（库）   | 配置对象（`input` / `output`）         | ES Module 规范出现，追求**极致 tree-shaking** |
| **Vite**    | 2020 | 开发服务器 + 打包 | 基于原生 ESM                         | 依赖预构建（esbuild）+ 浏览器原生 ESM 热更新        |

- **grunt/gulp 解决的是"把一堆文件做批处理"**：压缩 JS、编译 Sass、合并文件、监听变化。它们**不管模块依赖**——你给它 5 个文件，它按你配置的顺序处理，不会分析这 5 个文件谁 import 谁。
- **webpack/rollup 解决的是"模块系统"**：你给它一个入口文件，它顺着 `import` 语句**自动找到所有依赖**，构建出**依赖图**，再输出成浏览器能跑的一个（或多个）文件。**模块间的关系由代码声明，不是由配置手动排列**。
- **vite 是最新范式**：开发时用浏览器原生 `import`（不用打包，秒级冷启动），构建时用 rollup 打包。它是"模块打包器"思想的当代演进。

## 2. 实测：同一源码，三种工具的产物差异

> 环境：本机 Node v26.8.1，`_build-tools-lab/` 局部安装 webpack 5 / rollup 4 / gulp 5。源码 `src/index.mjs` 导出 `used` / `unused` / 默认 `main`（`unused` 未被任何地方使用）。分别用三个工具打包，对比产物。

### 2.1 产物对比表

| 工具          | 产物示例                                             | 大小       | tree-shaking | 模块图 | 定位    |
| ----------- | ------------------------------------------------ | -------- | ------------ | --- | ----- |
| **gulp**    | 源码原样（含 `unused` 导出和注释）                           | **221B** | ❌ 无          | ❌ 无 | 任务运行器 |
| **rollup**  | 摇掉 `unused` 的 ESM                                | 202B     | ✅ 有          | ✅   | 库打包器  |
| **webpack** | `(()=>{"use strict";console.log("used-fn")})();` | **46B**  | ✅ 有（+minify） | ✅   | 应用打包器 |

```
[gulp]    tree-shaking 掉 unused? 否 ❌（原样保留，含注释）| 产物与源码一致: 是 ✅（无任何转换）
[rollup]  tree-shaking 掉 unused? 是 ✅ | 产物保留: used ✅ | main ✅
[webpack] tree-shaking 掉 unused? 是 ✅ | 产物: (()=>{"use strict";console.log("used-fn")})();
```

### 2.2 三个关键读数

1. **gulp 产物 = 源码原样**：221 字节，`unused` 和注释一个不少。因为 gulp 只是把文件从 `src()` 流到 `dest()`，**它看不懂 `import/export`**，把代码当纯文本流搬运。真实的 gulp 项目靠**插件**（`gulp-uglify`、`gulp-babel`）逐个文件处理，但**永远不会自动树摇/打包**。
2. **rollup 摇掉 unused**：202 字节，`unused` 函数被移除——因为 rollup 解析了模块图，知道 `unused` 没被 import。**库打包场景 rollup 是王者**（ESM 输出 + tree-shaking，适合发 npm 包）。
3. **webpack 极致压缩**：46 字节，连 `main()` 都被内联成 `console.log("used-fn")`——production 模式把 tree-shaking + minify 全开了。**应用打包场景 webpack 是王者**（代码分割、懒加载、处理 css/图片等一切资源）。

## 3. 核心区别：一句话表

| 维度 | Grunt | Gulp | FIS | Webpack | Rollup |
| ---- | ----- | ---- | --- | ------- | ------ |
| 类别 | 任务运行器 | 任务运行器 | 一体化工程 | 模块打包器 | 模块打包器 |
| 核心抽象 | **任务（task）** | **流（stream）** | 资源定位+依赖 | **模块依赖图** | 模块依赖图 |
| 是否解析 import/export | ❌ | ❌ | 部分（依赖声明） | ✅ | ✅ |
| tree-shaking | ❌ | ❌ | 打包阶段有 | ✅（ESM 源码） | ✅（最彻底） |
| 代码分割/懒加载 | ❌ | ❌ | 打包支持 | ✅（强项） | ⚠️ 弱（手动） |
| 产物 | 处理后的一堆文件 | 处理后的一堆文件 | 打包+带指纹发布 | 一个/多个 bundle | 单个 bundle（通常 ESM） |
| 配置风格 | JSON 声明 | **代码**（管道） | 目录约定+配置 | JS 配置对象 | JS 配置对象 |
| 处理资源类型 | 需插件 | 需插件 | 内置静态资源 | **一切**（js/css/img/font） | 需插件（以 js 为主） |
| 典型场景 | 老项目批处理 | 老项目/流式转换 | 国内老项目/发布 | **Web 应用** | **npm 库/组件** |
| 现状 | 已淘汰 | 基本淘汰 | 已淘汰 | **仍在用（v5）** | **仍在用（v4）** |
| 当代继承者 | — | — | — | vite 构建时 | vite 构建时 |

> 一句话：**grunt/gulp 管"文件流"，webpack/rollup 管"模块图"，fis 是国内早期的"全家桶打包"。** 前两个是"任务编排"思维，后三个是"模块图构建"思维——这是最大的代差。

## 4. 深入：为什么这样设计？

### 4.1 为什么 grunt/gulp 不做模块解析（历史的必然）

2012-2014 年，前端还没有 ES Module（2015 才进标准），代码用 `<script>` 标签按顺序引入。**当时根本不存在"模块图"这个概念**——每个文件就是普通 JS，靠全局变量通信。所以 grunt/gulp 的任务就是"把文件压缩、合并、编译"就够了。**它们的局限不是设计失误，而是时代的局限**——当 2014 年 CommonJS/AMD 在浏览器里流行、前端代码开始 `require` 依赖时，"任务运行器"立刻不够用了，webpack 应运而生。

### 4.1.1 为什么 grunt/gulp 最终被淘汰（两股力量夹击）

> 关键认知：**真正"干掉" gulp 的不是 webpack 单独一个，而是「npm scripts + 打包器」两股力量夹击**——webpack 和 gulp 根本不是同一维度的工具，谈不上直接替代。

```
gulp 的两大职责         被谁取代
─────────────────────────────────────────────
① 任务编排（定义/串行/并行）  →  npm scripts（package.json 的 "scripts" 字段）
② 文件构建（压缩/合并/编译）  →  webpack/vite（loader/plugin 全家桶自带）
```

- **职责① → npm scripts**：现代项目 `"scripts": { "build": "tsc && vite build", "dev": "vite" }` 就够了——编排任务不需要引入一个任务运行器，**npm scripts 零依赖、跨平台（配合 cross-env）**。
- **职责② → 打包器内置**：gulp 要靠插件（`gulp-uglify`、`gulp-concat`、`gulp-sass`）拼装的"压缩/合并/编译"，webpack 的 loader/plugin 体系、dev server、watch 全部内置且更强大。
- **结论**：新项目里 gulp 的任务被 npm scripts 和 vite/webpack 瓜分殆尽，所以**不再需要**。但注意是"职责被瓜分"，不是"被 webpack 这一个工具打败"——这是面试里能体现深度的分层回答。

> **gulp 还剩什么用**：① 纯文件批处理（不涉及模块依赖，如生成雪碧图、批量整理静态资源）；② 非 JS 生态的 CSS/图片工作流；③ 老项目维护（2016-2019 大量 gulp+webpack 混用工程）。**新项目确实没必要用**——vite 或 npm scripts 已覆盖 99% 场景。

### 4.2 为什么 webpack 能成为主流（模块图 + 一切皆模块）

webpack 的杀手锏是 **`module` 概念**：把**每个文件**（js/css/图片/字体）都当"模块"，用 loader 把它们转成 JS 能处理的形态，再用一个统一的**模块运行时**在浏览器里加载。好处：
- **依赖自动解析**：你不用手动排 `<script>` 顺序，`import` 声明即依赖。
- **代码分割**：`import()` 动态加载 → 按路由/按需分包，首屏只加载要用的。
- **处理一切资源**：css-loader/style-loader 把 css 也"打包"进 js（或抽离成文件），图片可内联成 base64。
代价：**配置复杂**（loader/plugin 生态庞大）、**产物含运行时样板**（所以上面 webpack 46B 反而比 rollup 小，是因为极致压缩掩盖了运行时——真实项目里 webpack 产物通常带一段模块加载器代码）。

### 4.3 为什么 rollup 更适合库（tree-shaking 的极致）

rollup 诞生于 ES Module 标准落地时，设计目标就是**库**：输出**干净的 ESM**，`export` 原样保留，让**使用方（如 webpack）再做一次 tree-shaking**。它不搞代码分割/加载器那套（那是应用场景），专注把 ESM 打包得最小、最干净。**所以生态规律：库的作者用 rollup 发 npm 包，应用的作者用 webpack/vite 消费它**——两者是上下游关系。

### 4.4 为什么 fis 是"一体化"而不是单一工具

fis 解决的不是"打包"一个环节，而是**整个前端工程的发布链路**：资源定位（`__uri()` 自动加版本指纹）、依赖声明（`__inline` 内联）、打包合并、MD5 指纹、CDN 部署。它像"webpack + 发布工具"的合体，适合**多页应用 + 强发布诉求**（国内 2014-2017 年的典型场景）。局限：不够通用、生态封闭、对现代 SPA 支持弱，最终被 webpack 生态取代。

### 4.5 为什么 vite 用原生 ESM（当代演进）

vite 看清了 webpack 的痛点：**大型项目冷启动要打包整个依赖图，几秒到几十秒**。vite 开发时**不打包**——直接让浏览器用原生 `import` 按需加载模块，只需用 esbuild 预构建 node_modules 的依赖（快 10-100 倍），配合 HMR 秒级热更新。构建时再用 rollup 做一次正式打包。**这是"模块打包"思想在"开发/构建"两阶段的拆分**。

## 5. 规避 / 实践

| 场景 | 选谁 | 原因 |
| ---- | ---- | ---- |
| 现代 Web 应用（SPA） | **Vite**（开发）+ 底层 rollup | 秒级冷启动 + 原生 ESM HMR + 构建产物好 |
| 老项目维护（webpack 4/5 工程） | **Webpack** | 生态最全、插件多、文档多，改造风险小 |
| 写 npm 库 / 组件库 / 纯 JS 库 | **Rollup** | 输出干净 ESM，tree-shaking 彻底，方便消费方摇树 |
| 只需要"压缩/编译/合并/监听"批处理 | **Gulp**（或直接写 Node 脚本） | 轻量、任务编排直观；但现在多数场景 vite/webpack 已覆盖 |
| 国内老的多页应用 + 发布需求 | 理解 **FIS** 的历史定位即可 | 已淘汰，迁移到 vite/webpack |
| 新项目起步 | **Vite** | 官方脚手架（create-vue / create-react-app 新版）默认 |

```js
// gulp：任务运行器思维 —— 定义"任务"，把文件流式处理
const gulp = require('gulp');
const uglify = require('gulp-uglify');
gulp.task('js', () => gulp.src('src/**/*.js')
  .pipe(uglify())          // 管道：压缩
  .pipe(gulp.dest('dist'))); // 输出
// 局限：uglify 逐个文件压缩，不做模块合并/依赖解析/tree-shaking
```

```js
// rollup：模块打包器思维 —— 入口 + 依赖图
// rollup.config.mjs
export default {
  input: 'src/entry.mjs',   // 从入口开始，顺 import 找依赖
  output: { file: 'dist/lib.js', format: 'esm' },  // 输出干净 ESM
};
// 产物自动 tree-shaking：没被 import 的导出会被删除（实测 unused 被摇掉）
```

```js
// webpack：应用打包器思维 —— 一切皆模块 + 代码分割
// webpack.config.js
module.exports = {
  entry: './src/main.js',
  output: { filename: '[name].[contenthash].js' },
  module: { rules: [{ test: /\.css$/, use: ['style-loader', 'css-loader'] }] },
  optimization: { splitChunks: { chunks: 'all' } },  // 代码分割
};
```

## 6. 面试速记

> **30 秒版**："构建工具分两代。grunt/gulp 是任务运行器——把文件当流搬运转换，压缩合并监听，但**不做模块依赖解析、不做 tree-shaking**，产物就是处理过的原文件（实测 gulp 原样拷贝 221B，unused 一个不少）。webpack/rollup 是模块打包器——从入口解析 import 依赖图，产出打包产物，支持 tree-shaking（实测 rollup 摇掉 unused，webpack 压缩到 46B）。fis 是百度早期一体化工程方案（资源定位+依赖+发布），算 webpack 思想的国产前身。**选型规律：写应用用 webpack/vite，写库用 rollup**——两者是上下游，rollup 打包的 ESM 库正好被 webpack 消费时再摇一次树。"
>
> **追问版**："vite 是当代演进：开发时不打包，让浏览器用原生 import 按需加载，只用 esbuild 预构建依赖，所以秒级冷启动；构建时用 rollup。webpack 的强项是代码分割/懒加载/处理一切资源，代价是配置复杂；rollup 的强项是输出干净 ESM 的库打包。"
>
> **为什么 gulp 被淘汰（分层答）**："gulp 是任务运行器、webpack 是模块打包器，**不同维度谈不上直接替代**。gulp 被淘汰是因为它的两大职责被瓜分：任务编排被 npm scripts 取代（零依赖更轻），文件构建被 webpack/vite 内置能力取代（loader/plugin 全家桶）。所以准确说法是——**npm scripts + 打包器两股力量夹击**干掉了 gulp，不是 webpack 单独打败它。新项目不用 gulp，但它还剩纯文件批处理、CSS/图片工作流、老项目维护这三个边缘场景。"

## 相关笔记

- [[cjs，umd，esm的区别]] —— 构建工具处理的正是模块格式：rollup 输出 ESM、webpack 兼容 CJS/ESM、UMD 由打包器生成
- [[八股文列表]] —— 工程化与性能优化章节（Webpack/Vite 构建原理、Loader 与 Plugin）
- [[从浏览器输入网址到页面完整展示全过程]] —— 打包产物最终以 `<script>`/`<link>` 形式进入渲染链
- [[CSP]] —— 现代构建产物（hash 文件名、nonce）与 CSP 的配合

*本文档基于各工具官方文档及本机 Node v26.8.1 + webpack 5 / rollup 4 / gulp 5 实测整理。验证脚本与实验目录位于同目录。*
