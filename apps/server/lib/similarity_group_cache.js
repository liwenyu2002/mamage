const { createHash } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const yieldTurn = () => new Promise(resolve => setImmediate(resolve));

// Same greedy clique rule as before, but compare only candidates actually used.
// Yield between small CPU slices so login, uploads and health checks stay responsive.
async function groupCliques(rows, normalize, threshold = 0.6, minSize = 2) {
  const vectors = [], groups = [], assigned = new Uint8Array(rows.length);
  let deadline = performance.now() + 8;
  for (const row of rows) {
    vectors.push(normalize(row.embedding));
    if (performance.now() >= deadline) { await yieldTurn(); deadline = performance.now() + 8; }
  }
  let comparisons = 0;
  const similar = (i, j) => {
    const a = vectors[i], b = vectors[j]; let score = 0;
    for (let k = 0; k < a.length; k++) score += (a[k] || 0) * (b[k] || 0);
    return score >= threshold;
  };
  for (let i = 0; i < rows.length; i++) {
    if (assigned[i]) continue;
    const clique = [i]; assigned[i] = 1;
    for (let j = i + 1; j < rows.length; j++) {
      if (assigned[j]) continue;
      let accepted = true;
      for (const member of clique) {
        const matches = similar(member, j);
        if (++comparisons % 16 === 0 && performance.now() >= deadline) {
          await yieldTurn(); deadline = performance.now() + 8;
        }
        if (!matches) { accepted = false; break; }
      }
      if (accepted) { clique.push(j); assigned[j] = 1; }
    }
    if (clique.length >= minSize) groups.push(clique.map(index => rows[index].photo_id));
  }
  return groups;
}

function createSimilarityGroupReader(db, normalize, { now = Date.now, ttl = 15 * 60 * 1000 } = {}) {
  const cache = new Map(), inFlight = new Map();
  let tail = Promise.resolve(), cachedIds = 0;
  return async function readGroups({ projectId, orgId, unitId, scoped, modelName = 'resnet50' }) {
    const scope = `p.project_id = ? AND p.organization_id <=> ? AND e.model_name = ?${scoped ? ' AND p.unit_id <=> ?' : ''}`;
    const args = [projectId, orgId, modelName, ...(scoped ? [unitId] : [])];
    // saveEmbedding replaces rows (new IDs). This manifest detects additions,
    // deletions, moves and reanalysis without transferring megabytes of vectors.
    const [manifest] = await db.query(`SELECT e.id, p.id AS photo_id FROM ai_image_embeddings e
      JOIN photos p ON p.id = e.photo_id WHERE ${scope} ORDER BY e.id`, args);
    const key = JSON.stringify(args) + ':' + scoped;
    const revision = createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
    const hit = cache.get(key);
    if (hit?.revision === revision && hit.expires > now()) {
      cache.delete(key); cache.set(key, hit); return hit.groups;
    }
    const flightKey = key + ':' + revision;
    if (inFlight.has(flightKey)) return inFlight.get(flightKey);
    if (inFlight.size >= 4) throw Object.assign(Error('SIMILARITY_BUSY'), { status: 503 });
    const pending = tail.then(async () => {
      const rows = [];
      for (let offset = 0; offset < manifest.length; offset += 128) {
        const ids = manifest.slice(offset, offset + 128).map(row => row.id);
        const [part] = await db.query(`SELECT e.id, p.id AS photo_id, e.embedding FROM ai_image_embeddings e
          JOIN photos p ON p.id = e.photo_id WHERE ${scope} AND e.id IN (?) ORDER BY e.id`, [...args, ids]);
        rows.push(...part); await yieldTurn();
      }
      const groups = await groupCliques(rows, normalize);
      cachedIds -= cache.get(key)?.size || 0;
      cache.delete(key);
      const size = groups.reduce((sum, group) => sum + group.length, 0);
      cache.set(key, { revision, groups, size, expires: now() + ttl }); cachedIds += size;
      while (cache.size > 128 || cachedIds > 250000) {
        const oldest = cache.keys().next().value;
        cachedIds -= cache.get(oldest).size; cache.delete(oldest);
      }
      return groups;
    }).finally(() => inFlight.delete(flightKey));
    inFlight.set(flightKey, pending);
    tail = pending.catch(() => {});
    return pending;
  };
}
module.exports = { createSimilarityGroupReader, groupCliques };
