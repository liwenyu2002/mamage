import {
  DEFAULT_PHOTO_ADJUSTMENTS, normalizePhotoAdjustments, buildPhotoAdjustments,
  isDefaultPhotoAdjustments, processTonePixels, analyzeTonePixels,
} from '../../../server/lib/photo_tone/engine.mjs';

export { DEFAULT_PHOTO_ADJUSTMENTS, normalizePhotoAdjustments, buildPhotoAdjustments, isDefaultPhotoAdjustments };
export { getToneAdjustmentKey } from '../../../server/lib/photo_tone/engine.mjs';

// CSS brightness/sepia cannot represent the pixel pipeline. Keep the last exact
// frame on screen while the next one renders instead of swapping to an estimate.
export function getPhotoAdjustmentStyle() { return undefined; }

const sources = new Map();
export function loadTonePixels(src, options = {}) {
  const maxSize = Math.max(320, Math.min(4096, Number(options.maxSize || 1280)));
  const key = JSON.stringify([src, maxSize, options.token || '']);
  if (sources.has(key)) return sources.get(key);
  const promise = (async () => {
    let objectUrl = '';
    try {
      let imageSrc = src;
      let sourceWidth = 0, sourceHeight = 0;
      if (options.authenticated) {
        const response = await fetch(src, { headers: options.token ? { Authorization: `Bearer ${options.token}` } : {}, credentials: 'same-origin' });
        if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? '无权读取照片像素' : '无法读取照片像素');
        if (src.includes('variant=working') && response.headers.get('X-MaMage-Tone-Engine') !== 'mamage-tone-v3-srgb') throw new Error('当前服务器尚不支持新版调色');
        sourceWidth = Number(response.headers.get('X-MaMage-Source-Width'));
        sourceHeight = Number(response.headers.get('X-MaMage-Source-Height'));
        objectUrl = URL.createObjectURL(await response.blob()); imageSrc = objectUrl;
      }
      const img = new Image();
      if (!/^(blob:|data:)/.test(imageSrc)) img.crossOrigin = 'anonymous';
      img.src = imageSrc;
      await img.decode();
      const naturalWidth = sourceWidth || img.naturalWidth, naturalHeight = sourceHeight || img.naturalHeight;
      const scale = Math.min(1, maxSize / Math.max(img.naturalWidth, img.naturalHeight));
      const width = Math.max(1, Math.round(img.naturalWidth * scale)), height = Math.max(1, Math.round(img.naturalHeight * scale));
      const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' });
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, width, height); ctx.drawImage(img, 0, 0, width, height);
      return { width, height, naturalWidth, naturalHeight, data: ctx.getImageData(0, 0, width, height).data };
    } finally { if (objectUrl) URL.revokeObjectURL(objectUrl); }
  })().catch(error => { if (sources.get(key) === promise) sources.delete(key); throw error; });
  // At most four decoded previews, scoped to the current authenticated session.
  if (sources.size >= 4) sources.delete(sources.keys().next().value);
  sources.set(key, promise);
  return promise;
}

export async function analyzePhotoTone(src, adjustments, options = {}) {
  const source = await loadTonePixels(src, options);
  return analyzeTonePixels(source.data, processTonePixels(source.data, adjustments), adjustments);
}

export async function renderPhotoAdjustmentsToCanvas(canvas, src, adjustments, options = {}) {
  const source = await loadTonePixels(src, options);
  const pixels = processTonePixels(source.data, adjustments);
  canvas.width = source.width; canvas.height = source.height;
  canvas.getContext('2d', { colorSpace: 'srgb' }).putImageData(new ImageData(pixels, source.width, source.height), 0, 0);
  return { width: source.width, height: source.height, naturalWidth: source.naturalWidth, naturalHeight: source.naturalHeight };
}
