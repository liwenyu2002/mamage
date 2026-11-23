// 组织内共享（internal_shares）读写 dao。
// 权限（requireSourceEditor / requireTarget）与错误码留在 routes/internal_shares.js。
const { photoOwnerFilter } = require('../access_policy');

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
  return result.insertId;
}

async function insertShareItems(conn, rows) {
  if (!rows.length) return;
  await conn.query('INSERT INTO internal_share_items (share_id, photo_id, snapshot_json) VALUES ?', [rows]);
}

async function insertSystemCopyJob(conn, { shareId, orgId, targetUnitId, requestedBy }) {
  const [result] = await conn.query(
    `INSERT INTO organization_copy_jobs (share_id, organization_id, target_unit_id, requested_by, system_initiated)
     VALUES (?, ?, ?, ?, 1)`, [shareId, orgId, targetUnitId, requestedBy]);
  return result.insertId;
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

async function listReceivedShares(db, scope) {
  const { orgId, unitId, userId, ownPhotosOnly } = scope;
  const owner = photoOwnerFilter(scope, 'ph');
  const [rows] = await db.query(
    `SELECT s.id, s.share_type AS shareType, s.mode, s.project_id AS projectId,
            s.expires_at AS expiresAt, s.created_at AS createdAt,
            source.name AS sourceUnitName, org.name AS sourceOrganizationName,
            sharer.name AS sharedByName, p.name AS albumName,
            (SELECT COUNT(*) FROM internal_share_items si JOIN photos ph ON ph.id = si.photo_id
              WHERE si.share_id = s.id${owner.sql}) AS snapshotCount,
            (SELECT j.status FROM organization_copy_jobs j
             WHERE j.share_id = s.id AND j.system_initiated = 1 ORDER BY j.id DESC LIMIT 1) AS copyStatus,
            ${ownPhotosOnly ? 'NULL' : `(SELECT j.result_json FROM organization_copy_jobs j
             WHERE j.share_id = s.id AND j.system_initiated = 1 ORDER BY j.id DESC LIMIT 1)`} AS copyResult
     FROM internal_shares s
     JOIN organization_units source ON source.id = s.source_unit_id
     JOIN organizations org ON org.id = s.organization_id
     LEFT JOIN users sharer ON sharer.id = s.created_by
     LEFT JOIN projects p ON p.id = s.project_id
     WHERE s.organization_id = ? AND s.target_unit_id = ?
       AND s.folder_share_id IS NULL
       AND (s.target_user_id IS NULL OR s.target_user_id = ?)
       AND s.revoked_at IS NULL AND (s.expires_at IS NULL OR s.expires_at > NOW())
     ORDER BY s.created_at DESC LIMIT 200`, [...owner.params, orgId, unitId, userId]);
  return rows;
}

async function listSentShares(db, scope) {
  const owner = photoOwnerFilter(scope, 'ph');
  const [rows] = await db.query(
    `SELECT s.id, s.share_type AS shareType, s.mode, s.project_id AS projectId,
            s.expires_at AS expiresAt, s.revoked_at AS revokedAt,
            s.created_at AS createdAt, target.name AS targetUnitName,
            recipient.name AS targetUserName, p.name AS albumName,
            (SELECT ph.thumb_url FROM photos ph WHERE ph.project_id = p.id AND ph.organization_id = p.organization_id${owner.sql}
              ORDER BY ph.created_at DESC, ph.id DESC LIMIT 1) AS coverThumb,
            (SELECT ph.id FROM photos ph WHERE ph.project_id = p.id AND ph.organization_id = p.organization_id${owner.sql}
              ORDER BY ph.created_at DESC, ph.id DESC LIMIT 1) AS coverPhotoId,
            (SELECT COUNT(*) FROM photos ph WHERE ph.project_id = p.id AND ph.organization_id = s.organization_id${owner.sql}) AS photoCount,
            (SELECT j.status FROM organization_copy_jobs j
             WHERE j.share_id = s.id AND j.system_initiated = 1 ORDER BY j.id DESC LIMIT 1) AS copyStatus
     FROM internal_shares s
     JOIN organization_units target ON target.id = s.target_unit_id
     LEFT JOIN users recipient ON recipient.id = s.target_user_id
     LEFT JOIN projects p ON p.id = s.project_id
     WHERE s.organization_id = ? AND s.source_unit_id = ?
       AND s.folder_share_id IS NULL
     ORDER BY s.created_at DESC LIMIT 200`,
    [...owner.params, ...owner.params, ...owner.params, scope.orgId, scope.unitId]);
  return rows;
}

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

async function findShareInOrganization(db, { shareId, orgId }) {
  const [rows] = await db.query(
    `SELECT s.*, p.name AS albumName, source.name AS sourceUnitName,
            org.name AS sourceOrganizationName, sharer.name AS sharedByName
       FROM internal_shares s
       JOIN organization_units source ON source.id = s.source_unit_id
       JOIN organizations org ON org.id = s.organization_id
       LEFT JOIN users sharer ON sharer.id = s.created_by
       LEFT JOIN projects p ON p.id = s.project_id
      WHERE s.id = ? AND s.organization_id = ? LIMIT 1`, [shareId, orgId]);
  return rows && rows.length ? rows[0] : null;
}

async function insertCopyJob(db, { shareId, orgId, unitId, requestedBy, targetProjectId }) {
  const [result] = await db.query(
    `INSERT INTO organization_copy_jobs
       (share_id, organization_id, target_unit_id, requested_by, target_project_id)
     VALUES (?, ?, ?, ?, ?)`,
    [shareId, orgId, unitId, requestedBy, targetProjectId]);
  return result.insertId;
}

async function listSharePhotoPage(db, scope, { source, limit, offset }) {
  let from;
  let order;
  let params;
  if (source.kind === 'collection') {
    from = `FROM internal_share_items si JOIN photos ph ON ph.id = si.photo_id
       WHERE si.share_id = ? AND ph.organization_id = ?`;
    params = [source.shareId, scope.orgId];
    order = 'ORDER BY si.created_at, si.id';
  } else if (source.kind === 'album' || source.kind === 'copy') {
    from = 'FROM photos ph WHERE ph.project_id = ? AND ph.organization_id = ?';
    params = [source.projectId, scope.orgId];
    if (source.kind === 'copy') {
      from += ' AND ph.unit_id = ?';
      params.push(scope.unitId);
    }
    order = 'ORDER BY ph.created_at DESC, ph.id DESC';
  } else {
    throw new TypeError('Invalid share photo source');
  }
  const owner = photoOwnerFilter(scope, 'ph');
  from += owner.sql;
  params.push(...owner.params);
  const [[count]] = await db.query(`SELECT COUNT(*) AS total ${from}`, params);
  const [photos] = await db.query(
    `SELECT ph.id, ph.project_id AS projectId, ph.title, ph.type, ph.url,
            ph.thumb_url AS thumbUrl, ph.playback_url AS playbackUrl,
            ph.tags, ph.description, ph.adjustments
       ${from} ${order} LIMIT ? OFFSET ?`, [...params, limit, offset]);
  return { total: Number(count?.total) || 0, photos };
}

/** 复制模式：源相册快照（项目 + 环节 + 照片行） */
async function loadCopySnapshot(conn, { shareType, projectId, photoIds, orgId, unitId }) {
  let project = null;
  let sections = [];
  if (shareType === 'album') {
    project = await findSourceAlbum(conn, { projectId, orgId, unitId });
    if (!project) return null;
    sections = await listSourceSections(conn, projectId);
  }
  const photos = await lockSourcePhotos(conn, { shareType, projectId, photoIds, orgId, unitId });
  return { project, sections, photos };
}

module.exports = {
  findReusableAlbumShare, insertShare, insertShareItems, insertSystemCopyJob, insertAccessAudit,
  findShareForRevoke, revokeShare, loadCopySnapshot, listReceivedShares, listSentShares, findCopyShare,
  findAutomaticCopyJob, requeueCopyJob, findTargetProject, findActiveCopyJob, findLatestCopyJob,
  findCopyJob, findShareInOrganization, insertCopyJob, listSharePhotoPage,
};
