import { GALLERY_STYLES_BY_ID } from './galleryStyles';
import { isObservedGallery, snapshotGallery } from './observedGallery';

export const IMAGE_LAYOUTS = [
  { value: 'auto', label: '沿用内容稿' }, { value: 'single', label: '单列' },
  { value: 'pair', label: '双列' }, { value: 'triple', label: '三列' },
];
const isImage = block => block?.kind === 'styled' && block.type === 'imageCard';
const columnsFor = block => [2, 3].includes(block?.galleryColumns) ? block.galleryColumns : 1;
const insetFor = value => Number.isFinite(value) && value >= 0 && value <= 10 ? value : null;

export function normalizeImageGroup(value) {
  if (![2, 3].includes(value?.columns)) return null;
  return { columns: value.columns, insetPercent: insetFor(value.insetPercent) ?? 0,
    ...(Number.isInteger(value.articleId) && Number.isInteger(value.revisionId)
      ? { articleId: value.articleId, revisionId: value.revisionId, sourceTitle: String(value.sourceTitle || '') } : {}) };
}

// Keep explicit content groups separate even when their layouts happen to match.
export function imageRuns(doc) {
  const runs = [];
  (doc || []).forEach((block, index) => {
    const columns = isImage(block) ? columnsFor(block) : 1;
    const insetPercent = insetFor(block?.galleryInsetPercent);
    const template = isObservedGallery(block?.galleryTemplate) && block.galleryTemplate.id === block.galleryStyle ? block.galleryTemplate : null;
    const styleId = isImage(block) && (GALLERY_STYLES_BY_ID[block.galleryStyle] || template) ? block.galleryStyle : null;
    const previous = runs.at(-1);
    if (isImage(block) && (columns > 1 || block.galleryId) && previous?.columns === columns && previous.insetPercent === insetPercent
      && previous.styleId === styleId && isImage(previous.items[0].block)
      && (previous.items[0].block.galleryId || null) === (block.galleryId || null)) previous.items.push({ block, index });
    else runs.push({ columns, insetPercent, styleId, template, items: [{ block, index }] });
  });
  return runs.map(run => ({ ...run, columns: Math.min(run.columns, run.items.length) }));
}

export function imageRunForUid(doc, uid) {
  return imageRuns(doc).find(run => run.items.some(item => item.block.uid === uid) && isImage(run.items[0].block));
}

export function setImageRunStyle(doc, uid, styleId, style = null) {
  const run = imageRunForUid(doc, uid);
  const template = snapshotGallery(style);
  if (!run || run.items.length < 2 || (!GALLERY_STYLES_BY_ID[styleId] && !template)) return doc;
  const ids = new Set(run.items.map(item => item.block.uid));
  const galleryId = run.items[0].block.galleryId || `group-${uid}`;
  return doc.map(block => {
    if (!ids.has(block.uid)) return block;
    const next = { ...block, galleryId, galleryStyle: styleId };
    if (template) next.galleryTemplate = template;
    else delete next.galleryTemplate;
    return next;
  });
}

export function arrangeImageGroups(doc, layout = 'auto', observed = null) {
  if (!IMAGE_LAYOUTS.some(item => item.value === layout)) throw Error('组图布局无效');
  const result = doc.map(block => ({ ...block }));
  for (let start = 0; start < result.length; start++) {
    if (!isImage(result[start])) continue;
    let end = start + 1;
    while (end < result.length && isImage(result[end]) && (result[end].galleryId || null) === (result[start].galleryId || null)) end++;
    const learned = layout === 'auto' ? normalizeImageGroup(observed) : null;
    const columns = layout === 'single' ? 1 : layout === 'pair' ? 2 : layout === 'triple' ? 3
      : result[start].galleryId ? columnsFor(result[start]) : learned?.columns || (end - start >= 6 ? 3 : 2);
    for (let index = start; index < end; index++) {
      if (columns > 1 && end - start > 1) result[index].galleryColumns = Math.min(columns, end - start);
      // 「沿用内容稿」时必须保留内容稿给每张图的分组列数：同一组的两张图可能被中间段落隔开，
      // 各自成为长度 1 的 run；这里若强改成 1 会覆盖内容稿决定，套模板后组图边界/列数就丢了。
      else if (result[index].galleryId) result[index].galleryColumns = layout === 'auto' ? columnsFor(result[index]) : 1;
      else delete result[index].galleryColumns;
      if (learned) result[index].galleryInsetPercent = learned.insetPercent;
      else delete result[index].galleryInsetPercent;
    }
    start = end - 1;
  }
  return result;
}

export function setImageRunColumns(doc, uid, columns) {
  const index = doc.findIndex(block => block.uid === uid);
  if (!isImage(doc[index]) || ![1, 2, 3].includes(columns)) return doc;
  let start = index, end = index + 1;
  const sameGroup = block => isImage(block) && (block.galleryId || null) === (doc[index].galleryId || null);
  while (start > 0 && sameGroup(doc[start - 1])) start--;
  while (end < doc.length && sameGroup(doc[end])) end++;
  return doc.map((block, i) => {
    if (i < start || i >= end) return block;
    const next = { ...block, galleryColumns: columns, galleryStyle: null };
    delete next.galleryTemplate;
    return next;
  });
}

export function imageGroupHtml(parts, columns, insetPercent = null) {
  return `<section style="font-size:0;line-height:0;margin:12px 0;">${parts.map(html =>
    `<section style="display:inline-block;vertical-align:top;box-sizing:border-box;width:${100 / columns}%;padding:0 ${insetFor(insetPercent) == null ? '4px' : `${insetPercent / columns}%`};font-size:14px;line-height:1.5;overflow-wrap:anywhere;">${html}</section>`).join('')}</section>`;
}
