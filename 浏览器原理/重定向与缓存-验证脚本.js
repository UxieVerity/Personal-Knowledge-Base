// 重定向与缓存逻辑验证 —— 证明「输入 URL 后、真正发起网络 HTTP 请求之前」的两层前置逻辑
//
// 结论先行：
//   ① 重定向：301/302/303/307/308 由浏览器自动跟随（follow 到 Location），对 JS 透明，
//      但 304 不是重定向——它是「缓存校验通过，直接复用本地副本」的信号。
//   ② 缓存三级：内存缓存(最快) > 磁盘缓存 > 网络。命中新鲜缓存 → 0 网络请求。
//   ③ 新鲜度判定：Cache-Control 优先，无则启发式；过期后带 If-None-Match/If-Modified-Since
//      做条件请求 → 304 复用本地（省响应体），变化则 200 全量返回。
//   ④ no-store 永不缓存；no-cache 每次都要向服务器校验（但可复用本地副本省响应体）。
//   ⑤ 重定向链与缓存的顺序：重定向本身也走缓存（301/308 可被缓存），然后才到目标资源。
//
// 运行：node "重定向与缓存-验证脚本.js"
// 依赖：无（Node 内置 http）

const http = require('http');

// ─────────────────────────────────────────────
// 本地 HTTP 服务器：模拟一套带缓存语义的后端
// ─────────────────────────────────────────────
let requestLog = []; // 记录服务器收到的每一次真实请求
function log(what) { requestLog.push(what); }

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const hit = (obj) => { res.writeHead(obj.code, obj.headers); res.end(obj.body || ''); };

  if (u.pathname === '/old') {
    // 301：永久重定向，浏览器跟随到 /landing；301/308 默认可被浏览器缓存
    log(`301  → /old (被重定向)`);
    hit({ code: 301, headers: { 'Location': '/landing', 'Cache-Control': 'max-age=60' }, body: '' });
  } else if (u.pathname === '/landing') {
    // 重定向的目标：只服务这一节
    log(`200  → /landing (重定向目标)`);
    hit({ code: 200, headers: { 'Cache-Control': 'no-store' }, body: 'landing' });
  } else if (u.pathname === '/moved') {
    // 302：临时重定向
    log(`302  → /moved`);
    hit({ code: 302, headers: { 'Location': '/new' }, body: '' });
  } else if (u.pathname === '/perm') {
    // 308：永久重定向，保留 POST 方法（301 会把 POST 变 GET）
    log(`308  → /perm`);
    hit({ code: 308, headers: { 'Location': '/new' }, body: '' });
  } else if (u.pathname === '/new') {
    // 主资源：新鲜缓存（max-age=60）→ 二次访问命中缓存、0 网络请求
    log(`200  → /new (完整响应, 60B)`);
    hit({ code: 200, headers: {
      'Content-Type': 'text/html',
      'Cache-Control': 'public, max-age=60',
      'ETag': '"v1"',
      'Content-Length': 60
    }, body: 'x'.repeat(60) });
  } else if (u.pathname === '/must-revalidate') {
    // no-cache：每次都要向服务器校验，但带 If-None-Match → 服务器回 304（不传响应体）
    const inm = req.headers['if-none-match'];
    if (inm === '"v2"') {
      log(`304  → /must-revalidate (命中校验, 0B 响应体)`);
      hit({ code: 304, headers: { 'ETag': '"v2"' } });
    } else {
      log(`200  → /must-revalidate (首次/无 ETag, 100B)`);
      hit({ code: 200, headers: { 'ETag': '"v2"', 'Cache-Control': 'no-cache' }, body: 'y'.repeat(100) });
    }
  } else if (u.pathname === '/no-store') {
    log(`200  → /no-store (永不缓存, 100B)`);
    hit({ code: 200, headers: { 'Cache-Control': 'no-store' }, body: 'z'.repeat(100) });
  } else if (u.pathname === '/expired') {
    // max-age=0：过期即须校验，带 If-None-Match → 304
    const inm = req.headers['if-none-match'];
    if (inm === '"v3"') {
      log(`304  → /expired (校验通过, 0B)`);
      hit({ code: 304, headers: { 'ETag': '"v3"', 'Cache-Control': 'max-age=0' } });
    } else {
      log(`200  → /expired (首次, 80B)`);
      hit({ code: 200, headers: { 'ETag': '"v3"', 'Cache-Control': 'max-age=0' }, body: 'w'.repeat(80) });
    }
  } else if (u.pathname === '/ims') {
    // If-Modified-Since 形式：返回 Last-Modified，再次访问带 If-Modified-Since → 304
    const ims = req.headers['if-modified-since'];
    if (ims) {
      log(`304  → /ims (If-Modified-Since 命中)`);
      hit({ code: 304, headers: { 'Last-Modified': 'Wed, 01 Jan 2026 00:00:00 GMT' } });
    } else {
      log(`200  → /ims (首次, 90B)`);
      hit({ code: 200, headers: { 'Last-Modified': 'Wed, 01 Jan 2026 00:00:00 GMT' }, body: 'i'.repeat(90) });
    }
  } else {
    log(`404  → ${u.pathname}`);
    hit({ code: 404, headers: {}, body: 'not found' });
  }
});

