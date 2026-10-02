// CJS 模块：module.exports 导出对象
// 特点：同步、运行时动态、模块缓存（单例）、this === module.exports
const thisIsExports = (this === module.exports); // CJS 顶层 this === module.exports（在替换 exports 前捕获）

let count = 0;

function add(a, b) { return a + b; }
function subtract(a, b) { return a - b; }
function bump() { count += 1; }
function getCount() { return count; }

module.exports = { add, subtract, bump, getCount, thisIsExports };
