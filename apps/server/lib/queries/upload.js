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

// ---- 上传后处理（公共下载副本 / 视频封面与转码地址）----
async function findCommittedPhotoByUrl(db, url) {
  const [rows] = await db.query('SELECT id FROM photos WHERE url = ? LIMIT 1', [url]);
  return rows && rows.length ? rows[0] : null;
}

async function setPublicDownloadIfEmpty(db, { photoId, url }) {
  const [result] = await db.query(
    "UPDATE photos SET public_download_url = ? WHERE id = ? AND (public_download_url IS NULL OR public_download_url = '')",
    [url, photoId]);
  return Number(result && result.affectedRows) || 0;
}

async function findPublicDownloadUrl(db, photoId) {
  const [rows] = await db.query('SELECT public_download_url AS publicDownloadUrl FROM photos WHERE id = ? LIMIT 1', [photoId]);
  return rows && rows.length ? rows[0].publicDownloadUrl : null;
}

async function setPlaybackUrl(db, { photoId, url }) {
  const [result] = await db.query('UPDATE photos SET playback_url = ? WHERE id = ?', [url, photoId]);
  return Number(result && result.affectedRows) || 0;
}

async function findPlaybackUrl(db, photoId) {
  const [rows] = await db.query('SELECT playback_url FROM photos WHERE id = ?', [photoId]);
  return rows && rows.length ? rows[0].playback_url : null;
}

async function setThumbUrl(db, { photoId, url }) {
  const [result] = await db.query('UPDATE photos SET thumb_url = ? WHERE id = ?', [url, photoId]);
  return Number(result && result.affectedRows) || 0;
}

async function findThumbUrl(db, photoId) {
  const [rows] = await db.query('SELECT thumb_url FROM photos WHERE id = ?', [photoId]);
  return rows && rows.length ? rows[0].thumb_url : null;
}

async function findLivePhoto(db, { photoId, url }) {
  const [rows] = await db.query('SELECT id FROM photos WHERE id = ? AND url = ? LIMIT 1', [photoId, url]);
  return rows && rows.length ? rows[0] : null;
}

module.exports.findCommittedPhotoByUrl = findCommittedPhotoByUrl;
module.exports.setPublicDownloadIfEmpty = setPublicDownloadIfEmpty;
module.exports.findPublicDownloadUrl = findPublicDownloadUrl;
module.exports.setPlaybackUrl = setPlaybackUrl;
module.exports.findPlaybackUrl = findPlaybackUrl;
module.exports.setThumbUrl = setThumbUrl;
module.exports.findThumbUrl = findThumbUrl;
module.exports.findLivePhoto = findLivePhoto;

/** 仅在为空时写入播放/封面地址（并发上传不覆盖已有值） */
async function setPlaybackIfEmpty(db, { photoId, url }) {
  const [result] = await db.query(
    "UPDATE photos SET playback_url = ? WHERE id = ? AND (playback_url IS NULL OR playback_url = '')", [url, photoId]);
  return Number(result && result.affectedRows) || 0;
}

async function setThumbIfEmpty(db, { photoId, url }) {
  const [result] = await db.query(
    "UPDATE photos SET thumb_url = ? WHERE id = ? AND (thumb_url IS NULL OR thumb_url = '')", [url, photoId]);
  return Number(result && result.affectedRows) || 0;
}

module.exports.setPlaybackIfEmpty = setPlaybackIfEmpty;
module.exports.setThumbIfEmpty = setThumbIfEmpty;

/** 落库照片（三档 schema 降级由调用方决定走哪个） */
async function insertPhotoFull(conn, row) {
  const [result] = await conn.query(
    `INSERT INTO photos
      (uuid, project_id, timeline_section_id, url, thumb_url, playback_url, title, description, tags, ai_status, ai_error, type, photographer_id, organization_id, unit_id, original_filename)
     VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)`,
    [row.projectId || null, row.timelineSectionId || null, row.relPath, row.thumbRel, row.playbackRel || null,
      row.title, row.description, row.tags ? JSON.stringify(row.tags) : null, row.aiStatus || 'pending',
      row.type, row.photographerId || null, row.orgId, row.unitId, row.originalFilename]);
  return result;
}

async function insertPhotoWithoutPlayback(conn, row) {
  const [result] = await conn.query(
    `INSERT INTO photos
      (uuid, project_id, timeline_section_id, url, thumb_url, title, description, tags, ai_status, ai_error, type, photographer_id, organization_id, unit_id, original_filename)
     VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)`,
    [row.projectId || null, row.timelineSectionId || null, row.relPath, row.thumbRel, row.title, row.description,
      row.tags ? JSON.stringify(row.tags) : null, row.aiStatus || 'pending', row.type,
      row.photographerId || null, row.orgId, row.unitId, row.originalFilename]);
  return result;
}

async function insertPhotoLegacy(conn, row) {
  const [result] = await conn.query(
    `INSERT INTO photos
      (uuid, project_id, url, thumb_url, title, description, tags, type, photographer_id, original_filename)
     VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [row.projectId || null, row.relPath, row.thumbRel, row.title, row.description,
      row.tags ? JSON.stringify(row.tags) : null, row.type, row.photographerId || null, row.originalFilename]);
  return result;
}

/** 按 url + 组织查已落库照片（直传 abort 幂等判断） */
async function findCommittedPhotoScoped(db, { url, orgId }) {
  const [rows] = await db.query('SELECT id FROM photos WHERE url = ? AND organization_id <=> ? LIMIT 1', [url, orgId]);
  return rows && rows.length ? rows[0] : null;
}

module.exports.insertPhotoFull = insertPhotoFull;
module.exports.insertPhotoWithoutPlayback = insertPhotoWithoutPlayback;
module.exports.insertPhotoLegacy = insertPhotoLegacy;
module.exports.findCommittedPhotoScoped = findCommittedPhotoScoped;
