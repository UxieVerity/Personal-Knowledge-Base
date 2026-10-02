# Proxy / Reflect / WeakMap

> **结论：三者是 Vue3 响应式的「黄金组合」——`Proxy` 拦截对象操作、`Reflect` 以正确语义转发操作（this/receiver 正确 + 返回布尔）、`WeakMap` 存依赖表（弱引用不阻止 GC）。** 相比 Vue2 的 `Object.defineProperty`，Proxy 能拦截**新增/删除属性、数组索引、in 操作、原型链**——这是 Vue3 不需要 `$set` 的根源。实测：迷你响应式（Proxy+Reflect+WeakMap）跑通依赖收集/触发/精确依赖/delete 触发。
>
> 可运行验证：[[proxy-reflect-weakmap-验证脚本.js]]（Node 实测：Proxy 拦截 / 迷你响应式闭环 / Vue2 vs Vue3 / WeakMap 弱引用 / 13 陷阱对照）· [[receiver递归拦截-验证脚本.js]]（receiver 会不会死循环：拦截序列 / 懒代理 / 自引用 RangeError）

---

## 1. 一句话定义（背诵版）

| 概念          | 一句话                                                                                    |
| ----------- | -------------------------------------------------------------------------------------- |
| **Proxy**   | 创建一个对象的「代理」，拦截 13 种基本操作（get/set/has/deleteProperty/ownKeys/apply/construct…），在拦截里自定义行为 |
| **Reflect** | 与 Proxy 陷阱**一一对应**的静态方法集，以「默认语义」执行操作并**返回布尔**（如 `Reflect.set` 返回是否成功）                  |
| **WeakMap** | key 必须是对象的 Map，**弱引用**——key 无其他强引用时条目被 GC 自动清除，且不可遍历                                   |

> **为什么必须配合**：Proxy 陷阱里需要「按默认语义执行原操作」——`target[k]` 直接访问会**丢失 receiver（this 绑定）**、返回 undefined 而非布尔、触发不了嵌套代理。`Reflect.get/set(t, k, r)` 第三个参数 `receiver` 保证 getter 的 this 指向代理，操作语义与原生一致。

## 2. Proxy 基本拦截（实测）

```js
const proxy = new Proxy(target, {
  get(t, k, r) { if (k.startsWith('_')) return undefined; return Reflect.get(t, k, r); },
  set(t, k, v, r) { if (k.startsWith('_')) throw new TypeError('私有'); return Reflect.set(t, k, v, r); },
});
```

实测：
```
[A1] proxy.name → 原始                     ✅ 正常读
[A2] proxy._secret → undefined             ✅ 私有拦截
[A3] 改私有 → TypeError                    ✅ set 拦截
[A4] 原对象没被污染 → 隐藏                 ✅ Proxy 不侵入原对象
```

**面试要点**：Proxy 是「不侵入式」的——原对象完全不变，操作全在代理层拦截。这比 defineProperty **逐属性改写**（侵入式）干净得多。

## 3. 为什么需要 Reflect（Vue3 关键）

`get` 陷阱里用 `Reflect.get(t, k, r)` 而不是 `t[k]`，三个原因：

| 写法 | 问题 |
| ---- | ---- |
| `t[k]` 直接访问 | ① getter 里的 `this` 指向 **target** 而非 receiver（proxy）→ 嵌套代理/继承场景 this 错；② 不触发嵌套 Proxy 的 get 拦截；③ 返回 undefined 而非布尔（set 场景） |
| `Reflect.get(t, k, r)` | getter 的 this = **receiver（proxy）** → 内部再访问的属性也走代理拦截（实测 spy.val 拦截 2 次：val + _v）|

实测：
```
[A5] p2.val → 42（getter this = proxy）      ✅
     用 Reflect 时 getter 内 _v 也被拦截 → 拦截次数 = 2
```

> **一句话**：Reflect 让「拦截后的默认行为」与「不拦截时的原生行为」完全一致，且 this 指向代理——这是响应式能递归拦截嵌套属性的基础。

### 3.5 追问：receiver 是代理，会不会死循环？（实测）

> **结论：不会。拦截确实会递归（每层换 key），但**数据属性是递归的天然终点**——`Reflect.get` 在 target 上读属性（不触发陷阱），只有 getter 函数体内部再 `this.x` 才重新进陷阱，而那次的 key 已是下一层（`val` → `_v`），走到数据属性就停。真正死循环是 getter 自引用（`get val() { return this.val }`），原生对象同样 RangeError——不是 receiver 机制的问题。**

