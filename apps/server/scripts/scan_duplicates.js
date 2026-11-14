#!/usr/bin/env node
// 重复账号扫描：node scripts/scan_duplicates.js [输出文件]
// 只读；cron 里默认写到 reports/duplicates-latest.json。
const fs = require('node:fs');
const path = require('node:path');
const { pool } = require('../db');
const { scan } = require('../lib/duplicate_accounts');

(async () => {
  const report = await scan(pool);
  const text = JSON.stringify(report, null, 2);
  const target = process.argv[2] || path.join(process.cwd(), 'reports', 'duplicates-latest.json');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, text + '\n');
  fs.writeFileSync(path.join(path.dirname(target), 'duplicates-' + new Date().toISOString().slice(0, 10) + '.json'), text + '\n');
  console.log('[duplicates] groups=' + report.groupCount + ' users=' + report.totals.users
    + ' autoProvisioned=' + report.totals.autoProvisioned + ' withoutEmail=' + report.totals.withoutEmail
    + ' -> ' + target);
  for (const group of report.groups.slice(0, 10)) {
    console.log('  - ' + group.reason + ' ' + (group.name || group.email || group.studentNo || '')
      + ': ' + group.accounts.map(a => '#' + a.id + '(' + (a.studentNo || '无学号') + ')').join(', '));
  }
  await pool.end();
})().catch(e => { console.error('[duplicates] failed', e.code || e.message); process.exitCode = 1; });
