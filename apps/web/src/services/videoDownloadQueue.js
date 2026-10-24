export function canSaveVideoDirectory(scope = globalThis) {
  return scope.isSecureContext === true && typeof scope.showDirectoryPicker === 'function';
}

export function createVideoDownloadQueue({ pickDirectory, supportsDirectory, manifest, source, nativeZip,
  fetchFile = (...args) => fetch(...args), concurrency = 2, idleMs = 60000, now = () => Date.now() }) {
  let job = null, snapshot = null, controller = null, directory = null, running = false, lastEmit = 0, timer;
  const listeners = new Set();
  const emit = (force = false) => {
    if (!force && now() - lastEmit < 150) {
      if (!timer) timer = setTimeout(() => { timer = null; emit(true); }, 150);
      return;
    }
    clearTimeout(timer); timer = null; lastEmit = now();
    snapshot = job ? { ...job, items: job.items.map(item => ({ ...item })) } : null;
    listeners.forEach(listener => listener());
  };
  const cancelled = () => controller?.signal.aborted;
  const abortError = () => Object.assign(new Error('DOWNLOAD_CANCELLED'), { name: 'AbortError' });
  async function timed(operation, local) {
    let timeout;
    try {
      return await Promise.race([operation, new Promise((_, reject) => {
        timeout = setTimeout(() => { local.abort(); reject(new Error('DOWNLOAD_IDLE_TIMEOUT')); }, idleMs);
      })]);
    } finally { clearTimeout(timeout); }
  }
  async function download(item) {
    for (let attempt = 0; attempt < 2; attempt++) {
      let writable, reader, created = false;
      const local = new AbortController();
      const cancel = () => local.abort();
      controller.signal.addEventListener('abort', cancel, { once: true });
      item.status = 'downloading'; item.loaded = 0; item.error = null; emit(true);
      try {
        if (cancelled()) throw abortError();
        const info = await timed(source(item.id, local.signal), local);
        if (cancelled()) throw abortError();
        let response;
        const preferred = info.url;
        try { response = await timed(fetchFile(preferred, { signal: local.signal, credentials: 'omit' }), local); }
        catch (error) {
          if (cancelled() || local.signal.aborted || info.url === info.fallbackUrl) throw error;
          response = await timed(fetchFile(info.fallbackUrl, { signal: local.signal, credentials: 'same-origin' }), local);
        }
        if (!response.ok && preferred !== info.fallbackUrl) {
          try { await response.body?.cancel(); } catch (_) { /* No body. */ }
          response = await timed(fetchFile(info.fallbackUrl, { signal: local.signal, credentials: 'same-origin' }), local);
        }
        if (!response.ok) { const error = new Error(`HTTP_${response.status}`); error.status = response.status; throw error; }
        if (!response.body?.getReader) throw new Error('STREAMING_UNAVAILABLE');
        reader = response.body.getReader();
        const length = response.headers.get('content-length');
        item.total = length !== null && Number(length) > 0 ? Number(length) : null;
        const handle = await directory.getFileHandle(item.name, { create: true }); created = true;
        writable = await handle.createWritable();
        for (;;) {
          if (cancelled()) throw abortError();
          const { value, done } = await timed(reader.read(), local);
          if (done) break;
          await writable.write(value);
          item.loaded += value.byteLength; emit();
        }
        if (item.total !== null && item.loaded !== item.total) throw new Error('VIDEO_SIZE_MISMATCH');
        if (cancelled()) throw abortError();
        await writable.close(); writable = null;
        item.status = 'saved'; emit(true); return;
      } catch (error) {
        local.abort();
        if (reader) { try { await reader.cancel(); } catch (_) { /* Already closed. */ } }
        if (writable) { try { await writable.abort(); } catch (_) { /* Already closed. */ } }
        if (created) { try { await directory.removeEntry(item.name); } catch (_) { /* Only this task's own new file. */ } }
        item.loaded = 0;
        if (cancelled()) { item.status = 'cancelled'; emit(true); return; }
        if (attempt === 1 || [401, 403, 404, 422].includes(error.status)
          || ['NotAllowedError', 'QuotaExceededError', 'NotFoundError'].includes(error.name)) {
          item.status = 'failed'; item.error = error.name === 'QuotaExceededError' ? '磁盘空间不足' : '未保存成功'; emit(true); return;
        }
      } finally {
        controller.signal.removeEventListener('abort', cancel);
        try { reader?.releaseLock(); } catch (_) { /* Already released. */ }
      }
    }
  }
  async function drain() {
    const pending = job.items.filter(item => item.status === 'waiting');
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(concurrency, pending.length) }, async () => {
      while (!cancelled() && next < pending.length) await download(pending[next++]);
    }));
    if (cancelled()) job.items.forEach(item => { if (item.status === 'waiting') item.status = 'cancelled'; });
    job.status = cancelled() ? 'cancelled' : job.items.some(item => item.status === 'failed') ? 'partial' : 'done';
    running = false; emit(true);
  }
  async function zip() {
    job.mode = 'zip'; job.status = 'preparing'; emit(true);
    const data = await manifest(job.ids, controller.signal, job.mediaKind);
    if (cancelled()) throw abortError();
    applySummary(data); emit(true);
    await nativeZip(job.ids, controller.signal, { zipName: job.zipName, videoOnly: job.mediaKind === 'video' });
    job.status = 'handed-off';
  }
  function applySummary(data) {
    job.totalBytes = Number.isFinite(data.totalBytes) ? data.totalBytes : null;
    job.unknownSizeCount = Number.isInteger(data.unknownSizeCount) ? data.unknownSizeCount : job.ids.length;
    job.mediaCounts = data.mediaCounts || { videos: job.ids.length, photos: 0 };
    job.zipName = data.zipName;
    job.items = data.items.map(item => ({ id: item.id, name: item.name, total: item.size ?? null, loaded: 0, status: 'waiting' }));
  }
  return {
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    getSnapshot() { return snapshot; },
    isRunning() { return running; },
    async start(ids, { forceZip = false, mediaKind = 'video' } = {}) {
      if (running) throw new Error('DOWNLOAD_ALREADY_RUNNING');
      running = true; directory = null; controller = new AbortController();
      job = { ids: [...ids], mediaKind, status: 'picking', mode: 'folder', items: [], error: null, startedAt: now() }; emit(true);
      try {
        if (forceZip || mediaKind !== 'video' || !supportsDirectory()) { await zip(); return; }
        // Invoke the picker before awaiting any network call, while user activation is still present.
        const parent = await pickDirectory();
        if (cancelled()) throw abortError();
        job.status = 'preparing'; emit(true);
        const data = await manifest(ids, controller.signal, job.mediaKind);
        if (cancelled()) throw abortError();
        applySummary(data);
        const name = `${(data.zipName || 'MaMage-videos.zip').replace(/\.zip$/i, '')}-${now()}-${Math.random().toString(36).slice(2, 8)}`;
        directory = await parent.getDirectoryHandle(name, { create: true });
        job.directoryName = name;
        job.status = 'running'; emit(true); await drain();
      } catch (error) {
        job.status = cancelled() || error.name === 'AbortError' ? 'cancelled' : 'failed';
        job.error = job.status === 'failed' ? (error.message === 'VIDEO_DOWNLOAD_BUSY' ? '下载服务繁忙，请稍后重试' : '暂时无法开始下载，请重试') : null;
      } finally { running = false; emit(true); }
    },
    async retry() {
      if (running || !directory) return;
      running = true; controller = new AbortController();
      job.items.forEach(item => { if (['failed', 'cancelled'].includes(item.status)) item.status = 'waiting'; });
      job.status = 'running'; emit(true); await drain();
    },
    cancel() { if (running) { controller.abort(); job.status = 'cancelling'; emit(true); } },
    dismiss() { if (!running) { job = null; emit(true); } },
  };
}
