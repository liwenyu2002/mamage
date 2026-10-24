const assert = require('node:assert/strict');
const { test, before, after } = require('node:test');
const http = require('node:http');
const { PassThrough, Readable } = require('node:stream');
const express = require('express');
process.env.IMAGE_PROXY_HEADERS_TIMEOUT_MS = '1000';
process.env.IMAGE_PROXY_IDLE_TIMEOUT_MS = '1000';
process.env.MEDIA_URL_SIGNING = '0';
let read, head, allowed = true, responseClosed;
const mock = (name, exports) => { const id = require.resolve(name); require.cache[id] = { id, filename: id, loaded: true, exports }; };
mock('../lib/cos_storage', { keyFromUrlOrPath: value => value, isSafeKey: () => true, isConfigured: () => true,
  getObject: (...args) => read(...args), headObject: (...args) => head(...args) });
mock('../lib/media_access', { unitIdFromKey: () => 1, authorizeMediaKey: async () => allowed });
const app = express();
app.use((_req, res, next) => { res.once('close', () => responseClosed?.()); next(); });
app.use('/api/image', require('../routes/image_proxy'));
let server, base;
before(async () => { server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve)); base = `http://127.0.0.1:${server.address().port}/api/image/uploads/photo.jpg`; });
after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
const turn = () => new Promise(resolve => setImmediate(resolve));

test('normal image, Range and HEAD responses retain status, privacy headers and signals', async () => {
  let getOptions, headOptions;
  read = async (_key, options) => { getOptions = options; return { Body: Readable.from([Buffer.from('test')]), ContentLength: 4,
    ContentType: 'image/jpeg', ContentRange: 'bytes 0-3/10', $metadata: { httpStatusCode: 206 } }; };
  head = async (_key, options) => { headOptions = options; return { ContentLength: 10, ContentType: 'image/jpeg' }; };
  const response = await fetch(base, { headers: { Range: 'bytes=0-3' } });
  assert.equal(response.status, 206); assert.equal(await response.text(), 'test');
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal(response.headers.get('content-range'), 'bytes 0-3/10');
  assert.equal(getOptions.range, 'bytes=0-3'); assert.ok(getOptions.signal instanceof AbortSignal);
  const metadata = await fetch(base, { method: 'HEAD' });
  assert.equal(metadata.status, 200); assert.equal(metadata.headers.get('content-length'), '10');
  assert.ok(headOptions.signal instanceof AbortSignal);
});

test('disconnected GET and HEAD destroy even a late S3 response before it can retain a socket', async () => {
  for (const method of ['GET', 'HEAD']) {
    let release, entered, options;
    const active = new Promise(resolve => { entered = resolve; });
    const closed = new Promise(resolve => { responseClosed = resolve; });
    const source = new PassThrough(); source.on('error', () => {});
    const delayed = async (_key, input) => { options = input; entered(); return new Promise(resolve => { release = resolve; }); };
    read = delayed; head = delayed;
    const request = http.request(base, { method }); request.on('error', () => {}); request.end();
    await active; request.destroy(); await closed;
    release({ Body: source, ContentLength: 100000 }); await turn(); await turn();
    assert.equal(source.destroyed, true, `${method}: late storage response is leaked`);
    assert.equal(options.signal.aborted, true, `${method}: waiting request is not cancelled`);
    responseClosed = null;
  }
});

test('more than one SDK pool worth of cancellations never accumulates unread bodies', async () => {
  const sources = [];
  for (let i = 0; i < 55; i++) {
    let release, entered;
    const active = new Promise(resolve => { entered = resolve; });
    const closed = new Promise(resolve => { responseClosed = resolve; });
    read = async () => { entered(); return new Promise(resolve => { release = resolve; }); };
    const request = http.get(base); request.on('error', () => {});
    await active; request.destroy(); await closed;
    const source = new PassThrough(); source.on('error', () => {}); sources.push(source);
    release({ Body: source, ContentLength: 100000 }); await turn(); await turn();
  }
  responseClosed = null;
  assert.equal(sources.filter(source => !source.destroyed).length, 0);
});

test('leaving after headers cancels the storage body immediately', async () => {
  let options;
  const source = new PassThrough(); source.on('error', () => {});
  const ended = new Promise(resolve => source.once('close', resolve));
  read = async (_key, input) => { options = input; setImmediate(() => source.write('x')); return { Body: source, ContentLength: 100000 }; };
  const request = http.get(base, response => response.once('data', () => request.destroy())); request.on('error', () => {});
  await ended; assert.equal(options.signal.aborted, true); assert.equal(source.destroyed, true);
});

test('a blocked socket queue has a header deadline and is aborted, not left hanging', async () => {
  let options;
  read = (_key, input) => { options = input; return new Promise((_resolve, reject) => input.signal.addEventListener('abort', () => reject(input.signal.reason), { once: true })); };
  const response = await fetch(base); assert.equal(response.status, 504); await response.arrayBuffer();
  assert.equal(options.signal.aborted, true);
});

test('an upstream body that stops transmitting releases its connection on idle timeout', async () => {
  const source = new PassThrough(); source.on('error', () => {});
  read = async () => { setImmediate(() => source.write('x')); return { Body: source, ContentLength: 100000 }; };
  const response = await fetch(base); assert.equal(response.status, 200);
  await assert.rejects(response.arrayBuffer()); assert.equal(source.destroyed, true);
});

test('authorization and missing-object responses remain closed without opening extra storage reads', async () => {
  let calls = 0; allowed = false;
  read = async () => { calls++; throw Error('must not run'); };
  const denied = await fetch(base); assert.equal(denied.status, 403); assert.equal(calls, 0);
  allowed = true; read = async () => { throw Object.assign(Error('private upstream text'), { name: 'NoSuchKey' }); };
  const missing = await fetch(base); assert.equal(missing.status, 404); assert.equal(await missing.text(), '');
});
