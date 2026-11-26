const { createHash } = require('node:crypto');
const { extname } = require('node:path');
const storage = require('./cos_storage');
const { readStreamToBuffer } = require('./public_download_variant');

const MAX_BYTES = 2_000_000;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const IMAGE_TYPES = new Map(Object.entries({
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp',
  '.gif': 'image/gif', '.avif': 'image/avif', '.heic': 'image/heic', '.heif': 'image/heif',
  '.bmp': 'image/bmp', '.tif': 'image/tiff', '.tiff': 'image/tiff',
}));

function originalObject(url, unitId, store = storage) {
  const key = store.keyFromUrlOrPath(url);
  if (!key || !key.startsWith('uploads/') || !store.isSafeKey(key)) return null;
  const scoped = /^uploads\/units\/(\d+)\//.exec(key);
  if (scoped && Number(scoped[1]) !== unitId) return null;
  const extension = extname(key).toLowerCase();
  const contentType = IMAGE_TYPES.get(extension);
  return contentType ? { key, extension, contentType } : null;
}

async function load(objectKey, expectedSha, store = storage) {
  if (!/^integrations\/college-window\/[a-f0-9-]{36}\.jpg$/.test(objectKey)) throw new Error('COLLEGE_WINDOW_INVALID_KEY');
  const file = await store.getObject(objectKey, { signal: AbortSignal.timeout(15_000) });
  const bytes = await readStreamToBuffer(file.Body, { maxBytes: MAX_BYTES });
  if (sha256(bytes) !== expectedSha) throw new Error('COLLEGE_WINDOW_CORRUPT_IMAGE');
  return bytes;
}

module.exports = { originalObject, load };
