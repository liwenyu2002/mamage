// src/services/photoService.js
import { request, BASE_URL } from './request';

const DEFAULT_UPLOAD_CONCURRENCY = Math.max(1, Number(
  (typeof window !== 'undefined' && window.__MAMAGE_UPLOAD_CONCURRENCY__) || 4
));

function getAuthHeaders(extra = {}) {
  const token = (typeof window !== 'undefined') ? (localStorage.getItem('mamage_jwt_token') || '') : '';
  return Object.assign({}, extra, token ? { Authorization: `Bearer ${token}` } : {});
}

function fetchLatestByType(type, limit = 10) {
  const data = { limit };
  if (type) data.type = type;
  return request('/api/photos', {
    method: 'GET',
    data
  });
}

function fetchRandomByProject(projectId, limit = 4) {
  return request('/api/photos', {
    method: 'GET',
    data: { projectId, limit, random: 1 }
  });
}

function searchPhotos({ q = '', projectId, page = 1, pageSize = 20, sort = 'relevance', demo = false } = {}) {
  const data = { q, page, pageSize, sort };
  if (projectId !== undefined && projectId !== null && String(projectId).trim() !== '') {
    data.projectId = projectId;
  }
  if (demo) data.demo = 1;
  return request('/api/photos/search', {
    method: 'GET',
    data
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
    ['projectId', 'title', 'description', 'type', 'tags'].forEach((key) => {
      const val = formDataOrObj.get(key);
      if (val !== null && val !== undefined) fields[key] = val;
    });
    return { file, fields, formData: formDataOrObj };
  }
  if (formDataOrObj && typeof formDataOrObj === 'object') {
    const { file, projectId, title, description, type, tags } = formDataOrObj;
    const fd = new FormData();
    if (file) fd.append('file', file);
    if (projectId !== undefined) fd.append('projectId', String(projectId));
    if (title !== undefined) fd.append('title', String(title));
    if (description !== undefined) fd.append('description', String(description));
    if (type !== undefined) fd.append('type', String(type));
    if (tags !== undefined) fd.append('tags', Array.isArray(tags) ? JSON.stringify(tags) : String(tags));
    return {
      file,
      fields: { projectId, title, description, type, tags },
      formData: fd,
    };
  }
  throw new Error('uploadPhotos: expected FormData or { file, projectId, title, type, tags }');
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

async function putSignedObject(uploadTarget, body) {
  const resp = await fetch(uploadTarget.uploadUrl, {
    method: 'PUT',
    mode: 'cors',
    headers: uploadTarget.headers || {},
    body,
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    const err = new Error(`direct upload PUT failed ${resp.status}`);
    err.status = resp.status;
    err.body = text;
    throw err;
  }
}

async function abortDirectUpload(initData) {
  if (!initData || (!initData.original && !initData.thumb)) return;
  try {
    await request('/api/upload/photo/direct/abort', {
      method: 'POST',
      data: {
        originalKey: initData.original && initData.original.key,
        thumbKey: initData.thumb && initData.thumb.key,
      },
    });
  } catch (e) {
    // cleanup is best-effort
  }
}

async function uploadViaDirectCos(file, fields) {
  const initPayload = {
    projectId: fields.projectId,
    title: fields.title,
    description: fields.description,
    type: fields.type,
    tags: parseMaybeJsonTags(fields.tags),
    fileName: file.name || 'photo.jpg',
    fileSize: file.size,
    mimeType: file.type || '',
  };
  const initData = await request('/api/upload/photo/direct/init', {
    method: 'POST',
    data: initPayload,
  });

  try {
    const thumbBlob = await createThumbnailBlob(file);
    await Promise.all([
      putSignedObject(initData.original, file),
      putSignedObject(initData.thumb, thumbBlob),
    ]);

    return await request('/api/upload/photo/direct/complete', {
      method: 'POST',
      data: Object.assign({}, initPayload, {
        originalKey: initData.original && initData.original.key,
        thumbKey: initData.thumb && initData.thumb.key,
      }),
    });
  } catch (err) {
    await abortDirectUpload(initData);
    err.directUploadFailed = true;
    throw err;
  }
}

async function uploadViaApi(formData) {
  const uploadUrl = '/api/upload/photo';
  // eslint-disable-next-line no-console
  console.debug('[photoService] uploading to', uploadUrl);
  const resp = await fetch(uploadUrl, {
    method: 'POST',
    body: formData,
    credentials: 'same-origin',
    headers: getAuthHeaders(),
  });
  if (!resp.ok) {
    const text = await resp.text();
    const err = new Error(`upload failed ${resp.status} for ${uploadUrl}`);
    err.status = resp.status;
    err.body = text;
    // eslint-disable-next-line no-console
    console.warn('[photoService] upload endpoint returned', resp.status, 'for', uploadUrl, 'response:', text);
    throw err;
  }
  const ct = resp.headers.get('content-type') || '';
  if (ct.includes('application/json')) return resp.json();
  return { data: await resp.text() };
}

function shouldFallbackToApi(err) {
  if (!err) return true;
  if (err.status === 413 || err.status === 415) return false;
  if (err.status === 401 || err.status === 403) return false;
  return true;
}

// 上传图片，参数为 FormData 或者一个包含 { file, projectId, title, type, tags } 的对象
// 如果 tags 为数组，会自动转为 JSON 字符串
async function uploadPhotos(formDataOrObj) {
  const { file, fields, formData } = normalizeUploadPayload(formDataOrObj);
  try {
    if (canTryDirectUpload(file)) {
      try {
        return await uploadViaDirectCos(file, fields);
      } catch (directErr) {
        // eslint-disable-next-line no-console
        console.warn('[photoService] direct upload failed, fallback to API upload:', directErr);
        if (!shouldFallbackToApi(directErr)) throw directErr;
      }
    }
    return await uploadViaApi(formData);
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

async function uploadPhotoFiles(files, { projectId, title, type, tags, concurrency = DEFAULT_UPLOAD_CONCURRENCY } = {}) {
  return runLimited(files, concurrency, async (file) => {
    const response = await uploadPhotos({ file, projectId, title, type, tags });
    return {
      status: 'fulfilled',
      fileName: file && file.name,
      response,
      photo: response,
      id: response && response.id
    };
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
  deletePhotos,
};
