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

// 上传图片，参数为 FormData 或者一个包含 files 和 projectId 的对象
async function uploadPhotos(formDataOrObj) {
  // normalize to FormData
  let fd;
  if (formDataOrObj instanceof FormData) {
    fd = formDataOrObj;
  } else if (formDataOrObj && typeof formDataOrObj === 'object') {
    fd = new FormData();
    const { files, projectId } = formDataOrObj;
    if (projectId !== undefined) fd.append('projectId', String(projectId));
    if (files && files.forEach) {
      // append each file under field name 'file' (backend expects upload.single('file') or multiple 'file' entries)
      files.forEach((f) => {
        fd.append('file', f);
      });
    }
  } else {
    throw new Error('uploadPhotos: expected FormData or { files, projectId }');
  }

  // Prefer a single relative endpoint to avoid cross-origin / duplicate uploads.
  // Backend expects single-file field name 'file' and commonly exposes POST /api/photos/upload
  const uploadUrl = '/api/photos/upload';
  try {
    // eslint-disable-next-line no-console
    console.debug('[photoService] uploading to', uploadUrl);
    // send FormData as-is; do not set Content-Type so browser can add multipart boundary
    const resp = await fetch(uploadUrl, { method: 'POST', body: fd, credentials: 'same-origin' });
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
  const fallbackHost = 'http://localhost:3000';
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
  candidates.push({ url: `${fallbackHost}/api/photos/delete`, opts: { method: 'POST', data: { photoIds } } });
  candidates.push({ url: `${fallbackHost}/api/photos`, opts: { method: 'DELETE', data: { photoIds } } });
  candidates.push({ url: `${fallbackHost}/api/photos`, opts: { method: 'POST', data: { photoIds } } });

  let lastErr = null;
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
          headers: { 'Content-Type': 'application/json' },
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
        return await request(c.url.replace(/^\/+/, '/'), c.opts);
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
