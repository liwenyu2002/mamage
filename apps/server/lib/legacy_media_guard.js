function createLegacyMediaGuard({ normalizeKey, isSafeKey, authorizeMediaKey }) {
  return async (req, res, next) => {
    const key = normalizeKey(`/uploads${req.path}`);
    if (!key || !isSafeKey(key)) return res.status(400).end();
    try {
      if (!await authorizeMediaKey(key, req.query?.ma)) return res.status(403).end();
      res.set('Cache-Control', 'private, no-store');
      res.set('X-Content-Type-Options', 'nosniff');
      next();
    } catch { res.status(503).end(); }
  };
}

module.exports = { createLegacyMediaGuard };
