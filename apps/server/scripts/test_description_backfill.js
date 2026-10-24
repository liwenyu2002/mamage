const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function fixture({ fail = false, removed = false } = {}) {
  const handlers = new Map(), queries = [];
  const dependencies = {
    '../db': { buildInternalMediaUrl: value => `http://internal.invalid${value}`, pool: { query: async (sql, params) => {
      queries.push({ sql, params });
      if (sql.startsWith('SELECT id,url')) return [removed ? [] : [{ id: 77, url: '/original.jpg', thumb_url: '/thumb.jpg' }]];
      return [{ affectedRows: 1 }];
    } } },
    '../ai_function/ai_for_tags/ai_for_tags': { analyzeDescriptions: async url => {
      assert.equal(url,'http://internal.invalid/thumb.jpg');
      if (fail) throw Error('review unavailable');
      return { description: '新的短摘要', detailedDescription: '新的详细白描' };
    } },
    './video_analysis': {}, './video_render': {}, './video_semantic_source': {},
    './background_task_failure': require('../lib/background_task_failure'),
    './distributed_runtime': { distributed: () => true, coordinator: { register: (kind, lane, handler) => {
      assert.equal(lane,'vision'); handlers.set(kind,handler);
    } } },
  };
  const filename = path.resolve(__dirname,'../lib/ai_tags_worker.js');
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename,'utf8'), { module, exports: module.exports,
    require: key => { if (!dependencies[key]) throw Error(`Unexpected dependency ${key}`); return dependencies[key]; },
    process: { env: {} }, console, Buffer, setTimeout, clearTimeout, setImmediate,
  });
  return { run: () => handlers.get('photo-description')({ photoId:77 }), queries };
}

test('historical refresh changes only two caption fields and rejects a changed photo source', async () => {
  const f = fixture(); await f.run();
  const write = f.queries.find(query => query.sql.startsWith('UPDATE'));
  assert.match(write.sql,/SET description=\?,detailed_description=\?/);
  assert.match(write.sql,/url <=> \? AND thumb_url <=> \?/);
  assert.deepEqual(Array.from(write.params),['新的短摘要','新的详细白描',77,'/original.jpg','/thumb.jpg']);
  assert.doesNotMatch(write.sql,/\b(?:tags|ocr_text|ai_score|ai_quality|person_id|ai_status)\s*=/i);
});

test('review failure and deleted photos preserve existing captions without partial writes', async () => {
  const failed = fixture({ fail:true });
  await assert.rejects(failed.run(),/review unavailable/);
  assert.ok(!failed.queries.some(query => query.sql.startsWith('UPDATE')));
  const removed = fixture({ removed:true }); await removed.run();
  assert.ok(!removed.queries.some(query => query.sql.startsWith('UPDATE')));
});
