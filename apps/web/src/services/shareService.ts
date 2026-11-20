// src/services/shareService.ts
// 公开分享（/api/share/*）统一出口。
// 分享页是匿名入口，不走 request()（它隐含登录态语义），这里直接 fetch 并返回值语义类型。
export interface ShareEnvelope<T = any> {
  ok: boolean;
  status: number;
  data: T | null;
}

export interface PublicShareQuery {
  projectId?: string | number | null;
  limit?: number;
  offset?: number;
  signal?: AbortSignal;
}

async function rawShareFetch<T = any>(path: string, init: RequestInit = {}): Promise<ShareEnvelope<T>> {
  const response = await fetch(path, { credentials: 'same-origin', ...init });
  let data: T | null = null;
  try { data = (await response.json()) as T; } catch { data = null; }
  return { ok: response.ok, status: response.status, data };
}

/** 拉取公开分享内容：文件夹分享返回 { folder }，相册分享返回 { projectId, photos, ... } */
export function fetchPublicShare<T = any>(code: string, { projectId, limit = 100, offset = 0, signal }: PublicShareQuery = {}) {
  const params = new URLSearchParams({ limit: String(limit) });
  if (offset) params.set('offset', String(offset));
  if (projectId) params.set('projectId', String(projectId));
  return rawShareFetch<T>(`/api/share/${encodeURIComponent(code)}?${params}`, { cache: 'no-store', signal });
}

/** 创建公开分享链接（相册 / 选中照片集合）。失败抛错，调用方按文案提示。 */
export async function createPublicLink<T = any>(payload: Record<string, unknown>): Promise<T | null> {
  const response = await fetch('/api/share', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(text || `server responded ${response.status}`);
  }
  return response.json().catch(() => null) as Promise<T | null>;
}

export { rawShareFetch };
