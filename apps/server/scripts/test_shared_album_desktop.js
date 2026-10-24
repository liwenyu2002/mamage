const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const express = require('express');
const { DatabaseSync } = require('node:sqlite');

function fixture() {
  const db = new DatabaseSync(':memory:');
  db.function('NOW', () => '2026-10-22 00:00:00');
  db.exec(`CREATE TABLE projects(id INTEGER, name TEXT, organization_id INTEGER, unit_id INTEGER, restricted_to_user_id INTEGER, created_at TEXT, updated_at TEXT);
    CREATE TABLE organization_units(id INTEGER, name TEXT);
    CREATE TABLE organizations(id INTEGER, name TEXT);
    CREATE TABLE internal_shares(id INTEGER, organization_id INTEGER, target_unit_id INTEGER, target_user_id INTEGER, project_id INTEGER, share_type TEXT, mode TEXT, created_at TEXT, expires_at TEXT, revoked_at TEXT, folder_share_id INTEGER);
    CREATE TABLE photos(id INTEGER, project_id INTEGER, organization_id INTEGER, type TEXT, created_at TEXT, url TEXT, thumb_url TEXT);
    INSERT INTO organizations VALUES (2,'College'),(3,'Other college');
    INSERT INTO organization_units VALUES (1,'Source team'),(2,'Recipient team'),(3,'Other team');
    INSERT INTO projects VALUES (76,'Original',2,1,NULL,'2026-09-01','2026-10-22'),(81,'Original (copy)',2,2,NULL,'2026-09-01','2026-09-01'),(99,'Private',2,1,12,'2026-09-01','2026-09-01');
    INSERT INTO photos VALUES (1,76,2,'normal','2026-09-01','original.jpg','thumb.jpg'),(2,81,2,'normal','2026-09-01','copy.jpg','copy-thumb.jpg');`);
  const source = require.resolve('../lib/shared_albums'), actual = createRequire(source), module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(source, 'utf8'), { module, exports: module.exports,
    require: key => key === '../db' ? { pool: null } : key === './media_access' ? { buildMediaUrl: value => value } : actual(key) }, { filename: source });
  const scope = { enabled: true, orgId: 2, unitId: 2, userId: 67, collegeAdmin: false };
  const query = async (sql, params) => [db.prepare(sql).all(...params)];
  const share = (overrides = {}) => {
    const s = { id: 1, organization_id: 2, target_unit_id: 2, target_user_id: null, project_id: 76,
      share_type: 'album', mode: 'read', created_at: '2026-10-21', expires_at: null, revoked_at: null, ...overrides };
    db.prepare(`INSERT INTO internal_shares (${Object.keys(s).join(',')}) VALUES (${Object.keys(s).map(() => '?').join(',')})`).run(...Object.values(s));
  };
  return { db, scope, share, list: async (patch = {}) => module.exports.listSharedAlbums({ ...scope, ...patch }, { query }) };
}

test('actual catalog SQL deduplicates grants, keeps copies separate and reads new source photos', async () => {
  const f = fixture();
  try {
    f.share(); f.share({ id: 2, mode: 'collaborate' }); f.share({ id: 3, mode: 'copy' });
    let result = await f.list();
    assert.deepEqual(Array.from(result, a => a.id), [76]);
    assert.equal(result[0].shareMode, 'collaborate'); assert.equal(result[0].count, 1);
    assert.equal(result[0].originLabel, 'College / Source team');
    f.db.exec("INSERT INTO photos VALUES (3,76,2,'video','2026-10-22','video.mp4',NULL)");
    result = await f.list(); assert.equal(result[0].count, 2);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM photos WHERE project_id=81').get().n, 1);
    f.db.exec("UPDATE internal_shares SET revoked_at='2026-10-22' WHERE mode='collaborate'");
    assert.equal((await f.list())[0].shareMode, 'read');
  } finally { f.db.close(); }
});

test('catalog SQL excludes invalid, expired, revoked, wrong recipient and private album grants', async () => {
  for (const patch of [{ mode: 'copy' }, { share_type: 'collection' }, { expires_at: '2026-10-21' },
    { expires_at: '2026-10-22 00:00:00' }, { revoked_at: '2026-10-21' }, { target_user_id: 68 },
    { target_unit_id: 3 }, { organization_id: 3 }, { project_id: 99 }, { project_id: 81 }]) {
    const f = fixture();
    try { f.share(patch); assert.equal((await f.list()).length, 0, JSON.stringify(patch)); }
    finally { f.db.close(); }
  }
});

test('named and permanent shares remain accessible only in the receiving workspace', async () => {
  const f = fixture();
  try {
    f.share({ target_user_id: 67 });
    assert.equal((await f.list()).length, 1);
    for (const patch of [{ userId: 68 }, { unitId: 3 }, { orgId: 3 }, { unitId: null }, { enabled: false }]) {
      assert.equal((await f.list(patch)).length, 0, JSON.stringify(patch));
    }
  } finally { f.db.close(); }
});

test('recipient desktop exposes the shared original separately from an independent copy', async () => {
  const workspace = { enabled: true, userId: 67, orgId: 2, unitId: 2, role: 'editor' };
  const calls = [];
  const conn = {
    async query(sql) {
      calls.push(sql);
      if (sql.startsWith('SET TRANSACTION')) return [[]];
      if (sql.includes('FROM projects')) return [[{ id: 81, name: 'Album (copy)', count: 37 }]];
      return [[]];
    },
    async beginTransaction() {}, async commit() {}, async rollback() {}, release() {},
  };
  const source = require.resolve('../routes/album_desktop');
  const actual = createRequire(source), module = { exports: {} };
  const live = [{ id: 76, name: 'Original album', count: 88, shareMode: 'collaborate', originLabel: 'Source team' }];
  const deps = {
    '../db': { pool: { getConnection: async () => conn } },
    '../lib/permissions': { requirePermission: () => (_req, _res, next) => next() },
    '../lib/workspace_access': { ...actual('../lib/workspace_access'), resolveWorkspace: async () => workspace },
    '../lib/media_access': { buildMediaUrl: value => value },
    '../lib/shared_albums': { listSharedAlbums: async (scope, db) => {
      assert.equal(scope.userId, 67); assert.equal(scope.unitId, 2); assert.equal(db, conn); return live;
    } },
  };
  vm.runInNewContext(fs.readFileSync(source, 'utf8'), { module, exports: module.exports, console, Buffer,
    require: key => Object.hasOwn(deps, key) ? deps[key] : actual(key) }, { filename: source });
  const app = express(); app.use(module.exports);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/`);
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.deepEqual(result.albums.map(a => a.id), [81]);
    assert.deepEqual(result.sharedAlbums, live, 'The desktop must return the live original, not just its old copy');
    assert.deepEqual(result.groups, []);
    assert.ok(calls.every(sql => !/^(INSERT|UPDATE|DELETE)/.test(sql)));
  } finally { await new Promise(resolve => server.close(resolve)); }
});
