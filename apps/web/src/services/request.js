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

  // Request body logging is opt-in; uploads and batch edits should stay quiet by default.
  const LOG_REQUESTS = typeof window !== 'undefined' && Boolean(window.__MAMAGE_LOG_REQUESTS);
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
  let timeoutId = null;
  if (options.timeoutMs && typeof AbortController !== 'undefined') {
    const controller = new AbortController();
    fetchOpts.signal = controller.signal;
    timeoutId = setTimeout(() => controller.abort(), Number(options.timeoutMs));
  } else if (options.signal) {
    fetchOpts.signal = options.signal;
  }

  const sanitizeHeadersForLog = (input) => {
    const out = Object.assign({}, input || {});
    Object.keys(out).forEach((key) => {
      if (String(key).toLowerCase() === 'authorization') out[key] = '[redacted]';
    });
    return out;
  };

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
      const entry = { time: Date.now(), method, url, headers: sanitizeHeadersForLog(headers), body: bodyPreview };
      // don't await push to avoid blocking
      pushRequestLog(entry);
      // also print a compact debug line
      // eslint-disable-next-line no-console
      console.debug('[request] OUT', method, url, bodyPreview);
    } catch (e) {
      // ignore logging errors
    }
  }

  let res;
  try {
    res = await fetch(url, fetchOpts);
  } catch (err) {
    if (err && err.name === 'AbortError') {
      const timeoutErr = new Error('请求超时，请稍后重试');
      timeoutErr.status = 408;
      timeoutErr.cause = err;
      throw timeoutErr;
    }
    throw err;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
  if (!res.ok) {
    const text = await res.text();
    const err = new Error(`Request failed ${res.status} ${res.statusText}`);
    err.status = res.status;
    err.body = text;
    throw err;
  }

  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) return rewriteMediaUrlsDeep(await res.json());
  return res.text();
}

// ---------------------------------------------------------------------------
// 内网直连模式：API 返回的媒体地址是绝对公网域名(UPLOAD_BASE_URL)，导致校内从
// http://10.100.83.67:3000 打开时，图片/视频/下载仍绕 Cloudflare 隧道(实测 1.2MB/s vs 内网 9MB/s)。
// 这里在 JSON 返回的唯一收口做深改写：页面 host 与媒体地址 host 不同时，把
// "https?://<别的host>/api/image/..." 改成同源相对路径 → 浏览器自动走当前(内网)入口。
// 从公网域名打开时 host 相同 → 原样不动，公众号导出等依赖绝对地址的场景不受影响。
// 签名(?e=&s=)按 key 路径计算、与 host 无关，改写后仍有效。
// ---------------------------------------------------------------------------
const PAGE_HOST = (typeof window !== 'undefined' && window.location) ? window.location.host : '';
const ABS_MEDIA_RE = /^https?:\/\/([^/]+)(\/api\/image\/.+)$/i;

function rewriteMediaUrlsDeep(value) {
  if (!PAGE_HOST) return value;
  if (typeof value === 'string') {
    const m = value.match(ABS_MEDIA_RE);
    return (m && m[1].toLowerCase() !== PAGE_HOST.toLowerCase()) ? m[2] : value;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) value[i] = rewriteMediaUrlsDeep(value[i]);
    return value;
  }
  if (value && typeof value === 'object') {
    for (const k of Object.keys(value)) value[k] = rewriteMediaUrlsDeep(value[k]);
    return value;
  }
  return value;
}

function resolveAssetUrl(src) {
  if (!src) return src;
  if (/^https?:\/\//i.test(src)) return src;
  const normalized = src.startsWith('/') ? src : `/${src}`;
  // Prefer an explicitly configured COS base for public assets if provided.
  // Allows deployment to serve static files from cloud storage rather than the API host.
  const cosBase = (typeof window !== 'undefined' && window.__MAMAGE_COS_BASE__) ? window.__MAMAGE_COS_BASE__ : '';
  if (cosBase) return `${cosBase.replace(/\/+$/, '')}${normalized}`;

  // If ABSOLUTE_API_BASE is provided (from backend or window.__MAMAGE_API_BASE__), prefix it.
  // Otherwise return a relative path so local dev/proxy works.
  return ABSOLUTE_API_BASE ? `${ABSOLUTE_API_BASE}${normalized}` : normalized;
}

export { BASE_URL, ABSOLUTE_API_BASE, request, resolveAssetUrl };
