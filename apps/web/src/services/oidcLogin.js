// OIDC（Keycloak）登录的前端交接：与 iamLogin 同构，但回调 fragment 与 session 接口独立，
// 避免和芯盾校园登录的临时码互相覆盖。
export function hasOidcHandoff(location) {
  return /(?:^#|&)oidc_(?:code|error)=/.test(location.hash || '');
}
export function oidcLoginUrl(location) {
  return '/api/auth/oidc/login?returnTo=' + encodeURIComponent(location.pathname + location.search);
}
// 可选的无感登录：仅在 OIDC_AUTO_START=1 且本标签页 2 分钟内没试过时自动跳转；
// 带错误/邀请参数或已经手动选了登录方式时不跳，避免失败后循环。
export function autoStartOidcLogin({ providers, location, storage, now = Date.now() }) {
  if (!providers?.oidc || !providers?.oidcAutoStart) return false;
  if (/(?:oidc|iam|dingtalk)_(?:error|code|token)=/.test(location.hash || '')) return false;
  const params = new URLSearchParams(location.search);
  if (['invite', 'invite_code', 'inviteCode'].some(key => params.has(key))) return false;
  try {
    const previous = Number(storage.getItem('mamage_oidc_login_attempt'));
    if (previous > 0 && now - previous < 120000) return false;
    storage.setItem('mamage_oidc_login_attempt', String(now));
  } catch { return false; }
  location.replace(oidcLoginUrl(location));
  return true;
}
export async function finishOidcLogin({ location = window.location, history = window.history,
  storage = window.localStorage, request = fetch } = {}) {
  const match = String(location.hash || '').match(/(?:^#|&)oidc_code=([^&]*)/);
  if (!match && !hasOidcHandoff(location)) return;
  if (match) history.replaceState({}, '', location.pathname + location.search);
  try {
    storage.removeItem('mamage_jwt_token');
    if (!match) return { failed: true };
    const code = decodeURIComponent(match[1]);
    if (!/^[\w-]{43}$/.test(code)) throw Error('Invalid handoff');
    const response = await request('/api/auth/oidc/session', { method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
    const result = await response.json();
    if (!response.ok || typeof result.token !== 'string' || !result.token) throw Error('Login unavailable');
    const target = new URL(result.returnTo || '/', location.origin);
    if (target.origin !== location.origin || target.pathname.startsWith('/api/')) throw Error('Invalid destination');
    storage.setItem('mamage_jwt_token', result.token);
    if (target.pathname + target.search !== location.pathname + location.search) location.replace(target.pathname + target.search);
    return { token: result.token };
  } catch {
    history.replaceState({}, '', location.pathname + location.search + '#oidc_error=OIDC_LOGIN_UNAVAILABLE');
    return { failed: true };
  }
}
