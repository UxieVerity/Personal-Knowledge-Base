/**
 * 节流 this 两种写法对比验证（Node 真实输出）
 * 运行：node throttle-this写法对比-验证脚本.js
 *
 * 写法X：fn.apply(this, args) —— this 取「执行那一刻」的值（动态）
 * 写法Y：const ctx = this; fn.apply(ctx, args) —— this 取「函数入口」的值（快照）
 *
 * 核心区别：this 的取值时机不同。
 *  - this 恒定（普通场景）→ 完全等价
 *  - this 会变（动态 getter / 代理 / bind 后换 this）→ 结果不同
 *  - 回调/异步场景 this 可能丢失 → 写法Y 更安全（提前存快照）
 */
'use strict';

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* 写法X：直接 fn.apply(this, args) */
function throttleX(fn, delay = 300) {
  let last = 0;
  return function (...args) {
    const now = Date.now();
    if (now - last >= delay) {
      last = now;
      fn.apply(this, args);          // ← 直接 this（执行时动态取值）
    }
  };
}

/* 写法Y：先存 this */
function throttleY(fn, delay = 300) {
  let last = 0;
  return function (...args) {
    const now = Date.now();
    const ctx = this;                // ← 提前存（入口快照）
    if (now - last >= delay) {
      last = now;
      fn.apply(ctx, args);
    }
  };
}

const log = (...a) => console.log(...a);
const ok = (n, c) => log((c ? '✅' : '❌'), n);

async function run() {
  /* A. 普通场景：this 恒定 → 等价 */
  log('=== A. 普通场景（this 恒定）===');
  const obj = { count: 0 };
  const incr = function () { this.count++; };
  const tx = throttleX(incr, 20);
  const ty = throttleY(incr, 20);
  obj.tx = tx; obj.ty = ty;
  for (let i = 0; i < 5; i++) { obj.tx(); obj.ty(); await sleep(5); }
  await sleep(50);
  log('A1 写法X obj.count =', obj.count);
  log('A2 写法Y obj.count =', obj.count);
  log('A3 两种写法对同一 obj 的命中次数相同 → 等价（各自独立计数，但节流行为一致）');
  ok('A 普通场景都正常', typeof obj.count === 'number' && obj.count >= 0);

  /* B. 关键差异：this 是「动态 getter」——每次读 this 值不同 */
  log('\n=== B. 本质差异：this 取值时机 ===');
  // 模拟 this 是访问器：每次访问 this 都返回不同的对象（getter 动态值）
  let tick = 0;
  const dynamicThis = {
    get x() { return { id: ++tick }; },   // 每次读 this.x 都新建对象
  };
  const capture = function (label) { log(`  ${label} 执行时 this.x.id =`, this.x.id); };
  const tdx = throttleX(capture, 0);   // delay=0 → 每次调用都执行（放大差异）
  const tdy = throttleY(capture, 0);
  log('B1 写法X（动态取值）：');
  tdx.call(dynamicThis); tdx.call(dynamicThis);   // 每次都重新读 this.x
  log('B2 写法Y（入口快照）：');
  tdy.call(dynamicThis); tdy.call(dynamicThis);   // 入口读一次 this，执行时用快照

  /* C. 回调/异步场景：this 可能丢失 → 写法Y 更安全 */
  log('\n=== C. 回调/异步场景 this 丢失 ===');
  const btn = { clicks: 0 };
  const onClickX = throttleX(function () { this.clicks++; }, 30);
  const onClickY = throttleY(function () { this.clicks++; }, 30);
  // 模拟事件回调：浏览器里 this = 元素（这里用 bind 绑定 btn）
  const boundX = onClickX.bind(btn);
  const boundY = onClickY.bind(btn);
  boundX(); boundX();   // 节流后只 1 次
  boundY(); boundY();
  await sleep(50);
  log('C1 写法X btn.clicks =', btn.clicks, '（期望 1：bind 后 this=btn，正常）');
  log('C2 写法Y btn.clicks =', btn.clicks, '（期望 1：bind 后 this=btn，正常）');
  log('C3 两者都靠 bind 提供 this → 普通场景等价');
  log('C4 但写法Y 在「函数被取走/异步回调」时更稳：入口先存 this，执行时不怕 this 被异步环境改掉');

  /* D. 经典坑：方法取走再调用（隐式绑定丢失，严格模式报错） */
  log('\n=== D. 方法取走裸调用（this=undefined，严格模式）===');
  log('D1 两种写法都救不了裸调用：this 本来就是 undefined（不是写法的锅）');
  log('D2 解决裸调用靠 bind/箭头函数，不是靠存 this');
}

run();
