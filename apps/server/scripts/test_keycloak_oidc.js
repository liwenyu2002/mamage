const assert = require('node:assert/strict');
const { test } = require('node:test');
const crypto = require('node:crypto');
const http = require('node:http');
const express = require('express');
const jwt = require('jsonwebtoken');
const { fixture } = require('./fixtures/iam_test_db');
const { oidcConfig } = require('../lib/oidc_config');
const { createOidcClient } = require('../lib/oidc_client');
const { createOidcAuthRouter } = require('../routes/auth_oidc');
const { createSharedStore } = require('../lib/shared_runtime_state');

process.env.OIDC_ENABLED = '1';
process.env.IAM_ACCOUNT_GUARD = '1';
const secret = 'synthetic-oidc-local-signing-secret';
const b64 = value => Buffer.from(value).toString('base64url');
const hash = value => crypto.createHash('sha256').update(value).digest('base64url');

function keyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'test-key-1', use: 'sig', alg: 'RS256' };
  return { privateKey, jwk };
}

// 最小的 Keycloak 形态 IdP：只实现发现、授权、令牌、userinfo、JWKS 五个端点。
function createIdp() {
  const { privateKey, jwk } = keyPair();
  const idp = {
    codes: new Map(), accessTokens: new Map(), overrides: {}, requests: [],
    claims: () => ({ sub: 'kc-subject-1', name: '张晓朋', email: 'zhang@example.edu', preferred_username: 'zhangxp' }),
    issueIdToken(code) {
      const now = Math.floor(Date.now() / 1000);
      const claims = { iss: idp.issuer, aud: 'mamage-test', azp: 'mamage-test', iat: now, exp: now + 300,
        nonce: code.nonce, ...idp.claims(), ...(idp.overrides.claims || {}) };
      if (idp.overrides.expired) claims.exp = now - 600; // 超出允许的 60s 时钟偏移
      const header = { alg: idp.overrides.algorithm || 'RS256', kid: jwk.kid, typ: 'JWT' };
      const signingInput = `${b64(JSON.stringify(header))}.${b64(JSON.stringify(claims))}`;
      let signature = crypto.sign('sha256', Buffer.from(signingInput), privateKey).toString('base64url');
      if (idp.overrides.tamperSignature) signature = b64('tampered');
      return `${signingInput}.${signature}`;
    },
  };
  const send = (res, status, body, headers = {}) => {
    res.writeHead(status, { 'Content-Type': 'application/json', ...headers }); res.end(JSON.stringify(body));
  };
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://idp.test');
    idp.requests.push({ method: req.method, path: url.pathname, search: url.search });
    if (url.pathname === '/realms/test/.well-known/openid-configuration') {
      return send(res, 200, { issuer: idp.issuer, authorization_endpoint: `${idp.issuer}/protocol/openid-connect/auth`,
        token_endpoint: `${idp.issuer}/protocol/openid-connect/token`, userinfo_endpoint: `${idp.issuer}/protocol/openid-connect/userinfo`,
        jwks_uri: `${idp.issuer}/protocol/openid-connect/certs`, end_session_endpoint: `${idp.issuer}/protocol/openid-connect/logout` });
    }
    if (url.pathname === '/realms/test/protocol/openid-connect/certs') return send(res, 200, { keys: [jwk] });
    if (url.pathname === '/realms/test/protocol/openid-connect/auth') {
      const query = url.searchParams;
      if (query.get('client_id') !== 'mamage-test' || query.get('response_type') !== 'code'
        || !String(query.get('scope') || '').split(' ').includes('openid')
        || !/^[\w-]{43}$/.test(query.get('state') || '') || !/^[\w-]{43}$/.test(query.get('nonce') || '')
        || query.get('code_challenge_method') !== 'S256' || !query.get('code_challenge')) {
        return send(res, 400, { error: 'invalid_request' });
      }
      const code = crypto.randomBytes(20).toString('base64url');
      idp.codes.set(code, { challenge: query.get('code_challenge'), nonce: query.get('nonce'),
        redirectUri: query.get('redirect_uri') });
      const target = new URL(query.get('redirect_uri'));
      target.searchParams.set('code', code); target.searchParams.set('state', query.get('state'));
      res.writeHead(302, { Location: target.href }); return res.end();
    }
    if (url.pathname === '/realms/test/protocol/openid-connect/token' && req.method === 'POST') {
      let raw = ''; for await (const chunk of req) raw += chunk;
      const form = new URLSearchParams(raw);
      const expected = 'Basic ' + Buffer.from(`${encodeURIComponent('mamage-test')}:${encodeURIComponent('test-secret')}`).toString('base64');
      if (req.headers.authorization !== expected) return send(res, 401, { error: 'invalid_client' });
      const entry = idp.codes.get(form.get('code'));
      idp.codes.delete(form.get('code'));
      if (!entry || form.get('redirect_uri') !== entry.redirectUri || idp.overrides.corruptVerifier
        || hash(String(form.get('code_verifier') || '')) !== entry.challenge) return send(res, 400, { error: 'invalid_grant' });
      if (idp.overrides.tokenFailure) return send(res, 500, { error: 'server_error' });
      const accessToken = `at-${crypto.randomBytes(12).toString('base64url')}`;
      idp.accessTokens.set(accessToken, entry.nonce);
      return send(res, 200, { access_token: accessToken, id_token: idp.issueIdToken(entry), token_type: 'Bearer', expires_in: 300 });
    }
    if (url.pathname === '/realms/test/protocol/openid-connect/userinfo') {
      const token = String(req.headers.authorization || '').replace(/^Bearer /, '');
      if (!idp.accessTokens.has(token) || idp.overrides.userinfoFailure) return send(res, 401, { error: 'invalid_token' });
      return send(res, 200, { sub: idp.overrides.userinfoSubject || idp.claims().sub,
        ...(idp.overrides.userinfoClaims || {}) });
    }
    send(res, 404, { error: 'not_found' });
  });
  return { idp, server, listen: () => new Promise(resolve => server.listen(0, '127.0.0.1', () => {
    idp.issuer = `http://127.0.0.1:${server.address().port}/realms/test`; resolve(idp.issuer);
  })), close: () => new Promise(resolve => server.close(resolve)) };
}

