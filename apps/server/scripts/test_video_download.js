const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { Readable, PassThrough } = require('node:stream');
const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { createVideoDownloads, parseVideoIds, videoFilename, mediaFilename } = require('../lib/video_download');

async function fixture(options = {}) {
  const rows = options.rows || [1, 2, 3].map(id => ({ id, type: 'video', title: 'same-name', url: `uploads/units/1/videos/${id}.mp4` }));
  const calls = { reads: [], heads: [], auth: [] };
  const handlers = createVideoDownloads({
    pool: { query: async () => [rows] },
    requirePhotosAccess: async (_req, ids, action) => { calls.auth.push({ ids, action }); if (options.denied) throw Object.assign(Error('DENIED'), { status: 403 }); },
    buildMediaUrl: (_url, context) => `/api/image/safe?id=${context.photoId}`,
    storage: { keyFromUrlOrPath: url => url, isSafeKey: key => !key.includes('..'),
      signedGetUrl: async () => ({ signedUrl: 'http://storage.invalid/private?short-signature=1' }),
      headObject: async (key, input) => {
        calls.heads.push(key);
        return options.head ? options.head(key, input) : { ContentLength: options.read ? undefined : Buffer.byteLength(key) };
      },
      getObject: async (key, input) => {
        calls.reads.push(key);
        return options.read ? options.read(key, input) : { Body: Readable.from([Buffer.from(key)]), ContentLength: Buffer.byteLength(key) };
      } },
    headersTimeoutMs: options.headersTimeoutMs || 1000, idleTimeoutMs: options.idleTimeoutMs || 1000,
    maxConcurrent: options.maxConcurrent || 2,
    metadataTimeoutMs: options.metadataTimeoutMs || 300,
  });
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { req.user = { id: 47 }; next(); });
  const wrap = handler => async (req, res) => { try { await handler(req, res); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } };
  app.post('/manifest', wrap(handlers.manifest)); app.post('/summary', wrap(handlers.summary)); app.post('/source', wrap(handlers.source));
  app.post('/zip', wrap((req, res) => handlers.stream(req, res, req.body.photoIds)));
  app.post('/mixed-zip', wrap((req, res) => handlers.stream(req, res, req.body.photoIds, { videosOnly: false })));
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  return { calls, base: `http://127.0.0.1:${server.address().port}`,
    close: async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } };
}
const post = (base, route, data, options = {}) => fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json', ...options.headers }, body: JSON.stringify(data), ...options });

test('IDs and filenames reject unsafe input; duplicate titles produce distinct safe names', () => {
  for (const value of [[], [0], [-1], ['1oops'], [1.2], [Number.MAX_SAFE_INTEGER + 1]]) assert.throws(() => parseVideoIds(value));
  assert.deepEqual(parseVideoIds([2, '2', 1]), [2, 1]);
  const one = videoFilename({ id: 1, title: '../bad:name.mp4', url: 'uploads/a.mp4' });
  assert.ok(!/[\\/:]/.test(one)); assert.notEqual(one, videoFilename({ id: 2, title: '../bad:name.mp4', url: 'uploads/b.mp4' }));
  const named = videoFilename({ id: 7, projectName: 'College event', sectionName: 'Opening', title: 'Speech.mp4', url: 'uploads/a.MOV' });
  assert.equal(named, 'College event_Opening_Speech_7.mov');
  assert.ok(Buffer.byteLength(videoFilename({ id: 7, projectName: 'a'.repeat(500), url: 'uploads/a.mp4' })) < 240);
  assert.equal(mediaFilename({ id: 8, type: 'normal', projectName: 'College event', title: 'Photo.JPG', url: 'uploads/a.JPG' }), 'College event_Photo_8.jpg');
  assert.equal(mediaFilename({ id: 8, type: 'normal', url: 'uploads/no-extension' }), 'MaMage_8.jpg');
});

test('manifest is metadata-only, preserves selected order, and source never returns mixed HTTP to HTTPS', async () => {
  const f = await fixture();
  try {
    const response = await post(f.base, '/manifest', { photoIds: [3, 1] });
    const data = await response.json();
    assert.equal(response.status, 200); assert.deepEqual(data.items.map(item => item.id), [3, 1]);
    assert.equal(data.totalBytes, Buffer.byteLength('uploads/units/1/videos/3.mp4') * 2);
    assert.equal(data.unknownSizeCount, 0);
    assert.match(data.zipName, /\.zip$/);
    assert.equal(f.calls.reads.length, 0); assert.equal(f.calls.auth[0].action, 'read');
    const source = await post(f.base, '/source', { photoId: 1 }, { headers: { 'Content-Type': 'application/json', 'x-forwarded-proto': 'https' } });
    const info = await source.json(); assert.equal(info.url, info.fallbackUrl); assert.ok(info.url.startsWith('/api/image/'));
  } finally { await f.close(); }
});

