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
  listPresets, listForbiddenWords, finishBatch, requeueJob,
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
