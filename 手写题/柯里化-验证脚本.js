/**
 * 手写柯里化验证脚本（Node 真实输出）
 * 运行：node 柯里化-验证脚本.js
 *
 * 验证 6 件事：
 *  [A] 基本：一次传一个参数，逐步收集，齐了执行
 *  [B] 一次传多个参数
 *  [C] 占位符版本（_ 代表"等下次"）—— 面试加分
 *  [D] 柯里化的实际价值：参数复用（配置项预置）
 *  [E] 与闭包的关联（每次调用生成新闭包持有已收集参数）
 *  [F] 边界：参数多于形参 / this 透传
 */
'use strict';

const log = (...a) => console.log(...a);
const ok = (n, c) => log((c ? '✅' : '❌'), n);

/* ---------- 标准柯里化（lodash 风格） ---------- */
function curry(fn, arity = fn.length) {
  return function curried(...args) {
    if (args.length >= arity) {           // 参数够了 → 执行
      return fn.apply(this, args);
    } else {                              // 不够 → 继续收集
      return (...more) => curried.apply(this, args.concat(more));
    }
  };
}

/* ---------- A. 基本：逐个传参 ---------- */
log('=== A. 基本：逐个传参 ===');
const add3 = (a, b, c) => a + b + c;
const cAdd = curry(add3);
log('A1 cAdd(1)(2)(3) →', cAdd(1)(2)(3), '（期望 6）');
log('A2 cAdd(1,2,3) 一次传 →', cAdd(1, 2, 3), '（期望 6）');
log('A3 cAdd(1)(2,3) 混合 →', cAdd(1)(2, 3), '（期望 6）');
ok('A1 逐个传参', cAdd(1)(2)(3) === 6);
ok('A2 一次传', cAdd(1, 2, 3) === 6);
ok('A3 混合传', cAdd(1)(2, 3) === 6);

/* ---------- B. 参数不足返回函数 ---------- */
log('\n=== B. 参数不足 → 返回函数 ===');
const partial = cAdd(1);
log('B1 cAdd(1) 类型 →', typeof partial, '（期望 function：参数不够不执行）');
log('B2 继续传 →', partial(2)(3), '（期望 6）');
ok('B1 不足返回函数', typeof partial === 'function');
ok('B2 继续收集', partial(2)(3) === 6);

/* ---------- C. 占位符版本（加分） ---------- */
log('\n=== C. 占位符版本（_ 占位，面试加分项）===');
// 占位符：允许 f(1, _, 3)(2) → 2 填到 _ 的位置
const PH = Symbol('placeholder');            // 模块级共享占位符（内部判断用同一个）
const placeholderCurry = (fn) => {
  const collect = (fn, args, arity) => {
    const real = args.filter(a => a !== PH);             // 真正传入的参数
    if (real.length >= arity) return fn(...real);       // 齐了 → 执行
    return (...more) => {                               // 不够 → 用占位符合并
      const merged = [];
      let mi = 0;
      for (const a of args) {                           // 原参数中 _ 的位置被 more 填充
        if (a === PH && mi < more.length) merged.push(more[mi++]);
        else merged.push(a);
      }
      while (mi < more.length) merged.push(more[mi++]); // 多余的 more 追加
      return collect(fn, merged, arity);
    };
  };
  return collect(fn, [], fn.length);
};
const phAdd = placeholderCurry(add3);
log('C1 phAdd(1, PH, 3)(2) →', phAdd(1, PH, 3)(2), '（期望 6：占位符被 2 填充）');
ok('C1 占位符', phAdd(1, PH, 3)(2) === 6);

/* ---------- D. 实际价值：参数复用 ---------- */
log('\n=== D. 实际价值：参数复用（预置配置）===');
const log2 = curry((level, msg) => `[${level}] ${msg}`);
const info = log2('INFO');              // 预置 level
const error = log2('ERROR');
log('D1 info("启动成功") →', info('启动成功'), '（期望 [INFO] 启动成功）');
log('D2 error("崩溃") →', error('崩溃'), '（期望 [ERROR] 崩溃）');
ok('D1 复用 level', info('启动成功') === '[INFO] 启动成功' && error('崩溃') === '[ERROR] 崩溃');

/* ---------- E. 与闭包关联 ---------- */
log('\n=== E. 与闭包的关联 ===');
log('E1 每次 cAdd(1) 生成新闭包 → 持有已收集参数 [1]');
log('E2 cAdd(1)(2)(3) 过程 = 3 个闭包，各持有 [1] / [1,2] / 执行');
log('E3 柯里化 = 用闭包实现"分次传参" → 核心还是闭包（[[手写题/call]] 的 this 绑定同样靠闭包）');

/* ---------- F. 边界：this 透传 ---------- */
log('\n=== F. this 透传 ===');
const obj = { base: 10 };
function addBase(n) { return this.base + n; }
const cAddBase = curry(addBase, 1);   // 1 个参数就执行
// 普通调用 this 透传（用 call 演示）
const r = curry(function (a) { return this.base + a; }, 1).call(obj, 5);
log('F1 this 透传 →', r, '（期望 15：this=obj，base=10）');
ok('F1 this 透传', r === 15);
