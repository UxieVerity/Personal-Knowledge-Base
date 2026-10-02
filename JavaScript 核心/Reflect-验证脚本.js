/**
 * Reflect 专项验证脚本（Node 真实输出）
 * 运行：node Reflect-验证脚本.js
 *
 * 验证 6 件事：
 *  [A] 返回布尔 vs 抛错：Object.defineProperty 抛 TypeError，Reflect.defineProperty 返回 false
 *  [B] 非对象参数：Object.getPrototypeOf(1) 装箱，Reflect.getPrototypeOf(1) 抛 TypeError
 *  [C] ownKeys vs Object.keys：keys 只含可枚举字符串键，ownKeys 全含（不可枚举+Symbol）
 *  [D] receiver 参数：Reflect.get/set 第三参决定 getter/setter 的 this 指向（Vue3 关键）
 *  [E] Reflect.apply 替代 Function.prototype.apply.call
 *  [F] Reflect.construct 的 newTarget：控制 instanceof 方向
 */
'use strict';

const log = (...a) => console.log(...a);
const ok = (n, c) => log((c ? '✅' : '❌'), n);

/* ---------- A. 返回布尔 vs 抛错 ---------- */
log('=== A. 返回布尔 vs 抛错 ===');
// 不可扩展对象上 defineProperty 会失败
const frozen = Object.freeze({ x: 1 });
try {
  Object.defineProperty(frozen, 'y', { value: 2 });
  log('A1 Object.defineProperty → 没抛错（意外）');
} catch (e) {
  log('A1 Object.defineProperty → 抛', e.constructor.name, '（期望 TypeError）');
}
const r1 = Reflect.defineProperty(frozen, 'y', { value: 2 });
log('A2 Reflect.defineProperty → 返回', r1, '（期望 false：不抛错，返回布尔）');
ok('A2 Reflect 不抛错返回 false', r1 === false);

// delete 不可配置属性：严格模式 delete 抛错，Reflect 返回 false
const sealed = Object.seal({ z: 1 });
try {
  delete sealed.z;
  log('A3 delete → 没抛错（意外）');
} catch (e) {
  log('A3 delete → 抛', e.constructor.name, '（期望 TypeError：严格模式删不可配置属性）');
}
const r2 = Reflect.deleteProperty(sealed, 'z');
log('A4 Reflect.deleteProperty → 返回', r2, '（期望 false）');
ok('A4 Reflect.deleteProperty 返回 false', r2 === false);

/* ---------- B. 非对象参数差异 ---------- */
log('\n=== B. 非对象参数：Object 装箱 vs Reflect 抛错 ===');
log('B1 Object.getPrototypeOf(1) →', Object.getPrototypeOf(1) === Number.prototype ? 'Number.prototype（装箱）' : '其他');
try {
  Reflect.getPrototypeOf(1);
  log('B2 Reflect.getPrototypeOf(1) → 没抛错（意外）');
} catch (e) {
  log('B2 Reflect.getPrototypeOf(1) → 抛', e.constructor.name, '（期望 TypeError：Reflect 不装箱）');
}
ok('B2 Reflect 对非对象抛 TypeError', (() => { try { Reflect.getPrototypeOf(1); return false; } catch { return true; } })());

/* ---------- C. ownKeys vs Object.keys ---------- */
log('\n=== C. ownKeys vs Object.keys ===');
const objC = { a: 1 };
Object.defineProperty(objC, 'hidden', { value: 2, enumerable: false });  // 不可枚举
objC[Symbol('sym')] = 3;                                                  // Symbol 键
log('C1 Object.keys →', JSON.stringify(Object.keys(objC)), '（期望 ["a"]：只可枚举字符串）');
log('C2 Object.getOwnPropertyNames →', JSON.stringify(Object.getOwnPropertyNames(objC)), '（期望 ["a","hidden"]：含不可枚举，无 Symbol）');
log('C3 Reflect.ownKeys →', JSON.stringify(Reflect.ownKeys(objC).map(k => typeof k === 'symbol' ? 'Symbol' : k)), '（期望 ["a","hidden","Symbol"]：全含）');
ok('C3 ownKeys 全含', Reflect.ownKeys(objC).length === 3);

