import React from 'react';
import { Toast } from './ui';
import {
  requestRoughCut,
  uploadVideoAsset,
  analyzeVideoAsset,
  listVideoAssets,
  listVideoProjects,
  createVideoProject,
  getVideoProject,
  updateVideoProject,
  startVideoRender,
  getVideoRender,
  cancelVideoRender,
  listProductionProjects,
  listProductionProjectMedia,
} from './services/videoEditorService';
import './VideoEditor.css';

const PROJECT_KEY = 'mamage_video_editor_project_v1';
const DEFAULT_BRIEF = '提炼活动亮点，开头快速吸引注意，中段交代过程，结尾自然收束。';
const STYLE_OPTIONS = [
  { key: 'balanced', label: '均衡叙事' },
  { key: 'dynamic', label: '快节奏' },
  { key: 'documentary', label: '纪实' },
  { key: 'social', label: '社交短视频' },
];

function uid(prefix = 'id') {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function clamp(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.max(min, Math.min(max, number));
}

function formatTime(value, withFrames = false) {
  const seconds = Math.max(0, Number(value) || 0);
  const minutes = Math.floor(seconds / 60);
  const rest = Math.floor(seconds % 60);
  const frames = Math.floor((seconds % 1) * 25);
  return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}${withFrames ? `:${String(frames).padStart(2, '0')}` : ''}`;
}

function clipDuration(clip) {
  return Math.max(0, (Number(clip.outPoint) - Number(clip.inPoint)) / Math.max(0.01, Number(clip.speed) || 1));
}

function isBlankClip(clip) {
  return Boolean(clip && clip.kind === 'blank');
}

function transitionOverlap(previous, clip) {
  const transition = String(clip && clip.transition || '').toLowerCase();
  if (!previous || !['dissolve', 'fade', 'flash'].includes(transition)) return 0;
  const overlap = Math.min(0.35, clipDuration(previous) / 2, clipDuration(clip) / 2);
  return overlap >= 0.08 ? overlap : 0;
}

function projectDuration(clips) {
  const offsets = buildOffsets(clips);
  return offsets.length ? offsets[offsets.length - 1].end : 0;
}

function buildOffsets(clips) {
  let cursor = 0;
  return (Array.isArray(clips) ? clips : []).map((clip, index, list) => {
    const duration = clipDuration(clip);
    const overlap = index ? transitionOverlap(list[index - 1], clip) : 0;
    const item = { clip, start: Math.max(0, cursor - overlap), end: Math.max(0, cursor - overlap) + duration, duration, overlap };
    cursor = item.end;
    return item;
  });
}

function normalizeClipTransitions(clips) {
  return clips.map((clip, index) => ({
    ...clip,
    transition: index === 0 ? 'none' : (!clip.transition || clip.transition === 'none' ? 'cut' : clip.transition),
  }));
}

function readVideoFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      resolve({
        id: uid('source'),
        name: file.name,
        url,
        duration: Number.isFinite(video.duration) ? video.duration : 0,
        width: video.videoWidth || 0,
        height: video.videoHeight || 0,
        size: file.size || 0,
        type: file.type || 'video/mp4',
        origin: 'local',
        offline: false,
      });
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`无法读取视频：${file.name}`));
    };
    video.src = url;
  });
}

function projectIdentity(project) {
  return String((project && (project.id ?? project.projectId)) || '');
}

function projectLabel(project) {
  return String((project && (project.projectName || project.name || project.title)) || `项目 ${projectIdentity(project)}`);
}

function normalizeTags(value) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (!value) return [];
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
    } catch (_) { /* comma-separated legacy tags */ }
    return value.split(/[,，]/).map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

function isProductionVideo(item) {
  const type = String((item && (item.type || item.mediaType || item.mimeType)) || '').toLowerCase();
  const url = String((item && (item.playbackUrl || item.url || item.publicDownloadUrl)) || '');
  return Boolean(item && item.playbackUrl)
    || type === 'video'
    || type.startsWith('video/')
    || /\.(mp4|mov|m4v|webm|mkv|avi|ogv|ogg)(?:[?#]|$)/i.test(url);
}

function normalizeProductionVideo(item, project) {
  const photoId = String((item && (item.id ?? item.photoId)) || uid('production-media'));
  const projectId = projectIdentity(project) || String(item.projectId || '');
  const url = item.playbackUrl || item.url || item.publicDownloadUrl || '';
  const duration = Number(item.duration || item.durationSeconds || item.videoDuration || (item.metadata && item.metadata.duration)) || 0;
  return {
    id: `production-${projectId}-${photoId}`,
    productionPhotoId: photoId,
    productionProjectId: projectId,
    productionProjectName: projectLabel(project),
    name: String(item.title || item.name || `视频 ${photoId}`),
    url,
    serverUrl: url,
    thumbUrl: item.thumbUrl || item.url || '',
    duration,
    width: Number(item.width || item.videoWidth || (item.metadata && item.metadata.width)) || 0,
    height: Number(item.height || item.videoHeight || (item.metadata && item.metadata.height)) || 0,
    size: Number(item.size || item.fileSize) || 0,
    type: item.mimeType || item.type || 'video/mp4',
    tags: normalizeTags(item.tags),
    description: item.description || '',
    timelineSectionName: item.timelineSectionName || '',
    photographerName: item.photographerName || '',
    createdAt: item.createdAt || '',
    aiScore: item.aiScore,
    aiQuality: item.aiQuality,
    analysis: item.videoAnalysis || item.video_analysis || item.analysis || null,
    origin: 'production',
    remote: true,
    offline: !url,
  };
}

function hydrateRemoteVideoMetadata(source) {
  if (!source || !source.url || (source.duration > 0 && source.width > 0 && source.height > 0)) return Promise.resolve(source);
  return new Promise((resolve) => {
    const video = document.createElement('video');
    let settled = false;
    const finish = (patch = {}) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      video.removeAttribute('src');
      video.load();
      resolve({ ...source, ...patch });
    };
    const timer = setTimeout(() => finish(), 15000);
    video.preload = 'metadata';
    video.muted = true;
    video.onloadedmetadata = () => finish({
      duration: Number.isFinite(video.duration) ? video.duration : source.duration,
      width: video.videoWidth || source.width,
      height: video.videoHeight || source.height,
    });
    video.onerror = () => finish();
    video.src = source.url;
  });
}

function serializableProject(project) {
  const serializedSources = project.sources.map((source) => ({
    ...source,
    url: source.serverUrl || (source.url && !source.url.startsWith('blob:') ? source.url : ''),
    offline: !(source.assetId || source.productionPhotoId || (source.url && !source.url.startsWith('blob:'))),
  }));
  return {
    version: 2,
    name: project.name,
    aspectRatio: project.aspectRatio,
    canvas: { aspectRatio: project.aspectRatio, fps: 25 },
    sources: serializedSources,
    clips: project.clips,
    tracks: [
      { id: 'V1', type: 'video', primary: true, name: '主视频', clips: project.clips },
      { id: 'A1', type: 'audio', name: '背景音频', clips: project.audioClips || [] },
      { id: 'T1', type: 'caption', name: '字幕', clips: project.captions || [] },
    ],
    audioClips: project.audioClips || [],
    captions: project.captions,
    productionProjects: project.productionProjects || [],
    ai: {
      brief: (project.ai && project.ai.brief) || DEFAULT_BRIEF,
      targetDuration: Number(project.ai && project.ai.targetDuration) || 45,
      style: (project.ai && project.ai.style) || 'balanced',
    },
    serverProjectId: project.projectId || null,
    updatedAt: new Date().toISOString(),
  };
}

function projectFingerprint(project) {
  const snapshot = { ...project };
  delete snapshot.updatedAt;
  delete snapshot.serverProjectId;
  return JSON.stringify(snapshot);
}

function VideoEditor() {
  const videoRef = React.useRef(null);
  const fileInputRef = React.useRef(null);
  const sourcesRef = React.useRef([]);
  const [projectName, setProjectName] = React.useState('未命名视频工程');
  const [sources, setSources] = React.useState([]);
  const [clips, setClips] = React.useState([]);
  const [audioClips, setAudioClips] = React.useState([]);
  const [captions, setCaptions] = React.useState([]);
  const [captionDraft, setCaptionDraft] = React.useState('');
  const [selectedSourceId, setSelectedSourceId] = React.useState(null);
  const [selectedClipId, setSelectedClipId] = React.useState(null);
  const [playhead, setPlayhead] = React.useState(0);
  const [isPlaying, setIsPlaying] = React.useState(false);
  const [zoom, setZoom] = React.useState(14);
  const [aspectRatio, setAspectRatio] = React.useState('16:9');
  const [draggedClipId, setDraggedClipId] = React.useState(null);
  const [draggedSourceId, setDraggedSourceId] = React.useState(null);
  const [trimmingClipId, setTrimmingClipId] = React.useState(null);
  const [timelineDropIndex, setTimelineDropIndex] = React.useState(null);
  const [brief, setBrief] = React.useState(DEFAULT_BRIEF);
  const [targetDuration, setTargetDuration] = React.useState(45);
  const [editStyle, setEditStyle] = React.useState('balanced');
  const [aiBusy, setAiBusy] = React.useState(false);
  const [aiResult, setAiResult] = React.useState(null);
  const [savedAt, setSavedAt] = React.useState('');
  const [autoSaveStatus, setAutoSaveStatus] = React.useState('idle');
  const [projectId, setProjectId] = React.useState(null);
  const [projects, setProjects] = React.useState([]);
  const [productionProjects, setProductionProjects] = React.useState([]);
  const [selectedProductionProjectIds, setSelectedProductionProjectIds] = React.useState([]);
  const [sourceProjects, setSourceProjects] = React.useState([]);
  const [projectPickerOpen, setProjectPickerOpen] = React.useState(false);
  const [projectSearch, setProjectSearch] = React.useState('');
  const [productionProjectsBusy, setProductionProjectsBusy] = React.useState(false);
  const [productionProjectsError, setProductionProjectsError] = React.useState('');
  const [projectImportBusy, setProjectImportBusy] = React.useState(false);
  const [cloudBusy, setCloudBusy] = React.useState(false);
  const [uploadingCount, setUploadingCount] = React.useState(0);
  const [renderJob, setRenderJob] = React.useState(null);
  const [history, setHistory] = React.useState([]);
  const [future, setFuture] = React.useState([]);
  const projectIdRef = React.useRef(null);
  const savePromiseRef = React.useRef(null);
  const lastServerFingerprintRef = React.useRef('');
  const autoSaveMountedRef = React.useRef(false);
  const skipAutoSaveRef = React.useRef(false);

  React.useEffect(() => { sourcesRef.current = sources; }, [sources]);
  React.useEffect(() => { projectIdRef.current = projectId; }, [projectId]);
  React.useEffect(() => () => {
    sourcesRef.current.forEach((source) => {
      if (source.url && source.url.startsWith('blob:')) URL.revokeObjectURL(source.url);
    });
  }, []);

  React.useEffect(() => {
    try {
      const raw = localStorage.getItem(PROJECT_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (!saved || !Array.isArray(saved.clips)) return;
      skipAutoSaveRef.current = true;
      projectIdRef.current = saved.serverProjectId || null;
      setProjectId(saved.serverProjectId || null);
      setProjectName(saved.name || '未命名视频工程');
      setAspectRatio(saved.aspectRatio || '16:9');
      setSources(Array.isArray(saved.sources) ? saved.sources.map((source) => ({
        ...source,
        url: source.url || '',
        serverUrl: source.url || '',
        offline: !(source.assetId || source.productionPhotoId || source.url),
      })) : []);
      setClips(saved.clips);
      setAudioClips(Array.isArray(saved.audioClips) ? saved.audioClips : []);
      setCaptions(Array.isArray(saved.captions) ? saved.captions : []);
      setBrief((saved.ai && saved.ai.brief) || DEFAULT_BRIEF);
      setTargetDuration(Number(saved.ai && saved.ai.targetDuration) || 45);
      setEditStyle((saved.ai && saved.ai.style) || 'balanced');
      const restoredProjects = Array.isArray(saved.productionProjects) ? saved.productionProjects : [];
      setSourceProjects(restoredProjects);
      setSelectedProductionProjectIds(restoredProjects.map(projectIdentity).filter(Boolean));
      setSelectedClipId(saved.clips[0] ? saved.clips[0].id : null);
      setSavedAt(saved.updatedAt || '');
    } catch (error) {
      console.warn('[VideoEditor] restore project failed', error);
    }
  }, []);

  React.useEffect(() => {
    listVideoProjects().then((response) => setProjects(response.projects || [])).catch(() => {});
  }, []);

  const loadProductionProjectOptions = React.useCallback(async () => {
    setProductionProjectsBusy(true);
    setProductionProjectsError('');
    try {
      const collected = [];
      let page = 1;
      let hasMore = true;
      while (hasMore && page <= 10) {
        const response = await listProductionProjects({ page, pageSize: 100 });
        collected.push(...response.list);
        hasMore = response.hasMore;
        page += 1;
      }
      const unique = Array.from(new Map(collected.map((project) => [projectIdentity(project), project])).values()).filter((project) => projectIdentity(project));
      setProductionProjects(unique);
    } catch (error) {
      setProductionProjectsError(error && error.status === 401 ? '请先登录生产系统后再选择项目' : (error.message || '生产项目读取失败'));
    } finally {
      setProductionProjectsBusy(false);
    }
  }, []);

  React.useEffect(() => { loadProductionProjectOptions(); }, [loadProductionProjectOptions]);

  const visibleProductionProjects = React.useMemo(() => {
    const keyword = projectSearch.trim().toLowerCase();
    if (!keyword) return productionProjects;
    return productionProjects.filter((project) => {
      const haystack = [projectLabel(project), project.description, project.eventDate, ...(normalizeTags(project.tags))].join(' ').toLowerCase();
      return haystack.includes(keyword);
    });
  }, [productionProjects, projectSearch]);

  React.useEffect(() => {
    if (!renderJob || !['queued', 'running'].includes(renderJob.status)) return undefined;
    const timer = setInterval(async () => {
      try {
        const response = await getVideoRender(renderJob.id);
        setRenderJob(response.job);
        if (response.job.status === 'completed') Toast.success('视频导出完成');
        if (response.job.status === 'failed') Toast.error(response.job.error || '视频导出失败');
      } catch (_) { /* 下次轮询重试 */ }
    }, 1500);
    return () => clearInterval(timer);
  }, [renderJob && renderJob.id, renderJob && renderJob.status]);

  const snapshot = React.useCallback(() => ({ clips, audioClips, captions }), [clips, audioClips, captions]);
  const pushHistory = React.useCallback(() => {
    setHistory((items) => [...items.slice(-49), snapshot()]);
    setFuture([]);
  }, [snapshot]);
  const undo = React.useCallback(() => {
    if (!history.length) return;
    const previous = history[history.length - 1];
    setFuture((items) => [snapshot(), ...items].slice(0, 50));
    setHistory((items) => items.slice(0, -1));
    setClips(previous.clips); setAudioClips(previous.audioClips); setCaptions(previous.captions);
    setSelectedClipId(previous.clips[0] ? previous.clips[0].id : null);
  }, [history, snapshot]);
  const redo = React.useCallback(() => {
    if (!future.length) return;
    const next = future[0];
    setHistory((items) => [...items.slice(-49), snapshot()]);
    setFuture((items) => items.slice(1));
    setClips(next.clips); setAudioClips(next.audioClips); setCaptions(next.captions);
    setSelectedClipId(next.clips[0] ? next.clips[0].id : null);
  }, [future, snapshot]);

  const offsets = React.useMemo(() => buildOffsets(clips), [clips]);
  const duration = React.useMemo(() => projectDuration(clips), [clips]);
  const hasUnrenderableClips = React.useMemo(() => clips.some((clip) => {
    if (isBlankClip(clip)) return false;
    const source = sources.find((item) => item.id === clip.sourceId);
    return !source || !(source.assetId || source.productionPhotoId);
  }), [clips, sources]);
  const selectedClip = React.useMemo(() => clips.find((clip) => clip.id === selectedClipId) || null, [clips, selectedClipId]);
  const activeInfo = React.useMemo(() => {
    if (!offsets.length) return null;
    return offsets.find((item, index) => playhead >= item.start && (playhead < item.end || index === offsets.length - 1)) || offsets[0];
  }, [offsets, playhead]);
  const activeSource = React.useMemo(() => (
    activeInfo ? sources.find((source) => source.id === activeInfo.clip.sourceId) || null : null
  ), [activeInfo, sources]);
  const activeIsBlank = Boolean(activeInfo && isBlankClip(activeInfo.clip));
  const currentCaption = React.useMemo(() => (
    captions.find((caption) => playhead >= Number(caption.at) && playhead <= Number(caption.at) + 3.5) || null
  ), [captions, playhead]);

  const seekTo = React.useCallback((next) => {
    setPlayhead(clamp(next, 0, duration || 0));
  }, [duration]);

  React.useEffect(() => {
    setPlayhead((value) => clamp(value, 0, duration || 0));
  }, [duration]);

  React.useEffect(() => {
    if (!activeInfo || selectedClipId === activeInfo.clip.id) return;
    setSelectedClipId(activeInfo.clip.id);
  }, [activeInfo && activeInfo.clip.id, selectedClipId]);

  React.useEffect(() => {
    const video = videoRef.current;
    if (!video || !activeInfo || !activeSource || !activeSource.url) return;
    const desired = activeInfo.clip.inPoint + ((playhead - activeInfo.start) * (activeInfo.clip.speed || 1));
    video.playbackRate = activeInfo.clip.speed || 1;
    video.volume = clamp(activeInfo.clip.volume === undefined ? 1 : activeInfo.clip.volume, 0, 1);
    video.muted = Number(activeInfo.clip.volume) === 0;
    if (Math.abs((video.currentTime || 0) - desired) > 0.25) {
      try { video.currentTime = clamp(desired, activeInfo.clip.inPoint, activeInfo.clip.outPoint); } catch (e) { /* metadata not ready */ }
    }
    if (isPlaying) video.play().catch(() => setIsPlaying(false));
    else video.pause();
  }, [activeInfo && activeInfo.clip.id, activeInfo && activeInfo.clip.volume, activeSource && activeSource.url, isPlaying]);

  React.useEffect(() => {
    const video = videoRef.current;
    if (!video || !activeInfo || !activeSource || !activeSource.url) return;
    const desired = activeInfo.clip.inPoint + ((playhead - activeInfo.start) * (activeInfo.clip.speed || 1));
    if (Math.abs((video.currentTime || 0) - desired) <= 0.04) return;
    try { video.currentTime = clamp(desired, activeInfo.clip.inPoint, activeInfo.clip.outPoint); } catch (_) { /* metadata not ready */ }
  }, [playhead, activeInfo && activeInfo.clip.id, activeSource && activeSource.url]);

  React.useEffect(() => {
    if (!isPlaying || !activeInfo || !isBlankClip(activeInfo.clip)) return undefined;
    let frame = null;
    let cursor = clamp(playhead, activeInfo.start, activeInfo.end);
    let previousTime = null;
    const tick = (now) => {
      if (previousTime === null) previousTime = now;
      const elapsed = Math.max(0, (now - previousTime) / 1000);
      previousTime = now;
      cursor = Math.min(activeInfo.end, cursor + elapsed);
      setPlayhead(cursor);
      if (cursor >= activeInfo.end - 0.001) {
        if (activeInfo.end >= duration - 0.001) setIsPlaying(false);
        return;
      }
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => { if (frame !== null) window.cancelAnimationFrame(frame); };
  }, [isPlaying, activeInfo && activeInfo.clip.id, activeInfo && activeInfo.end, duration]);

  const handleVideoTimeUpdate = React.useCallback((event) => {
    if (!activeInfo) return;
    const mediaTime = event.currentTarget.currentTime;
    if (mediaTime >= activeInfo.clip.outPoint - 0.04) {
      const index = offsets.findIndex((item) => item.clip.id === activeInfo.clip.id);
      const next = offsets[index + 1];
      if (next) {
        setPlayhead(next.start);
      } else {
        setPlayhead(duration);
        setIsPlaying(false);
      }
      return;
    }
    const global = activeInfo.start + ((mediaTime - activeInfo.clip.inPoint) / Math.max(0.01, activeInfo.clip.speed || 1));
    setPlayhead(clamp(global, activeInfo.start, activeInfo.end));
  }, [activeInfo, offsets, duration]);

  const importFiles = React.useCallback(async (files) => {
    const list = Array.from(files || []).filter((file) => String(file.type || '').startsWith('video/') || /\.(mp4|mov|m4v|webm|ogv|ogg)$/i.test(file.name));
    if (!list.length) return Toast.warning('请选择视频文件');
    try {
      const loaded = await Promise.all(list.map(readVideoFile));
      pushHistory();
      setSources((previous) => {
        const next = previous.slice();
        loaded.forEach((source) => {
          const offlineIndex = next.findIndex((item) => item.offline && item.name === source.name);
          if (offlineIndex >= 0) next[offlineIndex] = { ...source, id: next[offlineIndex].id };
          else next.push(source);
        });
        return next;
      });
      setClips((previous) => {
        const next = previous.slice();
        loaded.forEach((source) => {
          const offline = sources.find((item) => item.offline && item.name === source.name);
          const sourceId = offline ? offline.id : source.id;
          if (!next.some((clip) => clip.sourceId === sourceId)) {
            next.push({ id: uid('clip'), sourceId, inPoint: 0, outPoint: source.duration, speed: 1, transition: next.length ? 'cut' : 'none' });
          }
        });
        return next;
      });
      setSelectedSourceId(loaded[0] ? loaded[0].id : null);
      setUploadingCount(list.length);
      Toast.success(`已导入 ${loaded.length} 个视频素材，正在上传以支持云端保存和导出`);
      loaded.forEach((localSource, index) => {
        uploadVideoAsset(list[index], localSource, {
          onProgress: (event) => setSources((previous) => previous.map((source) => source.id === localSource.id ? {
            ...source,
            uploadPhase: event.phase,
            uploadProgress: event.total ? Math.round((event.loaded / event.total) * 100) : source.uploadProgress,
          } : source)),
        }).then((response) => {
          const asset = response.asset;
          setSources((previous) => previous.map((source) => source.id === localSource.id ? {
            ...source,
            assetId: asset.assetId,
            serverUrl: asset.url,
            hasAudio: asset.hasAudio,
            offline: false,
            uploadPhase: 'done',
            uploadProgress: 100,
          } : source));
        }).catch((error) => {
          Toast.warning(`${localSource.name} 上传失败，仍可本地剪辑：${error.message || ''}`);
        }).finally(() => setUploadingCount((count) => Math.max(0, count - 1)));
      });
    } catch (error) {
      Toast.error(error.message || '读取视频失败');
    }
  }, [sources, pushHistory]);

  const addSourceToTimeline = React.useCallback((source, requestedIndex) => {
    if (!source || !source.duration) return;
    pushHistory();
    const clip = { id: uid('clip'), sourceId: source.id, assetId: source.assetId, inPoint: 0, outPoint: source.duration, speed: 1, volume: 1, transition: 'cut' };
    setClips((previous) => {
      const index = Number.isInteger(requestedIndex) ? clamp(requestedIndex, 0, previous.length) : previous.length;
      const next = previous.slice();
      next.splice(index, 0, clip);
      return normalizeClipTransitions(next);
    });
    setSelectedClipId(clip.id);
  }, [pushHistory]);

  const addBlankClip = React.useCallback(() => {
    pushHistory();
    const selectedIndex = clips.findIndex((clip) => clip.id === selectedClipId);
    const insertIndex = selectedIndex >= 0 ? selectedIndex + 1 : clips.length;
    const start = offsets[insertIndex] ? offsets[insertIndex].start : duration;
    const blank = {
      id: uid('blank'), kind: 'blank', name: '留白',
      inPoint: 0, outPoint: 2, speed: 1, volume: 0,
      transition: insertIndex === 0 ? 'none' : 'cut',
    };
    const next = clips.slice();
    next.splice(insertIndex, 0, blank);
    setClips(normalizeClipTransitions(next));
    setSelectedClipId(blank.id);
    setPlayhead(start);
    setIsPlaying(false);
    Toast.success('已添加 2 秒留白，可在片段属性中修改时长');
  }, [clips, duration, offsets, pushHistory, selectedClipId]);

  const addSelectedSourceAsAudio = React.useCallback(() => {
    const source = sources.find((item) => item.id === selectedSourceId);
    if (!source) return Toast.warning('请先在媒体区选择一个素材');
    if (source.hasAudio === false) return Toast.warning('这个素材没有音频轨');
    pushHistory();
    setAudioClips((previous) => [...previous, {
      id: uid('audio'), sourceId: source.id, assetId: source.assetId,
      inPoint: 0, outPoint: source.duration, timelineStart: 0, volume: 0.35,
    }]);
    Toast.success('已把素材音频加入 A1 音轨');
  }, [sources, selectedSourceId, pushHistory]);

  const addCaptionAtPlayhead = React.useCallback(() => {
    const text = captionDraft.trim();
    if (!text) return Toast.warning('请输入字幕内容');
    pushHistory();
    setCaptions((items) => [...items, { id: uid('caption'), at: Number(playhead.toFixed(2)), duration: 3.5, text }].sort((a, b) => Number(a.at) - Number(b.at)));
    setCaptionDraft('');
  }, [captionDraft, playhead, pushHistory]);

  const updateSelectedClip = React.useCallback((patch) => {
    if (!selectedClipId) return;
    pushHistory();
    setClips((previous) => previous.map((clip) => {
      if (clip.id !== selectedClipId) return clip;
      const source = sources.find((item) => item.id === clip.sourceId);
      const next = { ...clip, ...patch };
      if (isBlankClip(next)) {
        next.inPoint = 0;
        next.outPoint = Math.max(0.1, Number(next.outPoint) || 0.1);
        next.speed = 1;
        next.volume = 0;
        return next;
      }
      next.inPoint = clamp(next.inPoint, 0, Math.max(0, (source && source.duration) || next.outPoint));
      next.outPoint = clamp(next.outPoint, next.inPoint + 0.1, (source && source.duration) || next.outPoint);
      next.speed = clamp(next.speed, 0.25, 4);
      return next;
    }));
  }, [selectedClipId, sources, pushHistory]);

  const startClipTrim = React.useCallback((event, item, edge) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();

    const original = { ...item.clip };
    const blank = isBlankClip(original);
    const source = blank ? null : sources.find((entry) => entry.id === original.sourceId);
    const sourceDuration = Number(source && source.duration) > 0
      ? Number(source.duration)
      : Math.max(0.1, Number(original.outPoint) || 0.1);
    const startX = event.clientX;
    const speed = Math.max(0.01, Number(original.speed) || 1);
    const pointerId = event.pointerId;
    const handle = event.currentTarget;

    pushHistory();
    setIsPlaying(false);
    setSelectedClipId(original.id);
    setPlayhead(item.start);
    setTrimmingClipId(original.id);
    if (handle.setPointerCapture) {
      try { handle.setPointerCapture(pointerId); } catch (_) { /* pointer capture is optional */ }
    }

    const move = (moveEvent) => {
      const timelineDelta = (moveEvent.clientX - startX) / Math.max(1, zoom);
      setClips((previous) => previous.map((clip) => {
        if (clip.id !== original.id) return clip;
        if (blank) {
          const originalDuration = clipDuration(original);
          const nextDuration = edge === 'right'
            ? Math.max(0.1, originalDuration + timelineDelta)
            : Math.max(0.1, originalDuration - timelineDelta);
          return { ...clip, inPoint: 0, outPoint: nextDuration, speed: 1, volume: 0 };
        }
        if (edge === 'right') {
          return {
            ...clip,
            outPoint: clamp(Number(original.outPoint) + (timelineDelta * speed), Number(original.inPoint) + 0.1, sourceDuration),
          };
        }
        return {
          ...clip,
          inPoint: clamp(Number(original.inPoint) + (timelineDelta * speed), 0, Number(original.outPoint) - 0.1),
        };
      }));
    };

    const finish = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      setTrimmingClipId(null);
      if (handle.releasePointerCapture && handle.hasPointerCapture && handle.hasPointerCapture(pointerId)) {
        try { handle.releasePointerCapture(pointerId); } catch (_) { /* pointer may already be released */ }
      }
    };

    window.addEventListener('pointermove', move, { passive: true });
    window.addEventListener('pointerup', finish, { once: true });
    window.addEventListener('pointercancel', finish, { once: true });
  }, [pushHistory, sources, zoom]);

  const deleteClip = React.useCallback((clipId) => {
    if (!clipId) return;
    const index = clips.findIndex((clip) => clip.id === clipId);
    if (index < 0) return;
    pushHistory();
    const next = normalizeClipTransitions(clips.filter((clip) => clip.id !== clipId));
    setClips(next);
    setSelectedClipId((current) => current === clipId
      ? (next[Math.min(index, next.length - 1)] ? next[Math.min(index, next.length - 1)].id : null)
      : current);
    setPlayhead((value) => clamp(value, 0, projectDuration(next)));
  }, [clips, pushHistory]);

  const deleteSelectedClip = React.useCallback(() => {
    deleteClip(selectedClipId);
  }, [deleteClip, selectedClipId]);

  const duplicateSelectedClip = React.useCallback(() => {
    const index = clips.findIndex((clip) => clip.id === selectedClipId);
    if (index < 0) return;
    pushHistory();
    const copy = { ...clips[index], id: uid('clip'), transition: 'cut' };
    const next = clips.slice();
    next.splice(index + 1, 0, copy);
    setClips(next);
    setSelectedClipId(copy.id);
  }, [clips, selectedClipId, pushHistory]);

  const splitAtPlayhead = React.useCallback(() => {
    const info = offsets.find((item) => item.clip.id === selectedClipId);
    if (!info || playhead <= info.start + 0.08 || playhead >= info.end - 0.08) return Toast.warning('请把播放头移动到所选片段内部');
    pushHistory();
    const sourceTime = info.clip.inPoint + ((playhead - info.start) * (info.clip.speed || 1));
    const left = { ...info.clip, outPoint: sourceTime };
    const right = { ...info.clip, id: uid('clip'), inPoint: sourceTime, transition: 'cut' };
    const index = clips.findIndex((clip) => clip.id === info.clip.id);
    const next = clips.slice();
    next.splice(index, 1, left, right);
    setClips(next);
    setSelectedClipId(right.id);
  }, [clips, offsets, playhead, selectedClipId, pushHistory]);

  const reorderClipAt = React.useCallback((clipId, requestedIndex) => {
    const from = clips.findIndex((clip) => clip.id === clipId);
    if (from < 0) return;
    let to = clamp(requestedIndex, 0, clips.length);
    if (from < to) to -= 1;
    if (from === to) return;
    pushHistory();
    const next = clips.slice();
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setClips(normalizeClipTransitions(next));
    setSelectedClipId(clipId);
  }, [clips, pushHistory]);

  const getTimelineDropIndex = React.useCallback((event) => {
    const track = event.currentTarget;
    const clipElements = Array.from(track.querySelectorAll('.ve-clip'));
    const pointerX = event.clientX;
    const index = clipElements.findIndex((element) => pointerX < element.getBoundingClientRect().left + (element.getBoundingClientRect().width / 2));
    return index < 0 ? clipElements.length : index;
  }, []);

  const handleTimelineDragOver = React.useCallback((event) => {
    const transferTypes = Array.from(event.dataTransfer.types || []);
    const hasSource = draggedSourceId || transferTypes.includes('application/x-mamage-video-source');
    const hasClip = draggedClipId || transferTypes.includes('application/x-mamage-video-clip');
    if (!hasClip && !hasSource) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = hasSource ? 'copy' : 'move';
    setTimelineDropIndex(getTimelineDropIndex(event));
  }, [draggedClipId, draggedSourceId, getTimelineDropIndex]);

  const clearTimelineDrag = React.useCallback(() => {
    setDraggedClipId(null);
    setDraggedSourceId(null);
    setTimelineDropIndex(null);
  }, []);

  const handleTimelineDrop = React.useCallback((event) => {
    event.preventDefault();
    event.stopPropagation();
    const targetIndex = getTimelineDropIndex(event);
    const sourceId = draggedSourceId || event.dataTransfer.getData('application/x-mamage-video-source');
    const clipId = draggedClipId || event.dataTransfer.getData('application/x-mamage-video-clip');
    if (sourceId) {
      const source = sources.find((item) => item.id === sourceId);
      if (source) addSourceToTimeline(source, targetIndex);
    } else if (clipId) {
      reorderClipAt(clipId, targetIndex);
    }
    clearTimelineDrag();
  }, [addSourceToTimeline, clearTimelineDrag, draggedClipId, draggedSourceId, getTimelineDropIndex, reorderClipAt, sources]);

  React.useEffect(() => {
    const handleDeleteKey = (event) => {
      if (!selectedClipId || !['Delete', 'Backspace'].includes(event.key)) return;
      const target = event.target;
      if (target && (target.closest('input, textarea, select, [contenteditable="true"]'))) return;
      event.preventDefault();
      deleteClip(selectedClipId);
    };
    window.addEventListener('keydown', handleDeleteKey);
    return () => window.removeEventListener('keydown', handleDeleteKey);
  }, [deleteClip, selectedClipId]);

  const saveProject = React.useCallback(async (options = {}) => {
    const silent = Boolean(options && options.silent);
    const project = serializableProject({
      name: projectName,
      aspectRatio,
      sources,
      clips,
      audioClips,
      captions,
      productionProjects: sourceProjects,
      ai: { brief, targetDuration, style: editStyle },
      projectId: projectIdRef.current,
    });
    const fingerprint = projectFingerprint(project);
    localStorage.setItem(PROJECT_KEY, JSON.stringify(project));
    setSavedAt(project.updatedAt);

    if (savePromiseRef.current) {
      try { await savePromiseRef.current; } catch (_) { /* retry with the latest snapshot */ }
    }
    if (fingerprint === lastServerFingerprintRef.current && projectIdRef.current) {
      setAutoSaveStatus('saved');
      if (!silent) Toast.info('工程已经是最新状态');
      return projectIdRef.current;
    }

    setAutoSaveStatus('saving');
    if (!silent) setCloudBusy(true);
    const task = (async () => {
      const currentProjectId = projectIdRef.current;
      const payload = { name: projectName, aspectRatio, project };
      const response = currentProjectId
        ? await updateVideoProject(currentProjectId, payload)
        : await createVideoProject(payload);
      const savedProjectId = response.project.id;
      projectIdRef.current = savedProjectId;
      setProjectId(savedProjectId);
      project.serverProjectId = savedProjectId;
      project.updatedAt = response.project.updatedAt || project.updatedAt;
      localStorage.setItem(PROJECT_KEY, JSON.stringify(project));
      lastServerFingerprintRef.current = fingerprint;
      setSavedAt(project.updatedAt);
      setAutoSaveStatus('saved');
      if (!currentProjectId || !silent) {
        const listing = await listVideoProjects();
        setProjects(listing.projects || []);
      }
      if (!silent) Toast.success('剪辑工程已保存到服务端');
      return savedProjectId;
    })();
    savePromiseRef.current = task;
    try {
      return await task;
    } catch (error) {
      setAutoSaveStatus('error');
      if (!silent) Toast.warning(`服务端保存失败，进度已保存在本机：${error.message || ''}`);
      return null;
    } finally {
      if (savePromiseRef.current === task) savePromiseRef.current = null;
      if (!silent) setCloudBusy(false);
    }
  }, [projectName, aspectRatio, sources, clips, audioClips, captions, sourceProjects, brief, targetDuration, editStyle]);

  React.useEffect(() => {
    const project = serializableProject({
      name: projectName,
      aspectRatio,
      sources,
      clips,
      audioClips,
      captions,
      productionProjects: sourceProjects,
      ai: { brief, targetDuration, style: editStyle },
      projectId: projectIdRef.current,
    });
    localStorage.setItem(PROJECT_KEY, JSON.stringify(project));

    if (!autoSaveMountedRef.current) {
      autoSaveMountedRef.current = true;
      return undefined;
    }
    if (skipAutoSaveRef.current) {
      skipAutoSaveRef.current = false;
      lastServerFingerprintRef.current = projectIdRef.current ? projectFingerprint(project) : '';
      setAutoSaveStatus(projectIdRef.current ? 'saved' : 'idle');
      return undefined;
    }

    const fingerprint = projectFingerprint(project);
    if (fingerprint === lastServerFingerprintRef.current && projectIdRef.current) {
      setAutoSaveStatus('saved');
      return undefined;
    }
    setAutoSaveStatus('pending');
    if (uploadingCount > 0) return undefined;
    const timer = setTimeout(() => saveProject({ silent: true }), 1800);
    return () => clearTimeout(timer);
  }, [projectName, aspectRatio, sources, clips, audioClips, captions, sourceProjects, brief, targetDuration, editStyle, uploadingCount, saveProject]);

  const newProject = React.useCallback(() => {
    sources.forEach((source) => { if (source.url && source.url.startsWith('blob:')) URL.revokeObjectURL(source.url); });
    skipAutoSaveRef.current = true;
    projectIdRef.current = null;
    lastServerFingerprintRef.current = '';
    setProjectId(null); setProjectName('未命名视频工程'); setAspectRatio('16:9');
    setSources([]); setClips([]); setAudioClips([]); setCaptions([]);
    setBrief(DEFAULT_BRIEF); setTargetDuration(45); setEditStyle('balanced');
    setSourceProjects([]); setSelectedProductionProjectIds([]);
    setSelectedSourceId(null); setSelectedClipId(null); setPlayhead(0); setSavedAt(''); setAutoSaveStatus('idle');
    setRenderJob(null); setHistory([]); setFuture([]); setAiResult(null);
    localStorage.removeItem(PROJECT_KEY);
    Toast.success('已新建空白视频工程');
  }, [sources]);

  const loadProject = React.useCallback(async (id) => {
    if (!id) return;
    setCloudBusy(true);
    try {
      const response = await getVideoProject(id);
      const saved = response.project.project || {};
      const assetResponse = await listVideoAssets().catch(() => ({ assets: [] }));
      const assetsById = new Map((assetResponse.assets || []).map((asset) => [String(asset.assetId || asset.id), asset]));
      let restoredSources = (saved.sources || []).map((source) => {
        const freshAsset = assetsById.get(String(source.assetId || '')) || {};
        // Bucket/代理签名会过期；有 assetId 时始终优先使用后端刚返回的播放地址。
        const playableUrl = freshAsset.url || source.serverUrl || source.url || '';
        return {
          ...source,
          ...freshAsset,
          id: source.id,
          assetId: source.assetId,
          url: playableUrl,
          serverUrl: playableUrl,
          offline: !playableUrl,
        };
      });
      const restoredProductionProjects = Array.isArray(saved.productionProjects) ? saved.productionProjects : [];
      if (restoredProductionProjects.length && restoredSources.some((source) => source.productionPhotoId)) {
        const refreshed = await Promise.allSettled(restoredProductionProjects.map(async (project) => ({
          project,
          media: await listProductionProjectMedia(projectIdentity(project)),
        })));
        const mediaById = new Map();
        refreshed.forEach((entry) => {
          if (entry.status !== 'fulfilled') return;
          entry.value.media.filter(isProductionVideo).forEach((item) => mediaById.set(String(item.id ?? item.photoId), { item, project: entry.value.project }));
        });
        restoredSources = restoredSources.map((source) => {
          const fresh = mediaById.get(String(source.productionPhotoId || ''));
          if (!fresh) return source;
          const normalized = normalizeProductionVideo(fresh.item, fresh.project);
          return { ...source, ...normalized, id: source.id, duration: source.duration || normalized.duration };
        });
      }
      skipAutoSaveRef.current = true;
      projectIdRef.current = response.project.id;
      setProjectId(response.project.id);
      setProjectName(response.project.name || saved.name || '未命名视频工程');
      setAspectRatio(response.project.aspectRatio || saved.aspectRatio || '16:9');
      setSources(restoredSources);
      setClips(saved.clips || (((saved.tracks || []).find((track) => track.id === 'V1') || {}).clips || []));
      setAudioClips(saved.audioClips || (((saved.tracks || []).find((track) => track.id === 'A1') || {}).clips || []));
      setCaptions(saved.captions || []);
      setBrief((saved.ai && saved.ai.brief) || DEFAULT_BRIEF);
      setTargetDuration(Number(saved.ai && saved.ai.targetDuration) || 45);
      setEditStyle((saved.ai && saved.ai.style) || 'balanced');
      setSourceProjects(restoredProductionProjects);
      setSelectedProductionProjectIds(restoredProductionProjects.map(projectIdentity).filter(Boolean));
      setSelectedClipId((saved.clips || [])[0] ? saved.clips[0].id : null);
      setHistory([]); setFuture([]); setPlayhead(0);
      setSavedAt(response.project.updatedAt || '');
      setAutoSaveStatus('saved');
      Toast.success('已载入云端剪辑工程');
    } catch (error) {
      Toast.error(error.message || '载入工程失败');
    } finally { setCloudBusy(false); }
  }, []);

  const startRender = React.useCallback(async () => {
    if (!clips.length) return Toast.warning('时间线为空，无法导出');
    if (uploadingCount) return Toast.warning('素材仍在上传，请稍候');
    const missing = sources.some((source) => clips.some((clip) => clip.sourceId === source.id) && !(source.assetId || source.productionPhotoId));
    if (missing) return Toast.warning('时间线上有素材尚未上传，无法用 FFmpeg 导出');
    setCloudBusy(true);
    try {
      let id = projectId;
      if (!id) id = await saveProject();
      else await saveProject();
      if (!id) return;
      const response = await startVideoRender(id, { aspectRatio, preset: 'veryfast', crf: 23 });
      setRenderJob(response.job);
      Toast.success('FFmpeg 导出任务已提交');
    } catch (error) { Toast.error(error.message || '提交导出失败'); }
    finally { setCloudBusy(false); }
  }, [clips, sources, uploadingCount, projectId, saveProject, aspectRatio]);

  const analyzeAllSources = React.useCallback(async () => {
    const candidates = sources.filter((source) => source.assetId && (!source.analysis || Number(source.analysis.version) < 2));
    if (!candidates.length) return Toast.info('可分析的素材已经完成全程语义理解');
    setAiBusy(true);
    let completed = 0;
    let failed = 0;
    try {
      for (const source of candidates) {
        setSources((items) => items.map((item) => item.id === source.id ? { ...item, analysisState: 'running', analysisError: '' } : item));
        try {
          const response = await analyzeVideoAsset(source.assetId);
          setSources((items) => items.map((item) => item.id === source.id ? { ...item, analysis: response.analysis, analysisState: 'done', analysisError: '' } : item));
          completed += 1;
        } catch (error) {
          failed += 1;
          setSources((items) => items.map((item) => item.id === source.id ? { ...item, analysisState: 'failed', analysisError: error.message || '全程分析失败' } : item));
        }
      }
      if (completed) Toast.success(`已完成 ${completed} 个素材的全程语义理解${failed ? `，${failed} 个待重试` : ''}`);
      else Toast.error('素材全程语义理解失败，请稍后重试');
    } catch (error) { Toast.error(error.message || '素材分析失败'); }
    finally { setAiBusy(false); }
  }, [sources]);

  const exportEditDecisionList = React.useCallback(() => {
    const payload = serializableProject({
      name: projectName,
      aspectRatio,
      sources,
      clips,
      audioClips,
      captions,
      productionProjects: sourceProjects,
      ai: { brief, targetDuration, style: editStyle },
    });
    payload.duration = projectDuration(clips);
    payload.clips = buildOffsets(clips).map((item, order) => ({ ...item.clip, order, timelineStart: item.start, timelineEnd: item.end }));
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${projectName || 'video-project'}-edit-list.json`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [projectName, aspectRatio, sources, clips, audioClips, captions, sourceProjects, brief, targetDuration, editStyle]);

  const applyAiRoughCut = React.useCallback(async (available, projectContexts = []) => {
    if (!available.length) return Toast.warning('所选素材没有可读取时长的视频');
    setAiBusy(true);
    try {
      const response = await requestRoughCut({
        projects: projectContexts.map((project) => ({
          id: projectIdentity(project),
          name: projectLabel(project),
          description: project.description || '',
          eventDate: project.eventDate || project.createdAt || '',
          tags: normalizeTags(project.tags),
        })),
        sources: available.map((source) => ({
          id: source.id,
          name: source.name,
          duration: source.duration,
          tags: source.tags || [],
          description: source.description || '',
          analysis: source.analysis || null,
          projectId: source.productionProjectId || '',
          projectName: source.productionProjectName || '',
          timelineSectionName: source.timelineSectionName || '',
          photographerName: source.photographerName || '',
          createdAt: source.createdAt || '',
          aiScore: source.aiScore,
          aiQuality: source.aiQuality,
        })),
        brief,
        targetDuration: Number(targetDuration) || 45,
        style: editStyle,
        aspectRatio,
      });
      const plan = response && response.plan;
      if (!plan || !Array.isArray(plan.clips)) throw new Error('粗剪方案格式不正确');
      const nextClips = plan.clips.map((item, index) => ({
        id: uid('clip'),
        sourceId: String(item.sourceId),
        assetId: (available.find((source) => source.id === String(item.sourceId)) || {}).assetId,
        inPoint: Number(item.start) || 0,
        outPoint: Number(item.end) || 0,
        speed: Number(item.speed) || 1,
        transition: item.transition || (index ? 'cut' : 'none'),
        reason: item.reason || '',
      })).filter((clip) => clip.outPoint > clip.inPoint && available.some((source) => source.id === clip.sourceId));
      if (!nextClips.length) throw new Error('模型没有生成可用片段');
      pushHistory();
      setClips(nextClips);
      setCaptions(Array.isArray(plan.captions) ? plan.captions : []);
      setSelectedClipId(nextClips[0].id);
      setPlayhead(0);
      setAiResult({ ...response, plan });
      Toast.success(response.provider === 'model' ? '大模型粗剪已应用到时间线' : '本地智能粗剪已应用到时间线');
      return true;
    } catch (error) {
      Toast.error(error.message || '生成粗剪失败');
      return false;
    } finally {
      setAiBusy(false);
    }
  }, [brief, targetDuration, editStyle, aspectRatio, pushHistory]);

  const runAiRoughCut = React.useCallback(async () => {
    const available = sources.filter((source) => source.duration > 0);
    if (!available.length) return Toast.warning('请先导入视频素材或选择生产项目');
    return applyAiRoughCut(available, sourceProjects);
  }, [sources, sourceProjects, applyAiRoughCut]);

  const importSelectedProductionProjects = React.useCallback(async (arrangeWithAi = true) => {
    const selectedProjects = productionProjects.filter((project) => selectedProductionProjectIds.includes(projectIdentity(project)));
    if (!selectedProjects.length) return Toast.warning('请至少选择一个生产项目');
    setProjectImportBusy(true);
    try {
      const results = await Promise.allSettled(selectedProjects.map(async (project) => ({
        project,
        media: await listProductionProjectMedia(projectIdentity(project)),
      })));
      const successful = results.filter((entry) => entry.status === 'fulfilled').map((entry) => entry.value);
      if (!successful.length) throw new Error('无法读取所选项目素材');
      const projectsWithVideos = successful.map(({ project, media }) => ({
        project,
        videos: media.filter(isProductionVideo),
      })).filter((entry) => entry.videos.length);
      const normalized = projectsWithVideos.flatMap(({ project, videos }) => (
        videos.map((item) => normalizeProductionVideo(item, project)).filter((source) => source.url)
      ));
      if (!normalized.length) throw new Error('所选项目中没有可播放的视频');
      const hydrated = await Promise.all(normalized.map(hydrateRemoteVideoMetadata));
      const combinedSources = sources.slice();
      hydrated.forEach((source) => {
        const existingIndex = combinedSources.findIndex((item) => item.id === source.id);
        if (existingIndex >= 0) combinedSources[existingIndex] = { ...combinedSources[existingIndex], ...source };
        else combinedSources.push(source);
      });
      const videoProjects = projectsWithVideos.map((entry) => entry.project);
      const nextSourceProjects = Array.from(new Map([...sourceProjects, ...videoProjects].map((project) => [projectIdentity(project), project])).values());
      setSources(combinedSources);
      setSourceProjects(nextSourceProjects);
      setSelectedSourceId(hydrated[0].id);
      setProjectPickerOpen(false);
      if (projectName === '未命名视频工程') setProjectName(`${videoProjects.map(projectLabel).join(' + ')} · AI 粗剪`);
      const readable = hydrated.filter((source) => source.duration > 0);
      const failedCount = results.length - successful.length;
      Toast.success(`已从 ${videoProjects.length} 个项目载入 ${hydrated.length} 个视频${failedCount ? `，${failedCount} 个项目读取失败` : ''}`);
      if (arrangeWithAi) {
        const localSources = combinedSources.filter((source) => source.origin !== 'production' && source.duration > 0);
        await applyAiRoughCut([...localSources, ...readable], videoProjects);
      }
    } catch (error) {
      Toast.error(error.message || '项目视频载入失败');
    } finally {
      setProjectImportBusy(false);
    }
  }, [productionProjects, selectedProductionProjectIds, sources, sourceProjects, projectName, applyAiRoughCut]);

  const timelineWidth = Math.max(900, (duration * zoom) + 90);
  const playheadLeft = duration > 0 ? playhead * zoom : 0;
  const aspectStyle = aspectRatio === '9:16' ? '9 / 16' : aspectRatio === '1:1' ? '1 / 1' : aspectRatio === '4:3' ? '4 / 3' : '16 / 9';
  const saveStatusText = uploadingCount > 0
    ? `素材上传中，完成后自动保存（${uploadingCount}）`
    : autoSaveStatus === 'pending'
      ? '有修改，等待自动保存…'
      : autoSaveStatus === 'saving'
        ? '正在自动保存…'
        : autoSaveStatus === 'error'
          ? '服务端保存失败，进度已保存在本机'
          : savedAt
            ? `已自动保存 ${new Date(savedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
            : '修改后自动保存';

  return (
    <div className="video-editor">
      <header className="ve-topbar">
        <div className="ve-project-heading">
          <span className="ve-app-mark">M</span>
          <div>
            <input value={projectName} onChange={(event) => setProjectName(event.target.value)} aria-label="工程名称" />
            <span className={`ve-save-status is-${autoSaveStatus}`}>{saveStatusText}</span>
          </div>
        </div>
        <div className="ve-top-actions">
          <button type="button" onClick={newProject}>新建工程</button>
          <select className="ve-project-select" value={projectId || ''} onChange={(event) => loadProject(event.target.value)} aria-label="载入云端工程">
            <option value="">当前工程</option>
            {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
          </select>
          <button type="button" onClick={undo} disabled={!history.length} title="撤销">↶</button>
          <button type="button" onClick={redo} disabled={!future.length} title="重做">↷</button>
          <button type="button" onClick={() => saveProject()} disabled={cloudBusy}>{cloudBusy ? '处理中…' : '立即保存'}</button>
          <button type="button" onClick={exportEditDecisionList}>导出剪辑单</button>
          <button type="button" className="is-export" onClick={startRender} disabled={cloudBusy || !clips.length || uploadingCount > 0 || hasUnrenderableClips} title={hasUnrenderableClips ? '时间线上仍有未同步素材' : '使用本地 FFmpeg 渲染 MP4'}>FFmpeg 导出</button>
          <button type="button" className="is-primary" onClick={runAiRoughCut} disabled={aiBusy || !sources.length}>
            {aiBusy ? 'AI 正在编排…' : 'AI 自动粗剪'}
          </button>
        </div>
      </header>

      <div className="ve-body">
        <aside className="ve-media-panel">
          <div className="ve-panel-head">
            <div><strong>媒体</strong><span>{sources.length} 个素材{uploadingCount ? ` · 上传中 ${uploadingCount}` : ''}</span></div>
            <span className="ve-panel-actions">
              <button type="button" className={projectPickerOpen ? 'is-active' : ''} onClick={() => setProjectPickerOpen((open) => !open)}>＋ 项目</button>
              <button type="button" onClick={() => fileInputRef.current && fileInputRef.current.click()}>＋ 本地</button>
            </span>
            <input ref={fileInputRef} type="file" accept="video/*,.mp4,.mov,.m4v,.webm" multiple hidden onChange={(event) => { importFiles(event.target.files); event.target.value = ''; }} />
          </div>
          {projectPickerOpen ? (
            <section className="ve-project-picker">
              <div className="ve-project-picker-title">
                <div><strong>选择生产项目</strong><small>只读取项目中的视频，不修改生产数据</small></div>
                <button type="button" onClick={loadProductionProjectOptions} disabled={productionProjectsBusy}>↻</button>
              </div>
              <input className="ve-project-search" value={projectSearch} onChange={(event) => setProjectSearch(event.target.value)} placeholder="搜索项目名称或标签" />
              <div className="ve-project-options">
                {productionProjectsBusy ? <p>正在读取生产项目…</p> : null}
                {productionProjectsError ? <p className="is-error">{productionProjectsError}</p> : null}
                {!productionProjectsBusy && !productionProjectsError && !visibleProductionProjects.length ? <p>没有匹配的项目</p> : null}
                {visibleProductionProjects.map((project) => {
                  const id = projectIdentity(project);
                  const checked = selectedProductionProjectIds.includes(id);
                  return (
                    <label key={id} className={checked ? 'is-selected' : ''}>
                      <input type="checkbox" checked={checked} onChange={() => setSelectedProductionProjectIds((ids) => checked ? ids.filter((item) => item !== id) : [...ids, id])} />
                      <span><strong>{projectLabel(project)}</strong><small>{project.eventDate || project.createdAt || '生产项目'}{project.photoCount != null ? ` · ${project.photoCount} 个媒体` : ''}</small></span>
                    </label>
                  );
                })}
              </div>
              <div className="ve-project-picker-actions">
                <span>已选 {selectedProductionProjectIds.length} 个项目</span>
                <button type="button" onClick={() => importSelectedProductionProjects(false)} disabled={projectImportBusy || !selectedProductionProjectIds.length}>仅载入</button>
                <button type="button" className="is-primary" onClick={() => importSelectedProductionProjects(true)} disabled={projectImportBusy || !selectedProductionProjectIds.length}>{projectImportBusy ? '载入中…' : '载入并 AI 编排'}</button>
              </div>
            </section>
          ) : null}
          <div className="ve-media-list">
            {!sources.length ? (
              <button className="ve-empty-import" type="button" onClick={() => setProjectPickerOpen(true)}>
                <span className="ve-empty-icon">＋</span>
                <strong>选择项目或导入本地视频</strong>
                <small>可多选生产项目交给 AI 编排；本地仍支持 MP4、MOV、WebM</small>
              </button>
            ) : sources.map((source) => (
              <button
                key={source.id}
                data-source-id={source.id}
                className={`ve-media-card${source.offline ? ' is-offline' : ''}${selectedSourceId === source.id ? ' is-selected' : ''}${draggedSourceId === source.id ? ' is-dragging' : ''}`}
                type="button"
                draggable={!source.offline && source.duration > 0}
                onClick={() => setSelectedSourceId(source.id)}
                onDoubleClick={() => addSourceToTimeline(source)}
                onDragStart={(event) => {
                  if (source.offline || !source.duration) return event.preventDefault();
                  event.dataTransfer.effectAllowed = 'copy';
                  event.dataTransfer.setData('application/x-mamage-video-source', source.id);
                  event.dataTransfer.setData('text/plain', `source:${source.id}`);
                  setSelectedSourceId(source.id);
                  setDraggedSourceId(source.id);
                }}
                onDragEnd={clearTimelineDrag}
                title={source.offline || !source.duration ? '素材当前不可用' : '单击选择，双击或拖到 V1 加入时间线'}
              >
                <span className="ve-media-thumb">
                  {source.url ? <video src={source.url} muted preload="metadata" /> : <span>VIDEO</span>}
                  <i>{formatTime(source.duration)}</i>
                </span>
                <span className="ve-media-meta">
                  <strong>{source.name}</strong>
                  {source.origin === 'production' ? <em>生产项目 · {source.productionProjectName}</em> : <em>本地上传</em>}
                  <small>{source.offline ? '素材离线' : source.analysisState === 'running' ? '正在理解全片时间线…' : source.analysisState === 'failed' ? (source.analysisError || '全程分析失败') : source.analysis ? `${source.width || '-'}×${source.height || '-'} · ${source.analysis.coverage ? `全片 ${source.analysis.coverage.segmentCount || 0} 段 · ` : ''}${source.analysis.summary}` : '双击添加'}</small>
                </span>
              </button>
            ))}
          </div>
        </aside>

        <main className="ve-stage-column">
          <section className="ve-preview-shell">
            <div className="ve-preview" style={{ aspectRatio: aspectStyle }}>
              {activeIsBlank ? (
                <div className="ve-preview-blank" aria-label="留白黑场" />
              ) : activeSource && activeSource.url ? (
                <video
                  ref={videoRef}
                  src={activeSource.url}
                  onTimeUpdate={handleVideoTimeUpdate}
                  onLoadedMetadata={(event) => {
                    if (activeInfo) event.currentTarget.currentTime = activeInfo.clip.inPoint + ((playhead - activeInfo.start) * (activeInfo.clip.speed || 1));
                  }}
                  playsInline
                />
              ) : (
                <div className="ve-preview-empty">
                  <span>▶</span>
                  <strong>{activeSource && activeSource.offline ? '素材当前离线' : '预览监视器'}</strong>
                  <small>{activeSource && activeSource.offline ? '重新导入同名文件即可恢复' : '导入素材并添加到时间线后开始剪辑'}</small>
                </div>
              )}
              {currentCaption ? <div className="ve-preview-caption">{currentCaption.text}</div> : null}
              {!activeIsBlank ? <div className="ve-preview-safe" /> : null}
            </div>
            <div className="ve-transport">
              <button type="button" onClick={() => seekTo(0)} aria-label="回到开头">|◀</button>
              <button type="button" className="is-play" onClick={() => setIsPlaying((value) => !value)} disabled={!clips.length}>{isPlaying ? '❚❚' : '▶'}</button>
              <button type="button" onClick={() => seekTo(duration)} aria-label="到结尾">▶|</button>
              <span className="ve-timecode">{formatTime(playhead, true)} <i>/</i> {formatTime(duration, true)}</span>
              <div className="ve-aspect-switch">
                {['16:9', '9:16', '1:1'].map((ratio) => <button key={ratio} className={aspectRatio === ratio ? 'is-active' : ''} type="button" onClick={() => setAspectRatio(ratio)}>{ratio}</button>)}
              </div>
            </div>
          </section>

          <section className="ve-timeline-shell">
            <div className="ve-timeline-toolbar">
              <div>
                <button type="button" onClick={splitAtPlayhead} disabled={!selectedClip}>✂ 分割</button>
                <button type="button" onClick={duplicateSelectedClip} disabled={!selectedClip}>▣ 复制</button>
                <button type="button" onClick={deleteSelectedClip} disabled={!selectedClip} className="is-danger">⌫ 删除</button>
                <button type="button" onClick={addBlankClip}>＋ 留白</button>
                <button type="button" onClick={addSelectedSourceAsAudio} disabled={!selectedSourceId}>＋ 音频轨</button>
              </div>
              <label>时间线缩放 <input type="range" min="5" max="48" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} /></label>
            </div>
            <div className="ve-timeline-scroll">
              <div className="ve-timeline" style={{ width: timelineWidth }} onClick={(event) => {
                if (event.target.closest('.ve-clip')) return;
                const videoTrack = event.currentTarget.querySelector('.ve-video-track');
                const trackRect = videoTrack ? videoTrack.getBoundingClientRect() : event.currentTarget.getBoundingClientRect();
                seekTo((event.clientX - trackRect.left) / zoom);
              }}>
                <div className="ve-ruler">
                  {Array.from({ length: Math.max(2, Math.ceil(duration / 5) + 1) }, (_, index) => (
                    <span key={index} style={{ left: index * 5 * zoom }}>{formatTime(index * 5)}</span>
                  ))}
                </div>
                <div className="ve-track-label">V1 <small>主视频</small></div>
                <div
                  className={`ve-video-track${timelineDropIndex !== null ? ' is-drag-over' : ''}`}
                  role="group"
                  aria-label="V1 主视频轨道"
                  onDragOver={handleTimelineDragOver}
                  onDrop={handleTimelineDrop}
                  onDragLeave={(event) => {
                    if (!event.currentTarget.contains(event.relatedTarget)) setTimelineDropIndex(null);
                  }}
                >
                  {!offsets.length ? <span className="ve-track-drop-hint">将左侧素材拖到这里</span> : null}
                  {timelineDropIndex !== null ? (
                    <span
                      className="ve-drop-marker"
                      style={{ left: ((timelineDropIndex >= offsets.length ? duration : (offsets[timelineDropIndex] || {}).start) || 0) * zoom }}
                    />
                  ) : null}
                  {offsets.map((item, index) => {
                    const source = sources.find((entry) => entry.id === item.clip.sourceId);
                    const blank = isBlankClip(item.clip);
                    const clipName = blank ? '留白' : (source ? source.name : '缺失素材');
                    return (
                      <div
                        key={item.clip.id}
                        role="button"
                        tabIndex={0}
                        aria-label={`${clipName}，${formatTime(item.clip.inPoint)} 到 ${formatTime(item.clip.outPoint)}`}
                        data-clip-id={item.clip.id}
                        draggable={trimmingClipId !== item.clip.id}
                        className={`ve-clip${blank ? ' is-blank' : ''}${activeInfo && activeInfo.clip.id === item.clip.id ? ' is-active' : ''}${selectedClipId === item.clip.id ? ' is-selected' : ''}${draggedClipId === item.clip.id ? ' is-dragging' : ''}${trimmingClipId === item.clip.id ? ' is-trimming' : ''}`}
                        style={{ width: item.duration * zoom, marginLeft: index ? -(item.overlap || 0) * zoom : 0 }}
                        onClick={(event) => {
                          event.stopPropagation();
                          const rect = event.currentTarget.getBoundingClientRect();
                          const localTime = clamp((event.clientX - rect.left) / zoom, 0, item.duration);
                          setSelectedClipId(item.clip.id);
                          seekTo(item.start + localTime);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            setSelectedClipId(item.clip.id);
                            seekTo(item.start);
                          }
                        }}
                        onDragStart={(event) => {
                          event.dataTransfer.effectAllowed = 'move';
                          event.dataTransfer.setData('application/x-mamage-video-clip', item.clip.id);
                          event.dataTransfer.setData('text/plain', `clip:${item.clip.id}`);
                          setSelectedClipId(item.clip.id);
                          setDraggedClipId(item.clip.id);
                        }}
                        onDragEnd={clearTimelineDrag}
                      >
                        <span
                          className="ve-clip-trim-handle is-left"
                          role="separator"
                          aria-label={`调整 ${clipName} 左边缘`}
                          title="拖拽调整入点"
                          onPointerDown={(event) => startClipTrim(event, item, 'left')}
                          onClick={(event) => { event.preventDefault(); event.stopPropagation(); }}
                        />
                        <span className="ve-clip-strip" />
                        <button type="button" className="ve-clip-delete" aria-label={`删除片段 ${clipName}`} title="删除片段" onClick={(event) => { event.stopPropagation(); deleteClip(item.clip.id); }}>×</button>
                        <strong>{clipName}</strong>
                        <small>{blank ? `黑场 · ${item.duration.toFixed(1)} 秒` : `${formatTime(item.clip.inPoint)} → ${formatTime(item.clip.outPoint)} · ${item.clip.speed || 1}×`}</small>
                        {item.clip.transition && item.clip.transition !== 'none' ? <i>{item.clip.transition}</i> : null}
                        <span
                          className="ve-clip-trim-handle is-right"
                          role="separator"
                          aria-label={`调整 ${clipName} 右边缘`}
                          title={blank ? '拖拽调整留白时长（无上限）' : '拖拽调整出点（不超过素材时长）'}
                          onPointerDown={(event) => startClipTrim(event, item, 'right')}
                          onClick={(event) => { event.preventDefault(); event.stopPropagation(); }}
                        />
                      </div>
                    );
                  })}
                </div>
                <div className="ve-track-label is-audio">A1 <small>背景音频</small></div>
                <div className="ve-audio-track">
                  {audioClips.map((audio) => {
                    const source = sources.find((entry) => entry.id === audio.sourceId);
                    const audioDuration = Math.max(0.1, Number(audio.outPoint) - Number(audio.inPoint));
                    return <button key={audio.id} type="button" style={{ left: Number(audio.timelineStart || 0) * zoom, width: Math.max(80, audioDuration * zoom) }} onClick={() => { pushHistory(); setAudioClips((items) => items.filter((item) => item.id !== audio.id)); }} title="点击删除音频片段">♫ {source ? source.name : '音频'} · {Math.round((audio.volume || 0.35) * 100)}%</button>;
                  })}
                </div>
                <div className="ve-track-label is-caption">T1 <small>字幕</small></div>
                <div className="ve-caption-track">
                  {captions.map((caption, index) => (
                    <button type="button" key={caption.id || `${caption.at}-${index}`} style={{ left: Number(caption.at || 0) * zoom, width: Math.max(72, String(caption.text || '').length * 10) }} onClick={() => { pushHistory(); setCaptions((items) => items.filter((_, itemIndex) => itemIndex !== index)); }} title="点击删除字幕">{caption.text}</button>
                  ))}
                </div>
                <div className="ve-playhead" style={{ left: playheadLeft }}><i /></div>
              </div>
            </div>
          </section>
        </main>

        <aside className="ve-inspector">
          <section className="ve-ai-card">
            <div className="ve-ai-title"><span>✦</span><div><strong>AI 导演</strong><small>自动编排与粗剪</small></div></div>
            {sourceProjects.length ? <div className="ve-ai-project-context"><span>项目上下文</span><strong>{sourceProjects.map(projectLabel).join('、')}</strong><small>AI 会结合项目名称、时间、标签和视频元数据进行跨项目编排</small></div> : null}
            <button type="button" className="ve-analysis-run" onClick={analyzeAllSources} disabled={aiBusy || !sources.some((source) => source.assetId)}>{aiBusy ? '正在理解全片…' : '全程语义理解'}</button>
            <div className="ve-caption-entry"><input value={captionDraft} onChange={(event) => setCaptionDraft(event.target.value)} placeholder={`在 ${formatTime(playhead)} 添加字幕`} /><button type="button" onClick={addCaptionAtPlayhead}>＋ 字幕</button></div>
            <label>剪辑目标<textarea rows="5" value={brief} onChange={(event) => setBrief(event.target.value)} /></label>
            <div className="ve-field-row">
              <label>目标时长<input type="number" min="5" max="600" value={targetDuration} onChange={(event) => setTargetDuration(event.target.value)} /><span>秒</span></label>
            </div>
            <div className="ve-style-grid">
              {STYLE_OPTIONS.map((option) => <button key={option.key} type="button" className={editStyle === option.key ? 'is-active' : ''} onClick={() => setEditStyle(option.key)}>{option.label}</button>)}
            </div>
            <button type="button" className="ve-ai-run" onClick={runAiRoughCut} disabled={aiBusy || !sources.length}>{aiBusy ? '正在分析素材与编排…' : '生成并应用粗剪'}</button>
            {aiResult ? (
              <div className="ve-ai-result">
                <strong>{aiResult.plan.title}</strong>
                <p>{aiResult.plan.summary || '粗剪方案已写入时间线。'}</p>
                <span>{aiResult.provider === 'model' ? `模型：${aiResult.model}` : '本地智能兜底'} · {aiResult.plan.clips.length} 个片段</span>
              </div>
            ) : null}
          </section>

          <section className="ve-properties">
            <div className="ve-properties-head"><strong>片段属性</strong><span>{selectedClip ? `#${clips.findIndex((clip) => clip.id === selectedClip.id) + 1}` : '未选择'}</span></div>
            {selectedClip ? (
              isBlankClip(selectedClip) ? (
                <>
                  <label>留白时长 <input type="number" min="0.1" step="0.1" value={clipDuration(selectedClip).toFixed(1)} onChange={(event) => updateSelectedClip({ inPoint: 0, outPoint: Math.max(0.1, Number(event.target.value) || 0.1), speed: 1, volume: 0 })} /></label>
                  <label>转场 <select value={selectedClip.transition || 'cut'} onChange={(event) => updateSelectedClip({ transition: event.target.value })}><option value="none">无</option><option value="cut">硬切</option><option value="dissolve">叠化</option><option value="fade">淡入淡出</option><option value="flash">闪白</option></select></label>
                  <div className="ve-trim-range"><span>画面内容</span><strong>纯黑</strong></div>
                  <div className="ve-ai-reason"><span>留白片段</span>播放和导出时保持纯黑画面、静音，可拖拽调整位置。</div>
                </>
              ) : (
                <>
                  <label>入点 <input type="number" min="0" step="0.1" value={Number(selectedClip.inPoint).toFixed(1)} onChange={(event) => updateSelectedClip({ inPoint: Number(event.target.value) })} /></label>
                  <label>出点 <input type="number" min="0.1" step="0.1" value={Number(selectedClip.outPoint).toFixed(1)} onChange={(event) => updateSelectedClip({ outPoint: Number(event.target.value) })} /></label>
                  <label>速度 <select value={selectedClip.speed || 1} onChange={(event) => updateSelectedClip({ speed: Number(event.target.value) })}><option value="0.5">0.5×</option><option value="0.75">0.75×</option><option value="1">1×</option><option value="1.25">1.25×</option><option value="1.5">1.5×</option><option value="2">2×</option></select></label>
                  <label>原声音量 <input type="range" min="0" max="2" step="0.05" value={selectedClip.volume === undefined ? 1 : selectedClip.volume} onChange={(event) => updateSelectedClip({ volume: Number(event.target.value) })} /></label>
                  <label>转场 <select value={selectedClip.transition || 'cut'} onChange={(event) => updateSelectedClip({ transition: event.target.value })}><option value="none">无</option><option value="cut">硬切</option><option value="dissolve">叠化</option><option value="fade">淡入淡出</option><option value="flash">闪白</option></select></label>
                  <div className="ve-trim-range"><span>片段长度</span><strong>{clipDuration(selectedClip).toFixed(1)} 秒</strong></div>
                  {selectedClip.reason ? <div className="ve-ai-reason"><span>AI 选用理由</span>{selectedClip.reason}</div> : null}
                </>
              )
            ) : <div className="ve-properties-empty">在时间线上选择一个片段，可调整入点、出点、速度和转场。</div>}
          </section>

          {renderJob ? <section className="ve-render-card">
            <div><strong>导出任务</strong><span>{renderJob.stage || renderJob.status}</span></div>
            <progress max="100" value={renderJob.progress || 0} />
            <small>{renderJob.progress || 0}% · {renderJob.status}</small>
            {renderJob.outputUrl ? <a href={renderJob.outputUrl} download>下载 MP4</a> : null}
            {['queued', 'running'].includes(renderJob.status) ? <button type="button" onClick={async () => { await cancelVideoRender(renderJob.id); setRenderJob({ ...renderJob, status: 'canceled', stage: '已取消' }); }}>取消导出</button> : null}
            {renderJob.error ? <p>{renderJob.error}</p> : null}
          </section> : null}
        </aside>
      </div>
    </div>
  );
}

export default VideoEditor;
