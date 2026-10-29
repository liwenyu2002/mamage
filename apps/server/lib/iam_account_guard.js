const jwt = require('jsonwebtoken');
const { requested } = require('./iam_config');
const { error } = require('./iam_protocol');
async function accountState(userId, db) {
  if (!requested()) return { disabled: false, session_version: 0, media_revoked_before: 0 };
  const [rows] = await (db || require('../db').pool).query('SELECT disabled, session_version, media_revoked_before FROM iam_user_state WHERE user_id = ?', [userId]);
  return rows[0] || { disabled: false, session_version: 0, media_revoked_before: 0 };
}
async function assertSession(userId, payload = null, db) {
  const state = await accountState(userId, db);
  if (state.disabled || (payload && Number(payload.iav || 0) !== Number(state.session_version))) throw error('ACCOUNT_SESSION_REVOKED', 401);
  return state;
}
async function issueToken(payload, secret, db, { expiresIn = '7d' } = {}) {
  const state = await assertSession(payload.id, null, db);
  return jwt.sign({ ...payload, ...(requested() ? { iav: Number(state.session_version) } : {}) }, secret, { expiresIn });
}
async function allowMedia(userId, issuedAt, db) {
  const state = await accountState(userId, db);
  return !state.disabled && (Number(state.media_revoked_before) === 0 || Number(issuedAt || 0) > Number(state.media_revoked_before));
}
function bearerGuard(secret) {
  return async (req, res, next) => {
    if (!requested()) return next();
    const token = String(req.get('authorization') || '').match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) return next();
    let payload;
    try { payload = jwt.verify(token, secret); } catch { return next(); }
    try { await assertSession(payload.id, payload); req.iamAccountChecked = true; next(); }
    catch (e) { res.status(e.status || 503).json({ error: e.code || 'ACCOUNT_CHECK_UNAVAILABLE', message: '账号已停用或登录已失效，请重新登录' }); }
  };
}
module.exports = { accountState, assertSession, issueToken, allowMedia, bearerGuard };
