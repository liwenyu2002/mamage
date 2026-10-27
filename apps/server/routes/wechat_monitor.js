const express = require('express');
const { pool } = require('../db');
const { requirePermission } = require('../lib/permissions');
const { resolveWorkspace, sendWorkspaceError } = require('../lib/workspace_access');
const { workspacePolicy } = require('../lib/access_policy');
const { makeStore, scopeFor, analysisStateFor } = require('../lib/wechat_monitor_store');
const { PRESETS, SCENES, PROTOCOL_VERSION, canonicalUrl, parsed, invalid } = require('../lib/wechat_monitor_content');
const learning = require('../lib/wechat_monitor_learning');

function createRouter(dependencies = {}) {
  const db = dependencies.pool || pool, router = express.Router(), store = makeStore(db);
  router.use(dependencies.requirePermission || requirePermission('ai.generate'));
  router.use(async (req, res, next) => {
    try { req.monitorWorkspace = await (dependencies.resolveWorkspace || resolveWorkspace)(req); req.monitorScope = scopeFor(req.monitorWorkspace); next(); }
    catch (error) { next(error); }
  });
  const write = (req, _res, next) => workspacePolicy(req.monitorWorkspace).canManageMembers
    ? next() : next(invalid('MONITOR_ADMIN_REQUIRED', '仅管理员可调整采集与后台任务', 403));
  const wrap = run => (req, res, next) => Promise.resolve(run(req, res)).catch(next);
  const id = value => { const number = Number(value); if (!Number.isSafeInteger(number) || number < 1) throw invalid('INVALID_ID', '编号无效'); return number; };
  const wake = () => { if (!dependencies.noWorker) require('../lib/wechat_monitor_worker').start(); };
  router.get('/overview', wrap(async (req, res) => {
    res.json({ ...await store.overview(req.monitorScope), canManage: workspacePolicy(req.monitorWorkspace).canManageMembers,
      engineEnabled: process.env.WECHAT_MONITOR_ENABLED === '1', dimensions: learning.DIMENSIONS,
      presets: PRESETS.map(item => ({ key: item.key, name: item.name, since: item.since, indexes: item.indexes, identityEvidence: item.identityEvidence })) });
  }));
  router.post('/bootstrap', write, wrap(async (req, res) => { await store.bootstrap(req.monitorWorkspace); wake(); res.status(202).json({ initialized: true }); }));
  router.patch('/accounts/:id', write, wrap(async (req, res) => {
    const row = await store.account(req.monitorScope, id(req.params.id)), body = req.body || {};
    if (Object.keys(body).some(key => !['enabled', 'intervalSeconds'].includes(key)) || !Object.keys(body).length) throw invalid('INVALID_CONFIG', '监控设置无效');
    if (body.enabled !== undefined && typeof body.enabled !== 'boolean') throw invalid('INVALID_CONFIG', '启用状态无效');
    const interval = body.intervalSeconds ?? row.interval_seconds;
    if (!Number.isSafeInteger(interval) || interval < 1800 || interval > 86400) throw invalid('INVALID_INTERVAL', '检查间隔应在 30 分钟至 24 小时之间');
    await db.query('UPDATE wechat_monitor_accounts SET enabled=?,interval_seconds=?,next_check_at=0 WHERE id=?', [body.enabled ?? Boolean(row.enabled), interval, row.id]);
    wake(); res.json({ updated: true });
  }));
  router.post('/accounts/:id/check', write, wrap(async (req, res) => {
    const row = await store.account(req.monitorScope, id(req.params.id));
    for (const url of PRESETS.find(preset => preset.key === row.account_key).indexes) await store.enqueue(row, 'discover',
      { url, phase: 'live', page: 1 }, `manual:${url}:${Math.floor(Date.now() / 60000)}`);
    wake(); res.status(202).json({ queued: true });
  }));
  router.post('/accounts/:id/reclassify', write, wrap(async (req, res) => {
    const row = await store.account(req.monitorScope, id(req.params.id));
    const [inserted] = await db.query(`INSERT IGNORE INTO wechat_monitor_jobs (scope_key,account_id,kind,dedupe_key,payload,next_run_at)
      SELECT a.scope_key,a.account_id,'regroup',SHA2(CONCAT(a.account_id,':regroup:',a.current_analysis_id,':',?),256),
        JSON_OBJECT('articleId',a.id),? FROM wechat_monitor_articles a
      JOIN wechat_monitor_analyses n ON n.id=a.current_analysis_id AND n.revision_id=a.current_revision_id
      WHERE a.scope_key=? AND a.account_id=? ORDER BY a.id`, [learning.SERIES_RULES_VERSION, Date.now(), req.monitorScope, row.id]);
    const [[ready]] = await db.query(`SELECT COUNT(*) count FROM wechat_monitor_articles a
      JOIN wechat_monitor_analyses n ON n.id=a.current_analysis_id AND n.revision_id=a.current_revision_id
      WHERE a.scope_key=? AND a.account_id=?`, [req.monitorScope, row.id]);
    wake(); res.status(202).json({ queued: inserted.affectedRows, duplicates: Math.max(0, Number(ready.count) - inserted.affectedRows),
      rulesVersion: learning.SERIES_RULES_VERSION });
  }));
  router.post('/accounts/:id/import', write, wrap(async (req, res) => {
    const row = await store.account(req.monitorScope, id(req.params.id));
    if (!Array.isArray(req.body?.urls) || !req.body.urls.length || req.body.urls.length > 100
      || req.body.urls.some(value => typeof value !== 'string' || value.length > 6000)) throw invalid('INVALID_URLS', '每次可导入 1–100 个微信原文链接');
    const urls = [...new Set(req.body.urls.map(canonicalUrl))]; let queued = 0;
    for (const url of urls) if (await store.enqueueFetch(row, url)) queued++;
    wake(); res.status(202).json({ queued, duplicates: urls.length - queued });
  }));
  router.get('/articles', wrap(async (req, res) => {
    const page = Math.min(10000, Math.max(1, Number(req.query.page) || 1));
    const clauses = ['a.scope_key=?'], params = [req.monitorScope];
    if (req.query.accountId) { clauses.push('a.account_id=?'); params.push(id(req.query.accountId)); }
    if (req.query.scene) { if (!Object.hasOwn(SCENES, req.query.scene)) throw invalid('INVALID_SCENE', '场景无效'); clauses.push('n.scene=?'); params.push(req.query.scene); }
    if (req.query.q) { clauses.push('a.title LIKE ?'); params.push('%' + String(req.query.q).slice(0, 100).replace(/[\\%_]/g, '\\$&') + '%'); }
    const [rows] = await db.query(`SELECT a.id,a.account_id,a.title,a.author,a.source_url,a.published_at,a.identity_status,a.current_revision_id,
      n.revision_id AS analyzed_revision_id,n.scene,n.analysis,j.status AS analysis_job_status FROM wechat_monitor_articles a
      LEFT JOIN wechat_monitor_analyses n ON n.id=a.current_analysis_id
      LEFT JOIN wechat_monitor_jobs j ON j.scope_key=a.scope_key AND j.dedupe_key=SHA2(CONCAT(a.account_id,':analyze:',a.current_revision_id,':',?),256)
      WHERE ${clauses.join(' AND ')} ORDER BY a.published_at DESC,a.id DESC LIMIT 31 OFFSET ?`, [PROTOCOL_VERSION, ...params, (Math.floor(page) - 1) * 30]);
    res.json({ items: rows.slice(0, 30).map(row => ({ id: Number(row.id), accountId: Number(row.account_id), title: row.title,
      author: row.author, sourceUrl: row.source_url, publishedAt: Number(row.published_at), scene: row.scene,
      summary: parsed(row.analysis)?.summary || '', analysisState: analysisStateFor(row, row.analysis_job_status), identityStatus: row.identity_status })), hasMore: rows.length > 30 });
  }));
  router.get('/articles/:id/revisions/:revisionId', wrap(async (req, res) => {
    const source = await store.article(req.monitorScope, id(req.params.id), id(req.params.revisionId));
    res.set('Cache-Control', 'private, no-store').json({ id: source.id, title: source.title, author: source.author,
      sourceUrl: source.source_url, revisionId: source.revisionId, blocks: source.blocks });
  }));
  router.get('/articles/:id', wrap(async (req, res) => {
    const source = await store.article(req.monitorScope, id(req.params.id));
    const [relations] = await db.query(`SELECT r.*,a.title AS low_title,b.title AS high_title FROM wechat_monitor_relations r
      JOIN wechat_monitor_articles a ON a.id=r.article_low AND a.current_revision_id=r.revision_low
      JOIN wechat_monitor_articles b ON b.id=r.article_high AND b.current_revision_id=r.revision_high
      WHERE r.scope_key=? AND (r.article_low=? OR r.article_high=?)`, [req.monitorScope, source.id, source.id]);
    res.json({ id: source.id, accountId: Number(source.account_id), title: source.title, author: source.author,
      publishedAt: Number(source.published_at), sourceUrl: source.source_url, identityStatus: source.identity_status,
      revisionId: source.revisionId, blocks: source.blocks, text: source.text, styleBlocks: source.styleBlocks,
      visualFeatures: source.visualFeatures, metadata: parsed(source.metadata), analysis: source.analysis, analysisState: source.analysisState,
      analysisError: source.analysisError,
      relations: relations.map(row => ({ id: Number(row.article_low) === source.id ? Number(row.article_high) : Number(row.article_low),
        title: Number(row.article_low) === source.id ? row.high_title : row.low_title, similarity: row.similarity,
        summary: row.summary, evidence: parsed(row.evidence) })) });
  }));
  router.get('/groups', wrap(async (req, res) => {
    const [rows] = await db.query(`SELECT g.*,COUNT(DISTINCT r.content_hash) AS member_count,
      COUNT(DISTINCT FLOOR((a.published_at+28800000)/86400000)) AS date_count FROM wechat_monitor_groups g
      JOIN wechat_monitor_memberships m ON m.group_id=g.id
      JOIN wechat_monitor_articles a ON a.id=m.article_id AND a.current_revision_id=m.revision_id
      JOIN wechat_monitor_revisions r ON r.id=m.revision_id
      WHERE g.scope_key=? GROUP BY g.id ORDER BY member_count DESC,g.id DESC LIMIT 200`, [req.monitorScope]);
    res.json({ items: rows.map(row => ({ id: Number(row.id), kind: row.kind, name: row.name, count: Number(row.member_count),
      state: Number(row.member_count) < 2 || row.kind === 'series' && Number(row.date_count) < 2 ? 'candidate' : 'supported',
      summary: parsed(row.summary), accountId: row.account_id ? Number(row.account_id) : null })) });
  }));
  router.get('/groups/:id', wrap(async (req, res) => {
    const [[group]] = await db.query('SELECT * FROM wechat_monitor_groups WHERE scope_key=? AND id=?', [req.monitorScope, id(req.params.id)]);
    if (!group) throw invalid('MONITOR_NOT_FOUND', '分类不存在', 404);
    const members = await store.groupMembers(req.monitorScope, group.id);
    const days = new Set(members.map(member => new Date(Number(member.published_at) + 8 * 3600000).toISOString().slice(0, 10)));
    res.json({ id: Number(group.id), kind: group.kind, name: group.name, count: members.length, summary: parsed(group.summary),
      state: members.length < 2 || group.kind === 'series' && days.size < 2 ? 'candidate' : 'supported',
      summaryCurrent: group.summary_fingerprint === learning.groupFingerprint(members.slice(0, 8)),
      members: members.map(row => ({ id: row.id, title: row.title, publishedAt: Number(row.published_at) })) });
  }));
  router.get('/jobs', wrap(async (req, res) => {
    const params = [req.monitorScope], where = ['j.scope_key=?'];
    if (req.query.accountId) { where.push('j.account_id=?'); params.push(id(req.query.accountId)); }
    if (req.query.status) {
      if (!['pending', 'running', 'retry', 'succeeded', 'blocked', 'failed', 'skipped'].includes(req.query.status)) throw invalid('INVALID_STATUS', '任务状态无效');
      where.push('j.status=?'); params.push(req.query.status);
    }
    if (req.query.before) { where.push('j.id<?'); params.push(id(req.query.before)); }
    const [rows] = await db.query(`SELECT j.id,j.account_id,j.kind,j.status,j.attempts,j.next_run_at,j.error_code,j.error_message,j.result,j.created_at,j.payload
      FROM wechat_monitor_jobs j WHERE ${where.join(' AND ')} ORDER BY j.id DESC LIMIT 51`, params);
    res.json({ items: rows.slice(0, 50).map(row => { let sourceOrigin = null;
      try { sourceOrigin = new URL(parsed(row.payload, {}).url).origin; } catch { /* Analysis jobs have no remote source. */ }
      return { id: Number(row.id), accountId: Number(row.account_id), kind: row.kind, status: row.status,
      attempts: row.attempts, nextRunAt: Number(row.next_run_at), errorCode: row.error_code, error: row.error_message,
      sourceOrigin, result: parsed(row.result), createdAt: row.created_at }; }), hasMore: rows.length > 50 });
  }));
  router.get('/jobs/:id/events', wrap(async (req, res) => {
    const [items] = await db.query(`SELECT e.attempt,e.status,e.error_code AS errorCode,e.error_message AS error,e.created_at AS createdAt
      FROM wechat_monitor_job_events e JOIN wechat_monitor_jobs j ON j.id=e.job_id
      WHERE j.scope_key=? AND j.id=? ORDER BY e.id DESC LIMIT 50`, [req.monitorScope, id(req.params.id)]);
    res.json({ items });
  }));
  router.post('/jobs/:id/retry', write, wrap(async (req, res) => {
    const [updated] = await db.query(`UPDATE wechat_monitor_jobs SET status='pending',next_run_at=0,attempts=0 WHERE scope_key=? AND id=?
      AND status IN ('failed','blocked')`, [req.monitorScope, id(req.params.id)]);
    if (!updated.affectedRows) throw invalid('MONITOR_JOB_NOT_RETRYABLE', '任务不存在或仍在执行', 409);
    wake(); res.status(202).json({ queued: true });
  }));
  router.use((error, _req, res, _next) => {
    if (sendWorkspaceError(res, error)) return;
    if (error.code === 'ER_NO_SUCH_TABLE') return res.status(503).json({ error: 'MONITOR_MIGRATION_REQUIRED', message: '推文监控数据库尚未初始化' });
    if (!error.status) console.error('[wechat-monitor-route]', error.code || error.name || 'FAILED');
    res.status(error.status || 500).json({ error: error.code || 'MONITOR_REQUEST_FAILED', message: error.status ? error.message : '推文监控请求失败，请稍后重试' });
  });
  return router;
}
module.exports = createRouter();
module.exports.createRouter = createRouter;