test('no cross-workspace data or storage reads on denied access; mixed selections are rejected, not silently skipped', async () => {
  for (const options of [{ denied: true }, { rows: [{ id: 1, type: 'normal', url: 'uploads/a.jpg' }] }]) {
    const f = await fixture(options);
    try {
      const response = await post(f.base, '/zip', { photoIds: [1] });
      assert.equal(response.status, options.denied ? 403 : 422); assert.equal(f.calls.reads.length, 0);
    } finally { await f.close(); }
  }
});

test('ZIP64 is STORE, starts before later video reads, and contains every selected original', async () => {
  let release;
  const second = new Promise(resolve => { release = resolve; });
  const f = await fixture({ head: async key => ({ ContentLength: Buffer.byteLength(`original:${key}`) }), read: async key => {
    if (key.endsWith('/2.mp4')) await second;
    return { Body: Readable.from([Buffer.from(`original:${key}`)]), ContentLength: Buffer.byteLength(`original:${key}`) };
  } });
  try {
    const response = await post(f.base, '/zip', { photoIds: [1, 2, 3] });
    assert.equal(response.status, 200); assert.equal(response.headers.get('x-accel-buffering'), 'no');
    const reader = response.body.getReader(); const first = await reader.read();
    assert.equal(Buffer.from(first.value).readUInt32LE(0), 0x04034b50);
    assert.equal(Buffer.from(first.value).readUInt16LE(8), 0);
    release(); const parts = [Buffer.from(first.value)];
    for (;;) { const { value, done } = await reader.read(); if (done) break; parts.push(Buffer.from(value)); }
    const zip = Buffer.concat(parts); assert.ok(zip.includes(Buffer.from('PK\x06\x06')));
    assert.equal(Number(response.headers.get('content-length')), zip.length, 'Native downloader must know the exact ZIP size');
    for (const id of [1, 2, 3]) assert.ok(zip.includes(Buffer.from(`original:uploads/units/1/videos/${id}.mp4`)));
    assert.equal(f.calls.reads.length, 3);
  } finally { release(); await f.close(); }
});

test('summary accepts mixed media, caches bounded HEAD metadata, and never fetches original bodies', async () => {
  let active = 0, peak = 0;
  const rows = Array.from({ length: 12 }, (_, i) => ({ id: i + 1, type: i % 2 ? 'normal' : 'video',
    title: 'Original', projectName: 'Campus', url: `uploads/${i + 1}.${i % 2 ? 'jpg' : 'mp4'}` }));
  const f = await fixture({ rows, head: async () => { active++; peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 5)); active--; return { ContentLength: 1024 }; } });
  try {
    const ids = rows.map(row => row.id);
    const data = await (await post(f.base, '/summary', { photoIds: ids })).json();
    assert.equal(data.totalBytes, 12 * 1024); assert.equal(data.unknownSizeCount, 0);
    assert.deepEqual(data.mediaCounts, { videos: 6, photos: 6 });
    assert.ok(peak <= 4); assert.equal(f.calls.reads.length, 0);
    await post(f.base, '/summary', { photoIds: ids }); assert.equal(f.calls.heads.length, 12);
  } finally { await f.close(); }
});

test('mixed originals stream together in a single flat directory with exact length and unchanged bytes', async () => {
  const rows = [
    { id: 1, type: 'normal', title: 'Same', projectName: 'Campus', url: 'uploads/1.jpg' },
    { id: 2, type: 'video', title: 'Same', projectName: 'Campus', url: 'uploads/2.mp4' },
    { id: 3, type: 'normal', title: 'Same', projectName: 'Campus', url: 'uploads/3.jpg' },
  ];
  const f = await fixture({ rows });
  try {
    const response = await post(f.base, '/mixed-zip', { photoIds: [2, 1, 3] });
    assert.equal(response.status, 200);
    const zip = Buffer.from(await response.arrayBuffer());
    assert.equal(Number(response.headers.get('content-length')), zip.length);
    const entries = [];
    for (let offset = 0; offset + 46 < zip.length; offset++) {
      if (zip.readUInt32LE(offset) !== 0x02014b50) continue;
      const length = zip.readUInt16LE(offset + 28);
      entries.push(zip.subarray(offset + 46, offset + 46 + length).toString('utf8'));
    }
    assert.equal(entries.length, rows.length);
    assert.equal(new Set(entries.map(entry => entry.split('/')[0])).size, 1);
    assert.ok(entries.every(entry => entry.split('/').length === 2));
    assert.deepEqual(entries.map(entry => entry.split('/')[1]), ['Campus_Same_2.mp4', 'Campus_Same_1.jpg', 'Campus_Same_3.jpg']);
    for (const row of rows) assert.ok(zip.includes(Buffer.from(row.url)));
    assert.deepEqual(f.calls.reads, [rows[1].url, rows[0].url, rows[2].url]);
  } finally { await f.close(); }
});

