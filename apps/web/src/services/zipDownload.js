// src/services/zipDownload.js
// 打包下载（中转站 / 分享页共用）：流式拉取 + 进度回调 + 可直写磁盘。
// 服务端是边拉边发的流式 zip，没有 Content-Length → total 通常为 0，UI 用"已下载 X MB"+不定长条。

export function formatBytes(n) {
  const v = Number(n) || 0;
  if (v < 1024) return `${v} B`;
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(0)} KB`;
  return `${(v / 1024 / 1024).toFixed(1)} MB`;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || 'files.zip';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function filenameFromResponse(resp, fallback) {
  try {
    const cd = resp.headers.get('content-disposition') || '';
    const mStar = cd.match(/filename\*=(?:UTF-8'')?([^;\n]+)/i);
    if (mStar && mStar[1]) return decodeURIComponent(mStar[1].trim().replace(/^"|"$/g, ''));
    const m = cd.match(/filename="?([^";\n]+)"?/i);
    if (m && m[1]) return m[1].trim();
  } catch (e) { /* ignore */ }
  return fallback;
}

// ⚠️ 必须在用户手势内调用（不能放在 await fetch 之后——那时 transient activation 已过期，
// showSaveFilePicker 会抛 SecurityError，表现为"点了没反应"）。
// 返回 handle | null(不支持→回退 Blob) | 'abort'(用户取消)
export async function pickZipSaveHandle(suggestedName) {
  if (typeof window === 'undefined' || !window.showSaveFilePicker) return null;
  try {
    return await window.showSaveFilePicker({
      suggestedName: suggestedName || 'photos.zip',
      types: [{ description: 'ZIP archive', accept: { 'application/zip': ['.zip'] } }],
    });
  } catch (e) {
    if (e && e.name === 'AbortError') return 'abort';
    return null;
  }
}

/**
 * 拉取 zip 并落地。
 * @param {object} o
 * @param {number[]} [o.photoIds] 指定照片；分享场景可省略=整个分享
 * @param {string}   [o.shareCode] 分享码（公开分享页用它鉴权，无需登录）
 * @param {string}   [o.zipName]
 * @param {object}   [o.fileHandle] pickZipSaveHandle 的返回值
 * @param {(loaded:number,total:number)=>void} [o.onProgress]
 */
export async function fetchZipToTarget({ photoIds, shareCode, zipName, fileHandle, onProgress }) {
  const name = zipName || `photos_${Date.now()}`;
  const headers = { 'Content-Type': 'application/json' };
  const body = { zipName: name };
  if (Array.isArray(photoIds) && photoIds.length) body.photoIds = photoIds;
  if (shareCode) {
    body.shareCode = shareCode; // 公开分享：服务端用分享码鉴权并把范围钉在该分享内
  } else {
    const token = (typeof window !== 'undefined') ? (localStorage.getItem('mamage_jwt_token') || '') : '';
    if (!token) throw new Error('NOT_LOGGED_IN');
    headers.Authorization = `Bearer ${token}`;
  }

  const resp = await fetch('/api/photos/zip', {
    method: 'POST', headers, credentials: 'same-origin', body: JSON.stringify(body),
  });
  if (!resp.ok) {
    let msg = `server responded ${resp.status}`;
    try {
      const t = await resp.text();
      if (t) { try { msg = JSON.parse(t).error || t; } catch (_) { msg = t; } }
    } catch (_) { /* ignore */ }
    throw new Error(msg);
  }

  const filename = filenameFromResponse(resp, `${name}.zip`);
  // 流式 zip 没有 Content-Length；服务端打包前用内网 HEAD 求和发来的估算总量（X-Zip-Total-Bytes）
  const total = Number(resp.headers.get('content-length') || 0)
    || Number(resp.headers.get('x-zip-total-bytes') || 0)
    || 0;
  const reader = resp.body && resp.body.getReader ? resp.body.getReader() : null;
  if (!reader) { downloadBlob(await resp.blob(), filename); return filename; }

  const writable = fileHandle ? await fileHandle.createWritable() : null;
  const chunks = [];
  let loaded = 0;
  try {
    for (;;) {
      // eslint-disable-next-line no-await-in-loop
      const { done, value } = await reader.read();
      if (done) break;
      loaded += value.byteLength;
      // eslint-disable-next-line no-await-in-loop
      if (writable) await writable.write(value); else chunks.push(value);
      if (onProgress) onProgress(loaded, total);
    }
    if (writable) { await writable.close(); return filename; }
    downloadBlob(new Blob(chunks, { type: 'application/zip' }), filename);
    return filename;
  } catch (e) {
    if (writable) { try { await writable.abort(); } catch (_) { /* ignore */ } }
    throw e;
  }
}
