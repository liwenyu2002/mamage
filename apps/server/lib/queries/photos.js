// 照片相关 SQL 的 dao 层。
// 约定：只放 SQL 与返回值整形，不做权限判断、不拼业务错误码——那些留在 routes/ 里。
// 新写的查询请优先加到这里，routes 负责编排。

/** 按 token 里的用户 id 取鉴权所需字段 */
async function findAuthUser(db, userId) {
  const [rows] = await db.query('SELECT id, organization_id, role FROM users WHERE id = ? LIMIT 1', [userId]);
  return rows && rows.length ? rows[0] : null;
}

/** 取照片原始文件行（同组织范围）；photoId 为空或跨组织时返回 null */
async function findScopedPhotoSource(db, id, orgId) {
  let sql = 'SELECT id, url, thumb_url AS thumbUrl, public_download_url AS publicDownloadUrl, playback_url AS playbackUrl,'
    + ' title, type, adjustments FROM photos WHERE id = ?';
  const params = [id];
  if (orgId === null) sql += ' AND organization_id IS NULL';
  else { sql += ' AND organization_id = ?'; params.push(orgId); }
  sql += ' LIMIT 1';
  const [rows] = await db.query(sql, params);
  return rows && rows.length ? rows[0] : null;
}

/** 批量删照片（调用方负责事务与关联表） */
async function deletePhotosByIds(conn, ids) {
  if (!Array.isArray(ids) || !ids.length) return { affectedRows: 0 };
  const [result] = await conn.query('DELETE FROM photos WHERE id IN (?)', [ids]);
  return result;
}

/** 锁住相册行并取 photo_ids，用于删除后回写 */
async function lockProjectPhotoIds(conn, projectId) {
  const [rows] = await conn.query('SELECT photo_ids FROM projects WHERE id = ? FOR UPDATE', [projectId]);
  return rows && rows.length ? rows[0] : null;
}

/** 回写相册的 photo_ids（空数组写 NULL） */
async function updateProjectPhotoIds(conn, projectId, photoIds) {
  const payload = Array.isArray(photoIds) && photoIds.length ? JSON.stringify(photoIds) : null;
  await conn.query('UPDATE projects SET photo_ids = ? WHERE id = ?', [payload, projectId]);
}

/** 批量取相册名（下载名拼接用） */
async function findProjectNames(db, projectIds) {
  if (!Array.isArray(projectIds) || !projectIds.length) return [];
  const [rows] = await db.query('SELECT id, name FROM projects WHERE id IN (?)', [projectIds]);
  return rows || [];
}

/** 批量取时间线环节名 */
async function findTimelineSectionNames(db, sectionIds) {
  if (!Array.isArray(sectionIds) || !sectionIds.length) return [];
  const [rows] = await db.query('SELECT id, name FROM project_timeline_sections WHERE id IN (?)', [sectionIds]);
  return rows || [];
}

module.exports = {
  findAuthUser,
  findScopedPhotoSource,
  deletePhotosByIds,
  lockProjectPhotoIds,
  updateProjectPhotoIds,
  findProjectNames,
  findTimelineSectionNames,
};

// ---- 动态条件查询（sql/params 由路由拼接，dao 只执行与整形）----
async function queryDynamic(db, { sql, params }) {
  const [rows] = await db.query(sql, params);
  return rows || [];
}

async function queryDynamicWithFallback(db, { sql, params, fallbackSql }) {
  try {
    const [rows] = await db.query(sql, params);
    return { rows: rows || [], degraded: false };
  } catch (err) {
    if (!fallbackSql) throw err;
    const [rows] = await db.query(fallbackSql, params);
    return { rows: rows || [], degraded: true };
  }
}

async function executeDynamic(conn, { sql, params }) {
  const [result] = await conn.query(sql, params);
  return result;
}

async function lockRowsDynamic(conn, { sql, params }) {
  const [rows] = await conn.query(`${sql} FOR UPDATE`, params);
  return rows || [];
}

module.exports.queryDynamic = queryDynamic;
module.exports.queryDynamicWithFallback = queryDynamicWithFallback;
module.exports.executeDynamic = executeDynamic;
module.exports.lockRowsDynamic = lockRowsDynamic;

/** 素材列表：主查询失败时按降级 SQL 重试（缺列/缺表） */
async function queryWithDegradedFallback(db, { sql, degradedSql, params }) {
  try {
    const [rows] = await db.query(sql, params);
    return rows || [];
  } catch (err) {
    const soft = err && (err.code === 'ER_BAD_FIELD_ERROR' || err.code === 'ER_NO_SUCH_TABLE'
      || /Unknown column|doesn't exist/i.test(String(err.message || '')));
    if (soft && degradedSql) {
      const [rows] = await db.query(degradedSql, params);
      return rows || [];
    }
    throw err;
  }
}

/** 环节归属校验（照片分配到时间线环节前） */
async function findSectionWithProjectScope(conn, { sectionId, orgId }) {
  const [rows] = await conn.query(
    `SELECT s.id, s.project_id AS projectId
       FROM project_timeline_sections s
       JOIN projects p ON p.id = s.project_id
      WHERE s.id = ?${orgId === null ? ' AND p.organization_id IS NULL' : ' AND p.organization_id = ?'}`,
    orgId === null ? [sectionId] : [sectionId, orgId]);
  return rows && rows.length ? rows[0] : null;
}

/** 编辑保存前的归属行（加锁） */
async function lockOwnershipRow(conn, { sql, params }) {
  const [rows] = await conn.query(`${sql} FOR UPDATE`, params);
  return rows || [];
}

/** 编辑保存后回读完整照片行 */
async function findPhotoDetail(db, photoId) {
  const [rows] = await db.query(
    `SELECT p.id, p.project_id AS projectId, p.timeline_section_id AS timelineSectionId,
            pts.name AS timelineSectionName, pts.section_time AS timelineSectionTime,
            p.url, p.thumb_url AS thumbUrl, p.public_download_url AS publicDownloadUrl, p.playback_url AS playbackUrl,
            p.title, p.original_filename AS originalFilename, p.description, p.adjustments, p.tags,
            ai_status AS aiStatus, ai_error AS aiError, ai_started_at AS aiStartedAt, ai_finished_at AS aiFinishedAt
       FROM photos p
       LEFT JOIN project_timeline_sections pts ON p.timeline_section_id = pts.id
      WHERE p.id = ?`, [photoId]);
  return rows && rows.length ? rows[0] : null;
}

module.exports.queryWithDegradedFallback = queryWithDegradedFallback;
module.exports.findSectionWithProjectScope = findSectionWithProjectScope;
module.exports.lockOwnershipRow = lockOwnershipRow;
module.exports.findPhotoDetail = findPhotoDetail;
