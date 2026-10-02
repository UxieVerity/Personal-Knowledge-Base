/**
 * 闭包与作用域链 - 验证脚本（Node）
 * 运行：node --expose-gc 闭包与作用域-验证脚本.js
 *
 * 验证 4 件事：
 *  [A] 闭包持有外层词法环境：外层函数返回后，内部函数仍能访问/修改外层变量
 *  [B] 每次调用创建独立词法环境：计数器互不影响
 *  [C] 经典 for 循环陷阱：var 捕获同一变量 vs let 每次迭代新绑定
 *  [D] 闭包与 GC：被引用的闭包环境阻止回收（WeakRef + FinalizationRegistry 实测）
 */
'use strict';

const log = (n, ...args) => console.log(`[${n}]`, ...args);

/* ---------- A. 闭包持有外层词法环境 ---------- */
function makeCounter() {
  let count = 0;          // count 属于 makeCounter 的执行上下文
  return function inc() { // inc 的词法环境引用着 makeCounter 的环境
    count += 1;           // makeCounter 已返回，但 count 仍可被改
    return count;
  };
}
const counter = makeCounter();
log('A1', 'counter() =', counter(), '| counter() =', counter(), '| counter() =', counter());
log('A2', 'makeCounter 已返回，count 仍存活 → 闭包把 count 所在环境"带走"了');

/* ---------- B. 每次调用独立词法环境 ---------- */
const c1 = makeCounter(), c2 = makeCounter();
c1(); c1();
log('B1', 'c1() =', c1(), '| c2() =', c2(), '← 两个闭包各有一份独立 count');

/* ---------- C. var vs let 的 for 循环捕获 ---------- */
const fnsVar = [], fnsLet = [];
for (var i = 0; i < 3; i++) fnsVar.push(() => i);   // 3 个闭包捕获同一个 i
for (let j = 0; j < 3; j++) fnsLet.push(() => j);   // 每次迭代新绑定
log('C1', 'var: fnsVar.map(f=>f()) =', fnsVar.map(f => f()), '← 全指向同一个 i（循环后=3）');
log('C2', 'let: fnsLet.map(f=>f()) =', fnsLet.map(f => f()), '← 每轮独立绑定');
log('C3', '原因：var 提升到函数作用域，只有一个 i；let 是块级 + 每轮迭代创建新词法环境');

/* ---------- D. 闭包与 GC（需 --expose-gc） ---------- */
if (!global.gc) {
  console.log('\n[D] 跳过：需要 node --expose-gc 才能强制 GC，请用该方式重跑');
  process.exit(0);
}

const registry = new FinalizationRegistry(name => {
  log('D-gc', `${name} 已被 GC 回收`);
});

function makeHoldingClosure() {
  const big = { data: new Array(1e6).fill('x'), tag: '闭包持有着我' };
  registry.register(big, '闭包持有的 big');   // 注册观察
  return () => big.tag;                        // 闭包引用 big → big 永不回收
}

function makeNoHoldingClosure() {
  let big = { data: new Array(1e6).fill('x'), tag: '没人引用我' };
  registry.register(big, '无引用的 big');
  let tmp = 1;                                 // 闭包只引用 tmp，不引用 big
  return () => tmp;
}

const holder = makeHoldingClosure(); // holder 的闭包环境里还挂着 big
const plain = makeNoHoldingClosure();

log('D1', 'holder() =', holder(), '← 闭包还能访问 big.tag（证明 big 还活着）');
log('D2', 'plain() =', plain(), '← 闭包只访问 tmp');
log('D3', '触发 GC：无引用的 big 应被回收；闭包持有的 big 应存活…');

global.gc();
setTimeout(() => {
  global.gc();
  log('D4', '强制 GC 后 holder() =', holder(), '← 若还能读到 tag，说明闭包阻止了回收');
  console.log('\n结论：闭包的环境里只要还有可达引用，GC 就不会回收 → 用后需主动断开（= null / 避免无谓捕获）');
}, 200);
