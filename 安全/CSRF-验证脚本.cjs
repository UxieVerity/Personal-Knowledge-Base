// CSRF（跨站请求伪造）验证脚本 —— 真实 Chrome 实测
// 结论先行：
//   CSRF = 攻击者诱导受害者在「已登录的站点 A」上执行非本意操作。
//   根因：浏览器发请求时「自动携带 A 的 Cookie」，且「跨站请求不被浏览器拦截」。
//   关键机制：Cookie 按「域名」发送，不按「页面来源」判断 —— 攻击站 B 的页面
//             发请求到 A，浏览器照样带上 A 的 Cookie。
//
// 防护三件套：① SameSite Cookie（Lax/Strict）② CSRF Token ③ 校验 Origin/Referer
//
// 本脚本：Node 起两个「站点」+ Chrome CDP 实测：
//   - 受害站 127.0.0.1:8133（带登录 Cookie 的转账接口）
//   - 攻击站 localhost:8134（恶意表单页面；与受害站不同 hostname → 真正跨站）
//   - 分别实测：无防护 / SameSite=Lax / CSRF Token 三种配置
// 运行：node "CSRF-验证脚本.cjs"
const http = require('http');
const { launchChrome, openPage, evalJS } = require('./cdp-helper.cjs');

const VICTIM_HOST = '127.0.0.1';   // 受害站：127.0.0.1（与攻击站的 localhost 是不同 site → 真正跨站）
const VICTIM_PORT = 8133;
const ATTACK_HOST = 'localhost';   // 攻击站：localhost（不同 hostname，Chrome 视为不同 site）
const ATTACK_PORT = 8134;
const VICTIM_ORIGIN = `http://${VICTIM_HOST}:${VICTIM_PORT}`;
const ATTACK_ORIGIN = `http://${ATTACK_HOST}:${ATTACK_PORT}`;

// ---------- 受害站：带「登录态 Cookie」+ 转账接口 ----------
let mode = 'none'; // none | samesite-lax | token
let transferLog = [];

const victim = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${VICTIM_HOST}:${VICTIM_PORT}`);
  // 登录接口：设置 Cookie（按 mode 设置不同 SameSite）
  if (url.pathname === '/login') {
    let cookie;
    if (mode === 'none') cookie = 'session=abc123; Path=/; SameSite=None';         // 显式允许第三方携带（真无防护）
    else if (mode === 'samesite-lax') cookie = 'session=abc123; Path=/; SameSite=Lax';
    else if (mode === 'default') cookie = 'session=abc123; Path=/';                // 无属性 → 现代浏览器默认按 Lax
    res.setHeader('Set-Cookie', cookie);
    res.end('<h1>已登录</h1>');
    return;
  }
  // 转账接口（记录 GET/POST、Cookie、Referer，按 mode 决定是否校验 Token）
  if (url.pathname === '/transfer') {
    const cookie = req.headers.cookie || '';
    const authed = cookie.includes('session=abc123');
    const referer = req.headers.referer || '(无)';
    const rec = { method: req.method, authed, amt: '?', to: '?', cookie: cookie ? '带Cookie' : '无Cookie', referer };

    const finish = () => {
      transferLog.push(rec);
      res.end('transfer:' + rec.method + ' ' + (rec.authed ? '已登录' : '未登录'));
    };
    if (req.method === 'GET') {
      rec.amt = url.searchParams.get('amount') || '?';
      rec.to = url.searchParams.get('to') || '?';
      finish();
      return;
    }
    // POST
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      rec.amt = /amount=(\d+)/.exec(body)?.[1] || '?';
      rec.to = /to=([^&]+)/.exec(body)?.[1] || '?';
      const token = /csrf_token=([^&]*)/.exec(body)?.[1] || '';
      rec.token = token || '(无)';
      if (mode === 'token' && token !== 'REAL_TOKEN') {
        rec.result = 'TOKEN失败';
        finish();
        return;
      }
      rec.result = rec.authed ? '成功' : '未登录';
      finish();
    });
    return;
  }
  res.end('victim ok');
});

// ---------- 攻击站：恶意页面 ----------
const attack = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${ATTACK_HOST}:${ATTACK_PORT}`);
  res.setHeader('content-type', 'text/html; charset=utf-8');
  if (url.pathname === '/') {
    // 恶意页面：一个自动提交的隐藏表单 + 一个图片（GET 型）
    res.end(`<!DOCTYPE html><html><body>
      <h1>攻击者页面（看起来是普通网页）</h1>
      <img src="${VICTIM_ORIGIN}/transfer?amount=9999&to=hacker" width="1" height="1">
      <form id="f" action="${VICTIM_ORIGIN}/transfer" method="POST">
        <input type="hidden" name="amount" value="9999">
        <input type="hidden" name="to" value="hacker">
      </form>
      <script>document.getElementById('f').submit();</script>
      <p>页面加载完（受害者毫无察觉）</p>
    </body></html>`);
  } else { res.end('attack ok'); }
});

