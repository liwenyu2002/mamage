// 公众号排版作品（wechat_compositions）dao。权限与错误码留在 routes/wechat_compositions.js。
const SUMMARY_COLUMNS = 'id, name, title, draft_kind, block_count, image_count, created_at, updated_at';

async function findDoc(db, { id, userId }) {
  const [rows] = await db.query(
    'SELECT doc FROM wechat_compositions WHERE id = ? AND user_id = ? LIMIT 1', [id, userId]);
  return rows && rows.length ? rows[0] : null;
}

async function saveDoc(db, { id, userId, docJson }) {
  await db.query(
    'UPDATE wechat_compositions SET doc = ?, updated_at = updated_at WHERE id = ? AND user_id = ?',
    [docJson, id, userId]);
}

async function listForUser(db, { userId, scope }) {
  const [rows] = await db.query(
    `SELECT ${SUMMARY_COLUMNS} FROM wechat_compositions WHERE user_id = ?${scope.sql} ORDER BY updated_at DESC`,
    [userId, ...scope.params]);
  return rows || [];
}

async function countForUser(db, { userId, scope }) {
  const [[row]] = await db.query(
    `SELECT COUNT(*) AS cnt FROM wechat_compositions WHERE user_id = ?${scope.sql}`, [userId, ...scope.params]);
  return Number(row && row.cnt) || 0;
}

async function insertComposition(db, row) {
  const [result] = await db.query(
    `INSERT INTO wechat_compositions
       (user_id, org_id, unit_id, name, title, digest, doc, block_config, theme_key, block_count, image_count, draft_kind, source_document, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
    [row.userId, row.orgId, row.unitId, row.name, row.title, row.digest, row.docJson, row.blockConfigJson,
      row.themeKey, row.blockCount, row.imageCount, row.draftKind, row.sourceDocument]);
  return result;
}

async function findSummary(db, id) {
  const [rows] = await db.query(
    'SELECT id, name, created_at, updated_at FROM wechat_compositions WHERE id = ? LIMIT 1', [id]);
  return rows && rows.length ? rows[0] : null;
}

async function findFull(db, { id, userId }) {
  const [rows] = await db.query(
    'SELECT * FROM wechat_compositions WHERE id = ? AND user_id = ? LIMIT 1', [id, userId]);
  return rows && rows.length ? rows[0] : null;
}

async function deleteComposition(db, { id, userId }) {
  const [result] = await db.query('DELETE FROM wechat_compositions WHERE id = ? AND user_id = ?', [id, userId]);
  return Number(result && result.affectedRows) || 0;
}

module.exports = {
  findDoc, saveDoc, listForUser, countForUser, insertComposition, findSummary, findFull, deleteComposition,
};

async function findDetailScoped(db, { id, userId, scope }) {
  const [rows] = await db.query(
    `SELECT * FROM wechat_compositions WHERE id = ? AND user_id = ?${scope.sql} LIMIT 1`, [id, userId, ...scope.params]);
  return rows && rows.length ? rows[0] : null;
}

async function findKindsScoped(db, { id, userId, scope }) {
  const [rows] = await db.query(
    `SELECT id, draft_kind FROM wechat_compositions WHERE id = ? AND user_id = ?${scope.sql} LIMIT 1`,
    [id, userId, ...scope.params]);
  return rows && rows.length ? rows[0] : null;
}

async function updateFields(db, { sets, params }) {
  await db.query(
    `UPDATE wechat_compositions SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`, params);
}

async function findSavedBrief(db, id) {
  const [rows] = await db.query('SELECT id, name, updated_at FROM wechat_compositions WHERE id = ? LIMIT 1', [id]);
  return rows && rows.length ? rows[0] : null;
}

async function findIdScoped(db, { id, userId, scope }) {
  const [rows] = await db.query(
    `SELECT id FROM wechat_compositions WHERE id = ? AND user_id = ?${scope.sql} LIMIT 1`,
    [id, userId, ...scope.params]);
  return rows && rows.length ? rows[0] : null;
}

module.exports.findDetailScoped = findDetailScoped;
module.exports.findKindsScoped = findKindsScoped;
module.exports.updateFields = updateFields;
module.exports.findSavedBrief = findSavedBrief;
module.exports.findIdScoped = findIdScoped;
