const assert = require('node:assert/strict');
const fs = require('node:fs');
const { performance } = require('node:perf_hooks');
const { resolveSearchIntent } = require('../lib/photo_search_intent');
const { judgeEvidence } = require('../lib/person_visual_evidence');
const fixture = require('./fixtures/ai-regression.json');

function runRegression() {
  const started = performance.now();
  const cases = [];
  function check(id, run) {
    try { run(); cases.push({ id, passed: true }); }
    catch { cases.push({ id, passed: false }); }
  }
  for (const item of fixture.intents) check(item.id, () => {
    const plan = resolveSearchIntent(item.query, {}, fixture.people);
    assert.deepEqual(plan.people, item.people); assert.deepEqual(plan.excludePeople, item.excludePeople);
    if (Object.hasOwn(item, 'personCount')) assert.equal(plan.personCount, item.personCount);
    if (item.mustInclude) assert.ok(plan.mustTerms.includes(item.mustInclude));
    if (item.excludeInclude) assert.ok(plan.excludeTerms.includes(item.excludeInclude));
    if (item.mustNotInclude) assert.ok(!plan.mustTerms.includes(item.mustNotInclude));
  });
  for (const item of fixture.visual) check(item.id, () => assert.equal(judgeEvidence(item, item.evidence), item.expected));
  return { createdAt: new Date().toISOString(), source: 'deterministic-contracts',
    cases: cases.length, passed: cases.filter(item => item.passed).length,
    failed: cases.filter(item => !item.passed).map(item => item.id), elapsedMs: Math.round(performance.now() - started),
    humanAccuracy: null, release: process.env.MAMAGE_RELEASE_SHA || null, expiresAt: Date.now() + 366 * 86400000 };
}

async function main() {
  const result = runRegression();
  const args = process.argv.slice(2), index = args.indexOf('--output');
  if (index >= 0) fs.writeFileSync(args[index + 1], JSON.stringify(result, null, 2) + '\n', { mode: 0o600 });
  if (args.includes('--publish')) {
    const { pool } = require('../db');
    try { await pool.query(`INSERT INTO runtime_state (namespace,state_key,payload,expires_at) VALUES ('operations','regression:latest',?,?)
      ON DUPLICATE KEY UPDATE payload=VALUES(payload),expires_at=VALUES(expires_at)`, [JSON.stringify(result), result.expiresAt]); }
    finally { await pool.end(); }
  }
  console.log(JSON.stringify(result));
  if (result.failed.length) process.exitCode = 1;
}
if (require.main === module) void main().catch(error => { console.error(error.code || 'AI_REGRESSION_FAILED'); process.exitCode = 1; });
module.exports = { runRegression };
