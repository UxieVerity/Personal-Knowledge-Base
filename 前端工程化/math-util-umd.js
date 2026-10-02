/**
 * 标准 UMD 包装（Universal Module Definition）
 * 三段式：检测环境 → 选择导出方式 → 执行工厂函数
 *
 * ① Node/CommonJS：module.exports 存在 → 走 CJS 导出
 * ② AMD (RequireJS)：define 存在且 define.amd → 走 AMD 导出
 * ③ 浏览器：两者都没有 → 挂到全局 globalThis
 */
(function (root, factory) {
  if (typeof module === 'object' && typeof module.exports === 'object') {
    // ① Node / CommonJS 环境
    module.exports = factory();
  } else if (typeof define === 'function' && define.amd) {
    // ② AMD 环境 (RequireJS)
    define([], factory);
  } else {
    // ③ 浏览器全局变量
    root.MathUtilUMD = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  return {
    name: 'umd-module',
    add: function (a, b) { return a + b; },
    subtract: function (a, b) { return a - b; },
  };
});
