const express = require('express');
const crypto = require('node:crypto');
const { iamConfig } = require('../lib/iam_config');
const { error, sha256, same, identifier } = require('../lib/iam_protocol');
const { createSharedStore } = require('../lib/shared_runtime_state');
const { createIamDirectory } = require('../lib/iam_directory');
const { createRateLimit } = require('../lib/shared_rate_limit');
const { assertSession, issueToken } = require('../lib/iam_account_guard');
const { mountIamQr } = require('./iam_qr');
const COOKIE = '__Host-mamage_iam';
const cookieOptions = { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 10 * 60000 };
const random = () => crypto.randomBytes(32).toString('base64url');
const cookieName = cfg => cfg.insecureHttp ? 'mamage_iam_lan' : COOKIE;
const optionsFor = cfg => ({ ...cookieOptions, secure: !cfg.insecureHttp });
function browserCookie(req, cfg) {
  const name = cookieName(cfg);
  const values = String(req.headers.cookie || '').split(';').map(x => x.trim()).filter(x => x.startsWith(name + '='));
  const value = values.length === 1 ? values[0].slice(name.length + 1) : '';
  return /^[\w-]{43}$/.test(value) ? value : null;
}
function returnPath(value, origin) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.includes('\\') || value.length > 2000) return '/';
  try {
    const url = new URL(value, origin);
    return url.origin === origin && !url.pathname.startsWith('/api/') ? url.pathname + url.search : '/';
  } catch { return '/'; }
}
function profileId(profile, path) {
  let value = profile;
  for (const key of path.split('.')) {
    if (!value || typeof value !== 'object' || !Object.hasOwn(value, key)) throw error('IAM_PROFILE_ID_MISSING');
    value = value[key];
  }
  return identifier(value);
}
async function fetchJson(url, options = {}) {
  const response = await fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(10000) });
  if (!response.ok) { await response.body?.cancel(); throw error('IAM_UPSTREAM_UNAVAILABLE', 502); }
  let size = 0; const chunks = [];
  for await (const chunk of response.body) {
    size += chunk.length; if (size > 256 * 1024) throw error('IAM_INVALID_RESPONSE', 502);
    chunks.push(Buffer.from(chunk));
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw error('IAM_INVALID_RESPONSE', 502); }
}
function createIamAuthRouter({ db, config = iamConfig, store = createSharedStore('iam-login'), request = fetchJson,
  rate = createRateLimit('iam-login'), secret = () => require('../config/keys').JWT_SECRET, qrGateway } = {}) {
  const router = express.Router();
  let nextPrune = 0;
  const database = () => db || require('../db').pool;
  router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); res.set('Referrer-Policy', 'no-referrer');
    const cfg = config();
    if (!cfg.loginReady) return res.status(404).json({ error: 'IAM_LOGIN_DISABLED' });
    if (cfg.insecureHttp && req.get('host') !== new URL(cfg.publicOrigin).host) return res.status(403).json({ error: 'IAM_ORIGIN_DENIED' });
    next(); });
  async function createFlow(req, res, cfg, returnTo) {
    if (Date.now() >= nextPrune && store.pruneExpired) { nextPrune = Date.now() + 60000; await store.pruneExpired(); }
    const browser = browserCookie(req, cfg) || random(), state = random(), verifier = random();
    await store.set(sha256(state), { kind: 'oauth', browserHash: sha256(browser), verifier, sourceKey: cfg.sourceKey, flowKey: cfg.flowKey,
      returnTo: returnPath(returnTo, cfg.publicOrigin), expiresAt: Date.now() + 10 * 60000 });
    res.cookie(cookieName(cfg), browser, optionsFor(cfg));
    const url = new URL(cfg.authorizeUrl);
    for (const [key, value] of Object.entries({ client_id: cfg.clientId, redirect_uri: cfg.callback, response_type: 'code', state })) url.searchParams.set(key, value);
    if (cfg.pkce) { url.searchParams.set('code_challenge', crypto.createHash('sha256').update(verifier).digest('base64url')); url.searchParams.set('code_challenge_method', 'S256'); }
    return { url: url.href, stateKey: sha256(state), browserHash: sha256(browser) };
  }
  router.get('/login', async (req, res) => {
    try {
      const cfg = config(), limit = await rate.take(req.socket.remoteAddress, 30, 60000);
      if (!limit.allowed) return res.status(429).set('Retry-After', String(limit.retryAfterSec)).json({ error: 'IAM_LOGIN_BUSY' });
      res.redirect((await createFlow(req, res, cfg, req.query.returnTo)).url);
    } catch { res.status(503).json({ error: 'IAM_LOGIN_UNAVAILABLE' }); }
  });
  mountIamQr(router, { config, store, rate, createFlow, browserCookie, gateway: qrGateway });
  async function consume(key, req, cfg, kind) {
    if (typeof key !== 'string' || !/^[\w-]{43}$/.test(key)) throw error('IAM_LOGIN_EXPIRED', 401);
    return store.withLock(sha256(key), async () => {
      const item = await store.get(sha256(key)), browser = browserCookie(req, cfg);
      if (!item || item.kind !== kind || item.flowKey !== cfg.flowKey || item.expiresAt < Date.now() || item.sourceKey !== cfg.sourceKey
        || !browser || !same(item.browserHash, sha256(browser))) throw error('IAM_LOGIN_EXPIRED', 401);
      await store.delete(sha256(key)); return item;
    });
  }
  router.get('/callback', async (req, res) => {
    try {
      const cfg = config();
      if (typeof req.query.code !== 'string' || !req.query.code || req.query.code.length > 2000) throw error('IAM_INVALID_CODE');
      const state = await consume(req.query.state, req, cfg, 'oauth');
      const params = new URLSearchParams({ grant_type: 'authorization_code', client_id: cfg.clientId,
        client_secret: cfg.clientSecret, redirect_uri: cfg.callback, code: req.query.code });
      if (cfg.pkce) params.set('code_verifier', state.verifier);
      const token = await request(cfg.tokenUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params.toString() });
      if (typeof token.access_token !== 'string' || !token.access_token || token.access_token.length > 16000) throw error('IAM_INVALID_RESPONSE');
      const url = new URL(cfg.profileUrl); url.searchParams.set('access_token', token.access_token);
      const profile = await request(url.href, { method: 'POST' });
      const directory = createIamDirectory(database());
      const user = cfg.profileLoginMatching
        ? await require('../lib/iam_profile_links').resolveProfile(database(), cfg, profile, profileId(profile, cfg.profileIdPath))
        : await directory.resolveUser(cfg, profileId(profile, cfg.profileIdPath));
      const account = await assertSession(user.id, null, database()), handoff = random();
      await store.set(sha256(handoff), { kind: 'handoff', userId: user.id, version: Number(account.session_version), sourceKey: cfg.sourceKey, flowKey: cfg.flowKey,
        browserHash: state.browserHash, returnTo: state.returnTo, expiresAt: Date.now() + 120000 });
      res.redirect('/login#iam_code=' + handoff);
    } catch (e) {
      const code = /^IAM_/.test(e.code || '') ? e.code : 'IAM_LOGIN_UNAVAILABLE';
      res.redirect('/login#iam_error=' + encodeURIComponent(code));
    }
  });
  router.post('/session', express.json({ limit: '2kb' }), async (req, res) => {
    try {
      const cfg = config();
      if (req.get('origin') !== cfg.publicOrigin || !req.is('application/json')) throw error('IAM_ORIGIN_DENIED', 403);
      const item = await consume(req.body?.code, req, cfg, 'handoff');
      await assertSession(item.userId, { iav: item.version }, database());
      const [[user]] = await database().query('SELECT id, role FROM users WHERE id = ?', [item.userId]);
      if (!user) throw error('IAM_ACCOUNT_NOT_AUTHORIZED', 403);
      const token = await issueToken({ id: user.id, role: user.role }, secret(), database());
      res.clearCookie(cookieName(cfg), optionsFor(cfg)); res.json({ token, returnTo: item.returnTo });
    } catch (e) { res.status(e.status || 503).json({ error: /^IAM_|^ACCOUNT_/.test(e.code || '') ? e.code : 'IAM_LOGIN_UNAVAILABLE' }); }
  });
  router.use((e, req, res, _next) => res.status(400).json({ error: 'IAM_INVALID_REQUEST' }));
  return router;
}
module.exports = createIamAuthRouter();
module.exports.createIamAuthRouter = createIamAuthRouter;
module.exports.returnPath = returnPath;
module.exports.profileId = profileId;
