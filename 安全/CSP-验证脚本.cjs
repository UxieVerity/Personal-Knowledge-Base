// CSP（内容安全策略）验证脚本 —— 真实 Chrome 实测
// 结论先行：
//   CSP = 通过响应头 Content-Security-Policy 声明「本页允许加载什么」，
//   由浏览器强制执行。三类最常见的策略指令：
//   - script-src：控制 JS（内联 / eval / 外部来源）
//   - img-src：控制图片来源（防「加载外站图」类数据外带）
//   - default-src：兜底其它资源
//   XSS 的纵深防御：即使开发者忘了转义，CSP 也能把内联脚本/onerror 拦下来。
//
// 本脚本：Node 服务器用不同 CSP 策略返回同一页面，Chrome CDP 实测哪些脚本执行了。
// 运行：node "CSP-验证脚本.cjs"
const http = require('http');
const { launchChrome, openPage, evalJS } = require('./cdp-helper.cjs');

const PORT = 8143;

// 页面：同时含 内联脚本、onerror、外部脚本、内联样式、远程图片 —— 看哪些被 CSP 放行
const PAGE = `<!DOCTYPE html><html><head>
  <style>.inline-style { color: red; }</style>
  <script>
    window.__inlineRan = 1;            // 内联脚本标记
  </script>
  <script>
    try { eval('window.__evalRan = 1'); } catch(e) { window.__evalBlocked = 1; }  // eval 标记
  </script>
</head><body>
  <h1 class="inline-style">CSP 测试页</h1>
  <img id="remote" src="http://evil.example/x.png" onerror="window.__onerrorRan = 1">
  <script src="/ext.js"></script>
  <script>window.__inline2Ran = 1;</script>
</body></html>`;

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname === '/') {
    const csp = url.searchParams.get('csp'); // ?csp=none|inline|self|img
    res.setHeader('content-type', 'text/html; charset=utf-8');
    if (csp === 'inline') {
      // 允许内联脚本，但禁 eval、禁外站图
      res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; img-src 'self'");
    } else if (csp === 'self') {
      // 严格：只允许同源外部脚本，内联/eval/onerror 全拦
      res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; img-src 'self'");
    } else if (csp === 'img') {
      // 只限制图片（不设 default-src，避免兜底影响脚本）
      res.setHeader('Content-Security-Policy', "img-src 'self'");
    }
    // csp === 'none' → 无 CSP 头（对照组）
    res.end(PAGE);
  } else if (url.pathname === '/ext.js') {
    res.setHeader('content-type', 'application/javascript');
    res.end(`window.__extRan = 1;
      try { eval('window.__evalRan = 1'); } catch(e) { window.__evalBlocked = 1; }`);
  } else { res.end('ok'); }
});

async function main() {
  await new Promise(r => server.listen(PORT, r));
  const { chrome, base } = await launchChrome();

  const probe = async (label, csp) => {
    const url = `http://localhost:${PORT}/?csp=${csp}`;
    const { send, close } = await openPage(base, url);
    const r = await evalJS(send, `({
      inline: !!window.__inlineRan,
      inline2: !!window.__inline2Ran,
      eval: !!window.__evalRan,
      evalBlocked: !!window.__evalBlocked,
      ext: !!window.__extRan,
      onerror: !!window.__onerrorRan,
      remoteImgLoaded: !!document.getElementById('remote').complete && !document.getElementById('remote').naturalWidth,
      remoteImgNatural: document.getElementById('remote').naturalWidth
    })`);
    console.log(`[${label}] 内联脚本:${r.inline ? '执行✅' : '拦截🚫'} | eval:${r.eval ? '执行✅' : (r.evalBlocked ? '拦截🚫' : '?')} | 外部脚本:${r.ext ? '执行✅' : '拦截🚫'} | onerror:${r.onerror ? '执行🚨' : '未执行✅'} | 远程图:${r.remoteImgNatural > 0 ? '加载' : '拦截🚫'}`);
    close();
  };

  console.log('========== CSP 实测：无 CSP（对照组） ==========');
  await probe('无 CSP      ', 'none');
  console.log('\n========== CSP 实测：script-src 严格 ==========');
  await probe("script-src 'self'", 'self');
  console.log('\n========== CSP 实测：script-src 含 unsafe-inline ==========');
  await probe("+unsafe-inline", 'inline');
  console.log('\n========== CSP 实测：仅限制图片 ==========');
  await probe("img-src 'self'", 'img');

  chrome.kill();
  server.close();
}
main().catch(e => { console.error(e); process.exit(1); });
