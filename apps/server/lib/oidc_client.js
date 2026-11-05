const crypto = require('node:crypto');

const error = (code, status = 400) => Object.assign(new Error(code), { code, status });
const allowedAlgorithms = { RS256: 'sha256', RS384: 'sha384', RS512: 'sha512', PS256: 'sha256', PS384: 'sha384', PS512: 'sha512', ES256: 'sha256', ES384: 'sha384', ES512: 'sha512' };

async function readJson(response, limit = 256 * 1024) {
  if (!response.ok) { await response.body?.cancel(); throw error('OIDC_UPSTREAM_UNAVAILABLE', 502); }
  let size = 0; const chunks = [];
  for await (const chunk of response.body) {
    size += chunk.length; if (size > limit) throw error('OIDC_INVALID_RESPONSE', 502);
    chunks.push(Buffer.from(chunk));
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw error('OIDC_INVALID_RESPONSE', 502); }
}
const string = (value, limit = 4096) => typeof value === 'string' && value.length > 0 && value.length <= limit ? value : null;

// 端点必须与 issuer 同源：防止 discovery 被篡改后把授权码/令牌发去别的站点（mix-up）。
function sameOriginEndpoint(value, issuer, label) {
  let url;
  try { url = new URL(value); } catch { throw error('OIDC_INVALID_DISCOVERY', 502); }
  if (url.origin !== issuer.origin || (url.protocol !== 'https:' && url.protocol !== 'http:')
    || url.username || url.password) throw error(`OIDC_INVALID_DISCOVERY_${label}`, 502);
  return url.href;
}

