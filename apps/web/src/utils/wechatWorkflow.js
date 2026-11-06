import { markdownToDoc, sanitizeParaHtml } from '../wechat/docModel';
import { articleBodyMarkdown } from './newsArticle';
import { BUILTIN_BLOCKS_BY_ID, THEME_PRESETS } from '../wechat/themes';
import { arrangeImageGroups, normalizeImageGroup } from '../wechat/imageGroups';
import { withDraftImageGroups, imageGroupMetadata } from './newsImageGroups';

export function workflowKey(userId, workspaceId) {
  return userId ? `mamage.wechat.workflow.v1:${userId}:${workspaceId || 'legacy'}` : null;
}
export function contentSignature(article) {
  // 归一化换行/尾随空白，避免编辑器 blur 或草稿回写产生的等义差异把内容稿判成“已修改”。
  const title = String(article?.title || '').trim();
  const markdown = String(article?.markdown || '').replace(/\r\n/g, '\n').replace(/\u00a0/g, ' ').replace(/[ \t]+$/gm, '').replace(/\s+$/, '');
  return JSON.stringify([title, markdown]);
}
export function freezeContent(article) {
  if (!article?.markdown?.trim()) throw Error('请先完成内容稿');
  const doc = withDraftImageGroups(markdownToDoc(articleBodyMarkdown(article.markdown, article.title)).map(block => {
    if (block.kind === 'para') return { uid: block.uid, kind: 'para', type: 'body',
      html: sanitizeParaHtml(block.html).replace(/<\/?(?:span|u)\b[^>]*>/gi, '') };
    return { uid: block.uid, kind: 'styled', type: block.type, content: block.content || '',
      ...(block.headingLevel ? { headingLevel: block.headingLevel } : {}),
      ...(block.type === 'imageCard' ? { src: block.src, caption: block.caption || '', ...imageGroupMetadata(block) } : {}) };
  }), block => block.type === 'imageCard');
  if (!doc.length || doc.length > 120) throw Error('请将内容稿控制在 1 至 120 个内容块以内');
  return { article: JSON.parse(JSON.stringify(article)), source: { title: article.title || '', doc },
    signature: contentSignature(article), confirmedAt: Date.now() };
}
export function normalizeLayoutLibrary(rows = []) {
  return Object.fromEntries(rows.map(row => {
    const id = String(row.id).startsWith('db-') ? String(row.id) : `db-${row.id}`;
    return [id, { id, type: row.type, name: row.name, htmlTemplate: row.htmlTemplate || row.html_template || '', accentEditable: Boolean(row.accentEditable ?? row.accent_editable),
      imageGroup: normalizeImageGroup(row.imageGroup) }];
  }));
}
export function templateLayout(source, config) {
  return { blocks: source.doc.map(block => ({ uid: block.uid,
    styleId: block.kind === 'para' ? config.bodyStyleId || 'builtin-body-plain' : block.headingLevel === 1 ? config.h1 || 'builtin-h2-minimal-large' : config[block.type] })),
    accent: config.accent, body: config.body, page: { paddingX: config.page?.paddingX ?? 20 }, imageGroup: normalizeImageGroup(config.imageGroup) };
}
export function materializeLayout(confirmed, plan, customBlocks = {}) {
  const library = { ...BUILTIN_BLOCKS_BY_ID, ...customBlocks };
  const source = confirmed.source;
  if (!plan || !Array.isArray(plan.blocks) || plan.blocks.length !== source.doc.length || !/^#[a-f0-9]{6}$/i.test(plan.accent)) throw Error('排版方案无效，原稿已保留');
  const assigned = new Map(plan.blocks.map(item => [item.uid, item.styleId]));
  if (assigned.size !== source.doc.length) throw Error('排版方案内容块不完整');
  const doc = source.doc.map(block => {
    const id = assigned.get(block.uid), style = library[id];
    if (!style || style.type !== block.type) throw Error('样式库已变化，原稿已保留，请重新排版');
    return { ...block, blockId: id, accent: null };
  });
  const styleBlocks = Object.fromEntries([...new Set(doc.map(block => block.blockId))]
    .filter(id => id.startsWith('db-')).map(id => [id, library[id]]));
  const imageGroup = normalizeImageGroup(plan.imageGroup) || doc.filter(block => block.type === 'imageCard')
    .map(block => normalizeImageGroup(library[block.blockId]?.imageGroup)).find(Boolean) || null;
  return { title: source.title, doc: arrangeImageGroups(doc, plan.imageLayout || 'auto', imageGroup), themeKey: 'minimal',
    blockConfig: { ...THEME_PRESETS.minimal, signoff: null, accent: plan.accent, body: plan.body, page: plan.page },
    sourceDocument: { ...confirmed.article, styleBlocks, confirmedAt: confirmed.confirmedAt,
      ...(imageGroup && (!plan.imageLayout || plan.imageLayout === 'auto') ? { imageGroupReference: imageGroup } : {}) } };
}

// 内容稿已排过版：把新内容合并进现有排版稿（文字/图片按内容匹配，保留原样式与分组），
// 而不是重新走模板、丢掉用户在排版稿里做的样式/换图/图注调整。
export function mergeContentIntoLayout(snapshot, layout) {
  if (!layout?.doc?.length) throw Error('没有可同步的排版稿');
  const previous = layout.doc;
  const used = new Set();
  const textOf = block => String(block.content ?? block.html ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  const styleKeys = ['blockId', 'accent', 'widthPct', 'radius', 'aspect', 'galleryStyle', 'galleryTemplate'];
  const findIndex = (block, index) => {
    if (block.type === 'imageCard') {
      const bySrc = previous.findIndex((candidate, i) => !used.has(i) && candidate.type === 'imageCard' && candidate.src === block.src);
      if (bySrc >= 0) return bySrc;
    }
    const text = textOf(block);
    if (text) {
      const byText = previous.findIndex((candidate, i) => !used.has(i) && candidate.type === block.type && textOf(candidate) === text);
      if (byText >= 0) return byText;
    }
    if (previous[index] && previous[index].type === block.type && !used.has(index)) return index;
    let best = -1, bestDistance = Infinity;
    previous.forEach((candidate, i) => {
      if (used.has(i) || candidate.type !== block.type) return;
      const distance = Math.abs(i - index);
      if (distance < bestDistance) { best = i; bestDistance = distance; }
    });
    return best;
  };
  const nearestStyle = (type, index) => {
    let best = null, bestDistance = Infinity;
    previous.forEach((candidate, i) => {
      if (candidate.type !== type) return;
      const distance = Math.abs(i - index);
      if (distance < bestDistance) { best = candidate; bestDistance = distance; }
    });
    return best;
  };
  const doc = snapshot.source.doc.map((block, index) => {
    const previousIndex = findIndex(block, index);
    const source = previousIndex >= 0 ? previous[previousIndex] : nearestStyle(block.type, index);
    if (previousIndex >= 0 && source === previous[previousIndex]) used.add(previousIndex);
    const next = { ...block };
    if (source) for (const key of styleKeys) if (source[key] != null) next[key] = source[key];
    if (block.type === 'imageCard' && !next.caption && source?.caption) next.caption = source.caption;
    return next;
  });
  const imageGroup = layout.sourceDocument?.imageGroupReference || null;
  return { ...layout, title: snapshot.source.title, doc: arrangeImageGroups(doc, 'auto', imageGroup),
    sourceDocument: { ...(layout.sourceDocument || {}), ...snapshot.article,
      styleBlocks: layout.sourceDocument?.styleBlocks || {}, confirmedAt: snapshot.confirmedAt } };
}

export function addObservedBrandAssets(layout, assets, library = {}, imageStyleId = layout.blockConfig.imageCard) {
  if (!Array.isArray(assets) || !assets.length) return layout;
  if (layout.doc.length + assets.length > 120) throw Error('加入固定图后内容块超过 120 个，请减少所选图片');
  const imageStyle = library[imageStyleId] || BUILTIN_BLOCKS_BY_ID[imageStyleId];
  if (!imageStyle || imageStyle.type !== 'imageCard') throw Error('固定图的样式不可用，请重新选择');
  const used = new Set(layout.doc.map(block => block.uid));
  const top = [], bottom = [];
  for (const asset of assets) {
    if (!/^[a-f0-9]{16}$/.test(asset.id || '') || !/^\/api\/wx-img\?url=/.test(asset.src || '')
      || !['top', 'bottom'].includes(asset.position)) throw Error('固定图信息无效，请重新选择');
    let uid = `brand-${asset.id}`, suffix = 1;
    while (used.has(uid)) uid = `brand-${asset.id}-${suffix++}`;
    used.add(uid);
    const block = { uid, kind: 'styled', type: 'imageCard', src: asset.src, caption: '', content: '',
      blockId: imageStyleId, accent: null };
    (asset.position === 'top' ? top : bottom).push(block);
  }
  return { ...layout, doc: [...top, ...layout.doc, ...bottom],
    sourceDocument: { ...layout.sourceDocument,
      styleBlocks: { ...layout.sourceDocument.styleBlocks, ...(imageStyleId.startsWith('db-') ? { [imageStyleId]: imageStyle } : {}) },
      brandAssets: assets.map(({ id, src, position }) => ({ id, src, position })) } };
}
