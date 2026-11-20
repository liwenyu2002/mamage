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

// ---- 创建流程内的校验与条目写入 ----
async function findProjectInOrg(db, { projectId, orgId }) {
  const [rows] = await db.query('SELECT id FROM projects WHERE id = ? AND organization_id = ? LIMIT 1', [projectId, orgId]);
  return rows || [];
}

async function findPhotoIdsInOrg(db, { photoIds, orgId }) {
  const [rows] = await db.query('SELECT id FROM photos WHERE id IN (?) AND organization_id = ?', [photoIds, orgId]);
  return rows || [];
}

async function insertShareItems(db, values) {
  if (!values.length) return;
  await db.query('INSERT INTO share_link_items (share_id, photo_id, sort_order) VALUES ?', [values]);
}

async function listProjectPhotoIds(db, { projectId, orgId }) {
  const [rows] = await db.query('SELECT id FROM photos WHERE project_id = ? AND organization_id = ? ORDER BY id', [projectId, orgId]);
  return rows || [];
}

module.exports.findProjectInOrg = findProjectInOrg;
module.exports.findPhotoIdsInOrg = findPhotoIdsInOrg;
module.exports.insertShareItems = insertShareItems;
module.exports.listProjectPhotoIds = listProjectPhotoIds;

/** 公开分享详情（含创建者/相册/组织名） */
async function findPublicShare(db, code) {
  const [rows] = await db.query(
    `SELECT s.*, u.name AS creatorName, p.name AS projectName, o.name AS organizationName
       FROM share_links s
       LEFT JOIN users u ON s.created_by = u.id
       LEFT JOIN projects p ON s.project_id = p.id AND s.share_type = 'project'
       LEFT JOIN organizations o ON s.organization_id = o.id
      WHERE s.code = ? LIMIT 1`, [code]);
  return rows && rows.length ? rows[0] : null;
}

async function listTimelineSections(db, projectId) {
  const [rows] = await db.query(
    `SELECT id, project_id AS projectId, name, section_time AS sectionTime, sort_order AS sortOrder
       FROM project_timeline_sections WHERE project_id = ? ORDER BY sort_order ASC, id ASC`, [projectId]);
  return rows || [];
}

/** 公开页照片分页（两种 SQL 由路由拼好后传入，避免重复模板） */
async function queryRows(db, { sql, params }) {
  const [rows] = await db.query(sql, params);
  return rows || [];
}

/** 我创建的分享列表（SQL 由路由拼装） */
async function queryMineShares(db, { sql, params }) {
  const [rows] = await db.query(sql, params);
  return rows || [];
}

module.exports.findPublicShare = findPublicShare;
module.exports.listTimelineSections = listTimelineSections;
module.exports.queryRows = queryRows;
module.exports.queryMineShares = queryMineShares;
