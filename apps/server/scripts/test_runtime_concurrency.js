const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

function fixture(options = {}) {
  const tasks = []; const failures = []; let released = false;
  const db = { async query(sql, params = []) {
    if (sql.includes('SELECT * FROM runtime_tasks')) {
      const lane = params[0];
      return [tasks.filter(job => job.status === 'queued' && job.lane === lane && job.available_at <= params[1])
        .sort((a, b) => a.priority - b.priority || a.id - b.id).slice(0, Number(params[2] || 1)).map(job => ({ ...job }))];
    }
    if (sql.includes("status = 'running', owner = ?")) {
      const job = tasks.find(item => item.id === params[1] && item.status === 'queued');
      if (!job) return [{ affectedRows: 0 }];
      job.status = 'running'; job.owner = params[0]; job.attempts++; return [{ affectedRows: 1 }];
    }
    if (sql.includes("status = 'done'")) {
      const job = tasks.find(item => item.id === params[0]); job.status = 'done'; return [{ affectedRows: 1 }];
    }
    if (sql.startsWith('UPDATE runtime_tasks SET status = ?')) {
      const job = tasks.find(item => item.id === params[3] && item.owner === params[4] && item.status === 'running');
      if (!job) return [{ affectedRows: 0 }];
      job.status = params[0]; job.available_at = params[1]; job.last_error = params[2]; return [{ affectedRows: 1 }];
    }
    if (sql.includes('INSERT INTO runtime_task_failures')) { failures.push(params); return [{ affectedRows: 1 }]; }
    return [[]];
  } };
  db.getConnection = async () => ({ query: db.query, beginTransaction: async () => {}, commit: async () => {},
    rollback: async () => {}, release() {} });
  const exported = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../lib/distributed_runtime.js'), 'utf8'), {
    module: exported, console, process, Buffer, setInterval, clearInterval, setImmediate, clearImmediate, setTimeout, clearTimeout,
    require(name) {
      if (name === './shared_runtime_state') return { distributed: () => true };
      if (name === './job_lock') return { acquireJobLock: async () => ({ connection: { on() {} }, assertOwned: async () => {}, release: async () => { released = true; } }) };
      if (name === './runtime_lifecycle') return { bounded: require('../lib/runtime_lifecycle').bounded,
        waitForIdle: async check => { while (!check()) await delay(1); } };
      if (name === './background_capacity') return require('../lib/background_capacity');
      return require(require.resolve(name, { paths: [path.resolve(__dirname, '../lib')] }));
    },
  });
  const runtime = exported.exports.createCoordinator({ db, ...options });
  return { db, runtime, tasks, failures, released: () => released,
    add(kind, lane, priority = 0) { const job = { id: tasks.length + 1, kind, lane, priority, payload: '{}', attempts: 0, status: 'queued', available_at: 0 }; tasks.push(job); return job; } };
}

test('configured vision slots start concurrently but never exceed their cap', async () => {
  const f = fixture({ laneConcurrency: { vision: 3 } });
  const gate = deferred(); let active = 0; let peak = 0;
  f.runtime.register('semantic', 'vision', async () => { active++; peak = Math.max(peak, active); await gate.promise; active--; });
  for (let i = 0; i < 6; i++) f.add('semantic', 'vision');
  try {
    await f.runtime.tick(); await delay(5);
    assert.equal(active, 3, 'three configured AI slots must not serialize behind one active lane');
    await f.runtime.tick(); assert.equal(peak, 3);
  } finally { gate.resolve(); await f.runtime.stop(); }
});

test('transient AI failures survive the third attempt and keep a bounded durable retry schedule', async () => {
  let clock = Date.now();
  const f = fixture({ now: () => clock, random: () => 0 });
  f.runtime.register('photo-description', 'vision', async () => { throw Object.assign(new Error('HUB_TIMEOUT'), { code: 'HUB_TIMEOUT', stage: 'review' }); });
  const job = f.add('photo-description', 'vision');
  try {
    for (const wait of [15000, 60000, 300000, 900000, 3600000, 21600000]) {
      await f.runtime.tick();
      while (!f.runtime.isIdle()) await delay(1);
      assert.equal(job.status, 'queued', 'a temporary failure must not become terminal after only three attempts');
      assert.equal(job.available_at, clock + wait);
      await f.runtime.tick(); assert.equal(job.status, 'queued', 'future work must not dispatch early');
      clock = job.available_at;
    }
    await f.runtime.tick(); while (!f.runtime.isIdle()) await delay(1);
    assert.equal(job.status, 'failed'); assert.equal(job.attempts, 7);
    assert.equal(f.failures.length, 7, 'each attempt must have a durable diagnostic, not only the last message');
  } finally { await f.runtime.stop(); }
});

test('permanent authentication failures stop immediately and a later success retains the failure history', async () => {
  let clock = Date.now(), calls = 0;
  const f = fixture({ now: () => clock, random: () => 0 });
  f.runtime.register('photo-description', 'vision', async payload => {
    if (payload.permanent) throw Object.assign(new Error('HUB_HTTP_401'), { code: 'HUB_HTTP_401' });
    if (++calls === 1) throw Object.assign(new Error('HUB_TIMEOUT'), { code: 'HUB_TIMEOUT' });
  });
  const blocked = f.add('photo-description', 'vision'); blocked.payload = '{"permanent":true}';
  const transient = f.add('photo-description', 'vision');
  try {
    await f.runtime.tick(); while (!f.runtime.isIdle()) await delay(1);
    assert.equal(blocked.status, 'failed'); assert.equal(blocked.attempts, 1);
    await f.runtime.tick(); while (!f.runtime.isIdle()) await delay(1);
    assert.equal(transient.status, 'queued'); clock = transient.available_at;
    await f.runtime.tick(); while (!f.runtime.isIdle()) await delay(1);
    assert.equal(transient.status, 'done'); assert.equal(f.failures.length, 2);
  } finally { await f.runtime.stop(); }
});

