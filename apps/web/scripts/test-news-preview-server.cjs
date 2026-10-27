const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createServer } = require('./serve-news-usability.cjs');
const http = require('node:http');
const body = { clientRequestId: 'preview-revision-001', instruction: '写清楚是什么学校', target: { uid: 'b-1', start: 0, end: 2 },
  source: { title: '交流', blocks: [{ uid: 'b-1', type: 'paragraph', text: '学校举办交流。' }] } };
async function withServer(options, run) {
  const server = createServer(options);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { await run(`http://127.0.0.1:${server.address().port}`); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
test('live local revision uses the real runner contract, isolates spaces and never silently returns mock text', async () => {
  let calls = 0, finish;
  await withServer({ liveRevision: true, runRevision: async input => {
    calls++; await new Promise(resolve => { finish = resolve; });
    return { extra: { plan: { title: input.source.title, blocks: [{ uid: 'b-1', text: '青禾中学举办交流。' }] } } };
  } }, async base => {
    const post = (value = body, headers = {}) => fetch(base + '/__news-qa/revision', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(value) });
    assert.deepEqual(await (await fetch(base + '/__news-qa/config')).json(), { liveRevision: true });
    assert.equal((await post(body, { Origin: 'https://external.invalid' })).status, 403);
    assert.equal((await post({ ...body, target: { uid: 'unknown' } })).status, 400);
    assert.equal((await post()).status, 202);
    assert.equal((await post()).status, 202);
    assert.equal(calls, 1, 'repeated submit must not create another model request');
    assert.equal((await post({ ...body, instruction: '不同的要求' })).status, 409);
    assert.equal((await fetch(base + '/__news-qa/revision/preview-revision-001?workspace=900004')).status, 404);
    finish();
    const response = await (await fetch(base + '/__news-qa/revision/preview-revision-001')).json();
    assert.equal(response.status, 'succeeded');
    assert.equal(response.result.plan.blocks[0].text, '青禾中学举办交流。');
    assert.equal((await post({ ...body, clientRequestId: 'preview-large-001', instruction: 'x'.repeat(300001) })).status, 413);
  });
  await withServer({ liveRevision: true, runRevision: async () => { throw Error('upstream secret response'); } }, async base => {
    await fetch(base + '/__news-qa/revision', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const response = await (await fetch(base + '/__news-qa/revision/preview-revision-001')).json();
    assert.equal(response.status, 'failed');
    assert.match(response.error, /原稿已保留/);
    assert.ok(!response.error.includes('secret'));
  });
});
test('disconnected preview refuses real AI requests instead of fabricating a successful edit', async () => {
  await withServer({}, async base => {
    assert.deepEqual(await (await fetch(base + '/__news-qa/config')).json(), { liveRevision: false });
    assert.equal((await fetch(base + '/__news-qa/revision', { method: 'POST' })).status, 503);
  });
});
test('full backend mode forwards actual authenticated requests and errors without returning fixture data', async () => {
  const received = [];
  const upstream = http.createServer(async (req, res) => {
    let data = ''; for await (const chunk of req) data += chunk;
    received.push({ url: req.url, authorization: req.headers.authorization, unit: req.headers['x-mamage-unit-id'], body: data });
    res.writeHead(req.headers.authorization ? 202 : 401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ upstream: true }));
  });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  try {
    const backendURL = `http://127.0.0.1:${upstream.address().port}`;
    await withServer({ backendURL, session: { token: 'sandbox-only', user: { id: 900003 }, workspaceId: 900003 } }, async base => {
      const config = await (await fetch(base + '/__news-qa/config')).json();
      assert.equal(config.liveBackend, true);
      assert.equal((await fetch(base + '/api/wechat-compositions')).status, 401);
      const response = await fetch(base + '/api/wechat-compositions/revision?test=1', { method: 'POST',
        headers: { Authorization: 'Bearer sandbox-only', 'X-Mamage-Unit-Id': '900003', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      assert.equal(response.status, 202); assert.deepEqual(await response.json(), { upstream: true });
      assert.deepEqual(received[1], { url: '/api/wechat-compositions/revision?test=1', authorization: 'Bearer sandbox-only', unit: '900003', body: JSON.stringify(body) });
    });
    assert.throws(() => createServer({ backendURL: 'http://10.1.131.37', session: { token: 'invalid' } }), /local sandbox/);
  } finally { upstream.closeAllConnections(); await new Promise(resolve => upstream.close(resolve)); }
});
