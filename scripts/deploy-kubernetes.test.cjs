const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { quote, targetOptions } = require('./deploy-kubernetes.cjs');
const { merge } = require('./deploy-kubernetes-remote.cjs');
test('deployment uses the school cluster, validates targets and only accepts immutable native bases', () => {
  assert.equal(targetOptions({}).host, 'ubuntu@10.1.131.37');
  for (const env of [{ MAMAGE_DEPLOY_HOST: 'host;exit' }, { MAMAGE_NAMESPACE: '../db' }, { MAMAGE_COMPAT_BASE_IMAGE: 'api:latest' }]) {
    assert.throws(() => targetOptions(env));
  }
  assert.equal(targetOptions({ MAMAGE_COMPAT_BASE_IMAGE: 'sha256:' + 'a'.repeat(64) }).base, 'sha256:' + 'a'.repeat(64));
});
test('shell quoting preserves literal arguments without expansion and release values merge without mutation', () => {
  const value = "a'$(echo untrusted); b";
  assert.equal(execFileSync('sh', ['-c', `printf %s ${quote(value)}`], { encoding: 'utf8' }), value);
  const before = { images: { api: { digest: 'old' }, web: { digest: 'keep' } }, config: { MODEL: 'keep' } };
  const next = merge(before, { images: { api: { digest: 'new' } }, backup: { enabled: true } });
  assert.equal(next.images.web.digest, 'keep'); assert.equal(before.images.api.digest, 'old');
  assert.equal(next.config.MODEL, 'keep'); assert.equal(next.backup.enabled, true);
});
