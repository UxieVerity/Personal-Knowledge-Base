// ESM tree-shaking 演示入口：只用 add，subtract 应被摇掉
import { add } from './math-util.mjs';
console.log(add(1, 2));
