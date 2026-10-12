const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { revision, replaceLink, readLink, processConfig, assertNoDataLoss } = require('./deploy-lib.cjs');
const { checkPublish } = require('./check-publish.cjs');

test('private files are excluded from the entire publishable history', () => {
  checkPublish(process.env.MAMAGE_PUBLISH_ROOT || path.resolve(__dirname, '..'));
});

test('only pinned full revisions can be deployed', () => {
  assert.equal(revision('a'.repeat(40)), 'a'.repeat(40));
  for (const value of ['main', 'abc123', '../backup', 'a'.repeat(40) + ';whoami']) assert.throws(() => revision(value));
});
test('atomic release pointer supports rollback without replacing real directories', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mamage-release-'));
  try {
    const first = path.join(root, 'first'), second = path.join(root, 'second'), current = path.join(root, 'current');
    fs.mkdirSync(first); fs.mkdirSync(second);
    assert.equal(readLink(current), null);
    replaceLink(current, first);
    const previous = readLink(current);
    replaceLink(current, second);
    assert.equal(fs.realpathSync(current), fs.realpathSync(second));
    replaceLink(current, previous);
    assert.equal(fs.realpathSync(current), fs.realpathSync(first));
    assert.throws(() => replaceLink(first, second));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
test('process rollback keeps the original cwd, interpreter and environment', () => {
  const config = processConfig({ name: 'api', pm2_env: { pm_exec_path: '/old/app.js', pm_cwd: '/old',
    exec_interpreter: '/bin/node', exec_mode: 'cluster_mode', env: { PORT: '8080' } } });
  assert.equal(config.cwd, '/old'); assert.equal(config.script, '/old/app.js');
  assert.equal(config.env.PORT, '8080'); assert.equal(config.interpreter, '/bin/node');
});
test('data guard rejects missing workspaces or decreased album/photo counts', () => {
  const before = [{ organization_id: 2, unit_id: 1, albums: 21, photos: 3478 }];
  assertNoDataLoss(before, before);
  assertNoDataLoss(before, [{ ...before[0], photos: 3479 }]);
  assert.throws(() => assertNoDataLoss(before, []));
  assert.throws(() => assertNoDataLoss(before, [{ ...before[0], albums: 20 }]));
  assert.throws(() => assertNoDataLoss(before, [{ ...before[0], photos: 3477 }]));
});
