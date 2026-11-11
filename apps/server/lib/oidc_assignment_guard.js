const jwt = require('jsonwebtoken');
const { oidcConfig } = require('./oidc_config');

async function isOidcAssignmentPending(userId, { db, config = oidcConfig } = {}) {
  const cfg = config();
  if (!cfg.issuer || !cfg.clientId || !Number.isSafeInteger(Number(userId)) || Number(userId) <= 0) return false;
  const [rows] = await (db || require('../db').pool).query(`SELECT u.id FROM users u
    WHERE u.id = ? AND u.role = 'visitor'
      AND EXISTS (SELECT 1 FROM iam_login_identities i WHERE i.user_id = u.id AND i.source_key = ?)
      AND NOT EXISTS (SELECT 1 FROM organization_unit_memberships m WHERE m.user_id = u.id AND m.removed_at IS NULL)
      AND NOT EXISTS (SELECT 1 FROM organization_admin_grants a WHERE a.user_id = u.id AND a.organization_id = u.organization_id)
    LIMIT 1`, [Number(userId), cfg.sourceKey]);
  return rows.length > 0;
}

function createOidcAssignmentGuard({ db, secret, config = oidcConfig } = {}) {
  return async (req, res, next) => {
    const path = String(req.originalUrl || '').split('?')[0];
    if (path === '/api/users/me' && ['GET', 'PUT'].includes(req.method)) return next();
    if (req.method === 'GET' && /^\/api\/share\/[A-Za-z0-9_-]{24}$/.test(path)) return next();
    const token = String(req.get('authorization') || '').match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) return next();
    let payload;
    try { payload = jwt.verify(token, secret); } catch { return next(); }
    try {
      if (await isOidcAssignmentPending(payload.id, { db, config })) {
        return res.status(403).json({ error: 'WORKSPACE_ASSIGNMENT_REQUIRED', message: '账号已创建，请联系管理员分配组织' });
      }
      return next();
    } catch {
      return res.status(503).json({ error: 'ASSIGNMENT_CHECK_UNAVAILABLE', message: '权限检查暂不可用，请稍后重试' });
    }
  };
}

module.exports = { createOidcAssignmentGuard, isOidcAssignmentPending };
