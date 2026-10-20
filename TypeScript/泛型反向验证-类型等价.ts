/**
 * 泛型反向验证：手写工具类型 vs TS 内置工具类型「类型等价」检查
 * 运行：bash 泛型反向验证.sh
 *
 * 用「双向可赋值」断言类型等价：
 *   type Assert<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
 * 若两类完全等价 → 断言为 true，否则编译报错。
 */

// ========== 手写工具类型 ==========
type MyPick<T, K extends keyof T> = { [P in K]: T[P] };
type MyOmit<T, K extends keyof any> = MyPick<T, Exclude<keyof T, K>>;
type MyPartial<T> = { [P in keyof T]?: T[P] };
type MyRequired<T> = { [P in keyof T]-?: T[P] };
type MyReadonly<T> = { readonly [P in keyof T]: T[P] };
type MyRecord<K extends keyof any, V> = { [P in K]: V };

// ========== 等价断言工具 ==========
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;

// ========== 测试类型 ==========
interface User {
  id: number;
  name: string;
  email?: string;
  tags: string[];
}

type Keys = 'id' | 'name';

// [1] MyPick === Pick
type T1 = Assert<Equal<MyPick<User, Keys>, Pick<User, Keys>>>;

// [2] MyOmit === Omit
type T2 = Assert<Equal<MyOmit<User, 'email'>, Omit<User, 'email'>>>;

// [3] MyPartial === Partial
type T3 = Assert<Equal<MyPartial<User>, Partial<User>>>;

// [4] MyRequired === Required
type T4 = Assert<Equal<MyRequired<User>, Required<User>>>;

// [5] MyReadonly === Readonly
type T5 = Assert<Equal<MyReadonly<User>, Readonly<User>>>;

// [6] MyRecord === Record
type T6 = Assert<Equal<MyRecord<'a' | 'b', number>, Record<'a' | 'b', number>>>;

// ========== 反向：故意不等价（应报错，注释掉） ==========
// type BadPick = Assert<Equal<MyPick<User, 'id'>, MyPick<User, 'name'>>>;   // ← 取消注释：类型不等 → 报错

// ========== 条件类型/infer 反向验证 ==========
type ElementOf<T> = T extends (infer E)[] ? E : never;
type ReturnOf<T> = T extends (...args: any[]) => infer R ? R : never;
type ParamOf<T> = T extends (...args: infer P) => any ? P : never;

// [7] ElementOf<string[]> === string
type T7 = Assert<Equal<ElementOf<string[]>, string>>;

// [8] ReturnOf<() => number> === number
type T8 = Assert<Equal<ReturnOf<() => number>, number>>;

// [9] ParamOf<(a: string, b: number) => void> === [string, number]
type T9 = Assert<Equal<ParamOf<(a: string, b: number) => void>, [string, number]>>;

// [10] 分配条件类型：ToArray<string | number> = string[] | number[]
type ToArray<T> = T extends any ? T[] : never;
type T10 = Assert<Equal<ToArray<string | number>, string[] | number[]>>;

// [11] 非分配：用 [T] 包裹阻止分配
type ToArrayNoDist<T> = [T] extends [any] ? T[] : never;
type T11 = Assert<Equal<ToArrayNoDist<string | number>, (string | number)[]>>;

console.log('✅ 泛型反向验证：11 条类型等价断言全部通过（tsc 未报错 = 类型完全等价）');
console.log('说明：Equal<A,B> 用「函数类型条件推断」判断双向可赋值，比单纯的 extends 更严格。');

export {};
