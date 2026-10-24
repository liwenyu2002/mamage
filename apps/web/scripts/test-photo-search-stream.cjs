const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const babel = require('@babel/core');
const filename = path.join(__dirname, '../src/services/photoSearchStream.js');
const instance = new Module(filename, module);
instance.filename = filename;
instance._compile(babel.transformSync(fs.readFileSync(filename, 'utf8'), { filename,
  presets: [['@babel/preset-env', { targets: { node: 'current' } }]],
}).code, filename);
const { readPhotoSearchStream } = instance.exports;
const encode = value => new TextEncoder().encode(JSON.stringify(value) + '\n');
const batch = (list, search = {}) => ({ type: 'results', data: { list, total: null, search } });
const complete = total => ({ type: 'complete', data: { total, page: 1, hasMore: false, search: {} } });
const wrap = body => new Response(body, { headers: { 'Content-Type': 'application/x-ndjson' } });

test('first photos arrive before completion and UTF-8 boundaries are decoded correctly', async () => {
  let channel;
  const response = wrap(new ReadableStream({ start(controller) { channel = controller; } }));
  const seen = [];
  let finished = false;
  const resultPromise = readPhotoSearchStream(response, { onProgress: event => seen.push(event),
    rewrite: event => event.type === 'results' ? { ...event, data: { ...event.data, marker: 'rewritten' } } : event,
  }).then(value => { finished = true; return value; });
  const bytes = encode(batch([{ id: 1, title: '中文照片' }]));
  for (let index = 0; index < bytes.length; index += 1) channel.enqueue(bytes.slice(index, index + 1));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(finished, false);
  assert.equal(seen[0].data.list[0].title, '中文照片');
  assert.equal(seen[0].data.total, null);
  assert.equal(seen[0].data.marker, 'rewritten');
  channel.enqueue(encode(batch([{ id: 2 }, { id: 1, title: '更新描述' }])));
  channel.enqueue(encode(complete(2)));
  // A protocol completion frame is sufficient; a proxy need not close the socket first.
  const result = await resultPromise;
  assert.deepEqual(result.list.map(photo => photo.id), [1, 2]);
  assert.equal(result.total, 2);
});

test('interrupted streams retain already displayed photos without claiming completion', async () => {
  const response = wrap(new ReadableStream({ start(controller) {
    controller.enqueue(encode(batch([{ id: 1 }]))); controller.close();
  } }));
  await assert.rejects(readPhotoSearchStream(response), error => {
    assert.deepEqual(error.partialResult.list, [{ id: 1 }]); return true;
  });
});

test('cancellation stops callbacks and closes a blocked reader', async () => {
  let cancelled = false;
  const controller = new AbortController();
  const response = wrap(new ReadableStream({ cancel() { cancelled = true; } }));
  const events = [];
  const result = readPhotoSearchStream(response, { signal: controller.signal, onProgress: event => events.push(event) });
  controller.abort();
  await assert.rejects(result, { name: 'AbortError' });
  assert.equal(cancelled, true);
  assert.equal(events.length, 0);
});

test('legacy JSON responses remain compatible with streamed callers', async () => {
  const expected = { list: [{ id: 1 }], total: 1 };
  const response = new Response(JSON.stringify(expected), { headers: { 'Content-Type': 'application/json' } });
  const seen = [];
  assert.deepEqual(await readPhotoSearchStream(response, { onProgress: event => seen.push(event) }), expected);
  assert.equal(seen.length, 1);
});

test('older abort signals without throwIfAborted still cancel safely', async () => {
  const signal = { aborted: true, addEventListener() {}, removeEventListener() {} };
  await assert.rejects(readPhotoSearchStream(wrap(new ReadableStream()), { signal }), { name: 'AbortError' });
});

test('malformed frames, server failures, oversized frames and excess result counts fail safely', async () => {
  for (const text of ['{"secret-token":"private",broken}\n', JSON.stringify({ type: 'error', message: 'private SQL' }) + '\n',
    ' '.repeat(1024 * 1024 + 1), JSON.stringify(batch(Array.from({ length: 201 }, (_, id) => ({ id })))) + '\n']) {
    await assert.rejects(readPhotoSearchStream(wrap(text)), error => !error.message.includes('private'));
  }
});
