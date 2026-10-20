/**
 * TS 泛型实测：约束 / 条件类型 / 映射类型 + 手写 Pick/Omit/Partial
 * 运行：bash 泛型验证.sh
 *
 * 验证 5 件事：
 *  [A] 泛型基础：类型参数 + 推断 + 多个类型参数
 *  [B] 泛型约束：extends 限制 + keyof 约束
 *  [C] 条件类型：T extends U ? X : Y + infer 提取
 *  [D] 映射类型：{ [K in keyof T]: ... } + 修饰符 +/- readonly ? 
 *  [E] 手写工具类型：Pick / Omit / Partial / Required / Readonly
 */
'use strict';

/* ========== [A] 泛型基础 ========== */
// A1 普通泛型函数：类型参数 T
function identity<T>(arg: T): T { return arg; }
const a1 = identity('hello');       // T 推断为 string
const a2 = identity<number>(42);    // 显式指定

// A2 多类型参数
function pair<K, V>(k: K, v: V): [K, V] { return [k, v]; }
const a3 = pair('id', 1);           // [string, number]

// A3 泛型接口
interface Box<T> {
  value: T;
  get(): T;
}
const boxed: Box<number> = { value: 1, get: () => 1 };

/* ========== [B] 泛型约束 ========== */
// B1 extends 约束：T 必须有 length 属性
function getLength<T extends { length: number }>(x: T): number {
  return x.length;                   // ✅ 约束保证有 length
}
getLength('abc');                    // string 有 length ✅
getLength([1, 2, 3]);                // 数组有 length ✅
// getLength(42);                    // ← 取消注释：number 没有 length → 报错

// B2 keyof 约束：K 必须是 T 的键
function getProp<T, K extends keyof T>(obj: T, key: K): T[K] {
  return obj[key];
}
const user = { name: '张三', age: 28 };
const b1 = getProp(user, 'name');    // string ✅
const b2 = getProp(user, 'age');     // number ✅
// getProp(user, 'email');           // ← 取消注释：'email' 不在 user 的键里 → 报错

/* ========== [C] 条件类型 ========== */
// C1 基础条件类型：T 是否可赋给 U
type IsString<T> = T extends string ? true : false;
type c1 = IsString<'hi'>;            // true
type c2 = IsString<42>;              // false

// C2 infer 提取：从数组类型提取元素类型
type ElementOf<T> = T extends (infer E)[] ? E : never;
type c3 = ElementOf<string[]>;       // string

// C3 infer 提取函数返回值
type ReturnOf<T> = T extends (...args: any[]) => infer R ? R : never;
type c4 = ReturnOf<() => number>;    // number

// C4 分配条件类型（naked type parameter）
type ToArray<T> = T extends any ? T[] : never;
type c5 = ToArray<string | number>;  // string[] | number[]（分配后联合）

/* ========== [D] 映射类型 ========== */
// D1 基础映射：把所有属性变可选
type MyPartial<T> = { [K in keyof T]?: T[K] };

// D2 去掉 readonly（-readonly）
type MyMutable<T> = { -readonly [K in keyof T]: T[K] };

// D3 去除可选（-?）
type MyRequired<T> = { [K in keyof T]-?: T[K] };

// D4 键重映射（as）
type Getters<T> = { [K in keyof T as `get${Capitalize<string & K>}`]: () => T[K] };

/* ========== [E] 手写工具类型 ========== */
// Pick：从 T 中选 K 键
type MyPick<T, K extends keyof T> = { [P in K]: T[P] };

// Omit：从 T 中排除 K 键
type MyOmit<T, K extends keyof any> = MyPick<T, Exclude<keyof T, K>>;

// Partial：全部变可选
type MyPartial2<T> = { [P in keyof T]?: T[P] };

// Required：全部变必填
type MyRequired2<T> = { [P in keyof T]-?: T[P] };

// Readonly：全部变只读
type MyReadonly<T> = { readonly [P in keyof T]: T[P] };

// 使用示例
interface User { id: number; name: string; email?: string; }
type Picked = MyPick<User, 'id' | 'name'>;        // { id, name }
type Omitted = MyOmit<User, 'email'>;             // { id, name }
type PartialUser = MyPartial2<User>;              // 全部可选
type RequiredUser = MyRequired2<User>;            // email 也必填
type ReadonlyUser = MyReadonly<User>;             // 全部只读

/* ========== 类型断言（运行时验证值，类型验证靠 tsc）========== */
const results: Record<string, unknown> = {
  a1, a2, a3,
  lenStr: getLength('abc'),
  lenArr: getLength([1, 2, 3]),
  userName: b1,
  userAge: b2,
};
console.log('运行时结果:', JSON.stringify(results, null, 2));

const picked: Picked = { id: 1, name: '张三' };
const omitted: Omitted = { id: 1, name: '张三' };
const partial: PartialUser = {};                   // ✅ 全可选
const required: RequiredUser = { id: 1, name: '张三', email: 'a@b.com' };
const readonlyUser: ReadonlyUser = { id: 1, name: '张三', email: 'a@b.com' };
// readonlyUser.id = 2;  // ← 取消注释：Cannot assign to 'id' because it is a read-only property

console.log('工具类型产物:', JSON.stringify({ picked, omitted, partial, required, readonlyUser }));

export {};
