const express = require('express');
const crypto = require('node:crypto');
const { oidcConfig } = require('../lib/oidc_config');
const { createOidcClient, error } = require('../lib/oidc_client');
const { createSharedStore } = require('../lib/shared_runtime_state');
const { createRateLimit } = require('../lib/shared_rate_limit');
const { assertSession, issueToken } = require('../lib/iam_account_guard');
const { returnPath } = require('./auth_iam');
const COOKIE = '__Host-mamage_oidc';
const cookieOptions = { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 10 * 60000 };
const random = () => crypto.randomBytes(32).toString('base64url');
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const cookieName = cfg => cfg.insecureHttp ? 'mamage_oidc_lan' : COOKIE;
const optionsFor = cfg => ({ ...cookieOptions, secure: !cfg.insecureHttp });
function browserCookie(req, cfg) {
  const name = cookieName(cfg);
  const values = String(req.headers.cookie || '').split(';').map(x => x.trim()).filter(x => x.startsWith(name + '='));
  const value = values.length === 1 ? values[0].slice(name.length + 1) : '';
  return /^[\w-]{43}$/.test(value) ? value : null;
}

// OIDC 标准授权码 + PKCE 登录。识别用户仍交给 iam_profile_links.resolveProfile：
// 同一账号可同时绑定芯盾与 Keycloak（source_key 由 issuer+client_id 派生），权限模型不变。
function createOidcAuthRouter({ db, config = oidcConfig, store = createSharedStore('oidc-login'), client = createOidcClient(),
  rate = createRateLimit('oidc-login'), secret = () => require('../config/keys').JWT_SECRET } = {}) {
  const router = express.Router();
  let nextPrune = 0;
  const database = () => db || require('../db').pool;
  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store'); res.set('Referrer-Policy', 'no-referrer');
    const cfg = config();
    if (!cfg.loginReady) return res.status(404).json({ error: 'OIDC_LOGIN_DISABLED' });
    if (cfg.insecureHttp && req.get('host') !== new URL(cfg.publicOrigin).host) return res.status(403).json({ error: 'OIDC_ORIGIN_DENIED' });
    next();
  });
  async function createFlow(req, res, cfg, returnTo) {
    if (Date.now() >= nextPrune && store.pruneExpired) { nextPrune = Date.now() + 60000; await store.pruneExpired(); }
    const browser = browserCookie(req, cfg) || random(), state = random(), verifier = random(), nonce = random();
    await store.set(sha256(state), { kind: 'oauth', browserHash: sha256(browser), verifier, nonce,
      sourceKey: cfg.sourceKey, flowKey: cfg.flowKey, returnTo: returnPath(returnTo, cfg.publicOrigin), expiresAt: Date.now() + 10 * 60000 });
    res.cookie(cookieName(cfg), browser, optionsFor(cfg));
    const document = await client.discovery(cfg);
    const url = new URL(document.authorization_endpoint);
    for (const [key, value] of Object.entries({ client_id: cfg.clientId, redirect_uri: cfg.callback, response_type: 'code',
      scope: cfg.scopesValue, state, nonce,
      code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' })) url.searchParams.set(key, value);
    return { url: url.href, stateKey: sha256(state), browserHash: sha256(browser) };
  }
  router.get('/login', async (req, res) => {
    try {
      const cfg = config(), limit = await rate.take(req.socket.remoteAddress, 30, 60000);
      if (!limit.allowed) return res.status(429).set('Retry-After', String(limit.retryAfterSec)).json({ error: 'OIDC_LOGIN_BUSY' });
      res.redirect((await createFlow(req, res, cfg, req.query.returnTo)).url);
    } catch (e) {
      console.warn('[oidc.login]', e.code || 'OIDC_LOGIN_UNAVAILABLE');
      res.status(503).json({ error: 'OIDC_LOGIN_UNAVAILABLE' });
    }
  });
  async function consume(key, req, cfg, kind) {
    if (typeof key !== 'string' || !/^[\w-]{43}$/.test(key)) throw error('OIDC_LOGIN_EXPIRED', 401);
    return store.withLock(sha256(key), async () => {
      const item = await store.get(sha256(key)), browser = browserCookie(req, cfg);
      if (!item || item.kind !== kind || item.flowKey !== cfg.flowKey || item.expiresAt < Date.now() || item.sourceKey !== cfg.sourceKey
        || !browser || item.browserHash !== sha256(browser)) throw error('OIDC_LOGIN_EXPIRED', 401);
      await store.delete(sha256(key)); return item;
    });
  }
  router.get('/callback', async (req, res) => {
    try {
      const cfg = config();
      if (typeof req.query.code !== 'string' || !req.query.code || req.query.code.length > 2000) throw error('OIDC_INVALID_CODE');
      const state = await consume(req.query.state, req, cfg, 'oauth');
      const document = await client.discovery(cfg);
      const token = await client.exchangeCode({ cfg, document, code: req.query.code, codeVerifier: state.verifier });
      const claims = await client.verifyIdToken({ token: token.id_token, cfg, document, nonce: state.nonce });
      // userinfo 只是资料补充；身份主体必须以已验签 id_token 的 sub 为准，两者不一致直接拒绝。
      const info = await client.userinfo({ document, accessToken: token.access_token, timeoutMs: cfg.timeoutMs });
      if (info && info.sub != null && info.sub !== claims.sub) throw error('OIDC_SUBJECT_MISMATCH', 401);
      const profile = { ...claims, ...(info && typeof info === 'object' ? info : {}) };
      let user;
      if (cfg.profileLoginMatching) {
        user = await require('../lib/iam_profile_links').resolveProfile(database(), cfg, profile, claims.sub);
      } else {
        // 关闭资料匹配时只放行已绑定身份，避免新 IdP 仅凭邮箱/学工号 claim 关联（甚至接管）存量账号。
        const [[bound]] = await database().query(
          'SELECT user_id FROM iam_login_identities WHERE source_key = ? AND subject_id = ?', [cfg.sourceKey, claims.sub]);
        if (!bound) throw error('IAM_ACCOUNT_LINK_REQUIRED', 403);
        const [[linked]] = await database().query('SELECT id, role, organization_id FROM users WHERE id = ?', [bound.user_id]);
        if (!linked || Number(linked.organization_id) !== cfg.orgId) throw error('IAM_ACCOUNT_LINK_INVALID', 403);
        user = linked;
      }
      const account = await assertSession(user.id, null, database()), handoff = random();
      await store.set(sha256(handoff), { kind: 'handoff', userId: user.id, version: Number(account.session_version),
        sourceKey: cfg.sourceKey, flowKey: cfg.flowKey, browserHash: state.browserHash,
        returnTo: state.returnTo, expiresAt: Date.now() + 120000 });
      res.redirect('/login#oidc_code=' + handoff);
    } catch (e) {
      const code = /^(?:OIDC|IAM|ACCOUNT)_/.test(e.code || '') ? e.code : 'OIDC_LOGIN_UNAVAILABLE';
      console.warn('[oidc.callback]', code);
      res.redirect('/login#oidc_error=' + encodeURIComponent(code));
    }
  });
  router.post('/session', express.json({ limit: '2kb' }), async (req, res) => {
    try {
      const cfg = config();
      if (req.get('origin') !== cfg.publicOrigin || !req.is('application/json')) throw error('OIDC_ORIGIN_DENIED', 403);
      const item = await consume(req.body?.code, req, cfg, 'handoff');
      await assertSession(item.userId, { iav: item.version }, database());
      const [[user]] = await database().query('SELECT id, role FROM users WHERE id = ?', [item.userId]);
      if (!user) throw error('OIDC_ACCOUNT_NOT_AUTHORIZED', 403);
      const token = await issueToken({ id: user.id, role: user.role }, secret(), database());
      res.clearCookie(cookieName(cfg), optionsFor(cfg)); res.json({ token, returnTo: item.returnTo });
    } catch (e) { res.status(e.status || 503).json({ error: /^(?:OIDC|IAM|ACCOUNT)_/.test(e.code || '') ? e.code : 'OIDC_LOGIN_UNAVAILABLE' }); }
  });
  // 单点退出：只跳转 IdP 的 end_session（带不了 id_token_hint，不宣称已完成 RP-Initiated Logout）。
  router.get('/logout', async (req, res) => {
    try {
      const cfg = config();
      if (!cfg.loginReady) return res.status(404).json({ error: 'OIDC_LOGIN_DISABLED' });
      const document = await client.discovery(cfg);
      const target = new URL(document.end_session_endpoint || cfg.publicOrigin);
      if (document.end_session_endpoint) target.searchParams.set('post_logout_redirect_uri', cfg.publicOrigin + '/login');
      res.redirect(target.href);
    } catch { res.redirect('/'); }
  });
  router.use((e, req, res, _next) => res.status(400).json({ error: 'OIDC_INVALID_REQUEST' }));
  return router;
}
module.exports = createOidcAuthRouter();
module.exports.createOidcAuthRouter = createOidcAuthRouter;
