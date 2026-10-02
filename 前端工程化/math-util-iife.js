// IIFE 模块模式（Immediately Invoked Function Expression）
// 模块化之前浏览器最原始的封装方式：函数作用域 + 闭包私有 + 挂全局
// 没有缓存、没有加载器、没有依赖管理——就是"一个立即执行函数把代码包起来"
(function (global) {
  'use strict';
  var count = 0;                    // 私有变量：被闭包捕获，外部无法直接访问
  function add(a, b) { return a + b; }
  function subtract(a, b) { return a - b; }
  function bump() { count += 1; }
  function getCount() { return count; }

  // 只暴露公开 API，挂到全局（浏览器挂 window，Node 挂 globalThis）
  global.MathUtilIIFE = {
    name: 'iife-module',
    add: add,
    subtract: subtract,
    bump: bump,
    getCount: getCount,
  };

  // 演示依赖注入：把全局依赖作为参数显式传入（如 jQuery 的 (function($){...})(jQuery)）
  global.IIFEWithDeps = (function (dep) {
    return { gotDep: dep.name };
  })({ name: 'injected-dependency' });
})(typeof globalThis !== 'undefined' ? globalThis : this);
