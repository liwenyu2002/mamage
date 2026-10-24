const assert = require('node:assert/strict');
const { test } = require('node:test');
const express = require('express');
const { registerNewsParagraphRoutes } = require('../routes/news_paragraphs');
const { paragraphsFromMarkdown } = require('../lib/news_paragraphs');

test('paragraph jobs are durable, idempotent, owner-only and quota-bound', async () => {
  const jobs = [];
  let reservations = 0, enqueues = 0, reads = 0;
  const pool = { query: async (sql, params) => {
    reads++;
    if (sql.startsWith('SELECT id,options')) return [jobs.filter(job => job.userId === params[0] && job.clientId === params[1]).map(job => ({ id: job.id, options: job.options }))];
    if (sql.startsWith('INSERT INTO ai_jobs')) {
      jobs.push({ id: jobs.length + 1, userId: params[0], options: JSON.parse(params[4]), clientId: params[5], prompt: params[3] });
      return [{ insertId: jobs.length }];
    }
    if (sql.startsWith('SELECT j.id')) return [jobs.filter(job => job.userId === params[0] && job.clientId === params[1]).map(job => ({ id: job.id, status: 'pending' }))];
    throw new Error('Unexpected query');
  } };
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { req.user = { id: Number(req.get('x-user') || 7), organization_id: 2 }; next(); });
  const router = express.Router();
  registerNewsParagraphRoutes(router, { pool,
    requirePermission: () => (req, res, next) => req.get('x-role') === 'viewer' ? res.sendStatus(403) : next(),
    validateNewsSources: async (_req, id) => { if (id === 999) throw Object.assign(new Error('Not found'), { status: 404 }); return { enabled: true, unitId: 1 }; },
    checkAndReserveQuota: async () => { reservations++; }, enqueueJob: async () => { enqueues++; } });
  app.use('/api/ai/news', router);
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/ai/news`;
  const markdown = '# 摄影活动\n\n20名同学交流摄影作品。';
  const selection = paragraphsFromMarkdown(markdown)[0];
  const body = { markdown, start: selection.start, end: selection.end, mode: 'polish',
    form: { sourceMaterial: '20名同学交流摄影作品。https://private.invalid/secret' }, clientRequestId: 'synthetic-idempotency-001' };
  const post = (suffix, data, extra = {}) => fetch(base + suffix, { method: 'POST', headers: { 'content-type': 'application/json', ...extra }, body: JSON.stringify(data) });
  try {
    assert.equal((await post('/rewrite', body, { 'x-role': 'viewer' })).status, 403); assert.equal(reads, 0);
    assert.equal((await post('/rewrite', { ...body, projectId: 999 })).status, 404); assert.equal(reservations, 0);
    const replies = await Promise.all([post('/rewrite', body), post('/rewrite', body)]);
    assert.deepEqual(replies.map(reply => reply.status), [202, 202]);
    assert.equal(jobs.length, 1); assert.equal(reservations, 1); assert.equal(enqueues, 1);
    assert.ok(!jobs[0].prompt.includes('https://private.invalid'));
    assert.equal((await post('/rewrite', { ...body, mode: 'shorten' })).status, 409);
    assert.equal((await fetch(base + '/rewrites/' + body.clientRequestId)).status, 200);
    assert.equal((await fetch(base + '/rewrites/' + body.clientRequestId, { headers: { 'x-user': '8' } })).status, 404);
    assert.equal((await post('/sources', body)).status, 200);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
