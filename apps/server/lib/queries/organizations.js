// 组织表元信息探测与列表（兼容老库缺列）。权限留在路由。
async function hasOrganizationsTable(db) {
  const [rows] = await db.query(
    "SELECT COUNT(*) AS cnt FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'organizations'");
  return Boolean(rows && rows.length && Number(rows[0].cnt) > 0);
}

async function listOrganizationColumns(db) {
  const [rows] = await db.query(
    "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'organizations'");
  return rows || [];
}

async function listOrganizationsForMember(db, { organizationId, query, limit }) {
  if (!await hasOrganizationsTable(db)) return [];
  const columnRows = await listOrganizationColumns(db);
  const columns = new Set(columnRows.map(row => String(row.COLUMN_NAME).toLowerCase()));
  const fields = ['id', 'name'];
  if (columns.has('slug')) fields.push('slug');
  if (columns.has('is_public')) fields.push('IFNULL(is_public,1) AS is_public');
  if (columns.has('description')) fields.push('description');
  let sql = `SELECT ${fields.join(', ')} FROM organizations WHERE id = ?`;
  const params = [organizationId];
  if (query) {
    const match = `%${query}%`;
    if (columns.has('slug')) {
      sql += ' AND (name LIKE ? OR slug LIKE ?)';
      params.push(match, match);
    } else {
      sql += ' AND name LIKE ?';
      params.push(match);
    }
  }
  sql += ' ORDER BY name ASC LIMIT ?';
  params.push(limit);
  const [rows] = await db.query(sql, params);
  return rows.map(row => ({ id: row.id, name: row.name, slug: row.slug || null,
    is_public: row.is_public === undefined || Boolean(row.is_public), description: row.description || null }));
}

module.exports = { listOrganizationsForMember };
