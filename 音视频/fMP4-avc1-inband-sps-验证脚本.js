#!/usr/bin/env node
/**
 * 验证「MSE 声明 avc1 + mdat 里的 I 帧前带 in-band SPS/PPS」能否正常播放
 *
 * 四个场景（同一 x264 源，repeat-headers=1，10s 320x180 30fps）：
 *   A. codecs=avc1 + 纯 avc1 fMP4（samples 无参数集）        —— 基线
 *   B. codecs=avc1 + 带 in-band SPS/PPS 的 fMP4（tag 改 avc1 但码流保留参数集）—— 用户实际用法
 *   C. codecs=avc3 + 带 in-band SPS/PPS 的 fMP4             —— 规范推荐写法
 *   D. codecs=avc3 + 纯 avc1 fMP4（无 in-band 参数集）        —— 反向错配
 *
 * B 的构造：ffmpeg -c copy -tag:v avc1 无法保留 in-band 参数集（muxer 会剥），
 * 所以用 mp4box 风格手工改：直接对 avc3 文件把 stsd 里的 sample entry type
 * 'avc3' 四字节改成 'avc1'（两文件除 tag 外结构完全一致，改 4 字节即可）。
 * 这样字节流的 in-band 参数集原样保留，而 stsd 声明为 avc1 —— 正是「声明 avc1
 * 却在 I 帧 mdat 里插了 SPS/PPS」的场景。
 *
 * 用法：node fMP4-avc1-inband-sps-验证脚本.js [--gen-only]
 * 输出：每个场景 isTypeSupported / appendBuffer / buffered / 播放 2.5s 的实测结果
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const PORT = 8933;
const WORK = path.join(__dirname, 'media');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PPTR = process.env.PPTR_DIR || 'C:\\Users\\13511\\AppData\\Local\\Temp\\pptr-av';

/* ---------- 媒体构造 ---------- */
function buildMedia() {
  fs.mkdirSync(WORK, { recursive: true });
  const flags = 'frag_keyframe+empty_moov+default_base_moof';

  // 1) 纯 avc1：ffmpeg 默认会抽干 sample 里的参数集 → avc1 基线
  execSync(`ffmpeg -y -v error -f lavfi -i testsrc2=size=320x180:rate=30:duration=10 ` +
    `-c:v libx264 -preset ultrafast -crf 30 -pix_fmt yuv420p -g 30 -an ` +
    `-tag:v avc1 -movflags ${flags} avc1-pure.mp4`, { cwd: WORK, stdio: 'inherit' });

  // 2) avc3 in-band：x264 repeat-headers=1 造裸流再封装，I 帧前带 SPS/PPS
  execSync(`ffmpeg -y -v error -f lavfi -i testsrc2=size=320x180:rate=30:duration=10 ` +
    `-c:v libx264 -preset ultrafast -crf 30 -pix_fmt yuv420p -g 30 ` +
    `-x264-params repeat-headers=1 -f h264 raw-inband.h264`, { cwd: WORK, stdio: 'inherit' });
  execSync(`ffmpeg -y -v error -i raw-inband.h264 -c copy ` +
    `-movflags ${flags} -tag:v avc3 avc3-inband.mp4`, { cwd: WORK, stdio: 'inherit' });

  // 3) 用户场景 B：把 avc3-inband.mp4 的 sample entry type 改成 avc1（仅 4 字节）
  //    → 字节流与 avc3-inband 完全一致（I 帧 mdat 前有 SPS/PPS），但声明为 avc1
  const b = fs.readFileSync(path.join(WORK, 'avc3-inband.mp4'));
  // 找 stsd 内的 avc3（直接搜四个字节 'avc3'，此文件中唯一出现在 sample entry）
  const sig = Buffer.from('avc3');
  const idx = b.indexOf(sig);
  if (idx === -1) throw new Error('avc3 tag not found');
  b.write('avc1', idx, 'latin1');
  fs.writeFileSync(path.join(WORK, 'avc1-declared-inband.mp4'), b);

  console.log('media ready:', fs.readdirSync(WORK).join(', '));
}

/* ---------- NAL 序列检查（证明 B/C 的 mdat 确实带 SPS/PPS，A/D 不带） ---------- */
function mdatNalSummary(file) {
  const buf = fs.readFileSync(file);
  const nals = [];
  let off = 0;
  while (true) {
    const i = buf.indexOf(Buffer.from('mdat'), off);
    if (i === -1 || i + 4 > buf.length) break;
    const size = buf.readUInt32BE(i - 4);
    const end = Math.min(i - 4 + size, buf.length);
    let p = i + 4;
    while (p + 4 <= end && nals.length < 400) {
      const len = buf.readUInt32BE(p);
      if (len < 1 || p + 4 + len > end) break;
      const nt = buf[p + 4] & 0x1f;
      if (nt === 7 || nt === 5) nals.push(nt === 7 ? 'SPS' : 'IDR');
      p += 4 + len;
    }
    off = i + 4;
  }
  const sps = nals.filter(n => n === 'SPS').length;
  const idr = nals.filter(n => n === 'IDR').length;
  return `mdat: SPS×${sps} IDR×${idr}${sps > 0 ? '（in-band 参数集保留）' : '（无 in-band 参数集）'}`;
}

