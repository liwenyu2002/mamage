const crypto = require('node:crypto');

const requested = (env = process.env) => ['IAM_ENABLED', 'IAM_PUSH_ENABLED', 'IAM_ACCOUNT_GUARD'].some(key => env[key] === '1');
const validProfilePath = value => value.length <= 256 && /^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*$/.test(value)
  && !value.split('.').some(key => ['__proto__', 'prototype', 'constructor'].includes(key));
function secureUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash ? url : null;
  } catch { return null; }
}
function siteUrl(env) {
  const secure = secureUrl(env.MAMAGE_PUBLIC_URL);
  if (secure) return secure;
  try {
    const url = new URL(env.MAMAGE_PUBLIC_URL);
    const octets = url.hostname.split('.').map(Number);
    const privateIp = /^\d+\.\d+\.\d+\.\d+$/.test(url.hostname) && octets.every(n => n >= 0 && n <= 255)
      && (octets[0] === 10 || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) || (octets[0] === 192 && octets[1] === 168));
    return privateIp && url.protocol === 'http:' && env.IAM_ALLOW_INSECURE_HTTP_ORIGIN === url.origin
      && !url.username && !url.password && !url.search && !url.hash ? url : null;
  } catch { return null; }
}
function iamConfig(env = process.env) {
  const site = siteUrl(env), base = secureUrl(env.IAM_BASE_URL);
  if (base) base.pathname = base.pathname.replace(/\/*$/, '/');
  const clientId = String(env.IAM_CLIENT_ID || '').trim(), clientSecret = String(env.IAM_CLIENT_SECRET || '');
  const appId = String(env.IAM_PUSH_APP_ID || clientId).trim(), appSecret = String(env.IAM_PUSH_APP_SECRET || clientSecret);
  const orgId = Number(env.IAM_ORGANIZATION_ID), profileIdPath = String(env.IAM_PROFILE_ID_PATH || 'attributes.externalId');
  const profileNamePath = String(env.IAM_PROFILE_NAME_PATH || ''), profileEmailPath = String(env.IAM_PROFILE_EMAIL_PATH || ''),
    profileStudentPath = String(env.IAM_PROFILE_STUDENT_PATH || '');
  const profilePathsReady = validProfilePath(profileIdPath)
    && [profileNamePath, profileEmailPath, profileStudentPath].every(path => !path || validProfilePath(path));
  const cipher = env.IAM_PUSH_CIPHER || 'sdk-aes', sourceAddresses = String(env.IAM_PUSH_SOURCE_ADDRESSES || '').split(',').map(x => x.trim()).filter(Boolean);
  let cipherReady = false;
  try { require('./iam_protocol').cipherOptions({ cipher, appSecret }); cipherReady = Boolean(appSecret); } catch {}
  const valid = Boolean(base && site && site.pathname === '/' && appId && Number.isSafeInteger(orgId) && orgId > 0
    && profilePathsReady);
  const path = name => base ? new URL(`sso/oauth2.0/${name}`, base.href.replace(/\/?$/, '/')).href : null;
  let callback = site ? new URL(env.IAM_REDIRECT_URI || '/api/auth/iam/callback', site) : null;
  if (callback && (callback.origin !== site.origin || !['/', '/api/auth/iam/callback'].includes(callback.pathname)
    || callback.search || callback.hash || callback.username || callback.password)) callback = null;
  const missing = [];
  if (!base) missing.push('IAM HTTPS 地址');
  if (!site || site.pathname !== '/') missing.push('本站 HTTPS 入口或已批准的精确内网 HTTP 来源');
  if (!callback) missing.push('同站点回调地址');
  if (!clientId) missing.push('OAuth 应用 ID');
  if (!clientSecret) missing.push('OAuth 应用密钥');
  if (!Number.isSafeInteger(orgId) || orgId <= 0) missing.push('所属组织 ID');
  if (!profilePathsReady) missing.push('有效的 IAM 身份字段映射');
  return { enabled: env.IAM_ENABLED === '1', pushEnabled: env.IAM_PUSH_ENABLED === '1', guardEnabled: requested(env),
    loginReady: env.IAM_ENABLED === '1' && valid && Boolean(clientId && clientSecret && callback),
    qrEnabled: env.IAM_QR_ENABLED === '1',
    pushReady: env.IAM_PUSH_ENABLED === '1' && valid && cipherReady && sourceAddresses.length > 0, missing,
    clientId, clientSecret, appId, appSecret, orgId, profileIdPath, profileNamePath, profileEmailPath, profileStudentPath, sourceAddresses, cipher,
    trustedProxyAddresses: String(env.IAM_TRUSTED_PROXY_ADDRESSES || '').split(',').map(x => x.trim()).filter(Boolean),
    sourceKey: crypto.createHash('sha256').update(`${base?.href || ''}\n${appId}`).digest('hex'),
    flowKey: crypto.createHash('sha256').update(JSON.stringify([base?.href || '', clientId, callback?.href, orgId,
      profileIdPath, profileNamePath, profileEmailPath, profileStudentPath, env.IAM_PKCE_ENABLED !== '0', env.IAM_PROFILE_LOGIN_MATCHING === '1',
      String(env.IAM_SUBJECT_EMAIL_DOMAIN || '').trim().toLowerCase(), env.IAM_AUTO_PROVISION === '1'])).digest('hex'),
    publicOrigin: site?.origin, insecureHttp: site?.protocol === 'http:', callback: callback?.href || null,
    profileLoginMatching: env.IAM_PROFILE_LOGIN_MATCHING === '1',
    subjectEmailDomain: String(env.IAM_SUBJECT_EMAIL_DOMAIN || '').trim().toLowerCase(),
    authorizeUrl: path('authorize'), tokenUrl: path('accessToken'), profileUrl: path('profile'),
    pkce: env.IAM_PKCE_ENABLED !== '0', autoProvision: env.IAM_AUTO_PROVISION === '1',
    nameAttribute: env.IAM_NAME_ATTRIBUTE || 'name', emailAttribute: env.IAM_EMAIL_ATTRIBUTE || 'email',
    studentAttribute: env.IAM_STUDENT_ATTRIBUTE || 'studentNo' };
}
module.exports = { iamConfig, requested };
