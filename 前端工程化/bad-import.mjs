// 演示 ESM 链接期（link time）静态校验：导入不存在的导出 → 直接抛错
import { nope } from './math-util.mjs';
console.log(nope);
