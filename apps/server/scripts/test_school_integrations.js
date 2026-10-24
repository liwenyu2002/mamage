const assert = require('node:assert/strict');
const { test } = require('node:test');
const { schoolIntegrationReadiness } = require('../lib/school_integrations');

test('school HTTPS and DingTalk stay disabled until a same-origin HTTPS callback and credentials exist', () => {
  const configured = { MAMAGE_PUBLIC_URL: 'https://gallery.example.edu.cn', DINGTALK_CLIENT_ID: 'synthetic-client',
    DINGTALK_CLIENT_SECRET: 'synthetic-secret', DINGTALK_REDIRECT_URI: 'https://gallery.example.edu.cn/api/auth/dingtalk/callback' };
  assert.equal(schoolIntegrationReadiness(configured).dingtalk.configured, true);
  assert.equal(schoolIntegrationReadiness(configured).https.verified, false, 'configuration alone does not prove certificate trust');
  for (const change of [{ MAMAGE_PUBLIC_URL: 'http://10.1.1.1' }, { DINGTALK_REDIRECT_URI: '' },
    { DINGTALK_REDIRECT_URI: 'https://other.invalid/api/auth/dingtalk/callback' }, { DINGTALK_CLIENT_SECRET: '' },
    { DINGTALK_REDIRECT_URI: 'https://gallery.example.edu.cn/api/auth/dingtalk/callback?token=bad' }]) {
    assert.equal(schoolIntegrationReadiness({ ...configured, ...change }).dingtalk.configured, false);
  }
  assert.ok(!JSON.stringify(schoolIntegrationReadiness(configured)).includes('synthetic-secret'));
});
