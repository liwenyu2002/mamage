// src/services/photoService.js
import { request, BASE_URL } from './request';
import { fetchLatestByType, fetchRandomByProject, searchPhotos } from './photoQueryService';

const DEFAULT_UPLOAD_CONCURRENCY = Math.max(1, Number(
  (typeof window !== 'undefined' && window.__MAMAGE_UPLOAD_CONCURRENCY__) || 4
));
const DEFAULT_LAN_UPLOAD_API_BASES = [];
const UPLOAD_PROBE_TIMEOUT_MS = Math.max(250, Number(
  (typeof window !== 'undefined' && window.__MAMAGE_UPLOAD_PROBE_TIMEOUT_MS__) || 800
));
let uploadApiBasePromise = null;

function setUploadProbeDebugState(base, source, extra = {}) {
  if (typeof window === 'undefined') return;
  try {
    window.__MAMAGE_UPLOAD_SELECTED_BASE__ = base || '';
    window.__MAMAGE_UPLOAD_SELECTED_BASE_SOURCE__ = source || '';
    if (extra.candidates) window.__MAMAGE_UPLOAD_CANDIDATE_BASES__ = extra.candidates;
    if (extra.error) window.__MAMAGE_UPLOAD_PROBE_ERROR__ = extra.error;
    else delete window.__MAMAGE_UPLOAD_PROBE_ERROR__;
  } catch (e) {
    // ignore debug-state failures
  }
}

function isVideoFile(file) {
  const mime = String(file && file.type || '').toLowerCase();
  if (mime.startsWith('video/')) return true;
  const name = String(file && file.name || '').toLowerCase();
  return /\.(mp4|m4v|mov|webm|ogv|ogg)$/i.test(name);
}

function getAuthHeaders(extra = {}) {
  const token = (typeof window !== 'undefined') ? (localStorage.getItem('mamage_jwt_token') || '') : '';
  return Object.assign({}, extra, token ? { Authorization: `Bearer ${token}` } : {});
}

function normalizeApiBase(base) {
  const raw = String(base || '').trim();
  if (!raw) return '';
  return raw.replace(/\/+$/, '');
}

