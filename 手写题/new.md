# 手写 new

> **结论：`new` 干四件事——① 创建新对象，原型指向构造函数 prototype；② 以新对象为 this 调用构造函数；③ 构造返回**对象**则用返回值（覆盖实例），返回**原始值/无**则用新对象；④ 返回结果。** 实测：手写 `myNew` 与原生 new 行为完全一致（属性绑定 / 返回对象覆盖 / 返回原始值忽略 / instanceof 正确），且能解释「箭头函数不能 new」（无 `[[Construct]]`/prototype）。
>
> 可运行验证：[[new-验证脚本.js]]（Node 实测：四步 / 返回对象覆盖 / 返回原始值忽略 / 原型链 / 与原生一致 / 箭头函数）

---

## 1. 一句话定义（背诵版）

**new 的本质：造一个新对象 → 绑定 this 调构造 → 看返回值决定用哪个。**

```js
function myNew(Ctor, ...args) {
  const obj = Object.create(Ctor.prototype);   // ① 新对象，原型指向 Ctor.prototype
  const result = Ctor.apply(obj, args);        // ② 以 obj 为 this 调用
  return (result !== null && typeof result === 'object') || typeof result === 'function'
    ? result                                  // ③ 返回对象/函数 → 用返回值
    : obj;                                    //    返回原始值/无 → 用新对象
}
```

## 2. 四步拆解（面试逐句讲）

| 步骤 | 代码 | 作用 | 面试要点 |
| ---- | ---- | ---- | ---- |
| ① 建对象 | `Object.create(Ctor.prototype)` | 新对象的原型指向构造函数原型 | 这行决定了 `instanceof` 正确 |
| ② 绑 this | `Ctor.apply(obj, args)` | 以新对象为 this 执行构造 | this 绑定 = 显式绑定（apply）|
| ③ 判返回值 | 对象/函数 → 用返回值 | 构造可显式返回对象覆盖实例 | **new 语义**：返回对象才覆盖 |
| ④ 返回 | `result ?? obj` | 原始值/无 → 用新对象 | 最易漏的边界 |

## 3. 实测数据（new-验证脚本.js）

```
[A1] myNew(Person, '张三', 28) → name=张三, age=28   ✅ this 绑定 + 属性
[B1] 构造返回 {custom} → ro.custom = 自定义返回      ✅ 返回对象覆盖实例
[B2] this 上的 ignored → undefined                   ✅ 被覆盖丢弃
[C1] 构造返回 '原始值' → rp.ok = 实例属性            ✅ 原始值忽略
[C2] rp === '我是原始值'？ false                     ✅ 用新对象
[D1] p instanceof Person → true                      ✅ 原型链
[D2] Object.getPrototypeOf(p) === Person.prototype    ✅ 原型指向 prototype
[E1] 与原生 new 行为一致 [1,2]                        ✅
[E2] 箭头函数 prototype = undefined                  ✅ 无 [[Construct]]
[E3] 原生 new 箭头函数 → TypeError                   ✅
```

## 4. 为什么这么设计

- **为什么返回对象要覆盖、原始值要忽略**：new 的契约是「返回一个实例」。如果构造函数显式返回了对象，说明它**自己定制了实例**（如单例、缓存复用），new 尊重它；返回原始值没有实例意义（原始值没有原型、不能挂方法），所以忽略，用新对象。**这是 JS 的「构造函数可自定义返回值」机制**——也是手写 new 最容易漏的一步。
- **为什么用 `Object.create` 而不是 `{}`**：`{}` 的原型是 `Object.prototype`，`instanceof Ctor` 为 false。`Object.create(Ctor.prototype)` 一步到位把原型链接到构造函数。
- **为什么 `apply` 而不是 call**：参数是数组/rest，apply 天然适配 `...args`。
- **为什么箭头函数不能 new**：箭头函数没有 `[[Construct]]` 内部方法、也没有 prototype——它天生不是构造器。手写 `myNew` 不会自动抛错（不像原生 new），但面试要点是**知道箭头函数无 prototype**，手写实现里 `Object.create(undefined)` 会抛 TypeError，行为近似。

## 5. 高频追问速答

| 问题 | 一句话答案 |
| ---- | ---- |
| new 做了哪四件事？ | 建对象（原型指向 prototype）→ apply 绑 this 调构造 → 返回对象则覆盖 → 否则用新对象 |
| 为什么用 Object.create？ | 一步设置原型链，`{}` 做不到（instanceof 会错） |
| 构造返回原始值怎么办？ | 忽略，用新对象（new 语义） |
| 构造返回对象怎么办？ | 用返回的对象（单例/缓存的定制场景） |
| 箭头函数能 new 吗？ | 不能——无 `[[Construct]]` 和 prototype |
| 手写 new 和原生有什么差异？ | 原生对非构造函数抛 TypeError；手写 Object.create(undefined) 也抛，行为近似 |
| 和 bind 的 new 什么关系？ | 见 [[bind]]：被 new 调用时 `new.target` 判断 → this 用新对象 |

## 6. 面试速记（30 秒版）

> **new 四步：`Object.create(Ctor.prototype)` 建对象 → `Ctor.apply(obj, args)` 绑 this → 返回**对象**则覆盖、返回**原始值/无**则用新对象 → 返回。** 三个边界：**返回对象覆盖实例**（单例场景）、**返回原始值忽略**（new 语义）、**箭头函数不能 new**（无 `[[Construct]]`/prototype）。`Object.create` 是原型链关键，`apply` 天然适配 rest 参数。

> 关联笔记：[[原型与原型链、继承]]（Object.create 与原型链） · [[this四规则]]（new 绑定优先级最高） · [[bind]]（new.target 判断 new 调用） · [[Object.create]] · [[面试复习准备计划]]（W2 手写题 #8）
