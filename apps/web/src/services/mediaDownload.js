export function createMediaDownloader({ getDirectUrl, getFallbackUrl, fetchFile = (...args) => fetch(...args),
  getDocument = () => document, getOrigin = () => window.location.origin, probeTimeoutMs = 5000 }) {
  async function probeAttachment(url, simple = false) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), probeTimeoutMs);
    let response;
    try {
      const parsed = new URL(url, getOrigin());
      if (!['http:', 'https:'].includes(parsed.protocol)) return { ok: false };
      // A bounded Range GET validates the actual signed GET, without buffering a video or sending our bearer token.
      response = await fetchFile(parsed.href, { headers: simple ? {} : { Range: 'bytes=0-0' }, credentials: 'omit', cache: 'no-store', signal: controller.signal });
      const ok = response.ok && [200, 206].includes(response.status)
        && /^attachment\s*(?:;|$)/i.test(response.headers.get('content-disposition') || '')
        && !/(?:xml|html|json)/i.test(response.headers.get('content-type') || '');
      return { ok, retryable: !ok };
    } catch (_) { return { ok: false, retryable: !controller.signal.aborted, network: !controller.signal.aborted }; }
    finally {
      clearTimeout(timeout); controller.abort();
      try { await response?.body?.cancel(); } catch (_) { /* Already aborted. */ }
    }
  }
  return async function download({ photoId, url, filename }) {
    let directUrl;
    try { if (photoId) directUrl = await getDirectUrl(photoId); } catch (_) { /* Refresh the authorized proxy below. */ }
    let probe = directUrl ? await probeAttachment(directUrl) : { ok: false, retryable: true };
    if (!probe.ok && probe.retryable && photoId) {
      try { directUrl = await getDirectUrl(photoId, { forceRefresh: true }); } catch (_) { directUrl = null; }
      probe = directUrl ? await probeAttachment(directUrl) : { ok: false };
      // A gateway can reject Range preflights but still allow a simple signed attachment GET.
      if (!probe.ok && probe.network) probe = await probeAttachment(directUrl, true);
    }
    const direct = probe.ok;
    let target = directUrl;
    if (!direct) {
      const fresh = await getFallbackUrl({ photoId, url });
      if (!fresh) throw new Error('无法获取下载文件，请刷新后重试');
      const parsed = new URL(fresh, getOrigin());
      // API responses may contain the configured absolute host; use its signed proxy on the current origin.
      if (['http:', 'https:'].includes(parsed.protocol) && parsed.pathname.startsWith('/api/image/')) target = parsed.pathname + parsed.search;
      else if (parsed.origin === getOrigin() && ['http:', 'https:', 'blob:'].includes(parsed.protocol)) target = parsed.href;
      else throw new Error('无法建立安全下载链接，请刷新后重试');
    }
    const doc = getDocument(), anchor = doc.createElement('a');
    anchor.href = target; anchor.download = filename || 'download'; anchor.target = '_self';
    doc.body.appendChild(anchor);
    try { anchor.click(); } finally { anchor.remove(); }
    return { direct };
  };
}
