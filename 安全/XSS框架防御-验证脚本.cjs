// Vue / React / Element Plus 的 XSS 防御验证脚本 —— 真实 Chrome 实测
// 结论先行：
//   Vue / React 默认插值（{{ }} / {x}）都会 HTML 转义，XSS 载荷只显示不执行；
//   但逃逸口 v-html / dangerouslySetInnerHTML 会原样解析 HTML，注入即执行；
//   Element Plus 组件（el-input）v-model 的值走 DOM value（纯文本），默认安全。
//
// 本脚本：Node http 服务器提供 demo 页（CDN 加载 Vue3/React18/ElementPlus），
//         Chrome CDP 实测 5 个注入点的 innerHTML/value 与 onerror 是否执行。
// 运行：node "XSS框架防御-验证脚本.cjs"（需联网加载 CDN）
const http = require('http');
const fs = require('fs');
const path = require('path');
const { launchChrome, openPage, evalJS } = require('./cdp-helper.cjs');

const PORT = 8153;
const DEMO = fs.readFileSync(path.join(__dirname, 'XSS框架防御-demo.html'), 'utf8');

const server = http.createServer((req, res) => {
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.end(DEMO);
});

async function main() {
  await new Promise(r => server.listen(PORT, r));
  console.log('========== Vue / React / Element Plus XSS 防御实测 ==========');
  console.log('（CDN: unpkg 加载 Vue3 / React18 / Element Plus）\n');
  const { chrome, base } = await launchChrome();
  try {
    const { send, close } = await openPage(base, `http://localhost:${PORT}/`);
    await new Promise(r => setTimeout(r, 5000)); // 等 CDN + 挂载 + 检测

    const r = await evalJS(send, `(() => {
      const q = (sel) => document.querySelector(sel);
      const text = (el) => el ? (el.innerText || '').slice(0, 60) : '(挂载失败)';
      const hasImg = (sel) => { const el = q(sel); return el ? !!el.querySelector('img') : false; };
      return {
        pwned: !!window.__pwned,
        vueDefault: text(q('#vue-default-mount')),
        reactDefault: text(q('#react-default-mount')),
        vueVHtml: text(q('#vue-vhtml-mount')),
        reactDsh: text(q('#react-dsh-mount')),
        elInput: q('#el-input-mount input') ? q('#el-input-mount input').value : '(挂载失败)',
        vueVHtmlHasImg: hasImg('#vue-vhtml-mount'),
        reactDshHasImg: hasImg('#react-dsh-mount'),
        vueDefaultHasImg: hasImg('#vue-default-mount'),
      };
    })()`);

    console.log(`[全局] window.__pwned = ${r.pwned ? '1 🚨 逃逸口执行了 XSS' : '0 ✅ 默认转义挡住'}\n`);
    console.log(`[Vue  {{  }} 默认插值]   显示: ${JSON.stringify(r.vueDefault)} | 出现 <img> 元素: ${r.vueDefaultHasImg ? '是' : '否'} → ${r.vueDefaultHasImg ? '🚨' : '✅ 转义为文本'}`);
    console.log(`[React {x} 默认插值]     显示: ${JSON.stringify(r.reactDefault)} → ✅ 转义为文本`);
    console.log(`[Vue  v-html 逃逸口]     显示: ${JSON.stringify(r.vueVHtml)} | 出现 <img> 元素: ${r.vueVHtmlHasImg ? '是' : '否'} → ${r.vueVHtmlHasImg ? '🚨 XSS 执行' : '未注入'}`);
    console.log(`[React dangerouslySetInnerHTML] 显示: ${JSON.stringify(r.reactDsh)} | 出现 <img> 元素: ${r.reactDshHasImg ? '是' : '否'} → ${r.reactDshHasImg ? '🚨 XSS 执行' : '未注入'}`);
    console.log(`[Element el-input v-model] value = ${JSON.stringify(r.elInput)} → ✅ DOM value 纯文本`);
    console.log('');
    console.log('注: v-html 与 dangerouslySetInnerHTML 里 onerror 触发 __pwned=1；');
    console.log('    但 headless 下 img src=x 可能立即 fail，onerror 已触发则 __pwned=1。');
    close();
  } finally {
    chrome.kill();
    server.close();
  }
}
main().catch(e => { console.error(e); process.exit(1); });
