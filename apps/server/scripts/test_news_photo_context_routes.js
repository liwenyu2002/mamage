const assert = require('node:assert/strict');
const { test } = require('node:test');
const express = require('express');
const mock = (name, exports) => {
  const id = require.resolve(name); require.cache[id] = { id, filename: id, loaded: true, exports };
};
const jobs = [], batches = [];
let reservations = 0, faceAllowed = true, personName = '当前人物';
const db = { query: async (sql, args) => {
  if (sql.includes('SELECT ph.id,')) return [args[0].every(id => id === 1) ? [{ id: 1, project_id: 10, organization_id: 1, unit_id: 2 }] : []];
  if (sql.startsWith('SELECT id, organization_id')) return [[{ id: 10, organization_id: 1, unit_id: 2 }]];
  if (sql.includes('SELECT p.id,p.project_id')) return [[{ id: 1, project_id: 10, description: '服务器摘要', detailed_description: '服务器详细描述' }]];
  if (sql.includes('SELECT id,name,event_date')) return [[{ id: 10, name: '服务器相册', event_date: '2026-11-03', description: '服务器背景' }]];
  if (sql.includes('FROM project_timeline_sections')) return [[{ id: 11, project_id: 10, name: '服务器环节', sort_order: 1 }]];
  if (sql.includes('FROM face_search_grants')) return [[{ college_wide: faceAllowed ? 1 : 0 }]];
  if (sql.includes('FROM org_presets')) return [[]];
  if (sql.startsWith('SELECT id,options')) return [[]];
  if (sql.startsWith('INSERT INTO ai_job_batches')) { batches.push(args); return [{ insertId: 1 }]; }
  if (sql.startsWith('INSERT INTO ai_jobs')) {
    jobs.push(args); return [{ insertId: jobs.length }];
  }
  throw Error(`Unexpected SQL: ${sql}`);
} };
db.getConnection = async () => ({ query: db.query, beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release() {} });
mock('../db', { pool: db });
mock('../lib/ai_job_worker', { enqueueJob: async () => {} });
mock('../lib/permissions', { requirePermission: () => (_req, _res, next) => next() });
mock('../lib/ai_quota', { checkAndReserveQuota: async () => { reservations++; } });
mock('../lib/channel_templates', { getActiveTemplates: async () => [{ channel_key: 'wechat_article', name: '公众号' }] });
mock('../lib/news_auto_references', { selectReferences: async (_db, _space, form) => ({ form, text: '', status: 'none' }) });
mock('../lib/shared_runtime_state', { createSharedStore: () => ({ withLock: async (_key, run) => run() }) });
mock('../lib/news_preview_renderer', {});
mock('../lib/photo_person_observations', {
  loadPhotoFaces: async () => [{ id: 9, photoId: 1 }], readObservations: async () => new Map(),
  presentPeople: () => [{ faceId: 9, faceNo: 1, personId: 21, personName, identityStatus: 'auto', status: 'not-analyzed' }],
});
const access = require('../lib/workspace_access');
const news = require('../routes/ai_news');
const wechat = express.Router();
require('../routes/wechat_layout').registerWechatLayoutRoutes(wechat, { pool: db,
  requirePermission: () => (_req, _res, next) => next(), resolveWorkspace: access.resolveWorkspace,
  sendWorkspaceError: access.sendWorkspaceError, enqueueJob: async () => {}, checkAndReserveQuota: async () => { reservations++; } });
async function submit(router, path, body) {
  const handler = router.stack.find(layer => layer.route?.path === path && layer.route.methods.post).route.stack.at(-1).handle;
  const res = { statusCode: 200, status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; return this; } };
  await handler({ user: { id: 5, organization_id: 1 }, workspace: { enabled: true, userId: 5, orgId: 1, unitId: 2, role: 'editor' },
    body, query: {}, get() {} }, res);
  return res;
}
const material = { selectedPhotos: [{ id: 1, description: '浏览器伪造摘要', faceNames: ['过期姓名'] }], form: { sourceMaterial: '活动现场' },
  channels: ['wechat_article'], photoContext: { rules: '客户端伪造上下文' } };
