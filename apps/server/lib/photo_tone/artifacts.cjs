const crypto = require('node:crypto');

function rawAdjustments(value) {
  try { return typeof value === 'string' ? JSON.parse(value) : value; } catch { return null; }
}
function getBakedEdit(row) {
  const baked = rawAdjustments(row?.adjustments)?.baked;
  const id = Number(row?.id);
  if (!baked || !Number.isSafeInteger(id) || id <= 0 || baked.photoId !== id || !/^[a-f0-9-]{36}$/.test(baked.revision || '')) return null;
  const prefix = `uploads/photo-edits/${id}/${baked.revision}/`;
  if (baked.url !== prefix + 'image.jpg' || baked.thumbUrl !== prefix + 'thumb.webp') return null;
  if (!(baked.width > 0 && baked.height > 0)) return null;
  return baked;
}
function editRevision(row) {
  const raw = rawAdjustments(row?.adjustments);
  return getBakedEdit(row)?.revision || crypto.createHash('sha256').update(JSON.stringify(raw || null)).digest('hex');
}
function editableSourceUrl(url) {
  if (!url) return url;
  return `${url}${String(url).includes('?') ? '&' : '?'}original=1`;
}
function savedDisplayKey(row, key) {
  const baked = getBakedEdit(row);
  if (!baked || row.type === 'video') return key;
  const normalize = value => require('../cos_storage').keyFromUrlOrPath(value);
  if (normalize(row.thumb_url || row.thumbUrl) === key) return baked.thumbUrl;
  if (normalize(row.url) === key) return baked.url;
  return key;
}
function displayPhotoRow(row) {
  if (!row) return row;
  const baked = getBakedEdit(row);
  return baked && row.type !== 'video' ? { ...row, url: baked.url, thumbUrl: baked.thumbUrl } : row;
}
function publicAdjustments(value, id) {
  if (!value) return null;
  try {
    const normalized = require('./engine.mjs').normalizePhotoAdjustments(value);
    const baked = getBakedEdit({ id, adjustments: value });
    return { ...normalized, ...(baked ? { baked: { photoId: baked.photoId, revision: baked.revision, width: baked.width, height: baked.height } } : {}) };
  } catch { return null; }
}
module.exports = { rawAdjustments, getBakedEdit, editRevision, editableSourceUrl, savedDisplayKey, displayPhotoRow, publicAdjustments };
