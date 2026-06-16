// webpack.config.js
const path = require('path');
const fs = require('fs');
const HtmlWebpackPlugin = require('html-webpack-plugin');

const publicAssets = [
  'favicon.svg',
  'favicon.png',
  'favicon-16x16.png',
  'favicon-32x32.png',
  'apple-touch-icon.png',
  'site.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

class CopyPublicAssetsPlugin {
  apply(compiler) {
    compiler.hooks.afterEmit.tapPromise('CopyPublicAssetsPlugin', async () => {
      await Promise.all(publicAssets.map(async (asset) => {
        const from = path.resolve(__dirname, 'public', asset);
        const to = path.resolve(compiler.options.output.path, asset);
        await fs.promises.mkdir(path.dirname(to), { recursive: true });
        await fs.promises.copyFile(from, to);
      }));
    });
  }
}

module.exports = {
  entry: './src/index.jsx',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'bundle.[contenthash].js',
    publicPath: '/',
    clean: true,
  },
  mode: 'development',
  resolve: {
    extensions: ['.js', '.jsx'],
  },
  module: {
    rules: [
      {
        test: /\.(js|jsx)$/,
        exclude: /node_modules/,
        use: {
          loader: 'babel-loader',
          options: {
            presets: [
              '@babel/preset-env',
              '@babel/preset-react',
            ],
          },
        },
      },
      {
        test: /\.css$/,
        use: ['style-loader', 'css-loader'],
      },
    ],
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: './public/index.html',
      // Inject runtime config values into generated HTML.
      templateParameters: {
        MAMAGE_COS_BASE: process.env.MAMAGE_COS_BASE || '',
        MAMAGE_API_BASE: process.env.MAMAGE_API_BASE || '',
      }
    }),
    new CopyPublicAssetsPlugin(),
  ],
  devServer: {
    // Default dev server port (can be overridden by env vars)
    port: process.env.WEBPACK_DEV_SERVER_PORT || process.env.PORT || 5173,
    // Serve index.html for unknown routes so SPA routes like /share/:code work in dev
    historyApiFallback: true,
    open: true,
    proxy: [
      {
        context: ['/api'],
        // Proxy target should be provided via env `MAMAGE_BACKEND_URL`.
        // Match the local API default in mamage-server/.env.
        target: process.env.MAMAGE_BACKEND_URL || 'http://localhost:8001',
        changeOrigin: true,
        secure: false,
      },
    ],
  },
};
