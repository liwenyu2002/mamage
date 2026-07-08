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

function aggregateProgress(progress) {
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
  const nextItem = {
    ...existing,
    name: event.fileName || event.file?.name || existing.name,
    loaded,
    total,
    percent: total > 0 ? clampPercent((loaded / total) * 100) : existing.percent || 0,
    phase: nextPhase,
    status: nextStatus,
    error: event.error || existing.error,
  };
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
