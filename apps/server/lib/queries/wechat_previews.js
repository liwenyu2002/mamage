// 公众号预览快照（wechat_previews）dao。过期判断与页面渲染留在路由。
async function insertPreview(db, row) {
  const [result] = await db.query(
    `INSERT INTO wechat_previews
       (token, org_id, created_by, title, digest, html, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, NOW(), ?)`,
    [row.token, row.orgId, row.createdBy, row.title, row.digest, row.html, row.expiresAt]);
  return result;
}

async function listKeepIds(db, { createdBy, limit }) {
  const [rows] = await db.query(
    'SELECT id FROM wechat_previews WHERE created_by = ? ORDER BY id DESC LIMIT ?', [createdBy, limit]);
  return (rows || []).map((r) => r.id);
}

async function deleteBeyond(db, { createdBy, keepIds }) {
  if (!keepIds.length) return;
  await db.query('DELETE FROM wechat_previews WHERE created_by = ? AND id NOT IN (?)', [createdBy, keepIds]);
}

async function deleteExpired(db, limit = 100) {
  await db.query('DELETE FROM wechat_previews WHERE expires_at IS NOT NULL AND expires_at < NOW() LIMIT ?', [limit]);
}

async function findByToken(db, token) {
  const [rows] = await db.query(
    'SELECT title, digest, html, expires_at FROM wechat_previews WHERE token = ? LIMIT 1', [token]);
  return rows && rows.length ? rows[0] : null;
}

module.exports = { insertPreview, listKeepIds, deleteBeyond, deleteExpired, findByToken };
