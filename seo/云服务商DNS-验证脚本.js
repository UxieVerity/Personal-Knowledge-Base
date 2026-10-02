// 云服务商 DNS 验证 —— 证明「用云服务商智能 DNS 替代默认运营商 DNS」在解析层的优化
//
// 结论先行：
//   ① 智能解析（GSLB）：云服务商 DNS 按「用户地域/运营商」返回不同 IP，把用户导向最近的服务器/CDN 节点。
//      普通 DNS 只做「域名→IP」一对一，不做就近调度。
//   ② TTL 与缓存：TTL 决定 DNS 记录能被各级缓存多久。TTL 小 → 更新快、但查询多；TTL 大 → 查询少、但故障转移慢。
//   ③ DoH（DNS over HTTPS）：把 DNS 查询加密走 443，防运营商 DNS 劫持/污染/窥探；传统 DNS 走 UDP 53 明文。
//   ④ Anycast：同一 IP 在全球多节点广播，用户自动路由到最近节点——CDN 与云 DNS 的底层网络技术。
//
// 运行：node "云服务商DNS-验证脚本.js"
// 依赖：无（Node 内置 https，DoH 查询走 https 请求）

const https = require('https');
const { performance } = require('perf_hooks');

// ─────────────────────────────────────────────
// Part 1: 普通 DNS vs 智能 DNS（按地域/运营商返回不同 IP）
// ─────────────────────────────────────────────
console.log('─ Part 1: 智能解析（GSLB）—— 按用户位置返回不同 IP ─');
console.log('  普通 DNS:  www.x.com → 1.2.3.4 (固定一个, 所有用户都去同一个地方)');
console.log('  智能 DNS: 同一域名按请求来源返回不同 IP:');

// 模拟云服务商 DNS 的 geo 路由表
const geoTable = {
  '华南-电信':   '120.196.0.1',
  '华南-联通':   '119.6.0.1',
  '华东-电信':   '101.226.0.1',
  '华北-电信':   '114.114.0.1',
  '海外-默认':   '8.8.8.1',
};

function smartResolve(region, domain) {
  // 智能 DNS：按 region 查表返回最近节点
  return { ip: geoTable[region] || geoTable['海外-默认'], region };
}
function plainResolve(domain) {
  // 普通 DNS：固定返回一个 IP（源站/单点）
  return { ip: '1.2.3.4', region: '源站(固定)' };
}

for (const region of ['华南-电信', '华东-电信', '海外-默认']) {
  console.log(`  用户[${region.padEnd(6)}] → 智能DNS: ${smartResolve(region, 'x.com').ip}   普通DNS: ${plainResolve('x.com').ip}`);
}
console.log('  → 智能 DNS 让「广州用户」和「上海用户」各连最近的节点，普通 DNS 全去源站');

// ─────────────────────────────────────────────
// Part 2: TTL 与故障转移速度
// ─────────────────────────────────────────────
console.log('\n─ Part 2: TTL 决定「更新/故障转移要多快」─');
function ttlDays(ttlSeconds) { return ttlSeconds / 86400; }

const records = {
  'TTL=60 (短TTL)':   60,
  'TTL=600 (默认)':   600,
  'TTL=86400 (1天)':  86400,
  'TTL=86400×7 (1周)': 604800,
};
console.log('  记录 TTL   →  含义');
for (const [name, ttl] of Object.entries(records)) {
  console.log(`  ${name.padEnd(18)} → 缓存 ${ttl >= 86400 ? ttlDays(ttl).toFixed(1) + ' 天' : ttl + ' 秒'}后失效`);
}

console.log('\n  「故障转移」时间 = 最坏情况 TTL（所有缓存都过期）:');
console.log('    · TTL=60   → 源站挂了，最多 1 分钟 DNS 才指向新地址');
console.log('    · TTL=1周  → 源站挂了，最坏 1 周用户还连旧的（灾难）');
console.log('    → 云服务商 DNS 的「健康检查 + 自动切换」就是在 TTL 内把解析切到新 IP');

// ─────────────────────────────────────────────
// Part 3: DoH（DNS over HTTPS）vs 传统 DNS
// ─────────────────────────────────────────────
console.log('\n─ Part 3: DoH vs 传统 DNS ─');
console.log('  传统 DNS:  UDP 53  明文 → 运营商可劫持/污染/记录');
console.log('  DoH:       HTTPS 443 加密 → 防劫持/污染，但依赖 DoH 服务器可用');

// 真实 DoH 查询（Cloudflare 1.1.1.1），可降级
function dohQuery(name, type = 'A') {
  return new Promise((resolve) => {
    const url = `https://cloudflare-dns.com/dns-query?name=${name}&type=${type}`;
    const req = https.request(url, {
      method: 'GET',
      headers: { 'Accept': 'application/dns-json' },
      timeout: 4000,
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const j = JSON.parse(data);
          const answer = (j.Answer || []).map(a => a.data).join(', ');
          resolve({ ok: true, answers: answer || '(无答案)', ttl: j.Answer?.[0]?.TTL });
        } catch (e) { resolve({ ok: false, error: 'JSON 解析失败' }); }
      });
    });
    req.on('error', () => resolve({ ok: false, error: '网络不可达（可能被墙/无外网）' }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: '超时' }); });
    req.end();
  });
}

(async () => {
  console.log('\n  实测 DoH 查询（Cloudflare 1.1.1.1, HTTPS 443）:');
  for (const host of ['www.baidu.com', 'www.github.com']) {
    const t0 = performance.now();
    const r = await dohQuery(host);
    const ms = (performance.now() - t0).toFixed(1);
    if (r.ok) console.log(`  ${host.padEnd(16)} → ${r.answers}  (TTL ${r.ttl}s, ${ms}ms)`);
    else console.log(`  ${host.padEnd(16)} → ${r.error} (${ms}ms)`);
  }
  console.log('  → DoH 查询走 HTTPS，运营商只看到「你在访问 1.1.1.1 的 443」，看不到你查了哪个域名');
  console.log('  ⚠️ 国内实测：Cloudflare 的 DoH 端点 cloudflare-dns.com 常不可达（GFW），实际用的是国内云厂商 DoH：');
  console.log('     阿里 223.5.5.5 (dns.alidns.com/resolve) · 腾讯 DNSPod 119.29.29.29 · 国内 DoH 既是加密又能就近');

  // ─────────────────────────────────────────────
  // Part 4: Anycast 就近路由概念
  // ─────────────────────────────────────────────
  console.log('\n─ Part 4: Anycast —— 云 DNS/CDN 的底层网络技术 ─');
  console.log('  传统 Unicast:  一个 IP 只在源站，全球用户都绕到它（延迟=用户到源站的距离）');
  console.log('  Anycast:       同一个 IP 在全世界多个机房广播，BGP 自动把用户路由到最近的机房');
  console.log('  → 云服务商 DNS 的解析服务器 IP（如 223.5.5.5 阿里/119.29.29.29 腾讯）就是 Anycast，');
  console.log('    全球用户连的是「离自己最近的那台解析服务器」');

  console.log('\n─ 汇总 ─');
  console.log('  云服务商 DNS 的优化价值 = ① 智能解析按地域就近调度 + ② 短 TTL/健康检查快速故障转移 + ③ DoH 防劫持 + ④ Anycast 全球就近解析');
  console.log('  与自建/运营商 DNS 相比：运营商 DNS 只做「域名→IP」，无调度、无健康检查、明文可劫持。');
})();
