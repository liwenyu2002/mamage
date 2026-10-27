const { acquireJobLock } = require('./job_lock');
const { makeStore } = require('./wechat_monitor_store');
const { parsed, parseArticle, invalid, PROTOCOL_VERSION } = require('./wechat_monitor_content');
const discovery = require('./wechat_monitor_discovery');
const learning = require('./wechat_monitor_learning');

const BLOCKED = new Set(['SOURCE_VERIFICATION_REQUIRED', 'SOURCE_ROBOTS_DISALLOWED', 'SOURCE_POLICY_DISALLOWED',
  'SOURCE_LINK_REQUIRES_BROWSER', 'ACCOUNT_MISMATCH', 'PUBLICATION_DATE_UNKNOWN', 'PUBLICATION_DATE_INVALID', 'ARTICLE_TEXT_INSUFFICIENT',
  'SOURCE_FORMAT_CHANGED', 'SOURCE_REDIRECT_REJECTED', 'ACCOUNT_SOURCE_MISMATCH', 'ARTICLE_ANALYSIS_TOO_LONG', 'GROUP_ANALYSIS_TOO_LONG',
  'PRIVATE_ADDRESS', 'INVALID_SOURCE_URL', 'SOURCE_TOO_LARGE', 'SOURCE_ACCESS_DENIED', 'ARTICLE_METADATA_INCOMPLETE']);
