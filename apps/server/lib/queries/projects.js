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