function parseUploadLanBases(value) {
  if (Array.isArray(value)) return value;
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function isSameOriginBase(base) {
  if (typeof window === 'undefined' || !base) return false;
  try {
    return new URL(base, window.location.href).origin === window.location.origin;
  } catch (e) {
    return false;
  }
}

function canUseUploadBaseInBrowser(base) {
  if (typeof window === 'undefined' || !base) return false;
  try {
    const target = new URL(base, window.location.href);
    if (!/^https?:$/.test(target.protocol)) return false;
    // HTTPS pages cannot upload to HTTP LAN endpoints because browsers block mixed content.
    if (window.location.protocol === 'https:' && target.protocol === 'http:') return false;
    return true;
  } catch (e) {
    return false;
  }
}

function getUploadCandidateBases() {
  if (typeof window === 'undefined') return [];
  const explicitBase = normalizeApiBase(window.__MAMAGE_UPLOAD_API_BASE__);
  const lanBases = parseUploadLanBases(window.__MAMAGE_UPLOAD_LAN_BASES__);
  const seen = new Set();
  const candidates = [explicitBase, ...lanBases, ...DEFAULT_LAN_UPLOAD_API_BASES]
    .map(normalizeApiBase)
    .filter(Boolean)
    .filter((base) => {
      if (seen.has(base)) return false;
      seen.add(base);
      return canUseUploadBaseInBrowser(base);
    })
    .map((base) => (isSameOriginBase(base) ? '' : base))
    .filter((base) => base !== '');
  return candidates;
}

if (typeof window !== 'undefined') {
  setUploadProbeDebugState('', 'probe-not-started', { candidates: getUploadCandidateBases() });
}

async function probeUploadApiBase(base) {
  const normalized = normalizeApiBase(base);
  if (!normalized) return false;
  if (typeof fetch === 'undefined') return false;
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timeoutId = controller ? setTimeout(() => controller.abort(), UPLOAD_PROBE_TIMEOUT_MS) : null;
  try {
    const resp = await fetch(`${normalized}/api/health?uploadProbe=${Date.now()}`, {
      method: 'GET',
      mode: 'cors',
      credentials: 'include',
      cache: 'no-store',
      signal: controller ? controller.signal : undefined,
    });
    return !!(resp && resp.ok);
  } catch (e) {
    return false;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

async function getUploadApiBase() {
  if (typeof window === 'undefined') return normalizeApiBase(BASE_URL);
  if (!uploadApiBasePromise) {
    uploadApiBasePromise = (async () => {
      const fallbackBase = normalizeApiBase(BASE_URL);
      const candidates = getUploadCandidateBases();
      setUploadProbeDebugState('', 'probing', { candidates });
      const detectedBase = candidates.length ? await new Promise((resolve) => {
        let pending = candidates.length;
        let settled = false;
        candidates.forEach((base) => {
          probeUploadApiBase(base).then((ok) => {
            if (ok && !settled) {
              settled = true;
              resolve(base);
            }
          }).catch(() => false).finally(() => {
            pending -= 1;
            if (pending <= 0 && !settled) {
              settled = true;
              resolve('');
            }
          });
        });
      }) : '';
      if (detectedBase) {
        setUploadProbeDebugState(detectedBase, 'lan-probe', { candidates });
        // eslint-disable-next-line no-console
        console.info('[photoService] upload API using LAN endpoint:', detectedBase);
        return detectedBase;
      }
      setUploadProbeDebugState(fallbackBase, fallbackBase ? 'api-base' : 'same-origin', { candidates });
      return fallbackBase;
    })();
  }
  return uploadApiBasePromise;
}

function warmUploadApiProbe() {
  return getUploadApiBase().catch((err) => {
    setUploadProbeDebugState(normalizeApiBase(BASE_URL), 'probe-error', {
      candidates: getUploadCandidateBases(),
      error: err && err.message ? err.message : String(err || 'unknown'),
    });
    return normalizeApiBase(BASE_URL);
  });
}

function resolveUploadApiUrl(path, uploadApiBase = '') {
  const normalizedPath = String(path || '').startsWith('/') ? String(path || '') : `/${path || ''}`;
  const base = normalizeApiBase(uploadApiBase);
  return base ? `${base}${normalizedPath}` : normalizedPath;
}

async function requestUploadJson(path, options = {}, uploadApiBase = '') {
  const base = normalizeApiBase(uploadApiBase);
  if (!base) return request(path, options);

  const method = (options.method || 'GET').toUpperCase();
  let url = resolveUploadApiUrl(path, base);
  const headers = getAuthHeaders(Object.assign({ 'Content-Type': 'application/json' }, options.headers || {}));
  const fetchOpts = {
    method,
    headers,
    credentials: options.credentials || 'include',
  };
  if (method === 'GET' && options.data && Object.keys(options.data).length) {
    const qs = new URLSearchParams(options.data).toString();
    url += (url.includes('?') ? '&' : '?') + qs;
  } else if (options.data !== undefined) {
    fetchOpts.body = JSON.stringify(options.data);
  }
  const resp = await fetch(url, fetchOpts);
  const text = await resp.text();
  if (!resp.ok) {
    const err = new Error(`Request failed ${resp.status} ${resp.statusText}`);
    err.status = resp.status;
    err.body = text;
    throw err;
  }
  const ct = resp.headers.get('content-type') || '';
  if (ct.includes('application/json')) return text ? JSON.parse(text) : {};
  return text;
}

function emitUploadProgress(onProgress, event) {
  if (typeof onProgress !== 'function') return;
  try {
    onProgress(event);
  } catch (e) {
    // Progress callbacks must not break uploads.
  }
}

function readHeader(headersText, name) {
  const target = String(name || '').toLowerCase();
  const lines = String(headersText || '').split(/\r?\n/);
  for (const line of lines) {
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    if (line.slice(0, idx).trim().toLowerCase() === target) return line.slice(idx + 1).trim();
  }
  return '';
}

async function requestWithUploadProgress({ url, method = 'POST', headers = {}, body, withCredentials = false, onProgress }) {
  if (typeof XMLHttpRequest === 'undefined') {
    const resp = await fetch(url, {
      method,
      headers,
      body,
      credentials: withCredentials ? 'include' : 'same-origin',
    });
    const responseText = await resp.text();
    emitUploadProgress(onProgress, { loaded: 1, total: 1 });
    return {
      status: resp.status,
      statusText: resp.statusText,
      responseText,
      headers: '',
    };
  }

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, url, true);
    xhr.withCredentials = !!withCredentials;
    Object.entries(headers || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null) xhr.setRequestHeader(key, String(value));
    });
    xhr.upload.onprogress = (event) => {
      emitUploadProgress(onProgress, {
        loaded: event.loaded,
        total: event.lengthComputable ? event.total : 0,
      });
    };
    xhr.onload = () => {
      resolve({
        status: xhr.status,
        statusText: xhr.statusText,
        responseText: xhr.responseText,
        headers: xhr.getAllResponseHeaders ? xhr.getAllResponseHeaders() : '',
      });
    };
    xhr.onerror = () => {
      const err = new Error('Network error during upload');
      err.status = xhr.status || 0;
      err.body = xhr.responseText || '';
      reject(err);
    };
    xhr.ontimeout = () => {
      const err = new Error('Upload timed out');
      err.status = xhr.status || 0;
      err.body = xhr.responseText || '';
      reject(err);
    };
    xhr.send(body);
  });
}