const revision = { ...material, source: { title: '文章', blocks: [{ uid: 'b-1', type: 'paragraph', text: '活动现场。' }] },
  mode: 'polish', instruction: '润色', clientRequestId: 'news-hydration-revision-1' };
const paragraph = { ...material, markdown: '活动现场。', start: 0, end: 5, mode: 'polish', clientRequestId: 'news-hydration-paragraph-1' };
const containsContext = prompt => {
  assert.match(prompt, /服务器摘要/); assert.match(prompt, /服务器详细描述/); assert.match(prompt, /服务器环节/);
  assert.match(prompt, /当前人物/); assert.doesNotMatch(prompt, /浏览器伪造摘要|过期姓名|客户端伪造上下文/);
};

test('preview, generate and batch send authorized authoritative context even for fullPrompt', async () => {
  for (const fullPrompt of [undefined, '用户自定义写作要求']) {
    const result = await submit(news, '/preview', { ...material, fullPrompt });
    assert.equal(result.statusCode, 200); containsContext(result.body.assembledPrompt);
    assert.equal((await submit(news, '/generate', { ...material, fullPrompt })).statusCode, 202);
    containsContext(jobs.at(-1)[5]);
  }
  assert.equal((await submit(news, '/generate/batch', material)).statusCode, 202);
  containsContext(jobs.at(-1)[5]);
  assert.deepEqual(JSON.parse(batches.at(-1)[3]).selectedPhotos[0].faceNames, ['当前人物']);
});

test('both revision routes hydrate selected photos without turning AI context into confirmed facts', async () => {
  assert.equal((await submit(wechat, '/revision', revision)).statusCode, 202);
  containsContext(jobs.at(-1)[2]);
  const options = JSON.parse(jobs.at(-1)[3]);
  assert.doesNotMatch(options.revision.sourceText, /当前人物|服务器详细描述/);
  assert.equal((await submit(news, '/rewrite', paragraph)).statusCode, 202);
  containsContext(jobs.at(-1)[3]);
  assert.doesNotMatch(JSON.parse(jobs.at(-1)[4]).rewrite.sourceText, /当前人物|服务器详细描述/);
});

test('inaccessible or deleted photos fail every route before quota reservation or jobs', async () => {
  const beforeJobs = jobs.length, beforeQuota = reservations;
  for (const [router, path, body] of [[news, '/preview', material], [news, '/generate', { ...material, fullPrompt: 'test' }],
    [news, '/generate/batch', material], [wechat, '/revision', revision], [news, '/rewrite', paragraph]]) {
    assert.equal((await submit(router, path, { ...body, selectedPhotos: [{ id: 999 }] })).statusCode, 404, path);
  }
  assert.equal(jobs.length, beforeJobs); assert.equal(reservations, beforeQuota);
});

test('server grant removal suppresses face metadata in model inputs and batch snapshot', async () => {
  faceAllowed = false;
  try {
    assert.equal((await submit(news, '/generate/batch', material)).statusCode, 202);
    assert.doesNotMatch(jobs.at(-1)[5], /当前人物|过期姓名/);
    assert.deepEqual(JSON.parse(batches.at(-1)[3]).selectedPhotos[0].faceNames, []);
    assert.equal((await submit(wechat, '/revision', revision)).statusCode, 202);
    assert.doesNotMatch(jobs.at(-1)[2], /当前人物|过期姓名/);
  } finally { faceAllowed = true; }
});

test('revisions rehydrate current names instead of browser snapshots', async () => {
  personName = '改名后的当前人物';
  try {
    assert.equal((await submit(wechat, '/revision', revision)).statusCode, 202);
    assert.match(jobs.at(-1)[2], /改名后的当前人物/);
  } finally { personName = '当前人物'; }
});

test('oversized combined context fails preview and generation rather than truncating it', async () => {
  const before = jobs.length;
  for (const path of ['/preview', '/generate']) {
    assert.equal((await submit(news, path, { ...material, fullPrompt: 'x'.repeat(99999) })).statusCode, 413);
  }
  assert.equal(jobs.length, before);
});
