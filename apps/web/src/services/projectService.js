// src/services/projectService.js
import { request, BASE_URL as REQ_BASE } from './request';

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
  if (!id) throw new Error('missing project id');
  // determine API base: prefer window.__MAMAGE_API_BASE__, then REQ_BASE, then use relative paths for proxy
  const apiBase = (typeof window !== 'undefined' && window.__MAMAGE_API_BASE__) ? window.__MAMAGE_API_BASE__ : (REQ_BASE || '');
  const url = `${String(apiBase).replace(/\/+$/,'')}/api/projects/${id}/update`;
  const token = (typeof window !== 'undefined') ? (localStorage.getItem('mamage_jwt_token') || '') : '';
  const headers = Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: `Bearer ${token}` } : {});
  const resp = await fetch(url, { method: 'POST', headers, body: JSON.stringify(data) });
  if (!resp.ok) {
    const text = await resp.text();
    const err = new Error(`updateProject failed ${resp.status}`);
    err.status = resp.status; err.body = text;
    throw err;
  }
  const ct = resp.headers.get('content-type') || '';
  if (ct.includes('application/json')) return resp.json();
  return resp.text();
}

async function createProject(data) {
  const payload = {
    projectName: data?.projectName || data?.name || data?.title || '',
  };
  if (data?.description || data?.desc) payload.description = data.description || data.desc;
  if (data?.eventDate) payload.eventDate = data.eventDate;
  // forward other meta if provided
  if (data?.meta) payload.meta = data.meta;

  // send to backend directly to avoid dev-server 404 when proxy is not configured
  const apiBase = (typeof window !== 'undefined' && window.__MAMAGE_API_BASE__) ? window.__MAMAGE_API_BASE__ : (REQ_BASE || '');
  const url = `${String(apiBase).replace(/\/+$/,'')}/api/projects`;
  const token = (typeof window !== 'undefined') ? (localStorage.getItem('mamage_jwt_token') || '') : '';
  const headers = Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: `Bearer ${token}` } : {});
  const resp = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload) });
  if (!resp.ok) {
    const text = await resp.text();
    const err = new Error(`createProject failed ${resp.status}`);
    err.status = resp.status; err.body = text;
    throw err;
  }
  const ct = resp.headers.get('content-type') || '';
  if (ct.includes('application/json')) return resp.json();
  return resp.text();
}

async function deleteProject(id) {
  if (!id) throw new Error('missing project id');
  const token = (typeof window !== 'undefined') ? (localStorage.getItem('mamage_jwt_token') || '') : '';
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
    const apiBase = (typeof window !== 'undefined' && window.__MAMAGE_API_BASE__) ? window.__MAMAGE_API_BASE__ : (REQ_BASE || '');
  const url = `${String(apiBase).replace(/\/+$/,'')}/api/projects/${id}`;
  const resp = await fetch(url, { method: 'DELETE', headers });
  if (!resp.ok) {
    const text = await resp.text();
    const err = new Error(`deleteProject failed ${resp.status}`);
    err.status = resp.status; err.body = text;
    throw err;
  }
  const ct = resp.headers.get('content-type') || '';
  if (ct.includes('application/json')) return resp.json();
  return resp.text();
}

export { fetchLatestProjects, fetchProjectList, getProjectById, updateProject, createProject, deleteProject };
