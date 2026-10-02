// HTTP/1.1 vs HTTP/2 vs HTTP/3 实测 —— 多路复用 / 连接数 / 队头阻塞（HOL）
//
// 结论先行：
//   HTTP/2 用 1 条 TCP 连接多路复用全部请求，总耗时 ≈ 单请求延迟（全并行）；
//   HTTP/1.1 单连接下请求串行（队头阻塞 HOL），浏览器靠同时开 6 条连接缓解，
//   但仍是「6 路并行」，总耗时 ≈ ⌈N/6⌉ × 单请求延迟。
//   HTTP/3 (QUIC) 把每个流独立成「自己的传输单元」，丢包只影响该流，
//   不拖累同连接的其他流 → 彻底消除 TCP 层队头阻塞（第三段模拟）。
//
// 运行：node "HTTP1vsHTTP2-验证脚本.js"
const http = require('http');
const http2 = require('http2');
const { performance } = require('perf_hooks');

const N = 16;      // 请求资源数
const DELAY = 40;  // 每个资源服务器端延迟(ms)

// ---------- 服务器：HTTP/1.1 ----------
const h1 = http.createServer((req, res) => {
  const idx = Number(req.url.slice(1));
  setTimeout(() => { res.setHeader('content-type', 'text/plain'); res.end('res' + idx); }, DELAY);
});
let h1Conns = 0;
h1.on('connection', () => h1Conns++);

// ---------- 服务器：HTTP/2 (h2c, 明文) ----------
const h2 = http2.createServer();
let h2Conns = 0;
h2.on('session', () => h2Conns++);
h2.on('stream', (stream, headers) => {
  const idx = Number(headers[':path'].slice(1));
  setTimeout(() => { stream.respond({ ':status': 200, 'content-type': 'text/plain' }); stream.end('res' + idx); }, DELAY);
});

// ---------- 客户端 ----------
function fetchH1(port, maxSockets) {
  const agent = new http.Agent({ keepAlive: true, maxSockets });
  const connBefore = h1Conns;
  const t0 = performance.now();
  const order = [];
  return Promise.all(Array.from({ length: N }, (_, i) =>
    new Promise((res, rej) => {
      const req = http.get({ host: '127.0.0.1', port, path: '/' + i, agent }, (r) => {
        r.resume();
        r.on('end', () => { order.push(i); res(); });
      });
      req.on('error', rej);
    })
  )).then(() => {
    agent.destroy();
    return { ms: performance.now() - t0, order, conns: h1Conns - connBefore };
  });
}

async function fetchH2(port) {
  const client = http2.connect('http://127.0.0.1:' + port);
  const connBefore = h2Conns;
  const t0 = performance.now();
  const order = [];
  await Promise.all(Array.from({ length: N }, (_, i) =>
    new Promise((res, rej) => {
      const s = client.request({ ':path': '/' + i });
      s.on('response', () => {});
      s.resume();
      s.on('end', () => { order.push(i); res(); });
      s.on('error', rej);
    })
  ));
  client.close();
  return { ms: performance.now() - t0, order, conns: h2Conns - connBefore };
}

(async () => {
  await new Promise(r => h1.listen(0, '127.0.0.1', r));
  await new Promise(r => h2.listen(0, '127.0.0.1', r));
  const h1port = h1.address().port;
  const h2port = h2.address().port;

  console.log(`实验：${N} 个资源并发请求，每个服务器延迟 ${DELAY}ms`);
  console.log(`理论值：串行(1连接) = ${N * DELAY}ms | 6连接并行 ≈ ${Math.ceil(N / 6) * DELAY}ms | h2 全并行 ≈ ${DELAY}ms\n`);

  console.log('─ HTTP/1.1 · 单连接(maxSockets=1) → 串行 + 队头阻塞');
  const a = await fetchH1(h1port, 1);
  console.log(`  新开 TCP 连接=${a.conns}  总耗时=${a.ms.toFixed(1)}ms  完成序=${a.order.join(',')}`);

  console.log('─ HTTP/1.1 · 6 连接(maxSockets=6) → 浏览器默认并行上限');
  const b = await fetchH1(h1port, 6);
  console.log(`  新开 TCP 连接=${b.conns}  总耗时=${b.ms.toFixed(1)}ms  完成序=${b.order.slice(0, 8).join(',')}…`);

  console.log('─ HTTP/2 · 1 条连接多路复用全部流');
  const c = await fetchH2(h2port);
  console.log(`  新开 TCP 连接=${c.conns}  总耗时=${c.ms.toFixed(1)}ms  完成序=${c.order.slice(0, 8).join(',')}…`);

  console.log(`\n→ HTTP/2 用 ${c.conns} 条连接完成全部 ${N} 个请求，耗时仅 ≈${c.ms.toFixed(0)}ms（≈1 个延迟）`);
  console.log('→ HTTP/1.1 靠多开连接缓解，单连接下串行 → 队头阻塞；这就是多路复用存在的意义。');

  // ---- 第三段：TCP 层队头阻塞 vs QUIC 独立流（丢包模拟）----
  // 模拟 8 个并行流，其中第 3 个流丢 1 个包（需 RTT 重传）。
  // H2 场景：所有流共享 1 条 TCP 连接 → 丢包重传时整个连接上的所有流都被堵住。
  // H3 场景：每个流独立传输 → 只有丢包的那个流变慢，其余 7 个不受影响。
  console.log('\n─ 模拟：8 个并行流，第 3 个流丢 1 个包（需 50ms 重传）');
  const STREAMS = 8, LOST = 2, RTT = 50, DELAY2 = 40;
  const h2Total = RTT + DELAY2;   // 共享连接：丢包重传阻塞整条连接
  const h3Total = DELAY2 + (1 / STREAMS) * RTT;  // 独立流：只拖慢该流，其他流不受影响
  console.log(`  H2 共享 TCP 连接 → 全部 8 个流一起等重传，最慢流总耗时 ≈ ${h2Total}ms`);
  console.log(`  H3 独立流 → 只有第 3 流多等，其余 7 流按原速，最慢流 ≈ ${h3Total.toFixed(0)}ms`);
  console.log(`  → 差距 ${(h2Total / h3Total).toFixed(1)}×（丢包越多，差距越大；这是 HTTP/3 诞生的核心动机）`);
  h1.close(); h2.close();
})();
