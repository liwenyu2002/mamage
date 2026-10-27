const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeContentTemplate, addReviewPlaceholders, prepareReviewPlaceholders, buildTemplateRequest, generateContentTemplate } = require('../lib/wechat_content_template');

test('only known content templates can affect a WeChat job', () => {
  assert.equal(normalizeContentTemplate({ contentTemplate: 'unknown', reviewCredits: true }), null);
  assert.equal(normalizeContentTemplate({ contentTemplate: 'activity', reviewCredits: true }).id, 'activity');
  assert.equal(normalizeContentTemplate({ contentTemplate: 'auto', reviewCredits: 'true' }).reviewCredits, false);
  assert.equal(normalizeContentTemplate({ contentTemplate: 'custom', contentOutline: '' }), null);
  assert.equal(normalizeContentTemplate({ contentTemplate: 'custom', contentOutline: '导语\n活动过程' }).outline, '导语\n活动过程');
  assert.equal(normalizeContentTemplate({ contentTemplate: 'custom', contentOutline: 'a'.repeat(1200) }).outline.length, 1000);
});

test('AI structure requests require bounded input and return only an editable proposal', async () => {
  assert.throws(() => buildTemplateRequest({ material: '', reference: '' }), /请提供/);
  assert.throws(() => buildTemplateRequest({ material: 'x'.repeat(20001) }), /20000/);
  const input = buildTemplateRequest({ material: '学生进行交流', reference: '' });
  const client = { chat: { completions: { create: async () => ({ choices: [{ message: { content: '{"outline":"导语\\n活动过程\\n结尾"}' } }], usage: { total_tokens: 9 } }) } } };
  const result = await generateContentTemplate({ options: { 'content-template': input, inputFingerprint: input.fingerprint } }, { client });
  assert.equal(result.extra.plan.outline, '导语\n活动过程\n结尾');
  assert.equal(result.extra.fingerprint, input.fingerprint);
  assert.equal(result.tokens, 9);
  const invalid = { chat: { completions: { create: async () => ({ choices: [{ message: { content: '{"outline":"导语","extra":"不应出现"}' } }] }) } } };
  await assert.rejects(generateContentTemplate({ options: { 'content-template': input } }, { client: invalid }), /无效/);
});

test('review roles are empty by default, can be omitted and are never duplicated', () => {
  const template = normalizeContentTemplate({ contentTemplate: 'auto', reviewCredits: true });
  assert.equal(addReviewPlaceholders('正文', template), '正文\n\n初审：待填写\n\n终审：待填写');
  assert.equal(addReviewPlaceholders('正文\n\n初审：待填写', template), '正文\n\n初审：待填写\n\n终审：待填写');
  assert.equal(addReviewPlaceholders('正文\n\n初审：模型编造的姓名', template), '正文\n\n初审：待填写\n\n终审：待填写');
  assert.match(prepareReviewPlaceholders('正文\n\n初审：需要核对的原文', template).reviewNotes[0], /需要核对的原文/);
  assert.equal(addReviewPlaceholders('正文', { reviewCredits: false }), '正文');
  assert.equal(addReviewPlaceholders('', template), '');
});

test('custom structure is delimited as preference, not facts or an output protocol', async () => {
  process.env.DB_HOST = '127.0.0.1';
  process.env.DB_PORT = '1';
  process.env.DB_USER = 'isolated-test';
  process.env.DB_NAME = 'isolated_test';
  process.env.DB_PASSWORD = '';
  process.env.NODE_ENV = 'production';
  const { assemblePrompt } = require('../routes/ai_news');
  const { pool } = require('../db');
  try {
    const contentTemplate = normalizeContentTemplate({ contentTemplate: 'custom', contentOutline: '导语\n活动过程', reviewCredits: true });
    const prompt = assemblePrompt({ sourceMaterial: '已有活动材料' }, [], '', '', { channelName: '公众号图文', contentTemplate });
    assert.match(prompt, /<<<SRC content_structure>>>\n导语\n活动过程\n<<<END content_structure>>>/);
    assert.match(prompt, /结构中的示例不作为事实来源/);
    assert.match(prompt, /不要自行生成初审、终审署名或姓名/);
    assert.doesNotMatch(assemblePrompt({}, [], '', '', {}), /内容结构要求/);
  } finally { await pool.end(); }
});
