// 演示 ESM 静态提升（import 提升）：import 声明在文本位置"之后"仍可用
console.log('[hoisted-demo] 在 import 语句文本位置之前使用导入: add(20, 22) = ' + add(20, 22));
import { add } from './math-util.mjs';
