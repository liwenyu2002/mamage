const assert = require('node:assert/strict');
const { test } = require('node:test');
const http = require('node:http');
const { EventEmitter } = require('node:events');
const { createRuntimeLifecycle, bounded } = require('../lib/runtime_lifecycle');
const logger = { info() {}, error() {} };
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve));

test('readiness checks dependencies; unstarted and draining processes are not ready', async () => {
  let healthy = true;
  const runtime = createRuntimeLifecycle({ checkReady: async () => { if (!healthy) throw Error('DB_DOWN'); }, exit() {}, logger });
  assert.equal(await runtime.ready(), false);
  runtime.markStarted({ listening: false });
  assert.equal(await runtime.ready(), true);
  healthy = false;
  assert.equal(await runtime.ready(), false);
  await runtime.shutdown();
  assert.equal(await runtime.ready(), false);
});

test('hung database checks are bounded and do not accumulate pool waiters', async () => {
  let calls = 0;
  const runtime = createRuntimeLifecycle({ checkReady: () => { calls++; return new Promise(() => {}); }, readyTimeoutMs: 10, exit() {}, logger });
  runtime.markStarted({ listening: false });
  assert.equal(await runtime.ready(), false);
  assert.equal(await runtime.ready(), false);
  assert.equal(calls, 1);
  await runtime.shutdown();
});

test('shutdown drains an active HTTP response and work before closing dependencies', async () => {
  const order = [];
  let entered;
  let finishResponse;
  const active = new Promise(resolve => { entered = resolve; });
  const server = http.createServer((req, res) => { finishResponse = () => res.end('complete'); entered(); });
  await listen(server);
  const runtime = createRuntimeLifecycle({ checkReady: async () => {}, stopWork: async () => { order.push('work'); },
    closeDependencies: async () => { order.push('db'); }, exit: code => { order.push(`exit:${code}`); }, logger });
  runtime.markStarted(server);
  const response = fetch(`http://127.0.0.1:${server.address().port}`);
  await active;
  const closing = runtime.shutdown('test');
  assert.equal(runtime.isDraining(), true);
  assert.equal(await runtime.ready(), false);
  assert.equal(order.includes('db'), false, 'dependencies stay open until the active response finishes');
  finishResponse();
  assert.equal(await (await response).text(), 'complete');
  await closing;
  assert.deepEqual(order, ['work', 'db', 'exit:0']);
});

test('deadline forces a nonzero exit even when a background job never finishes', async () => {
  let exited;
  const result = new Promise(resolve => { exited = resolve; });
  const runtime = createRuntimeLifecycle({ checkReady: async () => {}, stopWork: () => new Promise(() => {}),
    shutdownTimeoutMs: 15, exit: exited, logger });
  void runtime.shutdown();
  assert.equal(await result, 1);
});

test('signals are installed once and concurrent fatal shutdown upgrades exit status', async () => {
  const target = new EventEmitter();
  let release;
  const work = new Promise(resolve => { release = resolve; });
  let code;
  const runtime = createRuntimeLifecycle({ checkReady: async () => {}, stopWork: () => work, exit: value => { code = value; }, logger });
  const remove = runtime.installSignals(target);
  target.emit('SIGTERM');
  target.emit('uncaughtException', new Error('fatal'));
  release();
  await runtime.shutdown();
  assert.equal(code, 1);
  remove();
  assert.equal(target.listenerCount('SIGTERM'), 0);
  assert.equal(bounded('bad', 55, 1, 120), 55);
});
