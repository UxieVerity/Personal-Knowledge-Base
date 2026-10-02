// CJS 循环引用演示
console.log('[cycle] a.cjs 开始执行, a.done =', require('./cycle-b.cjs').done);
exports.done = true;
console.log('[cycle] a.cjs 结束');
