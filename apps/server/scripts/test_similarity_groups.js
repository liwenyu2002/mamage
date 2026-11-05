const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const file = path.join(__dirname, '../routes/similarity_groups.js');
const localRequire = createRequire(file);
let reads = 0, denied = false;
let rows = [{ id: 1, photo_id: 11, embedding: [1, 0] }, { id: 2, photo_id: 12, embedding: [1, 0] }];
const db = { query: async sql => {
  if (sql.includes('e.embedding')) reads++;
  return [rows.map(row => sql.includes('e.embedding') ? row : { id: row.id, photo_id: row.photo_id })];
} };
const mocks = {
  '../db': { pool: db }, '../config/keys': { JWT_SECRET: 'local-test-only' },
  '../lib/permissions': { requirePermission: () => (_req, _res, next) => next(), hasPermissionForUserId: async () => true },
  '../lib/workspace_access': {
    resolveWorkspace: async () => ({ enabled: true, orgId: 2 }),
    requireProjectAccess: async () => { if (denied) throw Object.assign(Error('denied'), { status: 403 }); return { unit_id: 3 }; },
    sendWorkspaceError: (res, err) => { if (!err.status) return false; res.status(err.status).json({ error: err.message }); return true; },
  },
};
const mod = { exports: {} };
new Function('require', 'module', 'exports', fs.readFileSync(file, 'utf8'))(name => mocks[name] || localRequire(name), mod, mod.exports);
const handler = mod.exports.stack.find(layer => layer.route?.path === '/groups/simple').route.stack.at(-1).handle;
const request = async () => {
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, set() {}, json(body) { this.body = body; return this; } };
  await handler({ query: { projectId: '1' }, user: { id: 5, organization_id: 2 }, get() {} }, res);
  return res;
};
test('reopening unchanged album reuses grouping without reading all embeddings again', async () => {
  assert.deepEqual((await request()).body.groups, [[11, 12]]);
  assert.deepEqual((await request()).body.groups, [[11, 12]]);
  assert.equal(reads, 1, 'unchanged album must not fetch and recompute all vectors again');
});
test('deletion and reanalysis invalidate groups, and revoked access cannot use cache', async () => {
  rows = [rows[0]];
  assert.deepEqual((await request()).body.groups, []);
  rows = [...rows, { id: 3, photo_id: 12, embedding: [0, 1] }];
  assert.deepEqual((await request()).body.groups, []);
  denied = true;
  assert.equal((await request()).statusCode, 403);
});

const { groupCliques, createSimilarityGroupReader } = require('../lib/similarity_group_cache');
const normalize = raw => {
  const vector = typeof raw === 'string' ? JSON.parse(raw) : raw;
  const norm = Math.sqrt(vector.reduce((sum, n) => sum + n * n, 0)) || 1e-12;
  return vector.map(n => n / norm);
};
function legacyGroups(input) {
  const vectors = input.map(row => normalize(row.embedding)), n = input.length;
  const matrix = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    let score = 0;
    for (let k = 0; k < vectors[i].length; k++) score += (vectors[i][k] || 0) * (vectors[j][k] || 0);
    matrix[i][j] = matrix[j][i] = score;
  }
  const groups = [], assigned = new Set();
  for (let i = 0; i < n; i++) {
    if (assigned.has(i)) continue;
    const group = [i]; assigned.add(i);
    for (let j = 0; j < n; j++) if (!assigned.has(j) && group.every(k => matrix[j][k] >= 0.6)) {
      group.push(j); assigned.add(j);
    }
    if (group.length > 1) groups.push(group.map(k => input[k].photo_id));
  }
  return groups;
}
function sample(count, dimensions) {
  let seed = 42;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32 - 0.5; };
  const centers = Array.from({ length: 24 }, () => Array.from({ length: dimensions }, random));
  return Array.from({ length: count }, (_, i) => ({ id: i + 1, photo_id: i + 1,
    embedding: centers[i % centers.length].map(n => n + random() * 0.2) }));
}
test('optimized clique groups equal legacy output, including mixed clusters and threshold edges', async () => {
  for (const input of [sample(160, 64), [{ photo_id: 1, embedding: [1, 0] },
    { photo_id: 2, embedding: [0.6, 0.8] }, { photo_id: 3, embedding: [0, 1] }, { photo_id: 4, embedding: [] }]]) {
    assert.deepEqual(await groupCliques(input, normalize), legacyGroups(input));
  }
});
test('cache coalesces callers, separates scopes, expires and retries failed reads', async () => {
  let clock = 0, fullReads = 0, fail = false;
  const entries = sample(20, 8);
  const database = { query: async (sql, args) => {
    if (!sql.includes('e.embedding')) return [entries.map(({ id, photo_id }) => ({ id, photo_id }))];
    fullReads++;
    if (fail) throw Error('temporary failure');
    return [entries.filter(row => args.at(-1).includes(row.id))];
  } };
  const read = createSimilarityGroupReader(database, normalize, { now: () => clock, ttl: 100 });
  const scope = { projectId: 9, orgId: 1, unitId: 2, scoped: true };
  await Promise.all([read(scope), read(scope), read(scope)]);
  assert.equal(fullReads, 1);
  await read({ ...scope, unitId: 3 }); assert.equal(fullReads, 2);
  clock = 101; fail = true;
  await assert.rejects(read(scope), /temporary failure/);
  fail = false; await read(scope); assert.equal(fullReads, 4);
});
test('large album keeps event loop responsive and warm reads avoid all vectors', async () => {
  const entries = sample(1200, 2048);
  let fullReads = 0, ticks = 0;
  const database = { query: async (sql, args) => {
    if (!sql.includes('e.embedding')) return [entries.map(({ id, photo_id }) => ({ id, photo_id }))];
    fullReads++; return [entries.filter(row => args.at(-1).includes(row.id))];
  } };
  const before = performance.now(), expected = legacyGroups(entries), oldMs = performance.now() - before;
  const read = createSimilarityGroupReader(database, normalize);
  const scope = { projectId: 9, orgId: 1, unitId: 2, scoped: true };
  const timer = setInterval(() => { ticks++; }, 1);
  let coldMs, warmMs;
  try {
    const start = performance.now(); assert.deepEqual(await read(scope), expected); coldMs = performance.now() - start;
    assert(ticks > 0, 'health checks must get event-loop turns while computing');
    const reads = fullReads, warm = performance.now(); assert.deepEqual(await read(scope), expected); warmMs = performance.now() - warm;
    assert.equal(fullReads, reads, 'warm reopen reads IDs only');
  } finally { clearInterval(timer); }
  console.log(JSON.stringify({ fixture: '1200 photos x 2048 dimensions, synthetic', oldMs: Math.round(oldMs),
    coldMs: Math.round(coldMs), warmMs: +warmMs.toFixed(2), eventLoopTurns: ticks, sameGroups: true }));
});
