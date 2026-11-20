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
