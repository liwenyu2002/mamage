import { request } from './request';

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

export {
  fetchLatestByType,
  fetchRandomByProject,
  searchPhotos,
};
