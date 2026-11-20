// 公开分享（share_links / share_link_items）dao。
// 权限与错误码留在 routes/share.js；公开读接口的 SQL 片段（scope.sql）由调用方传入。
async function insertShareLink(conn, row) {
  const [result] = await conn.query(
    `INSERT INTO share_links
       (code, share_type, project_id, title, note, created_by, organization_id, unit_id, sync_mode, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [row.code, row.share_type, row.project_id || null, row.title || null, row.note || null,
      row.created_by || null, row.organization_id || null, row.unit_id || null, row.sync_mode || null, row.expires_at || null]);
  return result;
}

async function revokeByCode(db, { code, orgId, userId, canManageUnit, unitId }) {
  const [result] = await db.query(
    `UPDATE share_links SET revoked_at = NOW()
      WHERE code = ? AND organization_id = ? AND revoked_at IS NULL
        AND (created_by = ? OR (? = 1 AND unit_id = ?))`,
    [code, orgId, userId, canManageUnit ? 1 : 0, unitId || 0]);
  return Number(result && result.affectedRows) || 0;
}

async function findManageableShare(db, { code, orgId, unitId }) {
  const [rows] = await db.query(
    `SELECT id, project_id, share_type, sync_mode, folder_share_id, organization_id, unit_id FROM share_links
      WHERE code = ? AND organization_id = ? AND unit_id = ?
        AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > NOW()) LIMIT 1`,
    [code, orgId, unitId]);
  return rows && rows.length ? rows[0] : null;
}

async function listPendingPhotos(db, { shareId, scope, limit = 500 }) {
  const [rows] = await db.query(
    `SELECT p.id, p.title, p.thumb_url AS thumbUrl, p.created_at AS createdAt
       FROM photos p LEFT JOIN share_link_items si ON si.share_id = ? AND si.photo_id = p.id
      WHERE ${scope.sql} AND si.photo_id IS NULL
      ORDER BY p.created_at DESC LIMIT ?`,
    [shareId, ...scope.params, limit]);
  return rows || [];
}

async function findPhotosInScope(db, { ids, scope }) {
  const [rows] = await db.query(`SELECT p.id FROM photos p WHERE p.id IN (?) AND ${scope.sql}`, [ids, ...scope.params]);
  return rows || [];
}

async function insertShareItemsIgnore(db, rows) {
  if (!rows.length) return;
  await db.query('INSERT IGNORE INTO share_link_items (share_id, photo_id, sort_order) VALUES ?', [rows]);
}

module.exports = {
  insertShareLink, revokeByCode, findManageableShare, listPendingPhotos, findPhotosInScope, insertShareItemsIgnore,
};
