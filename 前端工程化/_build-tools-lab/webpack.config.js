// webpack 配置：应用打包模式
const path = require('path');

module.exports = {
  mode: 'production',
  entry: './src/entry.mjs',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'webpack-out.js',
  },
};
