// 相册（projects）与时间线环节（project_timeline_sections）的 dao 层。
// 约定同 lib/queries/photos.js：只放 SQL 与行整形，不做权限判断与错误码。

const SECTION_COLUMNS = 'id, project_id AS projectId, name, section_time AS sectionTime, sort_order AS sortOrder';

/** 批量取时间线环节，按相册分组 */
async function listTimelineSectionsByProjects(db, projectIds) {
  const ids = (Array.isArray(projectIds) ? projectIds : [projectIds])
    .map(Number).filter(id => Number.isFinite(id) && id > 0);
  if (!ids.length) return [];
  const [rows] = await db.query(
    `SELECT ${SECTION_COLUMNS} FROM project_timeline_sections
      WHERE project_id IN (?) ORDER BY project_id ASC, sort_order ASC, id ASC`, [ids]);
  return rows || [];
}

/** 锁住某相册的环节行（替换环节前用） */
async function lockTimelineSections(conn, projectId) {
  const [rows] = await conn.query(
    'SELECT id, name FROM project_timeline_sections WHERE project_id = ? FOR UPDATE', [projectId]);
  return rows || [];
}

async function updateTimelineSection(conn, { id, projectId, name, sectionTime, sortOrder }) {
  await conn.query(
    `UPDATE project_timeline_sections
        SET name = ?, section_time = ?, sort_order = ?, updated_at = NOW()
      WHERE id = ? AND project_id = ?`,
    [name, sectionTime || null, sortOrder, id, projectId]);
}

async function insertTimelineSection(conn, { projectId, name, sectionTime, sortOrder }) {
  const [result] = await conn.query(
    `INSERT INTO project_timeline_sections (project_id, name, section_time, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, NOW(), NOW())`,
    [projectId, name, sectionTime || null, sortOrder]);
  return result;
}

async function deleteTimelineSectionsExcept(conn, projectId, keepIds) {
  if (Array.isArray(keepIds) && keepIds.length) {
    await conn.query('DELETE FROM project_timeline_sections WHERE project_id = ? AND id NOT IN (?)', [projectId, keepIds]);
    return;
  }
  await conn.query('DELETE FROM project_timeline_sections WHERE project_id = ?', [projectId]);
}

async function findTimelineSectionByName(db, projectId, name, excludeId = null) {
  const sql = excludeId
    ? 'SELECT id FROM project_timeline_sections WHERE project_id = ? AND name = ? AND id <> ?'
    : 'SELECT id FROM project_timeline_sections WHERE project_id = ? AND name = ?';
  const params = excludeId ? [projectId, name, excludeId] : [projectId, name];
  const [rows] = await db.query(sql, params);
  return rows || [];
}

async function nextTimelineSortOrder(db, projectId) {
  const [[row]] = await db.query(
    'SELECT COALESCE(MAX(sort_order), -1) AS maxOrder FROM project_timeline_sections WHERE project_id = ?', [projectId]);
  return Number(row && row.maxOrder) + 1;
}

async function insertTimelineSectionDirect(db, { projectId, name, sectionTime, sortOrder }) {
  const [result] = await db.query(
    `INSERT INTO project_timeline_sections (project_id, name, section_time, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, NOW(), NOW())`,
    [projectId, name, sectionTime, sortOrder]);
  return result;
}

async function findTimelineSectionById(db, sectionId, projectId) {
  const [rows] = await db.query('SELECT id FROM project_timeline_sections WHERE id = ? AND project_id = ?', [sectionId, projectId]);
  return rows || [];
}

async function updateTimelineSectionFields(db, { sets, params, sectionId, projectId }) {
  await db.query(
    `UPDATE project_timeline_sections SET ${sets.join(', ')}, updated_at = NOW() WHERE id = ? AND project_id = ?`,
    [...params, sectionId, projectId]);
}

async function findTimelineSectionRow(db, sectionId) {
  const [[row]] = await db.query(
    `SELECT ${SECTION_COLUMNS} FROM project_timeline_sections WHERE id = ?`, [sectionId]);
  return row || null;
}

module.exports = {
  listTimelineSectionsByProjects,
  lockTimelineSections,
  updateTimelineSection,
  insertTimelineSection,
  deleteTimelineSectionsExcept,
  findTimelineSectionByName,
  nextTimelineSortOrder,
  insertTimelineSectionDirect,
  findTimelineSectionById,
  updateTimelineSectionFields,
  findTimelineSectionRow,
};

// ---- 时间线环节：删除 / 重排 / 归属查询 ----
async function deleteTimelineSection(conn, { sectionId, projectId }) {
  const [result] = await conn.query('DELETE FROM project_timeline_sections WHERE id = ? AND project_id = ?', [sectionId, projectId]);
  return Number(result && result.affectedRows) || 0;
}

