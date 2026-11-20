// 视频工程（video_projects）与渲染任务（video_render_jobs）的 dao 层。
// 只放 SQL；所有者/单位范围片段（scope.sql）由调用方传入，权限判定留在路由。
async function listProjects(db, { userId, scope, limit = 100 }) {
  const [rows] = await db.query(
    `SELECT * FROM video_projects WHERE user_id = ?${scope.sql} ORDER BY updated_at DESC LIMIT ?`,
    [userId, ...scope.params, limit]);
  return rows || [];
}

/** 渲染前的用户读取（权限判定仍在路由） */
async function findRenderUser(db, userId) {
  const [rows] = await db.query('SELECT id, role, organization_id FROM users WHERE id = ? LIMIT 1', [userId]);
  return rows || [];
}

async function insertProject(db, { userId, orgId, unitId, name, aspectRatio, project, durationSeconds }) {
  const [result] = await db.query(
    'INSERT INTO video_projects (user_id, org_id, unit_id, name, aspect_ratio, project_json, duration_seconds) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [userId, orgId || null, unitId, name, aspectRatio, JSON.stringify(project), durationSeconds]);
  return result;
}

async function findProjectById(db, id) {
  const [rows] = await db.query('SELECT * FROM video_projects WHERE id = ? LIMIT 1', [id]);
  return rows && rows.length ? rows[0] : null;
}

async function findOwnedProject(db, { id, userId, scope }) {
  const [rows] = await db.query(
    `SELECT * FROM video_projects WHERE id = ? AND user_id = ?${scope.sql} LIMIT 1`, [id, userId, ...scope.params]);
  return rows && rows.length ? rows[0] : null;
}

async function updateProject(db, { id, userId, scope, name, aspectRatio, project, durationSeconds }) {
  const [result] = await db.query(
    `UPDATE video_projects SET name = ?, aspect_ratio = ?, project_json = ?, duration_seconds = ?, version = version + 1
      WHERE id = ? AND user_id = ?${scope.sql}`,
    [name, aspectRatio, JSON.stringify(project), durationSeconds, id, userId, ...scope.params]);
  return Number(result && result.affectedRows) || 0;
}

async function deleteProject(db, { id, userId, scope }) {
  const [result] = await db.query(`DELETE FROM video_projects WHERE id = ? AND user_id = ?${scope.sql}`,
    [id, userId, ...scope.params]);
  return Number(result && result.affectedRows) || 0;
}

async function insertRenderJob(db, { projectId, userId, options }) {
  const [result] = await db.query(
    "INSERT INTO video_render_jobs (project_id, user_id, status, progress, stage, render_options) VALUES (?, ?, 'queued', 0, '等待渲染', ?)",
    [projectId, userId, JSON.stringify(options)]);
  return result;
}

async function findRenderJob(db, id) {
  const [rows] = await db.query('SELECT * FROM video_render_jobs WHERE id = ? LIMIT 1', [id]);
  return rows && rows.length ? rows[0] : null;
}

async function findOwnedRenderJob(db, { id, userId }) {
  const [rows] = await db.query('SELECT * FROM video_render_jobs WHERE id = ? AND user_id = ? LIMIT 1', [id, userId]);
  return rows && rows.length ? rows[0] : null;
}

async function cancelRenderJob(db, { id, userId }) {
  const [result] = await db.query(
    "UPDATE video_render_jobs SET status = 'canceled', stage = '已取消', finished_at = NOW() WHERE id = ? AND user_id = ? AND status IN ('queued','running')",
    [id, userId]);
  return Number(result && result.affectedRows) || 0;
}

/** 服务重启后把 running 任务打回 queued */
async function requeueInterruptedRenders(db) {
  await db.query(
    "UPDATE video_render_jobs SET status = 'queued', progress = 0, stage = '服务重启后重新排队', started_at = NULL WHERE status = 'running'");
}

async function listQueuedRenderJobs(db, limit = 100) {
  const [rows] = await db.query(
    `SELECT j.id AS job_id, j.user_id AS job_user_id, j.render_options, p.*
       FROM video_render_jobs j
       INNER JOIN video_projects p ON p.id = j.project_id AND p.user_id = j.user_id
      WHERE j.status = 'queued'
      ORDER BY j.created_at ASC
      LIMIT ?`, [limit]);
  return rows || [];
}

module.exports = {
  listProjects, insertProject, findProjectById, findOwnedProject, updateProject, deleteProject,
  insertRenderJob, findRenderJob, findOwnedRenderJob, cancelRenderJob,
  requeueInterruptedRenders, listQueuedRenderJobs,
};

// ---- 素材（video_editor_assets）----
async function findCommittedAssetByPath(db, { storagePath, userId, scope }) {
  const [rows] = await db.query(
    `SELECT id FROM video_editor_assets WHERE storage_path = ? AND user_id = ?${scope ? scope.sql : ''} LIMIT 1`,
    scope ? [storagePath, userId, ...scope.params] : [storagePath, userId]);
  return rows && rows.length ? rows[0] : null;
}

async function listAssets(db, { userId, scope, limit = 300 }) {
  const [rows] = await db.query(
    `SELECT * FROM video_editor_assets WHERE user_id = ?${scope.sql} ORDER BY created_at DESC LIMIT ?`,
    [userId, ...scope.params, limit]);
  return rows || [];
}

async function findAssetByPath(db, { storagePath, userId, scope }) {
  const [rows] = await db.query(
    `SELECT * FROM video_editor_assets WHERE storage_path = ? AND user_id = ?${scope ? scope.sql : ''} LIMIT 1`,
    scope ? [storagePath, userId, ...scope.params] : [storagePath, userId]);
  return rows && rows.length ? rows[0] : null;
}

async function findAsset(db, { id, userId, scope }) {
  const [rows] = await db.query(
    `SELECT * FROM video_editor_assets WHERE id = ? AND user_id = ?${scope ? scope.sql : ''} LIMIT 1`,
    scope ? [id, userId, ...scope.params] : [id, userId]);
  return rows && rows.length ? rows[0] : null;
}

async function insertAsset(db, { userId, storagePath, ...rest }) {
  const [result] = await db.query(
    'INSERT INTO video_editor_assets (user_id, storage_path, kind, size_bytes) VALUES (?, ?, ?, ?)',
    [userId, storagePath, rest.kind || null, rest.sizeBytes || null]);
  return result;
}

async function setAssetAnalysis(db, { id, userId, analysis }) {
  await db.query('UPDATE video_editor_assets SET analysis_json = ? WHERE id = ? AND user_id = ?',
    [JSON.stringify(analysis), id, userId]);
}

async function findAssetsByIds(db, { userId, ids }) {
  if (!ids.length) return [];
  const [rows] = await db.query(
    `SELECT * FROM video_editor_assets WHERE user_id = ? AND id IN (${ids.map(() => '?').join(',')})`,
    [userId, ...ids]);
  return rows || [];
}

// ---- 渲染任务状态机 ----
async function findRenderJobStatus(db, jobId) {
  const [rows] = await db.query('SELECT status FROM video_render_jobs WHERE id = ?', [jobId]);
  return rows && rows.length ? rows[0].status : null;
}

async function claimRenderJob(db, jobId) {
  const [result] = await db.query(
    "UPDATE video_render_jobs SET status = 'running', progress = 1, stage = '准备素材', started_at = NOW() WHERE id = ? AND status = 'queued'",
    [jobId]);
  return Number(result && result.affectedRows) || 0;
}

async function updateRenderProgress(db, { jobId, progress, stage }) {
  await db.query('UPDATE video_render_jobs SET progress = ?, stage = ? WHERE id = ?', [progress, stage, jobId]);
}

async function finishRenderUpload(db, jobId) {
  await db.query("UPDATE video_render_jobs SET progress = 99, stage = '上传导出文件' WHERE id = ? AND status = 'running'", [jobId]);
}

async function completeRenderJob(db, { jobId, status, stage, errorText, outputPath = null }) {
  const [result] = await db.query(
    `UPDATE video_render_jobs SET status = ?, stage = ?, error_text = ?, output_path = COALESCE(?, output_path),
            output_url = NULL, finished_at = NOW()
      WHERE id = ? AND status IN ('running','queued')`,
    [status, stage || null, errorText || null, outputPath, jobId]);
  return Number(result && result.affectedRows) || 0;
}

module.exports.findCommittedAssetByPath = findCommittedAssetByPath;
module.exports.listAssets = listAssets;
module.exports.findAssetByPath = findAssetByPath;
module.exports.findAsset = findAsset;
module.exports.insertAsset = insertAsset;
module.exports.setAssetAnalysis = setAssetAnalysis;
module.exports.findAssetsByIds = findAssetsByIds;
module.exports.findRenderJobStatus = findRenderJobStatus;
module.exports.claimRenderJob = claimRenderJob;
module.exports.updateRenderProgress = updateRenderProgress;
module.exports.finishRenderUpload = finishRenderUpload;
module.exports.completeRenderJob = completeRenderJob;

/** 素材探测结果回写（时长/尺寸/音轨） */
async function setAssetProbe(db, { id, userId, metadata }) {
  await db.query(
    'UPDATE video_editor_assets SET duration_seconds = ?, width = ?, height = ?, has_audio = ? WHERE id = ? AND user_id = ?',
    [metadata.duration, metadata.width, metadata.height, metadata.hasAudio ? 1 : 0, id, userId]);
}

module.exports.setAssetProbe = setAssetProbe;

/** 生产素材（相册视频）按组织范围取播放源 */
async function findProductionVideoSources(db, { photoIds, orgClause, params }) {
  const [rows] = await db.query(
    `SELECT p.id, p.url, p.playback_url, p.title, p.type
       FROM photos p
      WHERE p.id IN (${photoIds.map(() => '?').join(',')})
        AND ${orgClause}
        AND (p.type = 'video' OR (p.playback_url IS NOT NULL AND p.playback_url <> ''))`, params);
  return rows || [];
}

async function findAssetsByIdsScoped(db, { userId, ids, scope }) {
  const [rows] = await db.query(
    `SELECT * FROM video_editor_assets WHERE user_id = ? AND id IN (${ids.map(() => '?').join(',')})${scope.sql}`,
    [userId, ...ids, ...scope.params]);
  return rows || [];
}

module.exports.findProductionVideoSources = findProductionVideoSources;
module.exports.findAssetsByIdsScoped = findAssetsByIdsScoped;
module.exports.findRenderUser = findRenderUser;