const TERMINAL = new Set(['ARTICLE_UNAVAILABLE', 'BEFORE_HISTORY_START', 'INVALID_ARTICLE_URL', 'INVALID_DISCOVERY_URL', 'ARTICLE_TOO_LARGE', 'SOURCE_NOT_FOUND', 'ANALYSIS_INVALID', 'ANALYSIS_UNGROUNDED', 'ANALYSIS_INCONSISTENT']);
function retryPlan(error, attempts, now) {
  if (error.code === 'BEFORE_HISTORY_START') return { status: 'skipped', at: now };
  if (BLOCKED.has(error.code)) return { status: 'blocked', at: now };
  if (TERMINAL.has(error.code) || attempts >= 5) return { status: 'failed', at: now };
  return { status: 'retry', at: now + Math.max(error.retryAfter || 0, Math.min(3600000, 30000 * 4 ** Math.max(0, attempts - 1))) };
}
function safeErrorMessage(error) {
  return String((error.message || '监控处理失败') + (error.field ? ` [${error.field}]` : '')).replace(/https?:\/\/\S+/g, '[source-url]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]').replace(/sk-[A-Za-z0-9_-]{8,}/g, '[redacted-key]').slice(0, 1600);
}
function createWorker(dependencies) {
  const { pool } = dependencies, clock = dependencies.clock || Date.now;
  const fetchPage = dependencies.fetchPage || discovery.fetchPage;
  const fetchArticle = dependencies.fetchArticle || dependencies.fetchPage || require('./wechat_article_source').fetchWechatArticleHtml;
  const analyze = dependencies.analyze || learning.analyzeArticle, summarize = dependencies.summarize || learning.summarizeGroup;
  const canDispatch = dependencies.canDispatch || require('./background_capacity').createDispatchGuard().canDispatch;
  const isLeader = dependencies.isLeader || (() => !require('./distributed_runtime').distributed() || require('./distributed_runtime').coordinator.isLeader());
  const lockPrefix = `wechat-monitor:${process.env.DB_NAME || 'default'}`;
  const pumping = new Set();
  let stopped = false, ticker = null;
  const runJob = async (db, store, row, job, payload) => {
    if (job.kind === 'discover') {
      const page = await fetchPage(payload.url);
      const found = discovery.parseOfficialIndex(page.html, page.finalUrl, row.account_key);
      for (const item of found.articles) await store.enqueueFetch(row, item.url, item);
      // A bounded page job is durable; history traversal never relies on process memory.
      const maxDepth = Math.max(10, Math.min(2000, Number(process.env.WECHAT_MONITOR_MAX_DEPTH) || 600));
      // Live indexes can introduce new detail URLs; the shared history key skips already inspected pages.
      if (payload.page < maxDepth) {
        for (const url of found.pages) await store.enqueue(row, 'discover', { url, phase: 'history', page: payload.page + 1 }, `history:${url}`);
      }
      await db.query('UPDATE wechat_monitor_accounts SET last_checked_at = ?,state = ?,last_error = NULL WHERE id = ?', [clock(), 'watching', row.id]);
      return { discovered: found.articles.length, linkedPages: found.pages.length,
        depthLimitReached: payload.page >= maxDepth && found.pages.length > 0, coverage: found.coverage };
    }
    if (job.kind === 'fetch') {
      const page = await fetchArticle(payload.url);
      const article = parseArticle(page.html, page.finalUrl, row, clock());
      article.metadata.provenance = { sourceKind: payload.discovered?.sourceKind || 'manual_wechat_url', transport: 'shared_reverse_import',
        discoveryUrl: payload.discovered?.discoveryUrl || null };
      return store.saveArticle(row, article);
    }
    if (job.kind === 'regroup') return store.refreshGroups(row, payload.articleId);
    if (job.kind === 'analyze') {
      const source = await store.article(row.scope_key, payload.articleId, payload.revisionId);
      if (Number(source.current_revision_id) !== source.revisionId) return { superseded: true };
      const [[existing]] = await db.query('SELECT id FROM wechat_monitor_analyses WHERE revision_id = ? AND protocol_version = ?', [source.revisionId, PROTOCOL_VERSION]);
      if (existing) return { reused: Number(existing.id) };
      if (source.text.length > 45000) throw invalid('ARTICLE_ANALYSIS_TOO_LONG', '长文需要分段研究流程，未静默截断全文', 422);
      const candidates = learning.selectCandidates(source, await store.candidates(row.scope_key, source.id, source.title));
      const bounded = []; let remaining = 100000 - source.text.length;
      for (const item of candidates) { if (item.text.length > remaining) continue; remaining -= item.text.length; bounded.push(item); }
      const started = clock();
      const result = await analyze(source, bounded);
      await store.saveAnalysis(row, source, result, process.env.AI_NEWS_MODEL || process.env.AI_TEXT_MODEL || 'configured-text-model', clock() - started);
      if (dependencies.recordTokens) await dependencies.recordTokens(row.org_id, result.tokens);
      return { articleId: source.id, tokens: result.tokens, related: result.analysis.related.length };
    }
    if (job.kind === 'summarize') {
      const [[group]] = await db.query('SELECT * FROM wechat_monitor_groups WHERE id = ? AND scope_key = ?', [payload.groupId, row.scope_key]);
      if (!group) return { removed: true };
      const all = await store.groupMembers(row.scope_key, group.id), members = all.slice(0, 8);
      const independentDates = new Set(members.map(member => new Date(Number(member.published_at) + 8 * 3600000).toISOString().slice(0, 10)));
      if (members.length < 2 || group.kind === 'series' && independentDates.size < 2) return { candidateOnly: true };
      const fingerprint = learning.groupFingerprint(members);
      if (group.summary_fingerprint === fingerprint) return { reused: true };
      if (members.reduce((sum, member) => sum + member.text.length, 0) > 120000) throw invalid('GROUP_ANALYSIS_TOO_LONG', '群组长文需要分批研究，未截断证据', 422);
      const result = await summarize(group, members);
      // New articles may arrive while the model is running; stale summaries stay identifiable by fingerprint.
      if (result && learning.groupFingerprint((await store.groupMembers(row.scope_key, group.id)).slice(0, 8)) === result.fingerprint) {
        await db.query('UPDATE wechat_monitor_groups SET summary = ?,summary_fingerprint = ? WHERE id = ? AND scope_key = ?',
          [JSON.stringify(result.summary), result.fingerprint, group.id, row.scope_key]);
      }
      if (result && dependencies.recordTokens) await dependencies.recordTokens(row.org_id, result.tokens);
      return { groupId: group.id, tokens: result?.tokens || 0, sampleCount: members.length };
    }
    throw invalid('UNKNOWN_MONITOR_JOB', '未知监控任务类型', 422);
  };
  const pumpLane = async lane => {
    if (pumping.has(lane) || stopped || !isLeader() || !canDispatch()) return false;
    pumping.add(lane);
    let lock;
    try {
      lock = await (dependencies.acquireLock || acquireJobLock)(pool, `${lockPrefix}:${lane}`);
      if (!lock) return false;
      const db = lock.connection, store = makeStore(db, clock);
      let allowAnalysis = false;
      if (lane === 'source') await store.schedule();
      else {
        const [[foreground]] = await db.query("SELECT COUNT(*) AS count FROM ai_jobs WHERE status IN ('pending','running')");
        allowAnalysis = Number(foreground.count) === 0;
      }
      const [pending] = await db.query(`SELECT j.* FROM wechat_monitor_jobs j
        JOIN wechat_monitor_accounts a ON a.id = j.account_id JOIN organizations o ON o.id=a.org_id
        LEFT JOIN organization_units u ON u.id=a.unit_id AND u.organization_id=a.org_id
        WHERE a.enabled = 1 AND j.status IN ('pending','retry','running') AND j.next_run_at <= ?
          AND (a.unit_id IS NULL OR (u.id IS NOT NULL AND u.archived_at IS NULL))
          AND j.kind IN (${lane === 'source' ? "'discover','fetch'" : "'analyze','summarize','regroup'"})
          AND (? OR j.kind NOT IN ('analyze','summarize'))
        ORDER BY CASE WHEN j.kind='discover' AND JSON_EXTRACT(j.payload,'$.page')=1 THEN 0
          WHEN j.kind IN ('analyze','regroup') THEN 1 WHEN j.kind='fetch' THEN 2 WHEN j.kind='summarize' THEN 3 ELSE 4 END,j.id LIMIT 30`, [clock(), allowAnalysis]);
      const chosen = pending[0];
      if (!chosen || stopped) return false;
      const row = await store.account(chosen.scope_key, chosen.account_id), payload = parsed(chosen.payload, {});
      if (['discover', 'fetch'].includes(chosen.kind)) {
        const [[last]] = await db.query('SELECT MAX(last_request_at) AS last_request FROM wechat_monitor_accounts');
        const interval = Math.max(5000, Number(process.env.WECHAT_MONITOR_FETCH_INTERVAL_MS) || 15000);
        if (Number(last.last_request) + interval > clock()) {
          await db.query('UPDATE wechat_monitor_jobs SET next_run_at = ? WHERE id = ?', [Number(last.last_request) + interval, chosen.id]); return false;
        }
        await db.query('UPDATE wechat_monitor_accounts SET last_request_at = ? WHERE id = ?', [clock(), row.id]);
      }
      await db.query("UPDATE wechat_monitor_jobs SET status='running',attempts=attempts+1,started_at=? WHERE id=?", [clock(), chosen.id]);
      const attempts = Number(chosen.attempts) + 1;
      let acquiredQuota = false;
      try {
        if (['analyze', 'summarize'].includes(chosen.kind) && dependencies.acquireQuota) { await dependencies.acquireQuota(); acquiredQuota = true; }
        const result = await runJob(db, store, row, chosen, payload);
        await lock.assertOwned();
        await db.query("UPDATE wechat_monitor_jobs SET status='succeeded',finished_at=?,result=?,error_code=NULL,error_message=NULL WHERE id=?",
          [clock(), JSON.stringify(result), chosen.id]);
        await db.query('INSERT INTO wechat_monitor_job_events (job_id,attempt,status,created_at) VALUES (?,?,?,?)', [chosen.id, attempts, 'succeeded', clock()]);
        return true;
      } catch (error) {
        await lock.assertOwned();
        const plan = retryPlan(error, attempts, clock()), message = safeErrorMessage(error);
        await db.query('UPDATE wechat_monitor_jobs SET status=?,next_run_at=?,finished_at=?,error_code=?,error_message=? WHERE id=?',
          [plan.status, plan.at, clock(), String(error.code || error.name || 'MONITOR_FAILED').slice(0, 64), message, chosen.id]);
        await db.query('INSERT INTO wechat_monitor_job_events (job_id,attempt,status,error_code,error_message,created_at) VALUES (?,?,?,?,?,?)',
          [chosen.id, attempts, plan.status, String(error.code || error.name || 'MONITOR_FAILED').slice(0, 64), message, clock()]);
        await db.query('UPDATE wechat_monitor_accounts SET last_error = ? WHERE id = ?', [message, row.id]);
        return true;
      } finally { if (acquiredQuota) dependencies.releaseQuota?.(); }
    } finally { try { await lock?.release(); } finally { pumping.delete(lane); } }
  };
  const pumpSources = () => pumpLane('source'), pumpLearning = () => pumpLane('learning');
  const pump = async () => { const collected = await pumpSources(); return await pumpLearning() || collected; };
  const wake = () => {
    // Source I/O and model I/O own separate locks; one stalled model cannot hold the collector.
    for (const lane of ['source', 'learning']) void pumpLane(lane).catch(error => console.error('[wechat-monitor]', lane, error.code || error.name || 'FAILED'));
  };
  const start = () => { if (ticker || stopped) return; ticker = setInterval(wake, 5000); ticker.unref?.(); wake(); };
  const stop = async () => { stopped = true; clearInterval(ticker); await require('./runtime_lifecycle').waitForIdle(() => pumping.size === 0); };
  return { start, stop, pump, pumpSources, pumpLearning };
}
let instance;
function worker() {
  if (!instance) {
    const quota = require('./ai_quota');
    instance = createWorker({ pool: require('../db').pool, acquireQuota: quota.acquire, releaseQuota: quota.release, recordTokens: quota.recordTokens });
  }
  return instance;
}
module.exports = { createWorker, retryPlan, safeErrorMessage,
  start: () => { if (process.env.WECHAT_MONITOR_ENABLED === '1') worker().start(); },
  stop: () => instance?.stop(), pump: () => worker().pump() };
