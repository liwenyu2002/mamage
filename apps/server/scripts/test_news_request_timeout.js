const assert = require('node:assert/strict');
const http = require('node:http');
const { generateFromPrompt } = require('../ai_function/ai_for_news/ai_for_news');

async function main() {
  let requests = 0;
  let body = null;
  let mode = 'hang';
  const sockets = new Set();
  const activeResponses = new Set();
  const server = http.createServer(async (req, res) => {
    activeResponses.add(res);
    res.once('close', () => activeResponses.delete(res));
    requests += 1;
    let raw = '';
    for await (const chunk of req) raw += chunk;
    body = JSON.parse(raw);
    if (mode === 'hang') return;
    res.setHeader('Content-Type', 'application/json');
    if (mode === 'denied') {
      res.writeHead(401);
      res.end(JSON.stringify({ error: { message: 'invalid credential', type: 'authentication_error' } }));
      return;
    }
    const content = mode === 'format' && requests === 1
      ? 'invalid JSON'
      : JSON.stringify({ title: 'Test', subtitle: '', markdown: 'A complete news article.', photos: [] });
    res.end(JSON.stringify({ choices: [{ message: { content }, finish_reason: mode === 'truncated' ? 'length' : 'stop' }], usage: { total_tokens: 30 } }));
  });
  server.on('connection', socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  Object.assign(process.env, {
    AI_TEXT_API_KEY: 'local-test-only', AI_TEXT_BASE_URL: `http://127.0.0.1:${server.address().port}/v1`,
    AI_TEXT_MODEL: 'DeepSeek-V4-Pro-0813', AI_REQUEST_TIMEOUT_MS: '100', AI_JSON_MAX_ATTEMPTS: '3',
  });
  try {
    const started = Date.now();
    await assert.rejects(generateFromPrompt({ prompt: 'Test news', options: {} }), /超时|timeout|timed out/i);
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(requests, 1, 'A stalled provider must not be called three times');
    // Undici may open a replacement idle keep-alive socket; the hung response must be aborted.
    assert.equal(activeResponses.size, 0, 'Timeout must cancel the actual upstream response');
    assert(Date.now() - started < 800, 'A timeout must release the generation slot promptly');
    mode = 'denied'; requests = 0;
    await assert.rejects(generateFromPrompt({ prompt: 'Test news', options: {} }), /鉴权|认证|401/i);
    assert.equal(requests, 1, 'Authentication errors must not be retried');
    mode = 'format'; requests = 0;
    const result = await generateFromPrompt({ prompt: 'Test news', options: {} });
    assert.equal(requests, 2, 'Malformed JSON can still be regenerated');
    assert.equal(result.title, 'Test');
    assert.equal(body.thinking?.type, 'disabled', 'DeepSeek news writing should not spend time on hidden thinking');
    mode = 'truncated'; requests = 0;
    await assert.rejects(generateFromPrompt({ prompt: 'Test news', options: {} }), /截断/);
    assert.equal(requests, 1, 'Truncated output must fail explicitly, not regenerate the same oversized article');
    console.log('News request timeout, cancellation, authentication and JSON retry: PASS');
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