function serve(app) {
  const server = app.listen(0, '127.0.0.1');
  return new Promise(resolve => server.once('listening', () => resolve({
    base: `http://127.0.0.1:${server.address().port}`,
    close: () => { server.closeAllConnections(); return new Promise(done => server.close(done)); } })));
}

function cookieFrom(response) {
  const raw = (response.headers.getSetCookie?.() || [response.headers.get('set-cookie')]).filter(Boolean)[0] || '';
  return { header: raw.split(';')[0], name: raw.split('=')[0], value: raw.split(';')[0].slice(raw.split('=')[0].length + 1) };
}

async function harness() {
  const f = fixture();
  const idp = createIdp();
  const issuer = await idp.listen();
  const env = { MAMAGE_PUBLIC_URL: 'https://photos.example.edu', OIDC_ENABLED: '1', OIDC_ISSUER: issuer,
    OIDC_ALLOW_INSECURE_ISSUER_ORIGIN: new URL(issuer).origin, OIDC_CLIENT_ID: 'mamage-test', OIDC_CLIENT_SECRET: 'test-secret',
    OIDC_ORGANIZATION_ID: '2', OIDC_AUTO_PROVISION: '1', OIDC_PROFILE_LOGIN_MATCHING: '1' };
  const config = oidcConfig(env);
  assert.equal(config.loginReady, true, `config should be ready: ${config.missing.join(' / ')}`);
  const store = createSharedStore('test-oidc-login');
  const app = express();
  app.use('/api/auth/oidc', createOidcAuthRouter({ db: f.pool, config: () => config, store,
    rate: { take: async () => ({ allowed: true }) }, secret: () => secret, client: createOidcClient() }));
  const server = await serve(app);
  return { f, idp: idp.idp, idpServer: idp, server, config, store, env };
}

