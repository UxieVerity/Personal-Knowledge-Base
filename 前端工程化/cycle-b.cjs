// CJS 循环引用演示：被 a 引用时先部分执行
exports.done = false;
const a = require('./cycle-a.cjs');
console.log('[cycle] b.cjs 中 a.done =', a.done); // 循环引用时拿到的是"部分执行"的对象
exports.done = true;
console.log('[cycle] b.cjs 结束');
