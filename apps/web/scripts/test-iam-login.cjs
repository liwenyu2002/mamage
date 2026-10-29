const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path'), babel = require('@babel/core');
const code = babel.transformFileSync(path.join(__dirname, '../src/services/iamLogin.js'), { presets: [require.resolve('@babel/preset-env')] }).code;
const mod = { exports: {} }; new Function('module', 'exports', code)(mod, mod.exports);
const { hasIamHandoff, finishIamLogin } = mod.exports;
function fixture(hash = '#iam_code=' + 'a'.repeat(43)) {
  const tokens = new Map([['mamage_jwt_token', 'old-user-token']]), changes = [], calls = [];
  const location = { pathname: '/login', search: '', origin: 'https://photos.example.edu', hash, replace: path => changes.push(path) };
  return { tokens, changes, calls, location,
    storage: { removeItem: key => tokens.delete(key), setItem: (key, value) => tokens.set(key, value) },
    history: { replaceState: (_, __, path) => { changes.push(path); location.hash = new URL(path, location.origin).hash; } },
    request: async (url, options) => { calls.push({ url, options }); assert.equal(location.hash, '', 'handoff is removed before any request');
      assert.equal(tokens.has('mamage_jwt_token'), false); return { ok: true, json: async () => ({ token: 'new-local-token', returnTo: '/?projectId=102&upload=1' }) }; } };
}
test('IAM handoff clears old identity and URL before same-origin exchange, and restores album upload links', async () => {
  const f = fixture(); assert.equal(hasIamHandoff(f.location), true); await finishIamLogin(f);
  assert.equal(f.tokens.get('mamage_jwt_token'), 'new-local-token');
  assert.deepEqual(f.changes, ['/login', '/?projectId=102&upload=1']);
  assert.equal(f.calls[0].url, '/api/auth/iam/session'); assert.equal(f.calls[0].options.credentials, 'same-origin');
  assert.equal(JSON.parse(f.calls[0].options.body).code, 'a'.repeat(43));
});
test('invalid/expired handoffs and malicious destinations never leave an old account logged in', async () => {
  for (const returnTo of ['https://evil.example', '//evil.example', '/api/users/me', 'javascript:alert(1)']) {
    const f = fixture(); f.request = async () => ({ ok: true, json: async () => ({ token: 'reject-token', returnTo }) });
    await finishIamLogin(f); assert.equal(f.tokens.size, 0); assert.match(f.changes.at(-1), /iam_error=/);
  }
  for (const hash of ['#iam_code=invalid', '#iam_code=', '#iam_error=IAM_LOGIN_EXPIRED']) {
    const f = fixture(hash); await finishIamLogin(f); assert.equal(f.calls.length, 0); assert.equal(f.tokens.size, 0);
  }
  const f = fixture(); f.request = async () => { throw Error('network'); }; await finishIamLogin(f);
  assert.equal(f.tokens.size, 0); assert.ok(!f.changes.at(-1).includes('a'.repeat(43)));
});
test('ordinary password login URLs are unaffected', async () => {
  const f = fixture(''); assert.equal(hasIamHandoff(f.location), false); await finishIamLogin(f);
  assert.equal(f.tokens.get('mamage_jwt_token'), 'old-user-token'); assert.equal(f.changes.length, 0);
});
