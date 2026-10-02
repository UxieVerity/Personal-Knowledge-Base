// 演示 ESM 顶层 await（CJS 做不到）
const data = await Promise.resolve('TLA-DATA-42');
export default data;
