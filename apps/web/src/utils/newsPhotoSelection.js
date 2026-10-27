export const NEWS_PHOTO_LIMIT = 30;

export function normalizeNewsPhoto(photo, album = {}) {
  if (!photo) return null;
  const video = [photo.type, photo.mediaType, photo.media_type, photo.mimeType, photo.mime_type]
    .some(value => /^video(?:\/|$)/i.test(String(value || '')));
  if (video || /\.(mp4|mov|m4v|webm)(?:\?|$)/i.test(photo.url || photo.fullUrl || '')) return null;
  const id = Number(photo.id);
  const url = photo.url || photo.fullUrl || photo.thumbUrl || photo.thumbSrc || photo.thumb;
  if (!Number.isSafeInteger(id) || id <= 0 || !url) return null;
  return { ...photo, id, url, thumbUrl: photo.thumbUrl || photo.thumbSrc || photo.thumb || url,
    description: photo.description || photo.caption || '',
    projectId: photo.projectId || photo.project_id || album.id || null,
    projectTitle: photo.projectTitle || album.projectName || album.name || album.title || '',
    eventDate: photo.eventDate || album.eventDate || null };
}

export function mergeNewsPhotos(photos, additions = []) {
  const seen = new Set();
  return [...photos, ...additions].map(photo => normalizeNewsPhoto(photo)).filter(photo => {
    if (!photo || seen.has(photo.id)) return false;
    seen.add(photo.id);
    return true;
  }).slice(0, NEWS_PHOTO_LIMIT);
}

export function newsAlbumDefaults(photos) {
  const ids = new Set(photos.map(photo => photo.projectId).filter(Boolean).map(String));
  if (ids.size !== 1 || photos.some(photo => !photo.projectId)) return {};
  return { eventName: photos.find(photo => photo.projectTitle)?.projectTitle || '',
    eventDate: photos.find(photo => photo.eventDate)?.eventDate || null };
}
