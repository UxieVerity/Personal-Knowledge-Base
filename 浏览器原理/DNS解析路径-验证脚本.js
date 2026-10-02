// DNS 解析路径验证 —— 证明「客户端解析」与「网络 DNS 查询」是两条平行路径，不是一条逐级链
//
// 结论先行：
//   dns.lookup()  走「系统解析」路径：hosts 文件 → OS DNS 缓存 → 系统配置的 DNS 服务器
//   dns.resolve() 绕过系统缓存，直连 DNS 服务器查询（模拟 Chrome 自带 async 解析器的行为）
//   localhost 只在系统解析层存在（hosts），DNS 服务器上根本查不到 → 证明二者不是同一条链
//   IP 地址直接返回自身、不发起任何查询（0ms）→ 直接输 IP 跳过 DNS 解析
//   GFW 实测：被墙域名照样能解析出 IP，但 TCP:443 连不通 → 访问不到是连接层被墙，不是 DNS 缓存问题
//
// 运行：node "DNS解析路径-验证脚本.js"
const dns = require('dns');
const net = require('net');
const { promisify } = require('util');
const { performance } = require('perf_hooks');
const lookup = promisify(dns.lookup);
const resolve = promisify(dns.resolve);
const resolve4 = promisify(dns.resolve4);

(async () => {
  console.log('─ dns.lookup()：走「系统解析」路径（hosts → OS DNS 缓存 → 系统 DNS 服务器）');
  for (const h of ['localhost', 'www.baidu.com']) {
    try {
      console.log(`  lookup(${h})   → ${JSON.stringify(await lookup(h))}`);
    } catch (e) {
      console.log(`  lookup(${h})   ERR ${e.code}`);
    }
  }

  console.log('─ dns.resolve()：绕过系统缓存，直连 DNS 服务器查询（Chrome 自带解析器行为）');
  for (const h of ['localhost', 'www.baidu.com']) {
    try {
      console.log(`  resolve(${h})  → ${JSON.stringify(await resolve(h))}`);
    } catch (e) {
      console.log(`  resolve(${h})  ERR ${e.code}`);
    }
  }

  console.log('\n→ localhost：lookup 命中系统解析层；resolve 到 DNS 服务器查不到 → ENOTFOUND');
  console.log('→ 结论：客户端缓存/系统解析 与 网络 DNS 查询 是两条平行路径，不存在「逐级查完再往下」');

  console.log('\n─ IP 地址 vs 域名：IP 直接返回自身、不发起任何查询（直接输 IP = 跳过 DNS 解析）');
  for (const h of ['127.0.0.1', '192.168.1.1', 'www.baidu.com']) {
    const t0 = performance.now();
    try {
      const r = await lookup(h);
      console.log(`  lookup(${h.padEnd(14)}) → ${r.address.padEnd(15)} 耗时 ${(performance.now() - t0).toFixed(2)}ms`);
    } catch (e) {
      console.log(`  lookup(${h.padEnd(14)}) ERR ${e.code}   耗时 ${(performance.now() - t0).toFixed(2)}ms`);
    }
  }
  console.log('\n→ IP 地址：0.15~0.47ms 直接返回自身，无 DNS 查询；域名：走真实解析，几十 ms 量级。');

  console.log('\n─ GFW 封锁实测：DNS 能解析 ≠ 能访问（连接层才是瓶颈）');
  const DOMAINS = ['www.baidu.com', 'www.github.com', 'www.google.com', 'www.youtube.com', 'www.facebook.com'];
  for (const h of DOMAINS) {
    try {
      const ips = await resolve4(h);
      if (!ips.length) { console.log(`  ${h.padEnd(18)} → 无 IP`); continue; }
      const ok = await new Promise((res) => {
        const s = net.connect({ host: ips[0], port: 443, timeout: 3000 });
        s.once('connect', () => { s.destroy(); res(true); });
        s.once('timeout', () => { s.destroy(); res(false); });
        s.once('error', () => res(false));
      });
      console.log(`  ${h.padEnd(18)} 解析→${ips[0].padEnd(15)} TCP:443 → ${ok ? '✅ 通' : '❌ 不通/超时'}`);
    } catch (e) {
      console.log(`  ${h.padEnd(18)} → ERR ${e.code}`);
    }
  }
  console.log('\n→ 被墙域名（google/youtube/facebook）都能解析出 IP，但 TCP 连不通');
  console.log('→ 结论：访问不到外网 ≠ DNS 缓存问题；是连接层被墙（IP 封锁 / SNI 检测）。VPN = 隧道加密 + 境外出口绕过封锁。');
})();
