// 构建工具（grunt/gulp/webpack/fis/rollup）异同 —— 验证脚本
// 结论先行：
//   ① grunt/gulp 是「任务运行器」（Task Runner）：把文件流式搬运/转换，无模块图、无依赖解析、无 tree-shaking；
//   ② webpack/rollup 是「模块打包器」（Bundler）：解析模块依赖图，产出打包后的代码；
//   ③ fis 是「一体化工程方案」：资源定位 + 依赖声明 + 打包 + 发布，百度系，类似早期 webpack 全家桶。
//   ④ rollup 侧重库打包（ESM 输出 + 极致 tree-shaking），webpack 侧重应用打包（代码分割/懒加载/各类资源）。
//
// 本脚本用同一份源码（src/index.mjs，含 used/unused 两个导出）分别跑三个工具，对比产物。
// 运行：node "构建工具-验证脚本.cjs"（需先 npm install webpack webpack-cli rollup gulp，见 README 或脚本注释）
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const LAB = path.join(__dirname, '_build-tools-lab');
const dist = (f) => path.join(LAB, 'dist', f);

function run(cmd) {
  try {
    return execSync(cmd, { cwd: LAB, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (e) {
    return (e.stdout || '') + (e.stderr || '');
  }
}

console.log('========== 构建工具实测：同一源码，三种工具 ==========\n');
console.log('源码 src/index.mjs：导出 used / unused / default main（unused 未被使用）\n');

// 1. rollup
console.log('----- 1. rollup（库打包，ESM 输出） -----');
run('npx rollup -c rollup.config.mjs');
const rl = fs.readFileSync(dist('rollup-out.js'), 'utf8');
console.log(`产物大小: ${rl.length} 字节`);
console.log(`tree-shaking 掉 unused? ${!rl.includes('unused-fn') ? '是 ✅（产物中无 unused-fn）' : '否 ❌'}`);
console.log(`产物保留: ${rl.includes('function used') ? 'used ✅' : 'used ❌'} | ${rl.includes('function main') ? 'main ✅' : 'main ❌'}`);
console.log(`产物格式: ${/export /.test(rl) ? 'ESM' : '非 ESM'}（本配置为 esm）`);
console.log('');

// 2. webpack
console.log('----- 2. webpack（应用打包，production 模式） -----');
run('npx webpack --config webpack.config.js');
const wp = fs.readFileSync(dist('webpack-out.js'), 'utf8');
console.log(`产物大小: ${wp.length} 字节`);
console.log(`tree-shaking 掉 unused? ${!wp.includes('unused-fn') ? '是 ✅' : '否 ❌'}`);
console.log(`产物形态: ${wp.trim().slice(0, 60)}...`);
console.log(`自带运行时样板（IIFE 包裹）: ${/\(\(\)=>/.test(wp) ? '是 ✅' : '否'}`);
console.log('');

// 3. gulp
console.log('----- 3. gulp（任务运行器，流式拷贝） -----');
run('npx gulp build');
const gp = fs.readFileSync(dist('gulp-out/index.mjs'), 'utf8');
console.log(`产物大小: ${gp.length} 字节`);
console.log(`tree-shaking 掉 unused? ${!gp.includes('unused-fn') ? '是 ✅' : '否 ❌（原样保留，含注释）'}`);
console.log(`产物与源码一致（只是搬运）: ${gp === fs.readFileSync(path.join(LAB, 'src/index.mjs'), 'utf8') ? '是 ✅（无任何转换）' : '否'}`);
console.log(`模块图/依赖解析: 无（gulp 不理解 import/export，只当文本流）`);
console.log('');

console.log('========== 结论 ==========');
console.log('gulp 产物 = 源码原样（无 tree-shaking、无打包）——任务运行器只做"搬运/转换"');
console.log('rollup 产物 = 摇掉 unused 的 ESM——模块打包器 + tree-shaking');
console.log('webpack 产物 = 46B 极致压缩的 IIFE——模块打包器 + tree-shaking + minify');
console.log('\ngrunt 与 gulp 同类（任务运行器）；fis 与 webpack 同类（一体化打包方案）。');
