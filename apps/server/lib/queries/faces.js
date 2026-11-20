// 人脸（photo_faces）与人物（face_persons）的 dao 层。
// 只放 SQL 与行整形；权限判定、审计事件、错误码仍留在 routes/faces.js。
const { usableFaceSql } = require('../face_result_policy');

/** 人脸检索审计写入（每次访问记一条） */
async function insertAccessAudit(db, { orgId, unitId, userId, photoId = null }) {
  await db.query(
    `INSERT INTO organization_access_audit
       (organization_id, unit_id, user_id, action, resource_type, resource_id)
     VALUES (?, ?, ?, 'face.search', 'photo', ?)`,
    [orgId, unitId, userId, Number.isSafeInteger(photoId) ? photoId : null]);
}

/** 锁住某人物名下所有可用人脸 */
async function lockUsableFacesOfPerson(conn, personId, orgId) {
  const [rows] = await conn.query(
    `SELECT * FROM photo_faces WHERE person_id = ? AND organization_id = ? AND ${usableFaceSql()} FOR UPDATE`,
    [personId, orgId]);
  return rows || [];
}

/** 取下一个人物编号（组织内自增，行锁保护） */
async function nextPersonNo(conn, orgId) {
  const [rows] = await conn.query(
    'SELECT COALESCE(MAX(person_no), 0) AS maxNo FROM face_persons WHERE organization_id = ? FOR UPDATE', [orgId]);
  return ((rows && rows[0] && Number(rows[0].maxNo)) || 0) + 1;
}

async function insertFacePerson(conn, { orgId, personNo, name, note, createdBy }) {
  const [result] = await conn.query(
    'INSERT INTO face_persons (organization_id, person_no, name, note, created_by) VALUES (?, ?, ?, ?, ?)',
    [orgId, personNo, name || null, note || null, createdBy ?? null]);
  return result;
}

/** 批量取人脸的 extra（合并/拆分时逐脸合并元数据） */
async function listFaceExtras(conn, faceIds) {
  if (!Array.isArray(faceIds) || !faceIds.length) return [];
  const [rows] = await conn.query('SELECT id, extra FROM photo_faces WHERE id IN (?)', [faceIds]);
  return rows || [];
}

/** 把一张脸改挂到目标人物（带原人物与组织约束，防越权） */
async function reassignFace(conn, { faceId, fromPersonId, toPersonId, orgId, extra }) {
  const [result] = await conn.query(
    `UPDATE photo_faces SET person_id = ?, status = 'confirmed', extra = ?
      WHERE id = ? AND person_id = ? AND organization_id = ? AND ${usableFaceSql()}`,
    [toPersonId, extra, faceId, fromPersonId, orgId]);
  return Number(result && result.affectedRows) || 0;
}

/** 取某人物可用人脸里检测分最高的一张（封面候选） */
async function pickBestFaceId(conn, personId, orgId) {
  const [rows] = await conn.query(
    `SELECT id FROM photo_faces WHERE person_id = ? AND organization_id = ? AND ${usableFaceSql()}
      ORDER BY detection_score DESC, id ASC LIMIT 1`,
    [personId, orgId]);
  return rows && rows.length ? rows[0].id : null;
}

async function setPersonCover(conn, personId, faceId) {
  await conn.query('UPDATE face_persons SET cover_face_id = ? WHERE id = ?', [faceId ?? null, personId]);
}

/** 人脸归属人物（确认/取消确认） */
async function setFacePerson(db, { faceId, personId }) {
  await db.query('UPDATE photo_faces SET person_id = ?, status = ? WHERE id = ?',
    [personId, personId ? 'confirmed' : 'pending', faceId]);
}

module.exports = {
  insertAccessAudit,
  lockUsableFacesOfPerson,
  nextPersonNo,
  insertFacePerson,
  listFaceExtras,
  reassignFace,
  pickBestFaceId,
  setPersonCover,
  setFacePerson,
};

// ---- 人物合并 ----
async function lockPerson(conn, { orgId, personId }) {
  const [rows] = await conn.query(
    'SELECT id, name, note, cover_face_id AS coverFaceId FROM face_persons WHERE organization_id = ? AND id = ? LIMIT 1 FOR UPDATE',
    [orgId, personId]);
  return rows && rows.length ? rows[0] : null;
}

async function lockPersons(conn, { orgId, personIds }) {
  const [rows] = await conn.query(
    'SELECT id, name, note, cover_face_id AS coverFaceId FROM face_persons WHERE organization_id = ? AND id IN (?) FOR UPDATE',
    [orgId, personIds]);
  return rows || [];
}

async function lockFacesOfPersons(conn, { orgId, personIds }) {
  const [rows] = await conn.query(
    `SELECT * FROM photo_faces WHERE organization_id = ? AND person_id IN (?) AND ${usableFaceSql()} ORDER BY id FOR UPDATE`,
    [orgId, personIds]);
  return rows || [];
}

