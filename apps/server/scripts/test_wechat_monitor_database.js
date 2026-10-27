// Explicitly opt-in, loopback-only integration checks. Never points at production.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
if (process.env.MAMAGE_WECHAT_MONITOR_DB_TEST !== '1') throw Error('Set MAMAGE_WECHAT_MONITOR_DB_TEST=1 to test the isolated monitor database');
const settings = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../.local/news-live-backend-20261025/sandbox.private.json'), 'utf8'));
if (settings.database !== 'mamage_news_sandbox') throw Error('Refusing a non-sandbox database');
const testDatabase = 'mamage_wechat_monitor_test_' + crypto.randomBytes(6).toString('hex');
Object.assign(process.env, { DB_HOST: '127.0.0.1', DB_PORT: '13362', DB_USER: 'news_sandbox', DB_PASSWORD: settings.password,
  DB_NAME: testDatabase, JWT_SECRET: settings.jwt, ORGANIZATION_UNITS_ACTIVE: '1', WECHAT_MONITOR_ENABLED: '0' });
const { pool } = require('../db');
const { makeStore, scopeFor } = require('../lib/wechat_monitor_store');
const { createWorker } = require('../lib/wechat_monitor_worker');
const { createRouter } = require('../routes/wechat_monitor');
const content = require('../lib/wechat_monitor_content'), learning = require('../lib/wechat_monitor_learning');
const express = require('express');
let now = Date.now();
const unitId = crypto.randomInt(1000000, 2000000000), workspace = { enabled: true, userId: 900003, orgId: 900003, unitId, role: 'manager', userRole: 'admin' };
const scope = scopeFor(workspace);
function fixtureArticle(number) {
  return `<html><body><h1 id="activity-name">观察计划｜测试文章 ${number}（集成测试合成资料）</h1><a id="js_name">哈尔滨工业大学</a>
    <div id="js_content"><p>同学们带着观察记录来到报告厅。第${number}组介绍了新的问题。</p><p>讲述从一个问题开始，再用具体行动回应。</p><p>欢迎同学们留下自己的观察。</p></div>
    <script>var ct="${1711929600 + number * 86400}"; var biz="TEST_ONLY_NOT_REAL"; var appmsgid="${100000 + number}"; var idx="1";</script></body></html>`;
}
function rawAnalysis(article, candidates) {
  const quote = '讲述从一个问题开始';
  return { summary: '从问题引入，交代行动并邀请参与。', scene: 'events', sceneConfidence: 0.9, sceneEvidence: ['来到报告厅'],
    dimensions: Object.fromEntries(Object.keys(learning.DIMENSIONS).map(key => [key, { finding: '从问题展开具体行动，结尾邀请参与。', evidence: [quote] }])),
    lessons: [{ principle: '问题回应结构', application: '用于实践交流', caveat: '不移植其他文章的活动事实', evidence: [quote] }],
    seriesCandidates: [{ name: '观察计划', confidence: 0.9, evidence: ['观察计划'] }],
    related: candidates.slice(0, 1).map(other => ({ articleId: other.id, kind: 'writing_pattern', summary: '两篇均以问题引入行动，适用于实践活动叙述。', ownEvidence: [quote], otherEvidence: [quote] })) };
}
async function main() {
  const mysql = require('mysql2/promise');
  administration = await mysql.createConnection({ socketPath: path.resolve(__dirname, '../../../.local/news-live-backend-20261025/mysql.sock'),
    user: 'root', password: settings.rootPassword });
  await administration.query(`CREATE DATABASE ${testDatabase} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await administration.query(`GRANT ALL ON ${testDatabase}.* TO 'news_sandbox'@'127.0.0.1'`);
  const migration = await mysql.createConnection({ host: '127.0.0.1', port: 13362, user: 'news_sandbox', password: settings.password,
    database: testDatabase, multipleStatements: true });
  try {
    await migration.query(fs.readFileSync(path.join(__dirname, 'migrations/20261025_001_wechat_monitor.sql'), 'utf8'));
    await migration.query('CREATE TABLE ai_jobs (id BIGINT PRIMARY KEY AUTO_INCREMENT,status VARCHAR(16) NOT NULL)');
    await migration.query('CREATE TABLE organizations (id BIGINT PRIMARY KEY)');
    await migration.query('CREATE TABLE organization_units (id BIGINT PRIMARY KEY,organization_id BIGINT NOT NULL,archived_at DATETIME NULL)');
    await migration.query('INSERT INTO organizations VALUES (?)', [workspace.orgId]);
    await migration.query('INSERT INTO organization_units (id,organization_id) VALUES (?,?)', [unitId, workspace.orgId]);
  } finally { await migration.end(); }
  const store = makeStore(pool, () => now);
  let worker, server, independentWorker;
  try {
    await store.bootstrap(workspace); await store.bootstrap(workspace);
    const initial = await store.overview(scope); assert.equal(initial.accounts.length, 2);
    assert.equal(initial.jobs.reduce((sum, item) => sum + Number(item.count), 0), 4, 'bootstrap is idempotent');
    assert.equal(initial.budget.limitTokens, null); assert.equal(initial.budget.paused, false);
    assert.equal(initial.budget.unlimited, true); assert.equal(initial.budget.resetAt, null);
    const account = await store.account(scope, initial.accounts[0].id);
    const calls = new Map(), execution = []; let publishedLater = false, articleFetches = 0;
    const workerOptions = { pool, clock: () => now, isLeader: () => true, canDispatch: () => true,
      fetchPage: async url => {
        calls.set(url, (calls.get(url) || 0) + 1);
        if (url.endsWith('/challenge')) throw content.invalid('SOURCE_VERIFICATION_REQUIRED', '测试验证页', 422);
        if (url.endsWith('/transient') && calls.get(url) === 1) throw Object.assign(Error('测试短时连接中断'), { code: 'ECONNRESET' });
        return url.includes('mp.weixin.qq.com') ? { finalUrl: url, html: fixtureArticle(url.endsWith('/two') ? 2 : url.endsWith('/transient') ? 3 : url.endsWith('/four') ? 4 : 1) }
          : { finalUrl: url, html: url.includes('news.hit.edu.cn')
            ? url.endsWith('/2026/1026/c11819a999999/page.htm') ? '<a href="https://mp.weixin.qq.com/s/four">新增微信文章</a>'
              : '<a href="https://mp.weixin.qq.com/s/one">一</a><a href="https://mp.weixin.qq.com/s/two">二</a>'
                + (publishedLater ? '<a href="/2026/1026/c11819a999999/page.htm">后来公布的详情页</a>' : '')
            : '<a href="/detail/test">测试目录</a>' };
      },
      analyze: async (article, candidates) => { execution.push('analyze'); return { analysis: learning.validateAnalysis(rawAnalysis(article, candidates), article, candidates),
        features: content.lexicalFeatures(article.title + article.text), tokens: 100 }; },
      summarize: async (group, members) => ({ summary: { summary: '测试：以问题组织活动叙事', patterns: [], differences: [], sampleCount: members.length,
        articleIds: members.map(item => item.id), corpusScope: 'collected_samples_only' }, fingerprint: learning.groupFingerprint(members), tokens: 100 }),
    };
    const fixtureFetch = workerOptions.fetchPage;
    workerOptions.fetchPage = async url => {
      assert.notEqual(new URL(url).hostname, 'mp.weixin.qq.com', 'article import must not use the directory crawler');
      return fixtureFetch(url);
    };
    workerOptions.fetchArticle = async url => { articleFetches++; execution.push('fetch'); return fixtureFetch(url); };
    worker = createWorker(workerOptions);
    await store.enqueueFetch(account, 'https://mp.weixin.qq.com/s/transient');
    await store.enqueueFetch(account, 'https://mp.weixin.qq.com/s/challenge');
    const engine2 = createWorker({ pool, clock: () => now, isLeader: () => true, canDispatch: () => true, fetchPage: async () => { throw Error('A second worker must not fetch while the lock is owned'); } });
    const ownedSourceLock = await require('../lib/job_lock').acquireJobLock(pool, `wechat-monitor:${testDatabase}:source`);
    const ownedLearningLock = await require('../lib/job_lock').acquireJobLock(pool, `wechat-monitor:${testDatabase}:learning`);
    assert.equal(await engine2.pump(), false); await ownedSourceLock.release(); await ownedLearningLock.release(); await engine2.stop();
    const pressurePaused = createWorker({ pool, isLeader: () => true, canDispatch: () => false });
    assert.equal(await pressurePaused.pump(), false); await pressurePaused.stop();
    for (let count = 0; count < 70; count++) {
      now += 20000; await worker.pump();
      const [[row]] = await pool.query("SELECT COUNT(*) AS count FROM wechat_monitor_jobs WHERE scope_key=? AND status IN ('pending','running','retry')", [scope]);
      if (!Number(row.count)) break;
    }
    const after = await store.overview(scope);
    assert.equal(after.accounts[0].articleCount, 3); assert.equal(after.accounts[0].analyzedCount, 3);
    assert.equal(after.accounts[0].restrictedFetches, 1, 'a successful directory check never hides restricted article fetches');
    assert.equal(after.accounts[0].identityVerified, true, 'two independent matching articles linked by the official site establish the account identifier');
    assert.equal(calls.get('https://mp.weixin.qq.com/s/transient'), 2, 'transient failures retry automatically');
    assert.equal(calls.get('https://mp.weixin.qq.com/s/challenge'), 1, 'verification challenges never loop');
    assert.ok(articleFetches >= 5, 'known article jobs use the shared reverse-import transport independently of directory discovery');
    assert.ok(execution.indexOf('analyze') < execution.lastIndexOf('fetch'), 'article analysis starts before the full backfill download queue is exhausted');
    const held = [];
    for (let i = 0; i < 31; i++) held.push(await store.enqueue(account, 'analyze', {}, `foreground-test-${i}`));
    const [foreground] = await pool.query("INSERT INTO ai_jobs (status) VALUES ('pending')");
    await store.enqueueFetch(account, 'https://mp.weixin.qq.com/s/foreground-safe'); now += 20000;
    await worker.pump();
    assert.equal(calls.get('https://mp.weixin.qq.com/s/foreground-safe'), 1, 'foreground writing pauses model work without 31 queued analyses hiding eligible downloads');
    await pool.query('DELETE FROM ai_jobs WHERE id=?', [foreground.insertId]);
    await pool.query('DELETE FROM wechat_monitor_jobs WHERE id IN (?)', [held]);
    const budgetProbe = await store.enqueue(account, 'analyze', {}, 'test-budget-probe');
    await pool.query("UPDATE wechat_monitor_jobs SET status='succeeded',finished_at=?,result=? WHERE id=?", [now, JSON.stringify({ tokens: 9000000 }), budgetProbe]);
    const usage = (await store.overview(scope)).budget;
    assert.equal(usage.paused, false, 'large recorded usage never pauses monitor dispatch');
    assert.equal(usage.unlimited, true); assert.ok(usage.usedTokens >= 9000000);
    publishedLater = true;
    await store.enqueue(account, 'discover', { url: 'https://news.hit.edu.cn/xxyw/list.htm', phase: 'live', page: 1 }, 'test-live-new-detail');
    for (let count = 0; count < 30; count++) {
      now += 20000; await worker.pump();
      const [[row]] = await pool.query("SELECT COUNT(*) AS count FROM wechat_monitor_jobs WHERE scope_key=? AND status IN ('pending','running','retry')", [scope]);
      if (!Number(row.count)) break;
    }
    assert.equal(calls.get('https://news.hit.edu.cn/2026/1026/c11819a999999/page.htm'), 1, 'live checks inspect newly published official detail links');
    assert.equal(calls.get('https://mp.weixin.qq.com/s/four'), 1, 'articles linked only from a new official detail page reach the import pipeline');
    assert.equal((await store.overview(scope)).accounts[0].articleCount, 4);
    await store.enqueue(account, 'discover', { url: 'https://news.hit.edu.cn/xxyw/list.htm', phase: 'live', page: 1 }, 'test-live-known-detail');
    now += 20000; await worker.pump();
    assert.equal(calls.get('https://news.hit.edu.cn/2026/1026/c11819a999999/page.htm'), 1, 'later directory checks do not refetch every historical detail page');
    const [blocked] = await pool.query("SELECT j.id,e.status FROM wechat_monitor_jobs j JOIN wechat_monitor_job_events e ON e.job_id=j.id WHERE j.scope_key=? AND j.status='blocked'", [scope]);
    assert.equal(blocked.length, 1);
    const [groups] = await pool.query('SELECT * FROM wechat_monitor_groups WHERE scope_key=?', [scope]);
    assert.ok(groups.some(group => group.kind === 'series' && group.summary));
    const [[rel]] = await pool.query('SELECT COUNT(*) AS count FROM wechat_monitor_relations WHERE scope_key=?', [scope]);
    assert.ok(Number(rel.count) >= 1);
    const [[original]] = await pool.query('SELECT id FROM wechat_monitor_articles WHERE account_id=? ORDER BY id LIMIT 1', [account.id]);
    const originalArticle = await store.article(scope, original.id);
    const [[interrupted]] = await pool.query("SELECT id FROM wechat_monitor_jobs WHERE scope_key=? AND kind='fetch' AND JSON_UNQUOTE(JSON_EXTRACT(payload,'$.url'))=? LIMIT 1",
      [scope, 'https://mp.weixin.qq.com/s/one']);
    await pool.query("UPDATE wechat_monitor_jobs SET status='running',attempts=1,started_at=?,finished_at=NULL,next_run_at=0 WHERE id=?", [now, interrupted.id]);
    await worker.stop(); worker = createWorker(workerOptions); now += 20000;
    assert.equal(await worker.pump(), true, 'a newly started worker reclaims persisted interrupted work after obtaining the database lock');
    const [[resumed]] = await pool.query('SELECT status,attempts FROM wechat_monitor_jobs WHERE id=?', [interrupted.id]);
    assert.equal(resumed.status, 'succeeded'); assert.equal(resumed.attempts, 2);
    assert.equal((await store.article(scope, original.id)).revisionId, originalArticle.revisionId, 'interrupted import recovery does not duplicate snapshots');
    const connection = await pool.getConnection();
    try { await makeStore(connection, () => now).saveArticle(account, content.parseArticle(fixtureArticle(1), 'https://mp.weixin.qq.com/s/one', account, now)); }
    finally { connection.release(); }
    assert.equal((await store.overview(scope)).accounts[0].articleCount, 4, 're-importing the same article never duplicates it');
    assert.equal((await store.article(scope, original.id)).revisionId, originalArticle.revisionId, 'unchanged content reuses its reverse snapshot');
    const transaction = await pool.getConnection();
    try {
      const broken = { beginTransaction: transaction.beginTransaction.bind(transaction), commit: transaction.commit.bind(transaction), rollback: transaction.rollback.bind(transaction),
        query: async (sql, params) => { if (sql.includes('INSERT IGNORE INTO wechat_monitor_jobs')) throw Error('SIMULATED_QUEUE_WRITE_FAILURE'); return transaction.query(sql, params); } };
      await assert.rejects(makeStore(broken, () => now).saveArticle(account,
        content.parseArticle(fixtureArticle(99), 'https://mp.weixin.qq.com/s/rollback', account, now)), /SIMULATED_QUEUE_WRITE_FAILURE/);
      assert.equal((await store.overview(scope)).accounts[0].articleCount, 4, 'article and its analysis job roll back together');
      const faultWorkspace = { ...workspace, unitId: unitId + 2 };
      await assert.rejects(makeStore(broken, () => now).bootstrap(faultWorkspace), /SIMULATED_QUEUE_WRITE_FAILURE/);
      assert.equal((await store.overview(scopeFor(faultWorkspace))).accounts.length, 0, 'target initialization and history tasks roll back together');
    } finally { transaction.release(); }
    await pool.query('UPDATE organization_units SET archived_at=NOW() WHERE id=?', [unitId]);
    await store.enqueueFetch(account, 'https://mp.weixin.qq.com/s/archived-space'); now += 20000;
    assert.equal(await worker.pump(), false); assert.equal(calls.has('https://mp.weixin.qq.com/s/archived-space'), false);
    await pool.query('UPDATE organization_units SET archived_at=NULL WHERE id=?', [unitId]);
    const app = express(); app.use(express.json());
    app.use('/api/wechat-monitor', createRouter({ pool, noWorker: true,
      requirePermission: (req, res, next) => req.get('x-test-user') ? next() : res.sendStatus(401),
      resolveWorkspace: async req => ({ ...workspace, unitId: req.get('x-test-space') === 'other' ? unitId + 1 : unitId,
        role: req.get('x-test-role') === 'member' ? 'member' : 'manager' }) }));
    server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}/api/wechat-monitor`;
    const call = (endpoint, options = {}) => fetch(base + endpoint, { ...options,
      headers: { 'Content-Type': 'application/json', 'x-test-user': '1', ...options.headers } });
    assert.equal((await fetch(base + '/overview')).status, 401);
    assert.equal((await call('/bootstrap', { method: 'POST', headers: { 'x-test-role': 'member' }, body: '{}' })).status, 403);
    assert.equal((await call('/accounts/' + account.id + '/check', { method: 'POST', headers: { 'x-test-space': 'other' }, body: '{}' })).status, 404);
    assert.equal((await call('/articles/' + original.id, { headers: { 'x-test-space': 'other' } })).status, 404);
    const list = await (await call('/articles')).json(); assert.equal(list.items.length, 4);
    assert.equal(list.items.every(item => item.analysisState === 'ready'), true);
    const detail = await (await call('/articles/' + original.id)).json(); assert.ok(detail.blocks.length); assert.equal(detail.analysis.scene, 'events');
    const revisionPath = `/articles/${original.id}/revisions/${originalArticle.revisionId}`;
    const historical = await (await call(revisionPath)).json();
    assert.equal(historical.revisionId, originalArticle.revisionId); assert.deepEqual(historical.blocks, originalArticle.blocks);
    assert.equal((await call(revisionPath, { headers: { 'x-test-space': 'other' } })).status, 404);
    const another = list.items.find(item => Number(item.id) !== Number(original.id));
    assert.equal((await call(`/articles/${another.id}/revisions/${originalArticle.revisionId}`)).status, 404);
    assert.equal(detail.identityStatus, 'biz_verified');
    assert.equal((await call('/accounts/' + account.id + '/reclassify', { method: 'POST', headers: { 'x-test-role': 'member' }, body: '{}' })).status, 403);
    assert.equal((await call('/accounts/' + account.id + '/reclassify', { method: 'POST', headers: { 'x-test-space': 'other' }, body: '{}' })).status, 404);
    const beforeRefresh = await store.article(scope, original.id);
    await pool.query('DELETE FROM wechat_monitor_memberships WHERE article_id=?', [original.id]);
    const rebuild = await call('/accounts/' + account.id + '/reclassify', { method: 'POST', body: '{}' });
    assert.equal(rebuild.status, 202);
    assert.equal((await rebuild.json()).queued, 4);
    assert.equal((await (await call('/accounts/' + account.id + '/reclassify', { method: 'POST', body: '{}' })).json()).queued, 0);
    for (let count = 0; count < 20; count++) { now += 20000; if (!await worker.pump()) break; }
    const afterRefresh = await store.article(scope, original.id);
    assert.equal(afterRefresh.analysis_id, beforeRefresh.analysis_id, 'derived grouping refresh does not rewrite the immutable model analysis');
    assert.deepEqual(afterRefresh.analysis, beforeRefresh.analysis);
    const [[restored]] = await pool.query('SELECT COUNT(*) count FROM wechat_monitor_memberships WHERE article_id=?', [original.id]);
    assert.equal(Number(restored.count), 2, 'saved scene and brand evidence rebuild memberships without new model calls');
    const numbered = [];
    for (const number of [7, 8]) {
      const title = `AI共创营（第${number - 6}期）测试资料`;
      const html = fixtureArticle(number).replace(/观察计划｜测试文章 \d+（集成测试合成资料）/, title);
      const imported = await store.saveArticle(account, content.parseArticle(html, `https://mp.weixin.qq.com/s/numbered-${number}`, account, now));
      const source = await store.article(scope, imported.articleId);
      const raw = rawAnalysis(source, []); raw.seriesCandidates = [{ name: 'AI共创营', confidence: 0.9, evidence: [title] }];
      const analyzed = learning.validateAnalysis(raw, source);
      analyzed.seriesCandidates[0].eligibleForGrouping = false; // Previously stored deterministic classification.
      await store.saveAnalysis(account, source, { analysis: analyzed, tokens: 0, features: {} }, 'test-fixture', 0);
      numbered.push(source);
    }
    const [[numberedGroup]] = await pool.query("SELECT id FROM wechat_monitor_groups WHERE scope_key=? AND name='AI共创营' AND account_id=?", [scope, account.id]);
    await pool.query('DELETE FROM wechat_monitor_memberships WHERE group_id=? AND article_id=?', [numberedGroup.id, numbered[0].id]);
    await store.refreshGroups(account, numbered[0].id);
    assert.equal((await store.groupMembers(scope, numberedGroup.id)).length, 2, 'old false eligibility flags do not prevent deterministic regrouping of numbered brands');
    for (let count = 0; count < 20; count++) { now += 20000; if (!await worker.pump()) break; }
    const [[summarizedNumbered]] = await pool.query('SELECT summary FROM wechat_monitor_groups WHERE id=?', [numberedGroup.id]);
    assert.ok(summarizedNumbered.summary);
    await pool.query('UPDATE wechat_monitor_articles SET published_at=? WHERE id=?', [numbered[0].published_at, numbered[1].id]);
    await store.refreshGroups(account, numbered[1].id);
    const [[sameDay]] = await pool.query('SELECT summary FROM wechat_monitor_groups WHERE id=?', [numberedGroup.id]);
    assert.equal(sameDay.summary, null, 'a series that loses independent publication days must not retain its old confirmed summary');
    const failedImport = await store.saveArticle(account, content.parseArticle(fixtureArticle(90), 'https://mp.weixin.qq.com/s/failed-analysis', account, now));
    await pool.query("UPDATE wechat_monitor_jobs SET status='failed',error_code='ANALYSIS_INVALID',error_message='测试：证据摘录超出限制' WHERE dedupe_key=?",
      [content.hash(`${account.id}:analyze:${failedImport.revisionId}:${content.PROTOCOL_VERSION}`)]);
    const failedDetail = await (await call('/articles/' + failedImport.articleId)).json();
    assert.equal(failedDetail.analysisState, 'failed', 'a terminal analysis failure must not be reported as still processing');
    assert.equal(failedDetail.analysisError.code, 'ANALYSIS_INVALID');
    const failedList = await (await call('/articles')).json();
    assert.equal(failedList.items.find(item => item.id === failedImport.articleId).analysisState, 'failed');
    assert.equal((await call('/accounts/' + account.id + '/import', { method: 'POST', body: JSON.stringify({ urls: ['https://evil.test/s/x'] }) })).status, 400);
    await pool.query('UPDATE wechat_monitor_accounts SET next_check_at=? WHERE scope_key=?', [now + 86400000, scope]);
    for (let count = 0; count < 100; count++) { now += 20000; if (!await worker.pump()) break; }
    await worker.stop();
    await store.saveArticle(account, content.parseArticle(fixtureArticle(91), 'https://mp.weixin.qq.com/s/delayed-analysis', account, now));
    await store.enqueueFetch(account, 'https://mp.weixin.qq.com/s/independent-source-92');
    await store.enqueueFetch(account, 'https://mp.weixin.qq.com/s/independent-source-93');
    let releaseModel, enteredModel, finishedImports, importsWhileModelHeld = 0;
    const modelGate = new Promise(resolve => { releaseModel = resolve; });
    const modelStarted = new Promise(resolve => { enteredModel = resolve; });
    const bothImported = new Promise(resolve => { finishedImports = resolve; });
    const within = async (promise, milliseconds, message) => {
      let timer;
      try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error(message)), milliseconds); })]); }
      finally { clearTimeout(timer); }
    };
    const wallStarted = Date.now();
    independentWorker = createWorker({ ...workerOptions, clock: () => now + (Date.now() - wallStarted) * 10,
      fetchArticle: async url => {
        if (/independent-source-9[23]$/.test(url)) {
          importsWhileModelHeld++;
          if (importsWhileModelHeld === 2) finishedImports();
          return { finalUrl: url, html: fixtureArticle(url.endsWith('92') ? 92 : 93) };
        }
        return workerOptions.fetchArticle(url);
      },
      analyze: async (article, candidates) => { enteredModel(); await modelGate; return workerOptions.analyze(article, candidates); },
    });
    try {
      independentWorker.start();
      await within(modelStarted, 2000, 'the autonomous learning worker must start the held model request');
      const competingLearning = createWorker({ ...workerOptions, clock: () => now + (Date.now() - wallStarted) * 10,
        analyze: async () => { throw Error('a second learning worker must not duplicate the held model request'); } });
      try { assert.equal(await competingLearning.pumpLearning(), false, 'the model lane remains exclusive across worker instances'); }
      finally { await competingLearning.stop(); }
      await within(bothImported, 8000, 'a held AI request must not stop two autonomous source imports');
      assert.equal(importsWhileModelHeld, 2);
    } finally { releaseModel(); await independentWorker.stop(); independentWorker = null; }
    const [[independentCount]] = await pool.query('SELECT COUNT(*) count FROM wechat_monitor_articles WHERE scope_key=? AND title IN (?,?)',
      [scope, '观察计划｜测试文章 92（集成测试合成资料）', '观察计划｜测试文章 93（集成测试合成资料）']);
    assert.equal(Number(independentCount.count), 2, 'autonomous source jobs persist articles while model work is blocked');
    const originalNumber = Number(originalArticle.title.match(/测试文章 (\d+)/)?.[1]);
    assert.ok(originalNumber, 'the fixture article has a known number');
    const changed = fixtureArticle(originalNumber).replace('讲述从一个问题开始', '新版本更新了现场说明');
    const changedArticle = await store.saveArticle(account, content.parseArticle(changed, originalArticle.source_url, account, now));
    assert.notEqual(changedArticle.revisionId, originalArticle.revisionId);
    const oldVersion = await (await call(`/articles/${original.id}/revisions/${originalArticle.revisionId}`)).json();
    assert.deepEqual(oldVersion.blocks, originalArticle.blocks, 'preview uses the generation-time revision after the source changes');
    assert.notDeepEqual((await (await call(`/articles/${original.id}`)).json()).blocks, oldVersion.blocks);
    const [events] = await pool.query('SELECT COUNT(*) AS count FROM wechat_monitor_job_events e JOIN wechat_monitor_jobs j ON j.id=e.job_id WHERE j.scope_key=?', [scope]);
    assert.ok(events[0].count > 5);
    console.log(JSON.stringify({ passed: true, database: testDatabase, productionChanged: false,
      idempotentBootstrap: true, snapshots: true, transientRetry: true, verificationStop: true, distributedLock: true,
      detailedLearning: true, relatedArticles: true, seriesAndScenes: true, workspaceIsolation: true, administratorControls: true,
      atomicQueueAndArticle: true, atomicInitialization: true, archivedSpaceSuspendsWork: true,
      liveDetailDiscovery: true, knownDetailDeduplication: true, interruptedWorkerRecovery: true, autonomousCollectionDuringModelWait: true }));
  } finally {
    await independentWorker?.stop();
    await worker?.stop();
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    await pool.end();
    await cleanupDatabase();
  }
}
let administration;
async function cleanupDatabase() {
  if (!administration) return;
  const db = administration; administration = null;
  try {
    if (!/^mamage_wechat_monitor_test_[0-9a-f]{12}$/.test(testDatabase)) throw Error('Refusing cleanup outside the disposable test database');
    await db.query(`REVOKE ALL ON ${testDatabase}.* FROM 'news_sandbox'@'127.0.0.1'`);
    await db.query(`DROP DATABASE ${testDatabase}`);
  } finally { await db.end(); }
}
main().catch(async error => { console.error(error.stack); process.exitCode = 1; await pool.end().catch(() => {}); await cleanupDatabase(); });
