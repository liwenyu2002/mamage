// src/services/projectService.js
import { request } from './request';

async function fetchLatestProjects(limit = 4) {
  return request('/api/projects', {
    method: 'GET',
    data: { limit }
  });
}

async function fetchProjectList({ page = 1, pageSize = 6, keyword = '' } = {}) {
  const res = await request('/api/projects/list', {
    method: 'GET',
    data: { page, pageSize, keyword }
  });

  const list = Array.isArray(res.list) ? res.list : [];

  return {
    list,
    hasMore: !!res.hasMore,
    total: res.total || 0,
    page: res.page || page,
    pageSize: res.pageSize || pageSize
  };
}

async function getProjectById(id) {
  return request(`/api/projects/${id}`, { method: 'GET' });
}

async function updateProject(id, data) {
  return request(`/api/projects/${id}/update`, {
    method: 'POST',
    data
  });
}

async function createProject(data) {
  const payload = {
    projectName: data?.projectName || data?.name || data?.title || '',
  };
  if (data?.description || data?.desc) payload.description = data.description || data.desc;
  if (data?.eventDate) payload.eventDate = data.eventDate;
  // forward other meta if provided
  if (data?.meta) payload.meta = data.meta;

  return request('/api/projects', {
    method: 'POST',
    data: payload,
  });
}

export { fetchLatestProjects, fetchProjectList, getProjectById, updateProject, createProject };
