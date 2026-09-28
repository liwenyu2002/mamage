import { request } from './request';

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

export const resumeExternalImport = (jobId) => request(`/api/external-imports/jobs/${jobId}/resume`, {
  method: 'POST', timeoutMs: 15000,
});

export const getExternalImportUpdates = (jobId, afterPhotoId = 0) => request(`/api/external-imports/jobs/${jobId}/updates`, {
  data: { afterPhotoId }, timeoutMs: 15000,
});

export const getExternalImportIssues = (jobId, afterItemId = 0) => request(`/api/external-imports/jobs/${jobId}/issues`, {
  data: { afterItemId }, timeoutMs: 15000,
});

export const hideExternalImportSource = (sourceId) => request(`/api/external-imports/sources/${sourceId}/hide`, {
  method: 'POST', timeoutMs: 15000,
});
