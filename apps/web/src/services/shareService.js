// src/services/shareService.js
// 公开分享（/api/share/*）统一出口：既支持"拿到响应对象自己判状态"，
// 也提供抛错版。分享页是匿名入口，这里不走 request()（它要求登录态语义）。
const JSON_HEADERS = { 'Content-Type': 'application/json' };

async function rawShareFetch(path, options = {}) {
  const response = await fetch(path, { credentials: 'same-origin', ...options });
  let data = null;
  try { data = await response.json(); } catch { data = null; }
  return { ok: response.ok, status: response.status, data, response };
}

// 拉取公开分享内容：folder 分享返回 { folder }，相册分享返回 { projectId, photos, ... }
export function fetchPublicShare(code, { projectId, limit = 100, offset = 0, signal } = {}) {
  const params = new URLSearchParams({ limit: String(limit) });
  if (offset) params.set('offset', String(offset));
  if (projectId) params.set('projectId', String(projectId));
  return rawShareFetch(`/api/share/${encodeURIComponent(code)}?${params}`, { cache: 'no-store', signal });
}

// 创建公开分享链接（相册 / 选中照片集合）
export async function createPublicLink(payload) {
  const response = await fetch('/api/share', {
    method: 'POST',
    headers: JSON_HEADERS,
    credentials: 'same-origin',
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(text || `server responded ${response.status}`);
  }
  return response.json().catch(() => null);
}

export { rawShareFetch };