实测（receiver递归拦截-验证脚本.js）：
```
[拦截 #1] key=val  | receiver是代理   ← 外层读 proxy.val
[拦截 #2] key=_v  | receiver是代理   ← getter 里 this._v 再次走代理
[返回 #2] key=_v → 7                ← 数据属性，终止
[返回 #1] key=val → 7
```

| 环节 | 在谁身上读属性 | 触发陷阱？ |
| ---- | ---- | ---- |
| 外层 `proxy.val` | 代理 | ✅ 第 1 次 |
| `Reflect.get(t, 'val', r)` | **target** | ❌ 不在代理上读 |
| getter 里 `this._v`（this=代理） | 代理 | ✅ 第 2 次 |
| `Reflect.get(t, '_v', r)` | **target** | ❌ |
| `_v` 是数据属性 | — | **终止** |

**关键**：`Reflect.get` 第一个参数是 `t`（target）不是 `r`——属性读取发生在 target 上，只有 getter **函数体内部**再访问 `this.x` 才因 this=代理重新进陷阱。每次递归向下一层属性，数据属性就是终点。

**Vue3 真正的递归是「懒代理」**（不是靠 receiver）：get 陷阱返回对象时包一层新 `reactive(res)`，`proxy.a.b.c` 每层各拦一次到数据属性终止。receiver 保证的是 getter 内部 this 是代理（嵌套也能拦），**递归有终点靠的是「每层换 key + 数据属性不触发」**。

## 4. 迷你响应式（Vue3 原理最小闭环，实测）

```js
const targetMap = new WeakMap();   // target → Map<key, Set<effect>>
let activeEffect = null;

function track(target, key) {      // get 时：收集当前 effect 到依赖表
  if (!activeEffect) return;
  let depsMap = targetMap.get(target);
  if (!depsMap) targetMap.set(target, (depsMap = new Map()));
  let deps = depsMap.get(key);
  if (!deps) depsMap.set(key, (deps = new Set()));
  deps.add(activeEffect);
}
function trigger(target, key) {    // set 时：执行该 key 的所有依赖
  const depsMap = targetMap.get(target);
  const deps = depsMap?.get(key);
  if (deps) [...deps].forEach(fn => fn());
}

function reactive(obj) {
  return new Proxy(obj, {
    get(t, k, r) { track(t, k); return Reflect.get(t, k, r); },        // 读 → 收集
    set(t, k, v, r) { const res = Reflect.set(t, k, v, r); trigger(t, k); return res; },  // 写 → 触发
    deleteProperty(t, k) { const res = Reflect.deleteProperty(t, k); trigger(t, k); return res; },
  });
}
```

实测：
```
[B1] 初始 effect 执行 → renderCount = 1     ✅
[B2] 改 count → renderCount = 2             ✅ set 触发依赖
[B3] latest = 1                             ✅
[B4] 再改 → renderCount = 3                 ✅
[B5] 改无关字段 → renderCount = 3           ✅ 精确依赖（不同 key 不互相触发）
[B6] delete 属性 → renderCount = 4          ✅ deleteProperty 也 trigger
```

> 这就是 Vue3 `reactive()` 的骨架：**读时收集（track）、写时触发（trigger）**，依赖存在 `WeakMap<target, Map<key, Set<effect>>>` 三级结构里。effect 相当于组件渲染函数 / computed / watch。

## 5. Proxy vs defineProperty（Vue2 vs Vue3 差异根源）

| 维度 | Vue2 `Object.defineProperty` | Vue3 `Proxy` |
| ---- | ---- | ---- |
| 拦截范围 | **已有属性**（需遍历递归预先定义） | **整个对象**（新增/删除/数组索引全拦） |
| 新增属性 | ❌ 不响应，需 `$set` | ✅ 自动响应 |
| 删除属性 | ❌ 不响应 | ✅ `deleteProperty` 触发 |
| 数组 | 需**重写 7 个方法**（push/pop/shift…） | ✅ 索引/长度天然拦截 |
| 侵入性 | 改写原对象属性描述符 | 原对象不动，代理层拦截 |
| 性能 | 初始化递归全量 defineProperty 开销大 | 惰性（读时才代理嵌套） |

