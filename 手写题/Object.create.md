# 手写 Object.create

> **结论：`Object.create(proto, props)` 创建一个新对象，其原型指向 `proto`（可选第二参定义属性）。手写原理 = 临时构造函数桥接：`F.prototype = proto; new F()`。** 实测抓到**经典边界**：`new` 桥接法**做不了 `Object.create(null)`**——new 规则规定 `F.prototype` 不是对象时 fallback 到 `Object.prototype`，而原生 create 走内部 `[[ObjectCreate]](null)` 能造真·无原型对象。这是手写实现的原生边界，面试讲出这一点比代码本身更显深度。
>
> 可运行验证：[[Object.create-验证脚本.js]]（Node 实测：原型指向 / props 第二参 / null 原型边界 / 与原生一致性）

---

## 1. 一句话定义（背诵版）

`Object.create(proto, props)` —— 以 `proto` 为原型创建新对象（第二参可选，`Object.defineProperties` 语义）。

```js
Object.myCreate = function (proto, props) {
  if (proto !== null && typeof proto !== 'object') {
    throw new TypeError('proto 必须是对象或 null');
  }
  function F() {}                        // ① 临时构造函数
  F.prototype = proto;                    // ② 原型指向 proto
  const obj = new F();                    // ③ new 一个对象（原型链已接好）
  if (props) Object.defineProperties(obj, props);  // ④ 定义属性（可选）
  return obj;
};
```

## 2. 四步拆解

| 步骤 | 代码 | 作用 |
| ---- | ---- | ---- |
| ① 校验 | `typeof proto !== 'object'` 抛错 | 与原生一致（proto 必须是对象/null） |
| ② 桥接 | `F.prototype = proto` | 让 new 出来的对象原型 = proto |
| ③ 造对象 | `new F()` | 原型链已挂到 proto 上 |
| ④ 属性 | `Object.defineProperties(obj, props)` | 第二参透传 |

**为什么用临时构造函数 F**：new 是「以构造函数的 prototype 为原型建对象」的唯一原生途径。没有 F 桥接，你没法让普通代码造出「原型是任意对象」的对象（`{}` 的原型写死为 `Object.prototype`）。F 就是那个「原型转换器」。

## 3. 实测数据（Object.create-验证脚本.js）

```
[A1] dog.speak() → 动物叫                       ✅ 原型方法继承
[A2] Object.getPrototypeOf(dog) === animal → true ✅ 原型正确
[B1] props 第二参 → objB.name = 旺财            ✅ defineProperties 生效
[C1] 手写版原型 = Object.prototype              ✅ new 桥接法做不到 null 原型
[C2] 原生版原型 = null                          ✅ 原生走 [[ObjectCreate]]
[C3] 手写版有 toString → function               ✅ fallback 到 Object.prototype
[C4] 原生版无 toString → undefined              ✅ 真无原型
[D3] 与原生 create 方法一致 → hi                ✅ 常规场景完全一致
```

## 4. 为什么 new 桥接法做不了 null 原型（面试追问点）

```js
Object.myCreate(null);   // 期望原型是 null
```

new 的规则（[[new]] 四步）：`new F()` 时，若 `F.prototype` 不是对象（`null` 就是），新对象的原型 **fallback 到 `Object.prototype`**——这是 new 操作符的硬规定。

所以 `F.prototype = null; new F()` 得到的是**原型为 Object.prototype 的普通对象**，不是无原型对象。

原生 `Object.create(null)` 走的是引擎内部 `[[ObjectCreate]](null)`——**直接指定原型为 null**，不经过 new 的 fallback 规则。这是只有引擎能做、纯 JS 手写做不到的（除非用 `__proto__ = null` 这类非标准/已被规范的 `Object.setPrototypeOf` hack）。

> **面试话术**：「手写 Object.create 常规场景完全够用，但 `Object.create(null)` 是引擎级能力——new 桥接法会 fallback 到 Object.prototype，只有原生 [[ObjectCreate]] 能造真无原型对象。这个边界面试官一般不指望你写出，但说出来证明你真的懂 new 和原型。」

## 5. 高频追问速答

| 问题 | 一句话答案 |
| ---- | ---- |
| 手写 Object.create 核心？ | 临时构造函数 F，`F.prototype = proto`，`new F()` |
| 为什么用临时构造函数？ | new 是「以构造函数 prototype 为原型建对象」的唯一原生途径 |
| props 第二参是什么？ | `Object.defineProperties` 语义，定义属性描述符 |
| `Object.create(null)` 能做吗？ | **手写做不了**——new 桥接法 fallback 到 Object.prototype |
| 为什么做不了？ | new 规则：F.prototype 不是对象 → fallback；原生走 [[ObjectCreate]] |
| 和 `{}` 的区别？ | `{}` 原型是 Object.prototype；create 可指定任意原型（含 null） |
| 实际用途？ | 继承（原型链）、纯字典（无原型污染）、防御式编程 |

## 6. 面试速记（30 秒版）

> **手写 Object.create = 临时构造函数桥接：`F.prototype = proto; new F()`，可选第二参 `Object.defineProperties`。** 常规场景与原生完全一致。**面试亮点：`Object.create(null)` 手写做不了**——new 规则规定 F.prototype 不是对象时 fallback 到 Object.prototype，只有引擎内部 `[[ObjectCreate]]` 能造真无原型对象。用途：继承、纯字典（无 `__proto__` 污染）、防御式编程。

> 关联笔记：[[原型与原型链、继承]]（原型链核心） · [[new]]（new 四步 + fallback 规则） · [[bind]]（bound.prototype = Object.create(fn.prototype)） · [[面试复习准备计划]]（W2 手写题 #7）
