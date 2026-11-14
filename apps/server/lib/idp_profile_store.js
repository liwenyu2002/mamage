// 把 IdP 每次登录返回的资料落库，便于排查「为什么这个账号没有邮箱/工号」。
// 只保留白名单身份字段，票据/令牌/密码类字段一律丢弃，避免把登录凭据留在库里。
const MAX_BYTES = 64 * 1024;

const ALLOWED_KEYS = new Set(['sub', 'id', 'uid', 'userid', 'userId', 'username', 'preferred_username', 'name', 'nickname',
  'display_name', 'displayName', 'realName', 'email', 'mail', 'email_verified', 'phone', 'mobile', 'telephone',
  'employeeNo', 'employee_no', 'employeeNumber', 'studentNo', 'student_no', 'jobNumber', 'dept', 'department',
  'departmentName', 'org', 'organization', 'title', 'roles', 'groups', 'iss', 'aud', 'auth_time', 'iat', 'exp',
  'attributes', 'profile', 'userinfo']);
const SECRET_KEY = /(token|ticket|secret|password|passwd|credential|cookie|session|signature|assertion|code|key)/i;

function scrub(value, depth = 0) {
  if (depth > 4 || value === null || value === undefined) return value ?? null;
  if (Array.isArray(value)) return value.slice(0, 50).map(item => scrub(item, depth + 1));
  if (typeof value !== 'object') return value;
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (SECRET_KEY.test(key)) continue;
    if (depth === 0 && !ALLOWED_KEYS.has(key)) continue;
    out[key] = scrub(item, depth + 1);
  }
  return out;
}

const trim = value => {
  try {
    const text = JSON.stringify(value ?? null);
    if (text.length <= MAX_BYTES) return { json: text, bytes: text.length };
    return { json: JSON.stringify({ truncated: true, preview: text.slice(0, MAX_BYTES - 64) }), bytes: text.length };
  } catch { return { json: 'null', bytes: 0 }; }
};

async function saveIdpProfile(db, { sourceKey, subjectId, userId = null, provider = 'iam', profile = null, claims = null } = {}) {
  if (!sourceKey || !subjectId) return false;
  const raw = trim(scrub(profile)), mapped = trim(scrub(claims));
  try {
    await db.query(`INSERT INTO iam_identity_profiles
        (source_key, subject_id, user_id, provider, profile, claims, bytes)
      VALUES (?, ?, ?, ?, CAST(? AS JSON), CAST(? AS JSON), ?)
      ON DUPLICATE KEY UPDATE user_id = VALUES(user_id), provider = VALUES(provider),
        profile = VALUES(profile), claims = VALUES(claims), bytes = VALUES(bytes),
        login_count = login_count + 1, last_seen_at = CURRENT_TIMESTAMP`,
      [sourceKey, String(subjectId).slice(0, 255), userId, provider, raw.json, mapped.json, raw.bytes]);
    return true;
  } catch (e) {
    console.warn('[idp-profile] save failed', e.code || e.message);
    return false;
  }
}

async function listIdpProfiles(db, userId, limit = 5) {
  const [rows] = await db.query(`SELECT source_key AS sourceKey, subject_id AS subjectId, provider, profile, claims,
      bytes, login_count AS loginCount, first_seen_at AS firstSeenAt, last_seen_at AS lastSeenAt
    FROM iam_identity_profiles WHERE user_id = ? ORDER BY last_seen_at DESC LIMIT ?`, [userId, Math.min(Math.max(Number(limit) || 5, 1), 20)]);
  // 读取侧再兜一次：历史数据可能是未脱敏的原始 JSON。
  return (rows || []).map(row => ({ ...row,
    profile: (() => { try { return JSON.stringify(scrub(JSON.parse(row.profile))); } catch { return null; } })(),
    claims: (() => { try { return JSON.stringify(scrub(JSON.parse(row.claims))); } catch { return null; } })() }));
}

module.exports = { saveIdpProfile, listIdpProfiles };
