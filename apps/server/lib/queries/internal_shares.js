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