async function unassignPhotosFromSection(conn, { projectId, sectionId }) {
  const [result] = await conn.query(
    'UPDATE photos SET timeline_section_id = NULL WHERE project_id = ? AND timeline_section_id = ?', [projectId, sectionId]);
  return Number(result && result.affectedRows) || 0;
}

async function listSectionIdsInProject(db, { projectId, ids }) {
  const [rows] = await db.query('SELECT id FROM project_timeline_sections WHERE project_id = ? AND id IN (?)', [projectId, ids]);
  return rows || [];
}

async function writeSectionSortOrder(conn, { projectId, sectionId, sortOrder }) {
  await conn.query('UPDATE project_timeline_sections SET sort_order = ?, updated_at = NOW() WHERE id = ? AND project_id = ?',
    [sortOrder, sectionId, projectId]);
}

// ---- 相册删除 ----
async function lockProjectsForDelete(conn, { id, orgId }) {
  let sql = 'SELECT id FROM projects WHERE id = ?';
  const params = [id];
  if (orgId === null) sql += ' AND organization_id IS NULL';
  else { sql += ' AND organization_id = ?'; params.push(orgId); }
  sql += ' FOR UPDATE';
  const [rows] = await conn.query(sql, params);
  return rows || [];
}

async function findForeignPhotosInProject(conn, { projectId, userId }) {
  const [rows] = await conn.query(
    'SELECT id FROM photos WHERE project_id = ? AND NOT (photographer_id <=> ?) LIMIT 1 FOR UPDATE', [projectId, userId]);
  return rows || [];
}

async function lockProjectPhotos(conn, projectId) {
  const [rows] = await conn.query(
    `SELECT id, url, thumb_url AS thumbUrl, public_download_url AS publicDownloadUrl, playback_url AS playbackUrl, adjustments
       FROM photos WHERE project_id = ? FOR UPDATE`, [projectId]);
  return rows || [];
}

async function deletePhotosInProject(conn, projectId) {
  await conn.query('DELETE FROM photos WHERE project_id = ?', [projectId]);
}

async function deleteProjectRow(conn, projectId) {
  const [result] = await conn.query('DELETE FROM projects WHERE id = ?', [projectId]);
  return Number(result && result.affectedRows) || 0;
}

module.exports.deleteTimelineSection = deleteTimelineSection;
module.exports.unassignPhotosFromSection = unassignPhotosFromSection;
module.exports.listSectionIdsInProject = listSectionIdsInProject;
module.exports.writeSectionSortOrder = writeSectionSortOrder;
module.exports.lockProjectsForDelete = lockProjectsForDelete;
module.exports.findForeignPhotosInProject = findForeignPhotosInProject;
module.exports.lockProjectPhotos = lockProjectPhotos;
module.exports.deletePhotosInProject = deletePhotosInProject;
module.exports.deleteProjectRow = deleteProjectRow;

// ---- 列表簇：首页取最新 + 分页 ----
const PROJECT_LIST_COLUMNS = `p.id, p.uuid, p.name AS projectName, p.description, p.event_date AS eventDate,
  p.meta, p.photo_ids AS photoIds, p.tags, p.admin_id AS adminId, p.unit_id AS unitId,
  p.created_at AS createdAt, p.updated_at AS updatedAt`;

/** 最新若干相册（首页用），orgId 为 null 时取"无组织"相册 */
async function listLatestProjects(db, { orgId, unitScope, limit }) {
  let sql = `SELECT ${PROJECT_LIST_COLUMNS} FROM projects p WHERE `;
  const params = [];
  if (orgId === null) sql += 'p.organization_id IS NULL';
  else { sql += 'p.organization_id = ?'; params.push(orgId); }
  if (unitScope && unitScope.sql) { sql += ` AND ${unitScope.sql}`; params.push(...unitScope.params); }
  sql += ' ORDER BY p.created_at DESC LIMIT ?';
  params.push(limit);
  const [rows] = await db.query(sql, params);
  return rows || [];
}

async function countProjects(db, { whereSql, params }) {
  const [rows] = await db.query(`SELECT COUNT(*) AS total FROM projects p ${whereSql}`, params);
  return Number(rows && rows[0] && rows[0].total) || 0;
}