function createOidcClient({ request = (...args) => fetch(...args), now = Date.now } = {}) {
  const discoveryCache = new Map(), jwksCache = new Map();
  async function getJson(url, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      // 不跟随重定向：issuer 已固定，跳转只会扩大攻击面。
      return await readJson(await request(url, { redirect: 'error', signal: controller.signal }));
    } catch (e) {
      if (e.code) throw e;
      throw error('OIDC_UPSTREAM_UNAVAILABLE', 502);
    } finally { clearTimeout(timer); }
  }
  async function discovery(cfg) {
    const cached = discoveryCache.get(cfg.issuer);
    if (cached && now() - cached.fetchedAt < cfg.discoveryTtlSeconds * 1000) return cached.document;
    const issuer = new URL(cfg.issuer);
    const document = await getJson(`${issuer.href.replace(/\/$/, '')}/.well-known/openid-configuration`, cfg.timeoutMs);
    if (!document || typeof document !== 'object' || document.issuer !== issuer.href.replace(/\/$/, '')) throw error('OIDC_ISSUER_MISMATCH', 502);
    const normalized = {
      issuer: document.issuer,
      authorization_endpoint: sameOriginEndpoint(document.authorization_endpoint, issuer, 'AUTHORIZATION'),
      token_endpoint: sameOriginEndpoint(document.token_endpoint, issuer, 'TOKEN'),
      jwks_uri: sameOriginEndpoint(document.jwks_uri, issuer, 'JWKS'),
      userinfo_endpoint: document.userinfo_endpoint ? sameOriginEndpoint(document.userinfo_endpoint, issuer, 'USERINFO') : null,
      end_session_endpoint: document.end_session_endpoint ? sameOriginEndpoint(document.end_session_endpoint, issuer, 'END_SESSION') : null,
    };
    discoveryCache.set(cfg.issuer, { document: normalized, fetchedAt: now() });
    return normalized;
  }
  async function jwks(cfg, uri, force = false) {
    const cached = jwksCache.get(uri);
    if (!force && cached && now() - cached.fetchedAt < cfg.discoveryTtlSeconds * 1000) return cached.keys;
    const document = await getJson(uri, cfg.timeoutMs);
    const keys = Array.isArray(document?.keys) ? document.keys.filter(key => key && typeof key === 'object').slice(0, 50) : [];
    if (!keys.length) throw error('OIDC_INVALID_JWKS', 502);
    jwksCache.set(uri, { keys, fetchedAt: now() });
    return keys;
  }
  function publicKey(jwk) {
    try { return crypto.createPublicKey({ key: jwk, format: 'jwk' }); } catch { throw error('OIDC_INVALID_JWKS', 502); }
  }
  function verifySignature(header, claims, signature, key) {
    const algorithm = allowedAlgorithms[header.alg];
    if (!algorithm) throw error('OIDC_UNSUPPORTED_ALGORITHM', 502);
    const data = Buffer.from(`${header.__raw}.${claims.__raw}`, 'utf8');
    let verified = false;
    try {
      const keyObject = publicKey(key);
      if (header.alg.startsWith('ES')) verified = crypto.verify(algorithm, data, { key: keyObject, dsaEncoding: 'ieee-p1363' }, signature);
      else if (header.alg.startsWith('PS')) verified = crypto.verify(algorithm, data,
        { key: keyObject, padding: crypto.constants.RSA_PKCS1_PSS_PADDING, saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST }, signature);
      else verified = crypto.verify(algorithm, data, keyObject, signature);
    } catch { verified = false; } // 密钥类型与 alg 不匹配等一律按验签失败处理
    if (!verified) throw error('OIDC_INVALID_SIGNATURE', 401);
  }
  function readJwt(token) {
    if (typeof token !== 'string' || token.length > 16000) throw error('OIDC_INVALID_ID_TOKEN', 502);
    const parts = token.split('.');
    if (parts.length !== 3 || !parts.every(part => /^[A-Za-z0-9_-]+$/.test(part))) throw error('OIDC_INVALID_ID_TOKEN', 502);
    let header, claims;
    try {
      header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
      claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    } catch { throw error('OIDC_INVALID_ID_TOKEN', 502); }
    if (!header || typeof header !== 'object' || !claims || typeof claims !== 'object') throw error('OIDC_INVALID_ID_TOKEN', 502);
    Object.defineProperty(header, '__raw', { value: parts[0] });
    Object.defineProperty(claims, '__raw', { value: parts[1] });
    return { header, claims, signature: Buffer.from(parts[2], 'base64url') };
  }
  function checkClaims(claims, header, cfg, nonce) {
    if (claims.iss !== cfg.issuer) throw error('OIDC_ISSUER_MISMATCH', 401);
    const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!audience.includes(cfg.clientId) || audience.some(value => typeof value !== 'string')) throw error('OIDC_AUDIENCE_MISMATCH', 401);
    if (audience.length > 1 && claims.azp !== cfg.clientId) throw error('OIDC_AUDIENCE_MISMATCH', 401);
    const skew = cfg.clockSkewSeconds * 1000, issuedAt = Number(claims.iat) * 1000;
    if (!Number.isFinite(issuedAt) || Math.abs(now() - issuedAt) > 5 * 60000 + skew) throw error('OIDC_CLOCK_SKEW', 401);
    if (!Number.isFinite(Number(claims.exp)) || Number(claims.exp) * 1000 <= now() - skew) throw error('OIDC_TOKEN_EXPIRED', 401);
    if (claims.nbf != null && Number(claims.nbf) * 1000 > now() + skew) throw error('OIDC_TOKEN_NOT_YET_VALID', 401);
    if (typeof claims.sub !== 'string' || !claims.sub.trim() || claims.sub.length > 255) throw error('OIDC_SUBJECT_MISSING', 401);
    if (header.alg === 'none' || claims.nonce !== nonce) throw error('OIDC_NONCE_MISMATCH', 401);
    return claims;
  }
  async function verifyIdToken({ token, cfg, document, nonce }) {
    const parsed = readJwt(token);
    const keys = await jwks(cfg, document.jwks_uri);
    const usable = key => key && (key.use === 'sig' || key.use == null);
    const candidates = parsed.header.kid
      ? keys.filter(key => usable(key) && key.kid === parsed.header.kid)
      : keys.filter(usable);
    const key = candidates.find(candidate => candidate.kty === 'RSA' || candidate.kty === 'EC');
    if (!key) {
      // Keycloak 轮换密钥后 kid 可能已不在缓存的 JWKS 里：强制刷新一次再失败。
      const refreshed = await jwks(cfg, document.jwks_uri, true);
      const retry = refreshed.find(candidate => candidate.kid === parsed.header.kid && (candidate.use === 'sig' || candidate.use == null));
      if (!retry) throw error('OIDC_UNKNOWN_KEY', 401);
      verifySignature(parsed.header, parsed.claims, parsed.signature, retry);
      return checkClaims(parsed.claims, parsed.header, cfg, nonce);
    }
    verifySignature(parsed.header, parsed.claims, parsed.signature, key);
    return checkClaims(parsed.claims, parsed.header, cfg, nonce);
  }
  async function exchangeCode({ cfg, document, code, codeVerifier }) {
    const body = new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: cfg.callback });
    if (codeVerifier) body.set('code_verifier', codeVerifier);
    const headers = { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' };
    if (cfg.clientAuth === 'client_secret_basic') {
      headers.Authorization = 'Basic ' + Buffer.from(`${encodeURIComponent(cfg.clientId)}:${encodeURIComponent(cfg.clientSecret)}`).toString('base64');
    } else { body.set('client_id', cfg.clientId); body.set('client_secret', cfg.clientSecret); }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
    let token;
    try {
      token = await readJson(await request(document.token_endpoint, { method: 'POST', headers, body: body.toString(),
        redirect: 'error', signal: controller.signal }), 64 * 1024);
    } catch (e) {
      if (e.code) throw e;
      throw error('OIDC_UPSTREAM_UNAVAILABLE', 502);
    } finally { clearTimeout(timer); }
    if (!token || typeof token !== 'object' || token.token_type && String(token.token_type).toLowerCase() !== 'bearer'
      || !string(token.access_token, 16000) || !string(token.id_token, 16000)) throw error('OIDC_INVALID_TOKEN_RESPONSE', 502);
    return token;
  }
  async function userinfo({ document, accessToken, timeoutMs }) {
    if (!document.userinfo_endpoint) return null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await readJson(await request(document.userinfo_endpoint, {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' }, redirect: 'error', signal: controller.signal }), 64 * 1024);
    } catch (e) {
      if (e.code) throw e;
      throw error('OIDC_UPSTREAM_UNAVAILABLE', 502);
    } finally { clearTimeout(timer); }
  }
  return { discovery, verifyIdToken, exchangeCode, userinfo };
}
module.exports = { createOidcClient, error, allowedAlgorithms };
