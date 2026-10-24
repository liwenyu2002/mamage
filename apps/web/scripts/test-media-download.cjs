const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { test } = require('node:test');
const modulePromise = import('data:text/javascript;base64,' + fs.readFileSync(path.resolve(__dirname, '../src/services/mediaDownload.js')).toString('base64'));
async function fixture(options = {}) {
  const { createMediaDownloader } = await modulePromise;
  const calls = { clicks: [], requests: [], direct: [], fresh: 0, cancels: 0 };
  const download = createMediaDownloader({
    getOrigin: () => 'http://website.test', probeTimeoutMs: options.timeoutMs || 50,
    getDirectUrl: async (id, input) => { calls.direct.push(input); return options.getDirectUrl ? options.getDirectUrl(id, input) : 'http://storage.test/private?signature=fake'; },
    getFallbackUrl: options.getFallbackUrl || (async () => { calls.fresh++; return 'http://configured-host/api/image/uploads/video.mp4?ma=fresh'; }),
    getDocument: () => ({ body: { appendChild() {} }, createElement() { return { click() { calls.clicks.push({ url: this.href, filename: this.download, target: this.target }); }, remove() {} }; } }),
    fetchFile: async (url, input) => {
      calls.requests.push({ url, input });
      if (options.fetchFile) return options.fetchFile(url, input);
      return { ok: true, status: 206, headers: new Headers({ 'Content-Disposition': 'attachment; filename="video.mp4"', 'Content-Type': 'video/mp4' }),
        body: { cancel: async () => { calls.cancels++; } }, arrayBuffer() { throw Error('Must not buffer the video'); } };
    },
  });
  return { calls, run: () => download({ photoId: 1, url: '/api/image/old?ma=expired', filename: 'video.mp4' }) };
}
test('valid direct attachments retain direct storage without opening a tab or buffering the source', async () => {
  const f = await fixture(); assert.equal((await f.run()).direct, true); assert.equal(f.calls.fresh, 0);
  assert.equal(f.calls.requests[0].input.headers.Range, 'bytes=0-0'); assert.equal(f.calls.requests[0].input.credentials, 'omit');
  assert.deepEqual(Object.keys(f.calls.requests[0].input.headers), ['Range']); assert.equal(f.calls.cancels, 1);
  assert.equal(f.calls.requests[0].input.signal.aborted, true); assert.equal(f.calls.clicks[0].target, '_self');
});
test('403, XML errors and inline media fall back to a fresh same-origin signature, never an error page', async () => {
  for (const response of [
    new Response('<Error>AccessDenied</Error>', { status: 403, headers: { 'Content-Type': 'application/xml' } }),
    new Response('<Error>AccessDenied</Error>', { headers: { 'Content-Type': 'application/xml', 'Content-Disposition': 'attachment' } }),
    new Response('video', { headers: { 'Content-Type': 'video/mp4' } }),
  ]) {
    const f = await fixture({ fetchFile: async () => response }); assert.equal((await f.run()).direct, false);
    assert.equal(f.calls.fresh, 1); assert.deepEqual(f.calls.clicks, [{ url: '/api/image/uploads/video.mp4?ma=fresh', filename: 'video.mp4', target: '_self' }]);
  }
});
test('CORS and signed URL API failures use the same fallback without exposing credentials', async () => {
  for (const options of [{ fetchFile: async () => { throw TypeError('CORS'); } }, { getDirectUrl: async () => { throw Error('direct API unavailable'); } }]) {
    const f = await fixture(options); assert.equal((await f.run()).direct, false); assert.equal(f.calls.fresh, 1); assert.equal(f.calls.clicks.length, 1);
  }
});
test('stalled direct probes are aborted and fall back, rather than opening another page', async () => {
  const f = await fixture({ timeoutMs: 10, fetchFile: async (_url, input) => new Promise((_, reject) => input.signal.addEventListener('abort', () => reject(Error('aborted')), { once: true })) });
  assert.equal((await f.run()).direct, false); assert.equal(f.calls.fresh, 1); assert.equal(f.calls.clicks.length, 1);
});
test('denied metadata refresh does not reuse expired links or claim that a file was handed off', async () => {
  const f = await fixture({ getDirectUrl: async () => null, getFallbackUrl: async () => { throw Error('forbidden'); } });
  await assert.rejects(f.run(), /forbidden/); assert.equal(f.calls.clicks.length, 0);
});
test('untrusted fallback schemes and remote non-proxy pages cannot navigate the application', async () => {
  for (const url of ['javascript:alert(1)', 'https://storage.test/error.xml', '//storage.test/error']) {
    const f = await fixture({ getDirectUrl: async () => null, getFallbackUrl: async () => url });
    await assert.rejects(f.run(), /安全下载链接/); assert.equal(f.calls.clicks.length, 0);
  }
});
test('an expired signature is refreshed once and remains a direct download when the new signature works', async () => {
  const f = await fixture({
    getDirectUrl: async (_id, input) => input?.forceRefresh ? 'http://storage.test/fresh' : 'http://storage.test/expired',
    fetchFile: async url => url.endsWith('/expired') ? new Response('denied', { status: 403 })
      : new Response('video', { status: 206, headers: { 'Content-Disposition': 'attachment', 'Content-Type': 'video/mp4' } }),
  });
  assert.equal((await f.run()).direct, true); assert.equal(f.calls.fresh, 0);
  assert.equal(f.calls.direct.length, 2); assert.equal(f.calls.direct[1].forceRefresh, true);
  assert.ok(f.calls.clicks[0].url.endsWith('/fresh')); assert.equal(f.calls.clicks[0].target, '_self');
});
test('a Range-only CORS failure can use a simple GET attachment probe without buffering the video', async () => {
  const f = await fixture({ fetchFile: async (_url, input) => {
    if (input.headers?.Range) throw TypeError('Range preflight unavailable');
    return new Response('video', { headers: { 'Content-Disposition': 'attachment', 'Content-Type': 'video/mp4' } });
  } });
  assert.equal((await f.run()).direct, true); assert.equal(f.calls.fresh, 0);
  assert.equal(f.calls.requests.length, 3); assert.ok(!f.calls.requests.at(-1).input.headers?.Range);
  assert.ok(f.calls.requests.every(r => r.input.credentials === 'omit'));
});
