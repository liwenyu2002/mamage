// 相册桌面（album_desktop_workspaces / album_desktop_users）dao。
// 业务校验（版本号、可见组、偏好）留在 routes/album_desktop.js。
async function readOnlySnapshot(conn, { orgId, unitKey, userId }) {
  const [shared] = await conn.query(
    'SELECT state, revision FROM album_desktop_workspaces WHERE organization_id = ? AND unit_key = ?', [orgId, unitKey]);
  const [personal] = await conn.query(
    'SELECT state, revision FROM album_desktop_users WHERE user_id = ? AND organization_id = ? AND unit_key = ?',
    [userId, orgId, unitKey]);
  return { shared: shared[0] || null, personal: personal[0] || null };
}

async function ensureRows(conn, { orgId, unitKey, userId }) {
  await conn.query(
    'INSERT IGNORE INTO album_desktop_workspaces (organization_id, unit_key, state) VALUES (?, ?, ?)',
    [orgId, unitKey, '{"groups":[]}']);
  await conn.query(
    'INSERT IGNORE INTO album_desktop_users (user_id, organization_id, unit_key, state) VALUES (?, ?, ?, ?)',
    [userId, orgId, unitKey, '{}']);
}

async function lockSnapshot(conn, { orgId, unitKey, userId }) {
  const [shared] = await conn.query(
    'SELECT state, revision FROM album_desktop_workspaces WHERE organization_id = ? AND unit_key = ? FOR UPDATE',
    [orgId, unitKey]);
  const [personal] = await conn.query(
    'SELECT state, revision FROM album_desktop_users WHERE user_id = ? AND organization_id = ? AND unit_key = ? FOR UPDATE',
    [userId, orgId, unitKey]);
  return { shared: shared[0] || null, personal: personal[0] || null };
}

async function writeWorkspaceState(conn, { orgId, unitKey, groups }) {
  await conn.query(
    'UPDATE album_desktop_workspaces SET state = ?, revision = revision + 1 WHERE organization_id = ? AND unit_key = ?',
    [JSON.stringify({ groups }), orgId, unitKey]);
}

async function writeUserState(conn, { userId, orgId, unitKey, preferences }) {
  await conn.query(
    'UPDATE album_desktop_users SET state = ?, revision = revision + 1 WHERE user_id = ? AND organization_id = ? AND unit_key = ?',
    [JSON.stringify(preferences), userId, orgId, unitKey]);
}

async function setRepeatableRead(conn) {
  await conn.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
}

module.exports = { readOnlySnapshot, ensureRows, lockSnapshot, writeWorkspaceState, writeUserState, setRepeatableRead };
