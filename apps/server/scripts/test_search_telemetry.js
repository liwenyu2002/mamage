const assert = require('node:assert/strict');
const { test } = require('node:test');
const { buildSearchEvent, redactSearchText, createSearchTelemetry, searchRequestLogTarget } = require('../lib/search_telemetry');
const { buildSearchTelemetryExport } = require('../lib/search_telemetry_export');

const input = () => ({ authorized: true, userId: 47, orgId: 2, unitId: 7, projectId: 83, q: '穿红衣服的邹欣', smart: true,
  durationMs: 57.9, result: { total: 2, list: [{ url: 'https://secret.test/?token=private', vector: [1, 2] }],
    search: { mode: 'ai', aiUsed: true, cached: true, relaxed: false,
      plan: { people: ['邹欣'], mustTerms: ['红衣'], apiKey: 'private', vectors: [1, 2] } } } });

test('authentication query parameters are omitted from request logs', () => {
  for (const path of ['/api/auth/iam/callback', '/api/auth/iam/login', '/api/auth/dingtalk/callback']) {
    assert.equal(searchRequestLogTarget({ path, url: path + '?code=private&state=private&access_token=private' }), path);
  }
});

test('only authorized, authenticated, non-demo first-page searches are eligible', () => {
  assert.ok(buildSearchEvent(input()));
  for (const patch of [{ userId: null }, { authorized: false }, { demo: true }, { page: 2 }, { q: '' }, { q: {} }, { orgId: null }, { orgId: 2.5 }]) {
    assert.equal(buildSearchEvent({ ...input(), ...patch }), null);
  }
});

test('events whitelist useful search fields without persisting identity, media or vectors', () => {
  const event = buildSearchEvent({ ...input(), ip: '10.0.0.1', authorization: 'Bearer private' }, { now: Date.UTC(2026, 9, 13), retentionDays: 30 });
  assert.equal(event.query, '穿红衣服的邹欣');
  assert.equal(event.resultCount, 2);
  assert.equal(event.durationMs, 57);
  assert.equal(event.expiresAt, '2026-11-12 00:00:00.000');
  assert.deepEqual(event.plan, { people: ['邹欣'], mustTerms: ['红衣'] });
  const json = JSON.stringify(event);
  for (const value of ['userId', 'authorization', '10.0.0.1', 'secret.test', 'vector', 'apiKey', 'private']) assert.ok(!json.includes(value));
});

test('common credentials, media URLs, email and phone numbers are redacted in query and plan', () => {
  const value = '王老师 https://store.test/photo.jpg?ma=SECRET sk-abcdefghijklmnop Bearer abcdefg password=secret abc@bza.edu.cn 13800138000\n';
  const clean = redactSearchText(value);
  assert.ok(clean.includes('王老师'));
  for (const text of ['SECRET', 'abcdefghijklmnop', 'abcdefg', 'secret', 'abc@', '13800138000', '\n']) assert.ok(!clean.includes(text));
  const event = buildSearchEvent({ ...input(), result: { total: 0, search: { originalPlan: { mustTerms: [value], url: value } } } });
  assert.ok(!JSON.stringify(event).includes('store.test'));
  assert.equal(redactSearchText('中'.repeat(500)).length, 160);
});

test('visual progress is logged as bounded metrics, never as accuracy or raw face evidence', () => {
  const value = input();
  value.result.search.visual = {source:'local-person-vision',candidateCount:12,checked:3,pending:8,uncertain:1,
    coverageComplete:false,photoIds:[999],observation:'private face evidence'};
  const event = buildSearchEvent(value, { now: Date.UTC(2026, 9, 29, 0, 0, 0, 999) });
  assert.deepEqual(event.plan.visual,{source:'local-person-vision',coverageComplete:false,unavailable:false,
    candidateCount:12,checked:3,pending:8,uncertain:1});
  assert.equal(Object.hasOwn(event.plan.visual, 'photoIds'), false);
  assert.ok(event.createdAt.endsWith('.999'), 'unrelated timestamps are not photo evidence');
  assert.ok(!JSON.stringify(event).includes('private face evidence'));
});

