const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const path = require('node:path');
const { fork } = require('node:child_process');
const jwt = require('jsonwebtoken');
if (!String(process.env.DB_NAME || '').endsWith('_workspace_test')) throw Error('Isolated *_workspace_test database required');
const { pool } = require('../db');
const { JWT_SECRET } = require('../config/keys');
const children = [];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, label) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) { const result = await check(); if (result) return result; await delay(50); }
  throw Error(`Timeout: ${label}`);
}
function child(file, env = {}) {
  const processChild = fork(path.join(__dirname, 'fixtures', file), [], { silent: true,
    env: { ...process.env, MAMAGE_RUNTIME_TEST: '1', ...env } });
  const state = { process: processChild, messages: [], output: '', exited: false };
  state.exit = new Promise(resolve => processChild.once('exit', (code, signal) => { state.exited = true; resolve({ code, signal }); }));
  processChild.on('message', value => state.messages.push(value));
  processChild.stdout.on('data', part => { state.output += part; });
  processChild.stderr.on('data', part => { state.output += part; });
  children.push(state); return state;
}
async function main() {
  const objects = new Map(), uploads = new Map(); let completions = 0; let fixture;
  const suffix = crypto.randomBytes(5).toString('hex');
  const storage = http.createServer(async (req, res) => {
    if (req.method !== 'POST') { res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': '16' }); res.end(req.method === 'HEAD' ? undefined : Buffer.alloc(16)); return; }
    const chunks = []; for await (const part of req) chunks.push(part);
    const body = JSON.parse(Buffer.concat(chunks));
    let result = {};
    if (body.op === 'init') { const uploadId = crypto.randomUUID(); uploads.set(uploadId, { key: body.key, parts: new Map() }); result = { uploadId }; }
    if (body.op === 'put') objects.set(body.key, body.bytes);
    if (body.op === 'head') result = { ContentLength: objects.get(body.key) || 0 };
    if (body.op === 'part') { uploads.get(body.uploadId).parts.set(body.partNumber, body.bytes); result = { etag: `"part-${body.partNumber}"` }; }
    if (body.op === 'complete') {
      const upload = uploads.get(body.uploadId);
      if (!upload) { res.writeHead(400); res.end(JSON.stringify({ error: 'NoSuchUpload' })); return; }
      objects.set(body.key, [...upload.parts.values()].reduce((sum, n) => sum + n, 0));
      uploads.delete(body.uploadId); completions += 1;
    }
    if (body.op === 'abort') uploads.delete(body.uploadId);
    if (body.op === 'delete') { body.keys.forEach(key => objects.delete(key)); result = { deleted: body.keys }; }
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(result));
  });
  try {
    await new Promise(resolve => storage.listen(0, '127.0.0.1', resolve));
    fixture = `http://127.0.0.1:${storage.address().port}`;
    const [org] = await pool.query('INSERT INTO organizations (name, slug, code) VALUES (?, ?, ?)', ['Distributed test', `dist-${suffix}`, `DIST-${suffix}`]);
    const [unit] = await pool.query('INSERT INTO organization_units (organization_id, name, slug) VALUES (?, ?, ?)', [org.insertId, 'Test', `dist-${suffix}`]);
    const [user] = await pool.query('INSERT INTO users (student_no, name, role, organization_id, active_unit_id) VALUES (?, ?, ?, ?, ?)', [`dist-${suffix}`, 'Test', 'photographer', org.insertId, unit.insertId]);
    const [stranger] = await pool.query('INSERT INTO users (student_no, name, role, organization_id, active_unit_id) VALUES (?, ?, ?, ?, ?)', [`other-${suffix}`, 'Other', 'photographer', org.insertId, unit.insertId]);
    await pool.query("INSERT INTO organization_unit_memberships (unit_id, user_id, role) VALUES (?, ?, 'editor'), (?, ?, 'editor')", [unit.insertId, user.insertId, unit.insertId, stranger.insertId]);
    for (const permission of ['upload.photo', 'photos.view', 'ai.generate']) await pool.query('INSERT INTO role_permissions (role, permission) VALUES (?, ?)', ['photographer', permission]);
    const [project] = await pool.query('INSERT INTO projects (uuid, name, organization_id, unit_id) VALUES (UUID(), ?, ?, ?)', ['Test album', org.insertId, unit.insertId]);
    const headers = { Authorization: `Bearer ${jwt.sign({ id: user.insertId }, JWT_SECRET)}`, 'X-MaMage-Unit-Id': String(unit.insertId) };
    async function launch() {
      const state = child('distributed_api.cjs', { MAMAGE_STORAGE_FIXTURE: fixture });
      const message = await until(() => {
        if (state.exited) throw Error(state.output);
        return state.messages.find(value => value.type === 'listening');
      }, 'API startup');
      state.base = `http://127.0.0.1:${message.port}`; return state;
    }
    let a = await launch(); const b = await launch();
    async function call(api, method, url, body, extra = {}) {
      const raw = Buffer.isBuffer(body);
      const response = await fetch(api.base + url, { method, headers: { ...headers,
        'Content-Type': raw ? 'application/octet-stream' : 'application/json', ...extra },
        ...(body === undefined ? {} : { body: raw ? body : JSON.stringify(body) }) });
      const json = await response.json();
      return { status: response.status, json };
    }
    assert.equal((await call(a, 'POST', '/_fixture/state/shared', { value: 42 })).status, 200);
    assert.equal((await call(b, 'GET', '/_fixture/state/shared')).json.value, 42);
    const limited = await Promise.all(Array.from({ length: 16 }, (_, i) => call(i % 2 ? a : b, 'POST', '/_fixture/rate', {})));
    assert.equal(limited.filter(result => result.json.allowed).length, 6, 'shared limits cannot multiply with API replicas');
    const init = await call(a, 'POST', '/api/upload/video/direct/init', {
      projectId: project.insertId, fileName: 'test.mp4', fileSize: 12 * 1024 * 1024, mimeType: 'video/mp4', transport: 'proxy',
    });
    assert.equal(init.status, 200, JSON.stringify(init));
    const id = init.json.sessionId;
    assert.equal((await call(b, 'POST', '/api/upload/video/direct/parts', { sessionId: id, partNumbers: [1, 2] })).status, 200);
    assert.equal((await call(b, 'POST', '/api/upload/video/direct/parts', { sessionId: id, partNumbers: [1] },
      { Authorization: `Bearer ${jwt.sign({ id: stranger.insertId }, JWT_SECRET)}` })).status, 404);
    assert.equal((await call(b, 'PUT', `/api/upload/video/direct/part-proxy/${id}/1`, Buffer.alloc(8 * 1024 * 1024))).status, 200);
    a.process.kill('SIGKILL'); await a.exit;
    a = await launch();
    assert.equal((await call(a, 'PUT', `/api/upload/video/direct/part-proxy/${id}/2`, Buffer.alloc(4 * 1024 * 1024))).status, 200);
    const completed = await Promise.all([a, b].map(api => call(api, 'POST', '/api/upload/video/direct/complete', {
      sessionId: id, parts: [1, 2].map(partNumber => ({ partNumber, etag: `"part-${partNumber}"` })),
    })));
    completed.forEach(result => assert.equal(result.status, 200, JSON.stringify(result)));
    assert.equal(completed[0].json.id, completed[1].json.id);
    assert.equal(completions, 1, 'S3 completion must not repeat after an API restart or concurrent completion');
    const [[count]] = await pool.query('SELECT COUNT(*) AS total FROM photos WHERE project_id = ?', [project.insertId]);
    assert.equal(count.total, 1);
    assert.equal((await call(b, 'POST', '/api/upload/video/direct/abort', { sessionId: id })).json.committed, true);
    assert.equal(objects.size, 1, 'late abort must preserve the committed source');
    const [intents] = await pool.query("SELECT * FROM runtime_tasks WHERE kind = 'semantic' AND dedupe_key = ?", [String(completed[0].json.id)]);
    assert.equal(intents.length, 1, 'photo transaction must include durable analysis intent');
    const pending = await call(a, 'POST', '/api/upload/video/direct/init', {
      projectId: project.insertId, fileName: 'rollback.mp4', fileSize: 10, mimeType: 'video/mp4', clientProtocol: 'http:',
    });
    assert.equal(pending.status, 200);
    const sourceKey = pending.json.upload.formFields.key;
    await fetch(fixture, { method: 'POST', body: JSON.stringify({ op: 'put', key: sourceKey, bytes: 10 }) });
    await pool.query('RENAME TABLE runtime_tasks TO runtime_tasks_unavailable');
    try {
      assert.equal((await call(a, 'POST', '/api/upload/video/direct/complete', { sessionId: pending.json.sessionId })).status, 500);
      const [[rolledBack]] = await pool.query('SELECT COUNT(*) AS total FROM photos WHERE url = ?', [`/${sourceKey}`]);
      assert.equal(rolledBack.total, 0, 'failed outbox insert must roll the photo transaction back');
      assert.equal(objects.has(sourceKey), true, 'retryable completion keeps its uploaded source');
    } finally { await pool.query('RENAME TABLE runtime_tasks_unavailable TO runtime_tasks'); }
    assert.equal((await call(b, 'POST', '/api/upload/video/direct/complete', { sessionId: pending.json.sessionId })).status, 200);

    const assetInit = await call(a, 'POST', '/api/video-projects/assets/direct/init', { fileName: 'editor.mp4', fileSize: 100, mimeType: 'video/mp4' });
    assert.equal(assetInit.status, 200, JSON.stringify(assetInit));
    await fetch(fixture, { method: 'POST', body: JSON.stringify({ op: 'put', key: assetInit.json.upload.formFields.key, bytes: 100 }) });
    const assets = await Promise.all([a, b].map(api => call(api, 'POST', '/api/video-projects/assets/direct/complete', { sessionId: assetInit.json.sessionId })));
    assets.forEach(result => assert.equal(result.status, 201, JSON.stringify(result)));
    assert.equal(assets[0].json.asset.id, assets[1].json.asset.id);

    const ticket = await call(a, 'POST', '/api/photos/zip-ticket', { photoIds: [completed[0].json.id] });
    assert.equal(ticket.status, 200);
    const downloads = await Promise.all([a, b].map(api => fetch(api.base + '/api/photos/zip?ticket=' + ticket.json.ticket)));
    assert.equal(downloads.filter(response => response.status === 401).length, 1, 'ticket is consumed atomically across replicas');
    await Promise.all(downloads.map(response => response.arrayBuffer()));
    const zip = await call(a, 'POST', '/api/photos/zip-direct', { photoIds: [completed[0].json.id] });
    assert.equal(zip.status, 202, JSON.stringify(zip));
    const list = await call(b, 'GET', '/api/photos/zip-direct');
    assert.ok(list.json.jobs.some(job => job.id === zip.json.id));
    assert.equal((await call(b, 'POST', `/api/photos/zip-direct/${zip.json.id}/cancel`, {})).json.cancelled, true);
    assert.equal((await call(a, 'GET', `/api/photos/zip-direct/${zip.json.id}`)).json.status, 'cancelled');
    const [videoProject] = await pool.query('INSERT INTO video_projects (user_id, org_id, unit_id, name, project_json) VALUES (?, ?, ?, ?, ?)',
      [user.insertId, org.insertId, unit.insertId, 'Render outbox', JSON.stringify({ clips: [] })]);
    const render = await call(a, 'POST', `/api/video-projects/${videoProject.insertId}/render`, {});
    assert.equal(render.status, 202, JSON.stringify(render));
    const renderId = render.json.job.id;
    assert.equal((await call(b, 'GET', `/api/video-projects/renders/${renderId}`)).json.job.status, 'queued');
    assert.equal((await call(b, 'POST', `/api/video-projects/renders/${renderId}/cancel`, {})).status, 200);
    assert.equal((await call(a, 'GET', `/api/video-projects/renders/${renderId}`)).json.job.status, 'canceled');
    const [renderIntent] = await pool.query("SELECT id FROM runtime_tasks WHERE kind = 'video-render' AND dedupe_key = ?", [String(renderId)]);
    assert.equal(renderIntent.length, 1);
    console.log('PASS: two real API processes share uploads/assets/tickets/ZIP state, preserve ACLs and survive API SIGKILL');

    await call(a, 'POST', '/_fixture/enqueue', { key: 'low', priority: 100 });
    await call(b, 'POST', '/_fixture/enqueue', { key: 'high', priority: 0 });
    const first = child('distributed_worker.cjs', { MAMAGE_FIXTURE_HOLD: '1' });
    await until(() => first.messages.some(message => message.type === 'leader'), 'first leader');
    const second = child('distributed_worker.cjs');
    await delay(200);
    assert.equal(second.messages.filter(message => message.type === 'leader').length, 0, 'only one background coordinator');
    await until(() => first.messages.filter(message => message.type === 'task-start').length >= 2, 'priority jobs');
    assert.deepEqual(first.messages.filter(message => message.type === 'task-start').slice(0, 2).map(message => message.key), ['high', 'low']);
    await Promise.all([a, b].map(api => call(api, 'POST', '/_fixture/enqueue', { key: 'recover', hold: true })));
    await until(() => first.messages.some(message => message.type === 'task-start' && message.key === 'recover'), 'job start before crash');
    first.process.kill('SIGKILL'); await first.exit;
    await until(() => second.messages.some(message => message.type === 'leader'), 'leader failover');
    await until(async () => (await pool.query("SELECT status FROM runtime_tasks WHERE kind = 'verification' AND dedupe_key = 'recover'"))[0][0]?.status === 'done', 'recovered task');
    const [[effect]] = await pool.query("SELECT COUNT(*) AS total FROM runtime_state WHERE namespace = 'verification-effect' AND state_key = 'recover'");
    assert.equal(effect.total, 1);
    const [[task]] = await pool.query("SELECT attempts FROM runtime_tasks WHERE kind = 'verification' AND dedupe_key = 'recover'");
    assert.equal(task.attempts, 2, 'interrupted work must be retried, not lost');
    assert.equal(second.messages.filter(message => message.type === 'task-start' && message.key === 'recover').length, 1);
    console.log('PASS: duplicate enqueue deduplicates, one leader runs jobs, SIGKILL failover recovers durable work');

    second.process.kill('SIGTERM'); await second.exit;
    let clock = Date.now();
    const [retryJob] = await pool.query(`INSERT INTO runtime_tasks(kind,dedupe_key,lane,payload,available_at)
      VALUES('photo-description',?,'retry-test',?,?)`, [`retry-${suffix}`, JSON.stringify({ photoId: completed[0].json.id }), clock]);
    const taskState = async () => (await pool.query('SELECT status,attempts,available_at,last_error FROM runtime_tasks WHERE id=?', [retryJob.insertId]))[0][0];
    let retryWorker = child('distributed_retry.cjs', { MAMAGE_TEST_CLOCK: String(clock) });
    await until(() => retryWorker.messages.some(message => message.type === 'leader'), 'retry leader');
    for (const attempt of [1, 2, 3]) {
      const state = await until(async () => { const row = await taskState(); return row.attempts === attempt && row.status === 'queued' ? row : null; }, `durable retry ${attempt}`);
      const detail = typeof state.last_error === 'string' ? JSON.parse(state.last_error) : state.last_error;
      assert.equal(detail.stage, 'review'); assert.equal(detail.causeCode, 'HUB_HTTP_503');
      assert.equal(detail.httpStatus, 503); assert.ok(Number(state.available_at) > clock);
      if (attempt < 3) { clock = Number(state.available_at); retryWorker.process.send({ type: 'clock', now: clock }); }
    }
    const delayed = await taskState();
    retryWorker.process.kill('SIGTERM'); await retryWorker.exit;
    retryWorker = child('distributed_retry.cjs', { MAMAGE_TEST_CLOCK: String(clock) });
    await until(() => retryWorker.messages.some(message => message.type === 'leader'), 'retry leader after restart');
    await delay(100); assert.deepEqual(await taskState(), delayed, 'restart must not discard or accelerate delayed retries');
    retryWorker.process.send({ type: 'clock', now: Number(delayed.available_at) });
    const recovered = await until(async () => { const row = await taskState(); return row.status === 'done' ? row : null; }, 'delayed recovery');
    assert.equal(recovered.attempts, 4); assert.equal(recovered.last_error, null);
    const [history] = await pool.query('SELECT attempt,stage,cause_code,http_status,retry_at FROM runtime_task_failures WHERE task_id=? ORDER BY id', [retryJob.insertId]);
    assert.deepEqual(history.map(row => row.attempt), [1, 2, 3]);
    assert.ok(history.every(row => row.stage === 'review' && row.cause_code === 'HUB_HTTP_503' && row.http_status === 503 && row.retry_at));
    const [[applied]] = await pool.query("SELECT COUNT(*) n FROM runtime_state WHERE namespace='retry-test-effect' AND state_key=?", [String(completed[0].json.id)]);
    assert.equal(Number(applied.n), 1);
    console.log('PASS: delayed retries survive restart, recover on attempt four, retain every failure and apply one effect');
  } finally {
    for (const state of children) {
      if (!state.exited) state.process.kill('SIGTERM');
      const timer = setTimeout(() => state.process.kill('SIGKILL'), 4000);
      await state.exit; clearTimeout(timer);
    }
    storage.closeAllConnections(); await new Promise(resolve => storage.close(resolve));
    await pool.end();
    for (const state of children) if (state.output.includes('Error:')) console.error(state.output.slice(-5000));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