async function getPhotoById(photoId) {
  if (photoId === undefined || photoId === null || String(photoId).trim() === '') {
    throw new Error('getPhotoById: photoId is required');
  }
  return request(`/api/photos/${encodeURIComponent(String(photoId).trim())}`, {
    method: 'GET'
  });
}

async function updatePhoto(photoId, data = {}) {
  if (photoId === undefined || photoId === null || String(photoId).trim() === '') {
    throw new Error('updatePhoto: photoId is required');
  }
  return request(`/api/photos/${encodeURIComponent(String(photoId).trim())}`, {
    method: 'PATCH',
    data,
  });
}

async function detectPhotoFaces(photoId, { force = false, projectId } = {}) {
  if (photoId === undefined || photoId === null || String(photoId).trim() === '') {
    throw new Error('detectPhotoFaces: photoId is required');
  }
  const sid = String(photoId).trim();
  const encodedId = encodeURIComponent(sid);
  const baseData = {};
  if (force) baseData.force = 1;
  if (projectId !== undefined && projectId !== null && String(projectId).trim() !== '') {
    baseData.projectId = String(projectId).trim();
  }
  const candidates = [
    { url: `/api/photos/${encodedId}/faces/detect`, method: 'POST', data: { ...baseData } },
    { url: `/api/photos/${encodedId}/faces`, method: 'POST', data: { detect: 1, ...baseData } },
    { url: `/api/photos/${encodedId}/faces`, method: 'GET', data: { detect: 1, ...baseData } },
    { url: '/api/faces/detect', method: 'POST', data: { photoId: sid, ...baseData } },
    { url: '/api/faces', method: 'GET', data: { photoId: sid, ...baseData } },
  ];

  let lastErr = null;
  for (const c of candidates) {
    try {
      return await request(c.url, { method: c.method, data: c.data });
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('detectPhotoFaces failed');
}

async function getPhotoFaces(photoId, { projectId } = {}) {
  if (photoId === undefined || photoId === null || String(photoId).trim() === '') {
    throw new Error('getPhotoFaces: photoId is required');
  }
  const sid = String(photoId).trim();
  const encodedId = encodeURIComponent(sid);
  const baseData = {};
  if (projectId !== undefined && projectId !== null && String(projectId).trim() !== '') {
    baseData.projectId = String(projectId).trim();
  }

  const candidates = [
    { url: `/api/photos/${encodedId}/faces`, method: 'GET', data: { ...baseData } },
    { url: '/api/faces', method: 'GET', data: { photoId: sid, ...baseData } },
  ];

  let lastErr = null;
  for (const c of candidates) {
    try {
      return await request(c.url, { method: c.method, data: c.data });
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('getPhotoFaces failed');
}

async function getFacePersonInfo({ faceId, personId, projectId } = {}) {
  const sid = faceId !== undefined && faceId !== null ? String(faceId).trim() : '';
  const pid = personId !== undefined && personId !== null ? String(personId).trim() : '';
  if (!sid && !pid) {
    throw new Error('getFacePersonInfo: faceId or personId is required');
  }

  const q = {};
  if (sid) q.faceId = sid;
  if (pid) q.personId = pid;
  if (projectId !== undefined && projectId !== null && String(projectId).trim() !== '') {
    q.projectId = String(projectId).trim();
  }

  const candidates = [];
  if (sid) {
    const encodedFaceId = encodeURIComponent(sid);
    candidates.push({ url: `/api/faces/${encodedFaceId}/person`, method: 'GET' });
    candidates.push({ url: `/api/faces/${encodedFaceId}`, method: 'GET' });
  }
  if (pid) {
    const encodedPersonId = encodeURIComponent(pid);
    candidates.push({ url: `/api/persons/${encodedPersonId}`, method: 'GET' });
    candidates.push({ url: `/api/persons/${encodedPersonId}/photos`, method: 'GET' });
  }
  candidates.push({ url: '/api/faces/person', method: 'GET', data: { ...q } });
  candidates.push({ url: '/api/faces/profile', method: 'GET', data: { ...q } });

  let lastErr = null;
  for (const c of candidates) {
    try {
      return await request(c.url, { method: c.method, data: c.data });
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('getFacePersonInfo failed');
}

async function labelFacePerson({ faceId, personId, personName } = {}) {
  const sid = faceId !== undefined && faceId !== null ? String(faceId).trim() : '';
  const pid = personId !== undefined && personId !== null ? String(personId).trim() : '';
  const pname = personName !== undefined && personName !== null ? String(personName).trim() : '';
  if (!sid) throw new Error('labelFacePerson: faceId is required');
  if (!pid && !pname) throw new Error('labelFacePerson: personId or personName is required');
  return request('/api/faces/label', {
    method: 'POST',
    data: {
      faceId: sid,
      personId: pid || undefined,
      personName: pname || undefined,
    },
  });
}

async function renameFacePerson({ personId, personName } = {}) {
  const pid = personId !== undefined && personId !== null ? String(personId).trim() : '';
  const pname = personName !== undefined && personName !== null ? String(personName).trim() : '';
  if (!pid) throw new Error('renameFacePerson: personId is required');
  if (!pname) throw new Error('renameFacePerson: personName is required');
  return request(`/api/persons/${encodeURIComponent(pid)}`, {
    method: 'PATCH',
    data: { personName: pname },
  });
}

async function listFacePersons({ q = '', page = 1, pageSize = 20 } = {}) {
  return request('/api/persons', {
    method: 'GET',
    data: {
      q: String(q || '').trim(),
      page,
      pageSize,
    },
  });
}

async function mergeFacePersons({ targetPersonId, sourcePersonIds } = {}) {
  const target = Number(targetPersonId);
  const sources = Array.isArray(sourcePersonIds)
    ? sourcePersonIds.map((x) => Number(x)).filter((x) => Number.isFinite(x) && x > 0)
    : [];
  if (!Number.isFinite(target) || target <= 0) {
    throw new Error('mergeFacePersons: targetPersonId is required');
  }
  if (!sources.length) {
    throw new Error('mergeFacePersons: sourcePersonIds is required');
  }
  return request('/api/persons/merge', {
    method: 'POST',
    data: {
      targetPersonId: target,
      sourcePersonIds: sources,
    },
  });
}

async function getFaceClusterConfig() {
  return request('/api/faces/cluster/config', {
    method: 'GET',
  });
}

async function updateFaceClusterConfig(matchThreshold) {
  const threshold = Number(matchThreshold);
  if (!Number.isFinite(threshold)) {
    throw new Error('updateFaceClusterConfig: matchThreshold must be a number');
  }
  return request('/api/faces/cluster/config', {
    method: 'POST',
    data: { matchThreshold: threshold },
  });
}

function normalizeUploadPayload(formDataOrObj) {
  if (formDataOrObj instanceof FormData) {
    const file = formDataOrObj.get('file');
    const fields = {};
    ['projectId', 'timelineSectionId', 'title', 'description', 'type', 'tags'].forEach((key) => {
      const val = formDataOrObj.get(key);
      if (val !== null && val !== undefined) fields[key] = val;
    });
    return { file, fields, formData: formDataOrObj };
  }
  if (formDataOrObj && typeof formDataOrObj === 'object') {
    const { file, projectId, timelineSectionId, title, description, type, tags } = formDataOrObj;
    const fd = new FormData();
    if (file) fd.append('file', file);
    if (projectId !== undefined) fd.append('projectId', String(projectId));
    if (timelineSectionId !== undefined && timelineSectionId !== null && timelineSectionId !== '') {
      fd.append('timelineSectionId', String(timelineSectionId));
    }
    if (title !== undefined) fd.append('title', String(title));
    if (description !== undefined) fd.append('description', String(description));
    if (type !== undefined) fd.append('type', String(type));
    if (tags !== undefined) fd.append('tags', Array.isArray(tags) ? JSON.stringify(tags) : String(tags));
    return {
      file,
      fields: { projectId, timelineSectionId, title, description, type, tags },
      formData: fd,
    };
  }
  throw new Error('uploadPhotos: expected FormData or { file, projectId, timelineSectionId, title, type, tags }');
}

function parseMaybeJsonTags(tags) {
  if (tags === undefined || tags === null || tags === '') return undefined;
  if (Array.isArray(tags)) return tags;
  if (typeof tags === 'string') {
    try {
      const parsed = JSON.parse(tags);
      return Array.isArray(parsed) ? parsed : tags;
    } catch (e) {
      return tags;
    }
  }
  return tags;
}

function getFileExt(name) {
  const m = String(name || '').match(/\.([a-zA-Z0-9]{2,8})$/);
  return m && m[1] ? `.${m[1].toLowerCase()}` : '';
}

function canTryDirectUpload(file) {
  if (!file || typeof File === 'undefined' || !(file instanceof File)) return false;
  if (typeof window !== 'undefined' && window.__MAMAGE_DISABLE_DIRECT_UPLOAD__) return false;
  const mime = String(file.type || '').toLowerCase();
  const ext = getFileExt(file.name);
  return mime.startsWith('image/') || ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.heic', '.heif'].includes(ext);
}

async function imageToElement(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error('thumbnail decode failed'));
    });
    return { image: img, revoke: () => URL.revokeObjectURL(url) };
  } catch (e) {
    URL.revokeObjectURL(url);
    throw e;
  }
}

async function createThumbnailBlob(file, maxDimension = 800, quality = 0.8) {
  let image;
  let cleanup = () => {};
  if (typeof createImageBitmap === 'function') {
    try {
      image = await createImageBitmap(file, { imageOrientation: 'from-image' });
      cleanup = () => { try { image.close(); } catch (e) {} };
    } catch (e) {
      const fallback = await imageToElement(file);
      image = fallback.image;
      cleanup = fallback.revoke;
    }
  } else {
    const fallback = await imageToElement(file);
    image = fallback.image;
    cleanup = fallback.revoke;
  }

  try {
    const width = image.width || image.naturalWidth;
    const height = image.height || image.naturalHeight;
    if (!width || !height) throw new Error('thumbnail image has no dimensions');
    const scale = Math.min(1, maxDimension / Math.max(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('canvas unavailable');
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) reject(new Error('thumbnail encode failed'));
        else resolve(blob);
      }, 'image/jpeg', quality);
    });
  } finally {
    cleanup();
  }
}