async function startLogin(ctx, returnTo = '/projects') {
  const response = await fetch(`${ctx.server.base}/api/auth/oidc/login?returnTo=${encodeURIComponent(returnTo)}`, { redirect: 'manual' });
  assert.equal(response.status, 302);
  const location = new URL(response.headers.get('location'));
  const cookie = cookieFrom(response);
  assert.match(cookie.value, /^[\w-]{43}$/);
  const authorize = await fetch(location.href, { redirect: 'manual' });
  assert.equal(authorize.status, 302);
  const callback = new URL(authorize.headers.get('location'));
  return { callback, cookie, state: location.searchParams.get('state'), nonce: location.searchParams.get('nonce') };
}

async function callback(ctx, callbackUrl, cookie) {
  return fetch(`${ctx.server.base}/api/auth/oidc/callback${callbackUrl.search}`, { redirect: 'manual',
    headers: { cookie: cookie.header } });
}

async function loginOnce(ctx, returnTo = '/projects') {
  const flow = await startLogin(ctx, returnTo);
  const response = await callback(ctx, flow.callback, flow.cookie);
  assert.equal(response.status, 302);
  const location = response.headers.get('location');
  assert.match(location, /^\/api\/auth\/oidc\/complete#oidc_code=[\w-]{43}$/);
  const code = location.split('oidc_code=')[1];
  const session = await fetch(`${ctx.server.base}/api/auth/oidc/session`, { method: 'POST', headers: {
    Origin: ctx.config.publicOrigin, 'Content-Type': 'application/json', cookie: flow.cookie.header },
  body: JSON.stringify({ code }) });
  return { session, code, flow };
}

test('OIDC 登录完整链路：发现 → PKCE → id_token 验签 → 自动建 visitor → 换本站 JWT', async () => {
  const ctx = await harness();
  try {
    const { session } = await loginOnce(ctx);
    assert.equal(session.status, 200);
    const body = await session.json();
    assert.equal(typeof body.token, 'string');
    assert.equal(body.returnTo, '/projects');
    const payload = jwt.verify(body.token, secret);
    assert.equal(payload.iav, 0);
    const [[user]] = [ctx.f.sql.prepare("SELECT id, role, name, email, student_no FROM users WHERE email = 'zhang@example.edu'").all()];
    assert.equal(user.role, 'visitor');
    assert.equal(user.name, '张晓朋');
    assert.equal(user.student_no, 'zhangxp');
    const identity = ctx.f.sql.prepare('SELECT * FROM iam_login_identities').all();
    assert.equal(identity.length, 1);
    assert.equal(identity[0].subject_id, 'kc-subject-1');
    // 令牌端点必须收到 PKCE 的 code_verifier，且 client_secret_basic 按 Keycloak 约定编码。
    const tokenCall = ctx.idp.requests.find(request => request.path.endsWith('/token'));
    assert.ok(tokenCall, 'token endpoint called');
    assert.equal(ctx.idp.requests.filter(request => request.path === '/realms/test/.well-known/openid-configuration').length, 1);
  } finally { await ctx.server.close(); await ctx.idpServer.close(); ctx.f.close(); }
});

test('同一 Keycloak 主体再次登录复用账号，不重复建号', async () => {
  const ctx = await harness();
  try {
    await loginOnce(ctx);
    const { session } = await loginOnce(ctx);
    assert.equal(session.status, 200);
    assert.equal(ctx.f.sql.prepare("SELECT COUNT(*) AS count FROM users WHERE email = 'zhang@example.edu'").all()[0].count, 1,
      'second login reuses the provisioned visitor instead of duplicating it');
  } finally { await ctx.server.close(); await ctx.idpServer.close(); ctx.f.close(); }
});

test('退出后请求重新认证，不能由浏览器覆盖服务端身份提供方或传入任意 prompt', async () => {
  const ctx = await harness();
  try {
    ctx.config.idpHint = 'dingtalk';
    for (const [query, expected] of [
      ['', null], ['?reauthenticate=1&prompt=none&kc_idp_hint=evil', 'login'],
      ['?reauthenticate=0&prompt=none', null],
    ]) {
      const start = await fetch(ctx.server.base + '/api/auth/oidc/login' + query, { redirect: 'manual' });
      assert.equal(start.status, 302);
      const auth = new URL(start.headers.get('location'));
      assert.equal(auth.searchParams.get('prompt'), expected);
      assert.equal(auth.searchParams.get('kc_idp_hint'), 'dingtalk');
      assert.equal(auth.searchParams.get('code_challenge_method'), 'S256');
    }
  } finally { await ctx.server.close(); await ctx.idpServer.close(); ctx.f.close(); }
});

test('内嵌授权先移交顶层，缺 Cookie 的 iframe 不换 token，顶层仍验证绑定与 PKCE', async () => {
  const ctx = await harness();
  try {
    ctx.config.embedEnabled = true; ctx.config.idpHint = 'dingtalk';
    const start = await fetch(ctx.server.base + '/api/auth/oidc/login?embedded=1&returnTo=%2F%3FprojectId%3D102&kc_idp_hint=evil', { redirect: 'manual' });
    const cookie = cookieFrom(start), auth = new URL(start.headers.get('location'));
    assert.equal(auth.searchParams.get('kc_idp_hint'), 'dingtalk', '请求不能覆盖服务器的 IdP');
    const upstream = await fetch(auth, { redirect: 'manual' });
    const cb = new URL(upstream.headers.get('location'));
    const returned = await fetch(ctx.server.base + '/api/auth/oidc/callback' + cb.search, { redirect: 'manual' });
    const fragment = new URL(returned.headers.get('location'), ctx.server.base).hash;
    assert.ok(fragment.startsWith('#oidc_callback='));
    assert.equal(ctx.idp.requests.filter(item => item.path.endsWith('/token')).length, 0);
    assert.equal(ctx.f.sql.prepare('SELECT COUNT(*) AS n FROM iam_login_identities').get().n, 0);
    const query = decodeURIComponent(fragment.slice(15));
    const missingCookie = await fetch(ctx.server.base + '/api/auth/oidc/finish?' + query, { redirect: 'manual' });
    assert.match(missingCookie.headers.get('location'), /oidc_error=OIDC_LOGIN_EXPIRED/);
    const complete = await fetch(ctx.server.base + '/api/auth/oidc/finish?' + query, { redirect: 'manual', headers: { cookie: cookie.header } });
    assert.match(complete.headers.get('location'), /oidc_code=[\w-]{43}$/);
    const handoff = complete.headers.get('location').split('oidc_code=')[1];
    const session = await fetch(ctx.server.base + '/api/auth/oidc/session', { method: 'POST',
      headers: { Origin: ctx.config.publicOrigin, 'Content-Type': 'application/json', cookie: cookie.header }, body: JSON.stringify({ code: handoff }) });
    assert.equal(session.status, 200); assert.equal((await session.json()).returnTo, '/?projectId=102');
    const replay = await fetch(ctx.server.base + '/api/auth/oidc/finish?' + query, { redirect: 'manual', headers: { cookie: cookie.header } });
    assert.match(replay.headers.get('location'), /oidc_error=OIDC_LOGIN_EXPIRED/);
  } finally { await ctx.server.close(); await ctx.idpServer.close(); ctx.f.close(); }
});

test('OIDC 完成桥同源加载脚本，不启动图库、不发 JWT，只给父窗口一次性临时码', async () => {
  const vm = require('node:vm'), ctx = await harness();
  try {
    const page = await fetch(ctx.server.base + '/api/auth/oidc/complete?untrusted=%3Cscript%3E');
    assert.equal(page.headers.get('x-frame-options'), 'SAMEORIGIN');
    assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'self'/);
    assert.equal(page.headers.get('cache-control'), 'no-store');
    const html = await page.text(); assert.ok(!html.includes('untrusted'));
    assert.match(html, /src="\/api\/auth\/oidc\/complete.js"/);
    const script = await (await fetch(ctx.server.base + '/api/auth/oidc/complete.js')).text();
    for (const framed of [false, true]) {
      const calls = [], hash = '#oidc_code=' + 'h'.repeat(43), origin = ctx.config.publicOrigin;
      const window = {}; window.parent = framed ? { postMessage: (message, target) => calls.push({ message, target }) } : window;
      vm.runInNewContext(script, { window, URLSearchParams, location: { hash, origin, pathname: '/api/auth/oidc/complete', replace: target => calls.push(target) },
        history: { replaceState: (_, __, target) => calls.push(target) } });
      assert.equal(calls[0], '/api/auth/oidc/complete', '先清除临时码再发送');
      assert.deepEqual(JSON.parse(JSON.stringify(calls[1])), framed ? { message: { type: 'mamage:oidc-complete', hash }, target: origin } : '/login' + hash);
    }
  } finally { await ctx.server.close(); await ctx.idpServer.close(); ctx.f.close(); }
});

