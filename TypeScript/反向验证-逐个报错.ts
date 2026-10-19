/**
 * TS 类型检查「反向验证」：逐个开启故意写错的代码，确认 tsc 报错
 * 运行：bash 运行.sh  或  npx tsc --noEmit --strict 反向验证.ts
 *
 * 每段只放一个错误，注释里写明「应报的错误信息」。
 * 用 [1]~[8] 标注，方便对照 tsc 输出。
 */

// [1] number 赋 string → 应报 TS2322
let e1: number = 42;
// e1 = 'str';

// [2] const 字面量类型 → 应报 TS2322（"bar" 不能赋给 "foo"）
const e2 = 'foo';
// e2 = 'bar';

// [3] unknown 直接调用/访问 → 应报 TS18046（'x' is of type 'unknown'）
let e3: unknown = 42;
// e3.foo;
// e3();

// [4] unknown 赋给具体类型 → 应报 TS2322
// const e4: number = e3;

// [5] any 赋给 number → 不报错（这是 any 的危险之处）
let e5: any = 'str';
const e5num: number = e5;   // ✅ 不报错

// [6] never 被赋值 → 应报 TS2322
declare const e6: never;
// const e6num: never = 42;

// [7] 穷尽检查漏分支 → 应报 TS2322（若 Shape 加了新成员）
type Shape7 = 'circle' | 'square' | 'triangle';
function area7(s: Shape7): number {
  switch (s) {
    case 'circle': return 1;
    case 'square': return 2;
    default:
      // const exhaustive: never = s;   // ← 若取消注释：triangle 未处理 → 报错
      return 0;
  }
}

// [8] 属性不存在 → 应报 TS2339
const e8 = { name: 'x' };
// e8.age;

console.log('反向验证完成：注释掉的错误代码，取消注释后 tsc 会逐条报错');
console.log('已通过检查的正向代码（e5 → number 除外，那是 any 的预期不报错）');
