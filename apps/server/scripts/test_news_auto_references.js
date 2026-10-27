const { test } = require('node:test');
const assert = require('node:assert/strict');
const { findAutoReferences, selectReferences } = require('../lib/news_auto_references');
const { referenceText, usedReferenceSnapshot } = require('../lib/news_reference_provenance');

const workspace = { orgId: 1, unitId: 2, enabled: true };
const item = (id, title, scene, summary) => ({ id, title, scene, current_revision_id: id + 100,
  plain_text: title,
  analysis: JSON.stringify({ summary, lessons: [{ principle: '保持事实准确' }] }) });
const rows = [item(1, '读书分享活动', 'events', '围绕交流活动展开叙述'),
  item(2, '冰雪运动盛会', 'events', '报道活动现场'), item(3, '读书笔记交流会', 'events', '记录实践交流的活动过程')];
const db = { async query(sql, params) {
  assert.match(sql, /a\.scope_key = \?/);
  assert.match(sql, /n\.revision_id = a\.current_revision_id/);
  assert.match(sql, /r\.article_id = a\.id/);
  assert.match(sql, /a\.published_at > 0 AND a\.published_at <= \?/);
  assert.match(sql, /a\.source_url LIKE 'https:\/\/mp\.weixin\.qq\.com\/s%'/);
  assert.equal(params[0], '1:2');
  return [rows.filter(row => row.id > params[1])];
} };

test('automatic references are relevant, versioned and exactly included in the prompt', async () => {
  const selected = await selectReferences(db, workspace, { sourceMaterial: '学生分享读书笔记，参加读书交流活动', monitorReferences: [] }, '', '', 20000);
  assert.equal(selected.status, 'automatic');
  assert.deepEqual(selected.form.monitorReferences.map(row => row.id), [3]);
  assert.deepEqual(usedReferenceSnapshot(selected.form, selected.text).map(row => row.revisionId), [103]);
  assert.match(selected.text, /写作原则：保持事实准确/);
});

test('manual choice takes priority without querying the library', async () => {
  const choice = { id: 9, revisionId: 10, title: '手选文章', analysis: { summary: '先写活动背景' } };
  const text = referenceText(choice);
  const result = await selectReferences({ query() { throw Error('unexpected query'); } }, workspace,
    { monitorReferences: [choice] }, text, '', 20000);
  assert.equal(result.status, 'manual');
  assert.equal(result.text, text);
});

test('no suitable reference, unavailable library and full input are distinct', async () => {
  const noMatch = await selectReferences(db, workspace, { sourceMaterial: '量子计算芯片实验' }, '', '', 20000);
  assert.equal(noMatch.status, 'no_match');
  const sameSceneOnly = await selectReferences(db, workspace, { sourceMaterial: '学生开展校园交流活动' }, '', '', 20000);
  assert.equal(sameSceneOnly.status, 'no_match', 'the same broad scene alone cannot qualify a reference');
  const unavailable = await selectReferences({ async query() { throw Object.assign(Error('offline'), { code: 'OFFLINE' }); } },
    workspace, { sourceMaterial: '交流活动' }, '', '', 20000);
  assert.equal(unavailable.status, 'unavailable');
  const full = await selectReferences(db, workspace, { sourceMaterial: '读书笔记交流' }, '已有材料', '', 4);
  assert.equal(full.status, 'reference_limit');
  assert.equal(full.text, '已有材料');
});

test('all authorized pages are considered rather than stopping at the first batch', async () => {
  const first = Array.from({ length: 500 }, (_, i) => item(i + 1, '无关招聘', 'recruitment', '职位信息'));
  const paged = { async query(sql, params) { return [params[1] === 0 ? first : params[1] === 500 ? [item(501, '读书笔记交流', 'events', '活动现场')] : []]; } };
  const result = await findAutoReferences(paged, workspace, { sourceMaterial: '读书笔记交流活动' }, '');
  assert.equal(result[0].id, 501);
});
