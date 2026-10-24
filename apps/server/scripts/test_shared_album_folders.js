const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs'), vm = require('node:vm');
const { createRequire } = require('node:module');
const express = require('express');

async function fixture(run) {
  const state = { groups: [{ id: 'business', name: 'Business', createdBy: 67, projectIds: [81], parentId: null }],
    revision: 1, userRevision: 1, preferences: {}, active: true, named: false, mode: 'read', count: 88, title: 'Original', writes: [] };
  const owner = { id: 81, name: 'Original (copy)', count: 37, createdAt: '2026-09-01' };
  const conn = {
    async query(sql, params = []) {
      if (sql.startsWith('SET TRANSACTION')) return [[]];
      if (/^\s*SELECT (?:s\.project_id AS projectId|link\.project_id AS projectId|fs\.source_folder_id AS folderId)/.test(sql)) return [[]];
      if (sql.includes('FROM projects p')) return [[owner]];
      if (sql.includes('SELECT state, revision FROM album_desktop_workspaces')) return [[{ state: { groups: state.groups }, revision: state.revision }]];
      if (sql.includes('SELECT state, revision FROM album_desktop_users')) return [[{ state: state.preferences, revision: state.userRevision }]];
      assert.match(sql, /^(INSERT IGNORE INTO|UPDATE) album_desktop_(workspaces|users)/, 'Only desktop state may be written');
      state.writes.push(sql);
      if (sql.startsWith('UPDATE album_desktop_workspaces')) { state.groups = JSON.parse(params[0]).groups; state.revision++; }
      if (sql.startsWith('UPDATE album_desktop_users')) { state.preferences = JSON.parse(params[0]); state.userRevision++; }
      return [{ affectedRows: 1 }];
    },
    async beginTransaction() { this.before = structuredClone(state); },
    async commit() {}, async rollback() { Object.assign(state, this.before); }, release() {},
  };
  const file = require.resolve('../routes/album_desktop'), actual = createRequire(file), module = { exports: {} };
  const live = scope => state.active && state.mode !== 'copy' && (!state.named || scope.userId === 67)
    ? [{ id: 76, name: state.title, title: state.title, count: state.count, isShared: true, canEdit: state.mode === 'collaborate',
      shareMode: state.mode, originLabel: 'Source team', createdAt: '2026-09-01' }] : [];
  const deps = {
    '../db': { pool: { getConnection: async () => conn } },
    '../lib/permissions': { requirePermission: () => (_req, _res, next) => next() },
    '../lib/workspace_access': { ...actual('../lib/workspace_access'), resolveWorkspace: async req => ({ enabled: true,
      userId: Number(req.get('x-test-user') || 67), orgId: 2, unitId: 2, role: req.get('x-test-role') || 'editor', collegeAdmin: false }) },
    '../lib/media_access': { buildMediaUrl: value => value },
    '../lib/shared_albums': { listSharedAlbums: async scope => live(scope) },
    '../lib/folder_shares': { listFolderShares: async () => [], syncFolderShares: async () => {} },
  };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), { module, exports: module.exports, console, Buffer,
    require: key => Object.hasOwn(deps, key) ? deps[key] : actual(key) }, { filename: file });
  const app = express(); app.use(express.json()); app.use(module.exports);
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const call = async (method = 'GET', body, headers = {}) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/${method === 'PUT' ? 'state' : ''}`, {
      method, headers: { 'Content-Type': 'application/json', ...headers }, ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, data: await response.json() };
  };
  const save = (groups, options = {}, headers = {}) => call('PUT', { groups, workspaceRevision: state.revision,
    sharedReferencesVersion: 1, ...options }, headers);
  try { await run({ state, call, save }); } finally { await new Promise(resolve => server.close(resolve)); }
}

test('saving a live reference persists only folder IDs and re-reads current source content', () => fixture(async ({ state, call, save }) => {
  let response = await save([{ ...state.groups[0], projectIds: [81, 76, 76] }]);
  assert.equal(response.status, 200, JSON.stringify(response.data));
  assert.deepEqual(state.groups[0].projectIds, [81, 76]);
  response = await call();
  assert.deepEqual(response.data.albums.map(a => a.id), [81, 76]);
  assert.equal(response.data.albums[1].isShared, true); assert.equal(response.data.albums[1].canEdit, false);
  state.count = 89; state.title = 'Renamed original';
  response = await call();
  assert.equal(response.data.albums[1].count, 89); assert.equal(response.data.albums[1].name, 'Renamed original');
  assert.equal(response.data.albums[0].count, 37);
  assert.ok(state.writes.every(sql => /album_desktop_/.test(sql)));
}));

test('named shares do not leak metadata to peers, and peer saves preserve invisible references', () => fixture(async ({ state, call, save }) => {
  state.named = true; state.groups[0].projectIds.push(76);
  const peer = { 'x-test-user': '68', 'x-test-role': 'manager' };
  let response = await call('GET', undefined, peer);
  assert.deepEqual(response.data.albums.map(a => a.id), [81]); assert.deepEqual(response.data.sharedAlbums, []);
  assert.deepEqual(response.data.groups[0].projectIds, [81]);
  response = await save([{ ...response.data.groups[0], name: 'Peer rename' }], {}, peer);
  assert.equal(response.status, 200); assert.deepEqual(state.groups[0].projectIds, [81, 76]);
  assert.equal((await call()).data.albums.find(a => a.id === 76).name, 'Original');
}));

test('expired or revoked shares hide on reload, survive unrelated saves and return after renewed authorization', () => fixture(async ({ state, call, save }) => {
  state.groups[0].projectIds.push(76); state.active = false;
  let response = await call(); assert.deepEqual(response.data.groups[0].projectIds, [81]);
  assert.deepEqual(response.data.albums.map(a => a.id), [81]);
  response = await save([{ ...response.data.groups[0], name: 'Updated folder' }]);
  assert.equal(response.status, 200); assert.deepEqual(state.groups[0].projectIds, [81, 76]);
  state.active = true; assert.equal((await call()).data.albums.find(a => a.id === 76).count, 88);
}));

test('old-client full saves retain existing shared references; explicit new-client removal works', () => fixture(async ({ state, save }) => {
  state.groups[0].projectIds.push(76);
  let response = await save([{ ...state.groups[0], projectIds: [81] }], { sharedReferencesVersion: undefined });
  assert.equal(response.status, 200); assert.deepEqual(state.groups[0].projectIds, [81, 76]);
  response = await save([{ ...state.groups[0], projectIds: [81] }]);
  assert.equal(response.status, 200); assert.deepEqual(state.groups[0].projectIds, [81]);
}));

test('viewers, peer folder edits, forged IDs, copy grants and stale scopes cannot add live references', () => fixture(async ({ state, save }) => {
  const proposed = () => [{ ...state.groups[0], projectIds: [81, 76] }];
  assert.equal((await save(proposed(), {}, { 'x-test-role': 'viewer' })).status, 403);
  assert.equal((await save(proposed(), {}, { 'x-test-user': '68' })).status, 403);
  assert.equal((await save([{ ...state.groups[0], projectIds: [999] }])).status, 403);
  assert.equal((await save(proposed(), { scope: { userId: 67, organizationId: 2, unitId: 3 } })).status, 409);
  state.mode = 'copy'; assert.equal((await save(proposed())).status, 403);
  assert.deepEqual(state.groups[0].projectIds, [81]);
}));
