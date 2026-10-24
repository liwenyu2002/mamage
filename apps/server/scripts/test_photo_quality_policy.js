const assert = require('node:assert/strict');
const { test } = require('node:test');
const { DatabaseSync } = require('node:sqlite');
const { qualityFilterSql } = require('../lib/photo_quality_policy');

test('real search predicates partition scored photos and preserve fatal-defect labels', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('CREATE TABLE photos (id INTEGER PRIMARY KEY, ai_score REAL, tags TEXT)');
    const insert = db.prepare('INSERT INTO photos VALUES (?, ?, ?)');
    [[1, 40, []], [2, 41, ['AI medium']], [3, 54, ['AI medium']],
      [4, 55, []], [5, 74, []], [6, 75, []], [7, 45, ['AI rejected']],
      [8, null, []], [9, null, ['AI recommended']], [10, 80, ['AI rejected', 'AI recommended']],
      [11, 50, ['不推荐']], [12, 54, ['中等']], [13, 60, ['不推荐背景']]]
      .forEach(([id, score, tags]) => insert.run(id, score, JSON.stringify(tags)));
    const ids = label => db.prepare(`SELECT id FROM photos p WHERE ${qualityFilterSql(label)} ORDER BY id`).all().map(row => row.id);
    assert.deepEqual(ids('rejected'), [1, 7, 10, 11]);
    assert.deepEqual(ids('medium'), [2, 3, 4, 5, 12, 13]);
    assert.deepEqual(ids('recommended'), [6, 9]);
    const all = ['rejected', 'medium', 'recommended'].flatMap(ids);
    assert.equal(new Set(all).size, all.length, 'a photo must never belong to two quality buckets');
    assert.ok(!all.includes(8), 'unanalysed photos must not be labelled medium');
  } finally { db.close(); }
});
