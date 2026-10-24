const assert = require('node:assert/strict');
const { test } = require('node:test');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { requestRemoteTranscript } = require('../lib/video_transcription');

test('remote transcription streams private audio, bounds responses and cleans up on failures', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mamage-asr-test-'));
  const audio = path.join(dir, 'fixture.wav');
  const wav = Buffer.alloc(128, 1);
  wav.write('RIFF', 0); wav.write('WAVE', 8);
  await fs.writeFile(audio, wav);
  let mode = 'ok';
  const token = 'test-only-remote-transcription-token-12345';
  const server = http.createServer(async (req, res) => {
    assert.equal(req.url, '/transcribe');
    assert.equal(req.headers.authorization, `Bearer ${token}`);
    assert.equal(req.headers['content-type'], 'audio/wav');
    assert.equal(req.headers['x-mamage-language'], 'zh');
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    assert.deepEqual(Buffer.concat(chunks), wav);
    if (mode === 'error') { res.writeHead(503); res.end('sensitive provider internals'); }
    else if (mode === 'invalid') res.end('{"wrong":[]}');
    else if (mode === 'oversized') res.end(Buffer.alloc(16 * 1024 * 1024 + 1, ' '));
    else if (mode === 'hang') return;
    else { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ transcription: [{ text: 'fixture' }] })); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const config = { serviceURL: `http://127.0.0.1:${server.address().port}`, serviceToken: token, language: 'zh' };
  try {
    assert.equal((await requestRemoteTranscript(audio, config, 5000)).transcription[0].text, 'fixture');
    mode = 'error';
    await assert.rejects(requestRemoteTranscript(audio, config, 5000), { message: 'remote transcription HTTP 503' });
    mode = 'invalid';
    await assert.rejects(requestRemoteTranscript(audio, config, 5000), /invalid remote transcription response/);
    mode = 'oversized';
    await assert.rejects(requestRemoteTranscript(audio, config, 5000), /response too large/);
    mode = 'hang';
    await assert.rejects(requestRemoteTranscript(audio, config, 50), error => error.name === 'TimeoutError');
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await fs.rm(dir, { recursive: true, force: true });
  }
});
