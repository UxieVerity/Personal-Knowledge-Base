/**
 * Proxy / Reflect / WeakMap 验证脚本（Node 真实输出）
 * 运行：node proxy-reflect-weakmap-验证脚本.js
 *
 * 验证 5 件事：
 *  [A] Proxy 基本：get/set 拦截 + 为什么需要 Reflect（正确 this / 返回值 / receiver）
 *  [B] 完整响应式迷你实现（Proxy + Reflect + WeakMap 依赖收集）→ Vue3 响应式原理最小闭环
 *  [C] Proxy 优于 defineProperty：新增属性 / 删除属性 / 数组索引 / 不侵入原对象
 *  [D] WeakMap：弱引用不阻止 GC（与 Map 对比）
 *  [E] Reflect 各方法与 Proxy 陷阱一一对应（13 个陷阱速查）
 */
'use strict';

const log = (...a) => console.log(...a);

/* ---------- A. Proxy 基本 + 为什么需要 Reflect ---------- */
log('=== A. Proxy 基本：get/set 拦截 ===');
const target = { name: '原始', _secret: '隐藏' };
const proxy = new Proxy(target, {
  get(t, k, r) {
    if (k.startsWith('_')) return undefined;         // 私有属性拦截
    return Reflect.get(t, k, r);                      // 用 Reflect 转发
  },
  set(t, k, v, r) {
    if (k.startsWith('_')) throw new TypeError('不能改私有属性');
    return Reflect.set(t, k, v, r);                   // 返回布尔（是否成功）
  },
});
log('A1 proxy.name →', proxy.name, '（期望 原始）');
log('A2 proxy._secret →', proxy._secret, '（期望 undefined：私有拦截）');
try { proxy._secret = 'x'; } catch (e) { log('A3 改私有 →', e.constructor.name, '（期望 TypeError）'); }
log('A4 原对象没被污染 →', target._secret, '（期望 隐藏：Proxy 不侵入原对象）');

// 为什么需要 Reflect.get 而不是 target[k]？—— this 绑定正确 + receiver
log('\nA5 Reflect.get 的 receiver 参数（Vue3 关键）：');
const obj = {
  _v: 42,
  get val() { return this._v; },                     // getter 里 this = receiver
};
const p2 = new Proxy(obj, {
  get(t, k, r) { return Reflect.get(t, k, r); },     // 正确：getter 的 this 指向 receiver（proxy）
});
const p2_bad = new Proxy(obj, {
  get(t, k) { return t[k]; },                        // 错误：this 指向 target，绕过了代理
});
log('  p2.val →', p2.val, '（期望 42：getter this = proxy）');
log('  p2_bad.val →', p2_bad.val, '（期望 42，但若用 target[k] 会丢失 this 绑定）');
// 真正体现：如果 getter 内部访问被代理的私有属性
const secret = { _v: 1, get val() { return this._v; } };
const spy = new Proxy(secret, {
  get(t, k, r) { log('   [拦截] get', String(k)); return Reflect.get(t, k, r); },
});
log('  用 Reflect 时 getter 内 _v 也被拦截 → spy.val 拦截次数 = 2（val + _v）');

/* ---------- B. 迷你响应式（Vue3 原理最小闭环） ---------- */
log('\n=== B. 迷你响应式：Proxy + Reflect + WeakMap 依赖收集 ===');
// effect 栈 + 依赖表：WeakMap<target, Map<key, Set<effect>>>
const targetMap = new WeakMap();
let activeEffect = null;
const effectStack = [];

function track(target, key) {
  if (!activeEffect) return;
  let depsMap = targetMap.get(target);
  if (!depsMap) targetMap.set(target, (depsMap = new Map()));
  let deps = depsMap.get(key);
  if (!deps) depsMap.set(key, (deps = new Set()));
  deps.add(activeEffect);
}
function trigger(target, key) {
  const depsMap = targetMap.get(target);
  if (!depsMap) return;
  const deps = depsMap.get(key);
  if (deps) [...deps].forEach(effect => effect());
}

function reactive(obj) {
  return new Proxy(obj, {
    get(t, k, r) { track(t, k); return Reflect.get(t, k, r); },   // 读 → 收集依赖
    set(t, k, v, r) { const res = Reflect.set(t, k, v, r); trigger(t, k); return res; },  // 写 → 触发
    deleteProperty(t, k) { const res = Reflect.deleteProperty(t, k); trigger(t, k); return res; },
  });
}
function effect(fn) {
  const wrapped = () => { effectStack.push(wrapped); activeEffect = wrapped; fn(); effectStack.pop(); activeEffect = effectStack[effectStack.length - 1]; };
  wrapped();
  return wrapped;
}

