const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const express = require('express');
const sharp = require('sharp');
const photoTone = require('../lib/photo_tone/engine.mjs');
const renderer = require('../lib/photo_tone/render.cjs');
const source = fs.readFileSync(require.resolve('../routes/photos'), 'utf8');

async function fixture({ denied = false, saved = false } = {}) {
  const row = { id: 11, url: '/original.jpg', thumbUrl: '/thumb.jpg', adjustments: { version: 2, brightness: 80 } };
  const original = await sharp({ create: { width: 640, height: 400, channels: 3, background: '#718998' } }).png().toBuffer();
  const edited = await sharp(original).resize(120, 80).jpeg().toBuffer();
  if (saved) {
    const revision = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    row.adjustments = { version: 3, exposure: .5, baked: { photoId: 11, revision,
      url: `uploads/photo-edits/11/${revision}/image.jpg`, thumbUrl: `uploads/photo-edits/11/${revision}/thumb.webp`, width: 120, height: 80 } };
  }
  const calls = { reads: 0, access: [], urls: [] };
  const router = express.Router();
  const context = {
    router, photoTone, ...renderer, ...require('../lib/photo_tone/artifacts.cjs'), Buffer, URL, console,
    pool: { query: async (_sql, params) => [params[0] === 11 && params[1] === 8 ? [row] : []] },
    requirePermission: () => (_req, _res, next) => next(),
    populateReqUserFromAuthIfPresent: async () => {},
    requirePhotoAccess: async (_req, id, action) => {
      calls.access.push({ id, action });
      if (denied) throw Object.assign(new Error('denied'), { status: 403 });
    },
    sendWorkspaceError: (res, err) => { res.status(err.status || 500).json({ error: err.message }); return true; },
    buildMediaUrl: url => url,
    clampNumber: photoTone.clamp,
    RENDER_SOURCE_TIMEOUT_MS: 20000, RENDER_MAX_SOURCE_BYTES: 128 * 1024 ** 2,
    fetchImageBufferFromUrl: async url => { calls.reads++; calls.urls.push(url); return { buffer: url.includes('photo-edits/') ? edited : original }; },
  };
  const param = source.slice(source.indexOf("router.param('id'"), source.indexOf('const AI_SEARCH_RATE_WINDOW_MS'));
  const helpers = source.slice(source.indexOf('function normalizePhotoAdjustments('), source.indexOf('async function fetchImageBufferFromUrl('));
  const format = source.slice(source.indexOf('function normalizeRenderFormat('), source.indexOf('function parseProjectPhotoIds('));
  const routes = source.slice(source.indexOf('// POST /api/photos/:id/rendered'), source.indexOf('// 内网对象存储直连'));
  vm.runInNewContext(param + helpers + format + routes, context);
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { req.user = { id: 7, organization_id: 8 }; next(); });
  app.use('/photos', router);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  return { calls, edited, base: `http://127.0.0.1:${server.address().port}`,
    close: async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } };
}

test('working pixels and rendered exports carry the same engine and an sRGB profile', async () => {
  const f = await fixture();
  try {
    const working = await fetch(f.base + '/photos/11/pixel-source?variant=working&maxSize=320');
    assert.equal(working.status, 200);
    assert.equal(working.headers.get('x-mamage-tone-engine'), photoTone.ENGINE);
    assert.equal(working.headers.get('x-mamage-source-width'), '640');
    assert.equal(working.headers.get('cache-control'), 'private, no-store');
    assert.equal(working.headers.get('vary'), 'Authorization');
    const pixels = await sharp(Buffer.from(await working.arrayBuffer())).metadata();
    assert.equal(pixels.width, 320); assert.ok(pixels.icc);
    const rendered = await fetch(f.base + '/photos/11/rendered', { method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adjustments: { version: 3, exposure: 0.5 }, format: 'png', maxSize: 320 }) });
    assert.equal(rendered.status, 200);
    assert.equal(rendered.headers.get('x-mamage-tone-engine'), photoTone.ENGINE);
    const image = await sharp(Buffer.from(await rendered.arrayBuffer())).metadata();
    assert.equal(image.width, 320); assert.ok(image.icc);
    assert.deepEqual(f.calls.access, [{ id: 11, action: 'read' }, { id: 11, action: 'read' }]);
  } finally { await f.close(); }
});

test('tone routes refuse denied or malformed requests before reading source images', async () => {
  for (const denied of [false, true]) {
    const f = await fixture({ denied });
    try {
      const url = f.base + (denied ? '/photos/11/pixel-source?variant=working' : '/photos/11/rendered');
      const response = await fetch(url, denied ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adjustments: { version: 999 } }) });
      assert.equal(response.status, denied ? 403 : 400);
      assert.equal(f.calls.reads, 0);
    } finally { await f.close(); }
  }
});

test('saved download returns stored bytes while full-resolution editing still reads the untouched original', async () => {
  const f = await fixture({ saved: true });
  try {
    const saved = await fetch(f.base + '/photos/11/rendered', { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ format: 'jpeg' }) });
    assert.equal(saved.status, 200); assert.equal(saved.headers.get('x-mamage-render-variant'), 'saved');
    assert.equal(saved.headers.get('vary'), 'Authorization');
    assert.deepEqual(Buffer.from(await saved.arrayBuffer()), f.edited);
    const working = await fetch(f.base + '/photos/11/pixel-source?variant=working&full=1&maxSize=320');
    const meta = await sharp(Buffer.from(await working.arrayBuffer())).metadata();
    assert.equal(meta.width, 640); assert.equal(meta.height, 400);
    assert.ok(f.calls.urls[0].includes('photo-edits/'));
    assert.ok(f.calls.urls[1].includes('/original.jpg'));
    assert.ok(f.calls.urls[1].includes('original=1'));
    assert.equal(f.calls.access.length, 2);
  } finally { await f.close(); }
});
