// Local administrator tool. No password, role or media ownership changes are accepted here.
require('dotenv').config({ path: require('node:path').resolve(__dirname, '../.env') });
const { iamConfig } = require('../lib/iam_config');
const { createIamDirectory } = require('../lib/iam_directory');
async function main() {
  const cfg = iamConfig(), { pool } = require('../db');
  try {
    if (!cfg.appId || !cfg.orgId || !cfg.profileUrl) throw Error('Configure IAM source and organization first');
    const [command, externalId, rawUserId] = process.argv.slice(2);
    if (command === 'cleanup') {
      const [receipts] = await pool.query('DELETE FROM iam_push_receipts WHERE created_at < DATE_SUB(NOW(), INTERVAL 7 DAY) LIMIT 10000');
      const [audits] = await pool.query('DELETE FROM iam_identity_audit WHERE created_at < DATE_SUB(NOW(), INTERVAL 180 DAY) LIMIT 10000');
      const [pending] = await pool.query('DELETE FROM iam_login_pending WHERE created_at < DATE_SUB(NOW(), INTERVAL 7 DAY) LIMIT 10000');
      console.log(JSON.stringify({ receipts: receipts.affectedRows, audits: audits.affectedRows, pending: pending.affectedRows })); return;
    }
    if (command === 'audit-existing') {
      const names = JSON.parse(require('node:fs').readFileSync(externalId, 'utf8'));
      const result = await require('../lib/iam_profile_links').auditExisting(pool, cfg, names);
      console.log(JSON.stringify(result)); return;
    }
    if (command === 'pending-logins') {
      const [rows] = await pool.query('SELECT subject_id, claims, reason, created_at FROM iam_login_pending WHERE source_key = ? ORDER BY created_at DESC LIMIT 100', [cfg.sourceKey]);
      console.log(JSON.stringify(rows)); return;
    }
    if (command === 'pending') {
      const [rows] = await pool.query('SELECT external_id, principal_id, name, email, status FROM iam_accounts WHERE source_key = ? AND user_id IS NULL ORDER BY external_id LIMIT 1000', [cfg.sourceKey]);
      console.log(JSON.stringify(rows)); return;
    }
    const userId = Number(rawUserId);
    if (command !== 'bind' || !externalId || !Number.isSafeInteger(userId) || userId <= 0) throw Error('Usage: iam_accounts.js pending | bind <external-id> <local-user-id> | cleanup');
    console.log(JSON.stringify(await createIamDirectory(pool).bindUser(cfg, externalId, userId)));
  } finally { await pool.end(); }
}
if (require.main === module) main().catch(e => { console.error(/^IAM_/.test(e.code || '') ? e.code : 'IAM_ACCOUNT_TOOL_FAILED'); process.exitCode = 1; });
