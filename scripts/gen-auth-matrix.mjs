#!/usr/bin/env node
// 扫描 Express 路由，生成「接口 → 鉴权要求」对照表（对齐 PhotoStory 的 api-v1-auth-matrix 做法）。
// 用法：node scripts/gen-auth-matrix.mjs > docs/api-auth-matrix.md
//       node scripts/gen-auth-matrix.mjs --check   # CI 用：与已提交文件不一致则失败
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', 'apps', 'server', 'routes');
const libDir = path.resolve(import.meta.dirname, '..', 'apps', 'server', 'lib');
const rows = [];

function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) walk(full);
    else if (name.endsWith('.js')) scan(full);
  }
}

// lib/ 里的注册函数（registerXxx(router, ...)）由某个 routes 文件调用，
// 实际挂载点取决于那个 routes 文件的挂载点，因此需要反查调用方。
function libMounts() {
  const routesDir = path.resolve(import.meta.dirname, '..', 'apps', 'server', 'routes');
  const map = new Map();
  for (const name of fs.readdirSync(routesDir)) {
    if (!name.endsWith('.js')) continue;
    const text = fs.readFileSync(path.join(routesDir, name), 'utf8');
    const routeMount = MOUNTS.get(name.replace(/\.js$/, '')) || `/api/${name.replace(/\.js$/, '').replace(/_/g, '-')}`;
    const re = /require\('\.\.\/lib\/([\w]+)'\)\.(\w+)\(router/g;
    let m;
    while ((m = re.exec(text))) {
      map.set(m[1], routeMount);
    }
    // 先解构再调用：const { registerX } = require('../lib/y') … registerX(router, …)
    const destructured = /const\s*\{([^}]+)\}\s*=\s*require\('\.\.\/lib\/([\w]+)'\)/g;
    let d;
    while ((d = destructured.exec(text))) {
      if (new RegExp(`\\b${d[1].split(',')[0].trim().replace(/[^\w$]/g, '')}\\(router`).test(text)) map.set(d[2], routeMount);
    }
  }
  return map;
}

function walkLib() {
  const mounts = libMounts();
  for (const name of fs.readdirSync(libDir)) {
    if (!name.endsWith('.js')) continue;
    const full = path.join(libDir, name);
    const text = fs.readFileSync(full, 'utf8');
    if (!/router\.(get|post|put|patch|delete)\(/.test(text)) continue;
    const base = mounts.get(name.replace(/\.js$/, '')) || '/api';
    scan(full, base);
  }
}

// 挂载点必须从 app.js 的真实注册读取，而不是用文件名猜：
// 早期版本按 `routes/ai_news.js` 推出 `/api/ai-news`，与 `app.use('/api/ai/news')` 不符，
// 导致矩阵里 64 条路径与真实接口对不上。
function readMounts() {
  const appFile = path.resolve(import.meta.dirname, '..', 'apps', 'server', 'app.js');
  const text = fs.readFileSync(appFile, 'utf8');
  const mounts = new Map();

  // app.js 多半是先 `const aiNewsRouter = require('./routes/ai_news')` 再 `app.use('/api/ai/news', aiNewsRouter)`，
  // 因此需要两层解析：变量名 → 文件，挂载点 → 变量名。
  const varToFile = new Map();
  const varRe = /const\s+(\w+)\s*=\s*require\('\.\/(?:routes|lib)\/([\w/]+)'\)/g;
  let v;
  while ((v = varRe.exec(text))) varToFile.set(v[1], v[2].replace(/\.js$/, ''));

  const useRe = /app\.use\(\s*'(\/api[^']*)'\s*,\s*([\s\S]{0,160}?)\);/g;
  let m;
  while ((m = useRe.exec(text))) {
    const [, base, target] = m;
    const direct = target.match(/require\('\.\/(?:routes|lib)\/([\w/]+)'\)/);
    let key = direct ? direct[1].replace(/\.js$/, '') : null;
    if (!key) {
      const ident = target.trim().match(/^([A-Za-z_$][\w$]*)/);
      if (ident && varToFile.has(ident[1])) key = varToFile.get(ident[1]);
    }
    if (!key) continue;
    if (!mounts.has(key)) mounts.set(key, base);
  }
  return mounts;
}

const MOUNTS = readMounts();

function mountFor(file) {
  const rel = path.relative(path.resolve(import.meta.dirname, '..', 'apps', 'server', 'routes'), file)
    .replace(/\.js$/, '');
  return MOUNTS.get(rel) || `/api/${path.basename(file, '.js').replace(/_/g, '-')}`;
}

function scan(file, mountOverride = null) {
  const text = fs.readFileSync(file, 'utf8');
  const mount = mountOverride || mountFor(file);
  const re = /router\.(get|post|put|patch|delete)\(\s*'([^']*)'([\s\S]{0,240}?)\)/g;
  let m;
  while ((m = re.exec(text))) {
    const [, method, routePath, rest] = m;
    const guards = [];
    if (/requirePermission\('([^']+)'\)/.test(rest)) guards.push(`权限 ${RegExp.$1}`);
    if (/\brequireAuth\b|authMiddleware/.test(rest)) guards.push('登录');
    if (/requireAdmin\b/.test(rest)) guards.push('管理员');
    if (/requireSuperAdmin\b/.test(rest)) guards.push('超级管理员');
    rows.push({
      path: (mount + routePath).replace(/\/$/, '') || mount,
      method: method.toUpperCase(),
      guards: guards.length ? guards.join('、') : '（路由内自行鉴权）',
      file: path.relative(path.resolve(import.meta.dirname, '..'), file),
    });
  }
}

walk(root);
walkLib();
rows.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));

const lines = [
  '# API 鉴权矩阵（自动生成）',
  '',
  '> 由 `node scripts/gen-auth-matrix.mjs` 扫描 `apps/server/routes` 生成，请勿手改。',
  '> 规则：凡是标「（路由内自行鉴权）」的接口，必须在实现里显式调用 requireProjectAccess / requirePermission 等，否则视为缺口。',
  '',
  `共 ${rows.length} 条路由。`,
  '',
  '| 方法 | 路径 | 鉴权 | 源文件 |',
  '| --- | --- | --- | --- |',
  ...rows.map(r => `| ${r.method} | \`${r.path}\` | ${r.guards} | \`${r.file}\` |`),
  '',
];
const output = lines.join('\n') + '\n';
const target = path.resolve(import.meta.dirname, '..', 'docs', 'api-auth-matrix.md');

// --check：CI 里校验矩阵是否与路由现状一致，避免文档长期漂移
if (process.argv.includes('--check')) {
  const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
  if (current !== output) {
    console.error('api-auth-matrix.md 已过期，请运行：node scripts/gen-auth-matrix.mjs > docs/api-auth-matrix.md');
    process.exit(1);
  }
  console.log(`api-auth-matrix.md 一致（${rows.length} 条路由）`);
} else {
  process.stdout.write(output);
}
