const { Worker } = require('node:worker_threads');
const path = require('node:path');
const crypto = require('node:crypto');
const { normalizePhotoAdjustments, isDefaultPhotoAdjustments } = require('./engine.mjs');
const { getBakedEdit, editRevision } = require('./artifacts.cjs');

let rendering = false;
function fail(status, message) { return Object.assign(new Error(message), { status }); }
function renderFullEdit(input, adjustments) {
  return new Promise((resolve, reject) => {
    let received = false;
    const worker = new Worker(path.join(__dirname, 'render_worker.cjs'), { workerData: { input, adjustments }, resourceLimits: { maxOldGenerationSizeMb: 192 } });
    const timer = setTimeout(() => { worker.terminate(); reject(fail(504, '编辑图片生成超时，请稍后重试')); }, 120000);
    worker.once('message', result => {
      received = true;
      clearTimeout(timer);
      if (result.error) reject(fail(422, '无法处理这张原图：' + result.error));
      else resolve({ ...result, buffer: Buffer.from(result.buffer), thumb: Buffer.from(result.thumb) });
    });
    worker.once('error', error => { clearTimeout(timer); reject(error); });
    worker.once('exit', code => { clearTimeout(timer); if (code || !received) reject(fail(500, '编辑图片生成失败')); });
  });
}

// The expensive pixel pass runs outside the HTTP event loop, before taking a
// row lock. A compare-and-swap prevents a stale editor replacing a newer result.
async function preparePhotoEdit({ row, adjustments, baseRevision, storage, loadOriginal, render = renderFullEdit }) {
  if (row.type === 'video') throw fail(400, '视频不支持照片编辑');
  const revision = editRevision(row);
  if (baseRevision != null && baseRevision !== revision) throw fail(409, '照片已被其他人编辑，请重新打开后再修改');
  const normalized = normalizePhotoAdjustments(adjustments);
  const previous = getBakedEdit(row);
  const retired = previous ? [previous.url, previous.thumbUrl, ...(previous.retired || [])] : [];
  let created = [];
  const cleanup = async keys => {
    const safe = [...new Set(keys)].filter(key => new RegExp(`^uploads/photo-edits/${Number(row.id)}/[a-f0-9-]{36}/(?:image\\.jpg|thumb\\.webp)$`).test(key));
    if (safe.length) {
      const result = await storage.deleteObjects(safe);
      if (result?.errors?.length || result?.skipped?.length) throw fail(502, '编辑缓存清理失败');
    }
  };
  if (rendering) throw fail(429, '正在生成其他编辑图片，请稍后再保存');
  rendering = true;
  try {
    let baked = null;
    if (!isDefaultPhotoAdjustments(normalized)) {
      if (!storage.isConfigured()) throw fail(503, '图片存储暂不可用，未更改已有编辑');
      const input = await loadOriginal(row);
      const result = await render(input, normalized);
      const token = crypto.randomUUID(), prefix = `uploads/photo-edits/${row.id}/${token}/`;
      baked = { photoId: Number(row.id), revision: token, url: prefix + 'image.jpg', thumbUrl: prefix + 'thumb.webp',
        width: result.width, height: result.height, bytes: result.buffer.length, retired };
      created = [baked.url, baked.thumbUrl];
      await storage.uploadBuffer(baked.url, result.buffer, { contentType: 'image/jpeg', cacheControl: 'private, no-store' });
      await storage.uploadBuffer(baked.thumbUrl, result.thumb, { contentType: 'image/webp', cacheControl: 'private, no-store' });
    }
    const saved = { ...normalized, ...(baked ? { baked } : {}) };
    return {
      saved, revision,
      assertCurrent(current) {
        if (!current || current.url !== row.url || editRevision(current) !== revision) throw fail(409, '照片已更新，请重新打开后再修改');
      },
      abort: () => cleanup(created),
      committed: () => cleanup(retired),
    };
  } catch (error) {
    await cleanup(created).catch(() => console.error('[photo-edit] temporary artifact cleanup failed', row.id));
    throw error;
  } finally { rendering = false; }
}

module.exports = { preparePhotoEdit, renderFullEdit };
