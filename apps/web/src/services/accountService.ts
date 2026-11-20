// src/services/accountService.ts
// 账号 / 邀请码 / 角色接口统一出口。
// 约定：返回 { ok, status, data }（不做抛错包装），调用方保留原有的分支与提示逻辑。
import { getToken } from './authService';

/** 统一的返回信封：调用方据此分支，不抛错 */
export interface ServiceEnvelope<T = unknown> {
  ok: boolean;
  status: number;
  data: T | null;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: Record<string, unknown> | null;
  signal?: AbortSignal;
}

const JSON_HEADERS = { 'Content-Type': 'application/json' };

async function raw<T = unknown>(path: string, { method = 'GET', body, signal }: RequestOptions = {}): Promise<ServiceEnvelope<T>> {
  const token = getToken();
  const response = await fetch(path, {
    method,
    credentials: 'same-origin',
    signal,
    headers: {
      ...(body ? JSON_HEADERS : null),
      ...(token ? { Authorization: `Bearer ${token}` } : null),
    } as Record<string, string>,
    ...(body ? { body: JSON.stringify(body) } : null),
  });
  let data: T | null = null;
  try { data = (await response.json()) as T; } catch { data = null; }
  return { ok: response.ok, status: response.status, data };
}

export interface DirectoryUser { id: number | string; name?: string; username?: string; email?: string; role?: string; [key: string]: unknown }

export const listAllUsers = () =>
  raw('/api/users/all') as Promise<ServiceEnvelope<{ users?: DirectoryUser[] }>>;
export const getUser = (id: number | string) =>
  raw(`/api/users/${encodeURIComponent(String(id))}`) as Promise<ServiceEnvelope<DirectoryUser>>;
export const setUserRole = (userId: number | string, role: string) =>
  raw(`/api/users/${encodeURIComponent(String(userId))}/role`, { method: 'PATCH', body: { role } });
export const listInvitations = ({ before }: { before?: string } = {}) =>
  raw('/api/users/invitations' + (before ? `?before=${encodeURIComponent(before)}` : ''));
export const createInvitation = (payload: Record<string, unknown>) =>
  raw('/api/users/invitations', { method: 'POST', body: payload });
export const revokeInvitation = (id: number | string) =>
  raw(`/api/users/invitations/${encodeURIComponent(String(id))}`, { method: 'DELETE' });
export const createMyInvite = (payload: Record<string, unknown>) =>
  raw('/api/users/me/invite', { method: 'POST', body: payload });
export const changeMyPassword = (payload: Record<string, unknown>) =>
  raw('/api/users/me/password', { method: 'POST', body: payload });
export { raw as rawAccountRequest };
