const assert = require('node:assert/strict');
const { test } = require('node:test');
const express = require('express');
const rows = [];
const mock = (name, exports) => {
  const id = require.resolve(name); require.cache[id] = { id, filename: id, loaded: true, exports };
};
mock('../db', { pool: { query: async (sql, params) => {
  const owned = () => rows.filter(row => row.id === params[0] && row.user_id === params[1] && row.unit_id === params[2]);
  if (sql.includes('SELECT COUNT(*)')) return [[{ cnt: rows.filter(row => row.user_id === params[0] && row.unit_id === params[1]).length }]];
  if (sql.includes('INSERT INTO wechat_compositions')) {
    const [user_id, org_id, unit_id, name, title, digest, doc, block_config, theme_key, block_count, image_count, draft_kind, source_document] = params;
    rows.push({ id: rows.length + 1, user_id, org_id, unit_id, name, title, digest, doc, block_config, theme_key, block_count, image_count, draft_kind, source_document,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString() }); return [{ insertId: rows.length }];
  }
  if (sql.includes('SELECT id, name, title, draft_kind')) return [rows.filter(row => row.user_id === params[0] && row.unit_id === params[1])];
  if (sql.includes('SELECT *') || sql.includes('SELECT id, draft_kind') || sql.startsWith('SELECT id FROM')) return [owned()];
  if (sql.startsWith('SELECT id, name,')) return [rows.filter(row => row.id === params[0])];
  if (sql.startsWith('UPDATE wechat_compositions SET')) {
    const id = params.at(-2), user = params.at(-1), row = rows.find(item => item.id === id && item.user_id === user);
    const fields = sql.slice(sql.indexOf(' SET ') + 5, sql.indexOf(' WHERE ')).split(', ').filter(field => field.endsWith('= ?')).map(field => field.split(' = ')[0]);
    fields.forEach((field, index) => { row[field] = params[index]; }); return [{ affectedRows: row ? 1 : 0 }];
  }
  if (sql.startsWith('DELETE FROM')) { const index = rows.findIndex(row => row.id === params[0] && row.user_id === params[1]); rows.splice(index, 1); return [{ affectedRows: 1 }]; }
  throw Error(`Unexpected query: ${sql}`);
} } });
mock('../lib/permissions', { requirePermission: () => (req, res, next) => req.get('x-role') === 'viewer' ? res.sendStatus(403) : next() });
mock('../lib/workspace_access', { resolveWorkspace: async req => ({ enabled: true, unitId: Number(req.get('x-space') || 1) }), sendWorkspaceError: () => false });
mock('../lib/cos_storage', { isConfigured: () => false });
mock('../lib/ai_job_worker', { enqueueJob: async () => {} });
mock('../lib/ai_quota', { checkAndReserveQuota: async () => {} });
const router = require('../routes/wechat_compositions');

test('content and styled backups retain independent snapshots, preserve old layout archives and enforce ownership', async () => {
  const app = express(); app.use(express.json({ limit: '1mb' }));
  app.use((req, _res, next) => { req.user = { id: Number(req.get('x-user') || 7), organization_id: 2 }; next(); });
  app.use('/api/wechat-compositions', router);
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/wechat-compositions`;
  const call = (method, path, body, headers = {}) => fetch(base + path, { method, headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const doc = [{ uid: 'p1', kind: 'para', html: '内容稿原文' }];
  const source = { title: '活动原文', markdown: '内容稿原文\n\n![图注](/image.jpg)', photos: [{ id: 1 }] };
  try {
    assert.equal((await call('POST', '', { draftKind: 'content', doc })).status, 400);
    assert.equal((await call('POST', '', { draftKind: 'other', doc })).status, 400);
    assert.equal((await call('POST', '', { draftKind: 'content', doc, sourceDocument: source }, { 'x-role': 'viewer' })).status, 403);
    const content = await call('POST', '', { draftKind: 'content', name: '内容备份', title: source.title, doc, sourceDocument: source });
    assert.equal(content.status, 201); const contentId = (await content.json()).id;
    const styledDoc = [{ ...doc[0], blockId: 'builtin-body-plain' }];
    const layout = await call('POST', '', { name: '旧式排版存档', title: '不同的排版标题', doc: styledDoc, blockConfig: { accent: '#277a70' } });
    assert.equal(layout.status, 201); const layoutId = (await layout.json()).id;
    const list = await (await call('GET', '')).json();
    assert.deepEqual(list.items.map(item => item.draftKind), ['content', 'layout']);
    assert.equal(list.items.some(item => 'sourceDocument' in item || 'doc' in item), false, 'list remains lightweight');
    assert.deepEqual((await (await call('GET', '/' + contentId)).json()).sourceDocument, source);
    assert.deepEqual((await (await call('GET', '/' + layoutId)).json()).doc, styledDoc);
    assert.equal((await call('PUT', '/' + contentId, { draftKind: 'layout' })).status, 400);
    assert.equal((await call('PUT', '/' + contentId, { sourceDocument: null })).status, 400);
    assert.equal((await call('PUT', '/' + layoutId, { sourceDocument: source })).status, 200);
    assert.equal((await (await call('GET', '/' + contentId)).json()).title, source.title, 'styled changes do not affect content');
    for (const headers of [{ 'x-user': '8' }, { 'x-space': '3' }]) {
      for (const [method, body] of [['GET', undefined], ['PUT', { name: 'hijack' }], ['DELETE', undefined]]) {
        assert.equal((await call(method, '/' + contentId, body, headers)).status, 404);
      }
      assert.deepEqual((await (await call('GET', '', undefined, headers)).json()).items, []);
    }
    assert.equal((await call('DELETE', '/' + contentId)).status, 200);
    assert.equal((await (await call('GET', '/' + layoutId)).json()).title, '不同的排版标题', 'deleting one backup leaves the other draft type alone');
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
