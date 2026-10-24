// Server-maintainer CLI only. No web endpoint exposes search terms to other users.
const fs = require('node:fs');
const { buildSearchTelemetryExport } = require('../lib/search_telemetry_export');

async function main() {
  const options = {};
  const names = { '--organization-id': 'organizationId', '--unit-id': 'unitId', '--days': 'days', '--limit': 'limit', '--output': 'output' };
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--help') {
      console.log('Usage: node scripts/export_search_telemetry.js --organization-id ID [--unit-id ID] [--days 7] [--limit 100] [--raw] [--output new-file.jsonl]');
      return;
    }
    if (arg === '--raw') { options.raw = true; continue; }
    if (!names[arg] || !args[index + 1] || args[index + 1].startsWith('--')) throw Error(`Invalid option: ${arg}`);
    options[names[arg]] = args[++index];
  }
  const query = buildSearchTelemetryExport(options);
  const { pool } = require('../db');
  let file;
  try {
    if (options.output) file = fs.openSync(options.output, 'wx', 0o600);
    const [rows] = await pool.query({ sql: query.sql, timeout: 10000 }, query.params);
    for (const row of rows) {
      const line = JSON.stringify(row) + '\n';
      if (file !== undefined) fs.writeSync(file, line);
      else process.stdout.write(line);
    }
    if (file !== undefined) console.log(`Exported ${rows.length} rows`);
  } finally {
    if (file !== undefined) fs.closeSync(file);
    await pool.end();
  }
}

main().catch(error => {
  console.error(error.code || error.message);
  process.exitCode = 1;
});
