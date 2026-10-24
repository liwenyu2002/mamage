const assert = require('node:assert/strict');
const { test } = require('node:test');
const { evaluatePhotoSearch } = require('../lib/photo_search_evaluation');

const dataset = {
  schemaVersion: 1, corpusPhotoIds: ['a', 'b', 'c'],
  queries: [{ id: 'clothes', q: '人物甲穿红衣', category: 'person-attribute', judgmentsComplete: true,
    grades: { a: 3, b: 1, c: 0 }, allowedPhotoIds: ['a', 'b'] }],
};

test('graded relevance, recall and immutable person constraints are evaluated separately', () => {
  const report = evaluatePhotoSearch(dataset, [{ id: 'clothes', list: [{ id: 'a' }, { id: 'b' }], elapsedMs: 100 }]);
  assert.equal(report.summary.precisionAt10, .2);
  assert.equal(report.summary.recallAt50, 1);
  assert.equal(report.summary.ndcgAt10, 1);
  assert.equal(report.summary.hardConstraintViolationRate, 0);
});

test('ranking the wrong person first fails the hard constraint and lowers nDCG', () => {
  const report = evaluatePhotoSearch(dataset, [{ id: 'clothes', photoIds: ['c', 'b', 'a'] }]);
  assert.equal(report.summary.hardConstraintViolationRate, 1);
  assert.deepEqual(report.runs[0].hardViolationIds, ['c']);
  assert.ok(report.summary.ndcgAt10 < 1);
});

test('incomplete judgments never masquerade as measured accuracy', () => {
  const unjudged = { ...dataset, queries: [{ id: 'clothes', grades: { a: 3 } }] };
  const report = evaluatePhotoSearch(unjudged, [{ id: 'clothes', photoIds: ['a', 'b'] }]);
  assert.equal(report.summary.precisionAt10, null);
  assert.equal(report.summary.recallAt50, null);
  assert.equal(report.summary.ndcgAt10, null);
  assert.equal(report.runs[0].judgedTop10, 1);
});

test('zero-match cases penalize any returned photo rather than rewarding an empty ground truth', () => {
  const empty = { ...dataset, queries: [{ id: 'none', judgmentsComplete: true, grades: { a: 0, b: 0, c: 0 } }] };
  assert.equal(evaluatePhotoSearch(empty, [{ id: 'none', photoIds: [] }]).runs[0].correctEmpty, true);
  assert.equal(evaluatePhotoSearch(empty, [{ id: 'none', photoIds: ['a'] }]).summary.falsePositiveEmptyQueries, 1);
  assert.equal(evaluatePhotoSearch(empty, [{ id: 'none', photoIds: [] }]).summary.recallAt50, null);
});

test('out-of-corpus results and duplicate hits are exposed instead of silently improving scores', () => {
  const report = evaluatePhotoSearch(dataset, [{ id: 'clothes', photoIds: ['a', 'a', 'outside'] }]);
  assert.equal(report.runs[0].duplicateIds, 1);
  assert.deepEqual(report.runs[0].outsideCorpus, ['outside']);
  assert.equal(report.summary.precisionAt10, null);
});

test('HTTP errors are not counted as correct empty results', () => {
  const empty = { ...dataset, queries: [{ id: 'none', judgmentsComplete: true, grades: { a: 0, b: 0, c: 0 } }] };
  const report = evaluatePhotoSearch(empty, [{ id: 'none', status: 500, photoIds: [] }]);
  assert.equal(report.summary.responseErrors, 1);
  assert.equal(report.runs[0].correctEmpty, null);
  assert.equal(evaluatePhotoSearch(empty, [{ id: 'none', status: 200 }]).runs[0].correctEmpty, null);
});

test('cold and cached response times are reported separately', () => {
  const report = evaluatePhotoSearch(dataset, [
    { id: 'clothes', photoIds: ['a'], elapsedMs: 100 },
    { id: 'clothes', photoIds: ['a'], elapsedMs: 300 },
    { id: 'clothes', photoIds: ['a'], elapsedMs: 20, search: { cached: true } },
  ]);
  assert.deepEqual(report.summary.latency.cold, { measured: 2, p50Ms: 100, p95Ms: 300 });
  assert.equal(report.summary.latency.warm.p50Ms, 20);
});

test('invalid and incomplete supposedly complete datasets are rejected', () => {
  assert.throws(() => evaluatePhotoSearch({ ...dataset, queries: [dataset.queries[0], dataset.queries[0]] }, []), /unique/);
  assert.throws(() => evaluatePhotoSearch({ ...dataset, queries: [{ ...dataset.queries[0], grades: { a: 3 } }] }, []), /explicitly grade/);
  assert.throws(() => evaluatePhotoSearch(dataset, [{ id: 'unknown' }]), /Missing judgments/);
});
