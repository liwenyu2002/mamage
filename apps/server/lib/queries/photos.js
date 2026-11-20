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
