// src/services/request.js
// 浏览器端的请求封装，基于 fetch
const DEFAULT_BASE_URL = '';
import { getToken } from './authService';

const hostname = typeof window !== 'undefined' ? window.location.hostname : '';
const isLocalHost = hostname === 'localhost' || hostname === '127.0.0.1';
// 允许通过 window.__MAMAGE_API_BASE__ 在部署时覆盖；本地默认走相对路径配合 devServer 代理
const BASE_URL = typeof window !== 'undefined' && window.__MAMAGE_API_BASE__
  ? window.__MAMAGE_API_BASE__
  : (isLocalHost ? '' : DEFAULT_BASE_URL);

// Use the backend-provided BASE_URL for asset URLs when available.
// Do NOT automatically fall back to DEFAULT_BASE_URL for relative asset paths —
// when BASE_URL is empty (local dev with proxy), we should keep relative paths.
const ABSOLUTE_API_BASE = BASE_URL || '';

async function request(path, options = {}) {
  const method = (options.method || 'GET').toUpperCase();
  let url = `${BASE_URL}${path}`;
  const headers = Object.assign({ 'Content-Type': 'application/json' }, options.headers || {});

  // Development logging: if enabled (or running on localhost), record request payloads
  const LOG_REQUESTS = typeof window !== 'undefined' && (window.__MAMAGE_LOG_REQUESTS || isLocalHost);
  const pushRequestLog = async (entry) => {
    try {
      if (typeof window === 'undefined') return;
      window.__MAMAGE_POST_LOGS = window.__MAMAGE_POST_LOGS || [];
      window.__MAMAGE_POST_LOGS.unshift(entry);
      // limit to 200 entries
      if (window.__MAMAGE_POST_LOGS.length > 200) window.__MAMAGE_POST_LOGS.length = 200;
    } catch (e) {
      // ignore
    }
  };

  // 如果 localStorage 中存有 token，则自动注入 Authorization 头
  try {
    const token = typeof getToken === 'function' ? getToken() : null;
    if (token && !headers['Authorization']) {
      headers['Authorization'] = `Bearer ${token}`;
    }
  } catch (e) {
    // ignore
  }

  const fetchOpts = { method, headers, credentials: options.credentials || 'same-origin' };

  // GET 参数拼接
  if (method === 'GET' && options.data && Object.keys(options.data).length) {
    const qs = new URLSearchParams(options.data).toString();
    url += (path.includes('?') ? '&' : '?') + qs;
  } else if (options.data) {
    // 其余方法默认以 JSON body 发送
    fetchOpts.body = JSON.stringify(options.data);
  }

  // Log outgoing request body when enabled (don't log sensitive tokens)
  if (LOG_REQUESTS && method !== 'GET') {
    try {
      const isForm = (typeof FormData !== 'undefined') && (options.data instanceof FormData);
      let bodyPreview = null;
      if (isForm) {
        // collect fields (do not include full file blobs)
        const obj = {};
        for (const pair of options.data.entries()) {
          const k = pair[0];
          const v = pair[1];
          if (v && typeof v === 'object' && v instanceof File) {
            obj[k] = { filename: v.name, size: v.size, type: v.type };
          } else {
            obj[k] = String(v).slice(0, 1024);
          }
        }
        bodyPreview = obj;
      } else if (fetchOpts.body) {
        try { bodyPreview = JSON.parse(fetchOpts.body); } catch (e) { bodyPreview = String(fetchOpts.body).slice(0, 2000); }
      }
      const entry = { time: Date.now(), method, url, headers: Object.assign({}, headers), body: bodyPreview };
      // don't await push to avoid blocking
      pushRequestLog(entry);
      // also print a compact debug line
      // eslint-disable-next-line no-console
      console.debug('[request] OUT', method, url, bodyPreview);
    } catch (e) {
      // ignore logging errors
    }
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
  // If ABSOLUTE_API_BASE is provided (from backend or window.__MAMAGE_API_BASE__),
  // prefix it. Otherwise return a relative path so local dev/proxy works.
  return ABSOLUTE_API_BASE ? `${ABSOLUTE_API_BASE}${normalized}` : normalized;
}

export { BASE_URL, ABSOLUTE_API_BASE, request, resolveAssetUrl };
