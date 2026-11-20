#!/usr/bin/env node
// 按 "文件:行号" 精确删除未被使用的声明（函数/常量/状态），用 Babel 定位语句边界。
// 用法：node scripts/remove-dead-decl.mjs targets.txt [--apply]
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const root = path.resolve(import.meta.dirname, '..');
const webDir = path.join(root, 'apps', 'web');
const require = createRequire(path.join(webDir, 'package.json'));
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const generate = require('@babel/generator').default;

const listFile = process.argv[2];
const apply = process.argv.includes('--apply');
const byFile = new Map();
for (const line of fs.readFileSync(listFile, 'utf8').split('\n')) {
  const m = line.trim().match(/^(src\/\S+):(\d+)$/);
  if (!m) continue;
  if (!byFile.has(m[1])) byFile.set(m[1], new Set());
  byFile.get(m[1]).add(Number(m[2]));
}

let removed = 0, files = 0; const missed = [];
for (const [rel, lines] of byFile) {
  const file = path.join(webDir, rel);
  const source = fs.readFileSync(file, 'utf8');
  const ast = parser.parse(source, { sourceType: 'module', plugins: ['jsx'] });
  let touched = 0;
  traverse(ast, {
    'FunctionDeclaration|VariableDeclaration'(p) {
      const start = p.node.loc && p.node.loc.start.line;
      if (!start || !lines.has(start)) return;
      // 只在该行确实是声明起始时才删
      if (p.node.type === 'VariableDeclaration' && !p.node.declarations.length) return;
      p.remove(); touched += 1;
    },
  });
  if (touched) {
    const out = generate(ast, { retainLines: true, jsescOption: { minimal: true } }, source).code;
    if (apply) fs.writeFileSync(file, out.endsWith('\n') ? out : out + '\n');
    files += 1; removed += touched;
    lines.forEach(l => { if (![...lines].includes(l)) missed.push(`${rel}:${l}`); });
  } else {
    [...lines].forEach(l => missed.push(`${rel}:${l}`));
  }
}
console.log(JSON.stringify({ apply, files, removed, missed }));
