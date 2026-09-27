import { request } from './request';

export const scanExternalAlbum = (url) => request('/api/external-imports/scan', {
  method: 'POST', data: { url }, timeoutMs: 75000,
});

export const startExternalImport = (data) => request('/api/external-imports/jobs', {
  method: 'POST', data, timeoutMs: 20000,
});

export const listExternalImports = (projectId) => request('/api/external-imports/jobs', {
  data: { projectId }, timeoutMs: 15000,
});

export const getExternalImport = (jobId) => request(`/api/external-imports/jobs/${jobId}`, {
  timeoutMs: 15000,
});

export const cancelExternalImport = (jobId) => request(`/api/external-imports/jobs/${jobId}/cancel`, {
  method: 'POST', timeoutMs: 15000,
});
