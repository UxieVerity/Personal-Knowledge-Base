/**
 * async/await 本质（Generator + Promise 驱动）验证脚本（Node 真实输出）
 * 运行：node async-await本质-验证脚本.js
 *
 * 验证 4 件事：
 *  [A] Generator 基础：暂停/恢复（next 传值回 Generator / yield 向外吐值）
 *  [B] async/await 等价于 Generator + 自执行器（runner）
 *  [C] 手写 async 转 Promise：用 Generator 模拟 async 函数（co 风格）
 *  [D] 与原生 async/await 行为一致（顺序 / 返回值 / 错误处理）
 */
'use strict';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log(...a);
const ok = (n, c) => log((c ? '✅' : '❌'), n);

/* ---------- A. Generator 基础 ---------- */
log('=== A. Generator：暂停/恢复 + 双向传值 ===');
function* genA() {
  const a = yield '第一步';        // 向外吐 '第一步'，暂停；恢复时把值赋给 a
  const b = yield a + '!';
  return b + '!';
}
const itA = genA();
const a1 = itA.next();
const a2 = itA.next('收到A');
const a3 = itA.next('收到B');
log('A1 首次 next →', JSON.stringify(a1), '（期望 {value:"第一步", done:false}）');
log('A2 next("收到A") →', JSON.stringify(a2), '（期望 {value:"收到A!", done:false}）');
log('A3 next("收到B") →', JSON.stringify(a3), '（期望 {value:"收到B!", done:true}）');
ok('A1 首次 yield 吐值', a1.value === '第一步' && a1.done === false);
ok('A2 next 传值回 Generator', a2.value === '收到A!' && a2.done === false);
ok('A3 最后 return', a3.value === '收到B!' && a3.done === true);
log('A4 关键：next(值) 把值传回 Generator（赋给 yield 表达式），yield 向外吐值');

/* ---------- B. 手写自执行器（co 风格 runner） ---------- */
log('\n=== B. 手写自执行器：驱动 Generator 直到 done ===');
function run(genFn) {
  return new Promise((resolve, reject) => {
    const it = genFn();
    function step(arg) {
      let r;
      try { r = it.next(arg); }        // 恢复 Generator，传上次 yield 的结果
      catch (e) { return reject(e); }  // Generator 内抛错 → reject
      if (r.done) return resolve(r.value);   // 完成 → resolve 最终值
      // 没完成 → 等待 yield 的 Promise resolve，把值传回 Generator
      Promise.resolve(r.value).then(step, reject);
    }
    step();
  });
}

/* 用 Generator + runner 模拟 async/await */
function* fetchUserFlow() {
  const user = yield sleep(10).then(() => ({ id: 1, name: '张三' }));  // await 效果
  const posts = yield sleep(10).then(() => [`${user.name}的帖子1`, `${user.name}的帖子2`]);
  return { user, posts };              // async 函数的返回值
}

run(fetchUserFlow).then(r => {
  log('B1 模拟 async 结果 →', JSON.stringify(r), '（期望 张三 + 2 帖子）');
  ok('B1 Generator+runner 等价 async/await', r.user.name === '张三' && r.posts.length === 2);
});

/* ---------- C. 与原生 async/await 对比 ---------- */
log('\n=== C. 原生 async/await 做同样的事 ===');
async function nativeFlow() {
  const user = await sleep(10).then(() => ({ id: 1, name: '张三' }));
  const posts = await sleep(10).then(() => [`${user.name}的帖子1`, `${user.name}的帖子2`]);
  return { user, posts };
}
nativeFlow().then(r => {
  log('C1 原生 async 结果 →', JSON.stringify(r));
  ok('C1 与手写 Generator 等价', r.user.name === '张三' && r.posts.length === 2);
});

/* ---------- D. 手写 async 转 Promise（asyncToPromise 封装） ---------- */
log('\n=== D. asyncToPromise：把 Generator 包装成 async 函数 ===');
function asyncToPromise(genFn) {
  return function (...args) {          // 返回普通函数 → 调用返回 Promise
    return run(genFn.bind(this, ...args));  // 透传 this 和参数
  };
}

const fetchUserAsync = asyncToPromise(function* (userId) {
  const user = yield sleep(10).then(() => ({ id: userId, name: '李四' }));
  const count = yield Promise.resolve(user.id * 10);   // yield 普通值也可（Promise.resolve 包装）
  return `用户${user.name}，编号${count}`;
});

fetchUserAsync(2).then(r => {
  log('D1 asyncToPromise 结果 →', r, '（期望 用户李四，编号20）');
  ok('D1 手写 async 转 Promise', r === '用户李四，编号20');
});

/* ---------- E. 错误处理：Generator 内抛错 → Promise reject ---------- */
log('\n=== E. 错误处理 ===');
const broken = asyncToPromise(function* () {
  yield sleep(10);
  throw new Error('Generator 内部错误');
});
broken().then(
  () => log('E1 不该 resolve'),
  e => {
    log('E1 Generator 抛错 → reject:', e.message, '（期望 Generator 内部错误）');
    ok('E1 错误传播', e.message === 'Generator 内部错误');
  }
);

/* ---------- F. 面试要点：async/await = 语法糖 + 自执行器 ---------- */
setTimeout(() => {
  log('\n=== F. 本质总结 ===');
  log('F1 async/await = Generator(yield 暂停) + 自执行器(自动 next)');
  log('F2 编译器(Babel/TS) 把 async 函数转成 Generator + 类似 run() 的驱动');
  log('F3 await = yield 一个 Promise；引擎自动 .then(step) 传回值');
  log('F4 这就是"async 是 Generator 语法糖"的完整含义（手写 run() 即最小 co）');
}, 30);
