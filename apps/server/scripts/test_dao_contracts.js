// dao 层契约测试：用假 db 记录 SQL 与参数，锁住几类"容易悄悄错位"的约定：
// 1) 占位符数量必须与参数个数一致（updated_at 这类附加参数最容易漏）；
// 2) 有返回值的写操作明确返回 ID 或影响行数，不暴露驱动元组；
// 3) 参数顺序与业务语义一致（组织范围、用户范围不串位）。
const test = require('node:test');
const assert = require('node:assert/strict');

const usersDao = require('../lib/queries/users');
const facesDao = require('../lib/queries/faces');
const uploadDao = require('../lib/queries/upload');
const projectsDao = require('../lib/queries/projects');
const shareDao = require('../lib/queries/share_links');
const videoDao = require('../lib/queries/video_projects');
const folderSharesDao = require('../lib/queries/folder_shares');
const photosDao = require('../lib/queries/photos');

function fakeDb(handler) {
  const calls = [];
  const query = async (sql, params = []) => {
    calls.push({ sql: String(sql), params });
    return handler ? handler(String(sql), params) : [[], null];
  };
  return { calls, db: { query }, conn: { query } };
}

function placeholders(sql) {
  return (sql.match(/\?/g) || []).length;
}

test('users.updateProfileFields 把 updated_at 与 userId 一起放进参数位', async () => {
  const { calls, conn } = fakeDb();
  await usersDao.updateProfileFields(conn, { updates: ['nickname = ?', 'department = ?'], params: ['小明', '宣传部'], userId: 7 });
  const [{ sql, params }] = calls;
  assert.equal(placeholders(sql), params.length, '占位符与参数必须等长');
  assert.equal(params.at(-1), 7, '最后一个参数必须是 userId');
  assert.ok(params.at(-2) instanceof Date, '更新时戳走参数位而不是 SQL 字面量');
  assert.match(sql, /updated_at = \?/);
});

test('faces.reassignFace 返回 affectedRows 数字，调用方可以直接累加', async () => {
  const { calls, conn } = fakeDb(() => [{ affectedRows: 3 }, null]);
  const moved = await facesDao.reassignFace(conn, {
    faceId: 201, fromPersonId: 77, toPersonId: 999, orgId: 1, extra: '{"splitFromPersonId":77}',
  });
  assert.equal(moved, 3);
  const [{ sql, params }] = calls;
  assert.equal(placeholders(sql), params.length);
  assert.equal(params[0], 999, '第 1 个参数是目标人物');
  assert.equal(params[2], 201, '第 3 个参数是人脸 id');
});

test('upload.insertPhotoFull 的占位符与参数一一对应（UUID 与 NULL 不占位）', async () => {
  const { calls, conn } = fakeDb(() => [{ insertId: 55 }, null]);
  await uploadDao.insertPhotoFull(conn, {
    projectId: 9, timelineSectionId: null, relPath: '/uploads/a.jpg', thumbRel: '/uploads/a_thumb.jpg',
    playbackRel: null, title: '标题', description: '', tags: ['活动'], aiStatus: 'pending', type: 'normal',
    photographerId: 7, orgId: 2, unitId: 1, originalFilename: '原图.jpg',
  });
  const [{ sql, params }] = calls;
  assert.equal(placeholders(sql), params.length);
  assert.match(sql, /UUID\(\)/);
  assert.equal(params.at(-1), '原图.jpg');
  assert.equal(params[7], '["活动"]', 'tags 必须序列化成 JSON');
});

test('projects.updateProjectMeta 只更新元数据列并带 updated_at', async () => {
  const { calls, conn } = fakeDb();
  await projectsDao.updateProjectMeta(conn, { id: 12, name: '新名字', description: '', eventDate: '2026-11-20', metaJson: '{}', tagsJson: null });
  const [{ sql, params }] = calls;
  assert.equal(placeholders(sql), params.length);
  assert.match(sql, /updated_at = NOW\(\)/);
  assert.equal(params.at(-1), 12);
});

test('share_links.insertShareItems 空数组不发查询', async () => {
  const { calls, db } = fakeDb();
  await shareDao.insertShareItems(db, []);
  assert.equal(calls.length, 0);
});

