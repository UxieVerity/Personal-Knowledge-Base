// TLS 1.2 vs TLS 1.3 实测 —— 握手耗时对比（TLS1.3 少一个 RTT）
//
// 结论先行：
//   TLS1.3 握手只需 1-RTT（TLS1.2 要 2-RTT），且支持 0-RTT 会话恢复。
//   本脚本对同一真实站点分别强制 TLSv1.2 / TLSv1.3 握手，多次采样对比平均耗时。
//
// 运行：node "TLS12vsTLS13-验证脚本.js"
const tls = require('tls');
const { performance } = require('perf_hooks');

const SITES = ['www.baidu.com', 'www.qq.com', 'www.bilibili.com', 'www.douyin.com', 'www.taobao.com'];
const VERSIONS = ['TLSv1.2', 'TLSv1.3'];
const N = 5; // 每个版本采样次数

function handshake(host, version) {
  return new Promise((resolve, reject) => {
    const t0 = performance.now();
    const socket = tls.connect({
      host, port: 443,
      minVersion: version,
      maxVersion: version,
      rejectUnauthorized: false,
      servername: host,
    }, () => {
      const dt = performance.now() - t0;
      const proto = socket.getProtocol();
      socket.destroy();
      resolve({ dt, proto });
    });
    socket.on('error', reject);
  });
}

(async () => {
  console.log(`实验：对每个站点分别强制 TLS1.2 / TLS1.3，各握手 ${N} 次取平均\n`);
  console.log('站点                TLS1.2 协商       TLS1.3 协商        差值');
  for (const site of SITES) {
    let line = site.padEnd(18);
    const out = {};
    for (const v of VERSIONS) {
      const times = [];
      let proto = '';
      let errNote = '';
      for (let i = 0; i < N; i++) {
        try {
          const r = await handshake(site, v);
          times.push(r.dt);
          proto = r.proto;
        } catch (e) { errNote = e.code || e.message; }
      }
      const avg = times.length ? times.reduce((a, b) => a + b, 0) / times.length : null;
      out[v] = avg;
      line += ` ${proto.padEnd(16)} ${avg ? avg.toFixed(1) + 'ms' : '失败'}`;
      if (!times.length) line += `(${errNote})`;
    }
    const diff = (out['TLSv1.2'] != null && out['TLSv1.3'] != null)
      ? ` ${(out['TLSv1.2'] - out['TLSv1.3']).toFixed(1)}ms`
      : '';
    console.log(line + diff);
  }
  console.log('\n→ 预期：TLS1.3 平均握手耗时 < TLS1.2（少一个 RTT：1-RTT vs 2-RTT）');
  console.log('→ 差值 ≈ 一个网络 RTT；若站点 TLS1.2/1.3 走不同 CDN 边缘，差值方向仍一致。');
})();
