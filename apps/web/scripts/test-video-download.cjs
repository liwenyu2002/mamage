const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const modulePromise = import('data:text/javascript;base64,' + fs.readFileSync(path.join(__dirname, '../src/services/videoDownloadQueue.js')).toString('base64'));

async function fixture(options = {}) {
  const { createVideoDownloadQueue } = await modulePromise;
  const writes = new Map(), calls = { zip: 0, sources: [], removed: [], picker: 0, active: 0, max: 0, summaries: [], zipOptions: [] };
  const directory = {
    async getFileHandle(name) {
      return { async createWritable() {
        calls.active++; calls.max = Math.max(calls.max, calls.active); const chunks = [];
        return { async write(value) { if (options.write) await options.write(value); chunks.push(Buffer.from(value)); },
          async close() { writes.set(name, Buffer.concat(chunks)); calls.active--; }, async abort() { calls.active--; } };
      } };
    }, async removeEntry(name) { calls.removed.push(name); writes.delete(name); },
  };
  const queue = createVideoDownloadQueue({
    supportsDirectory: () => options.supported !== false,
    pickDirectory: async () => { calls.picker++; if (options.pickerError) throw options.pickerError; return { getDirectoryHandle: async () => directory }; },
    manifest: async (ids, _signal, kind) => { calls.summaries.push(kind); return { items: ids.map(id => ({ id, name: `video-${id}.mp4`, size: 4 })),
      totalBytes: ids.length * 4, unknownSizeCount: 0, mediaCounts: kind === 'mixed' ? { photos: 1, videos: ids.length - 1 } : { photos: 0, videos: ids.length }, zipName: 'Campus_2026-10-18.zip' }; },
    source: async id => { calls.sources.push(id); return options.source ? options.source(id, calls.sources.length) : { url: `https://storage/${id}`, fallbackUrl: `/proxy/${id}` }; },
    nativeZip: async (_ids, _signal, input) => { calls.zip++; calls.zipOptions.push(input); }, idleMs: options.idleMs || 1000,
    fetchFile: options.fetchFile || (async () => new Response(new ReadableStream({
      start(c) { c.enqueue(new Uint8Array([1, 2])); this.timer = setTimeout(() => { c.enqueue(new Uint8Array([3, 4])); c.close(); }, 10); },
      cancel() { clearTimeout(this.timer); },
    }), { headers: { 'Content-Length': '4' } })),
  });
  return { queue, calls, writes };
}

test('HTTP or unsupported browsers use one native ZIP, never a directory picker or per-file download burst', async () => {
  const { canSaveVideoDirectory } = await modulePromise;
  assert.equal(canSaveVideoDirectory({ isSecureContext: false, showDirectoryPicker() {} }), false);
  assert.equal(canSaveVideoDirectory({ isSecureContext: true, showDirectoryPicker() {} }), true);
  const f = await fixture({ supported: false }); await f.queue.start(Array.from({ length: 57 }, (_, i) => i + 1));
  assert.equal(f.calls.picker, 0); assert.equal(f.calls.zip, 1); assert.equal(f.calls.sources.length, 0);
  assert.equal(f.queue.getSnapshot().status, 'handed-off');
  assert.equal(f.queue.getSnapshot().totalBytes, 57 * 4);
  assert.equal(f.calls.zipOptions[0].zipName, 'Campus_2026-10-18.zip');
});

test('mixed transfer selections always use one streaming ZIP with an honest size summary', async () => {
  const f = await fixture(); await f.queue.start([1, 2, 3], { mediaKind: 'mixed' });
  assert.equal(f.calls.picker, 0); assert.equal(f.calls.zip, 1);
  assert.deepEqual(f.calls.summaries, ['mixed']); assert.equal(f.calls.zipOptions[0].videoOnly, false);
  assert.deepEqual(f.queue.getSnapshot().mediaCounts, { photos: 1, videos: 2 });
});

test('folder queue streams bytes, limits concurrency to two and records only committed files as saved', async () => {
  const f = await fixture(); await f.queue.start([1, 2, 3, 4, 5]);
  assert.equal(f.calls.max, 2); assert.equal(f.calls.active, 0); assert.equal(f.writes.size, 5);
  assert.deepEqual(f.calls.summaries, ['video']);
  for (const value of f.writes.values()) assert.deepEqual([...value], [1, 2, 3, 4]);
  assert.equal(f.queue.getSnapshot().status, 'done'); assert.ok(f.queue.getSnapshot().items.every(i => i.status === 'saved'));
});

