const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

async function runAnalysis(result, missingColumn = false) {
  const queries = [];
  let handler;
  const dependencies = {
    '../db': { buildInternalMediaUrl: value => `http://fixture.invalid${value}`, pool: { query: async (sql, params) => {
      queries.push({ sql, params });
      if (sql.startsWith('SELECT url')) return [[{ url: '/original.jpg', thumb_url: '/thumb.jpg', type: 'normal' }]];
      if (missingColumn && sql.includes('detailed_description')) {
        throw Object.assign(new Error("Unknown column 'detailed_description' in 'field list'"), { code: 'ER_BAD_FIELD_ERROR' });
      }
      return [{ affectedRows: 1 }];
    } } },
    '../ai_function/ai_for_tags/ai_for_tags': {
      headRequest: async () => ({ statusCode: 200, headers: { 'content-type': 'image/jpeg' } }),
      analyzePhoto: async () => result,
    },
    './video_analysis': {}, './video_render': {}, './video_semantic_source': {},
    './background_task_failure': require('../lib/background_task_failure'),
    './distributed_runtime': { distributed: () => true, coordinator: { register: (kind, _lane, value) => { if (kind === 'semantic') handler = value; } } },
  };
  const module = { exports: {} };
  const filename = path.resolve(__dirname, '../lib/ai_tags_worker.js');
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module, exports: module.exports,
    require: key => { if (dependencies[key]) return dependencies[key]; throw new Error(`Unexpected dependency: ${key}`); },
    process: { env: {} }, console: { log() {}, warn() {}, error() {} },
    Buffer, setTimeout, clearTimeout, setImmediate,
  }, { filename });
  if (missingColumn || result.descriptionReviewError) {
    await assert.rejects(handler({ id: 77, force: true }, { attempt: 1 }), error => Boolean(error.code));
  } else await handler({ id: 77, force: true }, { attempt: 1 });
  return queries;
}

test('worker saves the new field separately without changing short description, score or photo ownership', async () => {
  const result = { description: '短摘要。', detailedDescription: '单独的详细白描。', tags: ['无人'], score: 61,
    quality: { reason: '普通记录。' }, ocrText: '清晰文字' };
  const queries = await runAnalysis(result);
  const saved = queries.find(q => q.sql.includes('detailed_description'));
  assert.ok(saved);
  assert.deepEqual(Array.from(saved.params), ['短摘要。', '单独的详细白描。', '["无人"]', 61, '{"reason":"普通记录。"}', '清晰文字', 77]);
  assert.equal((saved.sql.match(/\?/g) || []).length, saved.params.length);
  assert.match(saved.sql, /WHERE id = \?/);
  assert.doesNotMatch(saved.sql, /SET.*(?:project_id|organization_id|unit_id)\s*=/s);
});

test('legacy or failed review saves null rather than recycling an old detailed caption', async () => {
  const saved = (await runAnalysis({ description: '旧摘要。', tags: ['无人'] })).find(q => q.sql.includes('detailed_description'));
  assert.equal(saved.params[1], null);
  assert.match(saved.sql, /detailed_description = \?/);
});

test('missing migration reports failure instead of silently declaring a detailed caption saved', async () => {
  const queries = await runAnalysis({ description: '摘要。', detailedDescription: '详细描述。' }, true);
  assert.ok(queries.some(q => q.sql.includes('SET ai_status = ?') && q.params[0] === 'failed'));
  assert.ok(!queries.some(q => q.sql.startsWith('UPDATE photos SET description')));
  assert.ok(!queries.some(q => q.sql.includes("SET ai_status = 'done'")));
});

test('durable semantic review failures propagate for retry instead of falsely marking the task done', async () => {
  const error = require('../lib/background_task_failure').taskError('DESCRIPTION_REVIEW_UNAVAILABLE', {
    stage: 'review', cause: { code: 'HUB_TIMEOUT' },
  });
  const queries = await runAnalysis({ description: '短摘要', descriptionReviewError: error });
  assert.ok(queries.some(q => q.sql.includes("SET ai_status = 'pending'")));
  assert.ok(!queries.some(q => q.sql.includes('SET description =')));
  assert.ok(!queries.some(q => q.sql.includes("SET ai_status = 'done'")));
});

test('migration is additive, nullable and does not backfill or mutate existing photos', () => {
  const sql = fs.readFileSync(path.join(__dirname, 'migrations/20261015_001_photo_detailed_description.sql'), 'utf8');
  assert.match(sql, /ADD COLUMN detailed_description TEXT NULL/);
  assert.doesNotMatch(sql, /\b(?:UPDATE|DELETE|DROP|TRUNCATE)\b/i);
});
