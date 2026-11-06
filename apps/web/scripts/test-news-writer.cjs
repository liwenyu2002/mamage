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
    ? load(path.relative(path.resolve(__dirname, '..'), path.resolve(path.dirname(file), path.extname(name) ? name : `${name}.js`))) : require(name);
  instance._compile(babel.transformSync(fs.readFileSync(file, 'utf8'), {
    filename: file, presets: [['@babel/preset-env', { targets: { node: 'current' } }]],
  }).code, file);
  return instance.exports;
}
const { newsDraftKey, importLegacyNewsDraft, formatNewsDate, archiveNewsContent, resolveNewsPhotos,
  hasNewsSource, newsMaterialFromForm, restoreNewsForm, recordNewsEdit, stepNewsEdit, NEWS_EDIT_LIMIT } = load('src/utils/newsWriterState.js');
const { pollNewsBatch } = load('src/services/newsBatchPolling.js');
const { normalizeNewsPhoto, mergeNewsPhotos, newsAlbumDefaults } = load('src/utils/newsPhotoSelection.js');
const { wechatDraftKey, wechatAiDraftKey, wechatImportKey, hasWechatDraft } = load('src/utils/wechatDraftState.js');
const { articleBlocks, changeArticleBlock, articleBodyMarkdown, withoutImageGroupMarkers } = load('src/utils/newsArticle.js');
const { freezeContent, materializeLayout, templateLayout, contentSignature, workflowKey, addObservedBrandAssets, normalizeLayoutLibrary, mergeContentIntoLayout, layoutToMarkdown } = load('src/utils/wechatWorkflow.js');
const { revisionSource, revisionPhotoReferences, applyRevision, revisionTarget, contextualRevisionTarget, revisionContinuation, REVISION_ACTIONS } = load('src/utils/newsRevision.js');
const { sourceRanges, floatingPosition } = load('src/utils/newsEditorSelection.js');
const { editorDocument, editorMarkdown, editorSelection, editorPhotoGroups, changeEditorImageGroup } = load('src/utils/newsEditorModel.js');
const { imageGroupMarker, parseImageGroupMarker } = load('src/utils/newsImageGroups.js');
const { EditorState, TextSelection } = require('prosemirror-state');
const { THEME_PRESETS } = load('src/wechat/themes.js');
const { docToHtmlRaw, createHistory } = load('src/wechat/docModel.js');
const { imageRuns, setImageRunColumns, splitGallery, mergeGallery } = load('src/wechat/imageGroups.js');
const { GALLERY_STYLES, galleryLayoutTree } = load('src/wechat/galleryStyles.js');
const { replaceBlockStyle, styleDropBlock } = load('src/wechat/styleReplacement.js');
const { hydrateSimilarityPhotos } = load('src/services/similarityPhotos.js');
const { missingRequiredFields } = load('src/utils/wechatRequiredFields.js');
const { referenceFindings } = load('src/utils/wechatReferences.js');
const { referenceText, usedReferenceSnapshot } = require('../../server/lib/news_reference_provenance');