test('state 一次性：回调重放被拒绝', async () => {
  const ctx = await harness();
  try {
    const flow = await startLogin(ctx);
    const first = await callback(ctx, flow.callback, flow.cookie);
    assert.match(first.headers.get('location'), /oidc_code=/);
    const replay = await callback(ctx, flow.callback, flow.cookie);
    assert.match(replay.headers.get('location'), /oidc_error=OIDC_LOGIN_EXPIRED/);
  } finally { await ctx.server.close(); await ctx.idpServer.close(); ctx.f.close(); }
});

test('PKCE 校验失败不换发本站会话', async () => {
  const ctx = await harness();
  try {
    ctx.idp.overrides.corruptVerifier = true;
    const flow = await startLogin(ctx);
    const response = await callback(ctx, flow.callback, flow.cookie);
    assert.match(response.headers.get('location'), /oidc_error=OIDC_UPSTREAM_UNAVAILABLE/);
  } finally { await ctx.server.close(); await ctx.idpServer.close(); ctx.f.close(); }
});

test('nonce / audience / 签名 / 过期任一不符都拒绝', async () => {
  const cases = [
    ['nonce', { claims: { nonce: 'wrong-nonce-value' } }, /OIDC_NONCE_MISMATCH/],
    ['audience', { claims: { aud: 'another-client' } }, /OIDC_AUDIENCE_MISMATCH/],
    ['signature', { tamperSignature: true }, /OIDC_INVALID_SIGNATURE/],
    ['expired', { expired: true }, /OIDC_TOKEN_EXPIRED/],
  ];
  for (const [label, override, expected] of cases) {
    const ctx = await harness();
    try {
      Object.assign(ctx.idp.overrides, override);
      const flow = await startLogin(ctx);
      const response = await callback(ctx, flow.callback, flow.cookie);
      assert.match(response.headers.get('location'), expected, `${label} rejection`);
      assert.equal(ctx.f.sql.prepare('SELECT COUNT(*) AS count FROM users').all()[0].count, 2, `${label}: no account created`);
    } finally { await ctx.server.close(); await ctx.idpServer.close(); ctx.f.close(); }
  }
});