async function main() {
  await new Promise(r => victim.listen(VICTIM_PORT, r));
  await new Promise(r => attack.listen(ATTACK_PORT, r));
  const { chrome, base } = await launchChrome();

  try {
    // 场景 1：Cookie 无 SameSite 属性（Lax-allow-unsafe 豁免窗口内）→ 经典 CSRF 成功
    mode = 'default';
    transferLog = [];
    console.log('========== CSRF 实测①：无 SameSite 属性（旧站点/豁免窗口内） ==========');
    // ① 先登录受害站（种 Cookie，无 SameSite 属性）
    let { send, close } = await openPage(base, `${VICTIM_ORIGIN}/login`);
    let r = await evalJS(send, `({ cookie: document.cookie })`);
    console.log('[登录] 受害站 Cookie:', r.cookie, '（无 SameSite 属性）');
    close();

    // ② 访问攻击站页面（会自动提交表单 + 图片请求）
    ({ send, close } = await openPage(base, `${ATTACK_ORIGIN}/`));
    await new Promise(r2 => setTimeout(r2, 600)); // 等表单提交完成
    close();
    // ③ 查看受害站转账日志
    console.log('[受害站日志] 收到的转账请求:');
    transferLog.forEach(t => console.log(`  ${t.method} 向${t.to} 转${t.amt}元 | ${t.authed ? '带登录Cookie(已登录)' : '未登录'} | ${t.cookie} | Referer:${t.referer.slice(0, 60)}`));
    console.log('[结论] 攻击者能伪造转账吗?', transferLog.some(t => t.authed && t.method === 'POST') ? '是 🚨 CSRF 成功（Cookie 被自动携带）' : '否');

    // 场景 2：SameSite=None 在 http 下被拒（知识点）
    mode = 'none';
    transferLog = [];
    console.log('\n========== CSRF 实测②：SameSite=None（http 下被拒） ==========');
    // 先清掉浏览器里所有 cookie（避免场景①残留干扰）
    ({ send, close } = await openPage(base, 'about:blank'));
    await send('Network.enable');
    await send('Network.clearBrowserCookies');
    close();
    ({ send, close } = await openPage(base, `${VICTIM_ORIGIN}/login`));
    r = await evalJS(send, `({ cookie: document.cookie })`);
    console.log('[登录] Cookie:', r.cookie ? r.cookie : '(空 → SameSite=None 在非 https 下被 Chrome 拒绝!)');
    close();
    console.log('[知识点] SameSite=None 必须搭配 Secure（https）才能设置，否则浏览器直接丢弃 —— 这是刻意设计');

    // 场景 3：SameSite=Lax 防护
    mode = 'samesite-lax';
    transferLog = [];
    console.log('\n========== CSRF 实测③：SameSite=Lax 防护 ==========');
    ({ send, close } = await openPage(base, 'about:blank'));
    await send('Network.enable');
    await send('Network.clearBrowserCookies');
    close();
    ({ send, close } = await openPage(base, `${VICTIM_ORIGIN}/login`));
    r = await evalJS(send, `({ cookie: document.cookie })`);
    console.log('[登录] Cookie:', r.cookie);
    close();
    ({ send, close } = await openPage(base, `${ATTACK_ORIGIN}/`));
    await new Promise(r2 => setTimeout(r2, 600));
    close();
    console.log('[受害站日志] 收到的转账请求:');
    transferLog.forEach(t => console.log(`  ${t.method} 向${t.to} 转${t.amt}元 | ${t.authed ? '带登录Cookie(已登录)' : '未登录'} | ${t.cookie} | Referer:${t.referer.slice(0, 60)}`));
    console.log('[结论] SameSite=Lax 下跨站 POST 是否被带 Cookie?', transferLog.some(t => t.method === 'POST' && t.authed) ? '是 🚨' : '否 ✅ (POST 不带 Cookie 被拦截)');
    console.log('  （注意: Lax 允许跨站顶层导航 GET 带 Cookie，所以上面的 GET 可能仍带 —— 这正是 Lax 的设计取舍）');

    // 场景 4：CSRF Token 防护
    mode = 'token';
    transferLog = [];
    console.log('\n========== CSRF 实测④：CSRF Token 防护 ==========');
    const attackToken = http.createServer((req, res) => {
      const url = new URL(req.url, `http://${ATTACK_HOST}:${ATTACK_PORT + 1}`);
      res.setHeader('content-type', 'text/html; charset=utf-8');
      if (url.pathname === '/') {
        res.end(`<!DOCTYPE html><html><body>
          <form id="f" action="${VICTIM_ORIGIN}/transfer" method="POST">
            <input type="hidden" name="amount" value="9999">
            <input type="hidden" name="to" value="hacker">
            <input type="hidden" name="csrf_token" value="FAKE_TOKEN">
          </form>
          <script>document.getElementById('f').submit();</script>
        </body></html>`);
      } else res.end('ok');
    });
    await new Promise(r2 => attackToken.listen(ATTACK_PORT + 1, r2));
    // 清 cookie 后登录受害站：用无 SameSite 属性的 Cookie（能被跨站携带，证明拦截是 Token 的功劳）
    ({ send, close } = await openPage(base, 'about:blank'));
    await send('Network.enable');
    await send('Network.clearBrowserCookies');
    close();
    mode = 'default';
    ({ send, close } = await openPage(base, `${VICTIM_ORIGIN}/login`));
    close();
    mode = 'token'; // 转账接口切换为校验 Token
    // 访问带假 token 的攻击页
    ({ send, close } = await openPage(base, `http://${ATTACK_HOST}:${ATTACK_PORT + 1}/`));
    await new Promise(r2 => setTimeout(r2, 600));
    close();
    console.log('[受害站日志] 收到的转账请求:');
    transferLog.forEach(t => console.log(`  ${t.method} 向${t.to} 转${t.amt}元 | ${t.authed ? '已登录' : '未登录'} | token=${t.token}`));
    console.log('[结论] 假 token 能否得逞?', transferLog.some(t => t.result === '成功') ? '是 🚨' : '否 ✅ (Token 校验拦截)');
    attackToken.close();
  } finally {
    chrome.kill();
    victim.close();
    attack.close();
  }
}
main().catch(e => { console.error(e); process.exit(1); });
