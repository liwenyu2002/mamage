const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const babel = require('@babel/core');
const loaded = new Map();
function load(relativePath) {
  const file = path.resolve(__dirname, '..', relativePath);
  if (loaded.has(file)) return loaded.get(file).exports;
  const instance = new Module(file, module);
  loaded.set(file, instance);
  instance.filename = file;
  instance.paths = Module._nodeModulePaths(path.dirname(file));
  instance.require = name => name.startsWith('.')
    ? load(path.relative(path.resolve(__dirname, '..'), path.resolve(path.dirname(file), `${name}.js`))) : require(name);
  instance._compile(babel.transformSync(fs.readFileSync(file, 'utf8'), {
    filename: file, presets: [['@babel/preset-env', { targets: { node: 'current' } }]],
  }).code, file);
  return instance.exports;
}
const { newsDraftKey, importLegacyNewsDraft, formatNewsDate, archiveNewsContent, resolveNewsPhotos,
  hasNewsSource, newsMaterialFromForm, restoreNewsForm } = load('src/utils/newsWriterState.js');
const { pollNewsBatch } = load('src/services/newsBatchPolling.js');

test('drafts are scoped by user and workspace; anonymous users do not restore a shared draft', () => {
  assert.notEqual(newsDraftKey(1, 2), newsDraftKey(2, 2));
  assert.notEqual(newsDraftKey(1, 2), newsDraftKey(1, 3));
  assert.equal(newsDraftKey(null, 2), null);
});
test('pasted material is sufficient without repeating date, title or people in form fields', () => {
  assert.equal(hasNewsSource({ sourceMaterial: '10月12日，学生介绍实践作品，教师点评。' }), true);
  assert.equal(hasNewsSource({ highlights: '旧表单里的现场情况' }), true);
  assert.equal(hasNewsSource({}, '采访记录'), true);
  assert.equal(hasNewsSource({ eventName: '仅有相册名称', sourceMaterial: '  ' }), false);
  assert.equal(newsMaterialFromForm({ eventName: '作品展示', highlights: '学生展示作品' }),
    '活动：作品展示\n活动情况：学生展示作品');
  assert.equal(newsMaterialFromForm({}), '');
});
test('old form facts are visible in material and cannot remain as hidden overrides', () => {
  const restored = restoreNewsForm({ eventName: '旧活动', eventDate: '2026-10-12', location: '报告厅', highlights: '学生展示作品' });
  assert.match(restored.sourceMaterial, /日期：2026-10-12/);
  assert.match(restored.sourceMaterial, /学生展示作品/);
  assert.equal(restored.eventName, '');
  assert.equal(restored.highlights, '');
  assert.equal(restored.eventDate, null);
  const current = restoreNewsForm({ sourceMaterial: '新的材料', location: '人工补充地点', eventDate: '2026-10-12' });
  assert.equal(current.location, '人工补充地点');
  assert.equal(formatNewsDate(current.eventDate), '2026-10-12');
});
test('dates retain their local calendar day and history retains the edited previous draft', () => {
  assert.equal(formatNewsDate(new Date(2026, 9, 12, 0, 0)), '2026-10-12');
  assert.equal(formatNewsDate('2026-10-12'), '2026-10-12');
  const history = archiveNewsContent({ title: 'Edited', markdownText: 'My edited copy', history: Array(8).fill({ markdownText: 'old' }) });
  assert.equal(history.length, 5);
  assert.equal(history[0].markdownText, 'My edited copy');
  assert.equal(history[0].history, undefined);
});
test('manual legacy import preserves the manuscript without confirming machine-recognized people', () => {
  const content = { press_release: { markdownText: '保留人工修改' } };
  const imported = importLegacyNewsDraft({ channelContent: content, participantChips: ['识别候选'],
    advancedPrompt: '旧版完整提示词', batchId: 123 });
  assert.equal(imported.channelContent.press_release.markdownText, '保留人工修改');
  assert.equal(imported.channelContent.press_release.generatedHtml, '');
  assert.equal(imported.channelContent.press_release.factCheck, null);
  assert.deepEqual(imported.participantChips, []);
  assert.equal(imported.advancedPrompt, '');
  assert.equal(imported.batchId, undefined);
  assert.throws(() => importLegacyNewsDraft(null));
});
test('PHOTO replacement supports relative media URLs and preserves captions without nested markdown', () => {
  assert.equal(resolveNewsPhotos('![现场图](PHOTO:7)', [{ id: 7, url: '/api/image/photo.jpg?ma=signature' }]),
    '![现场图](/api/image/photo.jpg?ma=signature)');
  assert.equal(resolveNewsPhotos('![现场图](PHOTO:7)', [{ id: 7, url: 'javascript:alert(1)' }]), '![现场图](PHOTO:7)');
});
test('polling tolerates temporary failures and stops at a terminal status', async () => {
  let calls = 0;
  const seen = [];
  const errors = [];
  await pollNewsBatch({ id: 1, signal: new AbortController().signal, intervalMs: 1, isHidden: () => false,
    getBatch: async () => { if (++calls === 1) throw new Error('offline'); return { status: calls === 2 ? 'running' : 'succeeded' }; },
    onResponse: response => seen.push(response.status), onError: error => errors.push(error),
  });
  assert.deepEqual(seen, ['running', 'succeeded']);
  assert.equal(calls, 3);
  assert(errors[0]);
  assert.equal(errors.at(-1), null);
});
test('a successful terminal response clears an earlier connection error', async () => {
  let calls = 0;
  const errors = [];
  await pollNewsBatch({ id: 2, signal: new AbortController().signal, intervalMs: 1, isHidden: () => false,
    getBatch: async () => { if (++calls === 1) throw new Error('offline'); return { status: 'succeeded' }; },
    onResponse: () => {}, onError: error => errors.push(error),
  });
  assert.equal(calls, 2);
  assert.equal(errors.at(-1), null);
});
test('unmount aborts an in-flight request and a late result cannot change the new page', async () => {
  const controller = new AbortController();
  let receivedSignal;
  let applied = false;
  await pollNewsBatch({ id: 1, signal: controller.signal,
    getBatch: async (id, { signal }) => { receivedSignal = signal; controller.abort(); return { status: 'succeeded' }; },
    onResponse: () => { applied = true; }, onError: () => {},
  });
  assert.equal(receivedSignal.aborted, true);
  assert.equal(applied, false);
});
test('unauthorized and deleted tasks stop instead of polling forever', async () => {
  let calls = 0;
  let fatal;
  await pollNewsBatch({ id: 1, signal: new AbortController().signal,
    getBatch: async () => { calls++; throw Object.assign(new Error('not found'), { status: 404 }); },
    onResponse: () => assert.fail(), onError: (error, value) => { fatal = value; },
  });
  assert.equal(calls, 1);
  assert.equal(fatal, true);
});
