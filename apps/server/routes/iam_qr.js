const express = require('express');
const crypto = require('node:crypto');
const { sha256, same, error } = require('../lib/iam_protocol');
const { createIamQrGateway, completionUrl } = require('../lib/iam_qr_gateway');
const random = () => crypto.randomBytes(32).toString('base64url');
const keyFor = id => 'qr:' + sha256(id);
const activeKey = hash => 'qr-browser:' + hash;

function mountIamQr(router, { config, store, rate, createFlow, browserCookie, gateway = createIamQrGateway() }) {
  router.use('/qr', (req, res, next) => {
    if (!config().qrEnabled) return res.status(404).json({ error: 'IAM_QR_DISABLED' });
    res.set('Cross-Origin-Resource-Policy', 'same-origin');
    res.set('X-Content-Type-Options', 'nosniff');
    if (req.method === 'POST' && (req.get('origin') !== config().publicOrigin || !req.is('application/json'))) {
      return res.status(403).json({ error: 'IAM_ORIGIN_DENIED' });
    }
    next();
  }, express.json({ limit: '3kb' }));
  async function limited(key, count) {
    if (!(await rate.take(key, count, 60000)).allowed) throw error('IAM_QR_BUSY', 429);
  }
  async function bound(req, cfg) {
    if (!/^[\w-]{43}$/.test(req.params.id || '')) throw error('IAM_QR_EXPIRED', 401);
    const cookie = browserCookie(req, cfg), item = await store.get(keyFor(req.params.id));
    if (!item || !cookie || item.kind !== 'qr' || item.expiresAt <= Date.now() || item.flowKey !== cfg.flowKey
      || item.sourceKey !== cfg.sourceKey || !same(item.browserHash, sha256(cookie))
      || (await store.get(activeKey(item.browserHash)))?.id !== req.params.id) throw error('IAM_QR_EXPIRED', 401);
    return item;
  }
  const safeError = (res, e) => res.status(e.status || 503).json({ error:
    ['IAM_QR_EXPIRED', 'IAM_QR_BUSY'].includes(e.code) ? e.code : 'IAM_QR_UNAVAILABLE' });
  router.post('/qr', async (req, res) => {
    let flow, id;
    try {
      const cfg = config(), browser = browserCookie(req, cfg);
      await limited('qr-start-ip:' + req.socket.remoteAddress, 60);
      if (browser) await limited('qr-start-browser:' + sha256(browser), 10);
      flow = await createFlow(req, res, cfg, req.body?.returnTo); id = random();
      const expiresAt = Date.now() + 120000, active = activeKey(flow.browserHash);
      await store.withLock(active, async () => {
        const old = await store.get(active);
        if (old) {
          const previous = await store.get(keyFor(old.id));
          if (previous) await store.delete(previous.stateKey);
          await store.delete(keyFor(old.id));
        }
        await store.set(active, { id, expiresAt });
      });
      const challenge = await gateway.start(cfg, flow.url);
      await store.withLock(active, async () => {
        if ((await store.get(active))?.id !== id) throw error('IAM_QR_EXPIRED', 401);
        await store.set(keyFor(id), { kind: 'qr', ...challenge, stateKey: flow.stateKey, browserHash: flow.browserHash,
          sourceKey: cfg.sourceKey, flowKey: cfg.flowKey, phase: 'waiting', failures: 0, expiresAt });
      });
      res.json({ id, imageUrl: '/api/auth/iam/qr/' + id + '/image', expiresAt });
    } catch (e) {
      if (flow) await store.delete(flow.stateKey).catch(() => {});
      console.warn('[iam-qr] start failed', /^IAM_QR_/.test(e.code || '') ? e.code : 'upstream-unavailable');
      safeError(res, e);
    }
  });
  router.get('/qr/:id/image', async (req, res) => {
    try {
      const item = await bound(req, config());
      if (item.phase !== 'waiting') throw error('IAM_QR_EXPIRED', 401);
      res.type(item.mime).send(Buffer.from(item.image, 'base64'));
    } catch (e) { safeError(res, e); }
  });
  router.post('/qr/:id/status', async (req, res) => {
    const cfg = config(), key = keyFor(req.params.id), lease = random();
    try {
      let item = await bound(req, cfg);
      await limited('qr-poll:' + item.browserHash, 90);
      // Reserve a short polling lease, then release the DB lock before contacting IAM.
      const acquired = await store.withLock(key, async () => {
        item = await bound(req, cfg);
        if (item.phase !== 'waiting' || item.leaseUntil > Date.now()) return false;
        await store.set(key, { ...item, lease, leaseUntil: Date.now() + 25000 }); return true;
      });
      if (acquired) {
        let update;
        try { update = { ...await gateway.poll(cfg, item), failures: 0 }; }
        catch {
          update = { failures: item.failures + 1, phase: item.failures >= 2 ? 'fallback' : 'waiting' };
        }
        item = await store.withLock(key, async () => {
          const current = await bound(req, cfg);
          if (current.lease !== lease) return current;
          const next = { ...current, ...update, leaseUntil: 0, lease: null };
          if (next.phase !== 'waiting') { delete next.image; delete next.contextRaw; delete next.challengeId; delete next.page; }
          await store.set(key, next); return next;
        });
      }
      const phase = item.phase;
      res.json({ phase, ...(phase === 'ready' ? { completeUrl: '/api/auth/iam/qr/' + req.params.id + '/complete' } : {}) });
    } catch (e) { safeError(res, e); }
  });
  router.get('/qr/:id/complete', async (req, res) => {
    try {
      const cfg = config();
      const go = await store.withLock(keyFor(req.params.id), async () => {
        const item = await bound(req, cfg), oauth = await store.get(item.stateKey);
        if (item.phase !== 'ready' || !oauth || oauth.kind !== 'oauth' || oauth.expiresAt < Date.now()
          || !same(oauth.browserHash, item.browserHash)) throw error('IAM_QR_EXPIRED', 401);
        const target = completionUrl(item.go, cfg);
        await store.delete(keyFor(req.params.id));
        return target;
      });
      res.redirect(go);
    } catch { res.redirect('/login#iam_error=IAM_LOGIN_EXPIRED'); }
  });
  router.post('/qr/:id/cancel', async (req, res) => {
    try {
      await store.withLock(keyFor(req.params.id), async () => {
        const item = await bound(req, config());
        await store.delete(item.stateKey); await store.delete(keyFor(req.params.id));
      });
      res.status(204).end();
    } catch (e) { safeError(res, e); }
  });
}
module.exports = { mountIamQr };
