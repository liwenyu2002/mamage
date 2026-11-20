// 文件夹分享（folder_shares）dao。权限与错误码留在 routes/folder_shares.js。
async function ensureDesktopWorkspace(conn, { orgId, unitId }) {
  await conn.query(
    `INSERT IGNORE INTO album_desktop_workspaces (organization_id, unit_key, state) VALUES (?, ?, '{"groups":[]}')`,
    [orgId, unitId]);
}

async function listShareableProjects(conn, { orgId, unitId, candidates }) {
  if (!candidates.length) return [];
  const [rows] = await conn.query(
    `SELECT id FROM projects WHERE organization_id = ? AND unit_id = ?
       AND restricted_to_user_id IS NULL AND id IN (?)`, [orgId, unitId, candidates]);
  return rows || [];
}

async function insertFolderShare(conn, row) {
  const [result] = await conn.query(
    `INSERT INTO folder_shares (organization_id, source_unit_id, source_folder_id, folder_name,
       target_unit_id, target_user_id, mode, created_by, expires_at, snapshot_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [row.orgId, row.sourceUnitId, row.sourceFolderId, row.folderName, row.targetUnitId || null,
      row.targetUserId || null, row.mode, row.createdBy, row.expiresAt,
      row.snapshot ? JSON.stringify(row.snapshot) : null]);
  return result;
}

async function insertPublicShareLink(conn, row) {
  const [result] = await conn.query(
    `INSERT INTO share_links (code, share_type, title, created_by,
       organization_id, unit_id, sync_mode, expires_at, folder_share_id)
     VALUES (?, 'collection', ?, ?, ?, ?, ?, ?, ?)`,
    [row.code, row.title, row.createdBy, row.orgId, row.unitId, row.syncMode, row.expiresAt, row.folderShareId]);
  return result;
}

async function fillShareLinkItemsFromFolder(conn, { shareId, folderShareId, orgId, unitId }) {
  await conn.query(
    `INSERT INTO share_link_items (share_id, photo_id, sort_order)
     SELECT ?, ph.id, ph.id FROM photos ph JOIN internal_shares s ON s.project_id = ph.project_id
      WHERE s.folder_share_id = ? AND ph.organization_id = ? AND ph.unit_id = ? AND s.revoked_at IS NULL`,
    [shareId, folderShareId, orgId, unitId]);
}

async function insertAudit(conn, { orgId, unitId, userId, action, resourceType, resourceId, details = null }) {
  await conn.query(
    `INSERT INTO organization_access_audit (organization_id, unit_id, user_id, action, resource_type, resource_id, details)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [orgId, unitId, userId, action, resourceType, resourceId, details ? JSON.stringify(details) : null]);
}

async function lockFolderShare(conn, { id, orgId, unitId }) {
  const [rows] = await conn.query(
    'SELECT id FROM folder_shares WHERE id = ? AND organization_id = ? AND source_unit_id = ? FOR UPDATE',
    [id, orgId, unitId]);
  return rows || [];
}

async function revokeFolderShare(conn, id) {
  await conn.query('UPDATE folder_shares SET revoked_at = NOW() WHERE id = ? AND revoked_at IS NULL', [id]);
  await conn.query('UPDATE internal_shares SET revoked_at = NOW() WHERE folder_share_id = ? AND revoked_at IS NULL', [id]);
  await conn.query('UPDATE share_links SET revoked_at = NOW() WHERE folder_share_id = ? AND revoked_at IS NULL', [id]);
}

async function lockCopyFolderShare(conn, { id, orgId }) {
  const [rows] = await conn.query(
    `SELECT * FROM folder_shares WHERE id = ? AND organization_id = ? AND mode = 'copy'
       AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > NOW()) FOR UPDATE`, [id, orgId]);
  return rows && rows.length ? rows[0] : null;
}

async function requeueFailedCopyJobs(conn, folderShareId) {
  const [rows] = await conn.query(
    `UPDATE organization_copy_jobs j JOIN internal_shares s ON s.id = j.share_id
        SET j.status = 'queued', j.error_code = NULL, j.copied_bytes = 0
      WHERE s.folder_share_id = ? AND s.revoked_at IS NULL AND j.status = 'failed'`, [folderShareId]);
  return Number(rows && rows.affectedRows) || 0;
}

module.exports = {
  ensureDesktopWorkspace, listShareableProjects, insertFolderShare, insertPublicShareLink,
  fillShareLinkItemsFromFolder, insertAudit, lockFolderShare, revokeFolderShare,
  lockCopyFolderShare, requeueFailedCopyJobs,
};
