// webpack.config.js
const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');

module.exports = {
  entry: './src/index.jsx',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'bundle.[contenthash].js',
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
    }),
  ],
  devServer: {
    // Default dev server port changed to 3000 to avoid colliding with backend on 8000.
    port: process.env.WEBPACK_DEV_SERVER_PORT || process.env.PORT || 3000,
    open: true,
    proxy: [
      {
        context: ['/api'],
        // Default proxy target should point to the backend (commonly running on 8000 in this project).
        // Proxy target: point to backend running on localhost:8000.
        target: process.env.MAMAGE_BACKEND_URL || 'http://localhost:8000',
        changeOrigin: true,
        secure: false,
      },
    ],
  },
};
