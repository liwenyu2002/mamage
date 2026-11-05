const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path'), babel = require('@babel/core');
const code = babel.transformFileSync(path.join(__dirname, '../src/services/oidcLogin.js'), { presets: [require.resolve('@babel/preset-env')] }).code;
const mod = { exports: {} }; new Function('module', 'exports', code)(mod, mod.exports);
const { hasOidcHandoff, oidcLoginUrl, finishOidcLogin, autoStartOidcLogin } = mod.exports;
function fixture(hash = '#oidc_code=' + 'b'.repeat(43)) {
  const tokens = new Map([['mamage_jwt_token', 'old-user-token']]), changes = [], calls = [];
  const location = { pathname: '/login', search: '', origin: 'https://photos.example.edu', hash, replace: path => changes.push(path) };
  return { tokens, changes, calls, location,
    storage: { removeItem: key => tokens.delete(key), setItem: (key, value) => tokens.set(key, value) },
    history: { replaceState: (_, __, path) => { changes.push(path); location.hash = new URL(path, location.origin).hash; } },
    request: async (url, options) => { calls.push({ url, options }); assert.equal(location.hash, '', 'handoff 先清除再发请求');
      assert.equal(tokens.has('mamage_jwt_token'), false); return { ok: true, json: async () => ({ token: 'new-local-token', returnTo: '/?projectId=102&upload=1' }) }; } };
}
test('OIDC handoff 复用与 IAM 相同的安全语义：先清旧身份与 hash，再同源换 token', async () => {
  const f = fixture(); assert.equal(hasOidcHandoff(f.location), true); await finishOidcLogin(f);
  assert.equal(f.tokens.get('mamage_jwt_token'), 'new-local-token');
  assert.deepEqual(f.changes, ['/login', '/?projectId=102&upload=1']);
  assert.equal(f.calls[0].url, '/api/auth/oidc/session');
  assert.equal(f.calls[0].options.credentials, 'same-origin');
  assert.equal(JSON.parse(f.calls[0].options.body).code, 'b'.repeat(43));
});
test('非法/过期 handoff 与恶意回跳不会留下旧账号', async () => {
  for (const returnTo of ['https://evil.example', '//evil.example', '/api/users/me', 'javascript:alert(1)']) {
    const f = fixture(); f.request = async () => ({ ok: true, json: async () => ({ token: 'reject-token', returnTo }) });
    await finishOidcLogin(f); assert.equal(f.tokens.size, 0); assert.match(f.changes.at(-1), /oidc_error=/);
  }
  for (const hash of ['#oidc_code=invalid', '#oidc_code=', '#oidc_error=OIDC_LOGIN_EXPIRED']) {
    const f = fixture(hash); await finishOidcLogin(f); assert.equal(f.calls.length, 0); assert.equal(f.tokens.size, 0);
  }
  const f = fixture(); f.request = async () => { throw Error('network'); }; await finishOidcLogin(f);
  assert.equal(f.tokens.size, 0); assert.ok(!f.changes.at(-1).includes('b'.repeat(43)));
});
test('OIDC 登录入口保留回跳目标，普通密码登录不受影响', () => {
  const location = { pathname: '/', search: '?projectId=102&upload=1' };
  assert.equal(oidcLoginUrl(location), '/api/auth/oidc/login?returnTo=' + encodeURIComponent('/?projectId=102&upload=1'));
  assert.equal(hasOidcHandoff({ hash: '' }), false);
  assert.equal(hasOidcHandoff({ hash: '#iam_code=' + 'a'.repeat(43) }), false, '不会误吞芯盾 handoff');
});

test('OIDC 无感登录：仅显式开启、无错误/邀请参数、2 分钟内只自动尝试一次', () => {
  const values = new Map(), calls = [];
  const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  const location = { pathname: '/', search: '?projectId=102', hash: '', replace: url => calls.push(url) };
  const providers = { oidc: true, oidcAutoStart: true };
  assert.equal(autoStartOidcLogin({ providers, location, storage, now: 1000000 }), true);
  assert.equal(calls[0], '/api/auth/oidc/login?returnTo=' + encodeURIComponent('/?projectId=102'));
  assert.equal(autoStartOidcLogin({ providers, location, storage, now: 1000001 }), false, '两分钟内不重复跳转');
  assert.equal(autoStartOidcLogin({ providers, location: { ...location, hash: '#oidc_error=X' }, storage, now: 2000000 }), false);
  assert.equal(autoStartOidcLogin({ providers, location: { ...location, search: '?invite=1' }, storage, now: 2000000 }), false);
  assert.equal(autoStartOidcLogin({ providers: { ...providers, oidcAutoStart: false }, location: { ...location, search: '' }, storage, now: 2000000 }), false);
  assert.equal(autoStartOidcLogin({ providers: { oidc: false }, location, storage, now: 2000000 }), false);
});
