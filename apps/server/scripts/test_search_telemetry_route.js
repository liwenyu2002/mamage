const assert = require('node:assert/strict');
const express = require('express');
const { buildSearchEvent } = require('../lib/search_telemetry');
const events = [];
let allowed = true;
let projectAllowed = true;
let failing = false;
const searchCalls = [];
let streamGate = null;
let liveSharedAlbums = [];
const mock = (name, exports) => {
  const id = require.resolve(name);
  require.cache[id] = { id, filename: id, loaded: true, exports };
};
mock('../db', { pool: { query: async sql => {
  if (sql.includes('face_search_grants')) return [[{ granted: 1 }]];
  if (sql.includes('album_desktop_workspaces')) return [[{ state: { groups: [
    { id: 'parent', name: '活动', projectIds: [83] }, { id: 'child', parentId: 'parent', projectIds: [84] },
    { id: 'empty', projectIds: [] },
  ] } }]];
  if (sql.includes('SELECT pr.id FROM projects pr')) return [[{ id: 83 }, { id: 84 }]];
  throw Error('Unexpected DB query');
} }, buildUploadUrl: value => value, buildInternalMediaUrl: value => value });
mock('../config/keys', { JWT_SECRET: 'isolated-search-telemetry-test' });
mock('../lib/cos_storage', { isConfigured: () => false });
mock('../lib/media_access', { buildMediaUrl: value => value });
mock('../lib/shared_albums', { listSharedAlbums: async () => liveSharedAlbums });
mock('../lib/permissions', {
  requirePermission: () => (_req, _res, next) => next(), requireAdmin: (_req, _res, next) => next(),
  hasPermissionForUserId: async () => allowed,
});
mock('../lib/workspace_access', {
  ...require('../lib/workspace_access'),
  resolveWorkspace: async () => ({ enabled: true, userId: 47, orgId: 2, unitId: 7 }),
  requireProjectAccess: async () => {
    if (!projectAllowed) throw Object.assign(Error('Not found'), { status: 404 });
    return { unit_id: 9 };
  },
  sendWorkspaceError: (res, error) => {
    if (!error.status) return false;
    res.status(error.status).json({ error: 'NOT_FOUND' }); return true;
  },
});
mock('../lib/photo_search', { searchPhotos: async options => {
  searchCalls.push(options);
  if (options.onProgress) {
    await options.onProgress({ type: 'results', data: { list: [{ id: 101, title: '已先返回' }], total: null } });
    if (streamGate) await Promise.race([streamGate, new Promise((_, reject) => {
      options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
    })]);
    options.signal.throwIfAborted();
    return { total: 1, list: [{ id: 101 }], search: { mode: 'enhanced' } };
  }
  if (failing) throw Object.assign(Error('secret SQL with user query'), { code: 'ETIMEDOUT' });
  return { total: 2, list: [], search: { mode: 'ai', aiUsed: true, plan: { people: ['邹欣'] } } };
} });
mock('../lib/search_telemetry', { recordSearchTelemetry: input => {
  const event = buildSearchEvent(input);
  if (event) events.push(event);
} });
const app = express();
app.use((req, _res, next) => {
  if (req.get('x-test-auth') === '1') req.user = { id: 47, organization_id: 2 };
  next();
});
app.use('/api/photos', require('../routes/photos'));
const server = app.listen(0, '127.0.0.1', async () => {
  try {
    const root = `http://127.0.0.1:${server.address().port}/api/photos/search`;
    const request = (params = {}, auth = true) => fetch(root + '?' + new URLSearchParams({ q: '穿红衣服的邹欣', ...params }), {
      headers: auth ? { 'x-test-auth': '1' } : {},
    });
    assert.equal((await request()).status, 200);
    assert.equal(events.length, 1);
    assert.equal(events[0].organizationId, 2);
    assert.equal(events[0].unitId, 7);
    assert.equal(events[0].resultCount, 2);
    await request({ page: '2' });
    await request({ demo: '1' });
    assert.equal((await request({}, false)).status, 401);
    assert.equal(events.length, 1, 'pagination, demo and anonymous traffic are excluded');
    allowed = false;
    assert.equal((await request()).status, 403);
    allowed = true; projectAllowed = false;
    assert.equal((await request({ projectId: '83' })).status, 404);
    assert.equal(events.length, 1, 'denied search requests never enter telemetry');
    projectAllowed = true;
    for (const params of [{ folderId: 'missing' }, { folderId: '../parent' }, { folderId: '' },
      { folderId: 'parent', projectId: '83' }, { projectId: '83bad' }]) {
      const calls = searchCalls.length;
      assert.ok([400, 404].includes((await request(params)).status));
      assert.equal(searchCalls.length, calls, 'invalid scope must not run a global search');
    }
    await request({ folderId: 'parent', smart: '1', unitId: '999', projectIds: '999', sharedProjectIds: '999' });
    assert.deepEqual(searchCalls.at(-1).projectIds, [83, 84]);
    assert.equal(searchCalls.at(-1).scope.id, 'parent');
    assert.equal(searchCalls.at(-1).enableAi, true);
    assert.equal(searchCalls.at(-1).sharedProjectIds, undefined, 'client-supplied shared IDs cannot widen searches');
    liveSharedAlbums = [{ id: 84 }, { id: 999 }];
    await request({ folderId: 'parent', sharedProjectIds: '999' });
    assert.deepEqual(searchCalls.at(-1).sharedProjectIds, [84], 'only current grants for stored folder entries are forwarded');
    await request({ sharedProjectIds: '999', scope: 'workspace' });
    assert.deepEqual(searchCalls.at(-1).sharedProjectIds, [84], 'homepage shares are resolved from stored folders and current grants, not request IDs');
    assert.deepEqual(searchCalls.at(-1).scope, { type: 'workspace' });
    assert.equal(searchCalls.at(-1).projectIds, undefined, 'own-unit media must not be limited to folder contents');
    liveSharedAlbums = [];
    await request({ sharedProjectIds: '84', scope: 'workspace' });
    assert.equal(searchCalls.at(-1).sharedProjectIds, undefined, 'revocation immediately removes workspace search access');
    assert.equal(searchCalls.at(-1).scope, undefined);
    await request({ folderId: 'empty', stream: '1' });
    assert.deepEqual(searchCalls.at(-1).projectIds, []);
    events.splice(1);
    await request({ projectId: '83', organizationId: '999', unitId: '999' });
    assert.equal(events[1].organizationId, 2);
    assert.equal(events[1].unitId, 9, 'accessible project scope, not client-supplied scope, is recorded');
    failing = true;
    assert.equal((await request()).status, 500);
    assert.equal(events[2].errorCode, 'SEARCH_TIMEOUT');
    assert.equal(events[2].resultCount, null);
    assert.ok(!JSON.stringify(events[2]).includes('secret SQL'));
    failing = false;
    assert.equal((await request({ related: '1' })).status, 200);
    assert.equal(searchCalls.at(-1).related, true);
    assert.equal((await request({ related: 'true' })).status, 200);
    assert.equal(searchCalls.at(-1).related, false, 'related results require the explicit API flag');
    const denied = await request({ stream: '1' }, false);
    assert.equal(denied.status, 401);
    assert.ok(denied.headers.get('content-type').includes('application/json'), 'authorization runs before stream headers');
    let release;
    streamGate = new Promise(resolve => { release = resolve; });
    const beforeEvents = events.length;
    const streamed = await request({ stream: '1' });
    assert.ok(streamed.headers.get('content-type').includes('application/x-ndjson'));
    assert.equal(streamed.headers.get('x-accel-buffering'), 'no');
    const reader = streamed.body.getReader();
    const decoder = new TextDecoder();
    let frames = '';
    const deadline = AbortSignal.timeout(1500);
    while (!frames.includes('"type":"results"')) {
      const read = await Promise.race([reader.read(), new Promise((_, reject) => {
        deadline.addEventListener('abort', () => reject(Error('No early search results')), { once: true });
      })]);
      frames += decoder.decode(read.value, { stream: true });
      assert.equal(read.done, false);
    }
    assert.equal(events.length, beforeEvents, 'partial frames are not separate completed search events');
    assert.ok(!frames.includes('"type":"complete"'), 'photos arrive while the final result is still blocked');
    release(); streamGate = null;
    while (true) {
      const read = await reader.read(); if (read.done) break;
      frames += decoder.decode(read.value, { stream: true });
    }
    assert.ok(frames.includes('"type":"complete"'));
    assert.equal(events.length, beforeEvents + 1);
    assert.equal(events.at(-1).resultCount, 1);
    const controller = new AbortController();
    streamGate = new Promise(() => {});
    const cancelled = await fetch(root + '?q=测试&stream=1', { headers: { 'x-test-auth': '1' }, signal: controller.signal });
    const cancelledReader = cancelled.body.getReader();
    await cancelledReader.read();
    const running = searchCalls.at(-1);
    controller.abort();
    await new Promise(resolve => running.signal.aborted ? resolve() : running.signal.addEventListener('abort', resolve, { once: true }));
    assert.equal(running.signal.aborted, true, 'closing the response propagates cancellation to search');
    streamGate = null;
    console.log('PASS: real search route records authorized requests, ignores denied/demo/pagination traffic and preserves server scope');
  } catch (error) {
    console.error(error); process.exitCode = 1;
  } finally { server.closeAllConnections(); server.close(); }
});
