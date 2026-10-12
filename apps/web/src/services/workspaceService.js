import { request } from './request';

export const fetchWorkspaces = () => request('/api/workspaces');
export const listWorkspaceAlbums = () => request('/api/workspaces/albums');

export const setActiveWorkspace = (unitId) => request('/api/workspaces/active', {
  method: 'POST',
  data: { unitId },
});

export const listReceivedShares = () => request('/api/internal-shares/received');
export const listSentShares = () => request('/api/internal-shares/sent');
export const getInternalShare = (id, offset = 0) => request(`/api/internal-shares/${id}`, {
  data: { offset },
});
export const createInternalShare = (data) => request('/api/internal-shares', { method: 'POST', data });
export const revokeInternalShare = (id) => request(`/api/internal-shares/${id}/revoke`, { method: 'POST' });
export const getCopyJob = (id) => request(`/api/internal-shares/copy-jobs/${id}`);
export const retryInternalCopy = (shareId) => request(`/api/internal-shares/${shareId}/copy`, { method: 'POST' });
export const listUnitMembers = (unitId) => request(`/api/workspaces/${unitId}/members`);
export const searchUnitCandidates = (unitId, q) => request(`/api/workspaces/${unitId}/candidates`, { data: { q } });
export const listRecipients = (unitId) => request(`/api/workspaces/${unitId}/recipients`);
export const setUnitMember = (unitId, userId, role) => request(`/api/workspaces/${unitId}/members/${userId}`, {
  method: 'PUT', data: { role },
});
export const removeUnitMember = (unitId, userId) => request(`/api/workspaces/${unitId}/members/${userId}`, {
  method: 'DELETE',
});
export const listFaceGrants = () => request('/api/workspaces/face-search/grants');
export const grantFaceSearch = (userId) => request(`/api/workspaces/face-search/${userId}`, {
  method: 'PUT', data: { collegeWide: true },
});
export const revokeFaceSearch = (userId) => request(`/api/workspaces/face-search/${userId}`, {
  method: 'DELETE',
});
export const listPublicShares = () => request('/api/share/mine');
export const createPublicShare = (data) => request('/api/share', { method: 'POST', data });
export const revokePublicShare = (code) => request(`/api/share/${code}/revoke`, { method: 'POST' });
export const listPendingPublicPhotos = (code) => request(`/api/share/${code}/pending`);
export const approvePublicPhotos = (code, photoIds) => request(`/api/share/${code}/approve`, {
  method: 'POST', data: { photoIds },
});
export const getAiWorkspaceStats = (days = 30) => request('/api/workspaces/stats/ai', { data: { days } });
