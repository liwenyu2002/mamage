// 外部导入任务（external_import_jobs / external_import_items）dao。
// 权限判定与错误码留在 routes/external_imports.js。
async function findJob(db, jobId) {
  const [rows] = await db.query('SELECT * FROM external_import_jobs WHERE id = ? LIMIT 1', [jobId]);
  return rows && rows.length ? rows[0] : null;
}

async function listProjectJobs(db, { projectId, ownerSql, args }) {
  const [rows] = await db.query(
    `SELECT * FROM external_import_jobs WHERE project_id = ?${ownerSql} ORDER BY id DESC LIMIT 8`, args);
  return rows || [];
}

async function listAttributedSources(db, { projectId, ownerSql = '', args }) {
  const [rows] = await db.query(
    `SELECT MAX(j.id) AS id, j.source_url, MAX(j.source_title) AS source_title,
            MIN(j.created_at) AS started_at, COUNT(DISTINCT i.photo_id) AS photo_count
       FROM external_import_jobs j
       LEFT JOIN external_import_items i ON i.job_id = j.id AND i.status = 'done'
      WHERE j.project_id = ?${ownerSql} AND j.attribution_visible = 1
      GROUP BY j.source_url ORDER BY MAX(j.id) DESC LIMIT 30`, args);
  return rows || [];
}

async function countItemsByStatus(db, jobId) {
  const [rows] = await db.query(
    'SELECT status, COUNT(*) AS count FROM external_import_items WHERE job_id = ? GROUP BY status', [jobId]);
  return rows || [];
}

async function listIssues(db, { jobId, limit = 20 }) {
  const [rows] = await db.query(
    `SELECT id, filename, status, error_code AS errorCode
       FROM external_import_items
      WHERE job_id = ? AND (status = 'failed' OR (status = 'skipped' AND error_code IS NOT NULL))
      ORDER BY id LIMIT ?`, [jobId, limit]);
  return rows || [];
}

async function findActiveItemName(db, jobId) {
  const [rows] = await db.query(
    "SELECT filename FROM external_import_items WHERE job_id = ? AND status = 'running' ORDER BY id LIMIT 1", [jobId]);
  return rows && rows.length ? rows[0].filename : null;
}

async function listPhotosPage(db, { projectId, jobId, afterPhotoId, owner, limit = 101 }) {
  const [rows] = await db.query(
    `SELECT ph.id, ph.url, ph.thumb_url AS thumbUrl, ph.title, ph.description,
            ph.tags, ph.ai_status AS aiStatus, ph.type, ph.photographer_id AS photographerId,
            ph.timeline_section_id AS timelineSectionId, pts.name AS timelineSectionName,
            ph.created_at AS createdAt
       FROM external_import_items i
       JOIN photos ph ON ph.id = i.photo_id AND ph.project_id = ?
       LEFT JOIN project_timeline_sections pts ON pts.id = ph.timeline_section_id
      WHERE i.job_id = ? AND i.status = 'done' AND i.photo_id > ?${owner.sql}
      ORDER BY i.photo_id LIMIT ?`, [projectId, jobId, afterPhotoId, ...owner.params, limit]);
  return rows || [];
}

async function listSections(db, projectId) {
  const [rows] = await db.query(
    `SELECT id, name, section_time AS sectionTime, sort_order AS sortOrder
       FROM project_timeline_sections WHERE project_id = ? ORDER BY sort_order, id`, [projectId]);
  return rows || [];
}

async function listIssuesPage(db, { jobId, afterItemId, limit = 101 }) {
  const [rows] = await db.query(
    `SELECT id, filename, status, error_code AS errorCode
       FROM external_import_items WHERE job_id = ? AND id > ?
        AND (status = 'failed' OR (status = 'skipped' AND error_code IS NOT NULL))
      ORDER BY id LIMIT ?`, [jobId, afterItemId, limit]);
  return rows || [];
}

async function requestCancel(db, jobId) {
  const [result] = await db.query(
    `UPDATE external_import_jobs SET cancel_requested = 1,
       finished_at = IF(status = 'paused', NOW(), finished_at),
       status = IF(status = 'paused', 'cancelled', status)
      WHERE id = ? AND status IN ('queued', 'running', 'paused')`, [jobId]);
  return Number(result && result.affectedRows) || 0;
}

// ---- 重试 ----
async function lockProject(conn, projectId) {
  await conn.query('SELECT id FROM projects WHERE id = ? FOR UPDATE', [projectId]);
}

async function findConflictingJobs(conn, { projectId, jobId }) {
  const [rows] = await conn.query(
    "SELECT id FROM external_import_jobs WHERE project_id = ? AND id <> ? AND status IN ('queued', 'running', 'paused') LIMIT 1",
    [projectId, jobId]);
  return rows || [];
}

async function resetFailedItems(conn, jobId) {
  await conn.query(
    "UPDATE external_import_items SET status = 'pending', error_code = NULL, attempt_count = 0 WHERE job_id = ? AND status = 'failed'",
    [jobId]);
}

async function requeueJob(conn, jobId) {
  await conn.query(
    `UPDATE external_import_jobs SET status = 'queued', cancel_requested = 0, retry_after = NULL,
       scan_status = IF(scan_status = 'completed', 'completed', 'pending'), scan_error_code = NULL,
       finished_at = NULL WHERE id = ?`, [jobId]);
}

module.exports = {
  findJob, listProjectJobs, listAttributedSources, countItemsByStatus, listIssues, findActiveItemName,
  listPhotosPage, listSections, listIssuesPage, requestCancel,
  lockProject, findConflictingJobs, resetFailedItems, requeueJob,
};

/** 隐藏某来源的署名展示（整条 URL 的所有任务） */
async function hideSource(db, { projectId, sourceUrl }) {
  await db.query(
    'UPDATE external_import_jobs SET attribution_visible = 0 WHERE project_id = ? AND source_url = ?',
    [projectId, sourceUrl]);
}

module.exports.hideSource = hideSource;