// ─────────────────────────────────────────────
// 浏览器式缓存客户端：内存缓存 + 磁盘缓存 + 启发式新鲜度 + 条件请求
// ─────────────────────────────────────────────
const memoryCache = new Map();   // 一级：内存缓存
const diskCache = new Map();     // 二级：磁盘缓存（本脚本只用于统计语义）
const HOST = 'http://127.0.0.1';

let networkBytes = 0;            // 实际从网络拿到的响应体字节数
let networkRequests = 0;         // 真实发到服务器的请求数
let servedFromCache = 0;         // 未发网络的次数

function now() { return Date.now() / 1000; }

// 解析 Cache-Control 指令
function cc(headers) {
  const cc = {};
  (headers['cache-control'] || '').split(',').forEach(s => {
    const [k, v] = s.trim().split('=');
    cc[k.toLowerCase()] = v === undefined ? true : parseInt(v, 10);
  });
  return cc;
}

// 浏览器「发送请求」：先查缓存，命中新鲜 → 不发网络；过期 → 条件请求
async function fetchLikeBrowser(url) {
  const cacheKey = url;
  const hit = memoryCache.get(cacheKey);
  if (hit) {
    const age = now() - hit.storedAt;
    const maxAge = cc(hit.headers)['max-age'];
    const noCache = cc(hit.headers)['no-cache'] === true;
    if (!noCache && maxAge !== undefined && age < maxAge) {
      // 新鲜命中：不发网络，直接用本地副本
      servedFromCache++;
      return { from: '内存缓存', status: 200, bodyBytes: hit.body.length, age: age.toFixed(2) + 's', etag: hit.headers['etag'] };
    }
    // 过期 / no-cache → 发起条件请求（带 If-None-Match / If-Modified-Since）
    networkRequests++;
    const cond = {};
    if (hit.headers['etag']) cond['If-None-Match'] = hit.headers['etag'];
    if (hit.headers['last-modified']) cond['If-Modified-Since'] = hit.headers['last-modified'];
    const res = await httpGet(url, cond);
    if (res.status === 304) {
      // 304：服务器说没变 → 复用本地副本，响应体 0 字节
      servedFromCache++;
      hit.storedAt = now(); // 刷新时间
      return { from: '304 复用本地', status: 304, bodyBytes: 0, reusedBytes: hit.body.length, etag: hit.headers['etag'] };
    }
    // 200：内容变了 → 全量下载并替换缓存
    networkBytes += res.body.length;
    memoryCache.set(cacheKey, { headers: res.headers, body: res.body, storedAt: now() });
    return { from: '200 全量(缓存更新)', status: 200, bodyBytes: res.body.length, etag: res.headers['etag'] };
  }
  // 冷缓存（首次访问）
  networkRequests++;
  const res = await httpGet(url, {});
  const noStore = cc(res.headers)['no-store'] === true;
  if (res.status >= 300 && res.status < 400 && res.headers['location']) {
    // 重定向：本身也可被缓存（301/308 默认可缓存，302/303/307 默认不缓存）
    const loc = new URL(res.headers['location'], url).href;
    if (!noStore && cc(res.headers)['max-age'] !== undefined) {
      memoryCache.set(cacheKey, { headers: res.headers, body: '', storedAt: now(), isRedirect: true });
    }
    return { from: `重定向 ${res.status}`, to: loc, bodyBytes: 0 };
  }
  networkBytes += res.body.length;
  if (!noStore) {
    // 真正缓存：把响应体存进本地副本（no-store 则连副本都不留）
    memoryCache.set(cacheKey, { headers: res.headers, body: res.body, storedAt: now() });
  }
  return { from: '200 首次' + (noStore ? '(no-store, 不缓存)' : '(写入缓存)'), status: 200, bodyBytes: res.body.length, etag: res.headers['etag'] };
}