async function putSignedObject(uploadTarget, body, onProgress) {
  const resp = await requestWithUploadProgress({
    url: uploadTarget.uploadUrl,
    method: 'PUT',
    headers: uploadTarget.headers || {},
    body,
    withCredentials: false,
    onProgress,
  });
  if (resp.status < 200 || resp.status >= 300) {
    const err = new Error(`direct upload PUT failed ${resp.status}`);
    err.status = resp.status;
    err.body = resp.responseText || '';
    throw err;
  }
}

async function abortDirectUpload(initData, uploadApiBase = '') {
  if (!initData || (!initData.original && !initData.thumb)) return;
  try {
    await requestUploadJson('/api/upload/photo/direct/abort', {
      method: 'POST',
      data: {
        originalKey: initData.original && initData.original.key,
        thumbKey: initData.thumb && initData.thumb.key,
      },
    }, uploadApiBase);
  } catch (e) {
    // cleanup is best-effort
  }
}

async function uploadViaDirectCos(file, fields, { onProgress, uploadApiBase = '' } = {}) {
  const initPayload = {
    projectId: fields.projectId,
    timelineSectionId: fields.timelineSectionId,
    title: fields.title,
    description: fields.description,
    type: fields.type,
    tags: parseMaybeJsonTags(fields.tags),
    fileName: file.name || 'photo.jpg',
    fileSize: file.size,
    mimeType: file.type || '',
  };
  emitUploadProgress(onProgress, {
    file,
    phase: 'preparing',
    loaded: 0,
    total: file.size || 0,
  });
  const initData = await requestUploadJson('/api/upload/photo/direct/init', {
    method: 'POST',
    data: initPayload,
  }, uploadApiBase);

  try {
    emitUploadProgress(onProgress, {
      file,
      phase: 'thumbnail',
      loaded: 0,
      total: file.size || 0,
    });
    const thumbBlob = await createThumbnailBlob(file);
    const loadedByPart = { original: 0, thumb: 0 };
    const totalByPart = {
      original: file.size || 0,
      thumb: thumbBlob.size || 0,
    };
    const reportCombined = () => {
      const loaded = (loadedByPart.original || 0) + (loadedByPart.thumb || 0);
      const total = (totalByPart.original || 0) + (totalByPart.thumb || 0);
      emitUploadProgress(onProgress, {
        file,
        phase: 'uploading',
        loaded,
        total,
      });
    };
    await Promise.all([
      putSignedObject(initData.original, file, (event) => {
        if (event.total) totalByPart.original = event.total;
        loadedByPart.original = event.loaded || 0;
        reportCombined();
      }),
      putSignedObject(initData.thumb, thumbBlob, (event) => {
        if (event.total) totalByPart.thumb = event.total;
        loadedByPart.thumb = event.loaded || 0;
        reportCombined();
      }),
    ]);

    const total = (totalByPart.original || 0) + (totalByPart.thumb || 0);
    emitUploadProgress(onProgress, {
      file,
      phase: 'completing',
      loaded: total,
      total,
    });
    const response = await requestUploadJson('/api/upload/photo/direct/complete', {
      method: 'POST',
      data: Object.assign({}, initPayload, {
        originalKey: initData.original && initData.original.key,
        thumbKey: initData.thumb && initData.thumb.key,
      }),
    }, uploadApiBase);
    emitUploadProgress(onProgress, {
      file,
      phase: 'done',
      status: 'fulfilled',
      loaded: total,
      total,
    });
    return response;
  } catch (err) {
    await abortDirectUpload(initData, uploadApiBase);
    err.directUploadFailed = true;
    throw err;
  }
}

