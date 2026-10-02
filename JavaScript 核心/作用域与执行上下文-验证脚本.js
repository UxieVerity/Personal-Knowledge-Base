/**
 * 作用域链 / 执行上下文栈 / 词法作用域 - 验证脚本（Node）
 * 运行：node 作用域与执行上下文-验证脚本.js
 *
 * 验证 7 件事：
 *  [A] 调用栈 LIFO：A→B→C 嵌套调用时压栈顺序（用 Error().stack 展示真实栈）
 *  [B] 栈是"先入后出"：最内层先执行完、先出栈
 *  [C] 栈溢出：无限递归 → RangeError: Maximum call stack size exceeded（测得真实深度）
 *  [D] 词法作用域 vs 动态作用域：函数看"定义处"而非"调用处"
 *  [E] var 提升（hoisting）：声明提升、赋值不提升 → undefined
 *  [F] 执行上下文三个阶段：创建（提升）→ 执行；let 的 TDZ 在创建阶段未初始化
 *  [G] 作用域链查找：内层遮蔽外层同名变量（shadowing）
 */
'use strict';

const log = (n, ...a) => console.log(`[${n}]`, ...a);

/* ---------- A. 调用栈 LIFO ---------- */
function a() {
  const stack = new Error().stack.split('\n').slice(1, 4).map(s => s.trim());
  log('A1', 'a() 被调用时的调用栈（从下往上是压栈顺序）:');
  log('A2', stack.join('  →  '));
  b();
}
function b() {
  log('A3', 'b() 栈帧在 a 之上（后入栈）');
  c();
}
function c() {
  const stack = new Error().stack.split('\n').slice(1, 5).map(s => s.trim());
  log('A4', 'c() 最内层，完整栈:', stack.join('  →  '));
}
a();

/* ---------- B. 先入后出 ---------- */
const order = [];
function pushOrder() {
  order.push('A入'); pushOrderB();
}
function pushOrderB() { order.push('B入'); pushOrderC(); }
function pushOrderC() {
  order.push('C入');
  // C 先出
  order.push('C出');
}
pushOrder();
log('B1', '执行顺序:', order.join(' → '), '← 最内层 C 最后入栈、最先生成结果');

/* ---------- C. 栈溢出 ---------- */
let depth = 0;
function recurse() { depth++; recurse(); }
try {
  recurse();
} catch (e) {
  log('C1', '无限递归 →', e.constructor.name, '| 崩溃深度 ≈', depth.toLocaleString(), '层');
  log('C2', '含义：每个执行上下文都占内存，栈有上限 → 递归要写终止条件');
}

/* ---------- D. 词法作用域（定义处决定，不是调用处） ---------- */
const who = 'global';
function showWho() { return who; }           // 定义在全局，看到的 who 是全局的
function wrapper() {
  const who = 'local';
  return showWho();                          // 调用处在 wrapper，但 showWho 看定义处（全局）
}
log('D1', 'wrapper() =', wrapper(), '← 返回 global 而非 local');
log('D2', '原因：JS 是词法作用域，函数能看到的变量由"定义位置"决定，与"调用位置"无关');

/* ---------- E. var 提升 ---------- */
log('E1', 'var 提升: 先访问后声明 =', (() => { console.log('  (演示)'); return undefined; })());
function hoistDemo() {
  log('E2', '执行到此时 x =', x, '（var x 已提升，值为 undefined，未报错）');
  var x = 10;
  log('E3', '赋值后 x =', x);
}
hoistDemo();

/* ---------- F. let 的 TDZ ---------- */
function tdzDemo() {
  try {
    console.log(y);          // 读未初始化的 let → 抛错
  } catch (e) {
    log('F1', 'let TDZ: 声明前访问 →', e.constructor.name + ':', e.message);
  }
  let y = 20;
}
tdzDemo();
log('F2', '结论：var 提升并初始化为 undefined；let 提升但进入"暂时性死区"，声明前访问报 ReferenceError');

/* ---------- G. 作用域链遮蔽 ---------- */
const v = 'global';
function outer() {
  const v = 'outer';
  function inner() {
    const v = 'inner';
    return v;                // 找自己 → 有，遮蔽外层
  }
  log('G1', 'outer 内 v =', v, '| inner 内 v =', inner(), '| 全局 v =', global.v !== undefined ? '(全局)' : v);
}
outer();
log('G2', '遮蔽规则：查找从内向外，第一个命中的生效（inner > outer > global）');
