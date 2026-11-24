// AI 新闻任务（ai_jobs / ai_results / ai_job_batches / org_presets）dao。
// 权限与错误码留在 routes/ai_news.js。
async function insertJob(db, { userId, projectId, unitId, model, prompt, options, clientRequestId }) {
  const [result] = await db.query(
    'INSERT INTO ai_jobs (user_id, project_id, unit_id, status, model, prompt_text, options, client_request_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())',
    [userId || null, projectId, unitId || null, 'pending', model || 'default', prompt,
      JSON.stringify(options || {}), clientRequestId || null]);
  return result;
}

async function findJob(db, jobId) {
  const [rows] = await db.query('SELECT * FROM ai_jobs WHERE id = ?', [jobId]);
  return rows && rows.length ? rows[0] : null;
}

async function findLatestResult(db, jobId) {
  const [rows] = await db.query('SELECT * FROM ai_results WHERE job_id = ? ORDER BY id DESC LIMIT 1', [jobId]);
  return rows && rows.length ? rows[0] : null;
}

async function findJobForReferences(db, { jobId, userId }) {
  const [rows] = await db.query(
    `SELECT j.unit_id, j.prompt_text, b.form_snapshot FROM ai_jobs j
       JOIN ai_job_batches b ON b.id = j.batch_id AND b.user_id = j.user_id
      WHERE j.id = ? AND j.user_id = ? LIMIT 1`, [jobId, userId]);
  return rows && rows.length ? rows[0] : null;
}

async function findBatch(db, batchId) {
  const [rows] = await db.query('SELECT * FROM ai_job_batches WHERE id = ?', [batchId]);
  return rows && rows.length ? rows[0] : null;
}

async function listBatchJobs(db, batchId) {
  const [rows] = await db.query('SELECT * FROM ai_jobs WHERE batch_id = ? ORDER BY id ASC', [batchId]);
  return rows || [];
}

async function listRecoverableWechatDrafts(db, { userId, unitId }) {
  const [rows] = await db.query(
    `SELECT b.id AS batchId, j.id AS jobId, j.status, b.created_at AS createdAt,
        COALESCE(NULLIF(r.title, ''), NULLIF(JSON_UNQUOTE(JSON_EXTRACT(b.form_snapshot,'$.eventName')), ''),
          LEFT(JSON_UNQUOTE(JSON_EXTRACT(b.form_snapshot,'$.sourceMaterial')), 80)) AS title
       FROM ai_job_batches b
       JOIN ai_jobs j ON j.batch_id=b.id AND j.user_id=b.user_id AND j.unit_id <=> b.unit_id
         AND j.channel_key='wechat_article'
       LEFT JOIN ai_results r ON r.id=(SELECT rr.id FROM ai_results rr WHERE rr.job_id=j.id ORDER BY rr.id DESC LIMIT 1)
       WHERE b.user_id=? AND b.unit_id <=> ? AND j.status IN ('pending','running','succeeded','failed')
         AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(j.options,'$.wechatDraftDiscarded')), '0') <> '1'
         AND NOT EXISTS (
           SELECT 1 FROM wechat_compositions d WHERE d.user_id=b.user_id AND d.unit_id <=> b.unit_id
             AND JSON_UNQUOTE(JSON_EXTRACT(d.source_document,'$.sourceJobId'))=CAST(j.id AS CHAR)
         )
       ORDER BY b.id DESC, j.id DESC LIMIT 20`, [userId, unitId]);
  return rows || [];
}

async function discardRecoverableWechatDraft(db, { batchId, userId, unitId }) {
  // Keep the job, its accounting, and other channels in the batch intact.
  const [result] = await db.query(
    `UPDATE ai_jobs j
       JOIN ai_job_batches b ON j.batch_id=b.id AND j.user_id=b.user_id AND j.unit_id <=> b.unit_id
        SET j.options=JSON_SET(COALESCE(j.options, JSON_OBJECT()), '$.wechatDraftDiscarded', 1)
      WHERE b.id=? AND b.user_id=? AND b.unit_id <=> ? AND j.channel_key='wechat_article'`,
    [batchId, userId, unitId]);
  return result.affectedRows > 0;
}

async function listPresets(db, orgId) {
  const [rows] = await db.query(
    'SELECT id, name, kind, content, config FROM org_presets WHERE org_id = ? ORDER BY id ASC', [orgId]);
  return rows || [];
}

async function listForbiddenWords(db, orgId) {
  const [rows] = await db.query('SELECT forbidden_words FROM org_presets WHERE org_id = ? LIMIT 1', [orgId]);
  return rows && rows.length ? rows[0].forbidden_words : null;
}

async function finishBatch(db, { batchId, status, finished }) {
  if (finished) {
    await db.query(
      'UPDATE ai_job_batches SET status = ?, finished_at = COALESCE(finished_at, NOW()) WHERE id = ?', [status, batchId]);
    return;
  }
  await db.query('UPDATE ai_job_batches SET status = ? WHERE id = ?', [status, batchId]);
}

async function requeueJob(db, jobId) {
  await db.query(
    'UPDATE ai_jobs SET status = ?, error = NULL, started_at = NULL, finished_at = NULL WHERE id = ?', ['pending', jobId]);
}

module.exports = {
  insertJob, findJob, findLatestResult, findJobForReferences, findBatch, listBatchJobs,
  listPresets, listForbiddenWords, finishBatch, requeueJob, listRecoverableWechatDrafts, discardRecoverableWechatDraft,
};

