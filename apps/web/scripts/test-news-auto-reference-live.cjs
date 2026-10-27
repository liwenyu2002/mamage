// Opt-in: real AI requests against the isolated local writing sandbox only.
const assert = require('node:assert/strict');
if (process.env.MAMAGE_NEWS_BACKEND_TEST !== '1') throw Error('Live sandbox test requires explicit opt-in');
const base = 'http://127.0.0.1:5192';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function main() {
  const config = await (await fetch(`${base}/__news-qa/config`)).json();
  const health = await (await fetch(`${base}/api/health/ready`)).json();
  assert.equal(config.liveBackend, true); assert.equal(health.sandbox, true);
  const headers = { Authorization: `Bearer ${config.session.token}`, 'X-Mamage-Unit-Id': '900003', 'Content-Type': 'application/json' };
  for (const sample of [
    { sourceMaterial: '基础科学与人工智能论坛，围绕人工智能和光计算芯片展开交流。', status: 'automatic', title: /基础科学与人工智能论坛/ },
    { sourceMaterial: '图书馆举行读书交流活动，同学分享阅读笔记。', status: 'no_match' },
  ]) {
    const response = await fetch(`${base}/api/ai/news/generate/batch`, { method: 'POST', headers,
      body: JSON.stringify({ channels: ['wechat_article'], form: { sourceMaterial: sample.sourceMaterial, monitorReferences: [] }, selectedPhotos: [], referenceArticle: '' }) });
    if (response.status !== 202) throw Error(`generation failed (${response.status}): ${await response.text()}`);
    const { batchId } = await response.json();
    let job;
    for (let attempt = 0; attempt < 90; attempt++) {
      const result = await fetch(`${base}/api/ai/news/batches/${batchId}`, { headers });
      assert.equal(result.status, 200);
      const batch = await result.json(); job = batch.jobs[0];
      if (job.status === 'succeeded' || job.status === 'failed') break;
      await pause(1000);
    }
    assert.equal(job.status, 'succeeded');
    assert.doesNotMatch(`${job.result.title || ''}\n${job.result.markdown || ''}`, /\p{Extended_Pictographic}/u,
      'a generated draft with no emoji in its source should not add pictographic symbols');
    assert.equal(job.result.referenceStatus, sample.status);
    if (sample.title) assert.match(job.result.references[0].title, sample.title);
    else assert.deepEqual(job.result.references, []);
    console.log(JSON.stringify({ sandbox: true, referenceStatus: job.result.referenceStatus,
      referenceTitles: job.result.references.map(item => item.title) }));
  }
}
main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