test('the mixed download route uses one directory for originals and adjusted photos without transcoding video', async () => {
  const source = fs.readFileSync(require.resolve('../routes/photos'), 'utf8');
  const handlerSource = source.slice(source.indexOf('async function handleZipRequest('), source.indexOf('// POST /api/photos/:id/rendered'));
  const { ZipFile } = require(path.join(path.dirname(require.resolve('playwright-core')), 'lib/server/utils/zipFile'));
  for (const adjusted of [false, true]) {
    const rows = [
      { id: 1, type: 'normal', title: 'Same', projectId: 9, projectName: 'Campus', url: 'http://storage.test/uploads/1.jpg', adjustments: adjusted ? { brightness: 10 } : null },
      { id: 2, type: 'video', title: 'Same', projectId: 9, projectName: 'Campus', url: 'http://storage.test/uploads/2.mp4' },
    ];
    const calls = { renders: 0, reads: 0, auth: 0 };
    const pool = { query: async sql => [sql.includes('FROM projects') ? [{ id: 9, name: 'Campus' }] : rows] };
    const requirePhotosAccess = async () => { calls.auth++; };
    const storage = {
      isConfigured: () => true, keyFromUrlOrPath: url => new URL(url).pathname.slice(1), isSafeKey: () => true,
      headObject: async key => ({ ContentLength: Buffer.byteLength(key) }),
      getObject: async key => { calls.reads++; return { Body: Readable.from([Buffer.from(key)]), ContentLength: Buffer.byteLength(key) }; },
    };
    const videoDownloads = createVideoDownloads({ pool, storage, requirePhotosAccess, buildMediaUrl: url => url });
    const globals = { require, console, Buffer, URL, AbortController, fs, path, Transform: require('node:stream').Transform,
      pool, cosStorage: storage, videoDownloads, mediaFilename, requirePhotosAccess, sendWorkspaceError: () => false,
      MAX_ZIP_PHOTOS: 1000, ZIP_MAX_REMOTE_BYTES: 5 * 1024 ** 3, ZIP_MAX_RENDER_SOURCE_BYTES: 128 * 1024 ** 2,
      ZIP_REMOTE_TIMEOUT_MS: 20000, uploadRoot: os.tmpdir(),
      parsePhotoAdjustments: value => value, hasMeaningfulPhotoAdjustments: value => !!value?.brightness,
      renderAdjustedPhotoBuffer: async buffer => { calls.renders++; return Buffer.concat([Buffer.from('adjusted:'), buffer]); },
    };
    vm.runInNewContext(handlerSource + '\nthis.handle = handleZipRequest;', globals);
    const app = express(); app.use(express.json());
    app.use((req, _res, next) => { req.user = { id: 47, organization_id: 2 }; next(); });
    app.post('/zip', globals.handle);
    const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mamage-mixed-'));
    try {
      const response = await post(`http://127.0.0.1:${server.address().port}`, '/zip', { photoIds: [1, 2], zipName: 'Campus.zip' });
      assert.equal(response.status, 200);
      const file = path.join(dir, 'download.zip'); fs.writeFileSync(file, Buffer.from(await response.arrayBuffer()));
      const archive = new ZipFile(file);
      try {
        const entries = await archive.entries();
        assert.equal(entries.length, 2);
        assert.equal(new Set(entries.map(entry => entry.split('/')[0])).size, 1);
        assert.ok(entries.every(entry => entry.split('/').length === 2));
        const photo = entries.find(entry => entry.endsWith('_1.jpg'));
        const video = entries.find(entry => entry.endsWith('_2.mp4'));
        assert.ok(photo && video);
        assert.equal((await archive.read(photo)).toString(), (adjusted ? 'adjusted:' : '') + 'uploads/1.jpg');
        assert.equal((await archive.read(video)).toString(), 'uploads/2.mp4');
        assert.equal(calls.renders, adjusted ? 1 : 0); assert.equal(calls.reads, 2); assert.ok(calls.auth > 0);
      } finally { archive.close(); }
    } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); fs.rmSync(dir, { recursive: true }); }
  }
});

test('metadata timeout is abortable; partial estimates do not claim a complete total', async () => {
  let aborted = 0;
  const f = await fixture({ metadataTimeoutMs: 30, head: async (key, { signal }) => {
    if (key.endsWith('/1.mp4')) return { ContentLength: 2048 };
    return new Promise((_, reject) => signal.addEventListener('abort', () => { aborted++; reject(Error('aborted')); }, { once: true }));
  } });
  try {
    const data = await (await post(f.base, '/manifest', { photoIds: [1, 2, 3] })).json();
    assert.equal(data.totalBytes, 2048); assert.equal(data.unknownSizeCount, 2);
    assert.ok(aborted >= 2); assert.equal(f.calls.reads.length, 0);
  } finally { await f.close(); }
});

