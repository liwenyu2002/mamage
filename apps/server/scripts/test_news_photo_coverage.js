const assert = require('node:assert/strict');
const { test } = require('node:test');

let response = { title: '活动', markdown: '# 活动\n\n现场交流。\n\n![现场](PHOTO:1)', photos: [{ id: 1, alt: '现场' }] };
const openai = require.resolve('openai');
require.cache[openai] = { id: openai, filename: openai, loaded: true, exports: {
  OpenAI: class { constructor() { this.chat = { completions: { create: async () => ({
    choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(response) } }], usage: { total_tokens: 100 },
  }) } }; } },
} };
process.env.AI_TEXT_API_KEY = 'local-test-not-a-key';
const { generateFromPrompt } = require('../ai_function/ai_for_news/ai_for_news');
const { completeSelectedPhotos } = require('../lib/news_photo_coverage');

test('generated WeChat draft includes every selected photo when the model omits photos', async () => {
  const result = await generateFromPrompt({ prompt: '校园交流活动', options: {
    channelKey: 'wechat_article', channelTemplate: { channel_key: 'wechat_article', prompt_fragments: {} },
    selectedPhotos: [1, 2, 3].map(id => ({ id, description: '现场照片' })),
  } });
  assert.deepEqual([...result.markdown.matchAll(/PHOTO:(\d+)/g)].map(match => Number(match[1])).sort(), [1, 2, 3]);
  assert.deepEqual(result.placeholders.map(photo => Number(photo.id)).sort(), [1, 2, 3]);
});

test('30 selected photos survive partial output, duplicate and invented IDs and appear before credits', () => {
  const selected = Array.from({ length: 30 }, (_, i) => ({ id: i + 1, photographerId: 9 }));
  const result = completeSelectedPhotos('# 活动\n\n![已知图题](PHOTO:1)![重复](PHOTO:1)![另一张](PHOTO:2)\n\n![不存在](PHOTO:999)\n\n![外部](https://example.invalid/img.jpg)\n\n初审：待填写\n终审：待填写', selected);
  const ids = [...result.markdown.matchAll(/PHOTO:(\d+)/g)].map(match => Number(match[1]));
  assert.deepEqual(ids, selected.map(p => p.id));
  assert.equal(result.coverage.completed, 28);
  assert.equal(result.placeholders.length, 30);
  assert(result.placeholders.every(p => p.photographerId === 9 && p.url === null));
  assert.match(result.markdown, /!\[已知图题\]\(PHOTO:1\)/);
  assert.match(result.markdown, /!\[\]\(PHOTO:30\)[\s\S]*初审：待填写/);
  assert.doesNotMatch(result.markdown, /PHOTO:999|example.invalid|重复/);
  assert.deepEqual(completeSelectedPhotos(result.markdown, selected).markdown, result.markdown);
});
test('zero photos stays text-only, no photos are invented from model metadata', async () => {
  response = { title: '活动', markdown: '# 活动\n\n交流。\n\n![图](PHOTO:9)', photos: [{ id: 9, url: 'https://example.invalid' }] };
  const result = await generateFromPrompt({ prompt: '活动', options: { selectedPhotos: [] } });
  assert.doesNotMatch(result.markdown, /PHOTO:|example.invalid/);
  assert.deepEqual(result.placeholders, []);
});
