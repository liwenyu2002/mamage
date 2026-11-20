// src/services/accountService.js
// 账号 / 邀请码 / 角色接口统一出口。
// 约定：返回 { ok, status, data }（不做抛错包装），调用方保留原有的分支与提示逻辑。
import { getToken } from './authService';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

async function raw(path, { method = 'GET', body, signal } = {}) {
  const token = getToken();
  const response = await fetch(path, {
    method,
    credentials: 'same-origin',
    signal,
    headers: { ...(body ? JSON_HEADERS : null), ...(token ? { Authorization: `Bearer ${token}` } : null) },
    ...(body ? { body: JSON.stringify(body) } : null),
  });
  let data = null;
  try { data = await response.json(); } catch { data = null; }
  return { ok: response.ok, status: response.status, data };
}

export const listAllUsers = () => raw('/api/users/all');
export const getUser = id => raw(`/api/users/${encodeURIComponent(id)}`);
export const setUserRole = (userId, role) => raw(`/api/users/${encodeURIComponent(userId)}/role`, { method: 'PATCH', body: { role } });
export const listInvitations = ({ before } = {}) => raw('/api/users/invitations' + (before ? `?before=${encodeURIComponent(before)}` : ''));
export const createInvitation = payload => raw('/api/users/invitations', { method: 'POST', body: payload });
export const revokeInvitation = id => raw(`/api/users/invitations/${encodeURIComponent(id)}`, { method: 'DELETE' });
export const createMyInvite = payload => raw('/api/users/me/invite', { method: 'POST', body: payload });
export const changeMyPassword = payload => raw('/api/users/me/password', { method: 'POST', body: payload });
export { raw as rawAccountRequest };