test('observed templates preserve all photos and captions through replacement, export and reload', () => {
  const { templateFromSource } = require('../../server/lib/wechat_observed_gallery_templates');
  const style = templateFromSource('<section style="display:flex;gap:7px"><img style="width:40%" src="https://mmbiz.qpic.cn/a"><img style="width:60%" src="https://mmbiz.qpic.cn/b"></section>',
    { id: 1, current_revision_id: 2, title: '原文', source_url: 'https://mp.weixin.qq.com/s/a' }, 'columns');
  for (let count = 2; count <= 30; count++) {
    const doc = Array.from({ length: count }, (_, i) => ({ uid: `p${i}`, kind: 'styled', type: 'imageCard',
      galleryId: 'g', src: `/photos/${i}.jpg`, caption: `图题${i}` }));
    const changed = replaceBlockStyle(doc, 'p0', style);
    assert.equal(changed.error, '');
    const restored = JSON.parse(JSON.stringify(changed.doc));
    assert.equal(imageRuns(restored).length, 1);
    assert.equal(imageRuns(restored)[0].template.htmlTemplate, style.htmlTemplate);
    const exported = docToHtmlRaw(restored);
    assert.equal(exported.imageCount, count);
    for (const photo of doc) { assert(exported.html.includes(photo.src)); assert(exported.html.includes(photo.caption)); }
    assert.doesNotMatch(exported.html, /qpic|\{\{photo_/);
    assert.match(exported.html, /gap:7px/);
    assert(setImageRunColumns(restored, 'p0', 2).every(block => !block.galleryTemplate));
  }
});

test('complex gallery styles preserve all slots, order and adjacent group boundaries for 2 to 30 photos', () => {
  for (const style of GALLERY_STYLES) for (let count = 2; count <= 30; count++) {
    const tree = galleryLayoutTree(style.id, count), leaves = [];
    const visit = node => node.children ? node.children.forEach(visit) : Number.isInteger(node.index) && leaves.push(node.index);
    visit(tree); assert.deepEqual(leaves, Array.from({ length: count }, (_, i) => i));
    const photos = Array.from({ length: count }, (_, i) => ({ kind: 'styled', type: 'imageCard', uid: `image-${i}`,
      src: `/image-${i}.jpg`, caption: `图题 ${i}`, galleryId: 'group-a', galleryColumns: 2 }));
    const other = { ...photos[0], uid: 'other', galleryId: 'group-b', src: '/other.jpg' };
    const result = replaceBlockStyle([...photos, other], 'image-0', style);
    assert.equal(result.error, ''); assert(result.changed);
    assert.equal(result.doc.at(-1), other);
    assert.deepEqual(result.doc.slice(0, count).map(({ galleryStyle, ...item }) => item), photos);
    assert.equal(imageRuns(result.doc).length, 2);
    const exported = docToHtmlRaw(result.doc);
    assert.equal(exported.imageCount, count + 1);
    assert.equal((exported.html.match(/data-gallery-style=/g) || []).length, 1);
    let offset = -1;
    for (const photo of photos) { const next = exported.html.indexOf(`src="${photo.src}"`); assert(next > offset); offset = next; }
    assert.equal(replaceBlockStyle(result.doc, 'image-1', style).changed, false);
    const simple = setImageRunColumns(result.doc, 'image-0', 3);
    assert(simple.slice(0, count).every(item => item.galleryStyle === null && item.galleryColumns === 3));
    assert.equal(simple.at(-1), other);
  }
  assert(replaceBlockStyle([{ uid: 'single', kind: 'styled', type: 'imageCard', src: '/1.jpg' }], 'single', GALLERY_STYLES[0]).error);
});

test('style replacement changes only blockId, preserves all content and is undoable in one step', () => {
  const { createHistory } = load('src/wechat/docModel.js');
  const original = [{ uid: 'text', kind: 'para', html: '<strong>原文</strong><br>第二行', spacing: { marginTop: 8 } },
    { uid: 'image', kind: 'styled', type: 'imageCard', blockId: 'old', src: '/photo.jpg', caption: '原图题',
      galleryColumns: 2, galleryInsetPercent: 3, photoId: 3, imgStyle: { radius: 8 } }];
  const before = JSON.stringify(original);
  const imageStyle = { id: 'new-image', type: 'imageCard', htmlTemplate: '<img src="{{src}}"><p>{{caption}}</p>' };
  const result = replaceBlockStyle(original, 'image', imageStyle);
  assert(result.changed); assert.equal(result.error, '');
  assert.deepEqual(result.doc[1], { ...original[1], blockId: 'new-image' });
  assert.equal(result.doc[0], original[0]); assert.equal(JSON.stringify(original), before);
  const history = createHistory(original); history.push(result.doc);
  assert.deepEqual(history.undo(), original);
  const body = replaceBlockStyle(original, 'text', { id: 'body2', type: 'body', htmlTemplate: '<blockquote>{{content}}</blockquote>' });
  assert.deepEqual(body.doc[0], { ...original[0], blockId: 'body2' });
  assert.equal(replaceBlockStyle(result.doc, 'image', imageStyle).changed, false);
});

test('style replacement rejects wrong types, disappearing blocks/styles and missing content slots', () => {
  const text = { uid: 't', kind: 'styled', type: 'h2', content: '原题', headingLevel: 1 };
  const style = { id: 'h2-new', type: 'h2', htmlTemplate: '<h2>{{content}}</h2>' };
  const doc = [text, { uid: 'raw', kind: 'raw', html: '<p>原文</p>' },
    { uid: 'photo', kind: 'styled', type: 'imageCard', src: '/a.jpg', caption: '保留图题' }];
  assert.equal(replaceBlockStyle(doc, 't', style).doc[0].headingLevel, 1);
  for (const [uid, candidate] of [['missing', style], ['t', null], ['raw', style], ['photo', style],
    ['t', { ...style, htmlTemplate: '<h2>固定文字</h2>' }],
    ['photo', { id: 'img', type: 'imageCard', htmlTemplate: '<img src="{{src}}">' }]]) {
    const result = replaceBlockStyle(doc, uid, candidate);
    assert(result.error); assert.equal(result.changed, false); assert.equal(result.doc, doc);
  }
});

test('style drag targets block interiors, leaving edges and gaps available for insertion', () => {
  const element = (uid, left, top, width, height) => ({ getAttribute: () => uid,
    getBoundingClientRect: () => ({ left, top, width, height, right: left + width, bottom: top + height }) });
  const elements = [element('left', 0, 10, 100, 100), element('right', 108, 10, 100, 100)];
  assert.equal(styleDropBlock({ x: 150, y: 55 }, elements).uid, 'right');
  assert.equal(styleDropBlock({ x: 104, y: 55 }, elements), null);
  assert.equal(styleDropBlock({ x: 50, y: 12 }, elements), null);
  assert.equal(styleDropBlock({ x: 50, y: 125 }, elements), null);
  assert.equal(styleDropBlock({ x: 50, y: 20 }, [element('short', 0, 10, 100, 20)]).uid, 'short');
});

test('similarity view reuses album photos including deletion ownership and AI scores', async () => {
  let calls = 0;
  const photos = await hydrateSimilarityPhotos([[1, 2], [2, 3]], [1, 2, 3].map(id => ({ id,
    uploaderId: 12, aiScore: 80, thumbSrc: `/thumb/${id}`, originalSrc: `/photo/${id}` })), async () => { calls++; });
  assert.equal(calls, 0); assert.equal(Object.keys(photos).length, 3);
  assert.equal(photos[1].uploaderId, 12); assert.equal(photos[1].aiScore, 80);
  assert.equal(photos[1].thumbUrl, '/thumb/1'); assert.equal(photos[1].url, '/photo/1');
});
test('similarity metadata requests are bounded, read-only never fetches missing photos, failures remain retryable', async () => {
  let active = 0, peak = 0, calls = 0;
  const fetchPhoto = async id => {
    calls++; active++; peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 1)); active--;
    return { id };
  };
  const groups = [Array.from({ length: 20 }, (_, i) => i + 1)];
  assert.equal(Object.keys(await hydrateSimilarityPhotos(groups, [], fetchPhoto)).length, 20);
  assert.equal(peak, 4); assert.equal(calls, 20);
  assert.deepEqual(await hydrateSimilarityPhotos(groups, [], fetchPhoto, { readOnly: true }), {});
  assert.equal(calls, 20);
  await assert.rejects(hydrateSimilarityPhotos([[1]], [], async () => { throw Object.assign(Error('denied'), { status: 403 }); }), /denied/);
  assert.deepEqual(await hydrateSimilarityPhotos([[1]], [], async () => { throw Object.assign(Error('gone'), { status: 404 }); }), {});
  const controller = new AbortController(); controller.abort();
  await assert.rejects(hydrateSimilarityPhotos(groups, [], fetchPhoto, { signal: controller.signal }), { name: 'AbortError' });
});

