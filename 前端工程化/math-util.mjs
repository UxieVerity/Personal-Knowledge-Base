// ESM 模块：export 命名导出
// 特点：静态、编译期解析、顶层 this === undefined、live binding
export let count = 0;

export function add(a, b) { return a + b; }
export function subtract(a, b) { return a - b; }
export function bump() { count += 1; }
export function getCount() { return count; }
