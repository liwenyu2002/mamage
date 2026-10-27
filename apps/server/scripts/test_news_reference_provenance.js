const { test } = require('node:test');
const assert = require('node:assert/strict');
const { referenceText, usedReferenceSnapshot } = require('../lib/news_reference_provenance');

test('only reference summaries actually included at generation are recorded with their version', () => {
  const article = { id: 12, revisionId: 34, title: '系列范例', analysis: { summary: '先写背景',
    lessons: [{ principle: '突出重点', application: '适合活动', caveat: '勿补造事实' }] } };
  const other = { ...article, id: 13, title: '未提交的范例' };
  assert.deepEqual(usedReferenceSnapshot({ monitorReferences: [article, other, article] }, `人工参考\n\n${referenceText(article)}`),
    [{ id: 12, revisionId: 34, title: '系列范例' }]);
  assert.deepEqual(usedReferenceSnapshot({ monitorReferences: [article] }, ''), []);
  assert.equal(usedReferenceSnapshot({}, ''), null);
  assert.deepEqual(usedReferenceSnapshot({ monitorReferences: [{ ...article, revisionId: null }] }, referenceText(article)), []);
});
