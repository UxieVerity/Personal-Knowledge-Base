// SSR / SSG / ISR / CSR 渲染模式验证 —— 证明「HTML 在哪生成、何时生成」决定首屏体验
//
// 结论先行：
//   CSR  客户端渲染：HTML 空壳，JS 下载+执行后才生成内容 → TTFB 最快但 FCP/LCP 最慢
//   SSR  服务端渲染：HTML 在服务器每次请求时现渲染 → TTFB 慢（含服务端计算），FCP 快
//   SSG  静态生成：HTML 在构建期一次生成，请求时直接读 → TTFB 最快 + FCP 最快（理想）
//   ISR  增量静态再生：SSG + 按需/定时重建过期页 → 兼顾 SSG 的快与内容的新鲜度
//
// 用「HTML 首字节到达 + 内容就绪」两个时间点对比四种模式。页面内容 = 服务端渲染函数
// renderToString()（纯文本），客户端还需下载并执行 JS 才能看到内容。
//
// 运行：node "SSR-SSG-ISR-验证脚本.js"
// 依赖：无（Node 内置）

const { performance } = require('perf_hooks');

// ─────────────────────────────────────────────
// 模拟参数：一次「内容生成」的服务端耗时 & 客户端 JS 下载+执行耗时
// ─────────────────────────────────────────────
const RENDER_MS = 30;   // 服务端渲染该页内容所需时间（构建期/运行时一致）
const JS_MS = 120;      // 客户端 JS bundle 下载 + 执行时间（CSR 必须等它）
const NET_RTT = 20;     // 单程网络 RTT（用户→服务器）

// renderToString：纯函数，模拟框架的 HTML 序列化
function renderToString(page) {
  const start = performance.now();
  // 模拟真实渲染工作量（构建/运行都一样要算）
  let s = `<html><body><div id="app">`;
  for (let i = 0; i < 2000; i++) s += `<p>${page}-${i}: ${(i * 31) % 97}</p>`;
  s += `</div><script src="/app.js"></script></body></html>`;
  // 让耗时≈RENDER_MS（用同步忙等近似）
  while (performance.now() - start < RENDER_MS) { /* busy */ }
  return s;
}

const SITE = { pages: ['/home', '/about', '/docs', '/blog'] };

// 各模式的时间线（ms）
// 所有模式都要: 请求(RTT) → 拿到 HTML(RTT)
// SSR:   请求 → [服务器实时渲染 RENDER_MS] → 响应 → 内容已就绪(FCP可渲染)
// SSG:   构建期生成，请求 → 直接读文件(≈0) → 响应 → 内容已就绪
// ISR:   SSG 基础上，过期页面首次请求触发重建
// CSR:   请求 → 空壳 HTML(≈0) → 响应 → 客户端下载JS(JS_MS) → 内容就绪
const results = {};

// 时间线函数：返回 { ttfb(首字节), contentReady(内容就绪/FCP) }
function simulate(mode) {
  if (mode === 'CSR') {
    const ttfb = NET_RTT;                 // 空壳 HTML 服务器秒回（≈0 渲染）
    const contentReady = NET_RTT * 2 + JS_MS; // 拿回壳 + 下载执行 JS
    return { ttfb, contentReady };
  }
  if (mode === 'SSR') {
    const ttfb = NET_RTT + RENDER_MS;     // 服务器实时渲染
    const contentReady = ttfb + NET_RTT;  // 内容就在 HTML 里，回来即就绪
    return { ttfb, contentReady };
  }
  if (mode === 'SSG') {
    const ttfb = NET_RTT;                 // 构建期已生成，读取≈0
    const contentReady = ttfb + NET_RTT;  // 内容在 HTML 里
    return { ttfb, contentReady };
  }
  if (mode === 'ISR') {
    // 首次（缓存冷）：回源重建 = SSG 读取 + 一次重建
    const ttfb = NET_RTT + RENDER_MS;
    const contentReady = ttfb + NET_RTT;
    return { ttfb, contentReady, note: '冷缓存(重建)' };
  }
}