test('global cap reserves capacity and existing priority order is preserved', async () => {
  const f = fixture({ laneConcurrency: { vision: 3, derivative: 2 }, maxActive: 3 });
  const gate = deferred(); const started = [];
  for (const [kind, lane] of [['semantic', 'vision'], ['public-download', 'derivative']]) {
    f.runtime.register(kind, lane, async payload => { started.push(payload.id); await gate.promise; });
  }
  for (let i = 0; i < 3; i++) f.add('semantic', 'vision', 100).payload = JSON.stringify({ id: 'backfill' + i });
  f.add('semantic', 'vision', 0).payload = JSON.stringify({ id: 'upload' });
  f.add('public-download', 'derivative', 0).payload = JSON.stringify({ id: 'derivative' });
  try {
    await f.runtime.tick(); await delay(5);
    assert.equal(started.length, 3); assert.equal(started[0], 'upload');
    await f.runtime.tick(); assert.equal(started.length, 3);
  } finally { gate.resolve(); await f.runtime.stop(); }
});

test('resource pressure pauses new work without dropping tasks and resumes on recovery', async () => {
  let pressure = true;
  const f = fixture({ laneConcurrency: { vision: 2 }, canDispatch: () => !pressure });
  let starts = 0;
  f.runtime.register('semantic', 'vision', async () => { starts++; });
  f.add('semantic', 'vision');
  try {
    await f.runtime.tick(); await delay(5); assert.equal(starts, 0);
    assert.equal(f.tasks[0].status, 'queued');
    pressure = false; await f.runtime.tick(); await delay(5); assert.equal(starts, 1);
    assert.equal(f.tasks[0].status, 'done');
  } finally { await f.runtime.stop(); }
});

test('all concurrent jobs finish before shutdown releases the leader lock', async () => {
  const f = fixture({ laneConcurrency: { vision: 2 } });
  const gates = [deferred(), deferred()]; let starts = 0;
  f.runtime.register('semantic', 'vision', async () => { const index = starts++; await gates[index].promise; });
  f.add('semantic', 'vision'); f.add('semantic', 'vision');
  await f.runtime.tick(); await delay(5);
  const stopping = f.runtime.stop();
  gates[0].resolve(); await delay(5);
  try { assert.equal(starts, 2); assert.equal(f.released(), false); }
  finally { gates[1].resolve(); await stopping; }
  assert.equal(f.released(), true);
});

test('short tasks refill their slot immediately instead of waiting for the poll interval', async () => {
  const f = fixture({ intervalMs: 5000 }); let starts = 0;
  const gate = deferred();
  f.runtime.register('semantic', 'vision', async () => { starts++; if (starts === 1) await gate.promise; });
  f.add('semantic', 'vision'); f.add('semantic', 'vision');
  try {
    f.runtime.start();
    for (let i = 0; i < 100 && starts === 0; i++) await delay(1);
    assert.equal(starts, 1); gate.resolve();
    for (let i = 0; i < 100 && starts < 2; i++) await delay(1);
    assert.equal(starts, 2);
  } finally { gate.resolve(); await f.runtime.stop(); }
});

test('face clustering remains serial and queued foreground DB queries pause dispatch', async () => {
  const f = fixture({ laneConcurrency: { vision: 3 } }); const gate = deferred(); let starts = 0;
  f.runtime.register('face', 'face', async () => { starts++; await gate.promise; });
  f.add('face', 'face'); f.add('face', 'face');
  f.db.pool = { _connectionQueue: [1] };
  try {
    await f.runtime.tick(); await delay(5); assert.equal(starts, 0);
    f.db.pool._connectionQueue.length = 0;
    await f.runtime.tick(); await delay(5); assert.equal(starts, 1);
    await f.runtime.tick(); assert.equal(starts, 1);
  } finally { gate.resolve(); await f.runtime.stop(); }
});

test('a queued face gets the next free slot before a saturated background lane refills', async () => {
  const f = fixture({ laneConcurrency: { vision: 3, derivative: 2 }, maxActive: 6 });
  const held = deferred(); const derivative = deferred(); const started = [];
  f.runtime.register('semantic', 'vision', async () => { started.push('vision'); await held.promise; });
  f.runtime.register('public-download', 'derivative', async () => {
    started.push('derivative'); await derivative.promise;
  });
  f.runtime.register('image-similarity', 'similarity', async () => { started.push('similarity'); await held.promise; });
  f.runtime.register('face', 'face', async () => { started.push('face'); await held.promise; });
  for (let i = 0; i < 8; i++) f.add('semantic', 'vision');
  for (let i = 0; i < 8; i++) f.add('public-download', 'derivative');
  f.add('image-similarity', 'similarity');
  try {
    await f.runtime.tick(); await delay(5);
    assert.equal(started.length, 6);
    f.add('face', 'face');
    derivative.resolve(); await delay(5);
    await f.runtime.tick(); await delay(5);
    assert.equal(started[6], 'face', 'face detection must not wait behind another lengthy JPEG encode');
    assert.equal(started.filter(kind => kind === 'face').length, 1);
  } finally { derivative.resolve(); held.resolve(); await f.runtime.stop(); }
});
