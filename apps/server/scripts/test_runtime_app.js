const assert = require('node:assert/strict');
const { test } = require('node:test');
const { fork } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');
const message = (child, type) => new Promise(resolve => {
  const handler = value => { if (value.type === type) { child.off('message', handler); resolve(value); } };
  child.on('message', handler);
});

test('real entrypoint serves dependency-aware probes, guards local media, and drains on SIGTERM', { timeout: 12000 }, async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mamage-app-test-'));
  await fs.mkdir(path.join(dir, 'uploads', 'units', '7'), { recursive: true });
  await fs.writeFile(path.join(dir, 'uploads/units/7/private.jpg'), 'private');
  const child = fork(path.join(__dirname, 'fixtures/runtime_app.cjs'), [], { cwd: dir, silent: true,
    env: { ...process.env, MAMAGE_RUNTIME_TEST: '1', MAMAGE_CONTAINER: '0', NODE_ENV: 'test', PORT: '0',
      AI_REQUEUE_ON_BOOT: '0', AI_VALIDATE_ON_STARTUP: '0', REQUEST_LOGS: '0', SHUTDOWN_TIMEOUT_MS: '4000',
      UPLOAD_ABS_DIR: path.join(dir, 'uploads'), CORS_ORIGIN: 'http://fixture.test' } });
  let errors = '';
  child.stdout.resume(); child.stderr.on('data', part => { errors += part; });
  const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
  try {
    const { port } = await message(child, 'listening');
    const base = `http://127.0.0.1:${port}`;
    const ready = await fetch(base + '/api/health/ready', { headers: { Origin: 'http://fixture.test' } });
    assert.equal(ready.status, 200);
    assert.equal(ready.headers.get('access-control-allow-origin'), 'http://fixture.test');
    assert.equal((await fetch(base + '/uploads/units/7/private.jpg')).status, 403);
    assert.equal(await (await fetch(base + '/uploads/units/7/private.jpg?ma=fixture-valid')).text(), 'private');
    const dbChanged = message(child, 'database-updated');
    child.send({ type: 'database', ready: false }); await dbChanged;
    assert.equal((await fetch(base + '/api/health/ready')).status, 503);
    assert.equal((await fetch(base + '/api/health/live')).status, 200);
    const active = message(child, 'active-request');
    const response = fetch(base + '/api/projects/slow'); await active;
    child.kill('SIGTERM');
    assert.deepEqual(await (await response).json(), { complete: true });
    assert.deepEqual(await exited, { code: 0, signal: null }, errors);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await exited;
    await fs.rm(dir, { recursive: true, force: true });
  }
});
