const assert = require('node:assert/strict');
const { test } = require('node:test');
const express = require('express');
const { createIamAuthRouter } = require('../routes/auth_iam');
const { createIamQrGateway } = require('../lib/iam_qr_gateway');
const { createSharedStore } = require('../lib/shared_runtime_state');
const { iamConfig } = require('../lib/iam_config');
const { sha256 } = require('../lib/iam_protocol');
const cfg = iamConfig({ IAM_ENABLED: '1', IAM_QR_ENABLED: '1', MAMAGE_PUBLIC_URL: 'https://photos.example.edu',
  IAM_BASE_URL: 'https://iam.example.edu', IAM_CLIENT_ID: 'test-client', IAM_CLIENT_SECRET: 'synthetic-secret', IAM_ORGANIZATION_ID: '2' });
const image = Buffer.from('89504e470d0a1a0a', 'hex');
const json = value => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
const authorization = cfg.authorizeUrl + '?' + new URLSearchParams({ client_id: cfg.clientId, redirect_uri: cfg.callback,
  response_type: 'code', state: 'synthetic-state', code_challenge: 'synthetic-pkce', code_challenge_method: 'S256' });
function upstream({ redirect = null, serviceState = null, imagePath = 'api/app/qrcode/' + 'a'.repeat(32), type = 'image/png',
  imageBody = image, initActions = [{ code: 'qrcode', id: 'qr-action' }], preNext = null, listening = { status: 2007, responseBody: { contextRaw: 'updated-context' } } } = {}) {
  const calls = [];
  const transport = async (input, options) => {
    const url = new URL(input); calls.push({ url, options });
    if (url.pathname.endsWith('/authorize')) return new Response(null, { status: 302, headers: { location: redirect || '/sso/login?' + url.searchParams } });
    if (url.pathname === '/sso/login') {
      const service = new URL('/sso/oauth2.0/callbackAuthorize?' + url.searchParams, cfg.authorizeUrl);
      if (serviceState) service.searchParams.set('state', serviceState);
      return new Response(null, { status: 302, headers: { location: '/authn/index.html?service=' + encodeURIComponent(service.href) } });
    }
    if (url.pathname.endsWith('/init')) return json({ status: 1000, responseBody: {
      challengeId: 'challenge', contextRaw: 'private-context', actions: initActions } });
    if (url.pathname.endsWith('/preAuth')) return json({ status: 1000, responseBody: {
      contextRaw: 'pre-context', ...(preNext ? { nextActions: preNext } : {}), param: { qrcodeUri: imagePath } } });
    if (url.pathname.endsWith('/listening')) return json(listening);
    if (url.pathname.includes('/qrcode/')) return new Response(imageBody, { headers: { 'content-type': type } });
    throw Error('Unexpected upstream route');
  };
  return { calls, gateway: createIamQrGateway({ transport }) };
}
test('QR uses the original OAuth state/PKCE service and retains private context only server-side', async () => {
  const { calls, gateway } = upstream(), challenge = await gateway.start(cfg, authorization);
  assert.equal(challenge.mime, 'image/png'); assert.equal(challenge.contextRaw, 'pre-context');
  const init = calls.find(call => call.url.pathname.endsWith('/init'));
  const service = new URL(JSON.parse(init.options.body).sp.callbackUrl);
  assert.equal(service.searchParams.get('state'), 'synthetic-state');
  assert.equal(service.searchParams.get('code_challenge'), 'synthetic-pkce');
  assert.match(init.options.headers.Referer, /\/authn\/index.html/);
  assert.deepEqual(JSON.parse(calls.find(call => call.url.pathname.endsWith('/preAuth')).options.body), {
    actionId: 'qr-action', challengeId: 'challenge', contextRaw: 'private-context' });
  assert.equal((await gateway.poll(cfg, challenge)).contextRaw, 'updated-context');
  assert.equal(calls.some(call => String(call.options.body).includes('synthetic-secret')), false);
});
test('QR refuses off-origin redirects, altered service state, arbitrary image URLs, HTML/SVG and missing QR/MFA', async () => {
  for (const change of [{ redirect: 'https://evil.example/' }, { serviceState: 'other' },
    { imagePath: 'https://evil.example/qr' }, { imagePath: '/admin' }, { type: 'image/svg+xml' },
    { imageBody: Buffer.from('<html>not a QR</html>') }, { initActions: [] }, { preNext: [{ code: 'smsauth' }] }]) {
    await assert.rejects(upstream(change).gateway.start(cfg, authorization), /IAM_QR_UNAVAILABLE/);
  }
  const jpeg = await upstream({ type: 'image/jpg', imageBody: Buffer.from('ffd8ff', 'hex') }).gateway.start(cfg, authorization);
  assert.equal(jpeg.mime, 'image/jpeg');
});
test('listening handles expiry, MFA, pending and IAM navigation without minting a MaMage session', async () => {
  const challenge = { page: 'https://iam.example.edu/authn/index.html', challengeId: 'c', contextRaw: 'private' };
  for (const status of [9046, 9045, 9044, 9075, 9074]) {
    assert.equal((await upstream({ listening: { status } }).gateway.poll(cfg, challenge)).phase, 'expired');
  }
  for (const responseBody of [{ nextActions: [{ code: 'smsauth' }], issue: [{ type: 'IAM_TICKET', go: cfg.authorizeUrl }] },
    { account: 'not-a-login' }, { issue: [{ type: 'AUTH_ISSUE', token: 'not-accepted' }] }]) {
    assert.equal((await upstream({ listening: { status: 1000, responseBody } }).gateway.poll(cfg, challenge)).phase, 'fallback');
  }
  const success = go => upstream({ listening: { status: 1000, responseBody: { issue: [{ type: 'IAM_TICKET', go }] } } }).gateway.poll(cfg, challenge);
  assert.equal((await success(cfg.authorizeUrl)).phase, 'ready');
  await assert.rejects(success('https://evil.example/sso/login'), /IAM_QR_UNAVAILABLE/);
  await assert.rejects(success('http://iam.example.edu/sso/login'), /IAM_QR_UNAVAILABLE/);
});
async function serve(run, options = {}) {
  const store = createSharedStore('qr-test', { enabled: false }), calls = [];
  let config = { ...cfg }, result = { phase: 'waiting' }, block = null, inLock = 0;
  const withLock = store.withLock;
  store.withLock = (key, action) => withLock(key, async () => { inLock++; try { return await action(); } finally { inLock--; } });
  const gateway = {
    start: async (configuration, url) => { assert.equal(inLock, 0); calls.push(new URL(url));
      return { challengeId: 'secret-challenge', contextRaw: 'secret-context', image: image.toString('base64'), mime: 'image/png', page: cfg.authorizeUrl }; },
    poll: async () => { assert.equal(inLock, 0, 'poll never holds a DB connection lock'); if (block) await block; return result; },
  };
  const app = express(); app.use('/api/auth/iam', createIamAuthRouter({ config: () => config, store, qrGateway: gateway,
    rate: { take: async () => ({ allowed: true }) }, request: () => { throw Error('Must not exchange an OAuth token yet'); } }));
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  const request = (path, body, cookie = '', origin = cfg.publicOrigin) => fetch(base + '/api/auth/iam' + path, {
    method: body === undefined ? 'GET' : 'POST', redirect: 'manual', headers: { cookie, origin, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const start = async cookie => {
    const response = await request('/qr', { returnTo: '/?projectId=102&upload=1' }, cookie);
    assert.equal(response.status, 200);
    return { ...await response.json(), cookie: response.headers.get('set-cookie').split(';')[0] };
  };
  try { await run({ store, calls, request, start, setResult: value => result = value, setBlock: value => block = value,
    setConfig: value => config = value, ...options }); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
test('routes bind QR to browser, reject CSRF, hide context and keep the existing one-use OAuth flow', () => serve(async ({ request, start, store, calls, setResult }) => {
  assert.equal((await request('/qr', {}, '', 'https://evil.example')).status, 403);
  const qr = await start();
  assert.equal(Object.keys(qr).sort().join(), 'cookie,expiresAt,id,imageUrl');
  const oauth = await store.get(sha256(calls[0].searchParams.get('state')));
  assert.equal(oauth.returnTo, '/?projectId=102&upload=1'); assert.ok(oauth.verifier);
  assert.equal((await request(`/qr/${qr.id}/image`)).status, 401);
  const picture = await request(`/qr/${qr.id}/image`, undefined, qr.cookie);
  assert.equal(picture.headers.get('cache-control'), 'no-store'); assert.equal(picture.headers.get('cross-origin-resource-policy'), 'same-origin');
  assert.deepEqual(Buffer.from(await picture.arrayBuffer()), image);
  assert.equal((await request(`/qr/${qr.id}/status`, {}, qr.cookie, 'https://evil.example')).status, 403);
  assert.deepEqual(await (await request(`/qr/${qr.id}/status`, {}, qr.cookie)).json(), { phase: 'waiting' });
  assert.match((await request(`/qr/${qr.id}/complete`, undefined, qr.cookie)).headers.get('location'), /iam_error/);
  setResult({ phase: 'ready', go: cfg.authorizeUrl });
  const ready = await (await request(`/qr/${qr.id}/status`, {}, qr.cookie)).json();
  assert.equal(ready.completeUrl, `/api/auth/iam/qr/${qr.id}/complete`);
  assert.equal(JSON.stringify(ready).includes('secret'), false);
  assert.match((await request(`/qr/${qr.id}/complete`)).headers.get('location'), /iam_error/);
  assert.equal((await request(`/qr/${qr.id}/complete`, undefined, qr.cookie)).headers.get('location'), cfg.authorizeUrl);
  assert.match((await request(`/qr/${qr.id}/complete`, undefined, qr.cookie)).headers.get('location'), /iam_error/);
  assert.equal((await store.get(sha256(calls[0].searchParams.get('state')))).kind, 'oauth', 'OAuth callback still required');
}));
test('refresh invalidates previous QR and OAuth state; cancellation and configuration changes fail closed', () => serve(async ({ request, start, store, calls, setConfig }) => {
  const first = await start(), second = await start(first.cookie);
  assert.equal((await request(`/qr/${first.id}/status`, {}, first.cookie)).status, 401);
  assert.equal(await store.get(sha256(calls[0].searchParams.get('state'))), undefined);
  assert.equal((await request(`/qr/${second.id}/cancel`, {}, second.cookie)).status, 204);
  assert.equal((await request(`/qr/${second.id}/status`, {}, second.cookie)).status, 401);
  const third = await start(second.cookie); setConfig({ ...cfg, flowKey: 'changed' });
  assert.equal((await request(`/qr/${third.id}/status`, {}, third.cookie)).status, 401);
  setConfig({ ...cfg, qrEnabled: false }); assert.equal((await request('/qr', {})).status, 404);
}));
test('only one upstream poll runs at a time and cancellation wins over a late success', () => serve(async ({ request, start, setBlock, setResult }) => {
  const qr = await start(); let release;
  setBlock(new Promise(resolve => release = resolve)); setResult({ phase: 'ready', go: cfg.authorizeUrl });
  const first = request(`/qr/${qr.id}/status`, {}, qr.cookie);
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.deepEqual(await (await request(`/qr/${qr.id}/status`, {}, qr.cookie)).json(), { phase: 'waiting' });
  assert.equal((await request(`/qr/${qr.id}/cancel`, {}, qr.cookie)).status, 204);
  release(); assert.equal((await first).status, 401);
}));
test('expired challenges cannot read an image, poll or complete a login', () => serve(async ({ request, start, store }) => {
  const qr = await start(), key = 'qr:' + sha256(qr.id);
  await store.set(key, { ...await store.get(key), expiresAt: Date.now() - 1 });
  assert.equal((await request(`/qr/${qr.id}/image`, undefined, qr.cookie)).status, 401);
  assert.equal((await request(`/qr/${qr.id}/status`, {}, qr.cookie)).status, 401);
  assert.match((await request(`/qr/${qr.id}/complete`, undefined, qr.cookie)).headers.get('location'), /iam_error/);
}));
