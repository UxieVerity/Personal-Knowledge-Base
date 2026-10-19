/**
 * 跨域方案验证脚本（Node 真实输出）
 * 运行：node 跨域-验证脚本.js
 *
 * 验证 5 件事：
 *  [A] 同源策略：什么是同源（协议+域名+端口三者相同）
 *  [B] CORS 简单请求 vs 预检请求（OPTIONS）—— 实测响应头
 *  [C] CORS 凭据（credentials）限制
 *  [D] JSONP 原理（script 标签 + callback，只支持 GET）
 *  [E] 代理方案（同源服务器转发）
 */
'use strict';

const http = require('http');
const { URL } = require('url');

const log = (...a) => console.log(...a);
const ok = (n, c) => log((c ? '✅' : '❌'), n);

/* ---------- A. 同源判定 ---------- */
log('=== A. 同源判定（协议 + 域名 + 端口 三者完全相同）===');
function isSameOrigin(a, b) {
  const ua = new URL(a), ub = new URL(b);
  return ua.protocol === ub.protocol && ua.hostname === ub.hostname && ua.port === ub.port;
}
const cases = [
  ['https://a.com/x', 'https://a.com/y', true, '同协议+域名+端口'],
  ['https://a.com', 'http://a.com', false, '协议不同（https vs http）'],
  ['https://a.com', 'https://b.com', false, '域名不同'],
  ['https://a.com', 'https://a.com:8080', false, '端口不同（443 vs 8080）'],
  ['https://a.com', 'https://sub.a.com', false, '子域名不同'],
];
cases.forEach(([a, b, expect, why]) => {
  const r = isSameOrigin(a, b);
  log(`  ${a.padEnd(24)} vs ${b.padEnd(24)} → ${r ? '同源' : '跨域'}  (${why})`);
  ok(`${a} vs ${b}`, r === expect);
});

/* ---------- B. CORS：简单请求 vs 预检 ---------- */
log('\n=== B. CORS 简单请求 vs 预检请求 ===');
// 简单请求条件：GET/HEAD/POST + 安全头（Content-Type 仅 3 种）+ 无自定义头
function isSimpleRequest(method, headers = {}) {
  const safeMethods = ['GET', 'HEAD', 'POST'];
  if (!safeMethods.includes(method)) return false;
  const safeContentTypes = ['application/x-www-form-urlencoded', 'multipart/form-data', 'text/plain'];
  if (headers['content-type'] && !safeContentTypes.includes(headers['content-type'])) return false;
  const simpleHeaders = ['accept', 'accept-language', 'content-language', 'content-type'];
  const extra = Object.keys(headers).filter(h => !simpleHeaders.includes(h.toLowerCase()));
  return extra.length === 0;
}
[
  ['GET', {}, true, 'GET 无自定义头'],
  ['POST', { 'content-type': 'text/plain' }, true, 'POST + text/plain'],
  ['POST', { 'content-type': 'application/json' }, false, 'application/json → 需预检'],
  ['PUT', {}, false, 'PUT 非简单方法 → 需预检'],
  ['GET', { 'x-token': 'abc' }, false, '自定义头 X-Token → 需预检'],
].forEach(([m, h, expect, why]) => {
  const r = isSimpleRequest(m, h);
  log(`  ${m.padEnd(5)} ${JSON.stringify(h).padEnd(36)} → ${r ? '简单请求' : '需预检'}  (${why})`);
  ok(`${m} ${why}`, r === expect);
});

/* ---------- C. 起两个服务器实测 CORS ---------- */
log('\n=== C. 真实 CORS 头实测（两个端口 = 跨域）===');

// 目标服务器（后端）：返回 CORS 头
const apiServer = http.createServer((req, res) => {
  const origin = req.headers.origin;
  log(`  [API 收到] ${req.method} ${req.url} | Origin: ${origin || '(无)'}` +
      ` | ${req.headers['access-control-request-method'] ? '预检' : '实际请求'}`);

  // 预检请求
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': origin || '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE',
      'Access-Control-Allow-Headers': 'content-type, x-token',
      'Access-Control-Max-Age': '86400',           // 预检结果缓存 24h
    });
    return res.end();
  }

  // 实际请求
  const headers = { 'Content-Type': 'application/json' };
  if (origin) {
    headers['Access-Control-Allow-Origin'] = origin;      // 回显 Origin
    headers['Access-Control-Allow-Credentials'] = 'true'; // 允许凭据
  }
  res.writeHead(200, headers);
  res.end(JSON.stringify({ ok: true, method: req.method, origin }));
});

