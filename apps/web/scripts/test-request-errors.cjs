const assert = require('node:assert/strict');
const { test } = require('node:test');
const path = require('node:path');
const vm = require('node:vm');
const { transformFileSync } = require('@babel/core');

const code = transformFileSync(path.join(__dirname, '../src/services/request.js'), {
  configFile: false, babelrc: false,
  plugins: [require.resolve('@babel/plugin-transform-modules-commonjs')],
}).code;
const html = '<html><head><title>502 Bad Gateway</title></head><body>nginx/1.28.2</body></html>';
function fixture(handler) {
  const module = { exports: {} }, calls = [];
  vm.runInNewContext(code, {
    module, exports: module.exports, AbortController, FormData, URLSearchParams,
    setTimeout, clearTimeout,
    window: { location: { hostname: 'localhost', host: 'localhost' } },
    require(name) { assert.equal(name, './authService'); return { getToken: () => 'fixture-token' }; },
    fetch: async (url, options) => { calls.push({ url, options }); return handler(url, options, calls.length); },
  });
  return { request: module.exports.request, calls };
}
const response = (body, status = 200, contentType = 'application/json') =>
  new Response(body, { status, headers: { 'Content-Type': contentType } });

test('an upstream HTML error is never shown as the user-facing message', async () => {
  const f = fixture(() => response(html, 502, 'text/html'));
  await assert.rejects(f.request('/api/external-imports/jobs'), error => {
    assert.equal(error.status, 502);
    assert.equal(error.body, html, 'Keep diagnostic and machine-readable body compatibility');
    assert.doesNotMatch(error.message, /<|nginx|Bad Gateway/);
    assert.match(error.message, /服务/);
    return true;
  });
  assert.equal(f.calls.length, 1, 'Retry is opt-in');
});

test('plain-text infrastructure details and JSON-wrapped HTML are also hidden', async () => {
  for (const [body, type] of [['upstream internal-host:8080 refused', 'text/plain'],
    [JSON.stringify({ message: html }), 'application/json']]) {
    const f = fixture(() => response(body, 503, type));
    await assert.rejects(f.request('/api/example'), error => {
      assert.doesNotMatch(error.message, /internal-host|nginx|<|upstream/); return true;
    });
  }
});

test('business JSON errors retain their messages, status and body', async () => {
  const body = JSON.stringify({ error: 'FOLDER_DEPTH_LIMIT', maxDepth: 4 });
  const f = fixture(() => response(body, 409));
  await assert.rejects(f.request('/api/folder'), error => {
    assert.equal(error.message, 'FOLDER_DEPTH_LIMIT');
    assert.equal(error.status, 409); assert.equal(error.body, body); return true;
  });
});

test('opted-in reads recover once from a gateway error without changing auth or URL', async () => {
  const f = fixture((_url, _options, count) => count === 1
    ? response(html, 502, 'text/html') : response('{"jobs":[]}'));
  const data = await f.request('/api/external-imports/jobs', { data: { projectId: 76 }, retryGateway: true, timeoutMs: 2000 });
  assert.equal(data.jobs.length, 0); assert.equal(f.calls.length, 2);
  assert.ok(f.calls.every(call => call.url === '/api/external-imports/jobs?projectId=76'
    && call.options.headers.Authorization === 'Bearer fixture-token'));
});

test('gateway retry is bounded and never repeats writes, denied reads or stream consumers', async () => {
  for (const [options, status, expected] of [[{ retryGateway: true }, 504, 2],
    [{ retryGateway: true, method: 'POST', data: { action: 'resume' } }, 502, 1],
    [{ retryGateway: true, readResponse: () => assert.fail('No response body on error') }, 502, 1],
    [{ retryGateway: true }, 403, 1], [{ retryGateway: true }, 429, 1]]) {
    const f = fixture(() => response(html, status, 'text/html'));
    await assert.rejects(f.request('/api/example', options), error => error.status === status);
    assert.equal(f.calls.length, expected);
  }
});

test('cancellation or timeout during retry delay does not send a second request', async () => {
  for (const timeout of [false, true]) {
    const controller = new AbortController();
    const f = fixture(() => {
      if (!timeout) setTimeout(() => controller.abort(), 10);
      return response(html, 502, 'text/html');
    });
    await assert.rejects(f.request('/api/example', { retryGateway: true,
      ...(timeout ? { timeoutMs: 10 } : { signal: controller.signal }) }), error => error.status === 408);
    assert.equal(f.calls.length, 1);
  }
});

test('successful streaming response is consumed exactly once and never replayed', async () => {
  const f = fixture(() => response('partial', 200, 'application/x-ndjson'));
  let reads = 0;
  await assert.rejects(f.request('/api/search', { retryGateway: true, readResponse: async () => {
    reads++; throw Error('interrupted stream');
  } }), /interrupted stream/);
  assert.equal(reads, 1); assert.equal(f.calls.length, 1);
});
