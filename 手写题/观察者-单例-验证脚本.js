/**
 * 观察者模式 + 单例模式验证脚本（Node 真实输出）
 * 运行：node 观察者-单例-验证脚本.js
 *
 * 验证 6 件事：
 *  [A] 观察者模式：Subject 持有 Observer 列表，状态变化 notify 全部
 *  [B] 观察者：attach/detach 增删观察者
 *  [C] 观察者 vs 发布订阅：直接关联 vs 事件总线（对比）
 *  [D] 单例：getInstance 始终返回同一实例
 *  [E] 单例：静态属性版 / 闭包版（两种实现）
 *  [F] 单例：防 new（构造器返回已存在实例）
 */
'use strict';

const log = (...a) => console.log(...a);
const ok = (n, c) => log((c ? '✅' : '❌'), n);

/* ========== A. 观察者模式 ========== */
log('=== A. 观察者模式：Subject + Observer ===');
// 观察者：有 update 方法，被通知时执行
class Observer {
  constructor(name) { this.name = name; }
  update(data) { log(`  [${this.name}] 收到通知: ${data}`); return `${this.name}:${data}`; }
}

// 目标（Subject）：持有观察者列表，状态变化时 notify 全部
class Subject {
  constructor() { this.observers = []; this.state = null; }
  attach(obs) { this.observers.push(obs); return this; }
  detach(obs) { this.observers = this.observers.filter(o => o !== obs); return this; }
  setState(s) {
    this.state = s;
    log(`状态变化 → ${s}，通知 ${this.observers.length} 个观察者`);
    this.notify();                    // 状态变 → 通知所有观察者
  }
  notify() { this.observers.forEach(o => o.update(this.state)); }
}

const results = [];
class CollectObserver extends Observer {
  update(data) { results.push(`${this.name}:${data}`); }
}
const subj = new Subject();
const o1 = new CollectObserver('观察者A');
const o2 = new CollectObserver('观察者B');
subj.attach(o1).attach(o2);
subj.setState('新状态');
log('A1 两个观察者都收到 =', JSON.stringify(results), '（期望 ["观察者A:新状态","观察者B:新状态"]）');
ok('A1 全部观察者被通知', JSON.stringify(results) === '["观察者A:新状态","观察者B:新状态"]');

/* ---------- B. detach 移除观察者 ---------- */
log('\n=== B. detach 移除 ===');
subj.detach(o1);
results.length = 0;
subj.setState('再变');
log('B1 detach 后 =', JSON.stringify(results), '（期望 只剩 观察者B）');
ok('B1 detach 生效', JSON.stringify(results) === '["观察者B:再变"]');

/* ---------- C. 观察者 vs 发布订阅 对比 ---------- */
log('\n=== C. 观察者 vs 发布订阅 ===');
log('C1 观察者：Subject 直接持有 Observer 列表 → 强耦合（subject 知道观察者是谁）');
log('C2 发布订阅：EventEmitter 中间层 → 解耦（发布者不关心谁在听）');
log('C3 观察者典型：Vue2 响应式（Dep 通知 Watcher）');
log('C4 发布订阅典型：Vue EventBus / Node EventEmitter');

/* ========== D. 单例：getInstance ========== */
log('\n=== D. 单例：getInstance 恒返回同一实例 ===');
class Singleton {
  constructor() { this.createdAt = Date.now(); }
  static getInstance() {
    if (!Singleton._instance) Singleton._instance = new Singleton();
    return Singleton._instance;
  }
}
const s1 = Singleton.getInstance();
const s2 = Singleton.getInstance();
log('D1 s1 === s2 ?', s1 === s2, '（期望 true：同一实例）');
ok('D1 单例恒一', s1 === s2);

/* ---------- E. 单例：闭包版（IIFE 私有实例） ---------- */
log('\n=== E. 单例：闭包版 ===');
const createSingleton = (() => {
  let instance = null;
  return function () {
    if (!instance) instance = { id: Math.random(), createdAt: Date.now() };
    return instance;
  };
})();
const c1 = createSingleton();
const c2 = createSingleton();
log('E1 闭包版 c1 === c2 ?', c1 === c2, '（期望 true）');
log('E2 闭包版优点：instance 完全私有（外部无法访问/重置）');
ok('E1 闭包单例', c1 === c2);

/* ---------- F. 单例：防 new（构造器返回已存在实例） ---------- */
log('\n=== F. 单例：new 也返回同一实例 ===');
class SingletonNew {
  constructor() {
    if (SingletonNew._instance) return SingletonNew._instance;  // 已存在 → 返回旧实例
    SingletonNew._instance = this;
    this.n = Math.random();
  }
}
const n1 = new SingletonNew();
const n2 = new SingletonNew();
log('F1 new 两次 n1 === n2 ?', n1 === n2, '（期望 true：构造器返回已有实例）');
ok('F1 防 new 单例', n1 === n2);
log('F2 注意：new 返回对象时忽略 this，用返回值（[[手写题/new]] 规则）');

/* ---------- G. 单例实战：配置对象 / 事件总线常配单例 ---------- */
log('\n=== G. 单例实战 ===');
log('G1 配置中心：全局唯一配置对象，任何模块读取同一份');
log('G2 事件总线：EventBus.getInstance() 保证全局只有一个总线（发布订阅常配单例）');
log('G3 连接池 / 数据库连接 / Logger：资源只初始化一次');
log('G4 注意：单例是"全局状态"，测试难隔离 → 现代框架多用依赖注入替代');
