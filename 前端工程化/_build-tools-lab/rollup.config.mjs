// rollup 配置：库打包模式，观察 tree-shaking
export default {
  input: 'src/entry.mjs',
  output: {
    file: 'dist/rollup-out.js',
    format: 'esm',
  },
};