test('30 selected images keep order, captions and URLs through confirmation, grouped layout, export and backups', () => {
  const photos = Array.from({ length: 30 }, (_, i) => ({ id: i + 1, url: `/media/photo-${i + 1}.jpg` }));
  const markdown = '# 多图活动\n\n活动现场。\n\n' + photos.map(p => `![图题 ${p.id}](${p.url})`).join('\n\n') + '\n\n终审：待填写';
  const confirmed = freezeContent({ title: '多图活动', markdown, photos });
  const original = JSON.stringify(confirmed);
  for (const imageLayout of ['auto', 'single', 'pair', 'triple']) {
    const result = materializeLayout(confirmed, { ...templateLayout(confirmed.source, THEME_PRESETS.minimal), imageLayout });
    const restored = JSON.parse(JSON.stringify(result));
    const images = restored.doc.filter(b => b.type === 'imageCard');
    assert.deepEqual(images.map(b => b.src), photos.map(p => p.url));
    assert.deepEqual(images.map(b => b.caption), photos.map(p => `图题 ${p.id}`));
    const { html, imageCount } = docToHtmlRaw(restored.doc);
    assert.equal(imageCount, 30); assert.equal((html.match(/<img\b/g) || []).length, 30);
    for (const photo of photos) assert(html.includes(photo.url));
    assert.equal(imageRuns(restored.doc).filter(run => run.columns > 1).length, imageLayout === 'single' ? 0 : 1);
    const two = setImageRunColumns(restored.doc, images[4].uid, 2);
    assert.equal(imageRuns(two).find(run => run.columns > 1).columns, 2);
    const removed = two.filter(block => block.uid !== images[4].uid);
    assert.equal(docToHtmlRaw(removed).imageCount, 29, 'intentional deletion must not restore photos');
  }
  assert.equal(JSON.stringify(confirmed), original, 'presentation cannot rewrite confirmed content');
});

test('content grouping precedes observed styles, retaining their insets and source but not overriding content columns', () => {
  const confirmed = freezeContent({ title: '现场', markdown: '现场记录。\n\n' + Array.from({ length: 12 }, (_, i) => `![图题 ${i}](/img/${i}.jpg)`).join('\n\n') });
  const imageGroup = { columns: 2, insetPercent: 3, articleId: 12, revisionId: 12, sourceTitle: '论坛' };
  const { buildObservedLibrary } = require('../../server/lib/wechat_observed_styles');
  const extracted = buildObservedLibrary([{ id: 12, current_revision_id: 12, title: '论坛', published_at: 1,
    style_blocks: [{ type: 'h2', htmlTemplate: '<strong>{{content}}</strong>' }, { type: 'imageCard', htmlTemplate: '<img src="{{src}}">' }] }], []);
  const library = normalizeLayoutLibrary(extracted.blocks.map(block => ({ ...block, imageGroup })));
  const config = { ...THEME_PRESETS.minimal, imageCard: extracted.templates[0].styleIds.imageCard, imageGroup };
  const result = materializeLayout(confirmed, templateLayout(confirmed.source, config), library);
  const restored = JSON.parse(JSON.stringify(result));
  assert.deepEqual(restored.sourceDocument.imageGroupReference, imageGroup);
  const run = imageRuns(restored.doc).find(item => item.columns > 1);
  assert.equal(run.columns, 3); assert.equal(run.insetPercent, 3);
  const html = docToHtmlRaw(restored.doc, { blocksById: restored.sourceDocument.styleBlocks }).html;
  assert.match(html, /width:33.333333333333336%;padding:0 1%/);
  for (let i = 0; i < 12; i++) assert(html.includes(`图题 ${i}`));
  const forced = materializeLayout(confirmed, { ...templateLayout(confirmed.source, config), imageLayout: 'triple' }, library);
  assert.equal(imageRuns(forced.doc).find(item => item.columns > 1).columns, 3);
  assert.equal(forced.sourceDocument.imageGroupReference, undefined);
  const aiPlan = templateLayout(confirmed.source, { ...config, imageGroup: null });
  assert.equal(imageRuns(materializeLayout(confirmed, aiPlan, library).doc).find(item => item.columns > 1).columns, 3,
    'AI-selected styles cannot regroup the content draft');
});

const galleryArticle = () => '# 多图内容稿\n\n现场记录\n\n' + Array.from({ length: 6 }, (_, i) => `![图题 ${i + 1}](/photo/${i + 1}.jpg)`).join('\n\n') + '\n\n摄影：甲';
test('content drafts render groups before styling and two adjacent groups survive reload, AI revision, backup and export', () => {
  let state = EditorState.create({ doc: editorDocument(galleryArticle()) });
  assert.deepEqual(editorPhotoGroups(state.doc).map(group => [group.items.length, group.columns]), [[6, 3]]);
  state = state.apply(changeEditorImageGroup(state, editorPhotoGroups(state.doc)[0].items[2].pos, 'splitAfter'));
  const markdown = editorMarkdown(state.doc).markdown;
  assert.equal(withoutImageGroupMarkers(markdown), galleryArticle(), 'metadata does not enter copied text or word counts');
  assert.deepEqual(editorPhotoGroups(editorDocument(markdown)).map(group => group.items.length), [3, 3]);
  assert.equal(articleBlocks(markdown).filter(block => block.type !== 'space').length, 9, 'metadata is not a content block');
  const article = { title: '多图内容稿', markdown };
  const source = revisionSource(article);
  const revised = applyRevision(article, { title: article.title, blocks: source.blocks.map(block => ({ ...block, text: block.type === 'image' ? `${block.text}更新` : block.text })) });
  assert.deepEqual(editorPhotoGroups(editorDocument(revised.markdown)).map(group => group.items.length), [3, 3]);
  const confirmed = freezeContent(revised);
  for (const imageLayout of ['auto', 'pair', 'triple', 'single']) {
    const layout = JSON.parse(JSON.stringify(materializeLayout(confirmed, { ...templateLayout(confirmed.source, THEME_PRESETS.minimal), imageLayout })));
    const images = layout.doc.filter(block => block.type === 'imageCard');
    assert.equal(new Set(images.map(block => block.galleryId)).size, 2);
    assert.deepEqual(images.map(block => block.src), Array.from({ length: 6 }, (_, i) => `/photo/${i + 1}.jpg`));
    if (imageLayout !== 'single') assert.deepEqual(imageRuns(layout.doc).filter(run => run.columns > 1).map(run => run.items.length), [3, 3]);
    const html = docToHtmlRaw(layout.doc).html;
    assert.equal((html.match(/<img\b/g) || []).length, 6);
    assert(!html.includes('mamage-image-group'));
    const updated = setImageRunColumns(layout.doc, images[0].uid, 2);
    assert.equal(updated.find(block => block.uid === images[3].uid).galleryColumns, images[3].galleryColumns, 'changing one group cannot affect its adjacent neighbor');
  }
});

