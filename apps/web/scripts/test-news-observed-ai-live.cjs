const assert = require('node:assert/strict');
const crypto = require('node:crypto');
if (process.env.MAMAGE_NEWS_BACKEND_TEST !== '1') throw Error('Live sandbox test requires explicit opt-in');
const base = 'http://127.0.0.1:5192';
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function main() {
  const config = await (await fetch(`${base}/__news-qa/config`)).json();
  const health = await (await fetch(`${base}/api/health/ready`)).json();
  assert.equal(config.liveBackend, true); assert.equal(health.sandbox, true);
  const headers = { Authorization: `Bearer ${config.session.token}`, 'X-Mamage-Unit-Id': '900003', 'Content-Type': 'application/json' };
  const library = await (await fetch(`${base}/api/wechat-style/monitor-templates`, { headers })).json();
  const template = library.templates[0], headingId = template.styleIds.h2;
  const heading = library.blocks.find(item => `db-${item.id}` === headingId);
  assert.ok(heading);
  const clientRequestId = crypto.randomUUID();
  const body = { clientRequestId, brief: `标题使用观察库样式“${heading.name}”，编号 ${headingId}；正文简洁。`,
    source: { title: '测试活动', doc: [{ uid: 'heading', kind: 'styled', type: 'h2', headingLevel: 2, content: '活动现场' },
      { uid: 'body', kind: 'para', type: 'body', html: '师生开展交流。' }] } };
  const submitted = await fetch(`${base}/api/wechat-compositions/layout`, { method: 'POST', headers, body: JSON.stringify(body) });
  if (submitted.status !== 202) throw Error(`layout submission failed (${submitted.status}): ${await submitted.text()}`);
  let job;
  for (let i = 0; i < 90; i++) {
    const response = await fetch(`${base}/api/wechat-compositions/layout/${clientRequestId}`, { headers });
    assert.equal(response.status, 200); job = await response.json();
    if (['succeeded', 'failed'].includes(job.status)) break;
    await wait(1000);
  }
  assert.equal(job.status, 'succeeded', job.error);
  assert.equal(job.result.plan.blocks.find(item => item.uid === 'heading').styleId, headingId);
  assert.deepEqual(job.result.plan.blocks.map(item => item.uid).sort(), ['body', 'heading']);
  console.log(JSON.stringify({ sandbox: true, aiUsedObservedStyle: true, sourcePreserved: true, headingId }));
}
main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