async function uploadViaApi(formData, { onProgress, file, uploadApiBase = '' } = {}) {
  const uploadUrl = resolveUploadApiUrl('/api/upload/photo', uploadApiBase);
  let apiUploadTotal = (file && file.size) || 0;
  // eslint-disable-next-line no-console
  console.debug('[photoService] uploading to', uploadUrl);
  emitUploadProgress(onProgress, {
    file: file || formData.get('file'),
    phase: 'uploading',
    loaded: 0,
    total: (file && file.size) || 0,
  });
  const resp = await requestWithUploadProgress({
    url: uploadUrl,
    method: 'POST',
    body: formData,
    headers: getAuthHeaders(),
    withCredentials: true,
    onProgress: (event) => {
      if (event.total) apiUploadTotal = event.total;
      emitUploadProgress(onProgress, {
        file: file || formData.get('file'),
        phase: 'uploading',
        loaded: event.loaded,
        total: event.total || apiUploadTotal,
      });
    },
  });
  if (resp.status < 200 || resp.status >= 300) {
    const err = new Error(`upload failed ${resp.status} for ${uploadUrl}`);
    err.status = resp.status;
    err.body = resp.responseText || '';
    // eslint-disable-next-line no-console
    console.warn('[photoService] upload endpoint returned', resp.status, 'for', uploadUrl, 'response:', resp.responseText || '');
    throw err;
  }
  const ct = readHeader(resp.headers, 'content-type') || '';
  const text = resp.responseText || '';
  const total = apiUploadTotal || Math.max(Number(file && file.size) || 0, text.length || 0);
  emitUploadProgress(onProgress, {
    file: file || formData.get('file'),
    phase: 'done',
    status: 'fulfilled',
    loaded: total,
    total,
  });
  if (ct.includes('application/json')) return text ? JSON.parse(text) : {};
  return { data: text };
}