test('splitting, merging and changing columns are reversible single edits and never cross text', () => {
  let state = EditorState.create({ doc: editorDocument(galleryArticle()) });
  const original = editorMarkdown(state.doc).markdown;
  let content = { markdownText: original };
  const edit = (pos, action, value) => {
    state = state.apply(changeEditorImageGroup(state, pos, action, value));
    content = recordNewsEdit(content, { ...content, markdownText: editorMarkdown(state.doc).markdown });
  };
  edit(editorPhotoGroups(state.doc)[0].items[2].pos, 'splitBefore');
  assert.deepEqual(editorPhotoGroups(state.doc).map(group => group.items.length), [2, 4]);
  edit(editorPhotoGroups(state.doc)[0].items[0].pos, 'columns', 1);
  assert.deepEqual(editorPhotoGroups(editorDocument(content.markdownText)).map(group => group.columns), [1, 3]);
  edit(editorPhotoGroups(state.doc)[0].items[0].pos, 'mergeNext');
  assert.deepEqual(editorPhotoGroups(state.doc).map(group => [group.items.length, group.columns]), [[6, 1]]);
  for (let i = 0; i < 3; i++) content = stepNewsEdit(content, 'undo');
  assert.equal(content.markdownText, original);
  state = EditorState.create({ doc: editorDocument('![a](/a.jpg)\n\n文字\n\n![b](/b.jpg)') });
  assert.equal(changeEditorImageGroup(state, 0, 'mergeNext'), null);
  assert.equal(changeEditorImageGroup(state, 0, 'splitBefore'), null);
  assert.equal(changeEditorImageGroup(state, 0, 'splitAfter'), null);
});

test('group markers do not disrupt text or caption selection offsets and are validated', () => {
  const doc = editorDocument(galleryArticle()), { markdown, entries } = editorMarkdown(doc);
  const image = entries.find(entry => entry.node.type.name === 'photo');
  const selection = editorSelection(doc, TextSelection.create(doc, image.pos + 1, image.pos + 3));
  const block = revisionSource({ markdown }).blocks.find(item => item.uid === selection.uid);
  assert.equal(block.type, 'image'); assert.equal(block.text.slice(selection.start, selection.end), '图题');
  const last = entries.at(-1), text = editorSelection(doc, TextSelection.create(doc, last.pos + 1, last.pos + 3));
  assert.equal(revisionSource({ markdown }).blocks.find(item => item.uid === text.uid).text.slice(text.start, text.end), '摄影');
  const marker = imageGroupMarker({ galleryId: 'group-a', galleryColumns: 2 });
  assert.deepEqual(parseImageGroupMarker(marker), { galleryId: 'group-a', galleryColumns: 2 });
  assert.equal(parseImageGroupMarker('<!-- mamage-image-group {"galleryId":"<script>","galleryColumns":2} -->'), null);
  assert.equal(imageGroupMarker({ galleryId: 'a', galleryColumns: 9 }), '');
});

test('single selection may expand within its sentence without crossing paragraphs or punctuation', () => {
  const source = { blocks: [{ uid: 'b-0', type: 'paragraph', text: '学校举办交流活动。第二句不应改变。' }] };
  const selected = { uid: 'b-0', start: 0, end: 2 };
  const result = contextualRevisionTarget('custom', selected, source);
  assert.deepEqual(result.originalSelection, selected);
  assert.equal(source.blocks[0].text.slice(result.target.start, result.target.end), '学校举办交流活动。');
  assert.equal(contextualRevisionTarget('complete', selected, source).target, selected);
  assert.equal(contextualRevisionTarget('custom', selected, source, '将选中文字替换，其他文字不变').target, selected);
  const richSource = { blocks: [{ uid: 'b-0', type: 'paragraph', text: '学校有**重点**活动。' }] };
  assert.equal(contextualRevisionTarget('custom', selected, richSource).target, selected);
  const multi = { ranges: [selected, { uid: 'b-1', start: 0, end: 2 }] };
  assert.equal(contextualRevisionTarget('polish', multi, source).target, multi);
});

test('references contain only writing findings and never the original article body or examples', () => {
  const text = referenceFindings([{ title: '参考一', text: '不能带入的原文', analysis: { summary: '先介绍背景',
    lessons: [{ principle: '突出重点', application: '活动报道', caveat: '不要推断', evidence: ['不能带入的引文'] }] } }]);
  assert.match(text, /先介绍背景/); assert.match(text, /突出重点/);
  assert.doesNotMatch(text, /不能带入的原文|不能带入的引文/);
  const item = { id: 3, revisionId: 4, title: '参考一', analysis: { summary: '先介绍背景', lessons: [
    { principle: '突出重点', application: '活动报道', caveat: '不要推断' }] } };
  assert.equal(referenceFindings([item]), referenceText(item));
  assert.deepEqual(usedReferenceSnapshot({ monitorReferences: [item] }, referenceFindings([item])), [{ id: 3, revisionId: 4, title: '参考一' }]);
});

test('publishing detects unresolved review placeholders without blocking filled or removed roles', () => {
  assert.deepEqual(missingRequiredFields('正文\n\n初审：待填写\n\n终审：待填写'), ['初审', '终审']);
  assert.deepEqual(missingRequiredFields('正文\n\n终审：张三'), []);
  assert.deepEqual(missingRequiredFields('<strong>初审：</strong><span>待填写</span>'), ['初审']);
  assert.deepEqual(missingRequiredFields('文字 | 待填写\n日期：待确认'), ['文字', '日期']);
  assert.deepEqual(missingRequiredFields('正文中提到初审：待填写的示例'), []);
});

test('paragraph editing preserves blank paragraphs through Markdown and reload', () => {
  for (const markdown of ['第一段\n\n\n\n第二段', '第一段\n\n', '\n\n第一段', '\n\n', '# 标题\n\n\n\n正文']) {
    assert.equal(editorMarkdown(editorDocument(markdown)).markdown, markdown);
  }
});

