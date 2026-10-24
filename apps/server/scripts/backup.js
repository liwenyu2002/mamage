const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { createBundle, extractBundle } = require('../lib/backup_bundle');

async function main() {
  const args = process.argv.slice(2);
  const arg = name => { const index = args.indexOf(name); return index < 0 ? null : args[index + 1]; };
  const keyPath = arg('--key-file') || process.env.MAMAGE_BACKUP_KEY_FILE || '/run/backup-key/key';
  const key = (await fs.readFile(keyPath, 'utf8')).trim();
  if (args[0] === 'extract') {
    const manifest = await extractBundle({ inputPath: arg('--input'), outputDirectory: arg('--output'), key });
    console.log(JSON.stringify({ extracted: true, manifest }));
    return;
  }
  const sqlPath = arg('--sql') || '/work/database.sql.gz';
  const configDirectory = arg('--config-dir') || '/run/runtime-config';
  const runtimeConfig = {};
  const directories = [arg('--settings-dir') || '/run/runtime-settings', configDirectory];
  for (const directory of directories) for (const name of await fs.readdir(directory)) {
    if (/^[A-Z_][A-Z0-9_]*$/.test(name)) runtimeConfig[name] = await fs.readFile(path.join(directory, name), 'utf8');
  }
  for (const name of ['COS_BASE_URL', 'COS_REGION', 'COS_FORCE_PATH_STYLE', 'MAMAGE_RELEASE_SHA']) {
    if (process.env[name] !== undefined) runtimeConfig[name] = process.env[name];
  }
  const outputPath = arg('--output') || '/work/database.mgb';
  const manifest = await createBundle({ sqlPath, outputPath, key, runtimeConfig,
    database: process.env.DB_NAME, release: process.env.MAMAGE_RELEASE_SHA || null });
  if (args.includes('--local-only')) { console.log(JSON.stringify({ created: true, manifest })); return; }
  const storage = require('../lib/cos_storage');
  const prefix = String(process.env.MAMAGE_BACKUP_PREFIX || 'backups/mamage/');
  if (!/^[A-Za-z0-9/_-]+\/$/.test(prefix) || prefix.startsWith('/')) throw new Error('BACKUP_PREFIX_INVALID');
  const objectKey = prefix + manifest.createdAt.replace(/[:.]/g, '-') + '-' + manifest.sha256.slice(0, 12) + '.mgb';
  await storage.uploadFile(objectKey, outputPath, { contentType: 'application/octet-stream', cacheControl: 'private, no-store' });
  const remote = await storage.getObject(objectKey, { signal: AbortSignal.timeout(600000) });
  const verification = crypto.createHash('sha256');
  let received = 0;
  try {
    for await (const chunk of remote.Body) {
      received += chunk.length;
      if (received > manifest.bytes) throw new Error('BACKUP_STORAGE_SIZE_MISMATCH');
      verification.update(chunk);
    }
  } finally { remote.Body?.destroy?.(); }
  if (received !== manifest.bytes || verification.digest('hex') !== manifest.sha256) throw new Error('BACKUP_STORAGE_CHECKSUM_MISMATCH');
  const receipt = { ...manifest, objectKey, verified: true, encryption: 'AES-256-GCM', expiresAt: Date.now() + 366 * 86400000 };
  const { pool } = require('../db');
  try {
    await pool.query(`INSERT INTO runtime_state (namespace,state_key,payload,expires_at) VALUES ('operations','backup:latest',?,?)
      ON DUPLICATE KEY UPDATE payload=VALUES(payload),expires_at=VALUES(expires_at)`, [JSON.stringify(receipt), receipt.expiresAt]);
  } finally { await pool.end(); storage.ensureClient()?.destroy(); }
  console.log(JSON.stringify({ backedUp: true, bytes: manifest.bytes, sha256: manifest.sha256, objectKey, createdAt: manifest.createdAt }));
}

if (require.main === module) main().catch(error => { console.error('[backup]', error.code || error.message || 'BACKUP_FAILED'); process.exitCode = 1; });
module.exports = { main };