async function uploadViaVideoApi(formData, { onProgress, file, uploadApiBase = '' } = {}) {
  const uploadUrl = resolveUploadApiUrl('/api/upload/video', uploadApiBase);
  let uploadTotal = (file && file.size) || 0;
  emitUploadProgress(onProgress, {
    file: file || formData.get('file'),
    phase: 'uploading',
    loaded: 0,
    total: uploadTotal,
  });
  const resp = await requestWithUploadProgress({
    url: uploadUrl,
    method: 'POST',
    body: formData,
    headers: getAuthHeaders(),
    withCredentials: true,
    onProgress: (event) => {
      if (event.total) uploadTotal = event.total;
      emitUploadProgress(onProgress, {
        file: file || formData.get('file'),
        phase: 'uploading',
        loaded: event.loaded,
        total: event.total || uploadTotal,
      });
    },
  });
  if (resp.status < 200 || resp.status >= 300) {
    const err = new Error(`video upload failed ${resp.status} for ${uploadUrl}`);
    err.status = resp.status;
    err.body = resp.responseText || '';
    throw err;
  }
  const ct = readHeader(resp.headers, 'content-type') || '';
  const text = resp.responseText || '';
  const total = uploadTotal || Math.max(Number(file && file.size) || 0, text.length || 0);
  emitUploadProgress(onProgress, {
    file: file || formData.get('file'),
    phase: 'done',
    status: 'fulfilled',
    loaded: total,
    total,
  });
  if (ct.includes('application/json')) return text ? JSON.parse(text) : {};
  return { data: text };
}