test('all three heading levels survive content confirmation, style assignment and styled backups', () => {
  const article = { title: '文章标题', markdown: '# 文章标题\n\n# 第一章\n\n章内容\n\n## 第一节\n\n节内容\n\n### 讨论要点\n\n要点内容' };
  const confirmed = freezeContent(article);
  assert.deepEqual(confirmed.source.doc.filter(block => block.headingLevel).map(block => block.headingLevel), [1, 2, 3]);
  const plan = templateLayout(confirmed.source, THEME_PRESETS.minimal);
  const headings = confirmed.source.doc.filter(block => block.headingLevel);
  assert.notEqual(plan.blocks.find(block => block.uid === headings[0].uid).styleId, plan.blocks.find(block => block.uid === headings[1].uid).styleId);
  const styled = materializeLayout(confirmed, plan);
  assert.deepEqual(styled.doc.filter(block => block.headingLevel).map(block => block.headingLevel), [1, 2, 3]);
  assert.equal(styled.sourceDocument.markdown, article.markdown);
});

test('manual and AI edits share exactly ten undo steps, redo is bounded and snapshots never nest history', () => {
  let content = { title: '标题', markdownText: '初稿', photos: [{ id: 1 }], factCheck: null };
  for (let index = 1; index <= 12; index++) content = recordNewsEdit(content, { ...content, markdownText: `修改 ${index}` }, { now: index * 1000 });
  assert.equal(NEWS_EDIT_LIMIT, 10);
  assert.equal(content.history.length, 10);
  assert.equal(content.history[0].markdownText, '修改 11');
  assert.equal(content.history.at(-1).markdownText, '修改 2');
  assert.equal(content.history.some(version => version.history || version.redoHistory || version.editGroup), false);
  content = JSON.parse(JSON.stringify(content));
  for (let index = 11; index >= 2; index--) {
    content = stepNewsEdit(content, 'undo'); assert.equal(content.markdownText, `修改 ${index}`);
  }
  assert.equal(content.history.length, 0);
  assert.equal(content.redoHistory.length, 10);
  assert.equal(stepNewsEdit(content, 'undo'), content);
  for (let index = 3; index <= 12; index++) { content = stepNewsEdit(content, 'redo'); assert.equal(content.markdownText, `修改 ${index}`); }
  assert.equal(content.redoHistory.length, 0);
  assert.deepEqual(content.photos, [{ id: 1 }]);
  content = stepNewsEdit(content, 'undo');
  content = recordNewsEdit(content, { ...content, title: '新标题', markdownText: '新的手动修改' });
  assert.equal(content.redoHistory.length, 0, 'a new branch cannot redo the abandoned edit');
});

test('typing coalesces within one paragraph but separate actions, AI adoption and undo begin new groups', () => {
  let content = { title: '标题', markdownText: '原文' };
  content = recordNewsEdit(content, { ...content, markdownText: '原文甲' }, { group: 'paragraph-1', now: 1000 });
  content = recordNewsEdit(content, { ...content, markdownText: '原文甲乙' }, { group: 'paragraph-1', now: 1100 });
  content = recordNewsEdit(content, { ...content, markdownText: '原文甲乙丙' }, { group: 'paragraph-1', now: 1200 });
  assert.equal(content.history.length, 1);
  content = recordNewsEdit(content, { ...content, markdownText: 'AI 修改后' }, { now: 1250 });
  assert.equal(content.history.length, 2);
  content = recordNewsEdit(content, { ...content, markdownText: 'AI 修改后再手改' }, { group: 'paragraph-1', now: 1300 });
  assert.equal(content.history.length, 3);
  content = stepNewsEdit(content, 'undo'); assert.equal(content.markdownText, 'AI 修改后');
  content = stepNewsEdit(content, 'undo'); assert.equal(content.markdownText, '原文甲乙丙');
  content = stepNewsEdit(content, 'undo'); assert.equal(content.markdownText, '原文');
  const untouched = recordNewsEdit(content, { ...content, factCheck: { issues: [] } });
  assert.equal(untouched.history.length, 0);
  assert.equal(untouched.redoHistory.length, 3);
  const replacedMetadata = recordNewsEdit(untouched, { title: untouched.title, markdownText: untouched.markdownText, factCheck: null });
  assert.equal(replacedMetadata.redoHistory.length, 3, 'regenerating identical content cannot erase edit history');
  const normalized = recordNewsEdit(untouched, { ...untouched, markdownText: '原文\n' }, { record: false });
  assert.equal(normalized.redoHistory.length, 3);
  assert.equal(normalized.history.length, 0);
});

test('confirmed content is unstyled, immutable and sensitive to all content changes', () => {
  const article = { title: '实践交流', markdown: '# 实践交流\n\n第一段**重点**。\n\n## 现场\n\n![图注](/image.jpg?auth=signature)' };
  const before = JSON.stringify(article), confirmed = freezeContent(article);
  assert.equal(JSON.stringify(article), before);
  assert.equal(confirmed.source.doc.some(block => 'blockId' in block || 'accent' in block), false);
  assert.equal(confirmed.source.doc.filter(block => block.type === 'h2').length, 1, 'separate title is not duplicated');
  assert.notEqual(confirmed.signature, contentSignature({ ...article, markdown: article.markdown + '\n\n新段落' }));
  assert.notEqual(confirmed.signature, contentSignature({ ...article, title: '改标题' }));
  assert.notEqual(workflowKey(1, 2), workflowKey(2, 2));
  assert.notEqual(workflowKey(1, 2), workflowKey(1, 3)); assert.equal(workflowKey(null, 2), null);
  const plan = templateLayout(confirmed.source, THEME_PRESETS.formal);
  const styled = materializeLayout(confirmed, { ...plan, blocks: [...plan.blocks].reverse() });
  assert.deepEqual(styled.doc.map(({ blockId, accent, ...block }) => block), confirmed.source.doc);
  assert.deepEqual(styled.sourceDocument.markdown, article.markdown);
  const html = docToHtmlRaw(styled.doc, { globalAccent: plan.accent, body: plan.body }).html;
  assert.match(html, /<strong[^>]*>重点<\/strong>/); assert.match(html, /auth=signature/);
  assert.match(html, /图注/);
  assert.throws(() => materializeLayout(confirmed, { ...plan, blocks: plan.blocks.slice(1) }));
  assert.throws(() => materializeLayout(confirmed, { ...plan, blocks: plan.blocks.map(block => ({ ...block, styleId: 'db-unauthorized' })) }));
  assert.equal(JSON.stringify(article), before);
});

