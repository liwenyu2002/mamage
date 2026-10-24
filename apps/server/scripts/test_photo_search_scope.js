const assert = require('node:assert/strict');
const { test } = require('node:test');
const sharedPath = require.resolve('../lib/shared_albums');
let liveSharedAlbums = [];
require.cache[sharedPath] = { id: sharedPath, filename: sharedPath, loaded: true,
  exports: { listSharedAlbums: async () => liveSharedAlbums } };
const { folderProjectIds, resolveFolderSearchScope, resolveWorkspaceSearchScope } = require('../lib/photo_search_scope');

const groups = [
  { id: 'root', name: '活动', projectIds: [1, 1], kind: 'manual' },
  { id: 'child', parentId: 'root', name: '会议', projectIds: [2, 3], kind: 'manual' },
  { id: 'leaf', parentId: 'child', name: '开幕', projectIds: [2, 4], kind: 'manual' },
  { id: 'other', name: '其他', projectIds: [5], kind: 'manual' },
  { id: 'empty', parentId: 'root', name: '空文件夹', projectIds: [], kind: 'manual' },
];

test('workspace search includes saved authorized shared references only, and checks live access on every call', async () => {
  const workspace = { enabled: true, orgId: 7, unitId: 9, userId: 11 };
  const db = { query: async (sql, params) => {
    assert.match(sql, /album_desktop_workspaces/);
    assert.deepEqual(params, [7, 9]);
    return [[{ state: { groups } }]];
  } };
  liveSharedAlbums = [{ id: 3 }, { id: 99 }];
  try {
    assert.deepEqual(await resolveWorkspaceSearchScope(workspace, db), { sharedProjectIds: [3], scope: { type: 'workspace' } });
    liveSharedAlbums = [];
    assert.deepEqual(await resolveWorkspaceSearchScope(workspace, db), {});
    assert.deepEqual(await resolveWorkspaceSearchScope({}, { query: async () => { throw Error('no anonymous DB access'); } }), {});
  } finally { liveSharedAlbums = []; }
});

test('folders include their descendants once, but not siblings or ancestors', () => {
  assert.deepEqual(folderProjectIds(groups, 'root'), [1, 2, 3, 4]);
  assert.deepEqual(folderProjectIds(groups, 'child'), [2, 3, 4]);
  assert.deepEqual(folderProjectIds(groups, 'leaf'), [2, 4]);
  assert.deepEqual(folderProjectIds(groups, 'empty'), []);
  assert.throws(() => folderProjectIds(groups, 'missing'), { code: 'FOLDER_NOT_FOUND', status: 404 });
});

test('cycles terminate, invalid album IDs are ignored, and missing state never becomes global', () => {
  assert.deepEqual(folderProjectIds([{ id: 'a', parentId: 'b', projectIds: [1, -1, 'bad', 1.2] },
    { id: 'b', parentId: 'a', projectIds: [2] }], 'a'), [1, 2]);
  for (const state of [undefined, {}, []]) assert.throws(() => folderProjectIds(state, 'root'), { status: 404 });
});

test('scope is read from the authenticated workspace and rechecks album visibility', async () => {
  const calls = [];
  const db = { query: async (sql, params) => {
    calls.push({ sql, params });
    return sql.includes('album_desktop_workspaces') ? [[{ state: JSON.stringify({ groups }) }]] : [[{ id: 2 }, { id: 4 }]];
  } };
  const result = await resolveFolderSearchScope({ enabled: true, orgId: 7, unitId: 9, userId: 11 }, 'root', db);
  assert.deepEqual(calls[0].params, [7, 9]);
  assert.deepEqual(calls[1].params, [7, [1, 2, 3, 4], 9, 11]);
  assert.match(calls[1].sql, /pr.organization_id = \?/);
  assert.match(calls[1].sql, /pr.restricted_to_user_id = \?/);
  assert.deepEqual(result.projectIds, [2, 4]);
  assert.deepEqual(result.scope, { type: 'folder', id: 'root', name: '活动', includeDescendants: true });
});

test('empty folders do not query or widen the album catalog', async () => {
  let calls = 0;
  const result = await resolveFolderSearchScope({ orgId: 7, userId: 11, unitId: null }, 'empty', { query: async (_sql, params) => {
    calls++; assert.deepEqual(params, [7, 0]); return [[{ state: { groups } }]];
  } });
  assert.equal(calls, 1);
  assert.deepEqual(result.projectIds, []);
});

test('folder search adds only active live references actually stored under that folder', async () => {
  liveSharedAlbums = [{ id: 3 }, { id: 99 }];
  try {
    const result = await resolveFolderSearchScope({ enabled: true, orgId: 7, unitId: 9, userId: 11 }, 'root', {
      query: async sql => sql.includes('album_desktop_workspaces') ? [[{ state: { groups } }]] : [[{ id: 2 }]],
    });
    assert.deepEqual(result.projectIds, [2, 3]); assert.deepEqual(result.sharedProjectIds, [3]);
    liveSharedAlbums = [];
    const revoked = await resolveFolderSearchScope({ enabled: true, orgId: 7, unitId: 9, userId: 11 }, 'root', {
      query: async sql => sql.includes('album_desktop_workspaces') ? [[{ state: { groups } }]] : [[{ id: 2 }]],
    });
    assert.deepEqual(revoked.projectIds, [2]); assert.equal(revoked.sharedProjectIds, undefined);
  } finally { liveSharedAlbums = []; }
});

test('invalid, foreign and anonymous folders fail before search runs', async () => {
  const db = { query: async () => [[]] };
  for (const id of ['', ['root'], {}, '../root', 'a'.repeat(81)]) {
    await assert.rejects(resolveFolderSearchScope({ orgId: 7, userId: 11 }, id, db), { status: 400 });
  }
  await assert.rejects(resolveFolderSearchScope({ orgId: 8, userId: 11 }, 'root', db), { status: 404 });
  await assert.rejects(resolveFolderSearchScope({}, 'root', db), { status: 404 });
});