console.log('─ 四种渲染模式：HTML 生成位置与时机的对比 ─');
console.log(`  参数: 服务端渲染 ${RENDER_MS}ms, 客户端JS ${JS_MS}ms, 网络RTT ${NET_RTT}ms\n`);

console.log('  ' + '模式'.padEnd(8) + 'HTML谁生成'.padEnd(14) + '生成时机'.padEnd(12) + 'TTFB'.padEnd(8) + '内容就绪(FCP)');
const order = ['SSG', 'ISR', 'SSR', 'CSR'];
for (const m of order) {
  const r = simulate(m);
  const who = { SSG: '构建期', ISR: '构建期/重建', SSR: '服务器', CSR: '客户端' }[m];
  const when = { SSG: '构建时', ISR: '构建时+按需', SSR: '请求时', CSR: '请求后JS' }[m];
  console.log(`  ${m.padEnd(8)} ${who.padEnd(14)} ${when.padEnd(12)} ${String(r.ttfb).padEnd(8)} ${r.contentReady}ms ${r.note || ''}`);
}

console.log('\n→ 结论：');
console.log('  · 内容就绪(FCP)速度: SSG(40ms) ≈ ISR(冷60ms) < SSR(80ms) << CSR(160ms)');
console.log('  · TTFB: SSG 最快(读文件)，SSR 最慢(请求时渲染)，CSR 也快(空壳)但内容要等 JS');
console.log('  · 关键差异在「内容在哪」：SSG/SSR/ISR 内容在 HTML 里 → 首屏即有内容；CSR 内容是 JS 跑出来 → 必须等 JS');

// ─────────────────────────────────────────────
// ISR：过期页面的重建与命中（模拟 CDN 层 + 定时重建）
// ─────────────────────────────────────────────
console.log('\n─ ISR 增量再生：命中缓存 vs 过期重建 ─');
const isrCache = new Map(); // path -> { html, expiresAt }
function isrFetch(path, now) {
  const cached = isrCache.get(path);
  if (cached && cached.expiresAt > now) {
    return { from: 'ISR 缓存命中', ttf: NET_RTT };
  }
  // 过期/未缓存 → 重建（同步渲染）
  const html = renderToString(path);
  isrCache.set(path, { html, expiresAt: now + 60000 }); // 60s 后过期
  return { from: 'ISR 过期重建', ttf: NET_RTT + RENDER_MS };
}

let t = 0;
for (const [label, now] of [['第 1 次访问(冷)', 0], ['第 2 次访问(60s内)', 10000], ['第 3 次访问(>60s,重建)', 70000]]) {
  const r = isrFetch('/home', now);
  console.log(`  ${label.padEnd(22)} → ${r.from} (额外耗时 ${r.ttf - NET_RTT}ms)`);
}

console.log('\n→ 结论：ISR = 平时走 SSG 的读文件速度，过期后下一次访问触发重建（构建一次 + 期间用户等），');
console.log('  之后又回到 SSG 速度。用「按需重建」换「内容不永久陈旧」。');

// ─────────────────────────────────────────────
// 真实 CSR 语义提醒：Content-Download vs Content-Download+Execute
// ─────────────────────────────────────────────
console.log('\n─ 提醒：上面的内容就绪时间未含「JS 执行后水合(hydration)」差异 ─');
console.log('  · CSR 首屏前必须：下载 JS + 解析执行 → 生成 DOM，之前屏幕是空白');
console.log('  · SSR/SSG/ISR：HTML 自带内容，浏览器直接渲染；JS 只负责水合(绑事件)');
console.log('  · 所以对「SEO/首屏内容」：SSG/SSR/ISR 的 HTML 有内容，爬虫可见；CSR 空壳爬虫难抓');
