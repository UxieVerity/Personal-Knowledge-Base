/**
 * var/let/const 提升 + TDZ 深度 - 验证脚本（Node）
 * 运行：node var-let-const与TDZ-验证脚本.js
 *
 * 验证 9 件事：
 *  [A] var：声明提升且初始化为 undefined（先访问不报错）
 *  [B] 函数声明：整体提升，声明前可调用
 *  [C] 函数表达式：不提升（var fn = ... 在赋值前是 undefined → 调用报错）
 *  [D] let：提升但进入 TDZ，声明前访问报 ReferenceError
 *  [E] TDZ 下的 typeof：也抛 ReferenceError（区别于"未声明变量"返回 undefined）
 *  [F] const：必须声明时初始化；声明后不可重新赋值（TypeError）
 *  [G] const 绑定 ≠ 值不可变：对象内容可改（const obj 可 obj.x=1）
 *  [H] 块级作用域：let/const 块内可见、块外不可见；var 穿透
 *  [I] TDZ 也适用于 class 声明 / for 循环的 let
 */
'use strict';

const log = (n, ...a) => console.log(`[${n}]`, ...a);

/* ---------- A. var 提升 ---------- */
function varHoist() {
  log('A1', 'var 先访问后声明: x =', x, '（undefined，不报错）');
  var x = 10;
  log('A2', '赋值后 x =', x);
}
varHoist();

/* ---------- B. 函数声明提升 ---------- */
function fnDeclHoist() {
  log('B1', '函数声明先调用后定义:', greet('张三'), '（函数整体提升，可正常调用）');
  function greet(name) { return 'Hi, ' + name; }
}
fnDeclHoist();

/* ---------- C. 函数表达式不提升 ---------- */
function fnExprHoist() {
  try {
    shout('hi');                 // shout 是 var 声明的函数表达式 → 此刻是 undefined
  } catch (e) {
    log('C1', '函数表达式先调用后定义 →', e.constructor.name + ':', e.message);
  }
  var shout = function (s) { return s.toUpperCase(); };
  log('C2', '赋值后 shout 可用:', shout('hi'));
}
fnExprHoist();

/* ---------- D. let TDZ ---------- */
function letTdz() {
  try {
    console.log(tdz);            // 读未初始化的 let → TDZ
  } catch (e) {
    log('D1', 'let 声明前访问 →', e.constructor.name + ':', e.message);
  }
  let tdz = 1;
  log('D2', '声明后 tdz =', tdz);
}
letTdz();

/* ---------- E. typeof 在 TDZ 中 ---------- */
function typeofTdz() {
  try {
    log('E1', 'typeof 一个未声明变量 =', typeof notDeclaredAnywhere, '（返回 undefined，不报错）');
  } catch (e) { log('E1', '未声明变量 typeof 出错:', e.message); }
  try {
    console.log(typeof tdzVar);  // tdzVar 用 let 声明过但还没执行到 → TDZ
  } catch (e) {
    log('E2', 'typeof 一个处于 TDZ 的变量 →', e.constructor.name + ':', e.message);
  }
  let tdzVar = 2;
  log('E3', '区别：未声明变量 typeof 返回 undefined；TDZ 中的变量 typeof 也抛 ReferenceError');
}
typeofTdz();

/* ---------- F. const 赋值 ---------- */
function constAssign() {
  const PI = 3.14;
  try {
    PI = 3.14159;                // 重新赋值 → TypeError
  } catch (e) {
    log('F1', 'const 重新赋值 →', e.constructor.name + ':', e.message);
  }
  try {
    new Function('const empty;');   // 编译期 SyntaxError，用 new Function 捕获
  } catch (e) {
    log('F2', 'const 声明未初始化 →', e.constructor.name + ':', e.message);
  }
  log('F3', 'PI =', PI, '（const 是"只读绑定"，绑定不可改）');
}
constAssign();

/* ---------- G. const 绑定 vs 值不可变 ---------- */
function constObj() {
  const obj = { n: 1 };
  obj.n = 2;                     // 改内容：合法
  obj.extra = 3;                 // 加属性：合法
  log('G1', 'const 对象可改内容: obj =', JSON.stringify(obj), '（绑定不可变，值可变）');
  try {
    obj = { n: 99 };             // 换绑定：非法
  } catch (e) {
    log('G2', '但 const 对象重新赋值 →', e.constructor.name + ':', e.message);
  }
  log('G3', '结论：const 锁的是"绑定（变量名→对象引用）"，不是对象本身；真要不可变用 Object.freeze');
}
constObj();

/* ---------- H. 块级作用域 ---------- */
function blockScope() {
  {
    var blockVar = 'var-穿透';
    let blockLet = 'let-块内';
    const blockConst = 'const-块内';
  }
  log('H1', '块外访问 var:', blockVar, '（var 函数级，穿透块）');
  try {
    console.log(blockLet);
  } catch (e) {
    log('H2', '块外访问 let →', e.constructor.name + ':', e.message);
  }
  try {
    console.log(blockConst);
  } catch (e) {
    log('H3', '块外访问 const →', e.constructor.name + ':', e.message);
  }
}
blockScope();

/* ---------- I. TDZ 也适用 class / for 的 let ---------- */
function moreTdz() {
  try {
    new Demo();                  // class 声明前 new → TDZ
  } catch (e) {
    log('I1', 'class 声明前使用 →', e.constructor.name + ':', e.message);
  }
  class Demo {}
  log('I2', 'class 声明后可用（class 也有提升但处于 TDZ，不像函数声明）');
}
moreTdz();

log('I3', 'for 循环 let 的 TDZ/块级已在前一篇[[闭包与作用域链、执行上下文]]验证：var 全 3、let 每轮独立 0,1,2');
