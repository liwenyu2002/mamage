#!/usr/bin/env node
// 安全清理：用 Babel AST 删除 ESLint 判定未使用的 import 说明符。
// 只碰 import，不动局部变量/参数（那些可能有副作用，留人工）。
// 用法：node scripts/prune-unused-imports.mjs [--apply]
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const webDir = path.join(root, 'apps', 'web');
const require = createRequire(path.join(webDir, 'package.json'));
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const generate = require('@babel/generator').default;

const apply = process.argv.includes('--apply');
const raw = execFileSync(path.join(webDir, 'node_modules/.bin/eslint'), ['src', '--format', 'json'], {
  cwd: webDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024,
}).toString();

const targets = new Map();
for (const file of JSON.parse(raw)) {
  const unused = file.messages.filter(m => m.ruleId === 'no-unused-vars')
    .map(m => (m.message.match(/'([^']+)' is defined but never used/) || [])[1]).filter(Boolean);
  if (unused.length) targets.set(file.filePath, new Set(unused));
}

let changed = 0, removedSpecifiers = 0, skipped = [];
for (const [file, unused] of targets) {
  const source = fs.readFileSync(file, 'utf8');
  let ast;
  try {
    ast = parser.parse(source, { sourceType: 'module', plugins: ['jsx', 'classProperties', 'optionalChaining', 'nullishCoalescingOperator', 'dynamicImport'] });
  } catch (e) { skipped.push([path.relative(webDir, file), 'parse: ' + e.message.slice(0, 60)]); continue; }

  let touched = 0;
  traverse(ast, {
    ImportDeclaration(p) {
      // 副作用导入（import './x.css'）没有说明符，必须原样保留
      if (!p.node.specifiers.length) return;
      const keep = p.node.specifiers.filter(s => {
        const local = s.local && s.local.name;
        if (local && unused.has(local)) { touched += 1; return false; }
        return true;
      });
      p.node.specifiers = keep;
      if (!keep.length) p.remove();
    },
  });
  if (!touched) continue;
  const out = generate(ast, { retainLines: true, jsescOption: { minimal: true } }, source).code;
  if (apply) fs.writeFileSync(file, out.endsWith('\n') ? out : out + '\n');
  changed += 1; removedSpecifiers += touched;
}
console.log(JSON.stringify({ apply, changedFiles: changed, removedSpecifiers, skipped: skipped.slice(0, 5) }));
