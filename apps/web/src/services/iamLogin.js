export function hasIamHandoff(location) {
  return /(?:^#|&)iam_(?:code|error)=/.test(location.hash || '');
}
export async function finishIamLogin({ location = window.location, history = window.history, storage = window.localStorage, request = fetch } = {}) {
  const match = String(location.hash || '').match(/(?:^#|&)iam_code=([^&]*)/);
  if (!match && !hasIamHandoff(location)) return;
  if (match) history.replaceState({}, '', location.pathname + location.search);
  try {
    storage.removeItem('mamage_jwt_token');
    if (!match) return;
    const code = decodeURIComponent(match[1]);
    if (!/^[\w-]{43}$/.test(code)) throw Error('Invalid handoff');
    const response = await request('/api/auth/iam/session', { method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
    const result = await response.json();
    if (!response.ok || typeof result.token !== 'string' || !result.token) throw Error('Login unavailable');
    const target = new URL(result.returnTo || '/', location.origin);
    if (target.origin !== location.origin || target.pathname.startsWith('/api/')) throw Error('Invalid destination');
    storage.setItem('mamage_jwt_token', result.token);
    if (target.pathname + target.search !== location.pathname + location.search) location.replace(target.pathname + target.search);
  } catch {
    history.replaceState({}, '', location.pathname + location.search + '#iam_error=IAM_LOGIN_UNAVAILABLE');
  }
}
