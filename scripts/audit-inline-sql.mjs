#!/usr/bin/env node
// 统计 routes/ 里仍直接写 SQL 的调用点，用来盯"dao 层"推进进度。
// 用法：node scripts/audit-inline-sql.mjs [--fail-over N]
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', 'apps', 'server', 'routes');
const rows = [];
for (const name of fs.readdirSync(root)) {
  if (!name.endsWith('.js')) continue;
  const text = fs.readFileSync(path.join(root, name), 'utf8');
  const hits = text.match(/(?:pool|conn|db)\.query\(/g) || [];
  if (hits.length) rows.push({ file: name, count: hits.length });
}
rows.sort((a, b) => b.count - a.count);
const total = rows.reduce((sum, row) => sum + row.count, 0);
console.log(`routes/ 内联 SQL 调用点：${total} 处，分布在 ${rows.length} 个文件`);
for (const row of rows.slice(0, 15)) console.log(`  ${String(row.count).padStart(3)}  ${row.file}`);
const limitArg = process.argv.indexOf('--fail-over');
if (limitArg > 0) {
  const limit = Number(process.argv[limitArg + 1]);
  if (Number.isFinite(limit) && total > limit) {
    console.error(`超出上限 ${limit}，请把新查询放进 lib/queries/`);
    process.exitCode = 1;
  }
}