test('video.completeRenderJob 带上 outputPath 且限制状态机入口', async () => {
  const { calls, conn } = fakeDb(() => [{ affectedRows: 1 }, null]);
  const done = await videoDao.completeRenderJob(conn, { jobId: 5, status: 'completed', stage: '导出完成', outputPath: 'out/5.mp4' });
  assert.equal(done, 1);
  const [{ sql, params }] = calls;
  assert.equal(placeholders(sql), params.length);
  assert.match(sql, /status IN \('running','queued'\)/);
  assert.equal(params.at(-1), 5);
});

test('folder_shares.revokeFolderShare 同时撤销内部分享与公开链接', async () => {
  const { calls, conn } = fakeDb();
  await folderSharesDao.revokeFolderShare(conn, 31);
  assert.equal(calls.length, 3, 'folder_shares / internal_shares / share_links 三条都要撤');
  for (const call of calls) {
    assert.equal(placeholders(call.sql), call.params.length);
    assert.deepEqual(call.params, [31]);
  }
});

// ---- 第二批：列表/分页/降级路径 ----

const wechatMonitorDao = require('../lib/queries/wechat_monitor');
const aiNewsDao = require('../lib/queries/ai_news');
const workspacesDao = require('../lib/queries/workspaces');
const albumDesktopDao = require('../lib/queries/album_desktop');
const externalImportsDao = require('../lib/queries/external_imports');
const internalSharesDao = require('../lib/queries/internal_shares');
const organizationsDao = require('../lib/queries/organizations');

test('projects.listProjectsPage 把分页参数追加在业务参数之后', async () => {
  const { calls, db } = fakeDb(() => [[{ id: 1 }], null]);
  await projectsDao.listProjectsPage(db, { whereSql: 'WHERE p.organization_id = ?', params: [2], orderBySql: 'p.id DESC', pageSize: 24, offset: 48 });
  const [{ sql, params }] = calls;
  assert.equal(placeholders(sql), params.length);
  assert.deepEqual(params, [2, 24, 48], '业务参数 → pageSize → offset');
  assert.match(sql, /ORDER BY p\.id DESC/);
});

test('photos.queryWithDegradedFallback 命中缺列错误时改用降级 SQL', async () => {
  const { calls, db } = fakeDb((sql) => {
    if (sql.includes('ai_score')) throw Object.assign(new Error("Unknown column 'ai_score'"), { code: 'ER_BAD_FIELD_ERROR' });
    return [[{ id: 1 }], null];
  });
  const rows = await photosDao.queryWithDegradedFallback(db, {
    sql: 'SELECT p.ai_score FROM photos p', degradedSql: 'SELECT p.id FROM photos p', params: [],
  });
  assert.deepEqual(rows, [{ id: 1 }]);
  assert.equal(calls.length, 2, '主查询失败后必须重试降级 SQL');
});

test('photos.queryWithDegradedFallback 对非缺列错误继续抛出', async () => {
  const { db } = fakeDb(() => { throw Object.assign(new Error('boom'), { code: 'ER_LOCK_DEADLOCK' }); });
  await assert.rejects(() => photosDao.queryWithDegradedFallback(db, { sql: 'SELECT 1', degradedSql: 'SELECT 2', params: [] }), /boom/);
});

test('wechat_monitor.listArticles 把协议版本放在参数最前、offset 最后', async () => {
  const { calls, db } = fakeDb(() => [[], null]);
  await wechatMonitorDao.listArticles(db, { clauses: ['a.scope_key=?'], params: ['scope-1'], protocolVersion: 3, offset: 30 });
  const [{ sql, params }] = calls;
  assert.equal(placeholders(sql), params.length);
  assert.deepEqual(params, [3, 'scope-1', 30]);
});

test('ai_news.requeueJob 只重置失败任务的状态字段', async () => {
  const { calls, db } = fakeDb();
  await aiNewsDao.requeueJob(db, 42);
  const [{ sql, params }] = calls;
  assert.match(sql, /started_at = NULL/);
  assert.deepEqual(params, ['pending', 42]);
});

