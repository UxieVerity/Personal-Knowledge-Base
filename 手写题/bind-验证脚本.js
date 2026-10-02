/**
 * 手写 bind（含 new 兼容）验证脚本（Node 真实输出）
 * 运行：node bind-验证脚本.js
 *
 * 验证 7 件事：
 *  [A] 基本：指定 this + 预置参数 + 返回新函数（不立即执行）
 *  [B] 预置参数 + 调用时参数拼接（顺序正确）
 *  [C] new 兼容：new bound() → this 是新对象，忽略 bind 的 ctx
 *  [D] 原型链：new bound() 的实例 instanceof 原函数（继承原 prototype）
 *  [E] bind 的 this 不能被后续 call/apply 覆盖（永久固定）
 *  [F] 与原生 bind 一致性（普通调用 + new 调用两组对比）
 *  [G] length 属性收缩（预置 n 个参数 → length 减 n，与原生一致）
 */
'use strict';

/* 手写 bind：返回闭包；用 new.target 判断是否被 new 调用 → new 时 this 是新对象，忽略 ctx */
Function.prototype.myBind = function (ctx, ...pre) {
  const fn = this;
  const bound = function (...args) {
    // new.target：被 new 调用时为 bound 自身；普通调用为 undefined
    return fn.apply(new.target ? this : ctx, pre.concat(args));
  };
  // 原型链：让 new bound() 的实例继承 fn.prototype（new 场景的 instanceof 正确）
  bound.prototype = Object.create(fn.prototype);
  // length 收缩：预置参数占位后，剩余形参个数（与原生 bind 一致）
  Object.defineProperty(bound, 'length', { value: Math.max(0, fn.length - pre.length) });
  return bound;
};

const log = (...a) => console.log(...a);
const ok = (name, cond) => log((cond ? '✅' : '❌'), name);

/* ---------- A. 基本：返回新函数 ---------- */
log('=== A. 基本：指定 this + 预置参数 ===');
const person = { name: '张三' };
function greet(prefix, suffix) { return `${prefix}${this.name}${suffix}`; }
const boundA = greet.myBind(person, '你好，');
log('A1 返回类型 →', typeof boundA, '（期望 function：不立即执行）');
log('A2 调用 →', boundA('！'), '（期望 你好，张三！）');
ok('A2 返回正确', boundA('！') === '你好，张三！');

/* ---------- B. 参数拼接顺序 ---------- */
log('\n=== B. 预置参数 + 调用时参数拼接 ===');
function sum4(a, b, c, d) { return a + b + c + d; }
const boundB = sum4.myBind(null, 1, 2);   // 预置 1,2
log('B1 拼接调用 →', boundB(3, 4), '（期望 10：1+2+3+4，预置在前调用在后）');
ok('B1 参数顺序正确', boundB(3, 4) === 10);

/* ---------- C. new 兼容：new 优先于 bind 的 this ---------- */
log('\n=== C. new 兼容：new bound() 忽略 ctx ===');
function Point(x, y) { this.x = x; this.y = y; }
const fixed = { fake: 'bind固定' };
const BoundPoint = Point.myBind(fixed, 1);   // 预置 x=1
const p = new BoundPoint(2);                  // 调用传 y=2
log('C1 new bound(2) → [x,y] =', `[${p.x},${p.y}]`, '（期望 [1,2]：预置 x=1 + 调用 y=2）');
log('C2 new 结果 === bind 的 ctx？', p === fixed, '（期望 false：new 新建对象，忽略 ctx）');
ok('C1 new 下预置+调用参数正确', p.x === 1 && p.y === 2);
ok('C2 new 不绑定 ctx', p !== fixed);

/* ---------- D. 原型链 ---------- */
log('\n=== D. 原型链：new 实例 instanceof 原函数 ===');
log('D1 p instanceof Point →', p instanceof Point, '（期望 true：继承 Point.prototype）');
log('D2 p instanceof BoundPoint →', p instanceof BoundPoint, '（期望 true：bound.prototype 挂在 Point.prototype 上）');
ok('D1 instanceof Point', p instanceof Point);
ok('D2 instanceof BoundPoint', p instanceof BoundPoint);

/* ---------- E. this 永久固定 ---------- */
log('\n=== E. bind 的 this 不能被后续 call/apply 覆盖 ===');
const boundE = greet.myBind(person, '你好，');
log('E1 boundE.call({name:"李四"}) →', boundE.call({ name: '李四' }, '！'), '（期望 你好，张三！：仍是 person）');
ok('E1 后续 call 改不动', boundE.call({ name: '李四' }, '！') === '你好，张三！');

/* ---------- F. 与原生 bind 一致性 ---------- */
log('\n=== F. 与原生 bind 一致性（普通 + new 两组对比）===');
function Rect(w, h) { this.w = w; this.h = h; }
const ctx1 = { tag: '原生ctx' };
const ctx2 = { tag: '手写ctx' };
const natRect = Rect.bind(ctx1, 2);
const myRect = Rect.myBind(ctx2, 2);
const natR = new natRect(3);
const myR = new myRect(3);
log(`F1 普通调用一致？ ${greet.bind(person, 'a')('b') === greet.myBind(person, 'a')('b') ? '✅' : '❌'}`);
log(`F2 new 调用一致？ ${natR.w === myR.w && natR.h === myR.h ? '✅' : '❌'}（[${myR.w},${myR.h}] vs [${natR.w},${natR.h}]）`);
ok('F2 new 行为一致', natR.w === myR.w && natR.h === myR.h);

/* ---------- G. length 收缩 ---------- */
log('\n=== G. length 收缩 ===');
log(`G1 原生 bind length = ${Rect.bind(null, 1).length}（期望 1：2-1）`);
log(`G2 手写 bind length = ${Rect.myBind(null, 1).length}（期望 1：2-1）`);
ok('G1 length 收缩一致', Rect.myBind(null, 1).length === Rect.bind(null, 1).length);
console.log('   ※ 面试细节：预置 n 个参数 → length 减 n（下限 0）。普通闭包实现会丢 length，需 defineProperty 补回。');