实测：
```
[C1] defineProperty 新增属性 → 1（不响应，需 $set）
[C2] Proxy deleteProperty 触发 → 已证 B6
[C3] Proxy 数组 push 后 length 响应 = 4 → 无需重写数组方法
```

> **为什么 Vue3 快/强**：不用初始化时递归 defineProperty 全部属性（懒代理），新增/删除/数组操作全自动响应，`$set`/`$delete` 成为历史。

## 6. WeakMap 弱引用（实测）

```
[D1] 删除唯一强引用前：wm 有 = true | map 有 = true
[D2] 删除强引用后：wm 仍有 = false（弱引用条目被 GC 清掉）
```

- **WeakMap 的 key 是弱引用**：key 对象没有其他强引用时，条目自动被 GC——不阻止回收。
- **不可遍历**：没有 keys/values/entries/size——条目随时可能消失，遍历无意义。
- **Vue3 为什么用 WeakMap 存依赖**：组件销毁后 target 对象被 GC，依赖表自动清空，**不用手动清理，无内存泄漏**。如果用 Map，对象永不释放（Map 强引用 key）。

## 7. Proxy 13 陷阱 + Reflect 一一对应

| Proxy 陷阱 | Reflect 方法 | 触发时机 |
| ---- | ---- | ---- |
| get | Reflect.get | 读属性 |
| set | Reflect.set | 写属性 |
| has | Reflect.has | `in` 操作 |
| deleteProperty | Reflect.deleteProperty | `delete obj.k` |
| ownKeys | Reflect.ownKeys | `Object.keys/getOwnPropertyNames` |
| getOwnPropertyDescriptor | Reflect.getOwnPropertyDescriptor | `Object.getOwnPropertyDescriptor` |
| defineProperty | Reflect.defineProperty | `Object.defineProperty` |
| getPrototypeOf / setPrototypeOf | Reflect.getPrototypeOf / setPrototypeOf | 原型读写 |
| isExtensible / preventExtensions | Reflect.isExtensible / preventExtensions | 扩展性 |
| apply | Reflect.apply | 函数调用 |
| construct | Reflect.construct | `new` |

> 记忆：**除了 apply/construct，每个陷阱都有同名 Reflect 方法**，签名一致——手写陷阱直接转发即可。

## 8. 高频追问速答

| 问题 | 一句话答案 |
| ---- | ---- |
| Vue3 为什么用 Proxy 不用 defineProperty？ | Proxy 拦截整个对象（新增/删除/数组索引全支持），defineProperty 只能拦已有属性 |
| Vue2 数组为什么重写方法？ | defineProperty 拦不了数组索引变化，只能劫持 7 个变更方法 |
| Reflect 是干嘛的？ | 与 Proxy 陷阱一一对应的默认操作，返回布尔，保证 this/receiver 正确 |
| 为什么 `Reflect.get(t,k,r)` 而非 `t[k]`？ | getter 的 this 指向 receiver（代理）而非 target，嵌套属性也能被拦截 |
| WeakMap 为什么用在响应式？ | 弱引用：对象销毁依赖表自动清空，无内存泄漏；不可遍历正合适 |
| Proxy 有什么局限？ | 不能代理原始值；`==` 比较原对象和代理不等；性能比直接访问略慢 |

## 9. 面试速记（30 秒版）

> **Proxy 拦截对象操作，Reflect 按原生语义转发（this→receiver + 返回布尔），WeakMap 存依赖（弱引用自动清）。** Vue3 `reactive` = Proxy 的 get 时 `track`（WeakMap<target, Map<key, Set<effect>>> 收集）、set/deleteProperty 时 `trigger`（执行依赖）。**比 Vue2 强在哪**：defineProperty 只能拦已有属性（新增要 $set、数组要重写方法）；Proxy 全拦（新增/删除/数组索引/原型）。**Reflect 关键**：`t[k]` 会丢 this（getter 指向 target）、返回 undefined；`Reflect.get(t,k,r)` 保证 receiver 正确、嵌套代理也拦。

> 关联笔记：[[原型与原型链、继承]]（Proxy 可拦截原型链） · [[this四规则]]（Reflect receiver = this） · [[深拷贝]]（WeakMap 处理循环引用） · [[浏览器事件循环(EventLoop)]]（effect 异步调度） · [[面试复习准备计划]]（W2 周三）
