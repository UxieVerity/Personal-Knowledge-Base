// CJS：导出对象属性在 require 后仍可被模块内部修改（同一对象引用）
exports.value = 1;
setTimeout(() => {
  exports.value = 999; // 模块内部修改自己导出对象的属性
}, 50);
