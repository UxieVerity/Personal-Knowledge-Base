#!/usr/bin/env node
/**
 * MSE 最小播放器 demo 的本地服务器 + 无头实测脚本
 *
 * 用法：
 *   1. 生成测试媒体（需要 ffmpeg 在 PATH）：
 *      node mse-player-server.js --gen
 *   2. 只起服务器（供浏览器手动打开 demo）：
 *      node mse-player-server.js --serve
 *   3. 起服务器 + headless Chrome 跑完 3 个场景并打印结果（默认）：
 *      node mse-player-server.js
 *
 * 服务器在脚本内部启动/关闭（不依赖外部后台进程），端口 8932。
 * Chrome 路径默认 C:\Program Files\Google\Chrome\Application\chrome.exe。
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');

const PORT = 8932;
const DIR = __dirname;
const MEDIA = path.join(DIR, 'media');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

/* ---------- 媒体生成 ---------- */
function genMedia() {
  fs.mkdirSync(MEDIA, { recursive: true });
  const flags = '+frag_keyframe+empty_moov+default_base_moof';
  const jobs = [
    // 320x180 10s 合成源，小文件快跑
    { out: 'h264-video.mp4', args: [
      '-f','lavfi','-i','testsrc2=size=320x180:rate=30:duration=10',
      '-c:v','libx264','-preset','ultrafast','-crf','30','-pix_fmt','yuv420p',
      '-an','-movflags',flags ] },
    { out: 'h264-full.mp4', args: [
      '-f','lavfi','-i','testsrc2=size=320x180:rate=30:duration=10',
      '-f','lavfi','-i','sine=frequency=440:duration=10',
      '-c:v','libx264','-preset','ultrafast','-crf','30','-pix_fmt','yuv420p',
      '-c:a','aac','-b:a','48k','-shortest','-movflags',flags ] },
  ];
  for (const j of jobs) {
    const out = path.join(MEDIA, j.out);
    execSync(`ffmpeg -y -v error "${j.args.join(' ').replace(/"/g, '\\"')}" "${out}"`, { shell: 'C:\\Program Files\\Git\\bin\\bash.exe' });
    console.log('generated', j.out, fs.statSync(out).size, 'bytes');
  }
}
function genMediaDirect() {
  fs.mkdirSync(MEDIA, { recursive: true });
  const flags = '+frag_keyframe+empty_moov+default_base_moof';
  const jobs = [
    { out: 'h264-video.mp4', args: ['-f','lavfi','-i','testsrc2=size=320x180:rate=30:duration=10','-c:v','libx264','-preset','ultrafast','-crf','30','-pix_fmt','yuv420p','-an','-movflags',flags] },
    { out: 'h264-full.mp4', args: ['-f','lavfi','-i','testsrc2=size=320x180:rate=30:duration=10','-f','lavfi','-i','sine=frequency=440:duration=10','-c:v','libx264','-preset','ultrafast','-crf','30','-pix_fmt','yuv420p','-c:a','aac','-b:a','48k','-shortest','-movflags',flags] },
  ];
  for (const j of jobs) {
    const out = path.join(MEDIA, j.out);
    execSync('ffmpeg -y -v error ' + j.args.map(a => JSON.stringify(a)).join(' ') + ' ' + JSON.stringify(out), { stdio: 'inherit' });
    console.log('generated', j.out, fs.statSync(out).size, 'bytes');
  }
}

/* ---------- 服务器 ---------- */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mp4': 'video/mp4' };
function startServer() {
  const srv = http.createServer((req, res) => {
    let p = req.url.split('?')[0];
    if (p === '/' || p === '/mse-player-demo.html') p = '/MSE最小播放器-验证demo.html';
    const file = p.startsWith('/media/')
      ? path.join(MEDIA, path.basename(p))
      : path.join(DIR, decodeURIComponent(p.slice(1)));
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      res.end(data);
    });
  });
  return new Promise(resolve => srv.listen(PORT, () => resolve(srv)));
}

/* ---------- headless 实测 ---------- */
async function measure() {
  // puppeteer-core 从临时工具目录解析（知识库目录不装 node_modules）
  const PPTR = process.env.PPTR_DIR || 'C:\\Users\\13511\\AppData\\Local\\Temp\\pptr-av';
  const puppeteer = require(path.join(PPTR, 'node_modules', 'puppeteer-core'));
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
  });
  const page = await browser.newPage();
  page.on('console', m => { const t = m.text(); if (!t.startsWith('DevTools')) console.log('  [page]', t); });
  await page.goto(`http://localhost:${PORT}/mse-player-demo.html`, { waitUntil: 'load' });

  const scenarios = ['mp4', 'mp4full', 'chunked'];
  const results = [];
  for (const s of scenarios) {
    await page.select('#srcSel', s);
    await page.evaluate(() => { window.__mseResult = null; });
    await page.click('#btnRun');
    // 轮询结果（异步播放要等）
    let res = null;
    for (let i = 0; i < 60; i++) {
      res = await page.evaluate(() => window.__mseResult);
      if (res) break;
      await new Promise(r => setTimeout(r, 500));
    }
    results.push({ scenario: s, res });
    console.log(`\n=== ${s} ===`);
    console.log(JSON.stringify(res, null, 1));
  }
  await browser.close();
  return results;
}

/* ---------- 主流程 ---------- */
(async () => {
  const arg = process.argv[2];
  if (arg === '--gen') { genMediaDirect(); return; }
  if (arg === '--serve') {
    await startServer();
    console.log(`serving demo at http://localhost:${PORT}/mse-player-demo.html  (Ctrl+C 停止)`);
    return;
  }
  // 默认：gen(如缺) → serve → measure → close
  if (!fs.existsSync(path.join(MEDIA, 'h264-video.mp4'))) {
    console.log('媒体文件缺失，先生成…');
    genMediaDirect();
  }
  const srv = await startServer();
  try {
    const results = await measure();
    fs.writeFileSync(path.join(DIR, 'measure-result.json'), JSON.stringify(results, null, 1));
    console.log('\n结果已写入 measure-result.json');
  } finally {
    srv.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
