// 安全笔记验证共用工具：Node 内置 WebSocket 直连 Chrome DevTools Protocol (CDP)
// 用法：在真实 Chrome 页面加载 URL → 等待加载 → 执行 JS 取回结果
// 依赖：Node 22+（内置 WebSocket、fetch）
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

// 启动 headless Chrome，返回 { chrome, port }
async function launchChrome() {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-chrome-'));
  const port = 9300 + Math.floor(Math.random() * 500);
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox',
    `--user-data-dir=${userDataDir}`,
    `--remote-debugging-port=${port}`,
    '--remote-allow-origins=*', 'about:blank',
  ], { stdio: 'ignore' });

  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 50; i++) {
    try {
      await fetch(`${base}/json/version`);
      return { chrome, base };
    } catch (e) { await new Promise(r => setTimeout(r, 100)); }
  }
  chrome.kill();
  throw new Error('Chrome CDP 端口未就绪');
}

// 新建 tab 加载 url，返回 { send } 可用的 CDP 会话（已连 ws）
async function openPage(base, url) {
  // 通过 HTTP 端点创建新 tab 并直接导航
  const res = await fetch(`${base}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
  const tab = await res.json();
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });

  let id = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const mid = ++id;
    pending.set(mid, (m) => m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result));
    ws.send(JSON.stringify({ id: mid, method, params }));
  });

  await send('Page.enable');
  await send('Runtime.enable');
  // 等页面加载完成
  await new Promise((resolve) => {
    const t0 = Date.now();
    const check = async () => {
      const out = await send('Runtime.evaluate', { expression: 'document.readyState', returnByValue: true });
      const val = out && out.result && out.result.value;
      if (val === 'complete' || Date.now() - t0 > 8000) resolve();
      else setTimeout(check, 100);
    };
    check();
  });
  await new Promise(r => setTimeout(r, 300)); // 等脚本执行完

  return { send, close: () => ws.close() };
}

// 在页面里执行 JS，返回返回值
async function evalJS(send, expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
  const v = r && r.result && r.result.value;
  return typeof v === 'string' ? v : v;
}

module.exports = { launchChrome, openPage, evalJS, CHROME };