test('recording does not await the database and batches retain each event scope', async () => {
  const writes = [];
  const telemetry = createSearchTelemetry({ autoFlush: false, pool: { query: async (...args) => { writes.push(args); } }, env: {} });
  const id = telemetry.record(input());
  telemetry.record({ ...input(), orgId: 9, unitId: 10 });
  assert.equal(typeof id, 'string');
  assert.equal(writes.length, 0);
  await telemetry.flush();
  assert.equal(writes.length, 1);
  const [query, params] = writes[0];
  assert.equal(query.timeout, 2000);
  assert.equal((query.sql.match(/\?/g) || []).length, params.length);
  assert.equal(params[1], 2);
  assert.equal(params[19], 9);
  assert.equal(telemetry.getStats().stored, 2);
  await telemetry.stop();
});

test('bounded queues and disabled collection do not grow without limit', async () => {
  const pool = { query: async () => [] };
  const telemetry = createSearchTelemetry({ autoFlush: false, pool, env: { SEARCH_TELEMETRY_MAX_QUEUE: '2' } });
  telemetry.record(input()); telemetry.record(input());
  assert.equal(telemetry.record(input()), null);
  assert.equal(telemetry.getStats().queued, 2);
  assert.equal(telemetry.getStats().dropped, 1);
  await telemetry.stop();
  const disabled = createSearchTelemetry({ pool, env: { SEARCH_TELEMETRY_ENABLED: '0' } });
  assert.equal(disabled.record(input()), null);
  await disabled.stop();
});

test('failed writes back off and never dump SQL, credentials or search terms to logs', async () => {
  const warnings = [];
  const telemetry = createSearchTelemetry({ autoFlush: false, now: () => 1000, env: {}, logger: { warn: value => warnings.push(value) },
    pool: { query: async () => { throw Object.assign(Error('secret SQL query and credentials'), { code: 'ER_NO_SUCH_TABLE' }); } } });
  telemetry.record(input());
  await telemetry.flush();
  assert.equal(telemetry.record(input()), null);
  assert.equal(telemetry.getStats().writeFailures, 1);
  assert.equal(warnings.length, 1);
  assert.ok(warnings[0].includes('ER_NO_SUCH_TABLE'));
  assert.ok(!warnings[0].includes('secret'));
  assert.ok(!warnings[0].includes('邹欣'));
  await telemetry.stop();
});

test('expired events are deleted in indexed, bounded batches without loading raw queries', async () => {
  const queries = [];
  const telemetry = createSearchTelemetry({ autoFlush: false, env: {}, pool: { query: async query => {
    queries.push(query); return [{ affectedRows: queries.length === 1 ? 1000 : 7 }];
  } } });
  assert.deepEqual(await telemetry.pruneExpired(), { deleted: 1007, more: false });
  assert.ok(queries.every(q => q.sql.includes('expires_at <= UTC_TIMESTAMP(3)') && q.sql.includes('LIMIT 1000')));
  await telemetry.stop();
});

test('exports require explicit organization scope, bound time windows and exclude expired records', () => {
  assert.throws(() => buildSearchTelemetryExport({}), /organizationId/);
  assert.throws(() => buildSearchTelemetryExport({ organizationId: 2, days: 181 }), /days/);
  assert.throws(() => buildSearchTelemetryExport({ organizationId: '2 OR 1=1' }), /organizationId/);
  const query = buildSearchTelemetryExport({ organizationId: 2, unitId: 7, raw: true });
  assert.ok(query.sql.includes('organization_id = ?'));
  assert.ok(query.sql.includes('unit_id = ?'));
  assert.ok(query.sql.includes('expires_at > UTC_TIMESTAMP(3)'));
  assert.deepEqual(query.params, [2, 7, 7, 100]);
  assert.equal((query.sql.match(/\?/g) || []).length, query.params.length);
  const aggregate = buildSearchTelemetryExport({ organizationId: 2 });
  assert.ok(aggregate.sql.includes('GROUP BY query_text'));
  assert.ok(!aggregate.sql.includes('user_id'));
});

test('ordinary application access logs do not retain raw search query strings', () => {
  for (const path of ['/api/photos/search', '/api/photos/search/', '/API/PHOTOS/SEARCH']) {
    assert.equal(searchRequestLogTarget({ path, url: path + '?q=password=private' }), path);
  }
  assert.equal(searchRequestLogTarget({ path: '/api/health', url: '/api/health' }), '/api/health');
});
