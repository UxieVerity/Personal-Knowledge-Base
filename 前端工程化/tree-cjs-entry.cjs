// CJS tree-shaking 演示入口：只用 add
const { add } = require('./math-util.cjs');
console.log(add(1, 2));
