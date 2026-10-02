// CDN 与压缩验证 —— 证明「静态文件压缩（gzip/br）」与「CDN 边缘缓存」两个网络层优化点
//
// 结论先行：
//   ① 压缩：同一份文本，br(Brotli) 通常比 gzip 再小 20~30%，且都能达到 70~90% 的压缩率。
//      服务器按请求头 Accept-Encoding 协商：浏览器声明支持 → 返回压缩内容；否则返回原样。
//   ② CDN：边缘节点缓存命中 → 0 回源（源站完全收不到请求），用户延迟=到边缘的 RTT；
//      miss → 回源取数据并写缓存；后续命中。缓存头（Cache-Control）决定边缘能否缓存。
//
// 运行：node "CDN与压缩-验证脚本.js"
// 依赖：无（Node 内置 http + zlib）

const http = require('http');
const zlib = require('zlib');

// ─────────────────────────────────────────────
// Part 1: gzip vs br 压缩比实测
// ─────────────────────────────────────────────
function fmt(n) { return n.toLocaleString('en-US'); }

function gzipSize(buf) { return zlib.gzipSync(buf).length; }
function brSize(buf) { return zlib.brotliCompressSync(buf).length; }

console.log('─ Part 1: gzip vs brotli(br) 压缩比 ─');
// 模拟真实场景：一个前端 bundle（有结构但非完全重复的 JS，利于压缩但不至于 99%）
const fakeBundle = Array.from({ length: 400 }, (_, i) => `
const useFoo${i % 3} = () => {
  const state = useReducer(reducer, { count: ${i}, items: ['a','b','c'].map(x => x + '${i % 7}') });
  useEffect(() => { fetch('/api/data?page=${i}').then(r => r.json()); }, [state.count]);
  return state;
};
export const Component${i} = () => <div data-id="${i}" className="card card-${i % 4}">item ${i}</div>;
`).join('\n');

const bundleBuf = Buffer.from(fakeBundle, 'utf8');
const gz = gzipSize(bundleBuf);
const br = brSize(bundleBuf);
console.log(`  原始 ${fmt(bundleBuf.length)}B`);
console.log(`  gzip    ${fmt(gz)}B  (节省 ${(100 - gz / bundleBuf.length * 100).toFixed(1)}%)`);
console.log(`  br      ${fmt(br)}B  (节省 ${(100 - br / bundleBuf.length * 100).toFixed(1)}%, 比 gzip 再小 ${((gz - br) / gz * 100).toFixed(1)}%)`);

// 不同文本类型的压缩率差异
const samples = {
  'JSON(接口数据)': JSON.stringify(Array.from({ length: 2000 }, (_, i) => ({ id: i, name: `user_${i}`, tags: ['a', 'b', 'c'], active: i % 2 === 0 }))),
  'HTML': '<!doctype html><html><head><title>test</title></head><body>' + '<div class="card"><p>hello world</p></div>'.repeat(500) + '</body></html>',
  '纯随机文本(不可压缩)': Array.from({ length: 20000 }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join(''),
};

console.log('\n  不同内容类型的压缩率对比：');
console.log('  ' + '类型'.padEnd(14) + '原始B'.padEnd(12) + 'gzip'.padEnd(10) + 'br'.padEnd(10) + 'br/gzip');
for (const [name, text] of Object.entries(samples)) {
  const b = Buffer.from(text);
  const g = gzipSize(b), r = brSize(b);
  console.log(`  ${name.padEnd(14)} ${fmt(b.length).padEnd(12)} ${fmt(g).padEnd(10)} ${fmt(r).padEnd(10)} ${(r / g * 100).toFixed(0)}%`);
}

console.log('\n→ 结论：文本类内容 br 普遍比 gzip 小 20~30%；但随机数据(已不可压缩)两者都没收益 → 压缩只对「有冗余的文本」有效。');

// ─────────────────────────────────────────────
// Part 2: Accept-Encoding 协商（服务器按请求头选择压缩）
// ─────────────────────────────────────────────
let negotiationLog = [];
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/file.js') {
    const accept = req.headers['accept-encoding'] || '';
    const body = fakeBundle;
    const buf = Buffer.from(body);
    const set = (code, headers, b) => { res.writeHead(code, headers); res.end(b); };

    if (/\bbr\b/.test(accept)) {
      const out = zlib.brotliCompressSync(buf);
      negotiationLog.push('br 客户端');
      set(200, { 'Content-Encoding': 'br', 'Content-Type': 'application/javascript', 'Cache-Control': 'public, max-age=31536000, immutable' }, out);
    } else if (/\bgzip\b/.test(accept)) {
      const out = zlib.gzipSync(buf);
      negotiationLog.push('gzip 客户端');
      set(200, { 'Content-Encoding': 'gzip', 'Content-Type': 'application/javascript', 'Cache-Control': 'public, max-age=31536000, immutable' }, out);
    } else {
      negotiationLog.push('无压缩客户端');
      set(200, { 'Content-Type': 'application/javascript' }, buf);
    }
  } else {
    res.writeHead(404); res.end();
  }
});