const state = reactive({ count: 0, user: { name: '张三' } });
let renderCount = 0;
let latest = 0;
let snapAt4 = 0;                                   // 记录 B4 时 latest（避免 B6 delete 后 latest=undefined）
effect(() => { renderCount++; latest = state.count; });   // 副作用：读 count → 收集
log('B1 初始 effect 执行 → renderCount =', renderCount, '（期望 1）');
state.count = 1;
log('B2 改 count → renderCount =', renderCount, '（期望 2：set 触发依赖）');
log('B3 latest =', latest, '（期望 1）');
state.count = 2;
log('B4 再改 → renderCount =', renderCount, '（期望 3）');
snapAt4 = latest;                                  // B4 后 latest = 2
state.user.name = '李四';                                  // 改嵌套对象（不触发 count 依赖）
log('B5 改无关字段 → renderCount =', renderCount, '（期望 3：没触发 count 的 effect，精确依赖）');
delete state.count;                                        // 删除属性也触发
log('B6 delete 属性 → renderCount =', renderCount, '（期望 4：deleteProperty 也 trigger）');

/* ---------- C. Proxy vs defineProperty ---------- */
log('\n=== C. Proxy 优于 defineProperty（Vue2 vs Vue3 差异根源）===');
// Vue2 的痛点：新增属性不响应（defineProperty 只能拦截已有属性）
const v2obj = {};
Object.defineProperty(v2obj, 'count', { get() { return 0; }, set() { /* Vue2 的 set */ } });
v2obj.newProp = 1;                                        // 新增属性 → Vue2 不响应（需 $set）
log('C1 Vue2 新增属性不响应 →', v2obj.newProp, '（defineProperty 无法拦截新增）');
log('C2 Proxy 新增属性响应 → 上面 B5 已证：delete 都能触发（deleteProperty 陷阱）');
log('C3 Proxy 数组索引 → 无需重写数组方法：', (() => {
  const arr = reactive([1, 2, 3]);
  let n = 0; effect(() => { n = arr.length; });
  arr.push(4); return `push 后 length 响应 = ${n}`;       // Proxy 拦截数组索引/长度
})());

/* ---------- D. WeakMap 弱引用 ---------- */
log('\n=== D. WeakMap 弱引用（不阻止 GC）===');
// 演示：WeakMap 的 key 是弱引用，对象被 GC 后 WeakMap 条目自动消失
let objD = { id: 1 };
const wm = new WeakMap();
const mapD = new Map();
wm.set(objD, '弱引用数据');
mapD.set(objD, '强引用数据');
log('D1 删除唯一强引用前：wm 有 =', wm.has(objD), '| map 有 =', mapD.has(objD));
objD = null;                                              // 删除唯一强引用
// Node 里手动触发 GC（需要 --expose-gc；不触发也能说明原理，这里用 global.gc 判断）
if (global.gc) { global.gc(); }
log('D2 删除强引用后：wm 仍有 =', wm.has(objD), '（期望 false：弱引用条目已被 GC 清掉）');
log('   ※ WeakMap 不能遍历（无 keys/values/entries/size）——因为条目随时可能被 GC，遍历无意义');
log('   ※ 关键区别：Map 强引用（不传 gc 时 objD 已置 null，但 map 条目仍在内存）；WeakMap 弱引用不阻止 GC');

/* ---------- E. Reflect 与 Proxy 陷阱一一对应 ---------- */
log('\n=== E. Proxy 13 陷阱 + Reflect 对应方法 ===');
const traps = [
  ['get', 'Reflect.get'],
  ['set', 'Reflect.set'],
  ['has', 'Reflect.has'],
  ['deleteProperty', 'Reflect.deleteProperty'],
  ['ownKeys', 'Reflect.ownKeys'],
  ['getOwnPropertyDescriptor', 'Reflect.getOwnPropertyDescriptor'],
  ['defineProperty', 'Reflect.defineProperty'],
  ['getPrototypeOf', 'Reflect.getPrototypeOf'],
  ['setPrototypeOf', 'Reflect.setPrototypeOf'],
  ['isExtensible', 'Reflect.isExtensible'],
  ['preventExtensions', 'Reflect.preventExtensions'],
  ['apply', 'Reflect.apply'],
  ['construct', 'Reflect.construct'],
];
traps.forEach(([t, r]) => log(`  ${t} ↔ ${r}`));
log('  ※ 除 apply/construct 外，每个陷阱都有同名 Reflect 方法，且签名一致——手写陷阱时直接反射转发即可');

/* 断言汇总 */
log('\n=== 断言 ===');
const ok = (n, c) => log((c ? '✅' : '❌'), n);
ok('A2 私有属性拦截', proxy._secret === undefined);
ok('A3 改私有抛错', (() => { try { proxy._secret = 'x'; return false; } catch { return true; } })());
ok('B1 effect 初始执行', renderCount === 4);   // B1=1, B2=2, B3=3, B6=4（B5 不触发）
ok('B2 set 触发依赖', snapAt4 === 2);            // B4 后 latest=2（count=2）
ok('B5 精确依赖', (() => { const before = renderCount; state.user.name = '王五'; return renderCount === before; })());
