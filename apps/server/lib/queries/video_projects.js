// 视频工程（video_projects）与渲染任务（video_render_jobs）的 dao 层。
// 只放 SQL；所有者/单位范围片段（scope.sql）由调用方传入，权限判定留在路由。
async function listProjects(db, { userId, scope }) {
  const [rows] = await db.query(
    `SELECT * FROM video_projects WHERE user_id = ?${scope.sql} ORDER BY updated_at DESC`, [userId, ...scope.params]);
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
