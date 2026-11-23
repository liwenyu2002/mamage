// src/services/shareService.ts
// Public reads do not attach the workspace session. Share management uses workspaceService.
export interface ShareEnvelope<T = unknown> {
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

export async function fetchPublicShare<T = unknown>(
  code: string,
  { projectId, limit = 100, offset = 0, signal }: PublicShareQuery = {},
): Promise<ShareEnvelope<T>> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (offset) params.set('offset', String(offset));
  if (projectId) params.set('projectId', String(projectId));
  const response = await fetch(`/api/share/${encodeURIComponent(code)}?${params}`, {
    credentials: 'same-origin', cache: 'no-store', signal,
  });
  const data = await response.json().catch(() => null) as T | null;
  return { ok: response.ok, status: response.status, data };
}
