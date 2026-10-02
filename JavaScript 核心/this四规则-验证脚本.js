/**
 * this 四规则实测（Node，真实输出）
 * 运行：node this四规则-验证脚本.js
 *
 * 注意：'use strict' 只放在单个函数体内，保证文件其余部分是非严格模式
 * （Node CJS 顶层默认 sloppy → this = globalThis），这样才能对比严格/非严格。
 *
 * 验证 4 条绑定规则 + 优先级 + 箭头函数：
 *  [A] 默认绑定：非严格 → globalThis；严格 → undefined
 *  [B] 隐式绑定：obj.fn() → obj；方法被取走 → 回默认绑定
 *  [C] 显式绑定：call/apply/bind
 *  [D] 优先级：new > 显式 > 隐式 > 默认
 *  [E] 箭头函数：词法绑定，call/apply 改不动
 */

const log = (...a) => console.log(...a);

/* ---------- A. 默认绑定 ---------- */
log('=== A. 默认绑定：fn() 裸调用 ===');
function defSloppy() { return this; }                       // 非严格（文件顶层无 use strict）
log('A1 非严格函数裸调用 →', defSloppy() === globalThis ? 'globalThis（Node CJS）' : defSloppy());
log('   ※ 浏览器非严格脚本里是 window；严格模式是 undefined');

function defStrict() { 'use strict'; return this; }          // 函数体内才严格
log('A2 严格函数裸调用 →', defStrict(), '（期望 undefined）');

/* ---------- B. 隐式绑定 ---------- */
log('\n=== B. 隐式绑定：obj.fn() ===');
const obj = {
  name: '隐式对象',
  fn() { return this; },                                     // 返回 this 本身，避免属性读取崩溃
};
log('B1 obj.fn() === obj ?', obj.fn() === obj, '（期望 true：this 绑定到调用者）');

const stolen = obj.fn;                                       // 方法被取走
log('B2 取走后裸调用 →', stolen() === globalThis ? 'globalThis（绑定丢失，回默认绑定）' : '非 globalThis');
log('   ※ 经典坑：const fn = obj.fn; fn() 的 this 是全局/undefined，不是 obj');

/* ---------- C. 显式绑定 ---------- */
log('\n=== C. 显式绑定：call/apply/bind ===');
const target = { name: '显式目标' };
function who(extra) { return this.name + (extra ? '+' + extra : ''); }
log('C1 call →', who.call(target, 'call'), '（期望 显式目标+call）');
log('C2 apply →', who.apply(target, ['apply']), '（期望 显式目标+apply）');
const bound = who.bind(target);
log('C3 bind →', bound('bind'), '（期望 显式目标+bind）');

/* ---------- D. 优先级：new > 显式 > 隐式 > 默认 ---------- */
log('\n=== D. 优先级实测 ===');
function Person(name) { this.name = name; }
const fixed = { name: 'bind固定' };
const BoundPerson = Person.bind(fixed);
const p = new BoundPerson('new创建');
log('D1 bind 后 new → name =', p.name, '（期望 new创建：new 优先于 bind 的 this）');
log('D2 new 结果 === bind 对象？', p === fixed, '（期望 false：new 新建对象，忽略 bind 的 this）');

const obj2 = { name: '隐式', fn() { return this.name; } };
log('D3 显式 call 覆盖隐式 →', obj2.fn.call(target), '（期望 显式目标：显式 > 隐式）');

/* ---------- E. 箭头函数：词法绑定 ---------- */
log('\n=== E. 箭头函数 this 不可被显式绑定 ===');
// Node CJS 模块顶层 this = module.exports；箭头函数继承它
log('E0 模块顶层 this =', typeof module !== 'undefined' && this === module.exports ? 'module.exports' : this);

const arrow = { name: '箭头', fn: () => this };
log('E1 箭头.call(target) 改不动 →', arrow.fn.call(target) === target ? '❌被改了' : '✅仍是定义处 this');
log('E2 箭头函数 this === 模块顶层 this？', arrow.fn() === this, '（期望 true：词法继承外层）');

// 箭头函数在方法里：继承外层普通函数的动态 this
function outer() {
  const inner = () => this.name;
  return inner;
}
const obj3 = { name: '继承this', outer };
log('E3 方法内箭头函数 →', obj3.outer()(), '（期望 继承this：箭头继承外层函数的 this）');

/* ---------- F. 汇总优先级 ---------- */
log('\n=== F. 优先级结论 ===');
log('F1 new > 显式(bind) > 隐式(obj.fn()) > 默认(裸调用)');
log('F2 箭头函数：以上四规则全部失效，this 取定义处外层词法环境');
