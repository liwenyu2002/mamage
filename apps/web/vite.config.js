import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vite dev server 配置示例：把 /api 转发到本地后端 http://localhost:3000
// 使用方法：
// 1) 安装依赖（若尚未使用 Vite）:
//    npm install --save-dev vite @vitejs/plugin-react
// 2) 在 package.json 中添加脚本：
//    "dev": "vite"
// 3) 启动：
//    npm run dev

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        secure: false,
        // 如果需要 pathRewrite：
        // rewrite: (path) => path.replace(/^\/api/, '/api')
      },
    },
  },
});
