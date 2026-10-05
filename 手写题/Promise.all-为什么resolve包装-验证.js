/**
 * 验证：Promise.all 里为什么要 Promise.resolve(p).then 而不是直接 p.then
 * 运行：node Promise.all-为什么resolve包装-验证.js
 *
 * 对比三种入参：普通值 / 真 Promise / thenable（有 .then 的对象）
 */
'use strict';
const log = (...a) => console.log(...a);
const line = (t) => log('\n=== ' + t + ' ===');

/* ---------- ① 普通值：直接 p.then 会怎样 ---------- */
line('① 普通值 p = 1，直接 p.then');
try {
  const p = 1;
  p.then(v => log('不会走到，值 =', v));
} catch (e) {
  log('❌ 直接崩：', e.constructor.name, '-', e.message);
}

line('①\' 普通值 p = 1，Promise.resolve(p).then');
Promise.resolve(1).then(v => log('✅ 正常收到：', v));

/* ---------- ② 真 Promise：Promise.resolve 会包一层吗 ---------- */
line('② 真 Promise：Promise.resolve(p) === p ?');
const realP = Promise.resolve(42);
log('✅ Promise.resolve(真Promise) 返回同一个对象：', Promise.resolve(realP) === realP, '（无额外包装开销）');

/* ---------- ③ thenable：不规范的 .then 对象 ---------- */
line('③ thenable（非 Promise 但有 .then），且它的 then 会重复调用 resolve');
const badThenable = {
  then(res, rej) {
    res('第一次');
    res('第二次');          // 不规范：resolve 调两次
    // throw new Error('then 内部抛错');  // 假设还可能抛错
  }
};
// 3a: 直接 p.then —— 回调没防护，resolve 被调用两次
log('3a 直接 p.then：');
badThenable.then(
  v => log('  onFulfilled 第', ++badThenable.n || (badThenable.n = 1), '次收到:', v),
  e => log('  onRejected:', e.message)
);
// 3b: Promise.resolve 包装 —— 内部 once 守卫，只采纳第一次
Promise.resolve(badThenable).then(v => log('3b Promise.resolve 包装后只收到一次:', v));

/* ---------- ④ 组合验证：Promise.all 混合入参 ---------- */
line('④ Promise.all([普通值, Promise, thenable]) 混合');
Promise.all([1, Promise.resolve(2), badThenable]).then(
  arr => log('✅ 结果 =', JSON.stringify(arr)),
  e => log('❌', e.message)
);
// 若手写版直接 p.then，第一个元素 1 就 TypeError 了

/* ---------- ⑤ 手写 Promise.all 对照（直接 p.then 的错误版本 vs 正确版本） ---------- */
line('⑤ 手写对照');
function allBad(list) {
  return new Promise((resolve, reject) => {
    const result = [];
    let count = 0;
    list.forEach((p, i) => {
      p.then(v => {                 // ← 普通值这里直接 TypeError
        result[i] = v;
        if (++count === list.length) resolve(result);
      }, reject);
    });
  });
}
function allGood(list) {
  return new Promise((resolve, reject) => {
    const result = [];
    let count = 0;
    list.forEach((p, i) => {
      Promise.resolve(p).then(v => {   // ← 归一化：什么都能接
        result[i] = v;
        if (++count === list.length) resolve(result);
      }, reject);
    });
  });
}
allBad([1]).then(() => log('bad 不会走到')).catch(e => log('❌ allBad([1])：', e.constructor.name, '-', e.message));
allGood([1, Promise.resolve(2)]).then(arr => log('✅ allGood([1, Promise]) =', JSON.stringify(arr)));

setTimeout(() => log('\n（完）'), 30);