test('userinfo 的 sub 与已验签 id_token 不一致时拒绝', async () => {
  const ctx = await harness();
  try {
    ctx.idp.overrides.userinfoSubject = 'someone-else';
    const flow = await startLogin(ctx);
    const response = await callback(ctx, flow.callback, flow.cookie);
    assert.match(response.headers.get('location'), /oidc_error=OIDC_SUBJECT_MISMATCH/);
  } finally { await ctx.server.close(); await ctx.idpServer.close(); ctx.f.close(); }
});

test('session 接口要求同源 Origin，并校验一次性 handoff', async () => {
  const ctx = await harness();
  try {
    const flow = await startLogin(ctx);
    const response = await callback(ctx, flow.callback, flow.cookie);
    const code = response.headers.get('location').split('oidc_code=')[1];
    const crossSite = await fetch(`${ctx.server.base}/api/auth/oidc/session`, { method: 'POST',
      headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json', cookie: flow.cookie.header },
      body: JSON.stringify({ code }) });
    assert.equal(crossSite.status, 403);
    const ok = await fetch(`${ctx.server.base}/api/auth/oidc/session`, { method: 'POST',
      headers: { Origin: ctx.config.publicOrigin, 'Content-Type': 'application/json', cookie: flow.cookie.header },
      body: JSON.stringify({ code }) });
    assert.equal(ok.status, 200);
    const replay = await fetch(`${ctx.server.base}/api/auth/oidc/session`, { method: 'POST',
      headers: { Origin: ctx.config.publicOrigin, 'Content-Type': 'application/json', cookie: flow.cookie.header },
      body: JSON.stringify({ code }) });
    assert.equal(replay.status, 401);
    assert.equal((await replay.json()).error, 'OIDC_LOGIN_EXPIRED');
  } finally { await ctx.server.close(); await ctx.idpServer.close(); ctx.f.close(); }
});

