const crypto = require('node:crypto');
const { createSharedStore } = require('./shared_runtime_state');

function createRateLimit(name) {
  const store = createSharedStore(`rate-${name}`);
  const key = id => crypto.createHmac('sha256', process.env.JWT_SECRET || require('../config/keys').JWT_SECRET)
    .update(String(id || 'unknown')).digest('hex');
  return {
    async take(id, max, windowMs) {
      const idKey = key(id);
      return store.withLock(idKey, async () => {
        const now = Date.now();
        let bucket = await store.get(idKey);
        if (!bucket || bucket.expiresAt <= now) bucket = { count: 0, expiresAt: now + windowMs };
        const allowed = bucket.count < max;
        if (allowed) bucket.count += 1;
        await store.set(idKey, bucket);
        return { allowed, count: bucket.count, retryAfterSec: allowed ? 0 : Math.max(1, Math.ceil((bucket.expiresAt - now) / 1000)) };
      });
    },
    async reset(id) { await store.withLock(key(id), () => store.delete(key(id))); },
  };
}
module.exports = { createRateLimit };
