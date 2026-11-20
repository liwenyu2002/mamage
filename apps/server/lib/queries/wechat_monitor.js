// 公众号监控（wechat_monitor_*）dao。scope_key 由调用方传入，权限在 middleware 里判定。
async function updateAccountConfig(db, { id, enabled, intervalSeconds }) {
  await db.query('UPDATE wechat_monitor_accounts SET enabled=?,interval_seconds=?,next_check_at=0 WHERE id=?',
    [enabled, intervalSeconds, id]);
}

async function enqueueRegroupJobs(db, { scopeKey, accountId, rulesVersion }) {
  const [result] = await db.query(
    `INSERT IGNORE INTO wechat_monitor_jobs (scope_key,account_id,kind,dedupe_key,payload,next_run_at)
     SELECT a.scope_key,a.account_id,'regroup',SHA2(CONCAT(a.account_id,':regroup:',a.current_analysis_id,':',?),256),
       JSON_OBJECT('articleId',a.id),? FROM wechat_monitor_articles a
     JOIN wechat_monitor_analyses n ON n.id=a.current_analysis_id AND n.revision_id=a.current_revision_id
     WHERE a.scope_key=? AND a.account_id=? ORDER BY a.id`,
    [rulesVersion, Date.now(), scopeKey, accountId]);
  return result;
}

async function countAnalyzedArticles(db, { scopeKey, accountId }) {
  const [[row]] = await db.query(
    `SELECT COUNT(*) count FROM wechat_monitor_articles a
     JOIN wechat_monitor_analyses n ON n.id=a.current_analysis_id AND n.revision_id=a.current_revision_id
     WHERE a.scope_key=? AND a.account_id=?`, [scopeKey, accountId]);
  return Number(row && row.count) || 0;
}

/** 文章列表分页（clauses 由路由拼装） */
async function listArticles(db, { clauses, params, protocolVersion, offset }) {
  const [rows] = await db.query(
    `SELECT a.id,a.account_id,a.title,a.author,a.source_url,a.published_at,a.identity_status,a.current_revision_id,
       n.revision_id AS analyzed_revision_id,n.scene,n.analysis,j.status AS analysis_job_status FROM wechat_monitor_articles a
     LEFT JOIN wechat_monitor_analyses n ON n.id=a.current_analysis_id
     LEFT JOIN wechat_monitor_jobs j ON j.scope_key=a.scope_key AND j.dedupe_key=SHA2(CONCAT(a.account_id,':analyze:',a.current_revision_id,':',?),256)
     WHERE ${clauses.join(' AND ')} ORDER BY a.published_at DESC,a.id DESC LIMIT 31 OFFSET ?`,
    [protocolVersion, ...params, offset]);
  return rows || [];
}

async function listArticleRelations(db, { scopeKey, articleId }) {
  const [rows] = await db.query(
    `SELECT r.*,a.title AS low_title,b.title AS high_title FROM wechat_monitor_relations r
      JOIN wechat_monitor_articles a ON a.id=r.article_low AND a.current_revision_id=r.revision_low
      JOIN wechat_monitor_articles b ON b.id=r.article_high AND b.current_revision_id=r.revision_high
     WHERE r.scope_key=? AND (r.article_low=? OR r.article_high=?)`, [scopeKey, articleId, articleId]);
  return rows || [];
}

async function listGroups(db, scopeKey) {
  const [rows] = await db.query(
    `SELECT g.*,COUNT(DISTINCT r.content_hash) AS member_count,
       COUNT(DISTINCT FLOOR((a.published_at+28800000)/86400000)) AS date_count FROM wechat_monitor_groups g
       JOIN wechat_monitor_memberships m ON m.group_id=g.id
       JOIN wechat_monitor_articles a ON a.id=m.article_id AND a.current_revision_id=m.revision_id
       JOIN wechat_monitor_revisions r ON r.id=m.revision_id
      WHERE g.scope_key=? GROUP BY g.id ORDER BY member_count DESC,g.id DESC LIMIT 200`, [scopeKey]);
  return rows || [];
}

async function findGroup(db, { scopeKey, groupId }) {
  const [[row]] = await db.query('SELECT * FROM wechat_monitor_groups WHERE scope_key=? AND id=?', [scopeKey, groupId]);
  return row || null;
}

async function listJobs(db, { where, params }) {
  const [rows] = await db.query(
    `SELECT j.id,j.account_id,j.kind,j.status,j.attempts,j.next_run_at,j.error_code,j.error_message,j.result,j.created_at,j.payload
       FROM wechat_monitor_jobs j WHERE ${where.join(' AND ')} ORDER BY j.id DESC LIMIT 51`, params);
  return rows || [];
}

async function listJobEvents(db, { scopeKey, jobId }) {
  const [rows] = await db.query(
    `SELECT e.attempt,e.status,e.error_code AS errorCode,e.error_message AS error,e.created_at AS createdAt
       FROM wechat_monitor_job_events e JOIN wechat_monitor_jobs j ON j.id=e.job_id
      WHERE j.scope_key=? AND j.id=? ORDER BY e.id DESC LIMIT 50`, [scopeKey, jobId]);
  return rows || [];
}

async function retryJob(db, { scopeKey, jobId }) {
  const [result] = await db.query(
    `UPDATE wechat_monitor_jobs SET status='pending',next_run_at=0,attempts=0 WHERE scope_key=? AND id=?
       AND status IN ('failed','blocked')`, [scopeKey, jobId]);
  return result;
}

module.exports = {
  updateAccountConfig, enqueueRegroupJobs, countAnalyzedArticles, listArticles, listArticleRelations,
  listGroups, findGroup, listJobs, listJobEvents, retryJob,
};