function shouldFallbackToApi(err) {
  if (!err) return true;
  if (err.status === 413 || err.status === 415) return false;
  if (err.status === 401 || err.status === 403) return false;
  return true;
}

function parseErrorBody(err) {
  if (!err || !err.body || typeof err.body !== 'string') return null;
  try {
    return JSON.parse(err.body);
  } catch (e) {
    return null;
  }
}

function isDirectUploadUnavailable(err) {
  const payload = parseErrorBody(err);
  return err && err.status === 409 && payload && payload.error === 'DIRECT_UPLOAD_UNAVAILABLE';
}

// 上传图片，参数为 FormData 或者一个包含 { file, projectId, title, type, tags } 的对象
// 如果 tags 为数组，会自动转为 JSON 字符串
async function uploadPhotos(formDataOrObj, { onProgress } = {}) {
  const { file, fields, formData } = normalizeUploadPayload(formDataOrObj);
  const uploadApiBase = await getUploadApiBase();
  try {
    if (isVideoFile(file)) {
      return await uploadViaVideoApi(formData, { onProgress, file, uploadApiBase });
    }
    if (canTryDirectUpload(file)) {
      try {
        return await uploadViaDirectCos(file, fields, { onProgress, uploadApiBase });
      } catch (directErr) {
        if (isDirectUploadUnavailable(directErr)) {
          if (typeof window !== 'undefined') window.__MAMAGE_DISABLE_DIRECT_UPLOAD__ = true;
        } else {
          // eslint-disable-next-line no-console
          console.warn('[photoService] direct upload failed, fallback to API upload:', directErr);
        }
        if (!shouldFallbackToApi(directErr)) throw directErr;
        emitUploadProgress(onProgress, {
          file,
          phase: 'fallback',
          loaded: 0,
          total: file && file.size ? file.size : 0,
        });
      }
    }
    return await uploadViaApi(formData, { onProgress, file, uploadApiBase });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[photoService] upload attempt failed', e);
    throw e;
  }
}

async function runLimited(items, limit, worker) {
  const queue = Array.from(items || []);
  const results = new Array(queue.length);
  let cursor = 0;
  const workerCount = Math.min(Math.max(1, Number(limit) || DEFAULT_UPLOAD_CONCURRENCY), queue.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (cursor < queue.length) {
      const idx = cursor;
      cursor += 1;
      try {
        results[idx] = await worker(queue[idx], idx);
      } catch (err) {
        results[idx] = { status: 'rejected', fileName: queue[idx] && queue[idx].name, error: err };
      }
    }
  });
  await Promise.all(workers);
  return results;
}

async function uploadPhotoFiles(files, { projectId, timelineSectionId, title, type, tags, concurrency = DEFAULT_UPLOAD_CONCURRENCY, onProgress } = {}) {
  return runLimited(files, concurrency, async (file, index) => {
    const report = (event) => emitUploadProgress(onProgress, {
      ...(event || {}),
      file,
      fileName: file && file.name,
      index,
    });
    report({
      phase: 'queued',
      loaded: 0,
      total: file && file.size ? file.size : 0,
    });
    try {
      const response = await uploadPhotos({ file, projectId, timelineSectionId, title, type, tags }, { onProgress: report });
      report({
        phase: 'done',
        status: 'fulfilled',
      });
      return {
        status: 'fulfilled',
        fileName: file && file.name,
        response,
        photo: response,
        id: response && response.id
      };
    } catch (err) {
      report({
        phase: 'failed',
        status: 'rejected',
        error: err && (err.message || String(err)),
      });
      throw err;
    }
  });
}