async function moveFacesToPerson(conn, { orgId, targetPersonId, sourcePersonIds }) {
  const [result] = await conn.query(
    `UPDATE photo_faces SET person_id = ?, status = 'confirmed' WHERE organization_id = ? AND person_id IN (?) AND ${usableFaceSql()}`,
    [targetPersonId, orgId, sourcePersonIds]);
  return Number(result && result.affectedRows) || 0;
}

async function updatePersonMeta(conn, { orgId, personId, name, note, coverFaceId }) {
  await conn.query(
    'UPDATE face_persons SET name = ?, note = ?, cover_face_id = ? WHERE organization_id = ? AND id = ?',
    [name, note, coverFaceId, orgId, personId]);
}

async function deletePersons(conn, { orgId, personIds }) {
  const [result] = await conn.query('DELETE FROM face_persons WHERE organization_id = ? AND id IN (?)', [orgId, personIds]);
  return Number(result && result.affectedRows) || 0;
}

module.exports.lockPerson = lockPerson;
module.exports.lockPersons = lockPersons;
module.exports.lockFacesOfPersons = lockFacesOfPersons;
module.exports.moveFacesToPerson = moveFacesToPerson;
module.exports.updatePersonMeta = updatePersonMeta;
module.exports.deletePersons = deletePersons;

// ---- 单脸标注 / 检测落库 ----
async function lockFaceById(conn, { faceId, orgId }) {
  const [rows] = await conn.query(
    `SELECT * FROM photo_faces WHERE id = ? AND organization_id <=> ? AND ${usableFaceSql()} FOR UPDATE`, [faceId, orgId]);
  return rows || [];
}

async function findPersonIdForLabel(conn, { personId, orgId, appendOrgScope }) {
  const params = [personId];
  let sql = appendOrgScope('SELECT id FROM face_persons WHERE id = ?', 'face_persons', orgId, params);
  sql += ' LIMIT 1';
  const [rows] = await conn.query(sql, params);
  return rows && rows.length ? rows[0] : null;
}

async function findPersonIdByName(conn, { name, orgId, appendOrgScope }) {
  const params = [name];
  let sql = appendOrgScope('SELECT id FROM face_persons WHERE name = ?', 'face_persons', orgId, params);
  sql += ` ORDER BY EXISTS (SELECT 1 FROM photo_faces named
    WHERE named.person_id = face_persons.id AND ${usableFaceSql('named')}) DESC,
    updated_at DESC, id DESC LIMIT 1`;
  const [rows] = await conn.query(sql, params);
  return rows && rows.length ? Number(rows[0].id) : null;
}

async function nextPersonNoScoped(conn, { orgId, appendOrgScope }) {
  const params = [];
  const sql = appendOrgScope('SELECT COALESCE(MAX(person_no), 0) AS maxNo FROM face_persons WHERE 1=1', 'face_persons', orgId, params);
  const [rows] = await conn.query(sql, params);
  return ((rows && rows[0] && Number(rows[0].maxNo)) || 0) + 1;
}

async function insertFacePersonSimple(conn, { orgId, personNo, name, createdBy }) {
  const [result] = await conn.query(
    'INSERT INTO face_persons (organization_id, person_no, name, created_by) VALUES (?, ?, ?, ?)',
    [orgId, personNo, name, createdBy ?? null]);
  return result;
}

async function setFacePersonStatus(db, { faceId, personId, status }) {
  await db.query('UPDATE photo_faces SET person_id = ?, status = ? WHERE id = ?',
    [personId, status, faceId]);
}

/** 重检前清空某照片的旧检测结果（保留人工纠正的行由调用方校验） */
async function deleteFacesOfPhoto(conn, { photoId, orgId }) {
  let sql = 'DELETE FROM photo_faces WHERE photo_id = ?';
  const params = [photoId];
  if (orgId === null) sql += ' AND organization_id IS NULL';
  else { sql += ' AND organization_id = ?'; params.push(orgId); }
  await conn.query(sql, params);
}

module.exports.lockFaceById = lockFaceById;
module.exports.findPersonIdForLabel = findPersonIdForLabel;
module.exports.findPersonIdByName = findPersonIdByName;
module.exports.nextPersonNoScoped = nextPersonNoScoped;
module.exports.insertFacePersonSimple = insertFacePersonSimple;
module.exports.setFacePersonStatus = setFacePersonStatus;
module.exports.deleteFacesOfPhoto = deleteFacesOfPhoto;

/** 人物关联照片总数（scope 由 routes 的关系范围片段提供） */
async function countRelatedPhotos(db, scope) {
  const [rows] = await db.query(`SELECT COUNT(DISTINCT p.id) AS total ${scope.sql}`, scope.params);
  return Number(rows && rows[0] && rows[0].total) || 0;
}

module.exports.countRelatedPhotos = countRelatedPhotos;
