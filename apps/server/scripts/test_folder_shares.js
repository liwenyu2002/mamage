const assert = require('node:assert/strict');
const { test } = require('node:test');
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs'), vm = require('node:vm'), { createRequire } = require('node:module');
const express = require('express');
process.env.MEDIA_URL_SECRET = 'isolated-share-original-test-secret';

function load(file, deps) {
  const module = { exports: {} }, actual = createRequire(file);
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), { module, exports: module.exports, process, console, Buffer,
    require: key => Object.hasOwn(deps, key) ? deps[key] : actual(key) }, { filename: file });
  return module.exports;
}
function fixture() {
  const db = new DatabaseSync(':memory:');
  db.function('NOW', () => '2026-10-22 00:00:00');
  db.function('UUID', () => require('crypto').randomUUID());
  db.exec(`CREATE TABLE organizations(id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE organization_units(id INTEGER PRIMARY KEY, organization_id INTEGER, name TEXT, archived_at TEXT);
    CREATE TABLE users(id INTEGER PRIMARY KEY, organization_id INTEGER, name TEXT);
    CREATE TABLE organization_unit_memberships(unit_id INTEGER, user_id INTEGER, removed_at TEXT);
    CREATE TABLE projects(id INTEGER PRIMARY KEY AUTOINCREMENT, organization_id INTEGER, unit_id INTEGER,
      admin_id INTEGER, restricted_to_user_id INTEGER, name TEXT, description TEXT, meta TEXT, tags TEXT,
      type TEXT, event_date TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE photos(id INTEGER PRIMARY KEY, uuid TEXT, organization_id INTEGER, unit_id INTEGER, project_id INTEGER,
      photographer_id INTEGER, type TEXT, title TEXT, description TEXT, tags TEXT, timeline_section_id INTEGER,
      url TEXT, thumb_url TEXT, public_download_url TEXT, playback_url TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE project_timeline_sections(id INTEGER, project_id INTEGER, name TEXT, section_time TEXT, sort_order INTEGER);
    CREATE TABLE folder_shares(id INTEGER PRIMARY KEY AUTOINCREMENT, organization_id INTEGER, source_unit_id INTEGER,
      source_folder_id TEXT, folder_name TEXT, target_unit_id INTEGER, target_user_id INTEGER, mode TEXT,
      created_by INTEGER, expires_at TEXT, revoked_at TEXT, created_at TEXT DEFAULT '2026-10-22', snapshot_json TEXT);
    CREATE TABLE internal_shares(id INTEGER PRIMARY KEY AUTOINCREMENT, organization_id INTEGER, source_unit_id INTEGER,
      target_unit_id INTEGER, target_user_id INTEGER, share_type TEXT, mode TEXT, project_id INTEGER, created_by INTEGER,
      expires_at TEXT, revoked_at TEXT, snapshot_json TEXT, folder_share_id INTEGER, created_at TEXT DEFAULT '2026-10-22');
    CREATE TABLE internal_share_items(id INTEGER PRIMARY KEY AUTOINCREMENT, share_id INTEGER, photo_id INTEGER, snapshot_json TEXT);
    CREATE TABLE share_links(id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT UNIQUE, share_type TEXT, project_id INTEGER,
      title TEXT, created_by INTEGER, organization_id INTEGER, unit_id INTEGER, sync_mode TEXT, expires_at TEXT,
      revoked_at TEXT, created_at TEXT, folder_share_id INTEGER);
    CREATE TABLE share_link_items(id INTEGER PRIMARY KEY AUTOINCREMENT, share_id INTEGER, photo_id INTEGER, sort_order INTEGER, UNIQUE(share_id, photo_id));
    CREATE TABLE organization_copy_jobs(id INTEGER PRIMARY KEY AUTOINCREMENT, share_id INTEGER, organization_id INTEGER,
      target_unit_id INTEGER, requested_by INTEGER, system_initiated INTEGER, status TEXT DEFAULT 'queued', result_json TEXT,
      error_code TEXT, copied_bytes INTEGER DEFAULT 0);
    CREATE TABLE album_desktop_workspaces(organization_id INTEGER, unit_key INTEGER, state TEXT, revision INTEGER DEFAULT 0, PRIMARY KEY(organization_id,unit_key));
    CREATE TABLE album_desktop_users(user_id INTEGER, organization_id INTEGER, unit_key INTEGER, state TEXT, revision INTEGER DEFAULT 0, PRIMARY KEY(user_id,organization_id,unit_key));
    CREATE TABLE organization_access_audit(id INTEGER PRIMARY KEY, organization_id INTEGER, unit_id INTEGER, user_id INTEGER, action TEXT, resource_type TEXT, resource_id INTEGER, details TEXT);
    INSERT INTO organizations VALUES(2,'College'),(3,'Other college');
    INSERT INTO organization_units VALUES(1,2,'Source',NULL),(2,2,'Recipient',NULL),(3,2,'Other',NULL),(4,3,'Foreign',NULL);
    INSERT INTO users VALUES(7,2,'Source editor'),(67,2,'Recipient'),(68,2,'Peer'),(90,3,'Foreign');
    INSERT INTO organization_unit_memberships VALUES(1,7,NULL),(2,67,NULL),(2,68,NULL),(4,90,NULL);
    INSERT INTO projects(id,organization_id,unit_id,admin_id,name) VALUES(76,2,1,7,'Original'),(77,2,1,7,'Nested'),(78,2,1,7,'Outside'),(81,2,2,67,'Borrowed'),(99,2,1,7,'Private');
    UPDATE projects SET restricted_to_user_id=7 WHERE id=99;
    INSERT INTO photos(id,organization_id,unit_id,project_id,photographer_id,type,title,url,thumb_url,public_download_url) VALUES
      (1,2,1,76,7,'normal','One','/uploads/units/1/one.jpg','/uploads/units/1/thumb.jpg','/uploads/units/1/download.jpg'),
      (2,2,1,77,7,'normal','Two','/uploads/units/1/two.jpg','/uploads/units/1/thumb2.jpg','/uploads/units/1/download2.jpg'),
      (3,2,1,78,7,'normal','Outside','outside.jpg','outside-thumb.jpg',NULL),
      (9,2,1,99,7,'normal','Private','private.jpg','private-thumb.jpg',NULL);`);
  const groups = [{ id: 'root', name: 'Root', kind: 'manual', parentId: null, projectIds: [76, 99, 81], createdBy: 7 },
    { id: 'child', name: 'Child', kind: 'manual', parentId: 'root', projectIds: [77], createdBy: 7 },
    { id: 'outside', name: 'Outside', kind: 'manual', parentId: null, projectIds: [78], createdBy: 7 }];
  db.prepare('INSERT INTO album_desktop_workspaces(organization_id,unit_key,state) VALUES (2,1,?)').run(JSON.stringify({ groups }));
  let wakes = 0, failure = null;
  const query = async (raw, params = []) => {
    if (/^SET TRANSACTION/.test(raw)) return [[]];
    if (failure && raw.includes(failure)) throw Error('injected failure');
    let sql = raw.replace(/\s+FOR (?:UPDATE|SHARE)\b/g, '').replace(/INSERT IGNORE/g, 'INSERT OR IGNORE').replace(/<=>/g, 'IS');
    const bound = [];
    sql = sql.replace(/\?/g, () => {
      const param = params[bound.parameterIndex || 0]; bound.parameterIndex = (bound.parameterIndex || 0) + 1;
      if (Array.isArray(param) && Array.isArray(param[0])) return param.map(row => '(' + row.map(value => { bound.push(value); return '?'; }).join(',') + ')').join(',');
      if (Array.isArray(param)) { bound.push(...param); return param.map(() => '?').join(','); }
      bound.push(Object.prototype.toString.call(param) === '[object Date]' ? param.toISOString().slice(0,19).replace('T',' ') : param === undefined ? null : typeof param === 'boolean' ? Number(param) : param); return '?';
    });
    const statement = db.prepare(sql);
    if (/^\s*(SELECT|WITH)\b/i.test(sql)) return [statement.all(...bound)];
    const result = statement.run(...bound);
    return [{ insertId: Number(result.lastInsertRowid), affectedRows: Number(result.changes) }];
  };
  const conn = { query, beginTransaction: async () => db.exec('BEGIN'), commit: async () => db.exec('COMMIT'),
    rollback: async () => { if (db.isTransaction) db.exec('ROLLBACK'); }, release() {} };
  const pool = { query, getConnection: async () => conn };
  const access = load(require.resolve('../lib/workspace_access'), { '../db': { pool } });
  const policy = load(require.resolve('../lib/internal_share_policy'), { '../db': { pool }, './workspace_access': access });
  const media = { buildMediaUrl: value => value || null,
    buildShareOriginalUrl: value => String(value || '').startsWith('/uploads/') ? value : null };
  const shared = load(require.resolve('../lib/shared_albums'), { '../db': { pool }, './media_access': media, './workspace_access': access });
  const folders = require('../lib/folder_shares');
  const mediaAcl = load(require.resolve('../lib/media_access'), { '../db': { pool, UPLOAD_BASE_URL: 'http://media.test/api/image',
    buildUploadUrl: value => value ? 'http://media.test/api/image/' + String(value).replace(/^\//, '') : null },
    './cos_storage': { keyFromUrlOrPath: value => String(value || '').replace(/^\//, ''), isSafeKey: key => !key.includes('..') },
    './workspace_access': access, './folder_shares': folders });
  const common = { '../db': { pool }, '../lib/workspace_access': access, '../lib/internal_share_policy': policy,
    '../lib/media_access': media, '../lib/shared_albums': shared, '../lib/organization_copy_worker': { wake() { wakes++; } },
    '../lib/permissions': { requirePermission: () => (req, res, next) => req.workspace.userId ? next() : res.status(401).json({ error: 'UNAUTHORIZED' }) } };
  const folderRouter = load(require.resolve('../routes/folder_shares'), common);
  const desktopRouter = load(require.resolve('../routes/album_desktop'), common);
  const publicModule = load(require.resolve('../lib/public_folder_share'), { './media_access': media });
  const shareRouter = load(require.resolve('../routes/share'), { ...common, '../lib/public_folder_share': publicModule });
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { const userId = Number(req.get('x-user') || 7), unitId = Number(req.get('x-unit') || (userId === 7 ? 1 : 2));
    req.workspace = { enabled: true, userId, orgId: userId === 90 ? 3 : 2, unitId, role: req.get('x-role') || 'editor', collegeAdmin: false };
    req.user = { id: userId, organization_id: req.workspace.orgId }; next(); });
  app.use('/folder-shares', folderRouter); app.use('/desktop', desktopRouter); app.use('/share', shareRouter);
  return { db, conn, pool, access, folders, shared, groups, app, mediaAcl, get wakes() { return wakes; }, inject: value => { failure = value; } };
}
async function serve(f, run) {
  const server = f.app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  try { await run(async (path, { method = 'GET', body, user = 7, unit, role } = {}) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method,
      headers: { 'Content-Type': 'application/json', 'x-user': String(user), ...(unit ? { 'x-unit': String(unit) } : {}), ...(role ? { 'x-role': role } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, headers: response.headers, body: await response.json() };
  }); } finally { await new Promise(resolve => server.close(resolve)); f.db.close(); }
}
const create = (call, patch = {}) => call('/folder-shares', { method: 'POST', body: { folderId: 'root', mode: 'read', targetUnitId: 2, ...patch } });
const scope = (unitId, userId = unitId === 1 ? 7 : 67) => ({ enabled: true, orgId: 2, unitId, userId, role: 'editor', collegeAdmin: false });

test('photo originals require a live, correctly scoped share, including approved photo selections', async () => {
  const f = fixture();
  try {
    f.db.exec(`INSERT INTO share_links(id,code,share_type,project_id,organization_id,unit_id,sync_mode,expires_at)
      VALUES(90,'original-test','project',76,2,1,'automatic','2099-01-01');`);
    const key = 'uploads/units/1/one.jpg';
    const url = new URL(f.mediaAcl.buildShareOriginalUrl('/' + key, { shareId: 90, photoId: 1 }));
    assert.equal(f.mediaAcl.buildShareOriginalUrl('https://example.test/private.jpg', { shareId: 90, photoId: 1 }), null);
    assert.equal(f.mediaAcl.buildShareOriginalUrl('/uploads/../private.jpg', { shareId: 90, photoId: 1 }), null);
    const token = url.searchParams.get('ma');
    const allowed = () => f.mediaAcl.authorizeMediaKey(key, token, f.pool);
    assert.equal(await allowed(), true);
    assert.equal(await f.mediaAcl.authorizeMediaKey(key, null, f.pool), false);
    assert.equal(await f.mediaAcl.authorizeMediaKey(key, token + 'x', f.pool), false);
    assert.equal(await f.mediaAcl.authorizeMediaKey('uploads/units/1/two.jpg', token, f.pool), false);
    for (const [field, value, restore] of [['revoked_at', '2026-10-21', null], ['expires_at', '2020-01-01', '2099-01-01'],
      ['organization_id', 3, 2], ['unit_id', 2, 1], ['project_id', 77, 76]]) {
      f.db.prepare(`UPDATE share_links SET ${field}=? WHERE id=90`).run(value);
      assert.equal(await allowed(), false, field);
      f.db.prepare(`UPDATE share_links SET ${field}=? WHERE id=90`).run(restore);
    }
    f.db.exec("UPDATE share_links SET sync_mode='approval' WHERE id=90");
    assert.equal(await allowed(), false, 'unapproved originals stay private');
    f.db.exec('INSERT INTO share_link_items(share_id,photo_id,sort_order) VALUES(90,1,0)');
    assert.equal(await allowed(), true);
    f.db.exec("UPDATE share_links SET share_type='collection',project_id=NULL WHERE id=90");
    assert.equal(await allowed(), true);
    f.db.exec('DELETE FROM share_link_items WHERE share_id=90');
    assert.equal(await allowed(), false, 'removing a selected photo revokes its existing original URL');
    f.db.exec("UPDATE share_links SET share_type='project',project_id=76,sync_mode='automatic' WHERE id=90; UPDATE photos SET type='video' WHERE id=1");
    assert.equal(await allowed(), false, 'photo permission does not change video-original policy');
  } finally { f.db.close(); }
});

test('folder original access follows approval, folder membership and folder revocation', async () => {
  const f = fixture(); await serve(f, async call => {
    const created = await create(call, {mode:'public'}); assert.equal(created.status,201);
    const share = f.db.prepare('SELECT * FROM share_links WHERE code=?').get(created.body.code);
    const key = 'uploads/units/1/two.jpg';
    const token = new URL(f.mediaAcl.buildMediaUrl('/'+key,{shareId:share.id,photoId:2})).searchParams.get('ma');
    const allowed = () => f.mediaAcl.authorizeMediaKey(key, token, f.pool);
    assert.equal(await allowed(),true);
    f.db.prepare('DELETE FROM share_link_items WHERE share_id=? AND photo_id=2').run(share.id);
    assert.equal(await allowed(),false);
    f.db.prepare('INSERT INTO share_link_items(share_id,photo_id,sort_order) VALUES(?,2,0)').run(share.id);
    const outsideToken = new URL(f.mediaAcl.buildMediaUrl('/uploads/units/1/one.jpg',{shareId:share.id,photoId:1})).searchParams.get('ma');
    const next = structuredClone(f.groups); next[1].parentId = null;
    await f.conn.beginTransaction(); await f.folders.syncFolderShares(f.conn,2,1,next); await f.conn.commit();
    assert.equal(await allowed(),false, 'moving a subfolder out revokes previously signed original URLs');
    assert.equal(await f.mediaAcl.authorizeMediaKey('uploads/units/1/one.jpg',outsideToken,f.pool),true);
    await call('/folder-shares/'+share.folder_share_id+'/revoke',{method:'POST'});
    assert.equal(await f.mediaAcl.authorizeMediaKey('uploads/units/1/one.jpg',outsideToken,f.pool),false);
  });
});

test('album and selected-photo share responses use originals even without a public rendition', async () => {
  const f = fixture(); await serve(f, async call => {
    f.db.exec(`INSERT INTO share_links(id,code,share_type,project_id,organization_id,unit_id,sync_mode,expires_at)
      VALUES(90,'original-test','project',76,2,1,'automatic','2099-01-01');
      UPDATE photos SET public_download_url=NULL WHERE id=1;`);
    let response = await call('/share/original-test'); assert.equal(response.status,200);
    assert.equal(response.body.photos[0].url, '/uploads/units/1/one.jpg');
    assert.equal(response.body.photos[0].thumbUrl, '/uploads/units/1/thumb.jpg');
    f.db.exec("UPDATE share_links SET share_type='collection',project_id=NULL,sync_mode='approval' WHERE id=90; INSERT INTO share_link_items(share_id,photo_id,sort_order) VALUES(90,1,0)");
    response = await call('/share/original-test'); assert.equal(response.status,200);
    assert.equal(response.body.photos[0].url, '/uploads/units/1/one.jpg');
    f.db.exec("UPDATE photos SET url='https://example.test/private.jpg' WHERE id=1");
    response = await call('/share/original-test'); assert.equal(response.body.photos[0].url,'/uploads/units/1/thumb.jpg');
    f.db.exec("UPDATE photos SET url='/uploads/units/1/one.jpg' WHERE id=1");
    f.db.exec("UPDATE photos SET type='video',playback_url='/uploads/units/1/playback.mp4' WHERE id=1");
    response = await call('/share/original-test'); assert.equal(response.body.photos[0].url,'/uploads/units/1/playback.mp4');
  });
});

test('real folder share routes grant only owned nonprivate descendants, preserve named recipients and enforce roles', async () => {
  const f = fixture(); await serve(f, async call => {
    assert.equal((await create(call, { targetUserId: 67 })).status, 201);
    assert.deepEqual(f.db.prepare('SELECT project_id FROM internal_shares ORDER BY project_id').all().map(row => row.project_id), [76,77]);
    const received = await call('/folder-shares/received', { user: 67 }); assert.equal(received.body.length, 1);
    assert.equal((await call('/folder-shares/received', { user: 68 })).body.length, 0);
    const view = await call('/folder-shares/1', { user: 67 }); assert.equal(view.status, 200);
    assert.deepEqual(view.body.albums.map(album => album.id).sort(), [76,77]);
    assert.equal(view.body.groups.length, 2); assert.equal(view.body.share.originLabel, 'College / Source');
    assert.equal((await call('/folder-shares/1', { user: 68 })).status, 404);
    assert.equal((await create(call, { targetUnitId: 4 })).status, 400);
    assert.equal((await create(call, { targetUserId: 90 })).status, 400);
    assert.equal((await call('/folder-shares', { method: 'POST', role: 'member', body: { folderId:'root',mode:'read',targetUnitId:2 } })).status, 403);
    assert.equal((await call('/folder-shares', { method: 'POST', user:67, body: { folderId:'root',mode:'read',targetUnitId:3 } })).status, 404);
    assert.equal(await f.access.canAccessProject(scope(2), { id:76,organization_id:2,unit_id:1 }, 'read', f.pool), true);
    assert.equal(await f.access.canAccessProject(scope(2), { id:76,organization_id:2,unit_id:1 }, 'metadata', f.pool), false);
  });
});

test('live folder membership changes revoke moved-out albums atomically without changing direct grants or copies', async () => {
  const f = fixture(); await serve(f, async call => {
    await create(call, { mode:'collaborate' });
    assert.equal(await f.access.canAccessProject(scope(2), { id:76,organization_id:2,unit_id:1 }, 'metadata', f.pool), true);
    assert.equal(await f.access.canAccessProject(scope(2), { id:76,organization_id:2,unit_id:1 }, 'manage', f.pool), false);
    const next = structuredClone(f.groups); next[1].parentId = null; next[0].projectIds = [76,78];
    await f.conn.beginTransaction(); await f.folders.syncFolderShares(f.conn,2,1,next); await f.conn.commit();
    assert.equal(await f.access.canAccessProject(scope(2), { id:77,organization_id:2,unit_id:1 }, 'read', f.pool), false);
    assert.equal(await f.access.canAccessProject(scope(2), { id:78,organization_id:2,unit_id:1 }, 'read', f.pool), true);
    const before = f.db.prepare('SELECT * FROM internal_shares ORDER BY id').all();
    f.inject('INSERT INTO internal_shares'); await f.conn.beginTransaction();
    await assert.rejects(() => f.folders.syncFolderShares(f.conn,2,1,f.groups)); await f.conn.rollback(); f.inject(null);
    assert.deepEqual(f.db.prepare('SELECT * FROM internal_shares ORDER BY id').all(), before);
    assert.equal((await call('/folder-shares/1/revoke', { method:'POST',user:67 })).status,404);
    assert.equal((await call('/folder-shares/1/revoke', { method:'POST' })).status,200);
    assert.equal(await f.access.canAccessProject(scope(2), { id:76,organization_id:2,unit_id:1 }, 'read', f.pool), false);
  });
});

test('public folder links preserve approval, bounded browsing, safe metadata and revocation', async () => {
  const f = fixture(); await serve(f, async call => {
    assert.equal((await create(call,{mode:'public',syncMode:'automatic'})).status,403);
    const created = await create(call,{mode:'public'}); assert.equal(created.status,201); const code=created.body.code;
    const root=await call('/share/'+code); assert.equal(root.status,200); assert.equal(root.body.shareType,'folder');
    assert.equal(root.body.folder.groups.length,2); assert.equal(root.body.folder.albums.length,2);
    const album=await call('/share/'+code+'?projectId=76'); assert.equal(album.status,200); assert.equal(album.body.photos.length,1);
    assert.equal(album.body.photos[0].url, '/uploads/units/1/one.jpg', 'folder photo original is not its compressed download variant');
    assert.ok(!JSON.stringify(root.body).includes('createdBy')); assert.ok(!JSON.stringify(root.body).includes('Private'));
    assert.equal((await call('/share/'+code+'?projectId=78')).status,404);
    f.db.exec("INSERT INTO photos(id,organization_id,unit_id,project_id,type,title,thumb_url) VALUES(4,2,1,76,'normal','New','new-thumb.jpg')");
    assert.equal((await call('/share/'+code+'?projectId=76')).body.photos.length,1,'new media is not silently public in approval mode');
    assert.equal((await call('/share/'+code+'/pending',{role:'manager'})).body.photos.length,1);
    assert.equal((await call('/share/'+code+'/approve',{method:'POST',role:'manager',body:{photoIds:[4]}})).status,200);
    assert.equal((await call('/share/'+code+'?projectId=76')).body.photos.length,2);
    assert.equal((await call('/share/'+code+'/approve',{method:'POST',role:'manager',body:{photoIds:[3]}})).status,404);
    await call('/folder-shares/1/revoke',{method:'POST'});
    assert.equal((await call('/share/'+code)).status,410);
  });
});

test('folder copies snapshot the tree and original media, reuse durable jobs, and do not follow later edits', async () => {
  const f=fixture(); await serve(f,async call=>{
    const created=await create(call,{mode:'copy'});assert.equal(created.status,201);assert.equal(f.wakes,1);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM organization_copy_jobs').get().n,2);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM internal_share_items').get().n,2);
    const copied=JSON.parse(f.db.prepare('SELECT state FROM album_desktop_workspaces WHERE unit_key=2').get().state).groups;
    assert.equal(copied.length,2);assert.equal(copied[1].parentId,copied[0].id);assert.deepEqual(copied[0].projectIds,[]);
    const stored=JSON.parse(f.db.prepare('SELECT snapshot_json FROM folder_shares').get().snapshot_json);
    assert.deepEqual(stored.groups.flatMap(group=>group.projectIds).sort(),[76,77]);
    await f.folders.syncFolderShares(f.conn,2,1,[]);
    assert.equal(f.db.prepare('SELECT revoked_at FROM folder_shares').get().revoked_at,null,'a copied snapshot is not a live grant');
    const parent=f.db.prepare('SELECT * FROM folder_shares').get();
    await require('../lib/folder_share_copy').attachFolderCopy(f.conn,parent,76,200);
    const ready=JSON.parse(f.db.prepare('SELECT state FROM album_desktop_workspaces WHERE unit_key=2').get().state).groups;
    assert.deepEqual(ready[0].projectIds,[200]);
    assert.equal((await call('/folder-shares/1',{user:67})).body.copyFolderId,copied[0].id);
    assert.equal(await f.access.canAccessProject(scope(2),{id:76,organization_id:2,unit_id:1},'read',f.pool),false);
  });
});

test('album sharing status is absent without valid grants and differentiates received, sent and public sharing', async () => {
  const f=fixture(); await serve(f,async call=>{
    const project={id:76,organization_id:2,unit_id:1};
    assert.equal(await f.shared.getAlbumSharingStatus(scope(1),project,f.pool),null);
    await create(call,{mode:'collaborate',targetUserId:67});
    const received=await f.shared.getAlbumSharingStatus(scope(2),project,f.pool);
    assert.equal(received.originLabel,'College / Source');assert.equal(received.mode,'collaborate');
    assert.equal(await f.shared.getAlbumSharingStatus(scope(2,68),project,f.pool),null);
    const sent=await f.shared.getAlbumSharingStatus(scope(1),project,f.pool);assert.deepEqual(Array.from(sent.targetUnitNames),['Recipient']);
    f.db.exec("UPDATE internal_shares SET expires_at='2026-10-21'");
    assert.equal(await f.shared.getAlbumSharingStatus(scope(2),project,f.pool),null);
    await create(call,{mode:'public'});
    assert.equal((await f.shared.getAlbumSharingStatus(scope(1),project,f.pool)).public,true);
    assert.equal(await f.shared.getAlbumSharingStatus(scope(1),{...project,organization_id:3},f.pool),null);
  });
});

test('card statuses batch active sent and public grants, inherit folders and never persist display metadata', async () => {
  const f=fixture();await serve(f,async call=>{
    let desktop=await call('/desktop');assert.equal(desktop.status,200);
    assert.deepEqual(desktop.body.sharingStatuses,{albums:{},folders:{}});
    await create(call,{mode:'collaborate',targetUserId:67});
    await create(call,{mode:'read'});
    await create(call,{mode:'copy'});
    await create(call,{mode:'public'});
    const stateBefore=f.db.prepare('SELECT state,revision FROM album_desktop_workspaces WHERE unit_key=1').get();
    desktop=await call('/desktop');assert.equal(desktop.status,200);
    const statuses=desktop.body.sharingStatuses;
    assert.deepEqual(statuses.albums[76],{direction:'sent',targetUnitNames:['Recipient'],public:true});
    assert.deepEqual(statuses.albums[77],statuses.albums[76]);
    assert.deepEqual(statuses.folders.root,statuses.albums[76]);assert.deepEqual(statuses.folders.child,statuses.albums[76]);
    assert.equal(statuses.folders.outside,undefined);assert.equal(statuses.albums[81],undefined);assert.equal(statuses.albums[99],undefined);
    assert.deepEqual((await call('/folder-shares/status/child')).body.sharing,statuses.folders.child);
    assert.deepEqual(await f.shared.getAlbumSharingStatus(scope(1),{id:76,unit_id:1,organization_id:2},f.pool),statuses.albums[76]);
    assert.deepEqual(f.db.prepare('SELECT state,revision FROM album_desktop_workspaces WHERE unit_key=1').get(),stateBefore);
    const recipient=(await call('/desktop',{user:67})).body;
    assert.deepEqual(recipient.sharingStatuses.albums[76],{direction:'received',originLabel:'College / Source',mode:'collaborate'});
    const peer=(await call('/desktop',{user:68})).body;
    assert.equal(peer.sharingStatuses.albums[76].mode,'read');
    assert.equal(peer.sharingStatuses.folders.root,undefined,'source folder metadata is not leaked into the receiving workspace');
    f.db.exec("UPDATE folder_shares SET revoked_at='2026-10-22' WHERE mode='public'; UPDATE internal_shares SET revoked_at='2026-10-22' WHERE mode IN ('read','collaborate') AND target_unit_id IS NOT NULL");
    const cleared=(await call('/desktop')).body.sharingStatuses;
    assert.deepEqual(cleared.albums,{});assert.equal(cleared.folders.root.public,false);
    f.db.exec("UPDATE folder_shares SET expires_at='2026-10-21' WHERE mode IN ('read','collaborate')");
    assert.deepEqual((await call('/desktop')).body.sharingStatuses,{albums:{},folders:{}});
  });
});

test('card statuses exclude invalid scope and hidden descendants with a bounded read-only query count', async () => {
  const f=fixture();await serve(f,async call=>{
    await create(call,{mode:'read',targetUserId:67});
    assert.equal((await call('/desktop',{user:68})).body.sharingStatuses.albums[76],undefined);
    f.db.exec("UPDATE internal_shares SET expires_at='2026-10-21'");
    assert.equal((await call('/desktop',{user:67})).body.sharingStatuses.albums[76],undefined);
    const {desktopSharingStatuses}=require('../lib/card_sharing_status');
    const privateGroup={id:'private-child',name:'Private',parentId:'root',kind:'manual',restrictedToUserId:7,projectIds:[99]};
    const groups=[...f.groups,privateGroup];let queries=0;
    const db={query:async(sql,params)=>{queries++;assert.match(sql,/^\s*SELECT/);return f.pool.query(sql,params)}};
    const own=Array.from({length:2000},(_,index)=>({id:index+1}));
    const batch=await desktopSharingStatuses(scope(1),own,[],groups,db);
    assert.equal(queries,3);assert.equal(batch.folders['private-child'],undefined);assert.equal(batch.folders.outside,undefined);
    for(const workspace of [{...scope(1),orgId:3},{...scope(1),unitId:3},{...scope(1),enabled:false}]){
      assert.deepEqual(await desktopSharingStatuses(workspace,own,[],groups,f.pool),{albums:{},folders:{}});
    }
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM internal_shares').get().n,2);
  });
});

test('named folder copies keep folder names private, survive peer saves, and cannot be forwarded by guessing IDs', async () => {
  const f=fixture(); await serve(f,async call=>{
    const created=await create(call,{mode:'copy',targetUserId:67});assert.equal(created.status,201);
    const target=await call('/desktop',{user:67});assert.equal(target.body.groups.length,2);
    assert.ok(target.body.groups.every(group=>group.restrictedToUserId===67));
    const before=f.db.prepare('SELECT state FROM album_desktop_workspaces WHERE unit_key=2').get().state;
    let peer=await call('/desktop',{user:68});assert.equal(peer.body.groups.length,0);
    const save=await call('/desktop/state',{method:'PUT',user:68,body:{groups:[],workspaceRevision:peer.body.workspaceRevision,sharedReferencesVersion:1}});
    assert.equal(save.status,200);
    assert.deepEqual(JSON.parse(f.db.prepare('SELECT state FROM album_desktop_workspaces WHERE unit_key=2').get().state),JSON.parse(before));
    const copiedId=target.body.groups[0].id;
    const owner=await call('/desktop',{user:67});
    const changed=await call('/desktop/state',{method:'PUT',user:67,body:{workspaceRevision:owner.body.workspaceRevision,sharedReferencesVersion:1,
      groups:[...owner.body.groups.map(group=>({...group,restrictedToUserId:null})),{id:'named-child',name:'Only recipient sees this',kind:'manual',parentId:copiedId,projectIds:[]}]}});
    assert.equal(changed.status,200);
    assert.equal((await call('/desktop',{user:68})).body.groups.length,0,'new children inherit recipient privacy, which cannot be unset by the client');
    const search=load(require.resolve('../lib/photo_search_scope'),{'../db':{pool:f.pool},'./workspace_access':f.access,'./shared_albums':f.shared});
    await assert.rejects(()=>search.resolveFolderSearchScope(scope(2,68),'named-child',f.pool),error=>error.status===404);
    assert.equal((await call('/folder-shares',{method:'POST',user:68,body:{folderId:copiedId,mode:'read',targetUnitId:3}})).status,403);
    peer=await call('/desktop',{user:68});
    assert.equal((await call('/desktop/state',{method:'PUT',user:68,body:{groups:[{...target.body.groups[0],name:'Forged'}],workspaceRevision:peer.body.workspaceRevision}})).status,403);
    const parent=f.db.prepare('SELECT * FROM folder_shares WHERE id=?').get(created.body.id);
    f.db.prepare('UPDATE album_desktop_workspaces SET state=? WHERE unit_key=2').run('{"groups":[]}');
    await assert.rejects(()=>require('../lib/folder_share_copy').attachFolderCopy(f.conn,parent,76,200),/TARGET_MISSING/);
  });
});

test('overlapping folder grants never revoke an independent album share', async()=>{
  const f=fixture();await serve(f,async call=>{
    await create(call,{mode:'collaborate'});
    f.db.exec("INSERT INTO internal_shares(organization_id,source_unit_id,target_unit_id,share_type,mode,project_id,created_by)VALUES(2,1,2,'album','read',77,7)");
    const next=structuredClone(f.groups);next[1].parentId=null;
    await f.folders.syncFolderShares(f.conn,2,1,next);
    const active=f.db.prepare('SELECT mode,folder_share_id FROM internal_shares WHERE project_id=77 AND revoked_at IS NULL').all();
    assert.equal(active.length,1);assert.equal(active[0].folder_share_id,null);
    assert.equal(await f.access.canAccessProject(scope(2),{id:77,organization_id:2,unit_id:1},'read',f.pool),true);
    assert.equal(await f.access.canAccessProject(scope(2),{id:77,organization_id:2,unit_id:1},'metadata',f.pool),false);
  });
});