test('selected observed brand images retain content and their style snapshots', () => {
  const article = { title: '测试', markdown: '# 测试\n\n原有正文。' };
  const confirmed = freezeContent(article), styled = materializeLayout(confirmed, templateLayout(confirmed.source, THEME_PRESETS.minimal));
  const asset = { id: '0123456789abcdef', src: '/api/wx-img?url=https%3A%2F%2Fmmbiz.qpic.cn%2Fbrand', position: 'top' };
  const library = { 'db-monitor-image': { id: 'db-monitor-image', type: 'imageCard', htmlTemplate: '<img src="{{src}}">' } };
  const withBrand = addObservedBrandAssets(styled, [asset], library, 'db-monitor-image');
  assert.equal(withBrand.doc[0].src, asset.src);
  assert.deepEqual(withBrand.doc.slice(1), styled.doc);
  assert.equal(withBrand.sourceDocument.markdown, article.markdown);
  assert.equal(withBrand.sourceDocument.styleBlocks['db-monitor-image'].type, 'imageCard');
  assert.throws(() => addObservedBrandAssets(styled, [{ ...asset, src: 'https://example.com/image' }], library, 'db-monitor-image'));
});

test('revision sends only unique photo identifiers for server-side context hydration', () => {
  const article = { photos: [
    { id: 31, faceNames: ['cached name'], projectTitle: 'cached album', url: '/photo?token=secret' },
    { id: '31' }, { id: '32' }, { id: 'https://example.test/33' },
    { id: 0 }, { id: -1 }, { id: true }, { id: '2e2' }, { id: '9007199254740993' }, null,
  ] };
  assert.deepEqual(revisionPhotoReferences(article), [{ id: 31 }, { id: 32 }]);
  assert.deepEqual(revisionPhotoReferences({ photos: [] }), []);
  assert.deepEqual(revisionPhotoReferences({ photos: 'invalid' }), []);
  assert.deepEqual(revisionPhotoReferences(undefined), []);
  assert.deepEqual(revisionPhotoReferences({ photos: [{ id: 32 }] }), [{ id: 32 }], 'removed materials are not kept in a separate cache');
});

test('dialogue edits preserve exact unchanged inline formatting, image URLs and support requested photo ordering', () => {
  const article = { title: '原文', markdown: '# 原文\n\n**重点**与[链接](/school)\n\n![原图](/image.jpg?auth=signature)\n\n第二段' };
  const source = revisionSource(article);
  assert.equal(JSON.stringify(source).includes('auth=signature'), false, 'model does not need photo URLs');
  const plan = { title: '原文', blocks: source.blocks.map(({ uid, text }) => ({ uid, text })) };
  const image = plan.blocks.splice(2, 1)[0]; plan.blocks.splice(1, 0, image);
  plan.blocks.push({ uid: 'new-p', text: '补充段落' });
  const revised = applyRevision(article, plan);
  assert.match(revised.markdown, /\*\*重点\*\*与\[链接\]\(\/school\)/);
  assert.equal(articleBlocks(revised.markdown).find(block => block.type === 'image').href, '/image.jpg?auth=signature');
  assert.ok(revised.markdown.indexOf('![原图]') < revised.markdown.indexOf('**重点**'));
  assert.throws(() => applyRevision(article, { ...plan, blocks: plan.blocks.filter(block => block !== image) }));
});

test('revision image blocks carry only explicit or unambiguous selected photo IDs, never signed URLs', () => {
  const article = { title: 'Test', photos: [
    { id: 31, url: '/image.jpg?auth=signature', thumbUrl: '/thumb.jpg' },
    { id: 32, url: '/ambiguous.jpg' }, { id: 33, url: '/ambiguous.jpg' },
  ], markdown: '![a](PHOTO:31)\n\n![b](/image.jpg?auth=signature)\n\n![c](/thumb.jpg)\n\n![d](PHOTO:99)\n\n![e](/ambiguous.jpg)\n\n![f](https://external.test/image.jpg)' };
  const source = revisionSource(article);
  assert.deepEqual(source.blocks.map(block => block.photoId ?? null), [31, 31, 31, null, null, null]);
  assert.equal(JSON.stringify(source).includes('auth=signature'), false);
  assert.equal(JSON.stringify(source).includes('external.test'), false);
  assert.equal(revisionSource({ ...article, photos: [] }).blocks.some(block => block.photoId), false);
  assert.equal(revisionSource({ ...article, photos: [article.photos[2], article.photos[1]] }).blocks[4].photoId, undefined);
});
test('common editing actions have distinct cursor, paragraph, insertion and whole-document scopes', () => {
  const source = revisionSource({ title: '标题', markdown: '# 标题\n\n第一段。\n\n第二段。' });
  const node = source.blocks[1], selection = { uid: node.uid, start: 1, end: 3 };
  assert.equal(REVISION_ACTIONS.length, 7);
  assert.deepEqual(revisionTarget('polish', 'all', source), null);
  assert.deepEqual(revisionTarget('continue', 'selection', source, selection), null);
  assert.deepEqual(revisionTarget('polish', 'selection', source, selection), selection);
  assert.deepEqual(revisionTarget('polish', 'selection', source, { ...selection, end: 1 }), { uid: node.uid });
  assert.deepEqual(revisionTarget('complete', 'all', source), { uid: source.blocks[2].uid, start: 4, end: 4 });
  assert.deepEqual(revisionTarget('add_paragraph', node.uid, source), { uid: node.uid });
  assert.throws(() => revisionTarget('complete', 'selection', source, { uid: 'gone', start: 0, end: 1 }));
});
test('follow-up refinements retain the previous proposal scope instead of silently broadening to the whole article', () => {
  const article = { title: '原文', markdown: '# 原文\n\n目标段落。\n\n保留这一段。' };
  const source = revisionSource(article);
  const target = { uid: source.blocks[1].uid, start: 2, end: 2 };
  const plan = { title: article.title, blocks: source.blocks.map(({ uid, text }) => ({ uid, text })) };
  plan.blocks[1].text = '目标补充文字段落。';
  const updated = applyRevision(article, plan);
  assert.deepEqual(revisionContinuation({ source, mode: 'complete', target }, plan, updated), { uid: source.blocks[1].uid, start: 2, end: 6 });
  const inserted = { title: article.title, blocks: [...plan.blocks.slice(0, 2), { uid: 'new-first', text: '新增第一段。' }, { uid: 'new-second', text: '新增第二段。' }, ...plan.blocks.slice(2)] };
  const next = applyRevision(article, inserted), nextSource = revisionSource(next);
  assert.deepEqual(revisionContinuation({ source, mode: 'add_paragraph', target: { uid: source.blocks[1].uid } }, inserted, next), { uids: [nextSource.blocks[2].uid, nextSource.blocks[3].uid] });
});

