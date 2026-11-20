// 上传落库相关 dao（photos 插入后的读取/回写、相册 photo_ids 追加、语义分析开关）。
// 权限与文件系统操作留在 routes/upload.js。
async function findProjectPhotoIdsForUpdate(conn, projectId) {
  const [rows] = await conn.query('SELECT photo_ids FROM projects WHERE id = ? FOR UPDATE', [projectId]);
  return rows && rows.length ? rows[0] : null;
}

async function writeProjectPhotoIds(conn, projectId, photoIds) {
  await conn.query('UPDATE projects SET photo_ids = ? WHERE id = ?',
    [photoIds.length ? JSON.stringify(photoIds) : null, projectId]);
}

async function findProjectUnitId(conn, projectId) {
  const [rows] = await conn.query('SELECT unit_id FROM projects WHERE id = ? LIMIT 1', [projectId]);
  return rows && rows.length ? rows[0].unit_id : null;
}

async function findCommittedByUrl(db, { url, orgId = null }) {
  const [rows] = await db.query('SELECT id FROM photos WHERE url = ? AND organization_id <=> ? LIMIT 1', [url, orgId]);
  return rows && rows.length ? rows[0] : null;
}

async function findPhotographerName(db, userId) {
  const [rows] = await db.query('SELECT name FROM users WHERE id = ? LIMIT 1', [userId]);
  return rows && rows.length ? rows[0].name || null : null;
}

async function findVideoAiStatus(db, photoId) {
  const [rows] = await db.query("SELECT ai_status FROM photos WHERE id = ? AND type = 'video'", [photoId]);
  return rows && rows.length ? rows[0] : null;
}

async function findSemanticTaskStatus(db, dedupeKey) {
  const [rows] = await db.query("SELECT status FROM runtime_tasks WHERE kind = 'semantic' AND dedupe_key = ?", [String(dedupeKey)]);
  return rows && rows.length ? rows[0] : null;
}

async function markVideoSemanticPending(db, photoId) {
  const [result] = await db.query(
    `UPDATE photos
        SET ai_status = 'pending', ai_error = NULL, ai_started_at = NULL, ai_finished_at = NULL
      WHERE id = ? AND type = 'video'`, [photoId]);
  return Number(result && result.affectedRows) || 0;
}

module.exports = {
  findProjectPhotoIdsForUpdate, writeProjectPhotoIds, findProjectUnitId,
  findCommittedByUrl, findPhotographerName, findVideoAiStatus, findSemanticTaskStatus, markVideoSemanticPending,
};