async function listProjectsPage(db, { whereSql, params, orderBySql, pageSize, offset }) {
  const [rows] = await db.query(
    `SELECT ${PROJECT_LIST_COLUMNS} FROM projects p ${whereSql} ORDER BY ${orderBySql} LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]);
  return rows || [];
}

module.exports.listLatestProjects = listLatestProjects;
module.exports.countProjects = countProjects;
module.exports.listProjectsPage = listProjectsPage;

/** 单个相册的列表视图字段（详情/创建后回读共用） */
async function findProjectSummary(db, projectId) {
  const [rows] = await db.query(
    `SELECT p.id, p.uuid, p.name AS projectName, p.description, p.event_date AS eventDate,
            p.meta, p.photo_ids AS photoIds, p.tags, p.admin_id AS adminId,
            p.created_at AS createdAt, p.updated_at AS updatedAt
       FROM projects p WHERE p.id = ?`, [projectId]);
  return rows && rows.length ? rows[0] : null;
}

/** 相册内照片（封面计算用） */
async function listProjectPhotosForCover(db, projectId) {
  const [rows] = await db.query(
    `SELECT id, project_id AS projectId, url, thumb_url AS thumbUrl, tags, type, created_at
       FROM photos WHERE project_id = ? ORDER BY created_at DESC, id DESC`, [projectId]);
  return rows || [];
}

module.exports.findProjectSummary = findProjectSummary;
module.exports.listProjectPhotosForCover = listProjectPhotosForCover;

/** 相册内照片（带 owner 过滤，封面计算用） */
async function listProjectPhotosForCoverScoped(db, { projectId, owner }) {
  const [photos] = await db.query(
    `SELECT id, project_id AS projectId, url, thumb_url AS thumbUrl, tags, type, created_at
       FROM photos WHERE project_id = ?${owner.sql} ORDER BY created_at DESC, id DESC`,
    [projectId, ...owner.params]);
  return photos || [];
}

/** 清理指向已删环节的照片归属 */
async function clearOrphanSectionAssignments(conn, projectId) {
  await conn.query(
    `UPDATE photos p
       LEFT JOIN project_timeline_sections pts
         ON p.timeline_section_id = pts.id AND pts.project_id = ?
       SET p.timeline_section_id = NULL
      WHERE p.project_id = ? AND p.timeline_section_id IS NOT NULL AND pts.id IS NULL`,
    [projectId, projectId]);
}

/** 按组织范围取相册 id（元数据接口用） */
async function findScopedProjectId(db, { projectId, orgId }) {
  let sql = 'SELECT id FROM projects WHERE id = ?';
  const params = [projectId];
  if (orgId === null) sql += ' AND organization_id IS NULL';
  else { sql += ' AND organization_id = ?'; params.push(orgId); }
  const [rows] = await db.query(sql, params);
  return rows && rows.length ? rows[0] : null;
}

module.exports.listProjectPhotosForCoverScoped = listProjectPhotosForCoverScoped;
module.exports.clearOrphanSectionAssignments = clearOrphanSectionAssignments;
module.exports.findScopedProjectId = findScopedProjectId;

/** 通用执行：动态 SQL 由路由拼接，dao 只负责执行 */
async function queryRows(db, { sql, params }) {
  const [rows] = await db.query(sql, params);
  return rows || [];
}

async function lockRows(conn, { sql, params }) {
  const [rows] = await conn.query(`${sql} FOR UPDATE`, params);
  return rows || [];
}

async function executeDynamic(conn, { sql, params }) {
  const [result] = await conn.query(sql, params);
  return result;
}

module.exports.queryRows = queryRows;
module.exports.lockRows = lockRows;
module.exports.executeDynamic = executeDynamic;

async function findAuthUser(db, userId) {
  const [rows] = await db.query('SELECT id, organization_id, role FROM users WHERE id = ? LIMIT 1', [userId]);
  return rows && rows.length ? rows[0] : null;
}

async function findProjectUnitId(db, projectId) {
  const [rows] = await db.query('SELECT unit_id FROM projects WHERE id = ? LIMIT 1', [projectId]);
  return rows && rows.length ? rows[0].unit_id : null;
}

module.exports.findAuthUser = findAuthUser;
module.exports.findProjectUnitId = findProjectUnitId;

/** 新建相册（含无 organization_id 列的老 schema 降级） */
async function insertProjectFull(conn, row) {
  const [result] = await conn.query(
    `INSERT INTO projects (uuid, name, description, event_date, meta, tags, admin_id, organization_id, unit_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
    [row.uuid, row.name, row.description, row.eventDate, row.metaJson, row.tagsJson, row.adminId, row.orgId, row.unitId]);
  return result;
}

async function insertProjectLegacy(conn, row) {
  const [result] = await conn.query(
    `INSERT INTO projects (uuid, name, description, event_date, meta, tags, admin_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
    [row.uuid, row.name, row.description, row.eventDate, row.metaJson, row.tagsJson, row.adminId]);
  return result;
}

module.exports.insertProjectFull = insertProjectFull;
module.exports.insertProjectLegacy = insertProjectLegacy;

async function updateProjectMeta(conn, { id, name, description, eventDate, metaJson, tagsJson }) {
  await conn.query(
    `UPDATE projects SET name = ?, description = ?, event_date = ?, meta = ?, tags = ?, updated_at = NOW()
      WHERE id = ?`,
    [name, description, eventDate, metaJson, tagsJson, id]);
}

module.exports.updateProjectMeta = updateProjectMeta;
