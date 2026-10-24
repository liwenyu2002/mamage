import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

const root = path.dirname(fileURLToPath(import.meta.url));
const runtimeKeys = ['MAMAGE_COS_BASE', 'MAMAGE_API_BASE', 'MAMAGE_UPLOAD_API_BASE',
  'MAMAGE_UPLOAD_LAN_BASES', 'MAMAGE_DISABLE_DIRECT_UPLOAD'];

export function developmentPolicy(env) {
  return {
    name: 'mamage-development-policy',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const pathname = new URL(req.url, 'http://localhost').pathname;
        const method = String(req.method || 'GET').toUpperCase();
        if (pathname.split('/').some(segment => /^\.env(?:\.|$)/.test(segment) || segment === '.git' || segment === '.npmrc')) {
          res.writeHead(403); res.end(); return;
        }
        if (env.MAMAGE_PRODUCTION_READONLY === '1' && pathname.startsWith('/api/')
          && !['GET', 'HEAD', 'OPTIONS'].includes(method)
          && !(method === 'POST' && pathname === '/api/users/login')) {
          res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ error: 'PRODUCTION_READONLY', message: '本地前端连接生产只读 API，已阻止写操作。' }));
          return;
        }
        // Use the same HTML template as production, but never serve raw EJS.
        if (['GET', 'HEAD'].includes(method) && (pathname === '/' || pathname === '/index.html'
          || (!path.extname(pathname) && !/^\/(api|uploads|static|src|node_modules|@)/.test(pathname)))) {
          void (async () => {
            let html = await fs.readFile(path.join(root, 'public/index.html'), 'utf8');
            for (const key of runtimeKeys) {
              const value = JSON.stringify(String(env[key] || '')).replace(/</g, '\\u003c');
              html = html.replaceAll(`'<%= ${key} %>'`, value);
            }
            html = html.replace('</body>', '<script type="module" src="/src/index.jsx"></script></body>');
            html = await server.transformIndexHtml(req.url, html);
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
            res.end(method === 'HEAD' ? undefined : html);
          })().catch(next);
          return;
        }
        next();
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, root, 'MAMAGE_'), ...process.env };
  const target = env.MAMAGE_BACKEND_URL || 'http://localhost:8001';
  return {
    root,
    appType: 'custom',
    plugins: [developmentPolicy(env), react()],
    server: {
      host: env.WEBPACK_DEV_SERVER_HOST || '127.0.0.1',
      port: Number(env.WEBPACK_DEV_SERVER_PORT || env.PORT || 5173),
      strictPort: true,
      fs: { allow: [root], deny: ['**/.env', '**/.env.*', '**/.git/**', '**/.local/**', '**/.npmrc', '**/*.{crt,pem}'] },
      open: env.WEBPACK_DEV_SERVER_OPEN === '1',
      proxy: Object.fromEntries(['api', 'uploads', 'static'].map(prefix => [
        `^/${prefix}(?:/|$)`, { target, changeOrigin: true },
      ])),
    },
  };
});
