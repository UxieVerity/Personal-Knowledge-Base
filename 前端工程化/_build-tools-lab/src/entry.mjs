// 入口：只 import main（默认导出），used 会被 main 间接用到，unused 应被摇掉
import main from './index.mjs';

console.log(main());