/* ---------- D. receiver 参数（Vue3 关键） ---------- */
log('\n=== D. receiver 参数：getter/setter 的 this 指向 ===');
const base = {
  _v: 42,
  get val() { return this._v; },     // getter 里 this = receiver
  set val(v) { this._v = v; },
};
// 无 receiver：getter this = target（base）→ 读的是 base._v
log('D1 Reflect.get(base, "val") →', Reflect.get(base, 'val'), '（期望 42：this=base）');
// 带 receiver：getter this = receiver 对象
const receiver = { _v: 999 };
log('D2 Reflect.get(base, "val", receiver) →', Reflect.get(base, 'val', receiver), '（期望 999：getter this=receiver，读 receiver._v）');
ok('D2 receiver 控制 getter this', Reflect.get(base, 'val', receiver) === 999);

// set 同理
Reflect.set(base, 'val', 100, receiver);
log('D3 带 receiver set → receiver._v =', receiver._v, '（期望 100：setter 写到 receiver）');
log('D4 原对象 base._v 没变 →', base._v, '（期望 42）');
ok('D3 setter 写到 receiver', receiver._v === 100 && base._v === 42);

// 配合 Proxy：get 陷阱传 receiver → getter 内 _v 也走代理（递归拦截）
let intercepts = 0;
const target = { _v: 7, get val() { return this._v; } };
const proxy = new Proxy(target, {
  get(t, k, r) { intercepts++; return Reflect.get(t, k, r); },   // 传 receiver
});
proxy.val;
log('D5 proxy.val 拦截次数 =', intercepts, '（期望 2：先拦 val，getter 内 _v 再拦一次）');
ok('D5 嵌套拦截（receiver 让 getter 内部也走代理）', intercepts === 2);

/* ---------- E. Reflect.apply ---------- */
log('\n=== E. Reflect.apply 替代 Function.prototype.apply.call ===');
function greet(prefix, suffix) { return `${prefix}${this.name}${suffix}`; }
const person = { name: '张三' };
// 传统丑写法：Function.prototype.apply.call(fn, thisArg, args)
const ugly = Function.prototype.apply.call(greet, person, ['你好，', '！']);
const clean = Reflect.apply(greet, person, ['你好，', '！']);
log('E1 传统写法 →', ugly);
log('E2 Reflect.apply →', clean, '（期望 你好，张三！）');
ok('E2 等价', ugly === clean);
// Math.max 场景
log('E3 Reflect.apply(Math.max, null, [1,5,3]) →', Reflect.apply(Math.max, null, [1, 5, 3]), '（期望 5）');

/* ---------- F. Reflect.construct 的 newTarget ---------- */
log('\n=== F. Reflect.construct 的 newTarget（控制 instanceof）===');
function Animal(name) { this.name = name; }
function Dog() {}                      // 空构造函数
// 普通：new Animal
const a = Reflect.construct(Animal, ['旺财']);
log('F1 Reflect.construct(Animal, ["旺财"]) → name =', a.name, '| instanceof Animal =', a instanceof Animal);
// newTarget 指定为 Dog → 实例的 prototype 用 Dog.prototype（instanceof Dog 为 true）
const d = Reflect.construct(Animal, ['旺财'], Dog);
log('F2 指定 newTarget=Dog → instanceof Animal =', d instanceof Animal, '| instanceof Dog =', d instanceof Dog);
ok('F2 newTarget 控制 instanceof', d instanceof Dog && !(d instanceof Animal));
// 实际场景：实现「继承但共享构造逻辑」—— 类继承内部就是靠这个机制
log('F3 用途：class 继承的 super() 内部用 construct + newTarget 保持实例属于子类');
log('F4 只有 Reflect 有 construct，Object 没有');

/* ---------- G. 与 Proxy 陷阱一一对应（默认转发） ---------- */
log('\n=== G. Proxy 陷阱默认转发 = 直接调 Reflect 同名方法 ===');
const noopProxy = new Proxy({ x: 1 }, {
  get: Reflect.get, set: Reflect.set, has: Reflect.has,
  deleteProperty: Reflect.deleteProperty, ownKeys: Reflect.ownKeys,
});
log('G1 全转发 Proxy 正常读写 →', noopProxy.x, '| 写 →', (noopProxy.y = 2, noopProxy.y));
log('G2 "陷阱里写 Reflect.get/set" = "引擎默认行为" → 这就是为什么 Vue3 每个陷阱都调 Reflect');