test('photo selection excludes videos, keeps original URLs and caps unique photos at 30', () => {
  const photo = { id: '1', url: '/original.jpg', thumbUrl: '/thumb.jpg', faceNames: ['仅识别候选'] };
  assert.equal(normalizeNewsPhoto(photo).url, '/original.jpg');
  for (const video of [{ ...photo, type: 'video' }, { ...photo, mimeType: 'video/mp4' }, { ...photo, url: '/original.MOV?signature=1' }]) {
    assert.equal(normalizeNewsPhoto(video), null);
  }
  assert.equal(normalizeNewsPhoto({ id: 'https://untrusted/photo', url: '/a.jpg' }), null);
  const merged = mergeNewsPhotos([photo], [photo, ...Array.from({ length: 35 }, (_, i) => ({ ...photo, id: i + 2 }))]);
  assert.equal(merged.length, 30);
  assert.equal(new Set(merged.map(item => item.id)).size, 30);
  assert.deepEqual(merged[0].faceNames, ['仅识别候选']);
  assert.equal(merged[0].confirmedParticipantNames, undefined);
});

test('document editor maps cross-paragraph selections to fresh token ranges without crossing photo captions', () => {
  const markdown = '# 标题\n\n第一段的前后文字。\n\n![图注不改](/photo.jpg?key=private)\n\n第二段的前后文字。';
  const doc = editorDocument(markdown), entries = editorMarkdown(doc).entries;
  assert.equal(editorMarkdown(doc).markdown, markdown);
  const selection = editorSelection(doc, { from: entries[1].pos + 3, to: entries[3].pos + 5 });
  assert.equal(selection.ranges.length, 2);
  assert.equal(selection.ranges[0].start, 2);
  assert.equal(selection.ranges[1].end, 4);
  const source = revisionSource({ title: '标题', markdown });
  assert.deepEqual(revisionTarget('shorten', 'selection', source, selection), { ranges: selection.ranges });
  assert.deepEqual(revisionTarget('add_paragraph', 'selection', source, selection), { uid: selection.ranges[1].uid });
  assert.throws(() => revisionTarget('complete', 'selection', source, selection));
  const plan = { title: '标题', blocks: source.blocks.map(({ uid, text }) => ({ uid, text })) };
  plan.blocks[1].text = '第一修改内容'; plan.blocks[3].text = '新内容前后文字。';
  const next = applyRevision({ title: '标题', markdown }, plan);
  const continued = revisionContinuation({ source, target: { ranges: selection.ranges }, mode: 'shorten' }, plan, next);
  assert.equal(continued.ranges[0].start, 2);
  assert.equal(continued.ranges[0].end, '第一修改内容'.length);
  assert.equal(continued.ranges[1].end, plan.blocks[3].text.length - (source.blocks[3].text.length - 4));
  assert.equal(sourceRanges(markdown, markdown.indexOf('第一'), markdown.length).length, 2);
});

test('context popups stay within resized or zoomed visual viewports, including the mobile keyboard', () => {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 370, top: 120, left: 15 }]) {
    const position = floatingPosition({ x: 1400, top: 850, bottom: 880 }, { width: 420, height: 240 }, viewport);
    assert.ok(position.left >= (viewport.left || 0));
    assert.ok(position.left + position.width <= (viewport.left || 0) + viewport.width);
    assert.ok(position.top >= (viewport.top || 0));
    assert.ok(position.top + 240 <= (viewport.top || 0) + viewport.height);
  }
});
test('album metadata is eligible only when all selected photos belong to the same album', () => {
  const photos = [normalizeNewsPhoto({ id: 1, url: '/a.jpg' }, { id: 3, projectName: '作品交流', eventDate: '2026-10-24' })];
  assert.deepEqual(newsAlbumDefaults(photos), { eventName: '作品交流', eventDate: '2026-10-24' });
  assert.deepEqual(newsAlbumDefaults([...photos, { projectId: 4 }]), {});
  assert.deepEqual(newsAlbumDefaults([...photos, { projectTitle: '无来源' }]), {});
  assert.deepEqual(newsAlbumDefaults([]), {});
});
test('layout drafts and handoffs are scoped and old caches are never implicitly adopted', () => {
  assert.notEqual(wechatAiDraftKey(1, 2), wechatDraftKey(1, 2));
  assert.notEqual(wechatAiDraftKey(1, 2), wechatAiDraftKey(2, 2));
  assert.notEqual(wechatAiDraftKey(1, 2), wechatAiDraftKey(1, 3));
  assert.equal(wechatAiDraftKey(null, 2), null);
  assert.notEqual(wechatDraftKey(1, 2), wechatDraftKey(2, 2));
  assert.notEqual(wechatDraftKey(1, 2), wechatDraftKey(1, 3));
  assert.notEqual(wechatImportKey(1, 2), wechatImportKey(2, 2));
  assert.notEqual(wechatImportKey(1, 2), wechatImportKey(1, 3));
  assert.equal(wechatDraftKey(null, 2), null);
  assert.equal(wechatImportKey(null, 2), null);
  assert.equal(hasWechatDraft({ doc: [{ type: 'p' }] }), true);
  assert.equal(hasWechatDraft({ title: '' }), false);
});
test('structured editing preserves nonedited Markdown byte-for-byte, including photos and formatting', () => {
  const source = '# 标题\n\n第一段**重点**。\n\n![原图说明](/original.jpg?signature=abc)\n\n## 小标题\n\n- 项目一\n- 项目二\n';
  const blocks = articleBlocks(source);
  assert.equal(blocks.map(block => block.raw).join(''), source);
  const first = blocks.find(block => block.type === 'paragraph');
  const edited = blocks.map(block => block === first ? changeArticleBlock(block, '人工修改。') : block).map(block => block.raw).join('');
  assert.equal(edited, source.replace('第一段**重点**。', '人工修改。'));
  const image = blocks.find(block => block.type === 'image');
  const changed = changeArticleBlock(image, '说明[补充]');
  assert.match(changed.raw, /!\[说明\\\[补充\\\]\]\(\/original.jpg\?signature=abc\)/);
  assert.equal(articleBlocks(changed.raw).find(block => block.type === 'image').href, image.href);
});
test('export and layout do not duplicate the title, or remove a different body heading', () => {
  assert.equal(articleBodyMarkdown('# 已确认标题\n\n正文。\n\n![图注](/image.jpg)', '已确认标题'), '正文。\n\n![图注](/image.jpg)');
  assert.equal(articleBodyMarkdown('# 正文内不同标题\n\n正文。', '稿件标题'), '# 正文内不同标题\n\n正文。');
  assert.equal(articleBodyMarkdown('原有纯正文。', '旧稿标题'), '原有纯正文。');
});

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
  const history = archiveNewsContent({ title: 'Edited', markdownText: 'My edited copy', history: Array(12).fill({ markdownText: 'old' }) });
  assert.equal(history.length, 10);
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

