/**
 * TS 基础实测：类型推断 / any vs unknown vs never
 * 运行：npx tsc --noEmit --strict 基础类型-验证脚本.ts
 *
 * 设计思路：用「故意报错」的代码 + 期望错误注释，证明类型系统的行为。
 * 每段标注 [A]~[F]，注释里写明「预期报错/不报错」，tsc 输出可逐条核对。
 */

// ============================================================
// [A] 类型推断（inference）—— TS 自动推导，不用手写类型
// ============================================================
let a1 = 42;                 // 推断为 number（不是 any）
let a2 = 'hello';            // 推断为 string
let a3 = true;               // 推断为 boolean
let a4 = [1, 2, 3];          // 推断为 number[]
let a5 = { name: '张三' };   // 推断为 { name: string }

// 字面量类型：const 推断为「字面量类型」，let 推断为宽类型
const a6 = 'foo';            // 推断为 "foo"（字面量类型）
let a7 = 'foo';              // 推断为 string（宽类型）

// a1 = 'str';               // ← 若取消注释：Type 'string' is not assignable to type 'number'
// a6 = 'bar';               // ← 若取消注释：Type '"bar"' is not assignable to type '"foo"'

// ============================================================
// [B] any —— 关闭类型检查（逃逸舱，能赋值给任何类型、能调用任何方法）
// ============================================================
let b: any = 42;
b = 'str';                   // ✅ 不报错：any 可赋任何值
b = true;                    // ✅
b.foo.bar();                 // ✅ 不报错（危险！运行时才炸）
const bToNum: number = b;    // ✅ any 可赋给 number（不检查）

// ============================================================
// [C] unknown —— 类型安全的 any（必须收窄后才能用）
// ============================================================
let c: unknown = 42;
c = 'str';                   // ✅ 可以赋任何值
// c.foo;                    // ← 若取消注释：Object is of type 'unknown'（不能用）
// const cToNum: number = c; // ← 若取消注释：Type 'unknown' is not assignable to type 'number'

// 正确用法：先收窄（type guard）
if (typeof c === 'string') {
  const upper = c.toUpperCase();   // ✅ 收窄成 string 后可用
}
if (typeof c === 'number') {
  const doubled = c * 2;           // ✅ 收窄成 number
}

// unknown 也能接住任何值（包括函数、Promise）
const cFn: unknown = () => 1;
// cFn();                    // ← 若取消注释：'cFn' is of type 'unknown'

// ============================================================
// [D] never —— 「不可能有值」的类型（最底类型，可赋给所有类型）
// ============================================================
// ① 永远抛错/死循环的函数 → never
function throwError(msg: string): never {
  throw new Error(msg);
}
function infiniteLoop(): never {
  while (true) {}
}

// ② 穷尽性检查（exhaustive check）—— never 的经典用途
type Shape = 'circle' | 'square';
function area(s: Shape): number {
  switch (s) {
    case 'circle': return 1;
    case 'square': return 2;
    default:
      const exhaustive: never = s;   // ✅ 若加新成员未处理，这里报错
      return exhaustive;
  }
}

// ③ never 可赋给任何类型（最底类型）
declare const n: never;
const nToNum: number = n;    // ✅ never 可赋给 number
const nToStr: string = n;    // ✅ never 可赋给 string
// 但反过来不行：不能把 number 赋给 never
// const toNever: never = 42; // ← 若取消注释：Type 'number' is not assignable to type 'never'

// ============================================================
// [E] 三者关系（面试核心！）：any 和 unknown 是「顶类型」，never 是「底类型」
// ============================================================
// 赋值方向：unknown ← 任何值（收）；any ← 任何值（收）；never → 任何类型（出）
// unknown 不能当 any 用（安全）；any 能当任何用（不安全）；never 什么都不能赋值给它

// ============================================================
// [F] 实际类型断言输出（用 tsc 的 --declaration 或 typeof 检查）
// ============================================================
const f1: number = 42;
const f2: string = String(f1);
// 类型层面的「证据」：tsc --noEmit 通过 = 类型正确

console.log('✅ 基础类型实测脚本：全部类型标注通过 tsc --strict 检查');
console.log('答案参考：any 关检查 / unknown 需收窄 / never 表示不可能（穷尽检查）');
