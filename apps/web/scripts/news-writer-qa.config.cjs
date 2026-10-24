const path = require('node:path');
const config = require('../webpack.config')({}, { mode: 'development' });
module.exports = {
  ...config, entry: './scripts/fixtures/news-writer.jsx',
  output: { ...config.output, path: path.resolve(__dirname, '../../../.local/news-writer-qa') },
  devServer: { host: '127.0.0.1', port: 5191, open: false, historyApiFallback: true,
    static: { directory: path.resolve(__dirname, '../public') } },
};
