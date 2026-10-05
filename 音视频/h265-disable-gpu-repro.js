// 复现当初 false 的来源：--disable-gpu + 启动器传了一堆启动参数的 headless
// 关键变量其实是 --disable-gpu（软件渲染 → 平台 H265 硬解不可用）
const puppeteer = require('puppeteer-core');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--disable-gpu', '--use-gl=swiftshader'],
  });
  const page = await browser.newPage();
  await page.goto('about:blank');
  const res = await page.evaluate(() => ({
    mseHvc1: MediaSource.isTypeSupported('video/mp4; codecs="hvc1.1.6.L93.B0"'),
    canPlay: document.createElement('video').canPlayType('video/mp4; codecs="hvc1.1.6.L93.B0"'),
  }));
  console.log('headless + disable-gpu + swiftshader:', JSON.stringify(res));
  await browser.close();
})();
