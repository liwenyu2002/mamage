// 用户 / 邀请码的 dao 层。权限判定与错误码留在 routes/users.js。
const USER_COLUMNS = 'id, student_no, name, department, role, email, avatar_url, nickname, organization_id';

async function findByEmail(db, email) {
  const [rows] = await db.query('SELECT id FROM users WHERE email = ? LIMIT 1', [email]);
  return rows || [];
}

async function findByStudentNo(db, studentNo) {
  const [rows] = await db.query('SELECT id FROM users WHERE student_no = ?', [studentNo]);
  return rows || [];
}

async function findPublicById(db, id) {
  const [rows] = await db.query(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`, [id]);
  return rows && rows.length ? rows[0] : null;
}

async function findPasswordHash(db, userId) {
  const [rows] = await db.query('SELECT password_hash FROM users WHERE id = ? LIMIT 1', [userId]);
  return rows && rows.length ? rows[0].password_hash : null;
}

async function updatePassword(db, { userId, hash }) {
  await db.query('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?', [hash, new Date(), userId]);
}

async function updateRole(db, { userId, role }) {
  await db.query('UPDATE users SET role = ?, updated_at = ? WHERE id = ?', [role, new Date(), userId]);
}

// ---- 邀请码 ----
async function insertInvitation(db, { code, role, createdBy, expiresAt, maxUses, note }) {
  const [result] = await db.query(
    'INSERT INTO invitations (code, role, created_by, expires_at, max_uses, note) VALUES (?, ?, ?, ?, ?, ?)',
    [code, role, createdBy, expiresAt || null, maxUses || 1, note || null]);
  return result;
}

async function lockInvitationByCode(conn, code) {
  const [rows] = await conn.query('SELECT * FROM invitations WHERE code = ? FOR UPDATE', [code]);
  return rows && rows.length ? rows[0] : null;
}

async function incrementInvitationUses(conn, invitationId) {
  await conn.query('UPDATE invitations SET uses = uses + 1 WHERE id = ?', [invitationId]);
}

/** 原始查询（登录/注册里拼动态 where 的地方仍由调用方构造 SQL） */
async function queryRaw(db, sql, params) {
  const [rows] = await db.query(sql, params);
  return rows || [];
}

module.exports = {
  USER_COLUMNS,
  findByEmail, findByStudentNo, findPublicById, findPasswordHash, updatePassword, updateRole,
  insertInvitation, lockInvitationByCode, incrementInvitationUses, queryRaw,
};

// ---- 鉴权与个人页 ----
async function hasPasswordColumn(db) {
  const [rows] = await db.query(
    "SELECT COUNT(*) as cnt FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'password_hash'");
  return Boolean(rows && rows[0] && rows[0].cnt > 0);
}

async function findForAuth(db, userId) {
  const [rows] = await db.query(
    'SELECT id, student_no, name, department, role, email, avatar_url, nickname, organization_id FROM users WHERE id = ?', [userId]);
  return rows && rows.length ? rows[0] : null;
}

async function findForAuthLegacy(db, userId) {
  const [rows] = await db.query(
    'SELECT id, student_no, name, department, role, email, avatar_url, nickname FROM users WHERE id = ?', [userId]);
  return rows && rows.length ? rows[0] : null;
}

async function hasIamIdentity(db, userId) {
  const [[row]] = await db.query('SELECT user_id FROM iam_login_identities WHERE user_id = ? LIMIT 1', [userId]);
  return Boolean(row);
}

async function hasUnitMembership(db, userId) {
  const [[row]] = await db.query(
    'SELECT user_id FROM organization_unit_memberships WHERE user_id = ? AND removed_at IS NULL LIMIT 1', [userId]);
  return Boolean(row);
}

async function lockProfile(conn, userId) {
  const [[row]] = await conn.query('SELECT id, name, email FROM users WHERE id = ? FOR UPDATE', [userId]);
  return row || null;
}

async function emailTakenByOther(conn, { userId, email }) {
  const [rows] = await conn.query('SELECT id FROM users WHERE id <> ? AND email = ? LIMIT 1 FOR UPDATE', [userId, email]);
  return rows || [];
}

async function updateProfileFields(conn, { updates, params, userId }) {
  // updated_at 走参数位，调用方只传业务字段，避免占位符与参数错位
  await conn.query(`UPDATE users SET ${updates.join(', ')}, updated_at = ? WHERE id = ?`,
    [...params, new Date(), userId]);
}

async function findPasswordHashWithRole(db, { where, value }) {
  const [rows] = await db.query(`SELECT id, password_hash, role FROM users WHERE ${where} LIMIT 1`, [value]);
  return rows && rows.length ? rows[0] : null;
}

module.exports.hasPasswordColumn = hasPasswordColumn;
module.exports.findForAuth = findForAuth;
module.exports.findForAuthLegacy = findForAuthLegacy;
module.exports.hasIamIdentity = hasIamIdentity;
module.exports.hasUnitMembership = hasUnitMembership;
module.exports.lockProfile = lockProfile;
module.exports.emailTakenByOther = emailTakenByOther;
module.exports.updateProfileFields = updateProfileFields;
module.exports.findPasswordHashWithRole = findPasswordHashWithRole;

async function findOrganizationByCode(db, code) {
  const [rows] = await db.query('SELECT id, name FROM organizations WHERE UPPER(code) = ? LIMIT 1', [code]);
  return rows || [];
}

async function findOrganizationById(db, id) {
  const [rows] = await db.query('SELECT id, name FROM organizations WHERE id = ? LIMIT 1', [id]);
  return rows && rows.length ? rows[0] : null;
}

async function lockInvitation(conn, code) {
  const [rows] = await conn.query('SELECT * FROM invitations WHERE code = ? FOR UPDATE', [code]);
  return rows && rows.length ? rows[0] : null;
}

async function listAllUsersWithOrg(db) {
  const [rows] = await db.query(
    `SELECT u.id, u.name, u.email, u.student_no, u.role, u.department,
            u.organization_id AS organizationId, o.name AS organizationName,
            u.created_at AS createdAt
       FROM users u
       LEFT JOIN organizations o ON o.id = u.organization_id
      ORDER BY u.id ASC`);
  return rows || [];
}

module.exports.findOrganizationByCode = findOrganizationByCode;
module.exports.findOrganizationById = findOrganizationById;
module.exports.lockInvitation = lockInvitation;
module.exports.listAllUsersWithOrg = listAllUsersWithOrg;

/** 注册时插入用户（列名由调用方按可选字段拼装） */
async function insertRegisteredUser(db, { cols, placeholders, params }) {
  const [result] = await db.query(`INSERT INTO users (${cols.join(',')}) VALUES (${placeholders.join(',')})`, params);
  return result;
}

module.exports.insertRegisteredUser = insertRegisteredUser;

// ---- 钉钉登录 ----
async function findByEmailRole(db, email) {
  const [rows] = await db.query('SELECT id, role FROM users WHERE email = ? LIMIT 1', [email]);
  return rows && rows.length ? rows[0] : null;
}

async function findByDingtalkUnionId(db, unionId) {
  const [rows] = await db.query('SELECT id, role FROM users WHERE dingtalk_union_id = ? LIMIT 1', [unionId]);
  return rows && rows.length ? rows[0] : null;
}

async function bindDingtalkUnionId(db, { unionId, userId }) {
  await db.query('UPDATE users SET dingtalk_union_id = ? WHERE id = ?', [unionId, userId]);
}

async function insertDingtalkUser(db, row) {
  const [result] = await db.query(
    `INSERT INTO users (student_no, name, email, dingtalk_union_id, role, organization_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [row.studentNo, row.name, row.email || null, row.unionId, row.role, row.orgId]);
  return result;
}

module.exports.findByEmailRole = findByEmailRole;
module.exports.findByDingtalkUnionId = findByDingtalkUnionId;
module.exports.bindDingtalkUnionId = bindDingtalkUnionId;
module.exports.insertDingtalkUser = insertDingtalkUser;

/** 同组织内按 id 取公开资料（摄影师署名等只读场景） */
async function findPublicUserInOrg(db, { id, orgId }) {
  const [rows] = await db.query(
    `SELECT id, student_no, name, department, role, email, avatar_url, nickname, organization_id
       FROM users WHERE id = ? AND (? IS NULL OR organization_id = ?) LIMIT 1`, [id, orgId, orgId]);
  return rows && rows.length ? rows[0] : null;
}

module.exports.findPublicUserInOrg = findPublicUserInOrg;
