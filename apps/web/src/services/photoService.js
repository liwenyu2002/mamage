// src/services/photoService.js
import { request, BASE_URL } from './request';

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

// 上传图片，参数为 FormData 或者一个包含 { file, projectId, title, type, tags } 的对象
// 如果 tags 为数组，会自动转为 JSON 字符串
async function uploadPhotos(formDataOrObj) {
  // normalize to FormData
  let fd;
  if (formDataOrObj instanceof FormData) {
    fd = formDataOrObj;
  } else if (formDataOrObj && typeof formDataOrObj === 'object') {
    fd = new FormData();
    const { file, projectId, title, type, tags } = formDataOrObj;
    // append file (required)
    if (file) {
      fd.append('file', file);
    }
    // append optional fields
    if (projectId !== undefined) fd.append('projectId', String(projectId));
    if (title !== undefined) fd.append('title', String(title));
    if (type !== undefined) fd.append('type', String(type));
    // if tags is array, convert to JSON string
    if (tags !== undefined) {
      const tagsStr = Array.isArray(tags) ? JSON.stringify(tags) : String(tags);
      fd.append('tags', tagsStr);
    }
  } else {
    throw new Error('uploadPhotos: expected FormData or { file, projectId, title, type, tags }');
  }

  // Correct endpoint: POST /api/upload/photo
  const uploadUrl = '/api/upload/photo';
  try {
    // eslint-disable-next-line no-console
    console.debug('[photoService] uploading to', uploadUrl);
    // Get JWT token for Authorization header
    const token = (typeof window !== 'undefined') ? (localStorage.getItem('mamage_jwt_token') || '') : '';
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    // send FormData as-is; do not set Content-Type so browser can add multipart boundary
    const resp = await fetch(uploadUrl, { 
      method: 'POST', 
      body: fd, 
      credentials: 'same-origin',
      headers 
    });
    if (!resp.ok) {
      const text = await resp.text();
      const err = new Error(`upload failed ${resp.status} for ${uploadUrl}`);
      err.status = resp.status; err.body = text;
      // eslint-disable-next-line no-console
      console.warn('[photoService] upload endpoint returned', resp.status, 'for', uploadUrl, 'response:', text);
      throw err;
    }
    const ct = resp.headers.get('content-type') || '';
    if (ct.includes('application/json')) return resp.json();
    return { data: await resp.text() };
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[photoService] upload attempt failed for', uploadUrl, e);
    throw e;
  }
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

export { fetchLatestByType, fetchRandomByProject, uploadPhotos, deletePhotos };
