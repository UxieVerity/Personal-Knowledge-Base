// 验证：Chrome H265 MSE 开关到底是「策略白名单」还是「运行时查平台硬解」
// 对比四种环境下的 isTypeSupported('video/mp4; codecs="hvc1.1.6.L93.B0"')
const puppeteer = require('puppeteer-core');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const CASES = [
  { name: 'A 有头 + 默认flags', args: ['--no-sandbox'], headless: false },
  { name: 'B 有头 + --disable-gpu', args: ['--no-sandbox', '--disable-gpu'], headless: false },
  { name: 'C headless=new + 默认flags', args: ['--no-sandbox'], headless: 'new' },
  { name: 'D headless=new + --disable-gpu', args: ['--no-sandbox', '--disable-gpu'], headless: 'new' },
];

(async () => {
  for (const c of CASES) {
    const browser = await puppeteer.launch({
      executablePath: CHROME, headless: c.headless,
      args: [...c.args, `--user-data-dir=C:/Users/13511/AppData/Local/Temp/pptr-av/profile-${Date.now()}`],
    });
    const page = await browser.newPage();
    await page.goto('about:blank');
    const res = await page.evaluate(async () => {
      const out = { ua: (navigator.userAgent.match(/Chrome\/[\d.]+/) || [])[0] };
      out.mseHvc1 = MediaSource.isTypeSupported('video/mp4; codecs="hvc1.1.6.L93.B0"');
      out.canPlayHvc1 = document.createElement('video').canPlayType('video/mp4; codecs="hvc1.1.6.L93.B0"');
      out.hwAccel = await new Promise(r => { // 查 GPU 视频解码是否初始化
        const gpu = (performance.getContext?.('webgl') && true) || true; r(out.hwAccel = 'see-cdp');
      });
      return out;
    });
    // CDP 查 GPU 设备（确认是否有真 GPU 参与渲染进程）
    let gpu = null;
    try {
      const cdp = await browser.target().createCDPSession();
      const info = await cdp.send('SystemInfo.getInfo');
      gpu = info.gpu.devices.map(d => d.deviceString).filter((v, i, a) => v && a.indexOf(v) === i);
    } catch (e) { gpu = ['cdp err']; }
    console.log(`${c.name}\n  MSE hvc1: ${res.mseHvc1}  canPlayType: ${res.canPlayHvc1 || '(空)'}  GPU: ${gpu.join(' | ')}  [${res.ua}]`);
    await browser.close();
  }
})();