async function findDefaultPreset(db, orgId) {
  const [rows] = await db.query('SELECT * FROM org_presets WHERE org_id = ? AND is_default = 1 LIMIT 1', [orgId]);
  return rows && rows.length ? rows[0] : null;
}

async function findDefaultPresetForbiddenWords(db, orgId) {
  const [rows] = await db.query(
    'SELECT forbidden_words FROM org_presets WHERE org_id = ? AND is_default = 1 LIMIT 1', [orgId]);
  return rows && rows.length ? rows[0] : null;
}

module.exports.findDefaultPreset = findDefaultPreset;
module.exports.findDefaultPresetForbiddenWords = findDefaultPresetForbiddenWords;

// ---- 通用 AI 任务查询（排版/段落改写等任务共用）----
async function findJobByClientRequestId(db, { userId, clientRequestId }) {
  const [rows] = await db.query(
    'SELECT id,options,unit_id FROM ai_jobs WHERE user_id=? AND client_request_id=? LIMIT 1',
    [userId, clientRequestId]);
  return rows && rows.length ? rows[0] : null;
}

async function insertAiJob(db, { userId, projectId, unitId, prompt, options, clientRequestId }) {
  const [result] = await db.query(
    `INSERT INTO ai_jobs (user_id,project_id,unit_id,status,model,prompt_text,options,client_request_id,created_at)
     VALUES (?,?,?,'pending','default',?,?,?,NOW())`,
    [userId, projectId || null, unitId || null, prompt, JSON.stringify(options), clientRequestId]);
  return result;
}

/** 排版任务回查（带 unit 与 options 过滤） */
async function findLayoutJob(db, { userId, clientRequestId, unitId, purpose, orgScope }) {
  const [rows] = await db.query(
    `SELECT j.id,j.status,j.error,r.extra FROM ai_jobs j LEFT JOIN ai_results r ON r.job_id=j.id
      WHERE j.user_id=? AND j.client_request_id=? AND j.unit_id <=> ?
        AND JSON_UNQUOTE(JSON_EXTRACT(j.options,'$.purpose'))=?
        AND JSON_UNQUOTE(JSON_EXTRACT(j.options,'$.organizationScope'))=? ORDER BY r.id DESC LIMIT 1`,
    [userId, clientRequestId, unitId, purpose, orgScope]);
  return rows && rows.length ? rows[0] : null;
}

async function listStyleBlocksForLayout(db, { orgId, unitScopeSql, params }) {
  const [rows] = await db.query(
    `SELECT id,type,name FROM wechat_style_blocks WHERE org_id <=> ? ${unitScopeSql} ORDER BY id LIMIT 500`,
    [orgId, ...params]);
  return rows || [];
}

/** 段落改写回查（只取 markdown） */
async function findParagraphRewriteJob(db, { userId, clientRequestId }) {
  const [rows] = await db.query(
    `SELECT j.id,j.status,j.error,r.markdown FROM ai_jobs j
       LEFT JOIN ai_results r ON r.job_id=j.id
      WHERE j.user_id=? AND j.client_request_id=?
        AND JSON_UNQUOTE(JSON_EXTRACT(j.options,'$.purpose'))='paragraph-rewrite'
      ORDER BY r.id DESC LIMIT 1`, [userId, clientRequestId]);
  return rows && rows.length ? rows[0] : null;
}

module.exports.findJobByClientRequestId = findJobByClientRequestId;
module.exports.insertAiJob = insertAiJob;
module.exports.findLayoutJob = findLayoutJob;
module.exports.listStyleBlocksForLayout = listStyleBlocksForLayout;
module.exports.findParagraphRewriteJob = findParagraphRewriteJob;

/** 排版类任务落库（无 project_id） */
async function insertLayoutJob(db, { userId, unitId, prompt, options, clientRequestId }) {
  const [result] = await db.query(
    `INSERT INTO ai_jobs
       (user_id,unit_id,status,model,prompt_text,options,client_request_id,created_at)
     VALUES (?,?,'pending','default',?,?,?,NOW())`,
    [userId, unitId, prompt, JSON.stringify(options), clientRequestId]);
  return result;
}

module.exports.insertLayoutJob = insertLayoutJob;

/** 批量任务：建批次与逐渠道任务 */
async function insertJobBatch(conn, row) {
  const [result] = await conn.query(
    'INSERT INTO ai_job_batches (user_id, project_id, unit_id, form_snapshot, selected_photo_ids, status, created_at) VALUES (?, ?, ?, ?, ?, ?, NOW())',
    [row.userId || null, row.projectId, row.unitId || null, JSON.stringify(row.formSnapshot),
      JSON.stringify(row.selectedPhotoIds), row.status]);
  return result;
}

async function insertBatchJob(conn, row) {
  const [result] = await conn.query(
    'INSERT INTO ai_jobs (user_id, project_id, unit_id, status, model, prompt_text, options, client_request_id, batch_id, channel_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())',
    [row.userId || null, row.projectId, row.unitId || null, 'pending', 'default', row.prompt,
      JSON.stringify(row.options), null, row.batchId, row.channelKey]);
  return result;
}

module.exports.insertJobBatch = insertJobBatch;
module.exports.insertBatchJob = insertBatchJob;
