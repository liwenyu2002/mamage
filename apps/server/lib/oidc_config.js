const crypto = require('node:crypto');

const requested = (env = process.env) => env.OIDC_ENABLED === '1';
const validProfilePath = value => value.length <= 256 && /^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*$/.test(value)
  && !value.split('.').some(key => ['__proto__', 'prototype', 'constructor'].includes(key));
function secureUrl(value, { allowInsecureOrigin = '' } = {}) {
  try {
    const url = new URL(value);
    if (url.username || url.password || url.search || url.hash) return null;
    if (url.protocol === 'https:') return url;
    // 内网 Keycloak 可能只有 http：必须用 OIDC_ALLOW_INSECURE_ISSUER_ORIGIN 精确登记来源，不做通配。
    if (url.protocol === 'http:' && allowInsecureOrigin && url.origin === allowInsecureOrigin) return url;
    return null;
  } catch { return null; }
}
function siteUrl(env) {
  try {
    const url = new URL(env.MAMAGE_PUBLIC_URL);
    if (url.username || url.password || url.search || url.hash) return null;
    if (url.protocol === 'https:') return url;
    const octets = url.hostname.split('.').map(Number);
    const privateIp = /^\d+\.\d+\.\d+\.\d+$/.test(url.hostname) && octets.every(n => n >= 0 && n <= 255)
      && (octets[0] === 10 || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) || (octets[0] === 192 && octets[1] === 168));
    const allowed = String(env.OIDC_ALLOW_INSECURE_HTTP_ORIGIN || env.IAM_ALLOW_INSECURE_HTTP_ORIGIN || '').trim();
    return privateIp && allowed === url.origin ? url : null;
  } catch { return null; }
}
function oidcConfig(env = process.env) {
  const site = siteUrl(env);
  const insecureIssuerOrigin = String(env.OIDC_ALLOW_INSECURE_ISSUER_ORIGIN || '').trim();
  const issuer = secureUrl(String(env.OIDC_ISSUER || '').trim().replace(/\/*$/, ''), { allowInsecureOrigin: insecureIssuerOrigin });
  const clientId = String(env.OIDC_CLIENT_ID || '').trim();
  const clientSecret = String(env.OIDC_CLIENT_SECRET || '');
  const orgId = Number(env.OIDC_ORGANIZATION_ID);
  const scopes = String(env.OIDC_SCOPES || 'openid profile email').trim().split(/\s+/).filter(Boolean);
  const profileIdPath = String(env.OIDC_PROFILE_ID_PATH || 'sub').trim();
  const profileNamePath = String(env.OIDC_PROFILE_NAME_PATH || 'name').trim();
  const profileEmailPath = String(env.OIDC_PROFILE_EMAIL_PATH || 'email').trim();
  const profileStudentPath = String(env.OIDC_PROFILE_STUDENT_PATH || 'preferred_username').trim();
  const profilePathsReady = [profileIdPath, profileNamePath, profileEmailPath, profileStudentPath]
    .every(path => validProfilePath(path));
  const scopesReady = scopes.length > 0 && scopes.length <= 12 && scopes.includes('openid')
    && scopes.every(scope => /^[A-Za-z0-9._:-]{1,64}$/.test(scope)) && new URLSearchParams({ scope: scopes.join(' ') }).toString().length <= 512;
  const clientAuth = env.OIDC_CLIENT_AUTH === 'client_secret_post' ? 'client_secret_post' : 'client_secret_basic';
  let callback = site ? new URL(env.OIDC_REDIRECT_URI || '/api/auth/oidc/callback', site) : null;
  if (callback && (callback.origin !== site.origin || callback.pathname !== '/api/auth/oidc/callback'
    || callback.search || callback.hash || callback.username || callback.password)) callback = null;
  const clockSkewSeconds = Number(env.OIDC_CLOCK_SKEW_SECONDS ?? 60);
  const validSkew = Number.isSafeInteger(clockSkewSeconds) && clockSkewSeconds >= 0 && clockSkewSeconds <= 300;
  const missing = [];
  if (!issuer) missing.push('OIDC issuer（https，或已精确登记的内网 http 来源）');
  if (!site || site.pathname !== '/') missing.push('本站 HTTPS 入口或已批准的精确内网 HTTP 来源');
  if (!callback) missing.push('同站点回调地址 /api/auth/oidc/callback');
  if (!clientId) missing.push('OIDC client_id');
  if (!clientSecret) missing.push('OIDC client_secret');
  if (!Number.isSafeInteger(orgId) || orgId <= 0) missing.push('所属组织 ID');
  if (!profilePathsReady) missing.push('有效的 OIDC 身份字段映射');
  if (!scopesReady) missing.push('OIDC scopes（必须包含 openid）');
  if (!validSkew) missing.push('OIDC 时钟偏移秒数');
  const valid = missing.length === 0;
  const issuerHref = issuer?.href || '';
  const flowKey = crypto.createHash('sha256').update(JSON.stringify([issuerHref, clientId, callback?.href || '', orgId,
    profileIdPath, profileNamePath, profileEmailPath, profileStudentPath, clientAuth, scopes.join(' '),
    env.OIDC_AUTO_PROVISION === '1', env.OIDC_PROFILE_LOGIN_MATCHING === '1', clockSkewSeconds])).digest('hex');
  return { enabled: env.OIDC_ENABLED === '1', loginReady: env.OIDC_ENABLED === '1' && valid, missing,
    issuer: issuerHref, clientId, clientSecret, clientAuth, orgId, scopes, scopesValue: scopes.join(' '),
    profileIdPath, profileNamePath, profileEmailPath, profileStudentPath, clockSkewSeconds,
    discoveryTtlSeconds: Math.min(Math.max(Number(env.OIDC_DISCOVERY_CACHE_SECONDS) || 3600, 60), 86400),
    timeoutMs: Math.min(Math.max(Number(env.OIDC_TIMEOUT_MS) || 10000, 1000), 30000),
    providerLabel: String(env.OIDC_PROVIDER_LABEL || '统一身份认证').slice(0, 20),
    autoStart: env.OIDC_AUTO_START === '1',
    publicOrigin: site?.origin, insecureHttp: site?.protocol === 'http:', callback: callback?.href || null,
    sourceKey: crypto.createHash('sha256').update(`oidc\n${issuerHref}\n${clientId}`).digest('hex'), flowKey,
    profileLoginMatching: env.OIDC_PROFILE_LOGIN_MATCHING === '1',
    subjectEmailDomain: String(env.OIDC_SUBJECT_EMAIL_DOMAIN || '').trim().toLowerCase(),
    autoProvision: env.OIDC_AUTO_PROVISION === '1' };
}
module.exports = { oidcConfig, requested, validProfilePath };
