const { PRESETS, SCENES, PROTOCOL_VERSION, parsed, hash, invalid } = require('./wechat_monitor_content');
const { historicalWindows, searchUrl } = require('./wechat_monitor_discovery');
const { groupFingerprint, seriesEligible } = require('./wechat_monitor_learning');

function scopeFor(workspace) {
  if (!workspace.orgId || workspace.enabled && !workspace.unitId) throw invalid('MONITOR_SPACE_REQUIRED', '请先选择小组空间', 403);
  return `${workspace.orgId}:${workspace.unitId || 0}`;
}
function analysisStateFor(row, jobStatus) {
  if (row.analyzed_revision_id) return Number(row.analyzed_revision_id) === Number(row.current_revision_id) ? 'ready' : 'stale';
  return ['failed', 'blocked', 'retry', 'running'].includes(jobStatus) ? jobStatus : 'pending';
}
function makeStore(db, clock = Date.now) {
  const modelBudget = async () => {
    const day = new Date(clock() + 8 * 3600000).toISOString().slice(0, 10);
    const startsAt = Date.parse(day + 'T00:00:00+08:00');
    const [[row]] = await db.query("SELECT COALESCE(SUM(COALESCE(JSON_EXTRACT(IF(JSON_VALID(result),result,'{}'),'$.tokens'),0)),0) AS tokens FROM wechat_monitor_jobs WHERE status='succeeded' AND finished_at >= ?", [startsAt]);
    // Retain usage accounting and the existing API shape, but never impose an allowance.
    return { usedTokens: Number(row.tokens) || 0, limitTokens: null, resetAt: null, paused: false, unlimited: true };
  };
  const onConnection = async (method, args) => {
    const connection = await db.getConnection();
    try { return await makeStore(connection, clock)[method](...args); } finally { connection.release(); }
  };
  const enqueue = async (account, kind, payload, key, at = clock()) => {
    const [result] = await db.query(`INSERT IGNORE INTO wechat_monitor_jobs
      (scope_key,account_id,kind,dedupe_key,payload,next_run_at) VALUES (?,?,?,?,?,?)`,
    [account.scope_key, account.id, kind, hash(`${account.id}:${kind}:${key}`), JSON.stringify(payload), at]);
    return result.insertId || null;
  };
  const account = async (scope, id) => {
    const [[row]] = await db.query('SELECT * FROM wechat_monitor_accounts WHERE scope_key = ? AND id = ?', [scope, id]);
    if (!row) throw invalid('MONITOR_NOT_FOUND', '监控目标不存在', 404); return row;
  };
  const bootstrap = async workspace => {
    if (db.getConnection) return onConnection('bootstrap', [workspace]);
    const scope = scopeFor(workspace);
    await db.beginTransaction();
    try {
      for (const preset of PRESETS) await db.query(`INSERT IGNORE INTO wechat_monitor_accounts
        (scope_key,org_id,unit_id,account_key,display_name,expected_names,created_by,discovery_config,state)
        VALUES (?,?,?,?,?,?,?,?,?)`, [scope, workspace.orgId, workspace.unitId, preset.key, preset.name,
        JSON.stringify(preset.expectedNames), workspace.userId, JSON.stringify({ provider: 'official_index', sogouPolicy: 'disallowed', historyCoverage: 'unknown' }), 'pending']);
      const [rows] = await db.query('SELECT * FROM wechat_monitor_accounts WHERE scope_key = ?', [scope]);
      for (const row of rows) {
        const preset = PRESETS.find(item => item.key === row.account_key);
        for (const url of preset.indexes) await enqueue(row, 'discover', { url, phase: 'history', page: 1 }, `history:${url}`);
      }
      await db.commit(); return rows;
    } catch (error) { await db.rollback(); throw error; }
  };
  const enqueueFetch = async (row, url, discovered = {}) => enqueue(row, 'fetch', { url, discovered }, `${url}:${Math.floor(clock() / 86400000)}`);
  const schedule = async () => {
    const [rows] = await db.query(`SELECT a.* FROM wechat_monitor_accounts a JOIN organizations o ON o.id=a.org_id
      LEFT JOIN organization_units u ON u.id=a.unit_id AND u.organization_id=a.org_id
      WHERE a.enabled = 1 AND a.next_check_at <= ? AND (a.unit_id IS NULL OR (u.id IS NOT NULL AND u.archived_at IS NULL))
      AND a.state NOT IN ('verification_required','policy_blocked') ORDER BY a.next_check_at LIMIT 10`, [clock()]);
    for (const row of rows) {
      const preset = PRESETS.find(item => item.key === row.account_key);
      for (const url of preset.indexes) await enqueue(row, 'discover', { url, phase: 'live', page: 1 }, `live:${url}:${Math.floor(clock() / (row.interval_seconds * 1000))}`);
      await db.query('UPDATE wechat_monitor_accounts SET next_check_at = ? WHERE id = ?', [clock() + row.interval_seconds * 1000, row.id]);
    }
  };
  const saveArticle = async (row, article) => {
    if (db.getConnection) return onConnection('saveArticle', [row, article]);
    await db.beginTransaction();
    try {
      const [inserted] = await db.query(`INSERT INTO wechat_monitor_articles
        (account_id,scope_key,canonical_key,source_url,title,author,published_at,identity_status,first_seen_at,last_seen_at)
        VALUES (?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id), last_seen_at = VALUES(last_seen_at),
        source_url = VALUES(source_url), title = VALUES(title), published_at = VALUES(published_at)`,
      [row.id, row.scope_key, article.canonicalKey, article.sourceUrl, article.title, article.author, article.publishedAt,
        article.identityStatus, clock(), clock()]);
      const id = inserted.insertId;
      const [revision] = await db.query(`INSERT INTO wechat_monitor_revisions
        (article_id,content_hash,blocks,plain_text,style_blocks,visual_features,metadata) VALUES (?,?,?,?,?,?,?)
        ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`, [id, article.contentHash, JSON.stringify(article.blocks), article.text,
        JSON.stringify(article.styleBlocks), JSON.stringify(article.visualFeatures), JSON.stringify(article.metadata)]);
      await db.query('UPDATE wechat_monitor_articles SET current_revision_id = ? WHERE id = ?', [revision.insertId, id]);
      if (!row.biz && article.biz && article.metadata.provenance?.sourceKind === 'official_site_wechat_link') {
        const preset = PRESETS.find(item => item.key === row.account_key);
        const expectedHost = new URL(preset.indexes[0]).hostname;
        const official = value => { try { return new URL(value).hostname === expectedHost; } catch { return false; } };
        if (official(article.metadata.provenance.discoveryUrl)) {
          const [others] = await db.query(`SELECT a.source_url,r.metadata FROM wechat_monitor_articles a
            JOIN wechat_monitor_revisions r ON r.id=a.current_revision_id WHERE a.account_id=? AND a.id<>? AND r.content_hash<>?
            AND JSON_UNQUOTE(JSON_EXTRACT(r.metadata,'$.publisher.biz'))=?
            AND JSON_UNQUOTE(JSON_EXTRACT(r.metadata,'$.provenance.sourceKind'))='official_site_wechat_link' LIMIT 20`, [row.id, id, article.contentHash, article.biz]);
          const previous = others.find(other => official(parsed(other.metadata, {}).provenance?.discoveryUrl));
          if (previous) {
            const config = { ...parsed(row.discovery_config, {}), identityVerification: { checkedAt: clock(),
              rule: 'two_distinct_officially_linked_articles', articles: [previous.source_url, article.sourceUrl],
              discoveries: [parsed(previous.metadata).provenance.discoveryUrl, article.metadata.provenance.discoveryUrl] } };
            await db.query('UPDATE wechat_monitor_accounts SET biz=?,discovery_config=? WHERE id=? AND biz IS NULL', [article.biz, JSON.stringify(config), row.id]);
            await db.query(`UPDATE wechat_monitor_articles a JOIN wechat_monitor_revisions r ON r.id=a.current_revision_id
              SET a.identity_status='biz_verified' WHERE a.account_id=? AND JSON_UNQUOTE(JSON_EXTRACT(r.metadata,'$.publisher.biz'))=?`, [row.id, article.biz]);
          }
        }
      }
      await enqueue(row, 'analyze', { articleId: id, revisionId: revision.insertId }, `${revision.insertId}:${PROTOCOL_VERSION}`);
      await db.commit();
      return { articleId: id, revisionId: revision.insertId };
    } catch (error) { await db.rollback(); throw error; }
  };
  const article = async (scope, id, revisionId = null) => {
    const [[row]] = await db.query(`SELECT a.*,r.id AS revision_id,r.content_hash,r.blocks,r.plain_text,r.style_blocks,r.visual_features,r.metadata,
      n.id AS analysis_id,n.revision_id AS analyzed_revision_id,n.analysis,n.features,n.scene
      FROM wechat_monitor_articles a JOIN wechat_monitor_revisions r ON r.id = COALESCE(?,a.current_revision_id) AND r.article_id = a.id
      LEFT JOIN wechat_monitor_analyses n ON n.id = a.current_analysis_id WHERE a.scope_key = ? AND a.id = ?`, [revisionId, scope, id]);
    if (!row) throw invalid('MONITOR_ARTICLE_NOT_FOUND', '文章不存在', 404);
    const [[job]] = await db.query('SELECT status,error_code,error_message FROM wechat_monitor_jobs WHERE scope_key=? AND dedupe_key=?',
      [scope, hash(`${row.account_id}:analyze:${row.current_revision_id}:${PROTOCOL_VERSION}`)]);
    const state = analysisStateFor(row, job?.status);
    return { ...row, id: Number(row.id), revisionId: Number(row.revision_id), text: row.plain_text,
      contentHash: row.content_hash, visualFeatures: parsed(row.visual_features, {}), blocks: parsed(row.blocks, []),
      styleBlocks: parsed(row.style_blocks, []), analysis: parsed(row.analysis), features: parsed(row.features, {}),
      analysisState: state, analysisError: job?.error_code && state !== 'ready' ? { code: job.error_code, message: job.error_message } : null };
  };
  const candidates = async (scope, excludeId, title = '') => {
    const select = `SELECT a.id,a.title,a.current_revision_id AS revisionId,r.plain_text AS text,r.content_hash AS contentHash,n.analysis,n.features
      FROM wechat_monitor_articles a JOIN wechat_monitor_revisions r ON r.id = a.current_revision_id
      JOIN wechat_monitor_analyses n ON n.id = a.current_analysis_id AND n.revision_id = r.id
      WHERE a.scope_key = ? AND a.id <> ?`;
    const [rows] = await db.query(select + ' ORDER BY a.published_at DESC LIMIT 200', [scope, excludeId]);
    const prefix = title.match(/^([^|｜丨:：]{2,30})[|｜丨:：]/)?.[1]?.trim();
    const topic = ['毕业', '迎新', '招生', '科研', '人物', '校庆', '节气', '招聘', '讲座'].find(term => title.includes(term));
    const hints = [...new Set([prefix, topic].filter(Boolean))].map(term => '%' + term.replace(/[\\%_]/g, '\\$&') + '%');
    if (hints.length) {
      const filter = ' AND (' + hints.map(() => 'a.title LIKE ?').join(' OR ') + ')';
      // Include earlier years as well as recent work; backfill order must not erase old series from comparison.
      for (const direction of ['ASC', 'DESC']) {
        const [related] = await db.query(select + filter + ` ORDER BY a.published_at ${direction} LIMIT 40`, [scope, excludeId, ...hints]); rows.push(...related);
      }
    }
    return [...new Map(rows.map(row => [Number(row.id), { ...row, id: Number(row.id), revisionId: Number(row.revisionId),
      analysis: parsed(row.analysis), features: parsed(row.features, {}) }])).values()];
  };
  const groupMembers = async (scope, id) => {
    const [rows] = await db.query(`SELECT a.id,a.title,a.published_at,a.current_revision_id AS revisionId,r.plain_text AS text,r.content_hash,n.id AS analysisId,n.analysis
      FROM wechat_monitor_groups g JOIN wechat_monitor_memberships m ON m.group_id = g.id
      JOIN wechat_monitor_articles a ON a.id = m.article_id AND a.scope_key = g.scope_key AND m.revision_id = a.current_revision_id
      JOIN wechat_monitor_revisions r ON r.id = m.revision_id
      JOIN wechat_monitor_analyses n ON n.id = a.current_analysis_id AND n.revision_id = m.revision_id
      WHERE g.id = ? AND g.scope_key = ? ORDER BY a.published_at DESC LIMIT 60`, [id, scope]);
    const unique = new Map();
    for (const row of rows) if (!unique.has(row.content_hash)) unique.set(row.content_hash, { ...row,
      id: Number(row.id), revisionId: Number(row.revisionId), analysisId: Number(row.analysisId), analysis: parsed(row.analysis) });
    return [...unique.values()];
  };
  const writeGroups = async (row, source, analysis) => {
    const [previous] = await db.query('SELECT group_id FROM wechat_monitor_memberships WHERE article_id = ?', [source.id]);
    await db.query('DELETE FROM wechat_monitor_memberships WHERE article_id = ?', [source.id]);
    const groups = [{ kind: 'scene', name: SCENES[analysis.scene], key: analysis.scene,
      evidence: analysis.sceneEvidence, confidence: analysis.sceneConfidence, accountId: null },
    ...analysis.seriesCandidates.filter(item => item.confidence >= 0.8 && seriesEligible(item.name, source)).map(item => ({ ...item, kind: 'series', accountId: row.id,
      key: item.name.normalize('NFKC').replace(/\s+/g, '').toLowerCase() }))];
    const ids = new Set(previous.map(item => Number(item.group_id)));
    for (const group of groups) {
      const [inserted] = await db.query(`INSERT INTO wechat_monitor_groups (scope_key,group_key,kind,name,account_id) VALUES (?,?,?,?,?)
        ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`, [row.scope_key, hash(`${group.kind}:${group.accountId || 0}:${group.key}`), group.kind, group.name, group.accountId]);
      ids.add(Number(inserted.insertId));
      await db.query('INSERT INTO wechat_monitor_memberships (group_id,article_id,revision_id,evidence,confidence) VALUES (?,?,?,?,?)',
        [inserted.insertId, source.id, source.revisionId, JSON.stringify(group.evidence), group.confidence]);
    }
    const [affected] = await db.query('SELECT id,kind,summary_fingerprint FROM wechat_monitor_groups WHERE scope_key=? AND id IN (?)', [row.scope_key, [...ids]]);
    for (const group of affected) {
      const members = await groupMembers(row.scope_key, group.id);
      const dates = new Set(members.map(member => new Date(Number(member.published_at) + 8 * 3600000).toISOString().slice(0, 10)));
      const fingerprint = groupFingerprint(members.slice(0, 8));
      if (members.length < 2 || group.kind === 'series' && dates.size < 2) {
        await db.query('UPDATE wechat_monitor_groups SET summary = NULL,summary_fingerprint = NULL WHERE id = ?', [group.id]);
      } else {
        if (group.summary_fingerprint !== fingerprint) await db.query('UPDATE wechat_monitor_groups SET summary = NULL,summary_fingerprint = NULL WHERE id = ?', [group.id]);
        await enqueue(row, 'summarize', { groupId: Number(group.id) }, `${group.id}:${fingerprint}`);
      }
    }
  };
  const refreshGroups = async (row, articleId) => {
    if (db.getConnection) return onConnection('refreshGroups', [row, articleId]);
    await db.beginTransaction();
    try {
      const [[owned]] = await db.query('SELECT id FROM wechat_monitor_articles WHERE id=? AND account_id=? AND scope_key=? FOR UPDATE',
        [articleId, row.id, row.scope_key]);
      if (!owned) throw invalid('MONITOR_ARTICLE_NOT_FOUND', '文章不存在', 404);
      const source = await article(row.scope_key, articleId);
      if (source.analysisState === 'ready') await writeGroups(row, source, source.analysis);
      await db.commit();
      return { articleId, analysisId: Number(source.analysis_id) || null, refreshed: source.analysisState === 'ready' };
    } catch (error) { await db.rollback(); throw error; }
  };
  const saveAnalysis = async (row, source, result, model, durationMs) => {
    if (db.getConnection) return onConnection('saveAnalysis', [row, source, result, model, durationMs]);
    await db.beginTransaction();
    try {
      const [saved] = await db.query(`INSERT INTO wechat_monitor_analyses
        (article_id,revision_id,protocol_version,model,scene,analysis,features,tokens_used,duration_ms) VALUES (?,?,?,?,?,?,?,?,?)
        ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`, [source.id, source.revisionId, PROTOCOL_VERSION, model,
        result.analysis.scene, JSON.stringify(result.analysis), JSON.stringify(result.features), result.tokens, durationMs]);
      const [updated] = await db.query('UPDATE wechat_monitor_articles SET current_analysis_id = ? WHERE id = ? AND current_revision_id = ?',
        [saved.insertId, source.id, source.revisionId]);
      if (!updated.affectedRows) { await db.commit(); return; }
      for (const relation of result.analysis.related) {
        const ownFirst = source.id < relation.articleId;
        await db.query(`INSERT INTO wechat_monitor_relations (scope_key,article_low,article_high,revision_low,revision_high,similarity,summary,evidence)
          VALUES (?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE revision_low=VALUES(revision_low),revision_high=VALUES(revision_high),
          similarity=VALUES(similarity),summary=VALUES(summary),evidence=VALUES(evidence)`, [row.scope_key,
          Math.min(source.id, relation.articleId), Math.max(source.id, relation.articleId), ownFirst ? source.revisionId : relation.revisionId,
          ownFirst ? relation.revisionId : source.revisionId, relation.similarity, relation.summary,
          JSON.stringify({ kind: relation.kind, low: ownFirst ? relation.ownEvidence : relation.otherEvidence, high: ownFirst ? relation.otherEvidence : relation.ownEvidence })]);
      }
      await writeGroups(row, source, result.analysis);
      await db.commit();
    } catch (error) { await db.rollback(); throw error; }
  };
  const overview = async scope => {
    const [accounts] = await db.query(`SELECT x.*,COUNT(a.id) AS article_count,MIN(a.published_at) AS earliest_at,MAX(a.published_at) AS latest_at,
      SUM(a.current_analysis_id IS NOT NULL) AS analyzed_count FROM wechat_monitor_accounts x
      LEFT JOIN wechat_monitor_articles a ON a.account_id = x.id WHERE x.scope_key = ? GROUP BY x.id ORDER BY x.id`, [scope]);
    const [jobs] = await db.query('SELECT kind,status,COUNT(*) AS count FROM wechat_monitor_jobs WHERE scope_key = ? GROUP BY kind,status', [scope]);
    const [discovered] = await db.query(`SELECT account_id,COUNT(DISTINCT JSON_UNQUOTE(JSON_EXTRACT(payload,'$.url'))) AS count,
      SUM(status IN ('blocked','failed')) AS restricted_count
      FROM wechat_monitor_jobs WHERE scope_key=? AND kind='fetch' GROUP BY account_id`, [scope]);
    const candidatesByAccount = new Map(discovered.map(row => [Number(row.account_id), Number(row.count)]));
    const restrictionsByAccount = new Map(discovered.map(row => [Number(row.account_id), Number(row.restricted_count)]));
    const [dates] = await db.query('SELECT account_id,published_at FROM wechat_monitor_articles WHERE scope_key = ?', [scope]);
    const months = new Map();
    for (const item of dates) {
      const key = `${item.account_id}:${new Date(Number(item.published_at) + 8 * 3600000).toISOString().slice(0, 7)}`;
      months.set(key, (months.get(key) || 0) + 1);
    }
    return { accounts: accounts.map(row => ({ id: Number(row.id), name: row.display_name, key: row.account_key, since: row.since_date,
      enabled: Boolean(row.enabled), intervalSeconds: row.interval_seconds, state: row.state, biz: row.biz, identityVerified: Boolean(row.biz),
      lastCheckedAt: row.last_checked_at, nextCheckAt: row.next_check_at, error: row.last_error,
      articleCount: Number(row.article_count), candidateLinks: candidatesByAccount.get(Number(row.id)) || 0,
      restrictedFetches: restrictionsByAccount.get(Number(row.id)) || 0,
      analyzedCount: Number(row.analyzed_count) || 0, earliestAt: row.earliest_at, latestAt: row.latest_at,
      historyCoverage: 'official_index_partial', sogou: { state: 'policy_disallowed', url: searchUrl(row.display_name),
        reason: '搜狗 robots 与用户协议限制后台机器人采集；保留人工发现入口' },
      monthlyCoverage: historicalWindows(row.since_date, clock()).map(range => ({ ...range,
        count: months.get(`${row.id}:${range.from.slice(0, 7)}`) || 0,
        state: months.has(`${row.id}:${range.from.slice(0, 7)}`) ? 'partial' : 'unverified' })) })), jobs, scenes: SCENES, budget: await modelBudget() };
  };
  return { db, enqueue, account, bootstrap, enqueueFetch, schedule, saveArticle, article, candidates, groupMembers, saveAnalysis, refreshGroups, overview, modelBudget };
}
module.exports = { scopeFor, makeStore, analysisStateFor };
