// cjs/umd/esm 区别 —— 可运行验证脚本（主入口用 .cjs，便于同时 require CJS/UMD + import ESM）
// 运行：node "cjs，umd，esm的区别-验证脚本.cjs"
// 环境：Node 26（实测）
const path = require('path');

async function main() {
  console.log('========== 1. CJS vs ESM 加载与导出 ==========');

  // --- CJS 加载（同步 require）---
  const cjs = require('./math-util.cjs');
  console.log('[CJS] add(1,2) =', cjs.add(1, 2));

  // --- UMD 在 Node (CJS 环境) 下加载（走的 CJS 分支）---
  const umd = require('./math-util-umd.js');
  console.log('[UMD/CJS 环境] add(1,2) =', umd.add(1, 2), '| name =', umd.name);

  // --- IIFE 加载（模块化之前浏览器方案：闭包 + 挂全局，无导出系统）---
  require('./math-util-iife.js');   // 执行 IIFE，把 API 挂到 globalThis.MathUtilIIFE
  const iife = globalThis.MathUtilIIFE;
  console.log('[IIFE] add(1,2) =', iife.add(1, 2), '| name =', iife.name);
  iife.bump(); iife.bump();
  console.log('[IIFE] 私有 count 外部访问 =', iife.count, '(undefined → 闭包私有，只能走 getCount)');
  console.log('[IIFE] getCount() =', iife.getCount(), '(闭包内 count 被 bump 两次 → 2)');
  console.log('[IIFE] 依赖注入 =', globalThis.IIFEWithDeps.gotDep);
  console.log('[IIFE] 无缓存：再 require 一次不是单例判断（IIFE 每次都重新执行）');

  // --- ESM 加载（动态 import，返回 Promise）---
  const esm = await import('./math-util.mjs');
  console.log('[ESM] add(1,2) =', esm.add(1, 2), '| subtract(5,3) =', esm.subtract(5, 3));

  // --- 顶层 this 差异 ---
  console.log('[CJS] 顶层 this === module.exports ?', cjs.thisIsExports);
  console.log('[ESM] 顶层 this =', typeof esm.thisIsExports, '(ESM 严格模式顶层 this 为 undefined)');

  console.log('\n========== 2. CJS 模块缓存（单例） ==========');
  const cjs2 = require('./math-util.cjs');
  console.log('[CJS] require 两次是否同一对象?', cjs === cjs2);
  console.log('[CJS] require.cache 命中条目:',
    Object.keys(require.cache).filter(k => k.includes('math-util.cjs')).length);

  console.log('\n========== 3. live binding：CJS 对象属性 vs ESM 绑定 ==========');
  const cjsLive = require('./live-cjs.cjs');
  const esmLive = await import('./live-esm.mjs');
  console.log('[CJS] 初始 value =', cjsLive.value);
  console.log('[ESM] 初始 value =', esmLive.value);
  await new Promise(r => setTimeout(r, 80)); // 等模块内部 setTimeout 改值
  console.log('[CJS] 80ms 后 value =', cjsLive.value, '(同一对象引用，模块内部改属性可见)');
  console.log('[ESM] 80ms 后 value =', esmLive.value, '(live binding，绑定本身更新)');

  console.log('\n========== 4. ESM 静态提升（import hoisting） ==========');
  // hoisted-demo.mjs 在 import 语句"之前"就使用了导入值
  await import('./hoisted-demo.mjs');
  console.log('[ESM] import 语句文本位置之前可用导入值 → 静态提升生效');

  console.log('\n========== 5. ESM 顶层 await (Top-level await) ==========');
  const tla = await import('./tla-demo.mjs');
  console.log('[ESM] 顶层 await 拿到数据 =', tla.default);

  console.log('\n========== 6. ESM 链接期静态校验 ==========');
  try {
    await import('./bad-import.mjs');
    console.log('[bad-import] 竟然没报错？');
  } catch (e) {
    console.log('[bad-import] 抛错:', e.message.split('\n')[0]);
  }

  console.log('\n========== 7. 加载时机：CJS 同步 vs ESM 异步 ==========');
  const t0 = Date.now();
  require('./math-util.cjs');
  console.log('[CJS] require 同步返回耗时 =', Date.now() - t0, 'ms');
  console.log('[ESM] import() 返回值是 Promise（异步加载模块图）');

  console.log('\n========== 8. 循环引用 ==========');
  require('./cycle-a.cjs');

  console.log('\n========== 9. 语法差异速览 ==========');
  console.log('[CJS] 导出: module.exports = {...} 或 exports.x = 1（动态）');
  console.log('[ESM] 导出: export const x / export default（静态）');
  console.log('[UMD] 导出: 环境检测三选一（CJS/AMD/global）');

  // ---- tree-shaking 演示（用 esbuild 只打包用到的一个函数）----
  console.log('\n========== 10. tree-shaking：ESM vs CJS 打包体积 ==========');
  const { execSync } = require('child_process');
  const dir = __dirname;
  const esmEntry = path.join(dir, 'tree-esm-entry.mjs');
  const cjsEntry = path.join(dir, 'tree-cjs-entry.cjs');

  try {
    const esmOut = execSync(`npx --yes esbuild "${esmEntry}" --bundle --format=esm --minify`, { encoding: 'utf8' });
    const cjsOut = execSync(`npx --yes esbuild "${cjsEntry}" --bundle --format=cjs --minify`, { encoding: 'utf8' });
    console.log('[tree-shaking] ESM 打包体积 =', (esmOut.length / 1024).toFixed(2), 'KB, 含 subtract 次数:', (esmOut.match(/subtract/g) || []).length);
    console.log('[tree-shaking] CJS 打包体积 =', (cjsOut.length / 1024).toFixed(2), 'KB, 含 subtract 次数:', (cjsOut.match(/subtract/g) || []).length);
  } catch (e) {
    console.log('[tree-shaking] esbuild 不可用:', e.message.split('\n')[0]);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
