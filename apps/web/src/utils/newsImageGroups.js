const prefix = '<!-- mamage-image-group ';
export const MAX_WECHAT_GROUP_PHOTOS = 8;
export const draftGalleryColumns = count => count >= 6 ? 3 : count > 1 ? 2 : 1;

export function imageGroupMetadata(value) {
  return /^[A-Za-z0-9_-]{1,80}$/.test(value?.galleryId || '') && [1, 2, 3].includes(value.galleryColumns)
    ? { galleryId: value.galleryId, galleryColumns: value.galleryColumns } : null;
}

export function parseImageGroupMarker(raw) {
  const text = String(raw || '').trim();
  if (!text.startsWith(prefix) || !text.endsWith(' -->')) return null;
  try { return imageGroupMetadata(JSON.parse(text.slice(prefix.length, -4))); } catch { return null; }
}

export function imageGroupMarker(value) {
  const metadata = imageGroupMetadata(value);
  return metadata ? `${prefix}${JSON.stringify(metadata)} -->\n\n` : '';
}

// A marker belongs to one image, so moving, deleting or rewriting a caption cannot move a group boundary.
export function withDraftImageGroups(blocks, isImage = block => block.type === 'image') {
  const result = blocks.map(block => ({ ...block }));
  const used = new Set(result.map(block => block.galleryId).filter(Boolean));
  let serial = 0;
  for (let start = 0; start < result.length; start++) {
    if (!isImage(result[start])) continue;
    const original = imageGroupMetadata(result[start]);
    let end = start + 1;
    while (end < result.length && isImage(result[end])) {
      const next = imageGroupMetadata(result[end]);
      if (next?.galleryId !== original?.galleryId || next?.galleryColumns !== original?.galleryColumns) break;
      end++;
    }
    if (end - start > 1) for (let first = start; first < end; first += MAX_WECHAT_GROUP_PHOTOS) {
      const last = Math.min(end, first + MAX_WECHAT_GROUP_PHOTOS);
      let galleryId = first === start ? original?.galleryId : null;
      if (!galleryId) {
        do { galleryId = `draft-group-${serial++}`; } while (used.has(galleryId));
        used.add(galleryId);
      }
      for (let i = first; i < last; i++) Object.assign(result[i], { galleryId,
        galleryColumns: original?.galleryColumns || draftGalleryColumns(last - first) });
    }
    start = end - 1;
  }
  return result;
}
