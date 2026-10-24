const assert = require('node:assert/strict');
const { test } = require('node:test');
const { compareParagraphSources, paragraphsFromMarkdown, buildParagraphRewrite, validateParagraphRewrite } = require('../lib/news_paragraphs');

const input = { form: { sourceMaterial: '10月24日，学院举办摄影交流活动。20名同学分享了校园摄影作品。', confirmedParticipantNames: ['陈老师'] },
  interviewText: '陈老师说：“摄影需要细心观察生活。”', referenceArticle: '历史样文：校长宣布发放3000元奖励。' };
const markdown = '# 摄影交流\n\n20名同学分享了校园摄影作品，交流拍摄经验。\n\n学院决定向所有人发放3000元奖励。';

test('paragraph offsets preserve the rest of a manuscript and sources exclude historical style examples', () => {
  const report = compareParagraphSources(markdown, input);
  assert.equal(report.paragraphs.length, 2);
  for (const paragraph of report.paragraphs) assert.equal(markdown.slice(paragraph.start, paragraph.end), paragraph.text);
  assert.equal(report.paragraphs[0].references[0].label, '现场材料');
  assert.equal(report.paragraphs[1].references.length, 0);
  assert.ok(report.paragraphs[1].issues.some(issue => issue.type === 'unsupported_number'));
  assert.ok(!JSON.stringify(report).includes('历史样文'));
  assert.equal(paragraphsFromMarkdown('# 标题\n\n![图](https://private.invalid/token)\n\n正文。').length, 1);
});

test('rewrite inputs require an exact body paragraph, bounded materials and a valid action', () => {
  const selection = paragraphsFromMarkdown(markdown)[0];
  const result = buildParagraphRewrite({ ...input, markdown, ...selection, mode: 'shorten' });
  assert.ok(result.prompt.includes(selection.text));
  assert.ok(result.prompt.includes('原有直接引语保持原文'));
  assert.ok(!result.prompt.includes('历史样文'));
  for (const change of [{ start: selection.start + 1 }, { end: markdown.length + 1 }, { mode: 'invent' }, { form: {}, interviewText: '' }]) {
    assert.throws(() => buildParagraphRewrite({ ...input, markdown, ...selection, mode: 'polish', ...change }));
  }
});

test('changed quotations, unsupported numbers and leaked image links reject a generated rewrite', () => {
  const sourceText = input.form.sourceMaterial + '\n' + input.interviewText;
  assert.equal(validateParagraphRewrite('20名同学分享了校园摄影作品。', { sourceText }), '20名同学分享了校园摄影作品。');
  assert.throws(() => validateParagraphRewrite('3000名同学参加了活动。', { sourceText }), /缺乏依据/);
  assert.throws(() => validateParagraphRewrite('陈老师说：“摄影必须购买高级相机。”', { sourceText, original: input.interviewText }), /依据|引语/);
  assert.throws(() => validateParagraphRewrite('![图](https://private.invalid/token)', { sourceText }), /无效/);
  assert.throws(() => validateParagraphRewrite('# 全新标题\n\n全文', { sourceText }), /无效/);
});
