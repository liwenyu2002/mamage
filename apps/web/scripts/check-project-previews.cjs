const assert = require('node:assert/strict');
const babel = require('@babel/core');
const code = babel.transformFileSync(require('node:path').join(__dirname, '../src/services/projectPreviewService.js'), { presets: [require.resolve('@babel/preset-env')] }).code;
let token = 'test-a', active = 0, peak = 0, fail = false, missingEndpoint = false;
const calls = [], mod = { exports: {} };
new Function('require', 'module', 'exports', code)(name => name === './authService' ? { getToken: () => token } : {
  request: async (path, options) => {
    calls.push({ path, options }); peak = Math.max(peak, ++active);
    await new Promise(resolve => setTimeout(resolve, 5)); active--;
    if (fail) throw new Error('test failure');
    if (missingEndpoint && path.endsWith('/previews')) { const error = new Error('not upgraded'); error.status = 404; throw error; }
    return { list: [{ id: calls.length, thumbUrl: '/test.jpg' }] };
  },
}, mod, mod.exports);
const load = mod.exports.fetchProjectPreviews;
(async () => {
  const scope = { organizationId: 2, unitId: 10 };
  const a = load(1, { scope, revision: 'v1' }), b = load(1, { scope, revision: 'v1' });
  assert.equal(a, b); await a; assert.equal(calls.length, 1);
  assert.equal(calls[0].options.headers['x-mamage-unit-id'], '10');
  await load(1, { scope, revision: 'v1' }); assert.equal(calls.length, 1);
  await load(1, { scope, revision: 'v2' }); assert.equal(calls.length, 2);
  await load(1, { scope: { ...scope, unitId: 11 }, revision: 'v2' }); assert.equal(calls.length, 3);
  await Promise.all(Array.from({ length: 12 }, (_, i) => load(100 + i)));
  assert.equal(peak, 3);
  token = 'test-b'; await load(1, { scope, revision: 'v1' }); assert.equal(calls.length, 16);
  fail = true; await assert.rejects(load(999)); fail = false; await load(999);
  assert.equal(calls.length, 18);
  missingEndpoint = true; await load(1000, { scope });
  assert.equal(calls.at(-1).path, '/api/photos');
  assert.equal(mod.exports.PROJECT_PREVIEW_LIMIT, 20);
  assert.equal(calls.at(-1).options.data.limit, 21);
  assert.equal(calls.at(-1).options.headers['x-mamage-unit-id'], '10');
  console.log('PASS: preview request coalescing, revision/auth/workspace isolation, concurrency=3, caching, retry and old-backend fallback');
})().catch(error => { console.error(error); process.exitCode = 1; });
