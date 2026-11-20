import JSZip from 'jszip';
import { DEFAULT_PHOTO_ADJUSTMENTS, isDefaultPhotoAdjustments, loadTonePixels } from './photoAdjustments';
import { canvasFromPixels, drawPhotoGeometry } from './photoGeometry';
import { fitImageSize, collageLayout, imageExportName } from './personalImageLayout';
import { paintPersonalAnnotations, assertPersonalCanvasSize } from './personalAnnotations';

const allowed = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif']);
const canceled = () => new DOMException('操作已取消', 'AbortError');
const check = signal => { if (signal?.aborted) throw canceled(); };
const mime = format => {
  if (!['jpeg', 'png', 'webp'].includes(format)) throw new Error('不支持的导出格式');
  return 'image/' + format;
};

export async function readPersonalFile(file) {
  if (!allowed.has(file.type)) throw new Error('请选择 JPG、PNG、WebP 或 AVIF 图片');
  if (file.size > 40 * 1024 * 1024) throw new Error('单张图片不能超过 40 MB');
  const url = URL.createObjectURL(file), image = new Image();
  try {
    image.src = url; await image.decode();
    if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 24000000
      || Math.max(image.naturalWidth, image.naturalHeight) > 16384) throw new Error('单张图片最多支持 2400 万像素，最长边不超过 16384 像素');
    return { id: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`, file, url,
      width: image.naturalWidth, height: image.naturalHeight, name: file.name, size: file.size,
      adjustments: { ...DEFAULT_PHOTO_ADJUSTMENTS } };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw new Error(error.name === 'EncodingError' ? '当前浏览器无法解码这张图片' : error.message);
  } finally { image.src = ''; }
}

async function renderBaseCanvas(item, { signal } = {}) {
  check(signal);
  assertPersonalCanvasSize(item.width, item.height, item.adjustments);
  if (isDefaultPhotoAdjustments(item.adjustments)) {
    const image = new Image();
    try {
      image.src = item.url; await image.decode(); check(signal);
      const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
      canvas.getContext('2d', { colorSpace: 'srgb' }).drawImage(image, 0, 0);
      return canvas;
    } finally { image.src = ''; }
  }
  const source = await loadTonePixels(item.url, { fullResolution: true });
  check(signal);
  const pixels = await new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./photoTone.worker.js', import.meta.url), { type: 'module' });
    const stop = () => { worker.terminate(); signal?.removeEventListener('abort', abort); clearTimeout(timer); };
    const abort = () => { stop(); reject(canceled()); };
    const timer = setTimeout(() => { stop(); reject(new Error('图片处理超时，请缩小图片后重试')); }, 120000);
    signal?.addEventListener('abort', abort, { once: true });
    worker.onmessage = ({ data }) => {
      if (data.type !== 'rendered' && !data.pixels && !data.error) return;
      stop();
      if (data.error) reject(new Error(data.error)); else resolve(data.pixels);
    };
    worker.onerror = () => { stop(); reject(new Error('本地图片处理失败')); };
    worker.postMessage({ type: 'source', source }, [source.data.buffer]);
    worker.postMessage({ type: 'render', id: 1, adjustments: item.adjustments, faces: [], meteringKey: '[]' });
  });
  check(signal);
  const colored = canvasFromPixels(pixels, source.width, source.height), result = document.createElement('canvas');
  try { drawPhotoGeometry(colored, result, item.adjustments); return result; }
  finally { colored.width = colored.height = 0; }
}

export async function renderPersonalCanvas(item, options = {}) {
  const canvas = await renderBaseCanvas(item, options);
  try {
    check(options.signal);
    paintPersonalAnnotations(canvas, item.annotations, { width: item.width, height: item.height, adjustments: item.adjustments });
    return canvas;
  } catch (error) { canvas.width = canvas.height = 0; throw error; }
}

const blobFromCanvas = (canvas, format, quality) => new Promise((resolve, reject) => {
  const type = mime(format);
  canvas.toBlob(blob => {
    if (!blob) reject(new Error('无法导出图片，请减小尺寸'));
    else if (blob.type !== type) reject(new Error('当前浏览器不支持此导出格式，请选择 PNG 或 JPG'));
    else resolve(blob);
  }, type, quality);
});

export async function encodePersonalCanvas(source, { format = 'jpeg', maxEdge = 2400, targetKB = 0, allowResize = true, signal } = {}) {
  mime(format);
  const budget = Number(targetKB) * 1000;
  if (!Number.isFinite(budget) || budget < 0 || (budget > 0 && budget < 1000)) throw new Error('体积上限至少为 1 KB');
  let size = fitImageSize(source.width, source.height, maxEdge);
  const output = document.createElement('canvas');
  try {
    for (let pass = 0; pass < 12; pass++) {
      check(signal);
      output.width = size.width; output.height = size.height;
      const context = output.getContext('2d', { colorSpace: 'srgb' });
      if (format === 'jpeg') { context.fillStyle = '#fff'; context.fillRect(0, 0, size.width, size.height); }
      context.drawImage(source, 0, 0, size.width, size.height);
      let best = await blobFromCanvas(output, format, 0.95);
      if (!budget || best.size <= budget) return { blob: best, ...size };
      if (format !== 'png') {
        let low = 0.45, high = 0.95, candidate = null;
        const smallest = await blobFromCanvas(output, format, low);
        if (smallest.size <= budget) {
          candidate = smallest;
          for (let step = 0; step < 7; step++) {
            check(signal);
            const quality = (low + high) / 2, blob = await blobFromCanvas(output, format, quality);
            if (blob.size <= budget) { candidate = blob; low = quality; } else high = quality;
          }
          return { blob: candidate, ...size };
        }
        best = smallest;
      }
      if (!allowResize) break;
      const scale = Math.min(0.85, Math.sqrt(budget / best.size) * 0.9);
      const next = { width: Math.max(1, Math.floor(size.width * scale)), height: Math.max(1, Math.floor(size.height * scale)) };
      if (next.width === size.width && next.height === size.height) break;
      size = next;
    }
    throw new Error('无法在当前限制下导出，请提高体积上限或允许缩小尺寸');
  } finally { output.width = output.height = 0; }
}

export async function exportPersonalImage(item, options = {}) {
  const canvas = await renderPersonalCanvas(item, options);
  try {
    const result = await encodePersonalCanvas(canvas, options);
    return { ...result, name: imageExportName(item.name, options.format || 'jpeg', options.index) };
  } finally { canvas.width = canvas.height = 0; }
}

export async function renderPersonalCollage(items, options = {}) {
  const layout = collageLayout(items.length, options), result = document.createElement('canvas');
  result.width = layout.width; result.height = layout.height;
  const context = result.getContext('2d', { colorSpace: 'srgb' });
  context.fillStyle = '#fff'; context.fillRect(0, 0, result.width, result.height);
  try {
    for (let index = 0; index < items.length; index++) {
      check(options.signal);
      const canvas = await renderPersonalCanvas(items[index], options), cell = layout.cells[index];
      try {
        const scale = Math.min(cell.width / canvas.width, cell.height / canvas.height);
        const width = canvas.width * scale, height = canvas.height * scale;
        context.drawImage(canvas, cell.x + (cell.width - width) / 2, cell.y + (cell.height - height) / 2, width, height);
        if (cell.labelHeight) {
          context.fillStyle = '#15191b'; context.font = `600 ${Math.max(16, Math.round(cell.labelHeight * 0.65))}px Arial, sans-serif`;
          context.textBaseline = 'middle'; context.fillText(cell.label, cell.x, cell.y + cell.height + cell.labelHeight / 2);
        }
      } finally { canvas.width = canvas.height = 0; }
    }
    return result;
  } catch (error) { result.width = result.height = 0; throw error; }
}

export async function exportPersonalZip(items, options = {}, onProgress) {
  const zip = new JSZip(), results = [];
  for (let index = 0; index < items.length; index++) {
    check(options.signal);
    const result = await exportPersonalImage(items[index], { ...options, index });
    zip.file(result.name, await result.blob.arrayBuffer());
    results.push({ name: result.name, width: result.width, height: result.height, bytes: result.blob.size });
    onProgress?.(index + 1, items.length);
  }
  check(options.signal);
  const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
  check(options.signal);
  return { blob, results };
}

export function downloadPersonalBlob(blob, name) {
  const url = URL.createObjectURL(blob), anchor = document.createElement('a');
  anchor.href = url; anchor.download = name; anchor.rel = 'noopener'; document.body.appendChild(anchor);
  anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