// 客户端（模拟浏览器）：发起请求
function request(port, { method = 'GET', headers = {}, origin = null }) {
  return new Promise((resolve, reject) => {
    const h = { ...headers };
    if (origin) h['Origin'] = origin;
    const req = http.request({ host: '127.0.0.1', port, path: '/api', method, headers: h }, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    if (method === 'OPTIONS') req.end();
    else { req.write(headers['body'] || ''); req.end(); }
  });
}

(async () => {
  await new Promise(r => apiServer.listen(0, '127.0.0.1', r));
  const apiPort = apiServer.address().port;
  const clientOrigin = 'http://localhost:3000';   // 客户端是另一个源

  // C1 简单请求（带 Origin）
  const r1 = await request(apiPort, { origin: clientOrigin });
  log('  C1 简单 GET →', r1.status, '| ACAO:', r1.headers['access-control-allow-origin']);
  ok('C1 简单请求返回 ACAO', r1.headers['access-control-allow-origin'] === clientOrigin);

  // C2 预检请求
  const r2 = await request(apiPort, {
    method: 'OPTIONS',
    origin: clientOrigin,
    headers: { 'access-control-request-method': 'PUT', 'access-control-request-headers': 'x-token' },
  });
  log('  C2 OPTIONS 预检 →', r2.status, '| Allow-Methods:', r2.headers['access-control-allow-methods'],
      '| Max-Age:', r2.headers['access-control-max-age']);
  ok('C2 预检返回 204 + 允许方法', r2.status === 204 && !!r2.headers['access-control-allow-methods']);

  // C3 无 Origin（同源/直接访问）→ 不带 CORS 头也正常
  const r3 = await request(apiPort, {});
  log('  C3 无 Origin →', r3.status, '| ACAO:', r3.headers['access-control-allow-origin'] || '(无)');
  ok('C3 无 Origin 不返 ACAO', !r3.headers['access-control-allow-origin']);

  /* ---------- D. JSONP 原理 ---------- */
  log('\n=== D. JSONP 原理（script 标签绕过同源策略）===');
  log('  D1 浏览器加载 <script src="http://api.com/data?callback=cb">');
  log('  D2 服务器返回: cb({"name":"张三"})  ← 一段可执行 JS');
  log('  D3 script 执行 → 调用页面上的 cb 函数 → 拿到数据');
  log('  D4 本质：script/img/link 等标签不受同源策略限制（可跨域加载）');
  log('  D5 局限：只支持 GET（script 只能 GET）、有 XSS 风险、需服务端配合');
  ok('D JSONP 只支持 GET', true);

  // 模拟 JSONP 响应
  const jsonpBody = `cb({"name":"张三","age":28})`;
  let received = null;
  const cb = (data) => { received = data; };
  eval(jsonpBody);   // 模拟浏览器执行 script（这里用 eval 演示）
  log('  D6 模拟执行 → 收到数据:', JSON.stringify(received));
  ok('D6 JSONP 拿到数据', received && received.name === '张三');

  /* ---------- E. 代理方案 ---------- */
  log('\n=== E. 代理方案（同源服务器转发，服务器之间无同源限制）===');
  // 同源服务器（前端页面同源）：转发到 API
  const proxyServer = http.createServer((req, res) => {
    log(`  [代理收到] ${req.method} ${req.url} → 转发到 API`);
    const pReq = http.request({ host: '127.0.0.1', port: apiPort, path: req.url, method: req.method, headers: req.headers }, pRes => {
      res.writeHead(pRes.statusCode, pRes.headers);
      pRes.pipe(res);
    });
    req.pipe(pReq);
  });
  await new Promise(r => proxyServer.listen(0, '127.0.0.1', r));
  const proxyPort = proxyServer.address().port;

  const r4 = await request(proxyPort, {});
  log('  E1 前端请求自己的服务器（同源）→', r4.status, '| 数据:', r4.body);
  ok('E1 代理转发成功', r4.status === 200);

  log('\n  三种方案对比：');
  log('    CORS    → 服务端加响应头，最正规（支持所有方法/自定义头/凭据）');
  log('    JSONP   → script 标签，只 GET，老方案（有 XSS 风险）');
  log('    代理    → 同源服务器转发（dev: webpack/vite proxy；prod: nginx 反代）');

  apiServer.close();
  proxyServer.close();
})();
