/**
 * 函数组合 compose + reduce 实现验证脚本（Node 真实输出）
 * 运行：node compose-reduce-验证脚本.js
 *
 * 验证 6 件事：
 *  [A] compose：从右到左组合（f(g(x))），参数单个函数/多个函数
 *  [B] pipe：从左到右（与 compose 相反）
 *  [C] compose 多参：第一个函数可接收多参
 *  [D] reduce 手写实现（数组版：acc 累积）
 *  [E] reduce 手写：初始值缺省 / 空数组
 *  [F] reduce 与原生行为一致（map/filter 用 reduce 表达）
 */
'use strict';

const log = (...a) => console.log(...a);
const ok = (n, c) => log((c ? '✅' : '❌'), n);

/* ========== compose：从右到左 ========== */
function compose(...fns) {
  if (fns.length === 0) return x => x;          // 空组合 = 恒等函数
  return fns.reduce((acc, fn) => (...args) => acc(fn(...args)));
  // 关键：reduce 从右往左包 → compose(f,g)(x) = f(g(x))
}

/* ========== pipe：从左到右（compose 的镜像） ========== */
function pipe(...fns) {
  if (fns.length === 0) return x => x;
  return fns.reduce((acc, fn) => (...args) => fn(acc(...args)));
}

/* ========== 手写 reduce ========== */
function myReduce(arr, fn, initial) {
  let i = 0;
  let acc;
  if (arguments.length >= 3) {                  // 有初始值 → 从第 0 个开始
    acc = initial;
  } else {                                      // 无初始值 → 用第 0 个当 acc，从第 1 个开始
    if (arr.length === 0) throw new TypeError('空数组且无初始值');
    acc = arr[0];
    i = 1;
  }
  for (; i < arr.length; i++) {
    acc = fn(acc, arr[i], i, arr);              // 回调签名 (acc, cur, idx, arr)
  }
  return acc;
}

/* ---------- A. compose ---------- */
log('=== A. compose：从右到左 ===');
const add1 = x => x + 1;
const double = x => x * 2;
const square = x => x * x;

// compose(add1, double)(3) = add1(double(3)) = add1(6) = 7
log('A1 compose(add1,double)(3) =', compose(add1, double)(3), '（期望 7：先 double 再 add1）');
// compose(square, add1)(3) = square(add1(3)) = square(4) = 16
log('A2 compose(square,add1)(3) =', compose(square, add1)(3), '（期望 16）');
// 三个函数：compose(square, double, add1)(3) = square(double(add1(3))) = square(double(4)) = square(8) = 64
log('A3 三函数 =', compose(square, double, add1)(3), '（期望 64）');
// 空组合
log('A4 空组合 =', compose()(5), '（期望 5：恒等）');
ok('A1 从右到左', compose(add1, double)(3) === 7);
ok('A2 两函数', compose(square, add1)(3) === 16);
ok('A3 三函数', compose(square, double, add1)(3) === 64);

/* ---------- B. pipe：从左到右 ---------- */
log('\n=== B. pipe：从左到右 ===');
log('B1 pipe(add1,double)(3) =', pipe(add1, double)(3), '（期望 8：先 add1 再 double）');
ok('B1 pipe 从左到右', pipe(add1, double)(3) === 8);

/* ---------- C. compose 多参：第一个函数接收多参 ---------- */
log('\n=== C. compose 第一个函数可多参 ===');
const add3n = (a, b, c) => a + b + c;
const toStr = n => `结果:${n}`;
log('C1 compose(toStr, add3n)(1,2,3) =', compose(toStr, add3n)(1, 2, 3), '（期望 结果:6）');
ok('C1 多参', compose(toStr, add3n)(1, 2, 3) === '结果:6');

/* ---------- D. 手写 reduce ---------- */
log('\n=== D. 手写 reduce ===');
const sum = myReduce([1, 2, 3, 4, 5], (acc, cur) => acc + cur, 0);
log('D1 求和 =', sum, '（期望 15）');
const product = myReduce([1, 2, 3, 4], (acc, cur) => acc * cur, 1);
log('D2 求积 =', product, '（期望 24）');
ok('D1 求和', sum === 15);
ok('D2 求积', product === 24);

/* ---------- E. 无初始值 / 空数组 ---------- */
log('\n=== E. 边界：无初始值 / 空数组 ===');
const noInit = myReduce([1, 2, 3], (acc, cur) => acc + cur);   // 无初始值 → 1 当 acc
log('E1 无初始值 =', noInit, '（期望 6）');
try { myReduce([], (a, c) => a + c); log('E2 空数组无初始值 → 没抛错（意外）'); }
catch (e) { log('E2 空数组无初始值 →', e.constructor.name, '（期望 TypeError）'); }
const single = myReduce([5], (a, c) => a + c);
log('E3 单元素 =', single, '（期望 5：直接用第 0 个，不调回调）');
ok('E1 无初始值', noInit === 6);
ok('E3 单元素不调回调', single === 5);

/* ---------- F. 与原生 reduce 一致 + 表达 map/filter ---------- */
log('\n=== F. 与原生一致 + map/filter 用 reduce 表达 ===');
const native = [1, 2, 3, 4].reduce((acc, cur, i, arr) => acc + cur * i, 0);
const mine = myReduce([1, 2, 3, 4], (acc, cur, i, arr) => acc + cur * i, 0);
log('F1 原生 vs 手写 =', native, mine, '（期望 一致：0*1+1*2+2*3+3*4=20）');
// map 用 reduce 表达
const mapped = myReduce([1, 2, 3], (acc, cur) => { acc.push(cur * 2); return acc; }, []);
log('F2 map 用 reduce =', JSON.stringify(mapped), '（期望 [2,4,6]）');
// filter 用 reduce 表达
const filtered = myReduce([1, 2, 3, 4, 5], (acc, cur) => { if (cur % 2) acc.push(cur); return acc; }, []);
log('F3 filter 用 reduce =', JSON.stringify(filtered), '（期望 [1,3,5]）');
ok('F1 与原生一致', mine === native && native === 20);
ok('F2 map 表达', JSON.stringify(mapped) === '[2,4,6]');
ok('F3 filter 表达', JSON.stringify(filtered) === '[1,3,5]');
