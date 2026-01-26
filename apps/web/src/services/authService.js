// src/services/authService.js
import { setPermissions, clearPermissions } from '../permissions/permissionStore';

const API_PREFIX = '/api/users';
const TOKEN_KEY = 'mamage_jwt_token';
const DEBUG = true; // 临时调试开关，调试完成后可设为 false

function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}
export function getToken() { return localStorage.getItem(TOKEN_KEY); }

async function requestJson(url, opts = {}) {
  const headers = Object.assign({}, opts.headers || {});
  if (!headers['Authorization']) {
    const t = getToken();
    if (t) headers['Authorization'] = `Bearer ${t}`;
  }
  if (!headers['Content-Type'] && !(opts.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }
  if (DEBUG) {
    try {
      console.debug('[authService] request:', opts.method || 'GET', url, opts.body ? (typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body)) : undefined);
    } catch (e) {}
  }
  const res = await fetch(url, Object.assign({}, opts, { headers }));
  const text = await res.text();
  try {
    const data = text ? JSON.parse(text) : null;
    if (res.status === 401) {
      // clear token on unauthorized to avoid repeated 401s
      console.warn('Received 401 from', url, 'clearing stored token');
      setToken(null);
      clearPermissions();
    }
    if (DEBUG) console.debug('[authService] response:', res.status, data);
    return { ok: res.ok, data, status: res.status };
  } catch (e) {
    if (res.status === 401) {
      console.warn('Received 401 from', url, 'clearing stored token');
      setToken(null);
      clearPermissions();
    }
    if (DEBUG) console.debug('[authService] response-text:', res.status, text);
    return { ok: res.ok, data: text, status: res.status };
  }
}

export async function me() {
  const r = await requestJson(`${API_PREFIX}/me`, { method: 'GET' });
  if (!r.ok) return null;
  // Backend now returns: { id, username, role, permissions, ... }
  const perms = Array.isArray(r.data?.permissions) ? r.data.permissions : [];
  setPermissions(perms);
  return r.data;
}

export async function login(email, password) {
  const payload = { password };
  if (email) payload.email = email;
  const r = await requestJson(`${API_PREFIX}/login`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error((r.data && r.data.error) || '登录失败');
  if (r.data && r.data.token) setToken(r.data.token);
  // Backend login response should include: { id, token, username, role, permissions }
  // Return the full data (no need to call me() again if login response is complete)
  if (r.data && r.data.permissions) {
    setPermissions(Array.isArray(r.data.permissions) ? r.data.permissions : []);
    return r.data;
  }
  // Fallback: fetch user if login response doesn't include permissions
  return await me();
}

export async function register({ name, password, email, student_no }) {
  const payload = { name, password };
  if (email) payload.email = email;
  if (student_no) payload.student_no = student_no;
  const r = await requestJson(`${API_PREFIX}/register`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  if (!r.ok) {
    const err = new Error((r.data && r.data.message) || '注册失败');
    if (r.data && r.data.error) err.code = r.data.error;
    throw err;
  }
  // If backend returns a token, save it and return current user info.
  if (r.data && r.data.token) {
    setToken(r.data.token);
    return await me();
  }
  // Registration succeeded but no token returned (backend may require separate login).
  // Return the raw response so caller can decide next step.
  return r.data || { registered: true };
}

export async function updateMe(payload) {
  const r = await requestJson(`${API_PREFIX}/me`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
  if (!r.ok) {
    const err = new Error((r.data && r.data.message) || '更新失败');
    if (r.data && r.data.error) err.code = r.data.error;
    throw err;
  }
  return r.data;
}

export async function logout() {
  // just clear token client-side; backend has no logout endpoint by default
  setToken(null);
  clearPermissions();
}

export default { me, login, register, logout, updateMe, getToken };