/* ---------- 页面：纯 MSE 播放器（声明 codecs 可配） ---------- */
const PAGE = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body>
<script>
window.__result = null;
async function runTest(url, mime) {
  const r = { url, mime, supported: MediaSource.isTypeSupported(mime) };
  if (!r.supported) { window.__result = r; return; }
  const v = document.createElement('video');
  v.muted = true;
  const ms = new MediaSource();
  v.src = URL.createObjectURL(ms);
  await new Promise(res => ms.addEventListener('sourceopen', res, { once: true }));
  try {
    const sb = ms.addSourceBuffer(mime);
    const resp = await fetch(url);
    const total = await resp.arrayBuffer();
    r.bytes = total.byteLength;
    // 分 3 段喂，模拟真实推流
    const chunk = Math.ceil(total.byteLength / 3);
    r.chunks = [];
    for (let i = 0; i < 3; i++) {
      const buf = total.slice(i * chunk, Math.min(total.byteLength, (i + 1) * chunk));
      const done = new Promise((resolve, reject) => {
        sb.addEventListener('updateend', resolve, { once: true });
        sb.addEventListener('error', () => reject(new Error('SourceBuffer error at chunk ' + (i+1))), { once: true });
      });
      sb.appendBuffer(buf);
      await done;
      const tr = [];
      for (let k = 0; k < sb.buffered.length; k++) tr.push([+sb.buffered.start(k).toFixed(2), +sb.buffered.end(k).toFixed(2)]);
      r.chunks.push({ appended: buf.byteLength, buffered: tr });
    }
    // 播放 2.5s 验证真的能解出画面
    await v.play();
    const q0 = v.getVideoPlaybackQuality ? v.getVideoPlaybackQuality() : null;
    await new Promise(res => {
      const t0 = Date.now();
      const iv = setInterval(() => {
        if (v.currentTime > 2.5 || Date.now() - t0 > 8000) { clearInterval(iv); res(); }
      }, 100);
    });
    r.played = +v.currentTime.toFixed(2);
    r.readyState = v.readyState;
    r.dropped = v.getVideoPlaybackQuality ? v.getVideoPlaybackQuality().droppedVideoFrames : null;
    const q = v.getVideoPlaybackQuality ? v.getVideoPlaybackQuality() : null;
    r.decodedFrames = q ? q.totalVideoFrames : null;
    r.ok = v.currentTime > 2.0;
    r.error = v.error ? (v.error.code + ' ' + v.error.message) : null;
  } catch (e) {
    r.ok = false;
    r.error = e.message;
    if (v.error) r.error += ' | video.error: ' + v.error.code + ' ' + v.error.message;
  }
  window.__result = r;
}
</script></body></html>`;

/* ---------- headless 实测 ---------- */
async function measure() {
  const puppeteer = require(path.join(PPTR, 'node_modules', 'puppeteer-core'));
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
  });
  const page = await browser.newPage();
  page.on('console', m => console.log('  [page]', m.text()));
  page.on('pageerror', e => console.log('  [pageerror]', e.message));
  // 先起服务器再导航到真实 http 页面（about:blank 上 fetch 相对 URL 会失败）
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });

  const cases = [
    ['A. codecs=avc1 + 纯avc1流（基线）',            '/media/avc1-pure.mp4',            'video/mp4; codecs="avc1.42E01E"'],
    ['B. codecs=avc1 + I帧带in-band SPS/PPS（用户用法）', '/media/avc1-declared-inband.mp4', 'video/mp4; codecs="avc1.42E01E"'],
    ['C. codecs=avc3 + I帧带in-band SPS/PPS（规范写法）', '/media/avc3-inband.mp4',          'video/mp4; codecs="avc3.42E01E"'],
    ['D. codecs=avc3 + 纯avc1流（反向错配）',          '/media/avc1-pure.mp4',            'video/mp4; codecs="avc3.42E01E"'],
  ];
  const results = [];
  for (const [label, url, mime] of cases) {
    console.log('\n=== ' + label + ' ===');
    console.log('  ' + mdatNalSummary(path.join(WORK, path.basename(url))));
    await page.evaluate((u, m) => runTest(u, m), url, mime);
    let res = null;
    for (let i = 0; i < 40; i++) {
      res = await page.evaluate(() => window.__result);
      if (res) break;
      await new Promise(r => setTimeout(r, 250));
    }
    results.push({ label, res });
    console.log(JSON.stringify(res, null, 1));
  }
  await browser.close();
  return results;
}

/* ---------- 主流程 ---------- */
(async () => {
  if (!fs.existsSync(path.join(WORK, 'avc1-declared-inband.mp4'))) {
    console.log('构造测试媒体…');
    buildMedia();
    console.log('\n字节流自检:');
    console.log('  avc1-pure.mp4        → ' + mdatNalSummary(path.join(WORK, 'avc1-pure.mp4')));
    console.log('  avc3-inband.mp4      → ' + mdatNalSummary(path.join(WORK, 'avc3-inband.mp4')));
    console.log('  avc1-declared-inband → ' + mdatNalSummary(path.join(WORK, 'avc1-declared-inband.mp4')));
  }
  const srv = http.createServer((req, res) => {
    const p = req.url.split('?')[0];
    if (p === '/') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(PAGE); return; }
    const file = path.join(WORK, decodeURIComponent(p.replace('/media/', '')));
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); res.end('nf'); return; }
      res.writeHead(200, { 'Content-Type': 'video/mp4' });
      res.end(data);
    });
  });
  await new Promise(r => srv.listen(PORT, r));
  try {
    const results = await measure();
    fs.writeFileSync(path.join(__dirname, 'fMP4-avc1-inband-sps-实测结果.json'), JSON.stringify(results, null, 1));
    console.log('\n结果已写入 fMP4-avc1-inband-sps-实测结果.json');
  } finally { srv.close(); }
})().catch(e => { console.error(e); process.exit(1); });
