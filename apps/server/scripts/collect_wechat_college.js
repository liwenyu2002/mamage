#!/usr/bin/env node
const { parseArgs } = require('node:util');
const path = require('node:path');
const { collectCollege } = require('../lib/wechat_college_collection');

async function main() {
  const { values } = parseArgs({ options: {
    output: { type: 'string' }, since: { type: 'string', default: '2024-01-01' },
    'interval-ms': { type: 'string', default: '2000' },
    'discover-only': { type: 'boolean' }, 'resume-blocked': { type: 'boolean' },
    'refresh-directory': { type: 'boolean' }, 'reparse-directory': { type: 'boolean' }, help: { type: 'boolean' },
  } });
  if (values.help) {
    console.log('Local-only college WeChat reverse bundle (no database, login cookies or deployment).\n'
      + 'node scripts/collect_wechat_college.js [--output DIR] [--since 2024-01-01] [--interval-ms 2000]\n'
      + '  --discover-only     Collect directory without fetching article bodies\n'
      + '  --refresh-directory Recheck observed pages for new links\n'
      + '  --reparse-directory Reparse saved HTML without retrying blocked article fetches\n'
      + '  --resume-blocked    Explicitly retry after source access recovers; never bypasses verification');
    return;
  }
  const output = path.resolve(values.output || path.join(__dirname, '../../../.local/wechat-college-collection'));
  const report = await collectCollege({ output, since: values.since, intervalMs: Number(values['interval-ms']),
    discoverOnly: values['discover-only'], resumeBlocked: values['resume-blocked'], refreshDirectory: values['refresh-directory'],
    reparseDirectory: values['reparse-directory'] },
  { log: event => console.log(JSON.stringify(event)) });
  console.log(JSON.stringify({ output, ...report }, null, 2));
  if (report.stop || report.states.failed || report.states.quarantined) process.exitCode = 2;
}
if (require.main === module) main().catch(error => { console.error(error.code || 'COLLECTION_FAILED', error.message); process.exitCode = 1; });
