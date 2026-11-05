const prefix = '<!-- mamage-image-group ';

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
    if (!isImage(result[start]) || imageGroupMetadata(result[start])) continue;
    let end = start + 1;
    while (end < result.length && isImage(result[end]) && !imageGroupMetadata(result[end])) end++;
    if (end - start > 1) {
      let galleryId;
      do { galleryId = `draft-group-${serial++}`; } while (used.has(galleryId));
      used.add(galleryId);
      for (let i = start; i < end; i++) Object.assign(result[i], { galleryId, galleryColumns: end - start >= 6 ? 3 : 2 });
    }
    start = end - 1;
  }
  return result;
}
