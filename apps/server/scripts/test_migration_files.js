const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { listMigrationFiles } = require('./run_migrations');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mamage-migrations-'));
try {
  for (const name of ['20261013_002_folders.sql', '._20261013_001_core.sql', '.hidden.sql', 'README.md', '20261013_001_core.sql']) {
    fs.writeFileSync(path.join(dir, name), name.startsWith('.') ? Buffer.from([0, 5, 22, 7]) : 'SELECT 1;');
  }
  assert.deepEqual(listMigrationFiles(dir), ['20261013_001_core.sql', '20261013_002_folders.sql']);
  assert.deepEqual(listMigrationFiles(path.join(dir, 'missing')), []);
  console.log('PASS: migration discovery excludes macOS metadata and hidden SQL files');
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
