// 组织内共享（internal_shares）读写 dao。
// 权限（requireSourceEditor / requireTarget）与错误码留在 routes/internal_shares.js。
const SHARE_SUMMARY = `id, share_type AS shareType, mode, project_id AS projectId, expires_at AS expiresAt,
  created_at AS createdAt, target_unit_id AS targetUnitId, target_user_id AS targetUserId,
  (SELECT COUNT(*) FROM internal_share_items si WHERE si.share_id = s.id) AS snapshotCount`;

/** 同相册 + 同目标 + 同模式的幂等查重 */
async function findReusableAlbumShare(db, { orgId, sourceUnitId, targetUnitId, targetUserId, projectId, mode }) {
  const [rows] = await db.query(
    `SELECT ${SHARE_SUMMARY}
       FROM internal_shares s
      WHERE organization_id = ? AND source_unit_id = ? AND target_unit_id = ?
        AND ((target_user_id IS NULL AND ? IS NULL) OR target_user_id = ?)
        AND share_type = 'album' AND project_id = ? AND mode = ?
        AND folder_share_id IS NULL AND revoked_at IS NULL
        AND (expires_at IS NULL OR expires_at > NOW())
      ORDER BY id DESC LIMIT 1`,
    [orgId, sourceUnitId, targetUnitId, targetUserId, targetUserId, projectId, mode]);
  return rows && rows.length ? rows[0] : null;
}

async function insertShare(conn, { orgId, sourceUnitId, targetUnitId, targetUserId, shareType, mode, projectId, createdBy, expiresAt, snapshot }) {
  const [result] = await conn.query(
    `INSERT INTO internal_shares
       (organization_id, source_unit_id, target_unit_id, target_user_id,
        share_type, mode, project_id, created_by, expires_at, snapshot_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [orgId, sourceUnitId, targetUnitId, targetUserId, shareType, mode, projectId, createdBy, expiresAt,
      snapshot ? JSON.stringify(snapshot) : null]);
  return result;
}

async function insertShareItems(conn, rows) {
  if (!rows.length) return;
  await conn.query('INSERT INTO internal_share_items (share_id, photo_id, snapshot_json) VALUES ?', [rows]);
}

async function insertCopyJob(conn, { shareId, orgId, targetUnitId, requestedBy }) {
  const [result] = await conn.query(
    `INSERT INTO organization_copy_jobs (share_id, organization_id, target_unit_id, requested_by, system_initiated)
     VALUES (?, ?, ?, ?, 1)`, [shareId, orgId, targetUnitId, requestedBy]);
  return result;
}

async function insertAccessAudit(conn, { orgId, unitId, userId, action, resourceType, resourceId, details = null }) {
  await conn.query(
    `INSERT INTO organization_access_audit
       (organization_id, unit_id, user_id, action, resource_type, resource_id, details)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [orgId, unitId, userId, action, resourceType, resourceId, details ? JSON.stringify(details) : null]);
}

async function findShareForRevoke(db, { id, orgId }) {
  const [rows] = await db.query(
    'SELECT source_unit_id, folder_share_id FROM internal_shares WHERE id = ? AND organization_id = ? LIMIT 1', [id, orgId]);
  return rows && rows.length ? rows[0] : null;
}

async function revokeShare(conn, id) {
  await conn.query('UPDATE internal_shares SET revoked_at = NOW() WHERE id = ? AND revoked_at IS NULL', [id]);
}

module.exports = {
  findReusableAlbumShare, insertShare, insertShareItems, insertCopyJob,
  insertAccessAudit, findShareForRevoke, revokeShare,
};

// ---- 复制模式快照 ----
async function findSourceAlbum(conn, { projectId, orgId, unitId }) {
  const [rows] = await conn.query(
    'SELECT name, description, event_date, meta, tags, type FROM projects WHERE id = ? AND organization_id = ? AND unit_id = ? LIMIT 1',
    [projectId, orgId, unitId]);
  return rows && rows.length ? rows[0] : null;
}

async function listSourceSections(conn, projectId) {
  const [rows] = await conn.query(
    'SELECT id, name, section_time, sort_order FROM project_timeline_sections WHERE project_id = ? ORDER BY sort_order, id',
    [projectId]);
  return rows || [];
}

async function lockSourcePhotos(conn, { shareType, projectId, photoIds, orgId, unitId }) {
  const [rows] = await conn.query(
    shareType === 'album'
      ? 'SELECT ph.*, p.name AS source_album_name FROM photos ph JOIN projects p ON p.id = ph.project_id WHERE ph.project_id = ? AND ph.organization_id = ? AND ph.unit_id = ? ORDER BY ph.id FOR SHARE'
      : 'SELECT ph.*, p.name AS source_album_name FROM photos ph LEFT JOIN projects p ON p.id = ph.project_id WHERE ph.id IN (?) AND ph.organization_id = ? AND ph.unit_id = ? ORDER BY ph.id FOR SHARE',
    [shareType === 'album' ? projectId : photoIds, orgId, unitId]);
  return rows || [];
}

/** 通用执行：动态 SQL 由路由拼接 */
async function queryRows(db, { sql, params }) {
  const [rows] = await db.query(sql, params);
  return rows || [];
}

async function executeDynamic(db, { sql, params }) {
  const [result] = await db.query(sql, params);
  return result;
}

async function countScalar(db, { sql, params }) {
  const [[row]] = await db.query(sql, params);
  return Number(row && row.total) || 0;
}

module.exports.findSourceAlbum = findSourceAlbum;
module.exports.listSourceSections = listSourceSections;
module.exports.lockSourcePhotos = lockSourcePhotos;
module.exports.queryRows = queryRows;
module.exports.executeDynamic = executeDynamic;
module.exports.countScalar = countScalar;

