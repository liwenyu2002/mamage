const path = require('node:path');
const { finished } = require('node:stream/promises');
const { Readable } = require('node:stream');
const { ZipFile } = require('yazl');
const { buildAttachmentDisposition } = require('./cos_storage');

function safeName(value, maxBytes = 180) {
  const chars = Array.from(String(value || '').replace(/[\u0000-\u001f\u007f\\/:*?"<>|]/g, '_').replace(/^[. ]+|[. ]+$/g, ''));
  while (Buffer.byteLength(chars.join('')) > maxBytes) chars.pop();
  return chars.join('');
}

function parseVideoIds(value, max = 1000) {
  if (!Array.isArray(value) || !value.length || value.length > max
    || value.some(id => !/^[1-9]\d*$/.test(String(id)) || !Number.isSafeInteger(Number(id)))) {
    const error = new Error('INVALID_VIDEO_IDS'); error.status = 400; throw error;
  }
  return [...new Set(value.map(Number))];
}

function mediaFilename(row) {
  const ext = path.extname(String(row.url).split('?')[0]).toLowerCase();
  const suffix = /^\.[a-z0-9]{2,8}$/.test(ext) ? ext : row.type === 'video' ? '.mp4' : '.jpg';
  const parts = [...new Set([row.projectName, row.sectionName, String(row.title || '').replace(/\.[a-z0-9]{2,8}$/i, '')]
    .map(value => safeName(value)).filter(Boolean))];
  const title = safeName(parts.join('_')) || 'MaMage';
  return `${title}_${row.id}${suffix}`;
}

function videoFilename(row) { return mediaFilename({ ...row, type: 'video' }); }

function archiveName(rows) {
  const names = [...new Set(rows.map(row => row.projectName).filter(Boolean))];
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
  return `${safeName(names.length === 1 ? names[0] : 'MaMage-transfer', 140)}_${day}.zip`;
}

function createVideoDownloads({ pool, storage, requirePhotosAccess, buildMediaUrl, maxIds = 1000,
  maxConcurrent = 2, headersTimeoutMs = 15000, idleTimeoutMs = 60000, maxFileBytes = 100 * 1024 ** 3,
  metadataTimeoutMs = 3000 }) {
  let active = 0, activeHeads = 0;
  const sizes = new Map();
  function reserve() {
    if (active >= maxConcurrent) return null;
    active++;
    let released = false;
    return () => { if (!released) { released = true; active--; } };
  }
  async function rowsFor(req, input, videosOnly = true) {
    const ids = parseVideoIds(input, maxIds);
    await requirePhotosAccess(req, ids, 'read');
    const [rows] = await pool.query(`SELECT p.id, p.url, p.title, p.type, pr.name AS projectName, ts.name AS sectionName
      FROM photos p LEFT JOIN projects pr ON pr.id=p.project_id
      LEFT JOIN project_timeline_sections ts ON ts.id=p.timeline_section_id WHERE p.id IN (?)`, [ids]);
    const byId = new Map(rows.map(row => [Number(row.id), row]));
    return ids.map(id => {
      const row = byId.get(id);
      if (!row) { const e = new Error('VIDEO_NOT_FOUND'); e.status = 404; throw e; }
      if (videosOnly && row.type !== 'video') { const e = new Error('VIDEOS_ONLY'); e.status = 422; throw e; }
      const key = storage.keyFromUrlOrPath(row.url);
      if ((!key || !storage.isSafeKey(key) || !key.startsWith('uploads/')) && videosOnly) {
        const e = new Error('VIDEO_SOURCE_UNAVAILABLE'); e.status = 409; throw e;
      }
      return { ...row, id, key: key && storage.isSafeKey(key) && key.startsWith('uploads/') ? key : null, name: mediaFilename(row) };
    });
  }
  async function sizeOf(key, deadline) {
    const cached = sizes.get(key);
    if (cached?.expiresAt > Date.now()) return cached.promise || cached.size;
    if (!key || !storage.headObject || activeHeads >= 4 || Date.now() >= deadline) return null;
    activeHeads++;
    const controller = new AbortController();
    let timer;
    const entry = { expiresAt: Date.now() + metadataTimeoutMs };
    entry.promise = Promise.race([
      Promise.resolve().then(() => storage.headObject(key, { signal: controller.signal })),
      new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(Error('METADATA_TIMEOUT')); }, Math.min(1000, deadline - Date.now())); }),
    ]).then(head => {
      const size = head?.ContentLength == null ? NaN : Number(head.ContentLength);
      return Number.isSafeInteger(size) && size >= 0 ? size : null;
    }).catch(() => null).then(size => {
      entry.size = size; entry.expiresAt = Date.now() + (size === null ? 1000 : 60000); return size;
    }).finally(() => { clearTimeout(timer); controller.abort(); activeHeads--; delete entry.promise; });
    sizes.delete(key); sizes.set(key, entry);
    while (sizes.size > 5000) sizes.delete(sizes.keys().next().value);
    return entry.promise;
  }
  async function measure(rows, signal) {
    const deadline = Date.now() + metadataTimeoutMs;
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(4, rows.length) }, async () => {
      while (next < rows.length && !signal?.aborted) {
        const row = rows[next++];
        row.size = await sizeOf(row.key, deadline);
      }
    }));
    rows.forEach(row => { if (!Number.isSafeInteger(row.size)) row.size = null; });
  }
  function summaryData(rows) {
    return { items: rows.map(row => ({ id: row.id, name: row.name, size: row.size })),
      totalBytes: rows.reduce((sum, row) => sum + (row.size || 0), 0),
      unknownSizeCount: rows.filter(row => row.size === null).length,
      mediaCounts: { videos: rows.filter(row => row.type === 'video').length, photos: rows.filter(row => row.type !== 'video').length },
      zipName: archiveName(rows), maxConcurrent: 2 };
  }
  async function estimateRows(input, signal) {
    const rows = input.map(row => {
      const key = storage.keyFromUrlOrPath(row.url);
      return { ...row, key: key && storage.isSafeKey(key) && key.startsWith('uploads/') ? key : null };
    });
    await measure(rows, signal);
    return summaryData(rows);
  }
  async function describe(req, res, videosOnly) {
    const rows = await rowsFor(req, req.body?.photoIds, videosOnly);
    const controller = new AbortController(), close = () => controller.abort();
    res.once('close', close);
    try {
      await measure(rows, controller.signal);
      if (controller.signal.aborted) return;
      res.setHeader('Cache-Control', 'private, no-store');
      res.vary('Authorization');
      return res.json(summaryData(rows));
    } finally { res.removeListener('close', close); }
  }
  async function manifest(req, res) {
    return describe(req, res, true);
  }
  async function summary(req, res) { return describe(req, res, false); }
  async function filename(req, id) { return (await rowsFor(req, [id]))[0].name; }
  async function source(req, res) {
    const [row] = await rowsFor(req, [req.body?.photoId]);
    const proxy = new URL(buildMediaUrl(row.url, { userId: req.user.id, photoId: row.id }), 'http://localhost');
    const fallbackUrl = proxy.pathname + proxy.search;
    let url = fallbackUrl;
    // HTTPS pages must never be handed an HTTP storage URL. The authorized same-origin proxy is always available.
    try {
      const signed = await storage.signedGetUrl(row.key, { expires: 60, downloadName: row.name });
      const protocol = new URL(signed.signedUrl).protocol;
      const secure = String(req.get('x-forwarded-proto') || req.protocol).split(',')[0].trim() === 'https';
      if (protocol === 'https:' || (!secure && protocol === 'http:')) url = signed.signedUrl;
    } catch (_) { /* Keep the authenticated proxy fallback. */ }
    res.setHeader('Cache-Control', 'no-store');
    return res.json({ id: row.id, name: row.name, url, fallbackUrl });
  }
  async function stream(req, res, ids, { videosOnly = true } = {}) {
    const rows = await rowsFor(req, ids, videosOnly);
    if (rows.some(row => !row.key)) { const e = new Error('MEDIA_SOURCE_UNAVAILABLE'); e.status = 409; throw e; }
    if (res.destroyed) return;
    const release = reserve();
    if (!release) { res.setHeader('Retry-After', '10'); return res.status(429).json({ error: 'VIDEO_DOWNLOAD_BUSY' }); }
    const controller = new AbortController();
    let archive, body, entry, timer, closed = false;
    const stop = () => {
      closed = true; controller.abort(); clearTimeout(timer);
      body?.destroy(); entry?.destroy(); archive?.outputStream.destroy();
    };
    const open = async row => {
      timer = setTimeout(() => controller.abort(), headersTimeoutMs); timer.unref?.();
      try {
        const object = await storage.getObject(row.key, { signal: controller.signal });
        body = object.Body;
        if (closed || controller.signal.aborted || res.destroyed) { body?.destroy(); throw new Error('DOWNLOAD_CANCELLED'); }
        if (!body?.pipe || Number(object.ContentLength) > maxFileBytes) { body?.destroy(); const e = new Error('VIDEO_SOURCE_INVALID'); e.status = 413; throw e; }
        return object;
      } finally { clearTimeout(timer); }
    };
    res.once('close', stop);
    try {
      await measure(rows, controller.signal);
      if (closed) return;
      // Only metadata is read ahead. Originals are opened lazily, one at a time.
      let object = await open(rows[0]);
      const firstSize = object.ContentLength == null ? NaN : Number(object.ContentLength);
      rows[0].size = Number.isSafeInteger(firstSize) && firstSize >= 0 ? firstSize : null;
      archive = new ZipFile();
      archive.on('error', () => { stop(); if (!res.destroyed) res.destroy(); });
      archive.outputStream.on('error', () => { stop(); if (!res.destroyed) res.destroy(); });
      const name = archiveName(rows);
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', buildAttachmentDisposition(name));
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('X-Accel-Buffering', 'no');
      const folder = name.slice(0, -4);
      rows.forEach((row, i) => archive.addReadStreamLazy(`${folder}/${row.name}`, {
        compress: false, forceZip64Format: true, ...(row.size === null ? {} : { size: row.size }),
      }, callback => {
        (async () => {
          if (closed) throw Error('DOWNLOAD_CANCELLED');
          if (i) object = await open(row);
          const current = body;
          let received = 0;
          const expected = object.ContentLength == null ? null : Number(object.ContentLength);
          if (row.size !== null && row.size !== expected) throw Error('VIDEO_SIZE_CHANGED');
          entry = Readable.from((async function* chunks() {
            const iterator = current[Symbol.asyncIterator]();
            try {
              for (;;) {
                let wait, next;
                try {
                  // Wait for upstream only, never while the client applies backpressure.
                  next = await Promise.race([iterator.next(), new Promise((_, reject) => {
                    wait = setTimeout(() => { current.destroy(); reject(new Error('VIDEO_READ_TIMEOUT')); }, idleTimeoutMs);
                    wait.unref?.();
                  })]);
                } finally { clearTimeout(wait); }
                if (next.done) break;
                received += next.value.length;
                if (received > maxFileBytes) throw new Error('VIDEO_TOO_LARGE');
                yield next.value;
              }
              if (expected !== null && received !== expected) throw new Error('VIDEO_STREAM_INCOMPLETE');
            } finally { current.destroy(); }
          })(), { objectMode: false });
          entry.on('error', () => { stop(); if (!res.destroyed) res.destroy(); });
          callback(null, entry);
        })().catch(error => { callback(error); });
      }));
      archive.end({ forceZip64Format: true }, length => {
        if (Number.isSafeInteger(length) && length >= 0) res.setHeader('Content-Length', String(length));
      });
      archive.outputStream.pipe(res);
      await finished(res, { cleanup: true });
    } catch (error) {
      const disconnected = closed || res.destroyed;
      stop();
      if (!disconnected) {
        console.warn('[video-download] stream failed:', error.name, error.status || error.$metadata?.httpStatusCode || 'UPSTREAM');
        if (res.headersSent) res.destroy();
        else res.status(error.status || error.$metadata?.httpStatusCode || 502).json({ error: 'VIDEO_DOWNLOAD_FAILED' });
      }
    } finally {
      stop(); res.off('close', stop); release();
    }
  }
  return { manifest, summary, source, stream, estimateRows, filename, reserve };
}

module.exports = { createVideoDownloads, parseVideoIds, videoFilename, mediaFilename };
