#!/usr/bin/env node
// 扫描 Express 路由，生成「接口 → 鉴权要求」对照表（对齐 PhotoStory 的 api-v1-auth-matrix 做法）。
// 用法：node scripts/gen-auth-matrix.mjs > docs/api-auth-matrix.md
//       node scripts/gen-auth-matrix.mjs --check   # CI 用：与已提交文件不一致则失败
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', 'apps', 'server', 'routes');
const rows = [];

function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) walk(full);
    else if (name.endsWith('.js')) scan(full);
  }
}

function mountFor(file) {
  const base = path.basename(file, '.js');
  return `/api/${base.replace(/_/g, '-')}`;
}

function scan(file) {
  const text = fs.readFileSync(file, 'utf8');
  const mount = mountFor(file);
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