// 删除照片，photoIds: Array<number|string>
async function deletePhotos(photoIds) {
  if (!Array.isArray(photoIds)) photoIds = [photoIds];

  const baseMaybe = (typeof window !== 'undefined' && window.__MAMAGE_API_BASE__) ? window.__MAMAGE_API_BASE__ : (BASE_URL || '');
  const fallbackHost = '';
  // prefer relative endpoints first (avoids CORS preflight when using devServer proxy)
  const candidates = [];
  candidates.push({ url: '/api/photos/delete', opts: { method: 'POST', data: { photoIds } } });
  candidates.push({ url: '/api/photos', opts: { method: 'DELETE', data: { photoIds } } });
  candidates.push({ url: '/api/photos', opts: { method: 'POST', data: { photoIds } } });

  // then try configured base (if provided)
  if (baseMaybe) {
    candidates.push({ url: `${baseMaybe.replace(/\/+$/,'')}/api/photos/delete`, opts: { method: 'POST', data: { photoIds } } });
    candidates.push({ url: `${baseMaybe.replace(/\/+$/,'')}/api/photos`, opts: { method: 'DELETE', data: { photoIds } } });
    candidates.push({ url: `${baseMaybe.replace(/\/+$/,'')}/api/photos`, opts: { method: 'POST', data: { photoIds } } });
  }

  // absolute fallback host last (likely cross-origin from dev server)
  if (fallbackHost) {
    candidates.push({ url: `${fallbackHost}/api/photos/delete`, opts: { method: 'POST', data: { photoIds } } });
    candidates.push({ url: `${fallbackHost}/api/photos`, opts: { method: 'DELETE', data: { photoIds } } });
    candidates.push({ url: `${fallbackHost}/api/photos`, opts: { method: 'POST', data: { photoIds } } });
  }

  let lastErr = null;
  // attach Authorization header when possible
  const token = (typeof window !== 'undefined') ? (localStorage.getItem('mamage_jwt_token') || '') : '';

  for (const c of candidates) {
    try {
      // prefer using the request helper for relative/absolute mapping when appropriate
      // if url is absolute (starts with http) call fetch directly, otherwise use request()
      // eslint-disable-next-line no-console
      console.debug('[photoService] trying delete endpoint:', c.url, c.opts.method);
      if (/^https?:\/\//i.test(c.url)) {
        // absolute URL — use fetch directly to avoid REQUEST wrapper base-prefixing
        const resp = await fetch(c.url, {
          method: c.opts.method,
          headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: `Bearer ${token}` } : {}),
          credentials: 'same-origin',
          body: JSON.stringify(c.opts.data)
        });
        if (resp.ok) {
          const ct = resp.headers.get('content-type') || '';
          if (ct.includes('application/json')) return resp.json();
          return resp.text();
        }
        const text = await resp.text();
        const err = new Error(`delete failed ${resp.status} for ${c.url}`);
        err.status = resp.status; err.body = text;
        // eslint-disable-next-line no-console
        console.warn('[photoService] delete endpoint returned', resp.status, 'for', c.url, 'response:', text);
        lastErr = err;
        continue;
      }

      // relative URL — use request helper
      try {
        // ensure Authorization header passed to request helper
        const optsWithHeaders = Object.assign({}, c.opts, { headers: Object.assign({}, c.opts.headers || {}, token ? { Authorization: `Bearer ${token}` } : {}) });
        return await request(c.url.replace(/^\/+/, '/'), optsWithHeaders);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[photoService] request() delete attempt failed for', c.url, e);
        lastErr = e;
        continue;
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[photoService] delete attempt failed for', c.url, e);
      lastErr = e;
      continue;
    }
  }

  const finalErr = new Error('deletePhotos: all delete endpoints failed');
  finalErr.cause = lastErr;
  throw finalErr;
}

export {
  fetchLatestByType,
  fetchRandomByProject,
  searchPhotos,
  getPhotoById,
  updatePhoto,
  detectPhotoFaces,
  getPhotoFaces,
  getFacePersonInfo,
  labelFacePerson,
  renameFacePerson,
  listFacePersons,
  mergeFacePersons,
  getFaceClusterConfig,
  updateFaceClusterConfig,
  uploadPhotos,
  uploadPhotoFiles,
  warmUploadApiProbe,
  deletePhotos,
};
