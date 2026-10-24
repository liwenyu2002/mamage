const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { createBundle, extractBundle } = require('../lib/backup_bundle');

test('backup restores the exact SQL and private config; wrong keys and modified bytes expose no plaintext', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mamage-backup-test-'));
  const key = crypto.randomBytes(32).toString('base64');
  const sql = Buffer.from('CREATE TABLE synthetic(id INT); INSERT INTO synthetic VALUES (1);');
  const config = { JWT_SECRET: 'synthetic-test-secret', DB_PASSWORD: 'synthetic-password' };
  const input = path.join(dir, 'source.sql.gz'), archive = path.join(dir, 'backup.mgb');
  try {
    await fs.writeFile(input, zlib.gzipSync(sql));
    const result = await createBundle({ sqlPath: input, outputPath: archive, key, runtimeConfig: config, database: 'synthetic_test' });
    const bytes = await fs.readFile(archive);
    assert.ok(!bytes.includes(Buffer.from(config.JWT_SECRET)));
    assert.ok(!bytes.includes(sql));
    assert.equal((await fs.stat(archive)).mode & 0o777, 0o600);
    const restored = path.join(dir, 'restored');
    const manifest = await extractBundle({ inputPath: archive, outputDirectory: restored, key });
    assert.equal(manifest.databaseSHA256, result.databaseSHA256);
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(restored, 'runtime-config.json'), 'utf8')), config);
    assert.deepEqual(zlib.gunzipSync(await fs.readFile(path.join(restored, 'database.sql.gz'))), sql);
    await assert.rejects(extractBundle({ inputPath: archive, outputDirectory: restored, key }), /EEXIST/);
    const rejected = path.join(dir, 'must-not-exist');
    await assert.rejects(extractBundle({ inputPath: archive, outputDirectory: rejected, key: crypto.randomBytes(32).toString('base64') }), /AUTHENTICATION/);
    assert.equal(await fs.stat(rejected).then(() => true, () => false), false);
    bytes[40] ^= 1; await fs.writeFile(path.join(dir, 'corrupted.mgb'), bytes);
    await assert.rejects(extractBundle({ inputPath: path.join(dir, 'corrupted.mgb'), outputDirectory: rejected, key }), /AUTHENTICATION/);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
