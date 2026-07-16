import { BASE_URL } from './request';
import { getToken } from './authService';

const directUrlCache = new Map();
let directStatusPromise = null;

function apiUrl(path) {
  return `${BASE_URL || ''}${path}`;
}

function canAttemptDirectStorage() {
  return typeof window !== 'undefined' && window.location && window.location.protocol === 'http:';
}

async function requestJson(path, options = {}) {
  const token = getToken();
  if (!token) return null;
  const response = await fetch(apiUrl(path), {
    method: options.method || 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    },
    credentials: 'same-origin',
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (response.status === 401 || response.status === 403 || response.status === 409) return null;
  if (!response.ok) {
    let detail = '';
    try {
      const data = await response.json();
      detail = data && (data.error || data.message) ? `: ${data.error || data.message}` : '';
    } catch (e) { /* ignore */ }
    throw new Error(`direct storage request failed ${response.status}${detail}`);
  }
  return response.json();
}

export async function getDirectStorageStatus() {
  if (!canAttemptDirectStorage()) return { eligible: false };
  if (!directStatusPromise) {
    directStatusPromise = requestJson('/api/photos/direct-status')
      .then((result) => result || { eligible: false })
      .catch(() => ({ eligible: false }));
  }
  return directStatusPromise;
}

export async function getDirectMediaUrl(photoId, variant = 'original', options = {}) {
  if (!photoId || !canAttemptDirectStorage()) return null;
  const status = await getDirectStorageStatus();
  if (!status || !status.eligible) return null;

  const download = options.download ? '1' : '0';
  const key = `${photoId}:${variant}:${download}`;
  const cached = directUrlCache.get(key);
  if (cached && cached.expiresAt > Date.now() + 30000) return cached.url;

  const result = await requestJson(`/api/photos/${encodeURIComponent(String(photoId))}/direct-url?variant=${encodeURIComponent(variant)}&download=${download}`);
  if (!result || !result.url) return null;
  const ttlMs = Math.max(60000, Number(result.expiresIn || 900) * 1000);
  directUrlCache.set(key, { url: result.url, expiresAt: Date.now() + ttlMs });
  return result.url;
}

export async function startDirectZipJob({ photoIds, zipName }) {
  if (!canAttemptDirectStorage()) return null;
  const status = await getDirectStorageStatus();
  if (!status || !status.eligible) return null;
  return requestJson('/api/photos/zip-direct', {
    method: 'POST',
    body: { photoIds, zipName },
  });
}

export async function getDirectZipJob(jobId) {
  if (!jobId || !canAttemptDirectStorage()) return null;
  return requestJson(`/api/photos/zip-direct/${encodeURIComponent(String(jobId))}`);
}

export function triggerDirectDownload(url) {
  if (!url || typeof document === 'undefined') return false;
  const anchor = document.createElement('a');
  anchor.href = url;
  // 跨域下载是否保存由签名 URL 的 Content-Disposition 决定；不要依赖 download 属性。
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  return true;
}

export function clearDirectMediaUrlCache() {
  directUrlCache.clear();
  directStatusPromise = null;
}
