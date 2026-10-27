const { test } = require('node:test');
const assert = require('node:assert/strict');
const { assemblePrompt } = require('../routes/ai_news');
const { sourceEmoji, withoutAddedEmoji, cleanGeneratedDraft } = require('../lib/news_plain_text');

test('news and wechat draft prompts avoid decorative emoji and preserve quoted material', () => {
  const form = { sourceMaterial: '同学说：“加油🙂”。' };
  for (const channelName of ['新闻稿', '公众号图文']) {
    const prompt = assemblePrompt(form, [], '', '', { channelName });
    assert.match(prompt, /不要主动添加表情符号、颜文字或装饰性图标/);
    assert.match(prompt, /保留用户原文中需要逐字保留的直接引语/);
    assert.ok(prompt.includes(form.sourceMaterial));
  }
});

test('only newly introduced emoji are removed and supplied quotation content survives', () => {
  const allowed = sourceEmoji(['同学说：“加油🙂”。', '家庭👨‍👩‍👧‍👦']);
  assert.deepEqual(allowed, ['🙂', '👨‍👩‍👧‍👦']);
  assert.equal(withoutAddedEmoji('🎤同学说：“加油🙂”。1️⃣次，© 2026 👨‍👩‍👧‍👦', allowed),
    '同学说：“加油🙂”。1次，© 2026 👨‍👩‍👧‍👦');
  const result = cleanGeneratedDraft({ title: '💡活动', subtitle: '📣报道', markdown: '🎤正文\n“加油🙂”', html: 'old',
    placeholders: [{ id: 1, alt: '📸图题', caption: '现场🙂' }] }, allowed);
  assert.deepEqual(result, { title: '活动', subtitle: '报道', markdown: '正文\n“加油🙂”', html: '正文<br/>“加油🙂”',
    placeholders: [{ id: 1, alt: '图题', caption: '现场🙂' }] });
});
