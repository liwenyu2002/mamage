import { request, rewriteMediaUrlsDeep } from './request';
import { readPhotoSearchStream } from './photoSearchStream';
import { watchVisualSearch } from './visualSearchPolling';

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

function searchPhotos({ q = '', projectId, folderId, headers, page = 1, pageSize = 20, sort = 'relevance', smart = true, demo = false, related = false, signal, onProgress } = {}) {
  const data = { q, page, pageSize, sort };
  if (projectId !== undefined && projectId !== null && String(projectId).trim() !== '') {
    data.projectId = projectId;
  }
  if (folderId !== undefined && folderId !== null) data.folderId = folderId;
  if (demo) data.demo = 1;
  if (smart && !demo) data.smart = 1;
  if (related) data.related = 1;
  const streaming = typeof onProgress === 'function' && typeof ReadableStream !== 'undefined' && typeof TextDecoder !== 'undefined';
  if (streaming) data.stream = 1;
  const execute = progress => request('/api/photos/search', {
    method: 'GET',
    data, signal, headers,
    ...(streaming ? { readResponse: response => readPhotoSearchStream(response, { signal, onProgress: progress, rewrite: rewriteMediaUrlsDeep }) } : {}),
  });
  return watchVisualSearch(execute, { signal, onProgress, page });
}

export {
  fetchLatestByType,
  fetchRandomByProject,
  searchPhotos,
};