test('unknown sizes still stream a complete ZIP without an invented Content-Length', async () => {
  const f = await fixture({ head: async () => { throw Error('temporarily unavailable'); } });
  try {
    const response = await post(f.base, '/zip', { photoIds: [1, 2] });
    assert.equal(response.status, 200); assert.equal(response.headers.get('content-length'), null);
    const zip = Buffer.from(await response.arrayBuffer());
    assert.ok(zip.includes(Buffer.from('uploads/units/1/videos/1.mp4')));
    assert.ok(zip.includes(Buffer.from('uploads/units/1/videos/2.mp4')));
  } finally { await f.close(); }
});

test('a truncated or missing later object aborts the download instead of returning a successful incomplete ZIP', async () => {
  for (const missing of [false, true]) {
    const f = await fixture({ read: async key => {
      if (missing && key.endsWith('/2.mp4')) throw Object.assign(Error('private upstream'), { name: 'NoSuchKey' });
      return { Body: Readable.from(['x']), ContentLength: key.endsWith('/2.mp4') ? 2 : 1 };
    } });
    try { await assert.rejects(async () => { const r = await post(f.base, '/zip', { photoIds: [1, 2] }); await r.arrayBuffer(); }); }
    finally { await f.close(); }
  }
});

test('pre-header cancellation destroys late storage bodies and reclaims the ZIP slot', async () => {
  let release, entered;
  const waiting = new Promise(resolve => { entered = resolve; });
  const body = new PassThrough(); body.on('error', () => {});
  let signal;
  const f = await fixture({ read: async (_key, options) => { signal = options.signal; entered(); return new Promise(resolve => { release = resolve; }); } });
  try {
    const req = http.request(f.base + '/zip', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
    req.on('error', () => {}); req.end(JSON.stringify({ photoIds: [1] })); await waiting; req.destroy();
    await new Promise(resolve => setTimeout(resolve, 20)); release({ Body: body, ContentLength: 1 });
    await new Promise(resolve => setTimeout(resolve, 20)); assert.equal(body.destroyed, true); assert.equal(signal.aborted, true);
  } finally { await f.close(); }
});

test('stalled reads abort while active ZIP concurrency is bounded', async () => {
  const bodies = [];
  const f = await fixture({ maxConcurrent: 1, idleTimeoutMs: 80, read: async () => {
    const body = new PassThrough(); body.on('error', () => {}); bodies.push(body); setImmediate(() => body.write('x'));
    return { Body: body, ContentLength: 100 };
  } });
  try {
    const one = await post(f.base, '/zip', { photoIds: [1] });
    const two = await post(f.base, '/zip', { photoIds: [2] }); assert.equal(two.status, 429); await two.arrayBuffer();
    await assert.rejects(one.arrayBuffer()); assert.equal(bodies[0].destroyed, true);
  } finally { await f.close(); }
});

test('over-5GiB originals stream as ZIP64 with bounded process memory', { skip: process.env.VIDEO_DOWNLOAD_LARGE_TEST !== '1' }, async () => {
  const length = 6 * 1024 ** 3 + 123;
  let emitted = 0, peakRss = process.memoryUsage().rss;
  const chunk = Buffer.alloc(1024 * 1024);
  const f = await fixture({ read: async () => ({ ContentLength: length, Body: Readable.from((async function* () {
    while (emitted < length) { const size = Math.min(chunk.length, length - emitted); emitted += size; yield chunk.subarray(0, size); }
  })()) }) });
  const started = Date.now(); let firstByteMs, total = 0, tail = Buffer.alloc(0);
  const sampler = setInterval(() => { peakRss = Math.max(peakRss, process.memoryUsage().rss); }, 100);
  try {
    const response = await post(f.base, '/zip', { photoIds: [1] });
    for await (const value of response.body) {
      if (firstByteMs === undefined) { firstByteMs = Date.now() - started; assert.ok(emitted < length); }
      total += value.byteLength;
      tail = Buffer.concat([tail, Buffer.from(value)]).subarray(-2048);
    }
    assert.ok(total > length); assert.ok(tail.includes(Buffer.from('PK\x06\x06')));
    assert.ok(peakRss < 512 * 1024 ** 2, 'Process memory must not grow with the archive size');
    console.log(JSON.stringify({ largeVideoBytes: length, zipBytes: total, firstByteMs, durationMs: Date.now() - started, peakRssBytes: peakRss }));
  } finally { clearInterval(sampler); await f.close(); }
});
