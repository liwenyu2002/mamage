import { BASE_URL, request } from './request';
import { getToken } from './authService';
import { createMediaDownloader } from './mediaDownload';

const directUrlCache = new Map();
const directUrlRequests = new Map();
let directStatusPromise = null;
let directStatusCache = null;
let cacheToken;
let cacheVersion = 0;

function syncCacheScope() {
  const token = getToken();
  if (token !== cacheToken) {
    clearDirectMediaUrlCache();
    cacheToken = token;
  }
  return cacheVersion;
}

function apiUrl(path) {
  return `${BASE_URL || ''}${path}`;
}

function canAttemptDirectStorage() {
  return typeof window !== 'undefined' && window.location && window.location.protocol === 'http:';
}

async function requestJson(path, options = {}) {
  const token = getToken();
  if (!token) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(apiUrl(path), {
      method: options.method || 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      },
      credentials: 'same-origin',
      cache: 'no-store',
      signal: controller.signal,
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
    return await response.json();
  } finally { clearTimeout(timeout); }
}

export async function getDirectStorageStatus() {
  if (!canAttemptDirectStorage()) return { eligible: false };
  const version = syncCacheScope();
  if (directStatusCache?.expiresAt > Date.now()) return directStatusCache.value;
  if (!directStatusPromise) {
    const pending = requestJson('/api/photos/direct-status')
      .then((result) => {
        if (version !== syncCacheScope()) return { eligible: false };
        if (result) directStatusCache = { value: result, expiresAt: Date.now() + (result.eligible ? 30000 : 2000) };
        return result || { eligible: false };
      })
      .catch(() => ({ eligible: false }))
      .finally(() => { if (directStatusPromise === pending) directStatusPromise = null; });
    directStatusPromise = pending;
  }
  return directStatusPromise;
}

export async function getDirectMediaUrl(photoId, variant = 'original', options = {}) {
  if (!photoId || !canAttemptDirectStorage()) return null;
  const version = syncCacheScope();
  const status = await getDirectStorageStatus();
  if (version !== syncCacheScope() || !status || !status.eligible) return null;

  const download = options.download ? '1' : '0';
  const key = `${photoId}:${variant}:${download}`;
  const cached = directUrlCache.get(key);
  if (!options.forceRefresh && cached && cached.expiresAt > Date.now() + 30000) return cached.url;
  const existing = directUrlRequests.get(key);
  if (existing && (!options.forceRefresh || existing.refresh)) return existing.promise;
  if (options.forceRefresh) directUrlCache.delete(key);
  // Network/signing latency consumes the lifetime; a short capability must not be extended by the client.
  const startedAt = Date.now(), entry = { refresh: !!options.forceRefresh };
  entry.promise = requestJson(`/api/photos/${encodeURIComponent(String(photoId))}/direct-url?variant=${encodeURIComponent(variant)}&download=${download}`)
    .then((result) => {
      if (version !== syncCacheScope() || !result?.url) return null;
      const seconds = result.expiresIn == null ? 900 : Number(result.expiresIn);
      if (Number.isFinite(seconds) && seconds > 0 && directUrlRequests.get(key) === entry) {
        directUrlCache.set(key, { url: result.url, expiresAt: startedAt + seconds * 1000 });
      }
      return result.url;
    })
    .finally(() => { if (directUrlRequests.get(key) === entry) directUrlRequests.delete(key); });
  directUrlRequests.set(key, entry);
  return entry.promise;
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

export async function listActiveDirectZipJobs() {
  if (!canAttemptDirectStorage()) return [];
  const result = await requestJson('/api/photos/zip-direct');
  return result && Array.isArray(result.jobs) ? result.jobs : [];
}

export async function cancelDirectZipJob(jobId) {
  if (!jobId || !canAttemptDirectStorage()) return null;
  return requestJson(`/api/photos/zip-direct/${encodeURIComponent(String(jobId))}/cancel`, { method: 'POST' });
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

export const downloadOriginalMedia = createMediaDownloader({
  getDirectUrl: (photoId, options) => getDirectMediaUrl(photoId, 'original', { ...options, download: true }),
  getFallbackUrl: async ({ photoId, url }) => {
    if (!photoId || !getToken()) return url;
    const fresh = await request(`/api/photos/${encodeURIComponent(String(photoId))}`, { timeoutMs: 10000 });
    return fresh?.url;
  },
});

export function clearDirectMediaUrlCache() {
  cacheVersion++;
  cacheToken = undefined;
  directUrlCache.clear();
  directUrlRequests.clear();
  directStatusPromise = null;
  directStatusCache = null;
}
