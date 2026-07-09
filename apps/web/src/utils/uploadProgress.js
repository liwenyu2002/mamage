export function getUploadFileKey(file) {
  if (!file) return '';
  return [
    file.name || 'photo',
    Number(file.size) || 0,
    Number(file.lastModified) || 0,
  ].join('::');
}

function clampPercent(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function toPositiveNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function formatUploadBytes(value) {
  const bytes = Math.max(0, Number(value) || 0);
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${Math.round(bytes)} B`;
}

export function formatUploadRemainingTime(seconds) {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value < 0) return '估算中';
  const totalSeconds = Math.max(0, Math.ceil(value));
  if (totalSeconds <= 0) return '即将完成';
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  if (hours > 0) return `${hours}小时${String(minutes).padStart(2, '0')}分`;
  if (minutes > 0) return `${minutes}分${String(secs).padStart(2, '0')}秒`;
  return `${secs}秒`;
}

export function getUploadPhaseLabel(phase, status) {
  if (status === 'rejected' || phase === 'failed') return '失败';
  if (status === 'fulfilled' || phase === 'done') return '完成';
  if (phase === 'preparing') return '准备中';
  if (phase === 'thumbnail') return '生成缩略图';
  if (phase === 'uploading') return '上传中';
  if (phase === 'completing') return '写入记录';
  if (phase === 'fallback') return '切换上传通道';
  return '等待';
}

function estimateRemainingSeconds({ loaded, total, startedAt, phase, status, now = Date.now() }) {
  if (status === 'fulfilled' || phase === 'done') return 0;
  if (status === 'rejected' || phase === 'failed') return null;
  const loadedBytes = Math.max(0, Number(loaded) || 0);
  const totalBytes = Math.max(0, Number(total) || 0);
  const started = Number(startedAt) || 0;
  if (!totalBytes || loadedBytes <= 0 || loadedBytes >= totalBytes || !started) return null;
  const elapsedSeconds = Math.max(0.5, (now - started) / 1000);
  const speed = loadedBytes / elapsedSeconds;
  if (!Number.isFinite(speed) || speed <= 0) return null;
  return Math.max(0, (totalBytes - loadedBytes) / speed);
}

function aggregateProgress(progress) {
  const now = Date.now();
  const order = progress.order || [];
  const items = progress.items || {};
  const list = order.map((key) => items[key]).filter(Boolean);
  const totalBytes = list.reduce((sum, item) => sum + toPositiveNumber(item.total, item.size || 0), 0);
  const loadedBytes = list.reduce((sum, item) => {
    const total = toPositiveNumber(item.total, item.size || 0);
    const loaded = Number(item.loaded) || 0;
    return sum + Math.max(0, Math.min(total || loaded, loaded));
  }, 0);
  const completedFiles = list.filter((item) => item.status === 'fulfilled' || item.phase === 'done').length;
  const failedFiles = list.filter((item) => item.status === 'rejected' || item.phase === 'failed').length;
  const activeItem = list.find((item) => !['fulfilled', 'rejected'].includes(item.status) && !['done', 'failed'].includes(item.phase))
    || list.find((item) => item.status === 'rejected' || item.phase === 'failed')
    || null;
  const percent = totalBytes > 0
    ? clampPercent((loadedBytes / totalBytes) * 100)
    : clampPercent(((completedFiles + failedFiles) / Math.max(1, list.length)) * 100);

  return {
    ...progress,
    totalFiles: list.length,
    completedFiles,
    failedFiles,
    loadedBytes,
    totalBytes,
    percent,
    activeFileName: activeItem ? activeItem.name : '',
    activePhase: activeItem ? activeItem.phase : '',
    remainingBytes: Math.max(0, totalBytes - loadedBytes),
    remainingSeconds: estimateRemainingSeconds({
      loaded: loadedBytes,
      total: totalBytes,
      startedAt: progress.startedAt,
      phase: activeItem ? activeItem.phase : '',
      status: activeItem
        ? activeItem.status
        : (failedFiles ? 'rejected' : (completedFiles === list.length && list.length ? 'fulfilled' : 'pending')),
      now,
    }),
    speedBytesPerSecond: loadedBytes > 0 && progress.startedAt ? loadedBytes / Math.max(0.5, (now - progress.startedAt) / 1000) : 0,
  };
}

export function createInitialUploadProgress(files) {
  const order = [];
  const items = {};
  Array.from(files || []).forEach((file) => {
    const key = getUploadFileKey(file);
    if (!key || items[key]) return;
    const size = Math.max(0, Number(file.size) || 0);
    order.push(key);
    items[key] = {
      key,
      name: file.name || 'photo',
      size,
      loaded: 0,
      total: size,
      percent: 0,
      phase: 'queued',
      status: 'pending',
    };
  });
  return aggregateProgress({
    order,
    items,
    startedAt: Date.now(),
    percent: 0,
    loadedBytes: 0,
    totalBytes: 0,
    completedFiles: 0,
    failedFiles: 0,
    totalFiles: order.length,
  });
}

export function reduceUploadProgress(prev, event) {
  if (!prev || !event) return prev;
  const key = event.fileKey || getUploadFileKey(event.file);
  if (!key) return prev;
  const existing = prev.items?.[key] || {
    key,
    name: event.fileName || event.file?.name || 'photo',
    size: Number(event.file?.size) || 0,
    loaded: 0,
    total: Number(event.file?.size) || 0,
    percent: 0,
    phase: 'queued',
    status: 'pending',
  };
  const nextPhase = event.phase || existing.phase || 'queued';
  const nextStatus = event.status || (
    nextPhase === 'done' ? 'fulfilled' : nextPhase === 'failed' ? 'rejected' : existing.status || 'pending'
  );
  const total = toPositiveNumber(event.total, toPositiveNumber(existing.total, existing.size || 0));
  const loadedFromEvent = Number(event.loaded);
  const loaded = nextStatus === 'fulfilled' || nextPhase === 'done'
    ? total
    : Number.isFinite(loadedFromEvent)
      ? Math.max(0, Math.min(total || loadedFromEvent, loadedFromEvent))
      : existing.loaded || 0;
  const now = Date.now();
  const uploadStartedAt = existing.uploadStartedAt || (
    nextPhase === 'uploading' || loaded > 0 ? now : null
  );
  const nextItem = {
    ...existing,
    name: event.fileName || event.file?.name || existing.name,
    loaded,
    total,
    percent: total > 0 ? clampPercent((loaded / total) * 100) : existing.percent || 0,
    phase: nextPhase,
    status: nextStatus,
    error: event.error || existing.error,
    uploadStartedAt,
    updatedAt: now,
  };
  nextItem.remainingSeconds = estimateRemainingSeconds({
    loaded: nextItem.loaded,
    total: nextItem.total,
    startedAt: nextItem.uploadStartedAt,
    phase: nextItem.phase,
    status: nextItem.status,
    now,
  });
  nextItem.speedBytesPerSecond = nextItem.loaded > 0 && nextItem.uploadStartedAt
    ? nextItem.loaded / Math.max(0.5, (now - nextItem.uploadStartedAt) / 1000)
    : 0;
  const order = prev.order && prev.order.includes(key) ? prev.order : [...(prev.order || []), key];
  return aggregateProgress({
    ...prev,
    order,
    items: {
      ...(prev.items || {}),
      [key]: nextItem,
    },
  });
}
