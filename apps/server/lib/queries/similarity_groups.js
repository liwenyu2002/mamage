// 相似分组（ai_image_embeddings + photos）dao。权限与阈值逻辑留在路由。
async function findAuthUser(db, userId) {
  const [rows] = await db.query('SELECT id, organization_id, role FROM users WHERE id = ? LIMIT 1', [userId]);
  return rows && rows.length ? rows[0] : null;
}

async function queryEmbeddings(db, { sql, params }) {
  const [rows] = await db.query(sql, params);
  return rows || [];
}

async function findProjectUnit(db, { projectId, orgId }) {
  const [rows] = await db.query(
    'SELECT unit_id FROM projects WHERE id = ? AND organization_id = ? LIMIT 1', [projectId, orgId]);
  return rows || [];
}

module.exports = { findAuthUser, queryEmbeddings, findProjectUnit };
