// src/services/faceSearchService.ts
// 以脸搜图（上传自拍）与照片元数据写入。上传走 multipart，不能经 request()（它按 JSON 序列化）。
import { getToken } from './authService';

export interface FindMeResult {
  ok: boolean;
  status: number;
  data: any | null;
}

/** POST /api/faces/find-me（登录态）或 /api/faces/find-me/share（分享态） */
export async function searchByFace(file: File, options: { shareCode?: string; projectId?: number | string } = {}): Promise<FindMeResult> {
  const fd = new FormData();
  fd.append('photo', file, file.name || 'find-me.jpg');
  const headers: Record<string, string> = {};
  let path = '/api/faces/find-me';
  if (options.shareCode) {
    fd.append('shareCode', options.shareCode);
    path = '/api/faces/find-me/share';
  } else {
    fd.append('projectId', String(options.projectId || ''));
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  const response = await fetch(path, { method: 'POST', headers, body: fd, credentials: 'same-origin' });
  let data = null;
  try { data = await response.json(); } catch { data = null; }
  return { ok: response.ok, status: response.status, data };
}

/** PATCH /api/photos/:id —— 写入标签与描述（JSON） */
export async function updatePhotoMeta(photoId: number | string, payload: { tags?: string[]; description?: string }): Promise<FindMeResult> {
  const token = getToken();
  const response = await fetch(`/api/photos/${encodeURIComponent(String(photoId))}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    credentials: 'same-origin',
    body: JSON.stringify(payload),
  });
  let data = null;
  try { data = await response.json(); } catch { data = null; }
  return { ok: response.ok, status: response.status, data };
}
