// webpack.config.js
const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');

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
      // Inject a COS base value from env into the generated HTML so client can
      // construct absolute asset URLs without relying on the API host.
      templateParameters: {
        MAMAGE_COS_BASE: process.env.MAMAGE_COS_BASE || ''
      }
    }),
  ],
  devServer: {
    // Default dev server port (can be overridden by env vars)
    port: process.env.WEBPACK_DEV_SERVER_PORT || process.env.PORT || 3000,
    // Serve index.html for unknown routes so SPA routes like /share/:code work in dev
    historyApiFallback: true,
    open: true,
    proxy: [
      {
        context: ['/api'],
        // Proxy target should be provided via env `MAMAGE_BACKEND_URL`.
        // Fallback to localhost:8000 for local development when not provided.
        target: process.env.MAMAGE_BACKEND_URL || 'http://localhost:8000',
        changeOrigin: true,
        secure: false,
      },
    ],
  },
};