test('workspaces.listUnitMembers 不把管理员标记塞进 SQL 参数', async () => {
  const { calls, db } = fakeDb(() => [[{ id: 7, role: 'manager' }], null]);
  await workspacesDao.listUnitMembers(db, { unitId: 1, orgId: 2 });
  const [{ sql, params }] = calls;
  assert.equal(placeholders(sql), params.length);
  assert.deepEqual(params, [1, 2]);
});

test('album_desktop.lockSnapshot 两条查询都带 FOR UPDATE', async () => {
  const { calls, conn } = fakeDb(() => [[], null]);
  await albumDesktopDao.lockSnapshot(conn, { orgId: 2, unitKey: 1, userId: 7 });
  assert.equal(calls.length, 2);
  for (const call of calls) assert.match(call.sql, /FOR UPDATE/);
});

test('external_imports.listAttributedSources 保留 owner 过滤片段', async () => {
  const { calls, db } = fakeDb(() => [[], null]);
  await externalImportsDao.listAttributedSources(db, {
    projectId: 9, ownerSql: ' AND j.requested_by = ?', args: [9, 7],
  });
  const [{ sql, params }] = calls;
  assert.match(sql, /j\.requested_by = \?/, '受限用户只能看到自己的转存来源');
  assert.equal(placeholders(sql), params.length);
});

test('internal share details look up by id and college, leaving sender/recipient checks to the route', async () => {
  const expected = { id: 14, target_unit_id: 5, source_unit_id: 3 };
  const { calls, db } = fakeDb(() => [[expected]]);
  assert.deepEqual(await internalSharesDao.findShareInOrganization(db, { shareId: 14, orgId: 2 }), expected);
  assert.equal(placeholders(calls[0].sql), 2);
  assert.deepEqual(calls[0].params, [14, 2]);
});

test('internal share page uses the same copy and photo-owner scope for count and rows', async () => {
  const { calls, db } = fakeDb((sql) => [/^SELECT COUNT/.test(sql) ? [{ total: '2' }] : [{ id: 21 }]]);
  const page = await internalSharesDao.listSharePhotoPage(db, { orgId: 2, unitId: 5, userId: 7, ownPhotosOnly: true }, {
    source: { kind: 'copy', projectId: 6 }, limit: 1, offset: 1,
  });
  assert.deepEqual(page, { total: 2, photos: [{ id: 21 }] });
  assert.deepEqual(calls.map(call => call.params), [[6, 2, 5, 7], [6, 2, 5, 7, 1, 1]]);
  for (const { sql, params } of calls) {
    assert.equal(placeholders(sql), params.length);
    assert.match(sql, /ph\.unit_id = \? AND ph\.photographer_id = \?/);
  }
});

test('share and copy job inserts return IDs without a driver result packet', async () => {
  const { conn } = fakeDb(() => [{ insertId: 24, affectedRows: 1 }]);
  const options = { shareId: 12, orgId: 2, unitId: 3, targetUnitId: 4, requestedBy: 7 };
  assert.equal(await internalSharesDao.insertShare(conn, options), 24);
  assert.equal(await internalSharesDao.insertSystemCopyJob(conn, options), 24);
  assert.equal(await internalSharesDao.insertCopyJob(conn, options), 24);
});

test('organization catalog preserves legacy columns and keeps slug search in the same college', async () => {
  const { calls, db } = fakeDb((sql) => {
    if (sql.includes('information_schema.tables')) return [[{ cnt: 1 }]];
    if (sql.includes('information_schema.COLUMNS')) return [[{ COLUMN_NAME: 'slug' }]];
    return [[{ id: 2, name: 'College', slug: 'campus' }]];
  });
  assert.deepEqual(await organizationsDao.listOrganizationsForMember(db, {
    organizationId: 2, query: 'campus', limit: 50,
  }), [{ id: 2, name: 'College', slug: 'campus', is_public: true, description: null }]);
  assert.match(calls[2].sql, /WHERE id = \? AND \(name LIKE \? OR slug LIKE \?\)/);
  assert.deepEqual(calls[2].params, [2, '%campus%', '%campus%', 50]);
});
