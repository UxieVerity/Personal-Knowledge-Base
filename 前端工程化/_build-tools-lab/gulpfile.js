// gulp 配置：任务流式处理（这里演示 gulp 的"流 + 任务"模型，处理一个文件）
const gulp = require('gulp');
const { src, dest } = gulp;

// gulp 的核心：src() 读文件 → 管道处理 → dest() 输出
// 对比 webpack/rollup：gulp 没有模块图、没有依赖解析，只是文件的流式搬运/转换
gulp.task('build', function () {
  return src('src/index.mjs')
    .pipe(dest('dist/gulp-out/'));   // 原样拷贝（真实场景会接插件做压缩/转译）
});

gulp.task('default', gulp.series('build'));
