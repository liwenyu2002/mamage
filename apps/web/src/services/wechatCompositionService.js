// src/services/wechatCompositionService.js
// 排版器「存档」接口封装：手动触发、可存多份、落在服务端数据库、跨设备可见的排版快照。
// 与 WechatComposer.jsx 里的本地草稿（localStorage DRAFT_KEY）是两套独立机制——
// 草稿自动、单份、只在本机；存档手动、多份、跨设备，互不覆盖也互不依赖。
// 服务端已按 req.user.id 隔离（用户只能看/改/删自己的存档），本文件只做纯转发，不做本地缓存。
import { request } from './request';

const BASE = '/api/wechat-compositions';

// 存档列表：不含 doc 等大字段，按 updated_at 倒序
function listCompositions() {
  return request(BASE, { method: 'GET' });
}

// 新建一条存档；payload: { name, title, digest, doc, blockConfig, themeKey }
function saveComposition(payload) {
  return request(BASE, { method: 'POST', data: payload });
}

// 存档详情：doc/blockConfig 已由服务端解析为 JSON 值，载入画布直接用
function getComposition(id) {
  return request(`${BASE}/${id}`, { method: 'GET' });
}

// 覆盖已有存档；patch 字段全部可选，只更新传入的字段
function updateComposition(id, patch) {
  return request(`${BASE}/${id}`, { method: 'PUT', data: patch });
}

function deleteComposition(id) {
  return request(`${BASE}/${id}`, { method: 'DELETE' });
}

// ---- 错误辅助 ----
// request() 失败时抛出的 Error 只带 status + 原始文本 body，这里解析成 JSON 供上层判定具体错误码。
function parseErrorBody(err) {
  if (!err || !err.body || typeof err.body !== 'string') return null;
  try {
    return JSON.parse(err.body);
  } catch (e) {
    return null;
  }
}

// 409 ARCHIVE_LIMIT：存档数已达单用户上限
function isArchiveLimitError(err) {
  const payload = parseErrorBody(err);
  return !!(err && err.status === 409 && payload && payload.error === 'ARCHIVE_LIMIT');
}

// 从 409 响应体里取具体上限数值；取不到时由调用方自行兜底文案
function getArchiveLimitFromError(err) {
  const payload = parseErrorBody(err);
  return payload && typeof payload.limit === 'number' ? payload.limit : null;
}

export {
  listCompositions,
  saveComposition,
  getComposition,
  updateComposition,
  deleteComposition,
  isArchiveLimitError,
  getArchiveLimitFromError,
};
