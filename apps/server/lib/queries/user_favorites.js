// 个人收藏（user_favorites）dao。按 user_id 隔离，scope 片段由路由传入。
async function listForUser(db, { sql, params }) {
  const [rows] = await db.query(sql, params);
  return rows || [];
}

async function findByRef(db, { userId, scope, kind, refKey }) {
  const [rows] = await db.query(
    `SELECT * FROM user_favorites WHERE user_id = ?${scope.sql} AND kind = ? AND ref_key = ? LIMIT 1`,
    [userId, ...scope.params, kind, refKey]);
  return rows && rows.length ? rows[0] : null;
}

async function countByKind(db, { userId, scope, kind }) {
  const [[row]] = await db.query(
    `SELECT COUNT(*) AS cnt FROM user_favorites WHERE user_id = ?${scope.sql} AND kind = ?`,
    [userId, ...scope.params, kind]);
  return Number(row && row.cnt) || 0;
}

async function insertFavorite(db, { userId, unitId, kind, refKey, payloadJson }) {
  const [result] = await db.query(
    'INSERT INTO user_favorites (user_id, unit_id, kind, ref_key, payload, created_at) VALUES (?, ?, ?, ?, ?, NOW())',
    [userId, unitId, kind, refKey, payloadJson]);
  return result;
}

async function findById(db, id) {
  const [rows] = await db.query('SELECT * FROM user_favorites WHERE id = ? LIMIT 1', [id]);
  return rows && rows.length ? rows[0] : null;
}

async function findOwnedId(db, { id, userId, scope }) {
  const [rows] = await db.query(
    `SELECT id FROM user_favorites WHERE id = ? AND user_id = ?${scope.sql} LIMIT 1`,
    [id, userId, ...scope.params]);
  return rows && rows.length ? rows[0] : null;
}

async function deleteFavorite(db, id) {
  await db.query('DELETE FROM user_favorites WHERE id = ?', [id]);
}

module.exports = { listForUser, findByRef, countByKind, insertFavorite, findById, findOwnedId, deleteFavorite };
