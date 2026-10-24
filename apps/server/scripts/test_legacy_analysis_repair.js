const { test } = require('node:test');
const assert = require('node:assert/strict');
const { repairLegacyAnalysis } = require('../lib/legacy_analysis_repair');
test('legacy repair is opt-in, preserves editorial fields and rejects concurrent changes', async () => {
  const row = { id: 1, url: '/test.jpg', ai_status: 'failed', ai_error: "model 'old' not found", ai_score: null,
    description: '人工摘要', detailed_description: '保留描述', updated_at: new Date() };
  let writes = 0, affected = 1, calls = 0;
  const pool = { query: async (sql) => {
    if (sql.startsWith('SELECT')) return [[row]];
    assert.doesNotMatch(sql, /SET[^]*?(?:description|tags|photographer_id|project_id)\s*=/);
    assert.match(sql, /updated_at=\?/); writes++; return [{ affectedRows: affected }];
  } };
  const options = { pool, ids: [1], buildUrl: value => value, analyze: async () => { calls++; return { score: 78, quality: { flags: [] } }; } };
  assert.equal((await repairLegacyAnalysis(options))[0].changed, false); assert.equal(calls, 0); assert.equal(writes, 0);
  assert.equal((await repairLegacyAnalysis({ ...options, apply: true }))[0].changed, true);
  affected = 0; await assert.rejects(repairLegacyAnalysis({ ...options, apply: true }), /CONCURRENT_CHANGE/);
  row.ai_status = 'done'; await assert.rejects(repairLegacyAnalysis({ ...options, apply: true }), /PRECONDITION/);
});
