import { request } from './request';

// 生产版与图库共用同一套后端和当前登录用户的 JWT。
// 不再使用双后端联调阶段的独立视频入口、媒体代理或共享开发密钥。
const VIDEO_API = '/api';
const videoRequest = (path, options) => request(`${VIDEO_API}${path}`, options);

async function requestRoughCut(payload) {
  return videoRequest('/ai/video/rough-cut', { method: 'POST', data: payload, timeoutMs: 120000 });
}

async function listVideoAssets() {
  return videoRequest('/video-projects/assets');
}

async function uploadVideoAsset(file) {
  const form = new FormData();
  form.append('file', file);
  return videoRequest('/video-projects/assets', { method: 'POST', data: form, timeoutMs: 30 * 60 * 1000 });
}

async function analyzeVideoAsset(assetId) {
  return videoRequest(`/video-projects/assets/${assetId}/analyze`, { method: 'POST', timeoutMs: 5 * 60 * 1000 });
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
    data: { projectId, limit },
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
