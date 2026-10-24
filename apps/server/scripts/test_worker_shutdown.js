const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { createRequire } = require('node:module');

function loadWorker(name, dependencies, env = {}) {
  const module = { exports: {} };
  const filename = path.join(__dirname, '..', 'lib', name);
  const localRequire = createRequire(filename);
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module, exports: module.exports, __dirname: path.join(__dirname, '..', 'lib'),
    require: key => Object.hasOwn(dependencies, key) ? dependencies[key] : localRequire(key),
    process: { env }, console: { log() {}, warn() {}, error() {} },
    Buffer, setTimeout, clearTimeout, setInterval, clearInterval,
  }, { filename: name });
  return module.exports;
}

test('embedding shutdown rejects pending work and waits for the active Python process', async () => {
  const children = [];
  const removed = [];
  const worker = loadWorker('image_similarity.js', {
    '../db': { pool: {} },
    fs: { promises: { writeFile: async () => {}, unlink: async file => removed.push(file) } },
    child_process: { spawn() {
      const child = new EventEmitter();
      child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
      child.kill = () => {};
      children.push(child);
      return child;
    } },
  });
  const first = worker.encodeImageFromBuffer(Buffer.from('first'));
  const second = worker.encodeImageFromBuffer(Buffer.from('queued'));
  const rejected = assert.rejects(second, { code: 'SERVER_DRAINING' });
  while (!children.length) await new Promise(resolve => setImmediate(resolve));
  let stopped = false;
  const stop = worker.stop().then(() => { stopped = true; });
  await rejected;
  assert.equal(stopped, false);
  await assert.rejects(worker.encodeImageFromBuffer(Buffer.from('late')), { code: 'SERVER_DRAINING' });
  children[0].stdout.emit('data', Buffer.from('[0.1,0.2]'));
  children[0].emit('close', 0);
  assert.deepEqual(Array.from(await first), [0.1, 0.2]);
  await stop;
  assert.equal(children.length, 1);
  assert.equal(removed.length, 1);
});

test('memory face worker stops claiming queued photos and waits for its active job', async () => {
  let finish;
  const seen = [];
  const worker = loadWorker('face_auto_worker.js', {
    './face_auto_pipeline': { detectAndClusterPhoto: ({ photoId }) => {
      seen.push(photoId);
      return new Promise(resolve => { finish = resolve; });
    } },
  });
  worker.start();
  assert.equal(worker.enqueueFaceAutoJob({ photoId: 1 }), true);
  assert.equal(worker.enqueueFaceAutoJob({ photoId: 2 }), true);
  while (!finish) await new Promise(resolve => setImmediate(resolve));
  let stopped = false;
  const stop = worker.stop().then(() => { stopped = true; });
  assert.equal(worker.enqueueFaceAutoJob({ photoId: 3 }), false);
  assert.equal(stopped, false);
  finish({ ok: true });
  await stop;
  assert.deepEqual(seen, [1]);
});

test('Redis face consumer starts at boot without a new upload and closes owned connections', async () => {
  const events = [];
  class Connection {
    async quit() { events.push('connection.close'); }
  }
  class Queue {
    constructor() { events.push('queue.start'); }
    async close() { events.push('queue.close'); }
  }
  class Worker {
    constructor() { events.push('worker.start'); }
    on() {}
    async close() { events.push('worker.close'); }
  }
  const worker = loadWorker('face_auto_worker.js', {
    './face_auto_pipeline': { detectAndClusterPhoto: async () => {} },
    bullmq: { Queue, Worker }, ioredis: Connection,
  }, { REDIS_URL: 'redis://example.invalid:6379' });
  worker.start(); worker.start();
  assert.deepEqual(events, ['queue.start', 'worker.start']);
  await worker.stop();
  assert.deepEqual(events, ['queue.start', 'worker.start', 'worker.close', 'queue.close', 'connection.close']);
});

test('durable face retries preserve results and draining consumers still persist incoming intents', async () => {
  const handlers = new Map(), seen = [], persisted = [];
  const worker = loadWorker('face_auto_worker.js', {
    './distributed_runtime': { distributed: () => true, coordinator: {
      register: (kind, _lane, handler) => handlers.set(kind, handler),
      enqueue: async (kind, key) => { persisted.push([kind, key]); return true; },
    } },
    './face_auto_pipeline': { detectAndClusterPhoto: async options => { seen.push(options); } },
  });
  await handlers.get('face')({ photoId: 8 });
  await handlers.get('face')({ photoId: 9, force: true });
  assert.equal(seen[0].force, false);
  assert.equal(seen[1].force, true);
  await worker.stop();
  assert.equal(await worker.enqueueFaceAutoJob({ photoId: 10 }), true);
  assert.deepEqual(persisted, [['face', 10]]);
});

test('durable semantic retries skip completed photos and persist intents while draining', async () => {
  const handlers = new Map(), queries = [], persisted = [];
  const worker = loadWorker('ai_tags_worker.js', {
    './distributed_runtime': { distributed: () => true, coordinator: {
      register: (kind, _lane, handler) => handlers.set(kind, handler),
      enqueue: async (kind, key) => { persisted.push([kind, key]); return true; },
    } },
    '../ai_function/ai_for_tags/ai_for_tags': { analyze: async () => assert.fail('must not reanalyze'), analyzePhoto: async () => assert.fail('must not rescore') },
    '../db': { pool: { query: async sql => { queries.push(sql); return [[{ ai_status: 'done' }]]; } } },
    './video_analysis': {}, './video_render': {}, './video_semantic_source': {},
  });
  await handlers.get('semantic')({ id: 8 }, { attempt: 2 });
  assert.equal(queries.length, 1);
  assert.match(queries[0], /^SELECT ai_status/);
  await worker.stop();
  assert.equal(await worker.enqueue({ id: 10 }), true);
  assert.deepEqual(persisted, [['semantic', 10]]);
});

test('shared editor cleanup runs only on an idle coordinator, never a standby API', async () => {
  let leader = false, idle = true, reads = 0;
  const storage = loadWorker('video_editor_storage.js', {
    './shared_runtime_state': { distributed: () => true },
    './distributed_runtime': { coordinator: { isLeader: () => leader, isIdle: () => idle } },
    './cos_storage': {}, '../db': {},
    fs: { mkdirSync() {}, promises: { readdir: async () => { reads++; return []; } } },
  });
  await storage.sweepStaleWorkDirs();
  assert.equal(reads, 0);
  leader = true; idle = false;
  await storage.sweepStaleWorkDirs();
  assert.equal(reads, 0);
  idle = true;
  await storage.sweepStaleWorkDirs();
  assert.equal(reads, 1);
});
