import { request } from './request';

// 生产版与图库共用同一套后端和当前登录用户的 JWT。
// 不再使用双后端联调阶段的独立视频入口、媒体代理或共享开发密钥。
const VIDEO_API = '/api';
const videoRequest = (path, options) => request(`${VIDEO_API}${path}`, options);
const MAX_EDITOR_VIDEO_BYTES = 3 * 1024 * 1024 * 1024;

async function requestRoughCut(payload) {
  return videoRequest('/ai/video/rough-cut', { method: 'POST', data: payload, timeoutMs: 120000 });
}

async function listVideoAssets() {
  return videoRequest('/video-projects/assets');
}

function emitProgress(callback, event) {
  if (typeof callback === 'function') callback(event);
}

function uploadSignedPost(upload, file, onProgress) {
  if (!upload || !upload.uploadUrl || !upload.formFields) throw new Error('DIRECT_VIDEO_UPLOAD_INVALID');
  const form = new FormData();
  Object.entries(upload.formFields).forEach(([key, value]) => form.append(key, String(value)));
  form.append('file', file, file.name || 'video.mp4');
  if (typeof XMLHttpRequest === 'undefined') {
    return fetch(upload.uploadUrl, { method: 'POST', body: form, credentials: 'omit' }).then(async (response) => {
      if (!response.ok) {
        const error = new Error(`direct video upload failed ${response.status}`);
        error.status = response.status;
        error.body = await response.text();
        throw error;
      }
      emitProgress(onProgress, { loaded: file.size || 0, total: file.size || 0 });
    });
  }
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', upload.uploadUrl, true);
    xhr.withCredentials = false;
    xhr.upload.onprogress = (event) => emitProgress(onProgress, {
      loaded: event.loaded || 0,
      total: event.lengthComputable ? event.total : (file.size || 0),
    });
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve();
      const error = new Error(`direct video upload failed ${xhr.status}`);
      error.status = xhr.status;
      error.body = xhr.responseText || '';
      reject(error);
    };
    xhr.onerror = () => {
      const error = new Error('direct video upload network error');
      error.status = xhr.status || 0;
      error.body = xhr.responseText || '';
      reject(error);
    };
    xhr.send(form);
  });
}

async function abortDirectVideoAsset(sessionId) {
  if (!sessionId) return;
  try {
    await videoRequest('/video-projects/assets/direct/abort', { method: 'POST', data: { sessionId } });
  } catch (_) {
    // The server cleans up incomplete short-lived uploads as a second line of defense.
  }
}

function shouldFallbackToServer(error) {
  return !error || ![401, 403, 413, 415].includes(Number(error.status));
}

async function uploadVideoAsset(file, metadata = {}, { onProgress } = {}) {
  if (!file) throw new Error('请选择视频文件');
  if (Number(file.size) > MAX_EDITOR_VIDEO_BYTES) {
    const error = new Error('视频不能超过 3GB');
    error.status = 413;
    throw error;
  }
  const payload = {
    fileName: file.name || 'video.mp4',
    fileSize: file.size || 0,
    mimeType: file.type || '',
    duration: metadata.duration || 0,
    width: metadata.width || 0,
    height: metadata.height || 0,
    hasAudio: metadata.hasAudio === true,
  };
  let sessionId = null;
  try {
    emitProgress(onProgress, { phase: 'preparing', loaded: 0, total: file.size || 0 });
    const init = await videoRequest('/video-projects/assets/direct/init', { method: 'POST', data: payload });
    sessionId = init && init.sessionId;
    await uploadSignedPost(init && init.upload, file, (event) => emitProgress(onProgress, {
      phase: 'uploading', loaded: event.loaded, total: event.total || file.size || 0,
    }));
    emitProgress(onProgress, { phase: 'completing', loaded: file.size || 0, total: file.size || 0 });
    const result = await videoRequest('/video-projects/assets/direct/complete', { method: 'POST', data: { sessionId } });
    emitProgress(onProgress, { phase: 'done', loaded: file.size || 0, total: file.size || 0 });
    return result;
  } catch (error) {
    await abortDirectVideoAsset(sessionId);
    if (!shouldFallbackToServer(error)) throw error;
  }

  const form = new FormData();
  form.append('file', file);
  emitProgress(onProgress, { phase: 'fallback', loaded: 0, total: file.size || 0 });
  const response = await videoRequest('/video-projects/assets', { method: 'POST', data: form, timeoutMs: 30 * 60 * 1000 });
  emitProgress(onProgress, { phase: 'done', loaded: file.size || 0, total: file.size || 0 });
  return response;
}

async function analyzeVideoAsset(assetId) {
  // Full-duration temporal understanding samples and understands the whole
  // timeline. A five-minute browser deadline is too short for longer sources.
  return videoRequest(`/video-projects/assets/${assetId}/analyze`, { method: 'POST', timeoutMs: 30 * 60 * 1000 });
}

async function listVideoProjects() {
  return videoRequest('/video-projects');
}

async function createVideoProject(payload) {
  return videoRequest('/video-projects', { method: 'POST', data: payload });
}

async function getVideoProject(id) {
  return videoRequest(`/video-projects/${id}`);
}

async function updateVideoProject(id, payload) {
  return videoRequest(`/video-projects/${id}`, { method: 'PUT', data: payload });
}

async function deleteVideoProject(id) {
  return videoRequest(`/video-projects/${id}`, { method: 'DELETE' });
}

async function startVideoRender(projectId, options = {}) {
  return videoRequest(`/video-projects/${projectId}/render`, { method: 'POST', data: options });
}

async function getVideoRender(jobId) {
  return videoRequest(`/video-projects/renders/${jobId}`);
}

async function cancelVideoRender(jobId) {
  return videoRequest(`/video-projects/renders/${jobId}/cancel`, { method: 'POST' });
}

async function listProductionProjects({ page = 1, pageSize = 100, keyword = '' } = {}) {
  const response = await request('/api/projects/list', {
    method: 'GET',
    data: { page, pageSize, keyword },
  });
  return {
    list: Array.isArray(response && response.list) ? response.list : [],
    total: Number(response && response.total) || 0,
    hasMore: Boolean(response && response.hasMore),
    page: Number(response && response.page) || page,
  };
}

async function listProductionProjectMedia(projectId, limit = 500) {
  const response = await request('/api/photos', {
    method: 'GET',
    data: { projectId, limit, includeVideoAnalysis: true },
    timeoutMs: 60000,
  });
  if (Array.isArray(response)) return response;
  if (Array.isArray(response && response.photos)) return response.photos;
  if (Array.isArray(response && response.list)) return response.list;
  if (Array.isArray(response && response.items)) return response.items;
  return [];
}

export {
  requestRoughCut,
  listVideoAssets,
  uploadVideoAsset,
  analyzeVideoAsset,
  listVideoProjects,
  createVideoProject,
  getVideoProject,
  updateVideoProject,
  deleteVideoProject,
  startVideoRender,
  getVideoRender,
  cancelVideoRender,
  listProductionProjects,
  listProductionProjectMedia,
};
