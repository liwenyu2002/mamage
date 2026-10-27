const assert = require('node:assert/strict');
const { test } = require('node:test');
const { assertSandboxEnvironment } = require('./news_sandbox');
test('local news integration server refuses production database names, addresses and ports', () => {
  const safe = { MAMAGE_NEWS_SANDBOX: '1', DB_HOST: '127.0.0.1', DB_PORT: '13362', DB_NAME: 'mamage_news_sandbox' };
  assert.doesNotThrow(() => assertSandboxEnvironment(safe));
  for (const patch of [{ DB_HOST: '10.1.131.37' }, { DB_PORT: '3306' }, { DB_NAME: 'mamage' }, { MAMAGE_NEWS_SANDBOX: '0' }]) {
    assert.throws(() => assertSandboxEnvironment({ ...safe, ...patch }), /non-isolated/);
  }
});
