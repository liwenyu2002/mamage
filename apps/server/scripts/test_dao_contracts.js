// dao 层契约测试：用假 db 记录 SQL 与参数，锁住几类"容易悄悄错位"的约定：
// 1) 占位符数量必须与参数个数一致（updated_at 这类附加参数最容易漏）；
// 2) 写操作返回 affectedRows 数字而不是原始元组（调用方不再解构）；
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