test('picker cancellation does not silently start a ZIP download', async () => {
  const f = await fixture({ pickerError: Object.assign(Error('cancelled'), { name: 'AbortError' }) });
  await f.queue.start([1, 2]); assert.equal(f.calls.zip, 0); assert.equal(f.queue.getSnapshot().status, 'cancelled');
});

test('CORS or direct storage errors fall back to the scoped proxy', async () => {
  const urls = [];
  const f = await fixture({ fetchFile: async url => { urls.push(url); if (url.startsWith('https:')) throw TypeError('CORS'); return new Response('video'); } });
  await f.queue.start([1]); assert.deepEqual(urls, ['https://storage/1', '/proxy/1']); assert.equal(f.writes.size, 1);
});

test('short bodies are never reported saved; failed retries clean only this task files', async () => {
  const f = await fixture({ fetchFile: async () => new Response('x', { headers: { 'Content-Length': '10' } }) });
  await f.queue.start([1]); assert.equal(f.writes.size, 0); assert.equal(f.calls.removed.length, 2);
  assert.equal(f.queue.getSnapshot().status, 'partial'); assert.equal(f.queue.getSnapshot().items[0].loaded, 0);
});

test('retry only failed items and resolve fresh signed URLs for every attempt', async () => {
  let failing = true;
  const f = await fixture({ fetchFile: async url => { if (failing && url.endsWith('/2')) throw Error('network'); return new Response('ok'); } });
  await f.queue.start([1, 2]); assert.equal(f.writes.size, 1); const savedAttempts = f.calls.sources.filter(id => id === 1).length;
  failing = false; await f.queue.retry(); assert.equal(f.writes.size, 2); assert.equal(f.queue.getSnapshot().status, 'done');
  assert.equal(f.calls.sources.filter(id => id === 1).length, savedAttempts); assert.equal(f.calls.sources.filter(id => id === 2).length, 3);
});

test('cancel aborts pending reads, removes incomplete output and does not start remaining items', async () => {
  let firstRead;
  const entered = new Promise(resolve => { firstRead = resolve; });
  const f = await fixture({ fetchFile: async (_url, { signal }) => new Response(new ReadableStream({
    start(c) { c.enqueue(new Uint8Array([1])); firstRead(); signal.addEventListener('abort', () => c.error(new Error('abort')), { once: true }); },
  })) });
  const running = f.queue.start([1, 2, 3, 4]); await entered; await new Promise(resolve => setTimeout(resolve, 5)); f.queue.cancel(); await running;
  assert.equal(f.queue.getSnapshot().status, 'cancelled'); assert.equal(f.writes.size, 0); assert.ok(f.calls.sources.length <= 2);
  assert.ok(f.queue.getSnapshot().items.every(item => item.status === 'cancelled'));
});

test('disk quota failures are not retried and preserve a truthful failure state', async () => {
  const f = await fixture({ write: async () => { throw Object.assign(Error('disk full'), { name: 'QuotaExceededError' }); } });
  await f.queue.start([1]); assert.equal(f.calls.sources.length, 1); assert.equal(f.writes.size, 0);
  assert.equal(f.queue.getSnapshot().items[0].error, '磁盘空间不足');
});

test('duplicate starts are blocked; a stalled reader fails without unbounded waiting', async () => {
  const f = await fixture({ idleMs: 25, fetchFile: async () => new Response(new ReadableStream({ start() {} })) });
  const one = f.queue.start([1, 2]); await assert.rejects(f.queue.start([3]), /ALREADY_RUNNING/); await one;
  assert.equal(f.queue.getSnapshot().status, 'partial'); assert.equal(f.writes.size, 0);
});

test('an interrupted directory download retries a fresh storage signature before using the proxy', async () => {
  const urls = [];
  const f = await fixture({ source: async (id, attempt) => ({ url: `https://storage/${id}?attempt=${attempt}`, fallbackUrl: `/proxy/${id}` }),
    fetchFile: async url => { urls.push(url); return new Response(url.endsWith('=1') ? 'x' : 'done', { headers: { 'Content-Length': '4' } }); } });
  await f.queue.start([1]); assert.equal(f.queue.getSnapshot().status, 'done');
  assert.deepEqual(urls, ['https://storage/1?attempt=1', 'https://storage/1?attempt=2']);
  assert.equal(f.writes.get('video-1.mp4').toString(), 'done');
});
