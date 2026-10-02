// XSS（跨站脚本攻击）验证脚本 —— 真实 Chrome 实测
// 结论先行：
//   XSS = 攻击者把「代码」注入到受害者页面中执行。按注入点分三类：
//   ① 反射型：URL 参数 → 服务器拼接进 HTML 返回（不过滤则执行）
//   ② 存储型：输入存进数据库 → 其他用户访问时被渲染执行（最危险）
//   ③ DOM 型：纯前端漏洞，数据不进服务器，直接在 innerHTML 等 DOM 操作处执行
//
// 本脚本：Node http 服务器提供 4 个页面（反射/反射转义/DOM/DOM安全），
//         Chrome CDP 实测「攻击代码是否真的执行」。
// 运行：node "XSS-验证脚本.cjs"
const http = require('http');
const { launchChrome, openPage, evalJS } = require('./cdp-helper.cjs');

const PORT = 8123;
const ATTACK = `<img src=x onerror="window.__pwned=1;document.body.setAttribute('data-pwned','1')">`;
const ENC = encodeURIComponent(ATTACK);

const escapeHtml = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const name = url.searchParams.get('name') || '';
  const q = url.searchParams.get('q') || '';
  res.setHeader('content-type', 'text/html; charset=utf-8');
  if (url.pathname === '/reflected') {
    // ① 反射型·不转义：name 直接拼 HTML
    res.end(`<!DOCTYPE html><html><body>
      <h1 id="hello">你好, ${name}!</h1>
    </body></html>`);
  } else if (url.pathname === '/reflected-escaped') {
    // ①' 反射型·已转义：name 转义后拼 HTML
    res.end(`<!DOCTYPE html><html><body>
      <h1 id="hello">你好, ${escapeHtml(name)}!</h1>
    </body></html>`);
  } else if (url.pathname === '/dom') {
    // ③ DOM 型：innerHTML 拼接用户可控数据
    res.end(`<!DOCTYPE html><html><body>
      <div id="out"></div>
      <script>
        const q = new URLSearchParams(location.search).get('q');
        document.getElementById('out').innerHTML = '<b>' + q + '</b>';
      </script>
    </body></html>`);
  } else if (url.pathname === '/dom-safe') {
    // ③' DOM 型·安全：textContent 不解析 HTML
    res.end(`<!DOCTYPE html><html><body>
      <div id="out"></div>
      <script>
        const q = new URLSearchParams(location.search).get('q');
        const el = document.createElement('b');
        el.textContent = q;
        document.getElementById('out').appendChild(el);
      </script>
    </body></html>`);
  } else { res.end('ok'); }
});

async function main() {
  await new Promise(r => server.listen(PORT, r));
  const { chrome, base } = await launchChrome();
  console.log('========== XSS 实测：反射型 ==========');
  try {
    let { send, close } = await openPage(base, `http://localhost:${PORT}/reflected?name=${ENC}`);
    let r = await evalJS(send, `({ pwned: !!window.__pwned, text: document.getElementById('hello').innerText, injected: document.querySelector('img[onerror]') ? 'img存在' : '无' })`);
    console.log('[反射型·不转义] 攻击执行?', r.pwned ? '是 🚨' : '否', '| 页面文本:', r.text, '|', r.injected);
    close();

    ({ send, close } = await openPage(base, `http://localhost:${PORT}/reflected-escaped?name=${ENC}`));
    r = await evalJS(send, `({ pwned: !!window.__pwned, text: document.getElementById('hello').innerText, injected: document.querySelector('img[onerror]') ? 'img存在' : '无' })`);
    console.log('[反射型·已转义] 攻击执行?', r.pwned ? '是 🚨' : '否 ✅', '| 页面文本:', r.text, '|', r.injected);
    close();

    console.log('\n========== XSS 实测：DOM 型 ==========');
    ({ send, close } = await openPage(base, `http://localhost:${PORT}/dom?q=${ENC}`));
    r = await evalJS(send, `({ pwned: !!window.__pwned, html: document.getElementById('out').innerHTML })`);
    console.log('[DOM型·innerHTML] 攻击执行?', r.pwned ? '是 🚨' : '否', '| out.innerHTML:', r.html);
    close();

    ({ send, close } = await openPage(base, `http://localhost:${PORT}/dom-safe?q=${ENC}`));
    r = await evalJS(send, `({ pwned: !!window.__pwned, text: document.getElementById('out').innerText, html: document.getElementById('out').innerHTML })`);
    console.log('[DOM型·textContent] 攻击执行?', r.pwned ? '是 🚨' : '否 ✅', '| out 文本(原样):', r.text, '| innerHTML(已转义):', r.html);
    close();
  } finally {
    chrome.kill();
    server.close();
  }
}
main().catch(e => { console.error(e); process.exit(1); });