// ---- 复制任务 ----
async function findCopyShare(db, { shareId, orgId, unitId, userId }) {
  const [rows] = await db.query(
    `SELECT * FROM internal_shares WHERE id = ? AND organization_id = ? AND mode = 'copy'
       AND target_unit_id = ? AND (target_user_id IS NULL OR target_user_id = ?)
       AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > NOW()) LIMIT 1`,
    [shareId, orgId, unitId, userId]);
  return rows && rows.length ? rows[0] : null;
}

async function findAutomaticCopyJob(db, shareId) {
  const [rows] = await db.query(
    `SELECT id, status, estimated_bytes AS estimatedBytes, copied_bytes AS copiedBytes, result_json AS result
       FROM organization_copy_jobs WHERE share_id = ? AND system_initiated = 1
      ORDER BY id DESC LIMIT 1`, [shareId]);
  return rows && rows.length ? rows[0] : null;
}

async function requeueCopyJob(db, jobId) {
  await db.query(
    `UPDATE organization_copy_jobs
        SET status = 'queued', manifest_json = NULL, estimated_bytes = 0,
            copied_bytes = 0, error_code = NULL
      WHERE id = ? AND status = 'failed'`, [jobId]);
}

async function findTargetProject(db, { projectId, orgId, unitId }) {
  const [rows] = await db.query(
    'SELECT id FROM projects WHERE id = ? AND organization_id = ? AND unit_id = ? LIMIT 1',
    [projectId, orgId, unitId]);
  return rows && rows.length ? rows[0] : null;
}

async function findActiveCopyJob(db, { shareId, userId, targetProjectId }) {
  const [rows] = await db.query(
    `SELECT id, status, estimated_bytes AS estimatedBytes, copied_bytes AS copiedBytes, result_json AS result
       FROM organization_copy_jobs
      WHERE share_id = ? AND requested_by = ? AND target_project_id <=> ?
        AND status IN ('queued', 'copying', 'ready')
      ORDER BY id DESC LIMIT 1`,
    [shareId, userId, targetProjectId]);
  return rows && rows.length ? rows[0] : null;
}

module.exports.findCopyShare = findCopyShare;
module.exports.findAutomaticCopyJob = findAutomaticCopyJob;
module.exports.requeueCopyJob = requeueCopyJob;
module.exports.findTargetProject = findTargetProject;
module.exports.findActiveCopyJob = findActiveCopyJob;

/** 最新一条系统发起的复制任务（详情页展示状态） */
async function findLatestCopyJob(db, shareId) {
  const [rows] = await db.query(
    `SELECT status, result_json FROM organization_copy_jobs
      WHERE share_id = ? AND system_initiated = 1 ORDER BY id DESC LIMIT 1`, [shareId]);
  return rows && rows.length ? rows[0] : null;
}

async function findCopyJob(db, { jobId, orgId, unitId, userId }) {
  const [rows] = await db.query(
    `SELECT id, share_id AS shareId, status, estimated_bytes AS estimatedBytes,
            copied_bytes AS copiedBytes, result_json AS result, error_code AS errorCode,
            created_at AS createdAt, updated_at AS updatedAt
       FROM organization_copy_jobs
      WHERE id = ? AND organization_id = ? AND target_unit_id = ? AND requested_by = ? LIMIT 1`,
    [jobId, orgId, unitId, userId]);
  return rows && rows.length ? rows[0] : null;
}

async function findShareDetail(db, { shareId, orgId, unitId, userId }) {
  const [rows] = await db.query(
    `SELECT s.*, p.name AS albumName, source.name AS sourceUnitName,
            org.name AS sourceOrganizationName, sharer.name AS sharedByName
       FROM internal_shares s
       JOIN organization_units source ON source.id = s.source_unit_id
       JOIN organizations org ON org.id = s.organization_id
       LEFT JOIN users sharer ON sharer.id = s.created_by
       LEFT JOIN projects p ON p.id = s.project_id
      WHERE s.id = ? AND s.organization_id = ? AND s.target_unit_id = ?
        AND (s.target_user_id IS NULL OR s.target_user_id = ?)`, [shareId, orgId, unitId, userId]);
  return rows && rows.length ? rows[0] : null;
}

module.exports.findLatestCopyJob = findLatestCopyJob;
module.exports.findCopyJob = findCopyJob;
module.exports.findShareDetail = findShareDetail;

async function insertCopyJob(db, { shareId, orgId, unitId, requestedBy, targetProjectId }) {
  const [result] = await db.query(
    `INSERT INTO organization_copy_jobs
       (share_id, organization_id, target_unit_id, requested_by, target_project_id)
     VALUES (?, ?, ?, ?, ?)`,
    [shareId, orgId, unitId, requestedBy, targetProjectId]);
  return result;
}

async function countPhotosInSource(db, { source, params }) {
  const [[row]] = await db.query(`SELECT COUNT(*) AS total ${source}`, params);
  return Number(row && row.total) || 0;
}

async function listSharePhotos(db, { source, order, params, limit, offset }) {
  const [rows] = await db.query(
    `SELECT ph.id, ph.project_id AS projectId, ph.title, ph.type, ph.url,
            ph.thumb_url AS thumbUrl, ph.playback_url AS playbackUrl,
            ph.tags, ph.description, ph.adjustments
       ${source} ${order} LIMIT ? OFFSET ?`, [...params, limit, offset]);
  return rows || [];
}

module.exports.insertCopyJob = insertCopyJob;
module.exports.countPhotosInSource = countPhotosInSource;
module.exports.listSharePhotos = listSharePhotos;
