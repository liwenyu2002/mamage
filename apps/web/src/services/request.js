// src/services/request.js
// 浏览器端的请求封装，基于 fetch
const DEFAULT_BASE_URL = 'http://localhost:3000';

const hostname = typeof window !== 'undefined' ? window.location.hostname : '';
const isLocalHost = hostname === 'localhost' || hostname === '127.0.0.1';
// 允许通过 window.__MAMAGE_API_BASE__ 在部署时覆盖；本地默认走相对路径配合 devServer 代理
const BASE_URL = typeof window !== 'undefined' && window.__MAMAGE_API_BASE__
  ? window.__MAMAGE_API_BASE__
  : (isLocalHost ? '' : DEFAULT_BASE_URL);

const ABSOLUTE_API_BASE = BASE_URL || DEFAULT_BASE_URL;

async function request(path, options = {}) {
  const method = (options.method || 'GET').toUpperCase();
  let url = `${BASE_URL}${path}`;
  const headers = Object.assign({ 'Content-Type': 'application/json' }, options.headers || {});

  const fetchOpts = { method, headers, credentials: options.credentials || 'same-origin' };

  // GET 参数拼接
  if (method === 'GET' && options.data && Object.keys(options.data).length) {
    const qs = new URLSearchParams(options.data).toString();
    url += (path.includes('?') ? '&' : '?') + qs;
  } else if (options.data) {
    // 其余方法默认以 JSON body 发送
    fetchOpts.body = JSON.stringify(options.data);
  }

  const res = await fetch(url, fetchOpts);
  if (!res.ok) {
    const text = await res.text();
    const err = new Error(`Request failed ${res.status} ${res.statusText}`);
    err.status = res.status;
    err.body = text;
    throw err;
  }

  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) return res.json();
  return res.text();
}

function resolveAssetUrl(src) {
  if (!src) return src;
  if (/^https?:\/\//i.test(src)) return src;
  const normalized = src.startsWith('/') ? src : `/${src}`;
  return `${ABSOLUTE_API_BASE}${normalized}`;
}

export { BASE_URL, request, resolveAssetUrl };
