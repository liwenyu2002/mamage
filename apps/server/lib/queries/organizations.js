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

async function queryOrganizations(db, { sql, params }) {
  const [rows] = await db.query(sql, params);
  return rows || [];
}

module.exports = { hasOrganizationsTable, listOrganizationColumns, queryOrganizations };