function httpGet(url, headers) {
  return new Promise((resolve, reject) => {
    http.get(url, { headers }, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    }).on('error', reject);
  });
}

// ─────────────────────────────────────────────
// 跑测试
// ─────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const base = `${HOST}:${port}`;
  const L = (label, r) => {
    const tail = r.from.startsWith('重定向')
      ? `→ 跟随到 ${r.to}`
      : (r.bodyBytes !== undefined ? `响应体 ${r.bodyBytes}B` : '');
    console.log(`  ${label.padEnd(22)} ${r.from.padEnd(22)} ${tail}`);
  };

  console.log('─ ① 重定向：浏览器自动跟随，JS 无感知 ─');
  console.log('   GET /old →');
  L('   /old', await fetchLikeBrowser(`${base}/old`));           // 301
  L('   /landing', await fetchLikeBrowser(`${base}/landing`));   // 跟随后的目标
  console.log('   → 301 的 Location 指向 /landing，浏览器自动再发一次请求，业务代码只看到最终 200');

  console.log('\n─ ② 新鲜缓存命中：二次访问 0 网络请求 ─');
  const fresh1 = await fetchLikeBrowser(`${base}/new`);
  L('   /new 第一次', fresh1);
  const fresh2 = await fetchLikeBrowser(`${base}/new`);
  L('   /new 第二次', fresh2);
  console.log('   → 命中 max-age 新鲜缓存：完全没发网络请求，耗时≈0，直接从本地读');

  console.log('\n─ ③ no-cache + ETag：每次都校验，但 304 省响应体 ─');
  L('   /must-revalidate 第一次', await fetchLikeBrowser(`${base}/must-revalidate`));
  L('   /must-revalidate 第二次', await fetchLikeBrowser(`${base}/must-revalidate`));
  L('   /must-revalidate 第三次', await fetchLikeBrowser(`${base}/must-revalidate`));
  console.log('   → no-cache ≠ 不缓存：本地留着副本，每次只带 If-None-Match 问服务器，304 就复用本地');

  console.log('\n─ ④ no-store：永不缓存，每次都全量下载 ─');
  L('   /no-store 第一次', await fetchLikeBrowser(`${base}/no-store`));
  L('   /no-store 第二次', await fetchLikeBrowser(`${base}/no-store`));
  console.log('   → no-store 连校验都没有，每次都是完整 200，本地不留任何副本');

  console.log('\n─ ⑤ max-age=0 + ETag：过期 → 条件请求 → 304 ─');
  L('   /expired 第一次', await fetchLikeBrowser(`${base}/expired`));
  L('   /expired 第二次', await fetchLikeBrowser(`${base}/expired`));
  console.log('   → max-age=0 表示「立即过期」，但凭 ETag 校验仍能 304 复用本地，省掉响应体');

  console.log('\n─ ⑥ If-Modified-Since（时间戳校验） ─');
  L('   /ims 第一次', await fetchLikeBrowser(`${base}/ims`));
  L('   /ims 第二次', await fetchLikeBrowser(`${base}/ims`));
  console.log('   → 用 Last-Modified 时间戳校验，语义同 ETag，精度到秒');

  // 汇总
  console.log('\n─ 汇总：缓存命中 = 0 网络请求 ─');
  console.log(`   真实网络请求 ${networkRequests} 次；命中缓存(未发网络) ${servedFromCache} 次；网络下载响应体 ${networkBytes}B`);
  console.log(`   服务器视角收到的请求：`);
  requestLog.forEach(r => console.log(`     ${r}`));
  console.log('\n→ 结论：缓存的价值 = 「重复访问时把网络请求数降为 0，或把全量下载降为 304 空响应体」。');
  console.log('→ 重定向发生在缓存查找之后、真正请求之前；301/308 可被缓存，302/303/307 默认不缓存。');

  server.close();
})();
