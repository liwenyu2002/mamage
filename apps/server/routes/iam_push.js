const express = require('express');
const { iamConfig } = require('../lib/iam_config');
const { readPush } = require('../lib/iam_protocol');
const { pushSourceAllowed } = require('../lib/iam_network');
const { createIamDirectory } = require('../lib/iam_directory');

function createIamPushRouter({ db, config = iamConfig } = {}) {
  const router = express.Router({ caseSensitive: true, strict: true });
  router.use((req, res, next) => {
    const cfg = config();
    res.set('Cache-Control', 'no-store');
    if (!cfg.pushReady) return res.status(404).json({ error: 'IAM_PUSH_DISABLED' });
    if (!pushSourceAllowed(req, cfg)) return res.status(403).json({ error: 'IAM_SOURCE_DENIED' });
    if (req.method !== 'POST' || !req.is('application/x-www-form-urlencoded') || Object.keys(req.query).length) {
      return res.status(400).json({ error: 'IAM_FORM_REQUIRED' });
    }
    req.iamConfig = cfg; next();
  });
  router.use(express.urlencoded({ extended: false, limit: '1500kb', parameterLimit: 5 }));
  for (const [path, type] of [['departments', '1'], ['accounts', '2']]) router.post('/' + path, async (req, res) => {
    try {
      if (req.body.dataType !== type) return res.status(400).json({ error: 'IAM_WRONG_ENDPOINT' });
      const push = readPush(req.iamConfig, req.body, `/api/integrations/iam/${path}`);
      const directory = createIamDirectory(db || require('../db').pool);
      res.json(await directory.applyPush(req.iamConfig, type, push));
    } catch (e) {
      const code = /^IAM_/.test(e.code || '') ? e.code : 'IAM_SYNC_UNAVAILABLE';
      res.status(e.status || 503).json({ error: code });
    }
  });
  router.use((e, req, res, _next) => res.status(e.status === 413 ? 413 : 400).json({ error: 'IAM_INVALID_FORM' }));
  return router;
}
module.exports = createIamPushRouter();
module.exports.createIamPushRouter = createIamPushRouter;
