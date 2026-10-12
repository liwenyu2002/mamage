export function pickProjectPreviewSrc(item) {
  if (!item) return null;
  if (typeof item === 'string') return item;
  return item.thumbSrc || item.thumbUrl || item.fullThumbUrl || item.thumbnail || item.thumb || item.coverUrl || item.url || item.fileUrl || item.imageUrl || null;
}

export function projectPreviewSourceKey(src) {
  if (!src) return '';
  // Ignore renewed access signatures, but keep query parameters on other image URLs.
  try {
    const url = new URL(src, 'http://preview.local');
    if (url.pathname.startsWith('/api/image/')) return url.pathname;
  } catch (error) { /* Compare malformed/legacy URLs without rewriting them. */ }
  return String(src);
}

export function findProjectPreviewPhotoId(src, items, resolveSource = value => value) {
  const key = projectPreviewSourceKey(src);
  if (!key) return null;
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const id = item.id ?? item.photoId ?? item.photo_id;
    if (id == null || String(id).trim() === '') continue;
    const sources = [pickProjectPreviewSrc(item), item.url, item.originalSrc, item.fullThumbUrl];
    if (sources.some(value => value && projectPreviewSourceKey(resolveSource(value)) === key)) return String(id);
  }
  return null;
}

export function findProjectPreviewIndex(items, { photoId, src }, resolveSource = value => value) {
  const id = photoId == null ? '' : String(photoId).trim();
  if (id) return items.findIndex(item => String(item?.id ?? item?.photoId ?? item?.photo_id ?? '') === id);
  const key = projectPreviewSourceKey(src);
  if (!key) return -1;
  return items.findIndex(item => [pickProjectPreviewSrc(item), item?.url, item?.originalSrc]
    .some(value => value && projectPreviewSourceKey(resolveSource(value)) === key));
}
