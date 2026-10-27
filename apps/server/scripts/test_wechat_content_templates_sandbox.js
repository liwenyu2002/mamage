// Explicit opt-in: runs only against the dedicated local writing sandbox.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');

async function main() {
  if (process.env.MAMAGE_NEWS_TEMPLATE_SANDBOX_TEST !== '1') throw Error('Set MAMAGE_NEWS_TEMPLATE_SANDBOX_TEST=1');
  const root = path.resolve(__dirname, '../../..');
  const settings = JSON.parse(fs.readFileSync(path.join(root, '.local/news-live-backend-20261025/sandbox.private.json')));
  if (settings.database !== 'mamage_news_sandbox') throw Error('Refusing non-sandbox database');
  const base = 'http://127.0.0.1:18192';
  const health = await (await fetch(`${base}/api/health/ready`)).json();
  if (health.sandbox !== true) throw Error('Refusing non-sandbox API');
  const headers = id => ({ 'Content-Type': 'application/json', 'X-Mamage-Unit-Id': '900003',
    Authorization: `Bearer ${jwt.sign({ id }, settings.jwt, { expiresIn: '5m' })}` });
  const call = (route, id, options = {}) => fetch(base + '/api/wechat-compositions/content-templates' + route,
    { ...options, headers: { ...headers(id), ...options.headers } });
  const name = `自动测试-${Date.now()}`;
  const value = { name, outline: '导语\n交流\n结尾', reviewCredits: true, visibility: 'private' };
  let created;
  try {
    const response = await call('', 900003, { method: 'POST', body: JSON.stringify(value) });
    assert.equal(response.status, 201, await response.clone().text());
    created = (await response.json()).id;
    let other = await (await call('', 900009)).json();
    assert.equal(other.items.some(item => item.id === created), false, 'another user cannot see a private template');
    assert.equal((await call(`/${created}`, 900009, { method: 'DELETE' })).status, 404);
    assert.equal((await call(`/${created}`, 900003, { method: 'PUT', body: JSON.stringify({ ...value, visibility: 'workspace' }) })).status, 200);
    other = await (await call('', 900009)).json();
    assert.equal(other.items.find(item => item.id === created)?.canEdit, true, 'another workspace manager can manage shared templates');
    const legacy = await call('', 900009, { headers: { 'X-Mamage-Unit-Id': 'legacy' } });
    if (legacy.ok) assert.equal((await legacy.json()).items.some(item => item.id === created), false);
    else assert.equal(legacy.status, 403);
    assert.equal((await call(`/${created}`, 900009, { method: 'DELETE' })).status, 200);
    created = null;
    const body = { material: '学生在报告厅介绍实践项目，老师现场点评。', reference: '', clientRequestId: crypto.randomUUID() };
    const submit = () => fetch(base + '/api/wechat-compositions/content-template', { method: 'POST', headers: headers(900003), body: JSON.stringify(body) });
    const first = await submit(); assert.equal(first.status, 202, await first.clone().text());
    const job = await first.json();
    const second = await submit(); assert.equal(second.status, 202); assert.equal((await second.json()).jobId, job.jobId);
    let result;
    for (let attempt = 0; attempt < 75; attempt++) {
      const response = await fetch(base + `/api/wechat-compositions/content-template/${body.clientRequestId}`, { headers: headers(900003) });
      assert.equal(response.status, 200);
      result = await response.json();
      if (['succeeded', 'failed', 'cancelled'].includes(result.status)) break;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    assert.equal(result.status, 'succeeded', JSON.stringify(result));
    assert.ok(result.result?.plan?.outline?.trim());
    assert.equal((await fetch(base + `/api/wechat-compositions/content-template/${body.clientRequestId}`, { headers: headers(900009) })).status, 404);
    console.log(JSON.stringify({ passed: true, sandbox: true, privateIsolation: true, sharedManagement: true, workspaceIsolation: true,
      realModelStructure: true, idempotent: true, jobIsolation: true }));
  } finally {
    if (created) await call(`/${created}`, 900003, { method: 'DELETE' });
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
