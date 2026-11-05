import { GALLERY_STYLES_BY_ID } from './galleryStyles';
import { imageRunForUid, setImageRunStyle } from './imageGroups';
import { isObservedGallery } from './observedGallery';

export function replacementError(block, style) {
  if (!block) return '原内容块已不存在，请重新选择';
  if (style?.type === 'imageGroup' && (GALLERY_STYLES_BY_ID[style.id] || isObservedGallery(style))) return block.kind === 'styled' && block.type === 'imageCard'
    ? '' : '请将组图样式应用到一组图片';
  if (!style?.id || !style.htmlTemplate) return '该样式已不可用，请重新选择';
  if (block.kind === 'raw') return '导入容器不能直接替换为单块样式，请先整理为正文或图片块';
  const type = block.kind === 'para' ? 'body' : block.type;
  if (!['para', 'styled'].includes(block.kind) || type !== style.type) return '样式类型不匹配，请选择同类型的样式';
  const html = style.htmlTemplate;
  if (type === 'imageCard') {
    if (!html.includes('{{src}}')) return '这个样式没有图片位置，无法保留原图片';
    if (block.caption && !html.includes('{{caption}}')) return '这个样式没有图题位置，请选择支持图题的样式';
  } else if (type !== 'divider' && !html.includes('{{content}}')) return '这个样式没有文字位置，无法保留原内容';
  return '';
}

// Keep the content model intact; presentation changes are a single undoable edit.
export function replaceBlockStyle(doc, uid, style) {
  const block = doc.find(item => item.uid === uid);
  const error = replacementError(block, style);
  if (error) return { doc, error, changed: false };
  if (style.type === 'imageGroup') {
    const run = imageRunForUid(doc, uid);
    if (!run || run.items.length < 2) return { doc, error: '请先在内容稿中将至少两张图片设为同一组', changed: false };
    if (isObservedGallery(style) && run.items.length < style.slots) return { doc, error: `这个原版样式需要至少 ${style.slots} 张图片，当前有 ${run.items.length} 张`, changed: false };
    if (run.styleId === style.id) return { doc, error: '', changed: false };
    return { doc: setImageRunStyle(doc, uid, style.id, style), error: '', changed: true };
  }
  if (block.blockId === style.id) return { doc, error: '', changed: false };
  return { doc: doc.map(item => item.uid === uid ? { ...item, blockId: style.id } : item), error: '', changed: true };
}

export function styleDropBlock(point, elements) {
  for (const element of elements) {
    const rect = element.getBoundingClientRect();
    const edge = Math.min(14, rect.height * 0.22);
    if (point.x >= rect.left + 4 && point.x <= rect.right - 4
      && point.y >= rect.top + edge && point.y <= rect.bottom - edge) {
      return { uid: element.getAttribute('data-cve-uid') || element.getAttribute('data-cve-gallery-uid'), rect };
    }
  }
  return null;
}