test('mergeContentIntoLayout syncs edited content into the existing styled layout', () => {
  const images = Array.from({ length: 4 }, (_, i) => `![图题 ${i}](/img/${i}.jpg)`).join('\n\n');
  const markdown = `导语文字。\n\n## 现场\n\n第一段。\n\n${images}\n\n结尾。`;
  const confirmed = freezeContent({ title: '原题', markdown });
  const layout = materializeLayout(confirmed, { ...templateLayout(confirmed.source, THEME_PRESETS.minimal), imageLayout: 'pair' }, {});
  const bodyStyle = layout.doc.find(block => block.type === 'body')?.blockId;
  const imageStyle = layout.doc.find(block => block.type === 'imageCard')?.blockId;
  const revised = markdown.replace('导语文字。', '导语文字（改）。').replace('结尾。', '结尾（改）。') + '\n\n新增一段。';
  const next = freezeContent({ title: '新题', markdown: revised });
  const merged = mergeContentIntoLayout(next, layout);
  assert.equal(merged.title, '新题');
  assert.equal(merged.doc.length, next.source.doc.length);
  assert.equal(merged.doc.find(block => block.type === 'body')?.blockId, bodyStyle);
  assert.equal(merged.doc.filter(block => block.type === 'imageCard').length, 4);
  for (const block of merged.doc.filter(item => item.type === 'imageCard')) assert.equal(block.blockId, imageStyle);
  const mergedText = merged.doc.map(block => String(block.content ?? block.html ?? '')).join(' ');
  assert.match(mergedText, /导语文字（改）/);
  assert.match(mergedText, /新增一段/);
  // 新换的一张图也应继承组图样式，而不是 fallback 成纯文本块
  const swapped = mergeContentIntoLayout(freezeContent({ title: '换图', markdown: markdown.replace('/img/0.jpg', '/img/new.jpg') }), layout);
  assert.ok(swapped.doc.filter(block => block.type === 'imageCard').every(block => block.blockId === imageStyle));
});

test('layoutToMarkdown writes layout text/images back and refuses raw blocks', () => {
  const markdown = '导语。\n\n## 现场\n\n第一段。\n\n![图题](/img/a.jpg)';
  const confirmed = freezeContent({ title: '题', markdown });
  const layout = materializeLayout(confirmed, { ...templateLayout(confirmed.source, THEME_PRESETS.minimal), imageLayout: 'single' }, {});
  const text = layoutToMarkdown(layout.doc);
  assert.match(text, /导语/);
  assert.match(text, /## 现场/);
  assert.match(text, /第一段/);
  assert.match(text, /!\[图题\]\(\/img\/a\.jpg\)/);
  assert.equal(layoutToMarkdown([{ uid: 'r1', kind: 'raw', html: '<p>整文导入</p>' }]), null);
  assert.equal(layoutToMarkdown([]), '');
});

test('createHistory snapshot/restore keeps the undo stack across reloads', () => {
  const history = createHistory([{ uid: 'a' }]);
  history.push([{ uid: 'b' }]);
  history.push([{ uid: 'c' }]);
  const saved = JSON.parse(JSON.stringify(history.snapshot(10)));
  const restored = createHistory([{ uid: 'stale' }]);
  assert.equal(restored.restore(saved), true);
  assert.equal(restored.canUndo(), true);
  assert.deepEqual(restored.undo(), [{ uid: 'b' }]);
  assert.deepEqual(restored.undo(), [{ uid: 'a' }]);
  assert.equal(restored.canUndo(), false);
});

test('splitGallery/mergeGallery handle layout image groups', () => {
  const doc = [
    { uid: 'p', kind: 'para', type: 'body', html: 'x' },
    { uid: 'i1', kind: 'styled', type: 'imageCard', src: '/1.jpg', galleryId: 'g1', galleryColumns: 2, galleryStyle: 'builtin-gallery-carousel' },
    { uid: 'i2', kind: 'styled', type: 'imageCard', src: '/2.jpg', galleryId: 'g1', galleryColumns: 2, galleryStyle: 'builtin-gallery-carousel' },
    { uid: 'i3', kind: 'styled', type: 'imageCard', src: '/3.jpg', galleryId: 'g1', galleryColumns: 2, galleryStyle: 'builtin-gallery-carousel' },
    { uid: 'i4', kind: 'styled', type: 'imageCard', src: '/4.jpg' },
  ];
  const split = splitGallery(doc, 'i2');
  for (const block of split.slice(1, 4)) {
    assert.equal(block.galleryId, undefined);
    assert.equal(block.galleryColumns, undefined);
    assert.equal(block.galleryStyle, null);
  }
  assert.equal(split[4].uid, 'i4');
  assert.equal(splitGallery(doc, 'i4'), doc, 'single image needs no split');
  const merged = mergeGallery(doc, ['i3', 'i4']);
  assert.equal(merged[3].galleryId, 'g1');
  assert.equal(merged[4].galleryId, 'g1');
  assert.equal(merged[4].galleryColumns, 2);
  assert.equal(mergeGallery(doc, ['i1', 'i4']), doc, 'non-adjacent images cannot merge');
  assert.equal(mergeGallery(doc, ['i1', 'p']), doc, 'non-image blocks cannot merge');
});
