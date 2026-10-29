require('dotenv').config({ path: require('node:path').resolve(__dirname, '../.env') });
const { iamConfig } = require('../lib/iam_config');
const TABLES = ['iam_accounts', 'iam_departments', 'iam_user_state', 'iam_push_receipts', 'iam_identity_audit',
  'iam_login_identities', 'iam_login_pending'];
async function check({ env = process.env, db } = {}) {
  const cfg = iamConfig(env);
  const result = { login: { enabled: cfg.enabled, configured: cfg.loginReady, missing: cfg.missing },
    push: { enabled: cfg.pushEnabled, configured: cfg.pushReady, sourceRestriction: cfg.sourceAddresses.length > 0 },
    accountGuard: cfg.guardEnabled, callback: cfg.callback, database: { checked: false }, realLoginVerified: false };
  if (db) {
    const [rows] = await db.query('SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (?)', [TABLES]);
    result.database = { checked: true, missingTables: TABLES.filter(table => !rows.some(row => row.name === table)) };
  }
  return result;
}
async function main() {
  const db = process.argv.includes('--database') ? require('../db').pool : null;
  try {
    const result = await check({ db }); console.log(JSON.stringify(result));
    if ((result.login.enabled && !result.login.configured) || (result.push.enabled && !result.push.configured)
      || result.database.missingTables?.length) process.exitCode = 1;
  } finally { if (db) await db.end(); }
}
if (require.main === module) main().catch(() => { console.error('IAM_PREFLIGHT_FAILED'); process.exitCode = 1; });
module.exports = { check };
