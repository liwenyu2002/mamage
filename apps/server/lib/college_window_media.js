const { createHash } = require('node:crypto');
const sharp = require('sharp');
const storage = require('./cos_storage');
const { readStreamToBuffer } = require('./public_download_variant');
const { rawAdjustments, getBakedEdit } = require('./photo_tone/artifacts.cjs');
const { renderAdjustedPhotoBuffer } = require('./photo_tone/render.cjs');
const { normalizePhotoAdjustments } = require('./photo_tone/engine.mjs');
const { ANONYMIZED_TAGS } = require('./college_window_policy');

const OBJECT_PREFIX = 'integrations/college-window/';
const MAX_BYTES = 2_000_000;
const LONG_EDGE = 1920;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const anonymized = new RegExp(ANONYMIZED_TAGS);

function hidesIdentity(row) {
  // Cropped/rotated pixels do not necessarily contain the original named subjects.
  const a = normalizePhotoAdjustments(row.adjustments);
  const raw = rawAdjustments(row.adjustments);
  const tags = typeof row.tags === 'string' ? row.tags : JSON.stringify(row.tags || []);
  return Boolean(a.crop || a.rotation || raw?.crop || raw?.rotation || anonymized.test(tags));
}

async function render(row, store = storage) {
  const raw = rawAdjustments(row.adjustments);
  const baked = getBakedEdit(row);
  if (raw?.baked && !baked) throw new Error('COLLEGE_WINDOW_INVALID_EDIT');
  if (!baked && raw) {
    const a = normalizePhotoAdjustments(raw);
    if ((raw.crop && !a.crop) || (Number(raw.rotation) && !a.rotation && Number(raw.rotation) % 360 !== 0)) {
      throw new Error('COLLEGE_WINDOW_INVALID_EDIT');
    }
  }
  const key = baked?.url || store.keyFromUrlOrPath(row.sourceKey);
  if (!key || !key.startsWith('uploads/') || !store.isSafeKey(key)) throw new Error('COLLEGE_WINDOW_INVALID_SOURCE');
  const file = await store.getObject(key, { signal: AbortSignal.timeout(20_000) });
  const original = await readStreamToBuffer(file.Body, { maxBytes: 48 * 1024 * 1024 });
  // Never fall back to an unedited original if the saved rendition is missing.
  const image = !baked && raw ? await renderAdjustedPhotoBuffer(original, raw, { maxSize: LONG_EDGE, format: 'png' }) : original;
  const result = await sharp(image, { failOn: 'error', limitInputPixels: 64 * 1024 * 1024 }).rotate()
    .resize(LONG_EDGE, LONG_EDGE, { fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#fff' }).toColourspace('srgb')
    .jpeg({ quality: 86, mozjpeg: true }).toBuffer({ resolveWithObject: true });
  if (result.data.length > MAX_BYTES) throw new Error('COLLEGE_WINDOW_IMAGE_TOO_LARGE');
  return { data: result.data, sha256: sha256(result.data), width: result.info.width, height: result.info.height };
}

async function load(objectKey, expectedSha, store = storage) {
  if (!/^integrations\/college-window\/[a-f0-9-]{36}\.jpg$/.test(objectKey)) throw new Error('COLLEGE_WINDOW_INVALID_KEY');
  const file = await store.getObject(objectKey, { signal: AbortSignal.timeout(15_000) });
  const bytes = await readStreamToBuffer(file.Body, { maxBytes: MAX_BYTES });
  if (sha256(bytes) !== expectedSha) throw new Error('COLLEGE_WINDOW_CORRUPT_IMAGE');
  return bytes;
}

module.exports = { OBJECT_PREFIX, render, load, hidesIdentity };