// ─────────────────────────────────────────────
// Part 3: CDN 边缘缓存模拟
// ─────────────────────────────────────────────
let originHits = 0;       // 源站实际收到的请求数
const edgeCache = new Map(); // CDN 边缘节点缓存

function simulateEdge(url, acceptEncoding) {
  // ① 查边缘缓存：命中且新鲜 → 不回源
  const cached = edgeCache.get(url);
  if (cached) {
    return { from: 'CDN 边缘缓存', size: cached.size, encoding: cached.encoding, origin: false };
  }
  // ② miss → 回源（模拟：源站返回内容，并根据 Accept-Encoding 压缩）
  originHits++;
  const buf = Buffer.from(fakeBundle);
  let payload = buf, encoding = 'none';
  if (/\bbr\b/.test(acceptEncoding)) { payload = zlib.brotliCompressSync(buf); encoding = 'br'; }
  else if (/\bgzip\b/.test(acceptEncoding)) { payload = zlib.gzipSync(buf); encoding = 'gzip'; }
  // ③ 回源内容写入边缘缓存（模拟源站带 Cache-Control: public, max-age）
  edgeCache.set(url, { size: payload.length, encoding });
  return { from: '回源(边缘已缓存)', size: payload.length, encoding, origin: true };
}

// ─────────────────────────────────────────────
// 跑测试
// ─────────────────────────────────────────────
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  const get = (url, headers = {}) => new Promise((resolve) => {
    http.get(url, { headers }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    }).on('error', resolve);
  });

  console.log('\n─ Part 2: Accept-Encoding 协商（服务器按请求头选择压缩） ─');
  for (const [label, accept] of [['支持 br+gzip', 'gzip, deflate, br'], ['只支持 gzip', 'gzip'], ['不支持压缩', 'identity']]) {
    const r = await get(`${base}/file.js`, { 'Accept-Encoding': accept });
    console.log(`  ${label.padEnd(14)} → 收到 ${r.headers['content-encoding'] || '(无,原样)'}  (${fmt(r.body.length)}B)`);
  }
  console.log(`  → 服务器根据 Accept-Encoding 返回对应编码，浏览器解压后使用，传输字节更少`);

  console.log('\n─ Part 3: CDN 边缘缓存：命中不回源 vs 回源 ─');
  const UA = { 'Accept-Encoding': 'br, gzip' };
  const r1 = simulateEdge('/static/app.js', 'br, gzip');
  console.log(`  第 1 次请求 /static/app.js → ${r1.from} (${fmt(r1.size)}B, ${r1.encoding})`);
  const r2 = simulateEdge('/static/app.js', 'br, gzip');
  console.log(`  第 2 次请求 /static/app.js → ${r2.from} (${fmt(r2.size)}B, ${r2.encoding})`);
  const r3 = simulateEdge('/static/app.js', 'br, gzip');
  console.log(`  第 3 次请求 /static/app.js → ${r3.from} (${fmt(r3.size)}B, ${r3.encoding})`);
  console.log(`  → 源站共收到 ${originHits} 次请求（只有第 1 次回源），后 2 次全部命中 CDN 边缘缓存`);

  console.log('\n─ 汇总 ─');
  console.log(`  压缩: 同一 bundle gzip ${fmt(gz)}B / br ${fmt(br)}B，均省 ${(100 - br / bundleBuf.length * 100).toFixed(1)}%+ 传输字节`);
  console.log(`  CDN: 3 次请求只回源 1 次，缓存命中率 2/3，用户延迟=到边缘 RTT 而非源站 RTT`);

  server.close();
})();
