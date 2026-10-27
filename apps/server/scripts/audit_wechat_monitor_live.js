// Read-only acceptance against the owned local sandbox, never production or model credentials.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { DIMENSIONS, validateAnalysisClaim } = require('../lib/wechat_monitor_learning');
if (process.env.MAMAGE_WECHAT_MONITOR_LIVE_AUDIT !== '1') throw Error('Set MAMAGE_WECHAT_MONITOR_LIVE_AUDIT=1 to inspect the local monitor sandbox');
const directory = path.resolve(__dirname, '../../../.local/news-live-backend-20261025');
const session = JSON.parse(fs.readFileSync(path.join(directory, 'session.private.json'), 'utf8'));
const normalize = text => String(text).normalize('NFKC').replace(/\s+/g, '');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function get(endpoint) {
  const response = await fetch('http://127.0.0.1:18192/api/' + endpoint, { signal: AbortSignal.timeout(10000),
    headers: { Authorization: 'Bearer ' + session.token, 'X-Mamage-Unit-Id': String(session.workspaceId) } });
  assert.equal(response.status, 200, `Local audit endpoint ${endpoint.split('?')[0]} must succeed`);
  return response.json();
}
async function main() {
  assert.equal((await get('health/ready')).sandbox, true);
  let overview;
  const deadline = Date.now() + (process.argv.includes('--wait') ? 300000 : 0);
  do {
    overview = await get('wechat-monitor/overview');
    const pending = overview.jobs.filter(job => ['pending', 'running', 'retry'].includes(job.status) && ['fetch', 'analyze', 'summarize'].includes(job.kind));
    if (!pending.length || Date.now() >= deadline) break;
    console.log(JSON.stringify({ waitingForExistingQueue: true, accounts: overview.accounts.map(account => ({ name: account.name, articles: account.articleCount, analyzed: account.analyzedCount })), pending }));
    await delay(15000);
  } while (true);
  assert.equal(overview.accounts.length, 2);
  const articles = [];
  for (let page = 1; page <= 100; page++) {
    const list = await get(`wechat-monitor/articles?page=${page}`);
    for (const item of list.items) articles.push(await get('wechat-monitor/articles/' + item.id));
    if (!list.hasMore) break;
  }
  const byId = new Map(articles.map(article => [article.id, article]));
  const quoted = (quote, article) => assert.ok(normalize(article.title + '\n' + article.text).includes(normalize(quote)), 'Stored quotation must exist in its own source article');
  for (const article of articles) {
    const account = overview.accounts.find(row => row.id === article.accountId);
    assert.ok(account); assert.equal(article.author, account.name);
    assert.ok(article.blocks.length && article.text.length >= 20);
    assert.ok(article.publishedAt >= Date.parse('2024-01-01T00:00:00+08:00'));
    assert.equal(article.metadata.provenance.transport, 'shared_reverse_import');
    if (!article.analysis) continue;
    assert.equal(article.analysisState, 'ready');
    validateAnalysisClaim(article.analysis.summary, 'summary');
    assert.deepEqual(Object.keys(article.analysis.dimensions).sort(), Object.keys(DIMENSIONS).sort());
    for (const dimension of Object.values(article.analysis.dimensions)) {
      validateAnalysisClaim(dimension.finding, 'dimension.finding');
      dimension.evidence.forEach(quote => quoted(quote, article));
      for (const [key, value] of Object.entries(dimension.metrics || {})) assert.deepEqual(value, article.visualFeatures[key]);
    }
    article.analysis.sceneEvidence.forEach(quote => quoted(quote, article));
    article.analysis.lessons.forEach(lesson => lesson.evidence.forEach(quote => quoted(quote, article)));
    for (const relation of article.relations) {
      const other = byId.get(relation.id); assert.ok(other, 'Relations must stay inside the current library');
      const ownQuotes = article.id < other.id ? relation.evidence.low : relation.evidence.high;
      const otherQuotes = article.id < other.id ? relation.evidence.high : relation.evidence.low;
      ownQuotes.forEach(quote => quoted(quote, article)); otherQuotes.forEach(quote => quoted(quote, other));
    }
  }
  const groups = (await get('wechat-monitor/groups')).items;
  for (const item of groups.filter(group => group.summary)) {
    const group = await get('wechat-monitor/groups/' + item.id);
    assert.equal(group.summaryCurrent, true, 'Group summaries must match the current content, analysis versions and publication dates');
    if (group.kind === 'series') assert.ok(new Set(group.members.map(member => new Date(member.publishedAt + 8 * 3600000).toISOString().slice(0, 10))).size >= 2);
    for (const pattern of group.summary.patterns) {
      assert.ok(new Set(pattern.support.map(support => support.articleId)).size >= 2);
      for (const support of pattern.support) { assert.ok(byId.has(support.articleId)); quoted(support.quote, byId.get(support.articleId)); }
    }
  }
  assert.ok(articles.length > 0, 'Real target articles, not synthetic fixtures, must exist');
  assert.ok(articles.some(article => article.analysis), 'At least one real target article must have completed analysis');
  const report = { checkedAt: new Date().toISOString(), synthetic: false, productionChanged: false, historyComplete: false,
    passedStoredEvidenceChecks: true, passedExplicitPronounChecks: true, accounts: overview.accounts.map(account => ({ name: account.name,
      articleCount: account.articleCount, analyzedCount: account.analyzedCount, identityVerified: account.identityVerified,
      earliestAt: account.earliestAt, latestAt: account.latestAt })), jobs: overview.jobs,
    articles: articles.map(article => ({ id: article.id, title: article.title, sourceUrl: article.sourceUrl,
      publishedAt: article.publishedAt, imageCount: article.metadata.imageCount, blockCount: article.blocks.length,
      analysisState: article.analysisState, analysisProtocol: article.analysis?.protocolVersion || null,
      scene: article.analysis?.scene || null, related: article.relations.length })),
    groups: groups.map(group => ({ name: group.name, kind: group.kind, count: group.count, summarized: Boolean(group.summary) })) };
  const output = path.resolve(__dirname, '../../../.local/wechat-monitor-qa');
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, 'real-library-audit.json'), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(output, 'real-writing-review-input.json'), JSON.stringify(articles.filter(article => article.analysis).slice(0, 2).map(article => ({
    title: article.title, text: article.text, scene: article.analysis.scene, summary: article.analysis.summary, visualFeatures: article.visualFeatures,
  })), null, 2));
  console.log(JSON.stringify({ passed: true, articles: articles.length, analyzed: articles.filter(article => article.analysis).length,
    summarizedGroups: groups.filter(group => group.summary).length, historyComplete: false, productionChanged: false, report: path.join(output, 'real-library-audit.json') }));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