test('账号停用后 OIDC 会话被拒绝', async () => {
  const ctx = await harness();
  try {
    const { session } = await loginOnce(ctx);
    assert.equal(session.status, 200);
    const [[user]] = [ctx.f.sql.prepare('SELECT id FROM users WHERE email = ?').all('zhang@example.edu')];
    ctx.f.sql.exec(`INSERT INTO iam_user_state(user_id, disabled, session_version) VALUES(${user.id}, 1, 1)`);
    const flow = await startLogin(ctx);
    const denied = await callback(ctx, flow.callback, flow.cookie);
    assert.match(denied.headers.get('location'), /oidc_error=ACCOUNT_SESSION_REVOKED/);
  } finally { await ctx.server.close(); await ctx.idpServer.close(); ctx.f.close(); }
});

test('未开启资料匹配时首次登录被拒绝，不建号、不留待核对', async () => {
  const ctx = await harness();
  ctx.config.profileLoginMatching = false;
  try {
    const flow = await startLogin(ctx);
    const response = await callback(ctx, flow.callback, flow.cookie);
    assert.match(response.headers.get('location'), /oidc_error=IAM_ACCOUNT_LINK_REQUIRED/);
    assert.equal(ctx.f.sql.prepare('SELECT COUNT(*) AS count FROM users').all()[0].count, 2);
    assert.equal(ctx.f.sql.prepare('SELECT COUNT(*) AS count FROM iam_login_pending').all()[0].count, 0);
  } finally { await ctx.server.close(); await ctx.idpServer.close(); ctx.f.close(); }
});

test('关闭资料匹配时仅已绑定身份可登录', async () => {
  const ctx = await harness();
  ctx.config.profileLoginMatching = false;
  try {
    ctx.f.sql.exec(`INSERT INTO iam_login_identities(source_key,subject_id,user_id) VALUES('${ctx.config.sourceKey}','kc-subject-1',7)`);
    const { session } = await loginOnce(ctx);
    assert.equal(session.status, 200);
    const payload = jwt.verify((await session.json()).token, secret);
    assert.equal(payload.id, 7);
    assert.equal(ctx.f.sql.prepare('SELECT COUNT(*) AS count FROM users').all()[0].count, 2);
  } finally { await ctx.server.close(); await ctx.idpServer.close(); ctx.f.close(); }
});

test('开启匹配但不开自动开户：唯一邮箱命中存量账号并保留原权限', async () => {
  const ctx = await harness();
  ctx.config.autoProvision = false;
  ctx.idp.claims = () => ({ sub: 'kc-subject-existing', name: 'Original owner', email: 'existing@example.edu', preferred_username: 'student-7' });
  try {
    const { session } = await loginOnce(ctx);
    assert.equal(session.status, 200);
    const payload = jwt.verify((await session.json()).token, secret);
    assert.equal(payload.id, 7);
    const user = ctx.f.sql.prepare('SELECT id, role, email, student_no FROM users WHERE id = 7').all()[0];
    assert.equal(user.role, 'admin', '匹配存量账号不改变原有权限');
    assert.equal(user.email, 'existing@example.edu');
    assert.equal(ctx.f.sql.prepare('SELECT COUNT(*) AS count FROM users').all()[0].count, 2);
  } finally { await ctx.server.close(); await ctx.idpServer.close(); ctx.f.close(); }
});

test('discovery 的 issuer 与配置不一致时拒绝登录', async () => {
  const ctx = await harness();
  try {
    ctx.idp.overrides = {};
    const original = ctx.idp.issuer;
    ctx.idp.issuer = original + '-other';
    const response = await fetch(`${ctx.server.base}/api/auth/oidc/login`, { redirect: 'manual' });
    assert.equal(response.status, 503);
    ctx.idp.issuer = original;
  } finally { await ctx.server.close(); await ctx.idpServer.close(); ctx.f.close(); }
});
