// src/ProjectDetail.jsx
import React from 'react';
import { Typography, Button, Tag, Spin, Empty, Modal, Input, DatePicker, DateTimePicker, TextArea, Toast, HexLoader } from './ui';
import {
  IconAIStrokedLevel1,
  IconClose,
  IconEditStroked,
  IconInfoEdit,
  IconMasonryView,
  IconSimilarStack,
  IconSparkleAI,
  IconTimelineFlow,
  IconGridView,
  IconListView,
  IconMoreStroked,
  IconPlus,
  IconSearch,
  IconTrash,
  IconDownload,
  IconSliders,
  IconFaceScan,
  IconStar,
  IconChevronLeft,
  IconChevronRight,
  IconGroupRescue,
} from './ui/icons';
import './ProjectDetail.css';
import { getProjectById, updateProject, deleteProject, createTimelineSection, updateTimelineSection, deleteTimelineSection, reorderTimelineSections } from './services/projectService';
import { getToken } from './services/authService';
import { fetchRandomByProject, searchPhotos, getPhotoById, updatePhoto, assignPhotosTimelineSection, getFacePersonInfo, labelFacePerson, renameFacePerson, uploadPhotoFiles, warmUploadApiProbe, deletePhotos, getPhotoFaces, getUploadFileLimitError, runGroupRescueJob, isBrowserUndisplayableImage, undisplayableFormatLabel } from './services/photoService';
import { resolveAssetUrl, BASE_URL } from './services/request';
import IfCan from './permissions/IfCan';
import PermButton from './permissions/PermButton';
import { canAny, getPermissions } from './permissions/permissionStore';
import {
  DEFAULT_PHOTO_ADJUSTMENTS,
  analyzePhotoTone,
  buildPhotoAdjustments,
  getPhotoAdjustmentStyle,
  isDefaultPhotoAdjustments,
  normalizePhotoAdjustments,
  renderPhotoAdjustmentsToCanvas,
} from './utils/photoAdjustments';
import { sectionTimeToInputValue, inputValueToSectionTime } from './utils/sectionTime';
import {
  createInitialUploadProgress,
  formatUploadBytes,
  formatUploadRemainingTime,
  getUploadFileKey,
  getUploadPhaseLabel,
  getUploadProgressTitle,
  reduceUploadProgress,
} from './utils/uploadProgress';

const { Title, Text } = Typography;
const ANALYSIS_POLL_INITIAL_DELAY_MS = 900;
const ANALYSIS_POLL_INTERVAL_MS = 1800;
const ANALYSIS_POLL_MAX_ATTEMPTS = 45;
const VIDEO_PLAYBACK_POLL_INITIAL_DELAY_MS = 2500;
const VIDEO_PLAYBACK_POLL_INTERVAL_MS = 4000;
// 转码队列并发=1，多个视频排队时单个可能等很久：给足 ~30 分钟
const VIDEO_PLAYBACK_POLL_MAX_ATTEMPTS = 450;
const AI_QUALITY_TAGS = ['AI recommended', 'AI medium', 'AI rejected'];
const ACTIVE_ANALYSIS_STATUSES = new Set(['pending', 'queued', 'running', 'processing']);
const GALLERY_INITIAL_RENDER_LIMIT = 96;
const GALLERY_RENDER_BATCH_SIZE = 96;
const PROJECT_DETAIL_TIMEOUT_MS = 12000;

function getAISelectionLabel(label) {
  if (label === 'recommended') return 'AI推荐';
  if (label === 'medium') return 'AI中等';
  if (label === 'rejected') return 'AI不推荐';
  return '';
}

function getAISelectionColor(label) {
  if (label === 'recommended') return '#16a34a';
  if (label === 'medium') return '#f59e0b';
  if (label === 'rejected') return '#dc2626';
  return '#64748b';
}

// AI 选片 2.0：0-100 综合分与质量详情（dims/flags/reason）随照片元数据下发
function getPhotoAiScore(meta) {
  const v = meta && (meta.aiScore !== undefined && meta.aiScore !== null ? meta.aiScore : meta.ai_score);
  // NULL/undefined/'' 必须返回 null——Number(null)=0 会把未评分照片伪装成 0 分
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function getPhotoAiQuality(meta) {
  const raw = meta && (meta.aiQuality || meta.ai_quality);
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw); } catch (e) { return null; }
}

function formatAiQualityTooltip(quality, score) {
  if (!quality) return '';
  const parts = [];
  if (score !== null) parts.push(`综合 ${score} 分`);
  const d = quality.dims || {};
  const dimText = [
    d.sharpness !== undefined ? `锐度${d.sharpness}` : null,
    d.exposure !== undefined ? `曝光${d.exposure}` : null,
    d.composition !== undefined ? `构图${d.composition}` : null,
    d.subject !== undefined ? `主体${d.subject}` : null,
    d.moment !== undefined ? `瞬间${d.moment}` : null,
    d.aesthetics !== undefined ? `美感${d.aesthetics}` : null,
  ].filter(Boolean).join(' · ');
  if (dimText) parts.push(dimText);
  if (Array.isArray(quality.flags) && quality.flags.length) parts.push(`缺陷：${quality.flags.join('、')}`);
  if (quality.reason) parts.push(quality.reason);
  return parts.join('\n');
}

function getAISelectionChipClass(label) {
  if (label === 'recommended') return 'viewer-chip--good';
  if (label === 'medium') return 'viewer-chip--medium';
  if (label === 'rejected') return 'viewer-chip--bad';
  return '';
}

function getToneAdjustmentKey(adjustments) {
  const a = normalizePhotoAdjustments(adjustments);
  return [
    a.brightness,
    a.contrast,
    a.highlights,
    a.shadows,
    a.whites,
    a.blacks,
    a.temperature,
    a.tint,
    ...(Array.isArray(a.wbGains) ? a.wbGains : []),
  ].map((value) => Math.round(Number(value || 0) * 1000) / 1000).join('|');
}

const RENDERED_TONE_THUMB_CACHE_LIMIT = 120;
const renderedToneThumbBlobCache = new Map();

function rememberRenderedToneThumb(key, promise) {
  if (!key) return promise;
  if (renderedToneThumbBlobCache.size >= RENDERED_TONE_THUMB_CACHE_LIMIT) {
    const firstKey = renderedToneThumbBlobCache.keys().next().value;
    if (firstKey) renderedToneThumbBlobCache.delete(firstKey);
  }
  renderedToneThumbBlobCache.set(key, promise);
  return promise;
}

async function requestRenderedToneBlob(photoId, adjustments, options = {}) {
  if (!photoId) return null;
  const token = getToken();
  const variant = options.variant || 'original';
  const maxSize = options.maxSize || 4096;
  const format = options.format || 'jpeg';
  const quality = options.quality || 96;
  const cacheKey = options.cache
    ? [
      token ? token.slice(-16) : '',
      photoId,
      variant,
      maxSize,
      format,
      quality,
      getToneAdjustmentKey(adjustments),
    ].join('|')
    : '';
  if (cacheKey && renderedToneThumbBlobCache.has(cacheKey)) {
    return renderedToneThumbBlobCache.get(cacheKey);
  }

  const renderUrl = `${BASE_URL || ''}/api/photos/${encodeURIComponent(String(photoId))}/rendered`;
  const loadPromise = fetch(renderUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    credentials: 'same-origin',
    signal: options.cache ? undefined : options.signal,
    body: JSON.stringify({
      adjustments,
      variant,
      maxSize,
      format,
      quality,
    }),
  }).then((response) => {
    if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? '无权渲染照片' : '无法渲染照片');
    return response.blob();
  }).catch((err) => {
    if (cacheKey) renderedToneThumbBlobCache.delete(cacheKey);
    throw err;
  });

  return cacheKey ? rememberRenderedToneThumb(cacheKey, loadPromise) : loadPromise;
}

function ViewerToneImage({
  src,
  photoId,
  adjustments,
  exact,
  maxSize = 1600,
  pixelVariant = 'thumb',
  hiddenImageInteractive = false,
  alt,
  className,
  style,
  onLoad,
  ...imgProps
}) {
  const canvasRef = React.useRef(null);
  const normalized = React.useMemo(() => normalizePhotoAdjustments(adjustments), [adjustments]);
  const adjustmentKey = React.useMemo(() => getToneAdjustmentKey(normalized), [normalized]);
  const shouldRenderCanvas = Boolean(exact && src && !isDefaultPhotoAdjustments(normalized));
  const [canvasReady, setCanvasReady] = React.useState(false);
  const [renderedSrc, setRenderedSrc] = React.useState('');
  const normalizedRef = React.useRef(normalized);
  const onLoadRef = React.useRef(onLoad);

  React.useEffect(() => {
    normalizedRef.current = normalized;
  }, [adjustmentKey, normalized]);

  React.useEffect(() => {
    onLoadRef.current = onLoad;
  }, [onLoad]);

  React.useEffect(() => {
    if (!shouldRenderCanvas) {
      setCanvasReady(false);
      setRenderedSrc('');
      return undefined;
    }
    let cancelled = false;
    let objectUrl = '';
    const abortController = typeof AbortController !== 'undefined' ? new AbortController() : null;
    setCanvasReady(false);
    setRenderedSrc('');
    const timer = window.setTimeout(async () => {
      try {
        if (photoId) {
          const blob = await requestRenderedToneBlob(photoId, normalizedRef.current, {
            variant: pixelVariant,
            maxSize,
            format: pixelVariant === 'thumb' ? 'webp' : 'jpeg',
            quality: pixelVariant === 'thumb' ? 92 : 96,
            cache: pixelVariant === 'thumb',
            signal: abortController ? abortController.signal : undefined,
          });
          if (cancelled) return;
          objectUrl = URL.createObjectURL(blob);
          setRenderedSrc(objectUrl);
          setCanvasReady(true);
          return;
        }
        const renderSrc = src;
        const result = await renderPhotoAdjustmentsToCanvas(canvasRef.current, renderSrc, normalizedRef.current, { maxSize });
        if (cancelled) return;
        setCanvasReady(true);
        if (typeof onLoadRef.current === 'function') {
          onLoadRef.current({ target: { naturalWidth: result.naturalWidth, naturalHeight: result.naturalHeight } });
        }
      } catch (err) {
        if (!cancelled) setCanvasReady(false);
      }
    }, 80);

    return () => {
      cancelled = true;
      if (abortController) abortController.abort();
      window.clearTimeout(timer);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [adjustmentKey, maxSize, photoId, pixelVariant, shouldRenderCanvas, src]);

  const fallbackStyle = shouldRenderCanvas && canvasReady
    ? { ...(style || {}), position: 'absolute', inset: 0, opacity: 0, pointerEvents: hiddenImageInteractive ? undefined : 'none' }
    : style;
  const canvasStyle = { ...(style || {}) };
  delete canvasStyle.filter;
  delete canvasStyle.opacity;
  canvasStyle.display = canvasReady ? 'block' : 'none';

  return (
    <>
      {shouldRenderCanvas && renderedSrc ? (
        <img
          src={renderedSrc}
          alt=""
          className={`${className || ''} viewer-adjusted-render`}
          style={canvasStyle}
          aria-hidden="true"
          onLoad={onLoad}
        />
      ) : null}
      {shouldRenderCanvas && !renderedSrc ? (
        <canvas
          ref={canvasRef}
          className={`${className || ''} viewer-adjusted-canvas`}
          style={canvasStyle}
          aria-hidden="true"
        />
      ) : null}
      <img
        src={src}
        alt={alt}
        className={className}
        style={fallbackStyle}
        onLoad={shouldRenderCanvas && canvasReady ? undefined : onLoad}
        {...imgProps}
      />
    </>
  );
}

function safeParseTags(tags) {
  try {
    if (Array.isArray(tags)) return tags;
    if (typeof tags === 'string') return JSON.parse(tags || '[]');
    return [];
  } catch (e) {
    console.warn('Failed to parse tags:', tags, e);
    return [];
  }
}

function isVideoUrl(url) {
  try {
    const pathname = new URL(String(url || ''), window.location.origin).pathname;
    return /\.(mp4|m4v|mov|webm|ogv|ogg)$/i.test(pathname);
  } catch (e) {
    return /\.(mp4|m4v|mov|webm|ogv|ogg)(?:[?#].*)?$/i.test(String(url || ''));
  }
}

function isImageUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) return false;
  if (/^data:image\//i.test(raw)) return true;
  try {
    const pathname = new URL(raw, window.location.origin).pathname;
    return /\.(jpe?g|png|webp|gif|avif|heic|heif)$/i.test(pathname);
  } catch (e) {
    return /\.(jpe?g|png|webp|gif|avif|heic|heif)(?:[?#].*)?$/i.test(raw);
  }
}

function getMediaTypeFromItem(item) {
  if (!item) return 'image';
  if (typeof item === 'string') return isVideoUrl(item) ? 'video' : 'image';
  const raw = String(item.mediaType || item.media_type || item.kind || item.fileType || '').toLowerCase();
  if (raw.startsWith('video')) return 'video';
  const type = String(item.type || '').toLowerCase();
  if (type.startsWith('video/')) return 'video';
  if (type === 'video') return 'video';
  const mime = String(item.mimeType || item.mime_type || item.contentType || item.content_type || '').toLowerCase();
  if (mime.startsWith('video/')) return 'video';
  const url = item.url || item.originalSrc || item.originalUrl || item.src || item.fileUrl || item.thumbUrl || item.thumbSrc || '';
  return isVideoUrl(url) ? 'video' : 'image';
}

function isVideoMeta(meta) {
  return getMediaTypeFromItem(meta) === 'video';
}

function getVideoUploadState(meta) {
  if (!meta || typeof meta !== 'object') return '';
  const raw = String(meta.uploadState || meta.upload_state || meta.processingStatus || meta.processing_status || '').toLowerCase();
  if (raw === 'failed' || raw === 'error') return 'failed';
  if (raw === 'video-processing' || raw === 'transcoding' || raw === 'processing' || raw === 'queued') return 'processing';
  // 无显式状态时不能把"视频且无 playback"判为 processing——
  // 存量视频没有 playback_url 时应回退播放原始文件，否则永久卡在"转码中"。
  return '';
}

function isVideoUploadPlaceholder(meta) {
  return Boolean(meta && meta.uploadPlaceholder && getMediaTypeFromItem(meta) === 'video');
}

function getPhotoThumbCandidate(item) {
  if (!item) return '';
  if (typeof item === 'string') return item;
  if (getMediaTypeFromItem(item) === 'video') return item.thumbSrc || item.thumbUrl || item.posterUrl || item.poster || item.thumbnail || item.url || item.originalSrc || item.originalUrl || item.src || item.fileUrl || '';
  return item.thumbSrc || item.thumbUrl || item.thumbnail || item.thumb || item.url || item.imageUrl || item.src || item.fileUrl || item.originalSrc || item.originalUrl || item.original || item.full || item.large || '';
}

function getPhotoOriginalCandidate(item) {
  if (!item) return '';
  if (typeof item === 'string') return item;
  return item.originalSrc || item.originalUrl || item.original || item.full || item.large || item.url || item.imageUrl || item.src || item.fileUrl || item.thumbSrc || item.thumbUrl || item.thumbnail || item.thumb || '';
}

function getVideoPlaybackCandidate(item) {
  if (!item || typeof item !== 'object') return '';
  return item.playbackSrc || item.playbackUrl || item.playback_url || item.playback || item.webPlaybackUrl || item.web_playback_url || '';
}

function getPhotoRecordId(item) {
  if (!item || typeof item !== 'object') return null;
  if (item.uploadPlaceholder) return null;
  const raw = item.id || item.photoId || item.photo_id || item.imageId || item.image_id || null;
  if (raw === null || raw === undefined) return null;
  const sid = String(raw).trim();
  return sid || null;
}

function normalizeTimelineSectionsForClient(input) {
  if (!input) return [];
  let list = input;
  if (typeof input === 'string') {
    try {
      list = JSON.parse(input);
    } catch (e) {
      list = input.split(/\r?\n/).map((name) => ({ name }));
    }
  }
  if (!Array.isArray(list)) return [];
  return list
    .map((section, idx) => {
      if (typeof section === 'string') {
        return {
          id: '',
          key: `name:${section}`,
          name: section.trim(),
          sectionTime: '',
          sortOrder: idx,
        };
      }
      const rawId = section?.id ?? section?.sectionId ?? section?.timelineSectionId ?? '';
      const id = rawId === null || rawId === undefined ? '' : String(rawId).trim();
      const name = String(section?.name || section?.title || section?.label || '').trim();
      const sectionTime = String(section?.sectionTime || section?.section_time || section?.time || '').trim();
      const sortOrder = Number.isFinite(Number(section?.sortOrder ?? section?.sort_order))
        ? Number(section?.sortOrder ?? section?.sort_order)
        : idx;
      return {
        id,
        key: id || `name:${name}:${idx}`,
        name,
        sectionTime,
        sortOrder,
      };
    })
    .filter((section) => section.name)
    .sort((a, b) => (a.sortOrder - b.sortOrder) || String(a.name).localeCompare(String(b.name), 'zh-Hans-CN'));
}

function getPhotoTimelineSectionId(meta) {
  if (!meta || typeof meta !== 'object') return '';
  const raw = meta.timelineSectionId ?? meta.timeline_section_id ?? meta.sectionId ?? meta.section_id ?? '';
  if (raw === null || raw === undefined) return '';
  return String(raw).trim();
}

function getPhotoTimelineSectionLabel(meta, sections) {
  if (!meta || typeof meta !== 'object') return '';
  const direct = String(meta.timelineSectionName || meta.timeline_section_name || meta.sectionName || '').trim();
  if (direct) return direct;
  const sectionId = getPhotoTimelineSectionId(meta);
  if (!sectionId) return '';
  const found = (Array.isArray(sections) ? sections : []).find((section) => String(section.id || '') === sectionId);
  return found ? found.name : '';
}

function HistogramView({ histogram }) {
  const bins = Array.isArray(histogram) && histogram.length ? histogram : Array(256).fill(0);
  const max = Math.max(1, ...bins);
  const points = bins.map((value, idx) => {
    const x = (idx / 255) * 100;
    const y = 100 - (Math.sqrt(value / max) * 92);
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(' ');
  const areaPoints = `0,100 ${points} 100,100`;
  return (
    <svg className="tone-histogram-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      <polygon points={areaPoints} />
      <polyline points={points} />
    </svg>
  );
}

function hasPhotoAdjustment(adjustments) {
  return !isDefaultPhotoAdjustments(adjustments);
}

function extractPhotoSemantic(photo) {
  const allTags = safeParseTags(photo && photo.tags);
  let aiLabel = null;
  if (allTags.includes('AI recommended')) aiLabel = 'recommended';
  else if (allTags.includes('AI medium')) aiLabel = 'medium';
  else if (allTags.includes('AI rejected')) aiLabel = 'rejected';
  const tags = allTags.filter((tag) => !AI_QUALITY_TAGS.includes(tag));
  const description = String((photo && (photo.description || photo.desc)) || '').trim();
  const aiStatus = normalizePhotoAiStatus(photo && (
    photo.aiStatus
    || photo.ai_status
    || photo.analysisStatus
    || photo.analysis_status
    || photo.semanticStatus
    || photo.semantic_status
  ));
  return {
    tags,
    description,
    aiLabel,
    aiStatus,
    analysisPending: ACTIVE_ANALYSIS_STATUSES.has(aiStatus),
    analysisFailed: aiStatus === 'failed',
    hasAnalysis: Boolean(description || tags.length)
  };
}

function normalizePhotoAiStatus(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  if (raw === 'queued' || raw === 'pending') return 'pending';
  if (raw === 'processing' || raw === 'running') return 'running';
  if (raw === 'succeeded' || raw === 'success' || raw === 'complete' || raw === 'completed') return 'done';
  if (raw === 'error') return 'failed';
  return raw;
}

function normalizePhotoForGallery(photo) {
  if (!photo || typeof photo !== 'object') return null;
  const id = getPhotoRecordId(photo);
  const thumbSrc = resolveAssetUrl(getPhotoThumbCandidate(photo));
  const originalSrc = resolveAssetUrl(getPhotoOriginalCandidate(photo));
  const playbackSrc = resolveAssetUrl(getVideoPlaybackCandidate(photo));
  const src = thumbSrc || originalSrc;
  if (!id || !src) return null;
  return {
    src,
    meta: {
      ...photo,
      id,
      photoId: id,
      thumbSrc,
      originalSrc,
      playbackSrc: playbackSrc || undefined,
    }
  };
}

function normalizeProjectImageMeta(item) {
  if (typeof item === 'string') return { url: item };
  return {
    ...item,
    thumbSrc: resolveAssetUrl(getPhotoThumbCandidate(item)),
    originalSrc: resolveAssetUrl(getPhotoOriginalCandidate(item)),
    playbackSrc: resolveAssetUrl(getVideoPlaybackCandidate(item)) || undefined,
  };
}

function toFiniteNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toNameList(input) {
  if (!input) return [];
  const arr = Array.isArray(input) ? input : String(input).split(/[;,，、|]/);
  const out = [];
  arr.forEach((v) => {
    const s = String(v || '').trim();
    if (!s) return;
    if (out.includes(s)) return;
    out.push(s);
  });
  return out;
}

function extractFaceNamesFromMeta(meta, viewerFaces) {
  const direct = toNameList(
    (meta && (
      meta.faceNames
      || meta.personNames
      || meta.personNameList
      || meta.face_name_list
      || meta.person_name_list
      || meta.people
    )) || []
  );
  if (direct.length) return direct;

  const names = [];
  const faces = Array.isArray(viewerFaces) ? viewerFaces : (Array.isArray(meta?.faces) ? meta.faces : []);
  faces.forEach((f) => {
    const n = String((f && (f.personName || f.person_name || f.name || f.label)) || '').trim();
    if (!n) return;
    if (/^人脸#?\d+$/i.test(n) || /^face#?\d+$/i.test(n)) return;
    if (!names.includes(n)) names.push(n);
  });
  return names;
}

function normalizeRelatedFacePhotos(input) {
  if (!Array.isArray(input)) return [];
  return input.map((item, idx) => {
    if (!item) return null;
    if (typeof item === 'string') {
      const url = resolveAssetUrl(item);
      return { id: `photo-${idx + 1}`, url, thumbUrl: url, title: `照片 ${idx + 1}` };
    }
    const id = item.id || item.photoId || item.photo_id || item.imageId || item.image_id || `photo-${idx + 1}`;
    const thumb = item.thumbUrl || item.thumbSrc || item.thumbnail || item.thumb || item.url || item.src || '';
    const full = item.url || item.originalUrl || item.originalSrc || item.src || thumb;
    return {
      id: String(id),
      photoId: String(id),
      projectId: item.projectId || item.project_id || null,
      projectName: item.projectName || item.project_name || '',
      url: full ? resolveAssetUrl(full) : '',
      thumbUrl: thumb ? resolveAssetUrl(thumb) : (full ? resolveAssetUrl(full) : ''),
      title: item.title || item.description || item.name || `照片 ${idx + 1}`,
      description: item.description || '',
    };
  }).filter(Boolean);
}

function normalizeFaceDetections(payload) {
  const root = (payload && typeof payload === 'object') ? payload : {};
  const data = (root.data && typeof root.data === 'object') ? root.data : root;
  const list = Array.isArray(root)
    ? root
    : Array.isArray(data.faces)
      ? data.faces
      : Array.isArray(data.list)
        ? data.list
        : Array.isArray(data.items)
          ? data.items
          : Array.isArray(data.results)
            ? data.results
            : Array.isArray(data.boxes)
              ? data.boxes
              : [];

  const defaultImgW = toFiniteNumber(data.imageWidth ?? data.image_width ?? root.imageWidth ?? root.image_width);
  const defaultImgH = toFiniteNumber(data.imageHeight ?? data.image_height ?? root.imageHeight ?? root.image_height);

  return list.map((item, idx) => {
    const face = (item && typeof item === 'object') ? item : null;
    if (!face) return null;
    const rect = face.bbox || face.box || face.rect || face.region || face.faceBox || face.location || {};

    let left = toFiniteNumber(rect.left ?? rect.x ?? rect.x1 ?? rect.minX ?? face.left ?? face.x ?? face.x1 ?? face.minX);
    let top = toFiniteNumber(rect.top ?? rect.y ?? rect.y1 ?? rect.minY ?? face.top ?? face.y ?? face.y1 ?? face.minY);
    let width = toFiniteNumber(rect.width ?? rect.w ?? face.width ?? face.w);
    let height = toFiniteNumber(rect.height ?? rect.h ?? face.height ?? face.h);
    const right = toFiniteNumber(rect.right ?? rect.x2 ?? rect.maxX ?? face.right ?? face.x2 ?? face.maxX);
    const bottom = toFiniteNumber(rect.bottom ?? rect.y2 ?? rect.maxY ?? face.bottom ?? face.y2 ?? face.maxY);

    if ((left === null || top === null || width === null || height === null) && Array.isArray(rect) && rect.length >= 4) {
      left = left ?? toFiniteNumber(rect[0]);
      top = top ?? toFiniteNumber(rect[1]);
      width = width ?? toFiniteNumber(rect[2]);
      height = height ?? toFiniteNumber(rect[3]);
    }
    if (width === null && left !== null && right !== null) width = right - left;
    if (height === null && top !== null && bottom !== null) height = bottom - top;
    if (left === null || top === null || width === null || height === null || width <= 0 || height <= 0) return null;

    const normalizedHint = Boolean(face.normalized ?? rect.normalized ?? data.normalized ?? root.normalized);
    const looksNormalized = Math.abs(left) <= 1.05 && Math.abs(top) <= 1.05 && Math.abs(width) <= 1.2 && Math.abs(height) <= 1.2;
    const unit = (normalizedHint || looksNormalized) ? 'ratio' : 'pixel';
    const faceNo = face.faceNo || face.faceNumber || face.no || (idx + 1);
    const faceId = String(face.faceId || face.face_id || face.id || face.trackId || `face-${faceNo}`);
    const rawPhotoId = face.photoId || face.photo_id || face.imageId || face.image_id || '';
    const photoId = rawPhotoId ? String(rawPhotoId) : '';
    const personIdRaw = face.personId || face.person_id || face.identityId || face.identity_id || face.clusterId || face.cluster_id || null;
    const personId = (personIdRaw !== null && personIdRaw !== undefined && String(personIdRaw).trim() !== '') ? String(personIdRaw) : '';
    const personNameRaw = face.personName || face.person_name || face.name || face.label || '';
    const personName = String(personNameRaw || '').trim();

    return {
      faceId,
      photoId,
      faceNo,
      personId,
      personName,
      label: personName || (personId ? `人物#${personId}` : `人脸#${faceNo}`),
      left,
      top,
      width,
      height,
      unit,
      imageWidth: toFiniteNumber(face.imageWidth ?? face.image_width ?? rect.imageWidth ?? defaultImgW),
      imageHeight: toFiniteNumber(face.imageHeight ?? face.image_height ?? rect.imageHeight ?? defaultImgH),
      score: toFiniteNumber(face.score ?? face.confidence ?? face.similarity),
      relatedPhotos: normalizeRelatedFacePhotos(face.relatedPhotos || face.photos || face.matches || []),
      raw: face,
    };
  }).filter(Boolean);
}

function normalizeFacePerson(payload, sourceFace) {
  const root = (payload && typeof payload === 'object') ? payload : {};
  const data = (root.data && typeof root.data === 'object') ? root.data : root;
  const person = (data.person && typeof data.person === 'object')
    ? data.person
    : (data.profile && typeof data.profile === 'object')
      ? data.profile
      : (data.face && typeof data.face === 'object')
        ? data.face
        : data;

  const rawPersonId = person.personId || person.person_id || person.id || sourceFace?.personId || '';
  const personId = rawPersonId ? String(rawPersonId) : '';
  const faceId = sourceFace?.faceId ? String(sourceFace.faceId) : '';
  const personNameRaw = person.name || person.personName || person.person_name || person.label || sourceFace?.personName || '';
  const personName = String(personNameRaw || '').trim();
  const relatedPhotos = normalizeRelatedFacePhotos(
    data.relatedPhotos || data.photos || person.relatedPhotos || person.photos || sourceFace?.relatedPhotos || []
  );

  return {
    personId,
    faceId,
    personName,
    displayName: personName || (personId ? `人物#${personId}` : (sourceFace?.faceNo ? `人脸#${sourceFace.faceNo}` : '未标注人物')),
    description: String(person.description || person.bio || person.summary || '').trim(),
    relatedPhotos,
    sourceFace: sourceFace || null,
    raw: data,
  };
}

function ProjectDetail({
  projectId,
  initialProject,
  onBack,
  initialOpenPhotoId,
  onInitialOpenPhotoHandled,
  readOnly = false,
  galleryMode: controlledGalleryMode,
  onGalleryModeChange,
  onProjectHeaderChange,
}) {
  const DISABLE_UPLOAD_FEATURE = !!readOnly;
  const DISABLE_DELETE_FEATURE = !!readOnly;

  const [project, setProject] = React.useState(initialProject || null);
  const [images, setImages] = React.useState(() => (initialProject?.images ? initialProject.images.map((it) => resolveAssetUrl(getPhotoThumbCandidate(it))) : []));
  const [photoMetas, setPhotoMetas] = React.useState(() => (initialProject?.images ? initialProject.images.map(normalizeProjectImageMeta) : []));
  const [loading, setLoading] = React.useState(() => !!projectId);
  const [error, setError] = React.useState(null);

  // upload / staging
  const [uploadMode, setUploadMode] = React.useState(false);
  const [stagingFiles, setStagingFiles] = React.useState([]); // File objects
  const [stagingPreviews, setStagingPreviews] = React.useState([]); // object URLs
  const [stagingSectionIds, setStagingSectionIds] = React.useState([]);
  const [selectedUploadSectionId, setSelectedUploadSectionId] = React.useState('');
  const [uploading, setUploading] = React.useState(false);
  const [uploadProgress, setUploadProgress] = React.useState(null);

  // edit modal
  const [editVisible, setEditVisible] = React.useState(false);
  const [editTitle, setEditTitle] = React.useState('');
  const [editDescription, setEditDescription] = React.useState('');
  const [editEventDate, setEditEventDate] = React.useState(null); // Date object or null
  const [editTags, setEditTags] = React.useState([]);
  const [editTagInput, setEditTagInput] = React.useState('');
  const [userPermissions, setUserPermissions] = React.useState(() => getPermissions());
  const [deletingProject, setDeletingProject] = React.useState(false);

  // timeline sections editor
  const [timelineEditVisible, setTimelineEditVisible] = React.useState(false);
  const [timelineBusy, setTimelineBusy] = React.useState(false);
  const [sectionRowEdits, setSectionRowEdits] = React.useState({}); // { [sectionId]: { name, sectionTime } }
  const [timelineDraftName, setTimelineDraftName] = React.useState('');
  const [timelineDraftTime, setTimelineDraftTime] = React.useState('');
  const [moveSectionVisible, setMoveSectionVisible] = React.useState(false);
  const [assigningSection, setAssigningSection] = React.useState(false);
  const [dragSectionIdx, setDragSectionIdx] = React.useState(null);
  const [dragOverSectionIdx, setDragOverSectionIdx] = React.useState(null);
  // 照片拖拽中：左侧环节导航进入"可移入"状态
  const [photoDragActive, setPhotoDragActive] = React.useState(false);
  const [railDropKey, setRailDropKey] = React.useState(null);
  // 系统文件拖入页面：整页/分环节成为上传落点
  const [fileDragActive, setFileDragActive] = React.useState(false);
  const fileDragDepthRef = React.useRef(0);
  const directFileDropRef = React.useRef(null);
  const dropGestureGuardRef = React.useRef(false);
  // 环节导航溢出与"展开全部"
  const railRef = React.useRef(null);
  const [railExpanded, setRailExpanded] = React.useState(false);
  const [railOverflow, setRailOverflow] = React.useState(false);
  // 桌面端：环节名被截断时可向右加宽导航
  const [railWide, setRailWide] = React.useState(false);
  const [railNameTruncated, setRailNameTruncated] = React.useState(false);

  // selection / delete
  const [deleteMode, setDeleteMode] = React.useState(false);
  const [selectedMap, setSelectedMap] = React.useState({});
  const [selectedCount, setSelectedCount] = React.useState(0);
  const [allSelected, setAllSelected] = React.useState(false);
  const [deletingPhotos, setDeletingPhotos] = React.useState(false);

  const fileInputRef = React.useRef(null);
  const dragPreviewRef = React.useRef(null);
  const photoMetasRef = React.useRef(photoMetas);
  const [hoveredPhotoIdx, setHoveredPhotoIdx] = React.useState(-1);
  const [dragActive, setDragActive] = React.useState(false);
  const [uploadHover, setUploadHover] = React.useState(false);

  const galleryRef = React.useRef(null);
  const [galleryWidth, setGalleryWidth] = React.useState(0);
  const [imageRatios, setImageRatios] = React.useState({});
  const ratioCacheRef = React.useRef({});
  const [galleryPrepared, setGalleryPrepared] = React.useState(false);
  const [galleryRenderLimit, setGalleryRenderLimit] = React.useState(GALLERY_INITIAL_RENDER_LIMIT);
  const galleryMoreRef = React.useRef(null);
  const [detailImageReadyMap, setDetailImageReadyMap] = React.useState({});
  const timelineDefaultModeProjectRef = React.useRef(null);
  // image viewer
  const [viewerVisible, setViewerVisible] = React.useState(false);
  const [viewerIndex, setViewerIndex] = React.useState(0);
  const [viewerEnableOpenZoom, setViewerEnableOpenZoom] = React.useState(false);
  // whether viewer currently shows the original image (toggle per viewer open/index)
  const [viewerShowOriginal, setViewerShowOriginal] = React.useState(false);
  const [viewerFaceOverlayVisible, setViewerFaceOverlayVisible] = React.useState(false);
  const [viewerFaceMap, setViewerFaceMap] = React.useState({});
  const [viewerFaceErrorMap, setViewerFaceErrorMap] = React.useState({});
  const viewerFaceFetchPromiseRef = React.useRef({});
  const [viewerImageNaturalMap, setViewerImageNaturalMap] = React.useState({});
  const [facePersonVisible, setFacePersonVisible] = React.useState(false);
  const [facePersonLoading, setFacePersonLoading] = React.useState(false);
  const [facePersonError, setFacePersonError] = React.useState('');
  const [facePersonData, setFacePersonData] = React.useState(null);
  const [facePersonHeroPhoto, setFacePersonHeroPhoto] = React.useState(null);
  const [facePersonEditName, setFacePersonEditName] = React.useState('');
  const [facePersonSaving, setFacePersonSaving] = React.useState(false);
  // parsed photo tags and descriptions indexed by photo ID
  const [photoTagsMap, setPhotoTagsMap] = React.useState({});
  const [photoDescMap, setPhotoDescMap] = React.useState({});
  const [photoAnalysisPendingMap, setPhotoAnalysisPendingMap] = React.useState({});
  const analysisPollTimersRef = React.useRef({});
  const videoPlaybackPollTimersRef = React.useRef({});
  // AI selection mode toggle
  const [showAILabels, setShowAILabels] = React.useState(false);
  // AI quality labels (recommended/medium/rejected) indexed by photo ID
  const [photoAILabelMap, setPhotoAILabelMap] = React.useState({});
  // viewer-based photo edit (tags & description)
  const [viewerEditVisible, setViewerEditVisible] = React.useState(false);
  const [viewerEditTags, setViewerEditTags] = React.useState([]);
  const [viewerEditTagInput, setViewerEditTagInput] = React.useState('');
  const [viewerEditDescription, setViewerEditDescription] = React.useState('');
  const [photoAdjustmentsMap, setPhotoAdjustmentsMap] = React.useState({});
  const [viewerToneVisible, setViewerToneVisible] = React.useState(false);
  const [viewerToneDraft, setViewerToneDraft] = React.useState(() => normalizePhotoAdjustments(DEFAULT_PHOTO_ADJUSTMENTS));
  const [viewerToneSaving, setViewerToneSaving] = React.useState(false);
  const [viewerToneAnalyzing, setViewerToneAnalyzing] = React.useState(false);
  const [viewerToneError, setViewerToneError] = React.useState('');
  const [viewerToneAnalysis, setViewerToneAnalysis] = React.useState(null);
  const toneAnalysisSeqRef = React.useRef(0);
  const [internalGalleryMode, setInternalGalleryMode] = React.useState('masonry'); // 'grid' | 'masonry'
  const galleryMode = controlledGalleryMode || internalGalleryMode;
  const handleGalleryModeChange = React.useCallback((nextMode) => {
    if (onGalleryModeChange) onGalleryModeChange(nextMode);
    if (!controlledGalleryMode) setInternalGalleryMode(nextMode);
  }, [onGalleryModeChange, controlledGalleryMode]);

  // similarity modal (相似照片分组)
  const [simModalVisible, setSimModalVisible] = React.useState(false);
  const [simLoading, setSimLoading] = React.useState(false);
  const [simGroups, setSimGroups] = React.useState(null);
  const [simPhotos, setSimPhotos] = React.useState({}); // id -> meta
  const [simError, setSimError] = React.useState(null);
  const [simDeleteMode, setSimDeleteMode] = React.useState(false);
  const [simSelectedMap, setSimSelectedMap] = React.useState({}); // id -> true
  const [simSelectedCount, setSimSelectedCount] = React.useState(0);
  const [simDeleting, setSimDeleting] = React.useState(false);
  // 合影救场（查看器入口）状态机：null | { phase: 'loading'|'pick'|'running'|'done'|'noop'|'failed'|'nogroup', ... }
  const [viewerRescue, setViewerRescue] = React.useState(null);
  const [isMobile, setIsMobile] = React.useState(() => (typeof window !== 'undefined' ? window.innerWidth <= 768 : false));
  const viewerPointerRef = React.useRef({ active: false, pointerId: null, startX: 0, startY: 0 });
  const [searchKeyword, setSearchKeyword] = React.useState('');
  const [searching, setSearching] = React.useState(false);
  const [searchError, setSearchError] = React.useState('');
  const [searchOpen, setSearchOpen] = React.useState(false);
  const [actionSheetOpen, setActionSheetOpen] = React.useState(false);
  const [mediaFilter, setMediaFilter] = React.useState('all'); // all | image | video
  const searchReqSeqRef = React.useRef(0);
  const hasSearchedRef = React.useRef(false);

  React.useEffect(() => {
    setActionSheetOpen(false);
    setSearchOpen(false);
  }, [projectId]);

  React.useEffect(() => {
    if (!actionSheetOpen) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape') setActionSheetOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [actionSheetOpen]);

  React.useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    document.body.classList.toggle('mamage-detail-actions-open', actionSheetOpen);
    return () => document.body.classList.remove('mamage-detail-actions-open');
  }, [actionSheetOpen]);

  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onResize = () => setIsMobile(window.innerWidth <= 768);
    onResize();
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, []);

  React.useEffect(() => () => {
    Object.values(analysisPollTimersRef.current || {}).forEach((timer) => {
      try { clearTimeout(timer); } catch (e) { }
    });
    analysisPollTimersRef.current = {};
    Object.values(videoPlaybackPollTimersRef.current || {}).forEach((timer) => {
      try { clearTimeout(timer); } catch (e) { }
    });
    videoPlaybackPollTimersRef.current = {};
  }, []);

  React.useEffect(() => {
    photoMetasRef.current = Array.isArray(photoMetas) ? photoMetas : [];
  }, [photoMetas]);

  const applyGalleryMetas = React.useCallback((nextMetas) => {
    const normalized = Array.isArray(nextMetas) ? nextMetas.filter(Boolean) : [];
    photoMetasRef.current = normalized;
    setPhotoMetas(normalized);
    setImages(normalized.map((meta) => meta.thumbSrc || resolveAssetUrl(getPhotoThumbCandidate(meta))).filter(Boolean));
  }, []);

  React.useEffect(() => {
    if (initialProject) {
      setProject((prev) => {
        if (!prev || (initialProject.id && prev.id !== initialProject.id)) {
          return initialProject;
        }
        return prev;
      });
      if (initialProject.images && initialProject.images.length) {
        setImages((prev) => (prev.length ? prev : initialProject.images.map((it) => resolveAssetUrl(getPhotoThumbCandidate(it)))));
        setPhotoMetas((prev) => (prev.length ? prev : initialProject.images.map((it) => (typeof it === 'string' ? { url: it } : { ...it, thumbSrc: resolveAssetUrl(getPhotoThumbCandidate(it)), originalSrc: resolveAssetUrl(getPhotoOriginalCandidate(it)), playbackSrc: resolveAssetUrl(getVideoPlaybackCandidate(it)) }))));
      }
    }
  }, [initialProject]);

  const uploadTimelineSections = React.useMemo(() => {
    const sourceProject = project || initialProject || null;
    return normalizeTimelineSectionsForClient(sourceProject?.timelineSections || sourceProject?.timeline_sections || []);
  }, [project, initialProject]);

  const uploadTimelineEnabled = React.useMemo(() => {
    const sourceProject = project || initialProject || null;
    const meta = sourceProject?.meta && typeof sourceProject.meta === 'object' ? sourceProject.meta : {};
    return Boolean(sourceProject?.timelineEnabled || sourceProject?.timeline_enabled || meta.timelineEnabled || uploadTimelineSections.length);
  }, [project, initialProject, uploadTimelineSections]);

  React.useEffect(() => {
    if (!uploadTimelineEnabled || !uploadTimelineSections.length) {
      setSelectedUploadSectionId('');
      return;
    }
    setSelectedUploadSectionId((prev) => {
      if (prev && uploadTimelineSections.some((section) => String(section.id) === String(prev))) return prev;
      const first = uploadTimelineSections.find((section) => section.id);
      return first ? String(first.id) : '';
    });
  }, [uploadTimelineEnabled, uploadTimelineSections]);

  const selectedUploadSection = React.useMemo(() => {
    if (!selectedUploadSectionId) return null;
    return uploadTimelineSections.find((section) => String(section.id) === String(selectedUploadSectionId)) || null;
  }, [uploadTimelineSections, selectedUploadSectionId]);

  const stagingCountBySectionId = React.useMemo(() => {
    const counts = new Map();
    (stagingSectionIds || []).forEach((sectionId) => {
      const key = String(sectionId || '');
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    return counts;
  }, [stagingSectionIds]);

  const hasUnassignedStagedFiles = React.useMemo(() => (
    uploadTimelineEnabled
      && uploadTimelineSections.length > 0
      && stagingFiles.some((_, index) => !stagingSectionIds[index])
  ), [uploadTimelineEnabled, uploadTimelineSections, stagingFiles, stagingSectionIds]);

  const stagedUploadGroups = React.useMemo(() => {
    const makeItem = (file, index) => ({
      file,
      index,
      preview: stagingPreviews[index],
      sectionId: stagingSectionIds[index] || '',
    });

    if (!uploadTimelineEnabled || !uploadTimelineSections.length) {
      return [{
        key: 'all',
        sectionId: '',
        name: '待上传照片',
        sectionTime: '',
        active: true,
        items: stagingFiles.map((file, index) => makeItem(file, index)),
      }];
    }

    const groups = uploadTimelineSections.map((section) => ({
      key: String(section.id || section.key),
      sectionId: String(section.id || ''),
      name: section.name || '未命名环节',
      sectionTime: section.sectionTime || '',
      active: String(section.id || '') === String(selectedUploadSectionId || ''),
      items: [],
    }));
    const bySectionId = new Map(groups.map((group) => [String(group.sectionId), group]));
    const unassigned = {
      key: 'unassigned',
      sectionId: '',
      name: '未选择环节',
      sectionTime: '',
      active: false,
      items: [],
    };

    stagingFiles.forEach((file, index) => {
      const item = makeItem(file, index);
      const target = bySectionId.get(String(item.sectionId || '')) || unassigned;
      target.items.push(item);
    });

    return unassigned.items.length ? [...groups, unassigned] : groups;
  }, [
    uploadTimelineEnabled,
    uploadTimelineSections,
    stagingFiles,
    stagingPreviews,
    stagingSectionIds,
    selectedUploadSectionId,
  ]);

  const uploadProgressItems = React.useMemo(() => {
    if (!uploadProgress || !uploadProgress.items) return [];
    return (uploadProgress.order || [])
      .map((key) => uploadProgress.items[key])
      .filter(Boolean);
  }, [uploadProgress]);

  const findStagedUploadIndex = React.useCallback((file) => {
    const key = getUploadFileKey(file);
    if (!key) return -1;
    return (stagingFiles || []).findIndex((item) => getUploadFileKey(item) === key);
  }, [stagingFiles]);

  const upsertVideoUploadPlaceholder = React.useCallback((event, state = 'processing') => {
    const file = event && event.file;
    if (!file || !isVideoMeta(file)) return;
    const fileKey = getUploadFileKey(file);
    if (!fileKey) return;
    const stagedIndex = findStagedUploadIndex(file);
    const previewSrc = stagedIndex >= 0 ? stagingPreviews[stagedIndex] : '';
    const placeholderSrc = previewSrc || `pending-video://${fileKey}`;
    const sectionId = stagedIndex >= 0 ? String(stagingSectionIds[stagedIndex] || '') : '';
    const placeholderId = `pending-video-${fileKey}`;
    const placeholderMeta = {
      id: placeholderId,
      photoId: placeholderId,
      uploadPlaceholder: true,
      clientUploadKey: fileKey,
      uploadState: state === 'failed' ? 'failed' : 'video-processing',
      mediaType: 'video',
      media_type: 'video',
      type: 'video',
      title: file.name || '视频',
      fileName: file.name || '视频',
      fileSize: file.size || 0,
      timelineSectionId: sectionId || undefined,
      timeline_section_id: sectionId || undefined,
      thumbSrc: placeholderSrc,
      thumbUrl: placeholderSrc,
      originalSrc: placeholderSrc,
      originalUrl: placeholderSrc,
      url: placeholderSrc,
    };
    const current = Array.isArray(photoMetasRef.current) ? photoMetasRef.current : [];
    const existingIndex = current.findIndex((meta) => isVideoUploadPlaceholder(meta) && meta.clientUploadKey === fileKey);
    if (state === 'failed' && existingIndex < 0) return;
    const next = existingIndex >= 0
      ? current.map((meta, index) => (index === existingIndex ? { ...(meta || {}), ...placeholderMeta } : meta))
      : [placeholderMeta, ...current];
    applyGalleryMetas(next);
  }, [applyGalleryMetas, findStagedUploadIndex, stagingPreviews, stagingSectionIds]);

  const removeVideoUploadPlaceholder = React.useCallback((file) => {
    const fileKey = getUploadFileKey(file);
    if (!fileKey) return;
    const current = Array.isArray(photoMetasRef.current) ? photoMetasRef.current : [];
    const next = current.filter((meta) => !(isVideoUploadPlaceholder(meta) && meta.clientUploadKey === fileKey));
    if (next.length !== current.length) applyGalleryMetas(next);
  }, [applyGalleryMetas]);

  // helper: construct aligned images (src strings) and metas (original objects) from project detail
  const buildImagesAndMetas = React.useCallback((detail) => {
    if (!detail) return { images: [], metas: [] };
    const items = (detail.images || detail.photos || detail.gallery || []).filter(Boolean);
    const photoIds = Array.isArray(detail.photo_ids) ? detail.photo_ids : (Array.isArray(detail.photoIds) ? detail.photoIds : null);
    const tagsMap = {};
    const descMap = {};
    const aiLabelMap = {};
    const adjustmentsMap = {};
    const normalized = items.map((item, idx) => {
      if (typeof item === 'string') {
        const meta = { url: item };
        if (photoIds && photoIds[idx] !== undefined) meta.id = photoIds[idx];
        const mediaType = getMediaTypeFromItem(item);
        meta.mediaType = mediaType;
        // determine thumbnail and original candidates
        let thumbCandidate = meta.thumbUrl || meta.thumbnail || meta.thumb || item;
        const origCandidate = meta.originalUrl || meta.original || meta.full || meta.large || item;
        // If thumb candidate equals original, try to infer a thumbnail path in the same directory
        // common pattern: /uploads/2025/12/01/<filename>.jpg -> /uploads/2025/12/01/thumbs/thumb_<filename>.jpg
        try {
          if (mediaType !== 'video' && thumbCandidate === origCandidate) {
            const m = String(origCandidate).match(/^(.*\/)([^\/]+)$/);
            if (m) {
              const dir = m[1];
              const file = m[2];
              thumbCandidate = `${dir}thumbs/thumb_${file}`;
            } else {
              // fallback: append a query param to distinguish cache key
              thumbCandidate = `${thumbCandidate}${thumbCandidate.includes('?') ? '&' : '?'}thumb=1`;
            }
          }
        } catch (e) { }

        const playbackCandidate = getVideoPlaybackCandidate(meta);
        const metaFinal = Object.assign({}, meta, {
          mediaType,
          thumbSrc: resolveAssetUrl(thumbCandidate),
          originalSrc: resolveAssetUrl(origCandidate),
          playbackSrc: playbackCandidate ? resolveAssetUrl(playbackCandidate) : undefined,
        });
        if (metaFinal.id) {
          const semantic = extractPhotoSemantic(item);
          if (semantic.hasAnalysis) {
            tagsMap[metaFinal.id] = semantic.tags;
            descMap[metaFinal.id] = semantic.description;
          }
          if (semantic.aiLabel) aiLabelMap[metaFinal.id] = semantic.aiLabel;
          if (metaFinal.adjustments) adjustmentsMap[metaFinal.id] = normalizePhotoAdjustments(metaFinal.adjustments);
        }
        // If this resolved src is still relative but there are absolute urls
        // available elsewhere in the provided items, try to prefer an absolute one.
        let resolvedSrc = resolveAssetUrl(thumbCandidate);
        try {
          const isRelativeResolved = resolvedSrc && /^\//.test(resolvedSrc);
          if (isRelativeResolved) {
            const allSrcs = items.map((it) => (typeof it === 'string' ? it : (it && (it.url || it.imageUrl || it.src || it.fileUrl)))).filter(Boolean);
            const absCandidates = allSrcs.filter(s => /^https?:\/\//i.test(s));
            if (absCandidates.length) {
              const getFilename = (s) => { try { const m = String(s).match(/([^\/:?#]+)(?:[?#].*)?$/); return m ? m[1] : null; } catch (e) { return null; } };
              const targetName = getFilename(item);
              let pick = null;
              if (targetName) pick = absCandidates.find(a => getFilename(a) === targetName) || null;
              if (!pick) pick = absCandidates[0];
              if (pick) {
                resolvedSrc = pick;
                metaFinal.thumbSrc = pick;
                // if original was relative, also try to set originalSrc to absolute equivalent
                metaFinal.originalSrc = pick;
              }
            }
          }
        } catch (e) { }

        return {
          src: resolvedSrc,
          meta: metaFinal
        };
      }
      const src = item.url || item.imageUrl || item.src || item.fileUrl || null;
      const meta = Object.assign({}, item);
      if (!meta.id && photoIds && photoIds[idx] !== undefined) meta.id = photoIds[idx];
      if (!src) return null;
      const mediaType = getMediaTypeFromItem(item);
      meta.mediaType = mediaType;
      let thumbCandidate = meta.thumbUrl || meta.thumbnail || meta.thumb || src;
      const origCandidate = meta.originalUrl || meta.original || meta.full || meta.large || src;
      try {
        if (mediaType !== 'video' && thumbCandidate === origCandidate) {
          const m = String(origCandidate).match(/^(.*\/)([^\/]+)$/);
          if (m) {
            const dir = m[1];
            const file = m[2];
            thumbCandidate = `${dir}thumbs/thumb_${file}`;
          } else {
            thumbCandidate = `${thumbCandidate}${thumbCandidate.includes('?') ? '&' : '?'}thumb=1`;
          }
        }
      } catch (e) { }
      const playbackCandidate = getVideoPlaybackCandidate(meta);
      const metaFinal = Object.assign({}, meta, {
        mediaType,
        thumbSrc: resolveAssetUrl(thumbCandidate),
        originalSrc: resolveAssetUrl(origCandidate),
        playbackSrc: playbackCandidate ? resolveAssetUrl(playbackCandidate) : undefined,
      });
      if (metaFinal.id) {
        const semantic = extractPhotoSemantic(item);
        if (semantic.hasAnalysis) {
          tagsMap[metaFinal.id] = semantic.tags;
          descMap[metaFinal.id] = semantic.description;
        }
        if (semantic.aiLabel) aiLabelMap[metaFinal.id] = semantic.aiLabel;
        if (metaFinal.adjustments) adjustmentsMap[metaFinal.id] = normalizePhotoAdjustments(metaFinal.adjustments);
      }
      // Prefer absolute candidate when available (similar to ProjectCard behavior)
      let resolvedSrc = resolveAssetUrl(thumbCandidate);
      try {
        const isRelativeResolved = resolvedSrc && /^\//.test(resolvedSrc);
        if (isRelativeResolved) {
          const allSrcs = items.map((it) => (typeof it === 'string' ? it : (it && (it.url || it.imageUrl || it.src || it.fileUrl)))).filter(Boolean);
          const absCandidates = allSrcs.filter(s => /^https?:\/\//i.test(s));
          if (absCandidates.length) {
            const getFilename = (s) => { try { const m = String(s).match(/([^\/:?#]+)(?:[?#].*)?$/); return m ? m[1] : null; } catch (e) { return null; } };
            const targetName = getFilename(src || meta.url);
            let pick = null;
            if (targetName) pick = absCandidates.find(a => getFilename(a) === targetName) || null;
            if (!pick) pick = absCandidates[0];
            if (pick) {
              resolvedSrc = pick;
              metaFinal.thumbSrc = pick;
              metaFinal.originalSrc = pick;
            }
          }
        }
      } catch (e) { }

      return {
        src: resolvedSrc,
        meta: metaFinal
      };
    }).filter(Boolean);
    // Only update global maps if we actually found any tags/descriptions
    // to avoid clearing previously-loaded tags (for example from /api/photos)
    if (Object.keys(tagsMap).length) {
      setPhotoTagsMap((prev) => ({ ...(prev || {}), ...tagsMap }));
    }
    if (Object.keys(descMap).length) {
      setPhotoDescMap((prev) => ({ ...(prev || {}), ...descMap }));
    }
    if (Object.keys(aiLabelMap).length) {
      setPhotoAILabelMap((prev) => ({ ...(prev || {}), ...aiLabelMap }));
    }
    if (Object.keys(adjustmentsMap).length) {
      setPhotoAdjustmentsMap((prev) => ({ ...(prev || {}), ...adjustmentsMap }));
    }
    return { images: normalized.map((n) => n.src), metas: normalized.map((n) => n.meta) };
  }, []);

  React.useEffect(() => {
    // cleanup previews on unmount
    return () => {
      stagingPreviews.forEach((u) => {
        try { URL.revokeObjectURL(u); } catch (e) { }
      });
    };
  }, [stagingPreviews]);

  React.useEffect(() => {
    if (!projectId) return undefined;
    let canceled = false;

    const extractImageUrls = (list) => {
      if (!Array.isArray(list)) return [];
      return list
        .map((item) => {
          if (!item) return null;
          if (typeof item === 'string') return item;
          return item.url || item.imageUrl || item.src || item.fileUrl || null;
        })
        .filter(Boolean);
    };

    const mergeUnique = (primary, fallback) => {
      const seen = new Set();
      const result = [];
      [
        ...(Array.isArray(primary) ? primary : []),
        ...(Array.isArray(fallback) ? fallback : []),
      ].forEach((src) => {
        if (!src || seen.has(src)) return;
        seen.add(src);
        result.push(src);
      });
      return result;
    };

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const detail = await getProjectById(projectId, {
          demo: readOnly,
          includeFaces: false,
          timeoutMs: PROJECT_DETAIL_TIMEOUT_MS,
        });
        if (canceled) return;

        setProject(detail);

        const detailItems = Array.isArray(detail?.images) ? detail.images : (Array.isArray(detail?.photos) ? detail.photos : (Array.isArray(detail?.gallery) ? detail.gallery : []));
        const previewItems = Array.isArray(detail?.previewImages) ? detail.previewImages : [];
        let built = buildImagesAndMetas({ images: detailItems.length ? detailItems : previewItems, photo_ids: detail?.photo_ids, photoIds: detail?.photoIds });

        if (!built.images.length) {
          let gallery = mergeUnique(
            extractImageUrls(detail?.images ?? detail?.photos ?? detail?.gallery),
            extractImageUrls(detail?.previewImages)
          );
          const random = await fetchRandomByProject(projectId, 30);
          if (canceled) return;
          const randomList = Array.isArray(random?.list) ? random.list : Array.isArray(random) ? random : [];
          gallery = mergeUnique(gallery, extractImageUrls(randomList).map(resolveAssetUrl));
          if (!gallery.length && initialProject?.images?.length) {
            gallery = mergeUnique(gallery, initialProject.images.map((it) => resolveAssetUrl(getPhotoThumbCandidate(it))));
          }
          built = buildImagesAndMetas({ images: gallery, photo_ids: detail?.photo_ids, photoIds: detail?.photoIds });
        }
        let nextImages = built.images;
        let nextMetas = built.metas;

        // Use photos embedded in project detail (preferred) instead of calling /api/photos
        try {
          const photoIds = nextMetas.map((m) => m.id).filter(Boolean);
          if (photoIds.length > 0) {
            const photosArray = Array.isArray(detail.photos) ? detail.photos : (Array.isArray(detail.images) ? detail.images : []);
            const photoMap = {};

            if (photosArray.length) {
              photosArray.forEach((p) => {
                const id = p && (p.id || p.photoId || p.photo_id);
                if (!id) return;
                const semantic = extractPhotoSemantic(p);
                photoMap[id] = {
                  tags: semantic.tags,
                  description: semantic.description,
                  aiLabel: semantic.aiLabel,
                  hasAnalysis: semantic.hasAnalysis,
                  raw: p
                };
              });
            }

            // merge/extend existing maps instead of replacing to avoid wiping data
            const tagsMapOnly = {};
            const descMapOnly = {};
            const aiLabelMapOnly = {};
            Object.keys(photoMap).forEach((id) => {
              if (photoMap[id].aiLabel) aiLabelMapOnly[id] = photoMap[id].aiLabel;
              if (!photoMap[id].hasAnalysis) return;
              tagsMapOnly[id] = photoMap[id].tags;
              descMapOnly[id] = photoMap[id].description;
            });

            setPhotoTagsMap((prev) => ({ ...(prev || {}), ...tagsMapOnly }));
            setPhotoDescMap((prev) => ({ ...(prev || {}), ...descMapOnly }));
            setPhotoAILabelMap((prev) => ({ ...(prev || {}), ...aiLabelMapOnly }));

            // 如果 detail 涓繑鍥炰簡鏇村畬鏁寸殑 photo 对象，合并这些字段回 photoMetas
            try {
              const photoById = {};
              photosArray.forEach(p => { const id = p && (p.id || p.photoId || p.photo_id); if (id) photoById[id] = p; });
              if (Object.keys(photoById).length) {
                const merged = (nextMetas || []).map((m) => {
                  if (!m) return m;
                  const p = photoById[m.id];
                  if (!p) return m;
                  const mergedMeta = Object.assign({}, m, p);
                  const thumbCandidate = p.thumbUrl || p.thumb || p.thumbnail || mergedMeta.thumbSrc || mergedMeta.thumb || mergedMeta.src || p.url;
                  const origCandidate = p.url || p.originalUrl || p.original || p.full || mergedMeta.originalSrc || mergedMeta.url || mergedMeta.src;
                  mergedMeta.thumbSrc = resolveAssetUrl(thumbCandidate);
                  mergedMeta.originalSrc = resolveAssetUrl(origCandidate);
                  return mergedMeta;
                });
                nextMetas = merged;
                nextImages = merged.map((m) => m.thumbSrc || m.src || resolveAssetUrl(m.url || m.fileUrl || m.imageUrl || ''));
              }
            } catch (e) {
              console.warn('merge photo urls failed', e);
            }

            if (!canceled && nextImages.length) {
              setPhotoMetas(nextMetas);
              setImages(nextImages);
              setLoading(false);
            }

            // 濡傛灉閮ㄥ垎 photo meta 缺少 photographerName，但包含 photographerId锛?
            // 前端仍可回退去请求用户信息并补全 name（可保留以提升体验）。
            try {
              const mergedList = (nextMetas || []).map(m => ({ ...(m || {}) }));
              const idsToFetch = Array.from(new Set((mergedList || [])
                .filter(p => p && !p.photographerName && (p.photographerId || p.userId || p.ownerId))
                .map(p => p.photographerId || p.userId || p.ownerId)
                .filter(Boolean)));
              if (idsToFetch.length) {
                const token = getToken ? getToken() : null;
                const headers = token ? { Authorization: `Bearer ${token}` } : {};
                const fetchUser = async (id) => {
                  try {
                    const resp = await fetch(`/api/users/${id}`, { headers });
                    if (!resp.ok) return null;
                    const data = await resp.json();
                    return data && (data.name || data.username || data.displayName || data.nickname || data.nick || data.realName);
                  } catch (e) {
                    return null;
                  }
                };

                const userNamePromises = idsToFetch.map(id => fetchUser(id));
                const names = await Promise.all(userNamePromises);
                const idToName = {};
                idsToFetch.forEach((id, i) => { if (names[i]) idToName[id] = names[i]; });
                if (Object.keys(idToName).length) {
                  const updated = (mergedList || []).map((m) => {
                    if (!m) return m;
                    const pid = m.photographerId || m.userId || m.ownerId;
                    if (pid && !m.photographerName && idToName[pid]) {
                      return Object.assign({}, m, { photographerName: idToName[pid] });
                    }
                    return m;
                  });
                  nextMetas = updated;
                  if (!canceled) setPhotoMetas(updated);
                }
              }
            } catch (e) {
              // 忽略网络错误，不影响主流程
            }
          }
        } catch (e) {
          console.warn('Failed to process photos from project detail:', e);
        }
        if (!canceled) {
          setPhotoMetas(nextMetas);
          setImages(nextImages);
        }
      } catch (err) {
        if (canceled) return;
        setError(err?.message || '获取项目详情失败');
        if (initialProject?.images?.length) {
          setImages(initialProject.images.map((it) => resolveAssetUrl(getPhotoThumbCandidate(it))));
          setPhotoMetas(initialProject.images.map((it) => (typeof it === 'string' ? { url: it } : { ...it, thumbSrc: resolveAssetUrl(getPhotoThumbCandidate(it)), originalSrc: resolveAssetUrl(getPhotoOriginalCandidate(it)), playbackSrc: resolveAssetUrl(getVideoPlaybackCandidate(it)) })));
        }
      } finally {
        if (!canceled) setLoading(false);
      }
    };

    load();

    return () => {
      canceled = true;
    };
  }, [projectId, initialProject, readOnly]);

  React.useEffect(() => {
    if (!projectId || !loading || images.length > 0) return undefined;
    let canceled = false;
    const timer = setTimeout(async () => {
      try {
        const random = await fetchRandomByProject(projectId, 30);
        if (canceled) return;
        const randomList = Array.isArray(random?.list) ? random.list : Array.isArray(random) ? random : [];
        if (!randomList.length) return;
        const built = buildImagesAndMetas({ images: randomList });
        if (!built.images.length) return;
        setPhotoMetas(built.metas);
        setImages(built.images);
        setError(null);
        setLoading(false);
      } catch (err) {
        // Keep the primary detail request in charge of the final error state.
      }
    }, 1600);
    return () => {
      canceled = true;
      clearTimeout(timer);
    };
  }, [projectId, loading, images.length, buildImagesAndMetas]);

  const reloadGalleryFromServer = React.useCallback(async () => {
    if (!projectId) return;
    const detail = await getProjectById(projectId, {
      demo: readOnly,
      includeFaces: false,
      timeoutMs: PROJECT_DETAIL_TIMEOUT_MS,
    });
    setProject(detail);
    const built = buildImagesAndMetas(detail);
    setImages(built.images);
    setPhotoMetas(built.metas);
  }, [projectId, buildImagesAndMetas, readOnly]);

  const clearAnalysisPollTimer = React.useCallback((photoId) => {
    const key = String(photoId || '').trim();
    if (!key) return;
    const timer = analysisPollTimersRef.current[key];
    if (timer) {
      try { clearTimeout(timer); } catch (e) { }
    }
    delete analysisPollTimersRef.current[key];
  }, []);

  const clearVideoPlaybackPollTimer = React.useCallback((photoId) => {
    const key = String(photoId || '').trim();
    if (!key) return;
    const timer = videoPlaybackPollTimersRef.current[key];
    if (timer) {
      try { clearTimeout(timer); } catch (e) { }
    }
    delete videoPlaybackPollTimersRef.current[key];
  }, []);

  const mergePhotoAnalysisResult = React.useCallback((photo) => {
    const photoId = getPhotoRecordId(photo);
    if (!photoId) return false;
    const semantic = extractPhotoSemantic(photo);
    const normalized = normalizePhotoForGallery(photo);

    setPhotoTagsMap((prev) => ({ ...(prev || {}), [photoId]: semantic.tags }));
    setPhotoDescMap((prev) => ({ ...(prev || {}), [photoId]: semantic.description }));
    setPhotoAILabelMap((prev) => ({ ...(prev || {}), [photoId]: semantic.aiLabel }));

    if (normalized) {
      setPhotoMetas((prev) => {
        const list = Array.isArray(prev) ? prev : [];
        let changed = false;
        const next = list.map((meta) => {
          if (String(getPhotoRecordId(meta) || '') !== photoId) return meta;
          changed = true;
          return { ...(meta || {}), ...normalized.meta };
        });
        return changed ? next : list;
      });
    }

    if (!semantic.analysisPending) {
      setPhotoAnalysisPendingMap((prev) => {
        if (!prev || !prev[photoId]) return prev || {};
        const next = { ...prev };
        delete next[photoId];
        return next;
      });
    } else {
      setPhotoAnalysisPendingMap((prev) => ({ ...(prev || {}), [photoId]: true }));
    }

    return semantic.hasAnalysis || !semantic.analysisPending;
  }, []);

  const prependUploadedPhotos = React.useCallback((photos) => {
    const normalized = (Array.isArray(photos) ? photos : [])
      .map(normalizePhotoForGallery)
      .filter(Boolean);
    if (!normalized.length) return [];

    const patchesById = {};
    normalized.forEach(({ meta }) => {
      const photoId = getPhotoRecordId(meta);
      if (!photoId) return;
      patchesById[photoId] = meta;
      const semantic = extractPhotoSemantic(meta);
      setPhotoTagsMap((prev) => ({ ...(prev || {}), [photoId]: semantic.tags }));
      setPhotoDescMap((prev) => ({ ...(prev || {}), [photoId]: semantic.description }));
      setPhotoAILabelMap((prev) => ({ ...(prev || {}), [photoId]: semantic.aiLabel }));
      if (semantic.analysisPending) {
        setPhotoAnalysisPendingMap((prev) => ({ ...(prev || {}), [photoId]: true }));
      }
      if (meta.adjustments) {
        setPhotoAdjustmentsMap((prev) => ({ ...(prev || {}), [photoId]: normalizePhotoAdjustments(meta.adjustments) }));
      }
    });

    const currentMetas = Array.isArray(photoMetasRef.current) ? photoMetasRef.current : [];
    const existingIds = new Set(currentMetas.map((meta) => getPhotoRecordId(meta)).filter(Boolean));
    const freshMetas = normalized
      .filter(({ meta }) => !existingIds.has(getPhotoRecordId(meta)))
      .map(({ meta }) => meta);
    const updatedExisting = currentMetas.map((meta) => {
      const photoId = getPhotoRecordId(meta);
      return photoId && patchesById[photoId] ? { ...(meta || {}), ...patchesById[photoId] } : meta;
    });
    const nextMetas = [...freshMetas, ...updatedExisting];
    applyGalleryMetas(nextMetas);
    return normalized.map(({ meta }) => getPhotoRecordId(meta)).filter(Boolean);
  }, [applyGalleryMetas]);

  const scheduleAnalysisPolling = React.useCallback((photoId) => {
    const key = String(photoId || '').trim();
    if (!key) return;
    if (analysisPollTimersRef.current[key]) return;
    setPhotoAnalysisPendingMap((prev) => ({ ...(prev || {}), [key]: true }));

    let attempts = 0;
    const poll = async () => {
      attempts += 1;
      try {
        const photo = await getPhotoById(key);
        const ready = mergePhotoAnalysisResult(photo);
        if (ready) {
          clearAnalysisPollTimer(key);
          return;
        }
      } catch (err) {
        console.warn('[ProjectDetail] photo analysis polling failed:', key, err);
      }

      if (attempts >= ANALYSIS_POLL_MAX_ATTEMPTS) {
        clearAnalysisPollTimer(key);
        return;
      }
      analysisPollTimersRef.current[key] = setTimeout(poll, ANALYSIS_POLL_INTERVAL_MS);
    };

    analysisPollTimersRef.current[key] = setTimeout(poll, ANALYSIS_POLL_INITIAL_DELAY_MS);
  }, [clearAnalysisPollTimer, mergePhotoAnalysisResult]);

  const mergeVideoPlaybackResult = React.useCallback((photo) => {
    const photoId = getPhotoRecordId(photo);
    if (!photoId || !photo || !isVideoMeta(photo)) return false;
    const playbackSrc = resolveAssetUrl(getVideoPlaybackCandidate(photo));
    if (!playbackSrc) return false;

    const currentMetas = Array.isArray(photoMetasRef.current) ? photoMetasRef.current : [];
    const nextMetas = currentMetas.map((meta) => {
      if (String(getPhotoRecordId(meta) || '') !== String(photoId)) return meta;
      return {
        ...(meta || {}),
        ...photo,
        thumbSrc: resolveAssetUrl(getPhotoThumbCandidate(photo)) || meta.thumbSrc || meta.thumbUrl,
        originalSrc: resolveAssetUrl(getPhotoOriginalCandidate(photo)) || meta.originalSrc || meta.url,
        playbackSrc,
        playbackUrl: photo.playbackUrl || photo.playback_url || meta.playbackUrl || meta.playback_url,
        playback_url: photo.playback_url || photo.playbackUrl || meta.playback_url || meta.playbackUrl,
        processingStatus: null,
        processing_status: null,
        uploadState: null,
        upload_state: null,
      };
    });
    applyGalleryMetas(nextMetas);
    return true;
  }, [applyGalleryMetas]);

  // 轮询超时（转码失败/任务丢失）时清掉 processing 状态，
  // 让视频解除锁定并回退播放原始文件，而不是永久"转码中"。
  const clearVideoProcessingState = React.useCallback((photoId) => {
    const currentMetas = Array.isArray(photoMetasRef.current) ? photoMetasRef.current : [];
    const nextMetas = currentMetas.map((meta) => {
      if (String(getPhotoRecordId(meta) || '') !== String(photoId)) return meta;
      return {
        ...(meta || {}),
        processingStatus: null,
        processing_status: null,
        uploadState: null,
        upload_state: null,
      };
    });
    applyGalleryMetas(nextMetas);
  }, [applyGalleryMetas]);

  const scheduleVideoPlaybackPolling = React.useCallback((photoId) => {
    const key = String(photoId || '').trim();
    if (!key) return;
    if (videoPlaybackPollTimersRef.current[key]) return;

    let attempts = 0;
    const poll = async () => {
      attempts += 1;
      try {
        const photo = await getPhotoById(key);
        const ready = mergeVideoPlaybackResult(photo);
        if (ready) {
          clearVideoPlaybackPollTimer(key);
          return;
        }
      } catch (err) {
        // 照片已被删除（404）：立即停止轮询
        const status = err && (err.status || err.statusCode);
        if (status === 404 || /404|not found/i.test(String(err && err.message || ''))) {
          clearVideoPlaybackPollTimer(key);
          return;
        }
        console.warn('[ProjectDetail] video playback polling failed:', key, err);
      }

      // 卸载/手动清理后 in-flight 的 await 恢复时不得复活定时器链
      if (!(key in videoPlaybackPollTimersRef.current)) return;

      if (attempts >= VIDEO_PLAYBACK_POLL_MAX_ATTEMPTS) {
        clearVideoPlaybackPollTimer(key);
        clearVideoProcessingState(key);
        return;
      }
      videoPlaybackPollTimersRef.current[key] = setTimeout(poll, VIDEO_PLAYBACK_POLL_INTERVAL_MS);
    };

    videoPlaybackPollTimersRef.current[key] = setTimeout(poll, VIDEO_PLAYBACK_POLL_INITIAL_DELAY_MS);
  }, [clearVideoPlaybackPollTimer, clearVideoProcessingState, mergeVideoPlaybackResult]);

  React.useEffect(() => {
    const metas = Array.isArray(photoMetas) ? photoMetas : [];
    metas.forEach((meta) => {
      const photoId = getPhotoRecordId(meta);
      if (!photoId) return;
      const semantic = extractPhotoSemantic(meta);
      if (semantic.analysisPending && !semantic.hasAnalysis) {
        scheduleAnalysisPolling(photoId);
      }
      if (isVideoMeta(meta) && getVideoUploadState(meta) === 'processing') {
        scheduleVideoPlaybackPolling(photoId);
      }
    });
  }, [photoMetas, scheduleAnalysisPolling, scheduleVideoPlaybackPolling]);

  const getPhotoSemanticState = React.useCallback((meta) => {
    const photoId = getPhotoRecordId(meta);
    const semantic = extractPhotoSemantic(meta);
    const hasMappedTags = photoId && Object.prototype.hasOwnProperty.call(photoTagsMap || {}, photoId);
    const mappedTags = hasMappedTags ? photoTagsMap[photoId] : undefined;
    const hasMappedDesc = photoId && Object.prototype.hasOwnProperty.call(photoDescMap || {}, photoId);
    const description = hasMappedDesc ? String(photoDescMap[photoId] || '').trim() : semantic.description;
    const tags = Array.isArray(mappedTags) ? mappedTags : semantic.tags;
    const hasAnalysis = Boolean(description || (Array.isArray(tags) && tags.length));
    const aiStatus = semantic.aiStatus;
    const statusPending = ACTIVE_ANALYSIS_STATUSES.has(aiStatus);
    return {
      photoId,
      description,
      tags: Array.isArray(tags) ? tags : [],
      hasAnalysis,
      aiStatus,
      failed: semantic.analysisFailed,
      pending: Boolean(photoId && (photoAnalysisPendingMap[photoId] || statusPending) && !hasAnalysis)
    };
  }, [photoTagsMap, photoDescMap, photoAnalysisPendingMap]);

  React.useEffect(() => {
    setSearchKeyword('');
    setSearchError('');
    setSearching(false);
    searchReqSeqRef.current = 0;
    hasSearchedRef.current = false;
  }, [projectId]);

  React.useEffect(() => {
    const timer = setTimeout(async () => {
      const q = String(searchKeyword || '').trim();
      const seq = searchReqSeqRef.current + 1;
      searchReqSeqRef.current = seq;

      if (!q) {
        setSearchError('');
        if (!hasSearchedRef.current) return;
        setSearching(true);
        try {
          await reloadGalleryFromServer();
          if (searchReqSeqRef.current === seq) {
            hasSearchedRef.current = false;
          }
        } catch (err) {
          if (searchReqSeqRef.current !== seq) return;
          setSearchError('恢复全部照片失败，请重试');
        } finally {
          if (searchReqSeqRef.current === seq) setSearching(false);
        }
        return;
      }

      if (!projectId) return;
      setSearching(true);
      setSearchError('');
      try {
        const resp = await searchPhotos({
          q,
          projectId,
          page: 1,
          pageSize: 200,
          sort: 'relevance',
          demo: readOnly,
        });
        if (searchReqSeqRef.current !== seq) return;
        const list = Array.isArray(resp?.list) ? resp.list : [];
        const nextMetas = list.map((it) => {
          const thumbSrc = resolveAssetUrl(getPhotoThumbCandidate(it));
          const originalSrc = resolveAssetUrl(getPhotoOriginalCandidate(it));
          const playbackSrc = resolveAssetUrl(getVideoPlaybackCandidate(it));
          return { ...it, thumbSrc, originalSrc, playbackSrc: playbackSrc || undefined };
        });
        const nextImages = nextMetas.map((m) => m.thumbSrc || resolveAssetUrl(getPhotoThumbCandidate(m))).filter(Boolean);

        const tagsPatch = {};
        const descPatch = {};
        const adjustmentsPatch = {};
        nextMetas.forEach((m) => {
          if (!m || !m.id) return;
          tagsPatch[m.id] = safeParseTags(m.tags);
          descPatch[m.id] = m.description || '';
          if (m.adjustments) adjustmentsPatch[m.id] = normalizePhotoAdjustments(m.adjustments);
        });
        if (Object.keys(tagsPatch).length) {
          setPhotoTagsMap((prev) => ({ ...(prev || {}), ...tagsPatch }));
        }
        if (Object.keys(descPatch).length) {
          setPhotoDescMap((prev) => ({ ...(prev || {}), ...descPatch }));
        }
        if (Object.keys(adjustmentsPatch).length) {
          setPhotoAdjustmentsMap((prev) => ({ ...(prev || {}), ...adjustmentsPatch }));
        }

        setDeleteMode(false);
        setSelectedMap({});
        setSelectedCount(0);
        setAllSelected(false);
        setImages(nextImages);
        setPhotoMetas(nextMetas);
        hasSearchedRef.current = true;
      } catch (err) {
        if (searchReqSeqRef.current !== seq) return;
        setSearchError(err?.body || err?.message || '搜索失败');
      } finally {
        if (searchReqSeqRef.current === seq) setSearching(false);
      }
    }, 260);

    return () => clearTimeout(timer);
  }, [searchKeyword, projectId, reloadGalleryFromServer, readOnly]);

  React.useEffect(() => {
    setUserPermissions(getPermissions());
  }, []);

  // ========== Upload / Edit / Selection handlers ==========
  const openUploadPicker = React.useCallback(() => {
    if (DISABLE_UPLOAD_FEATURE) {
      Toast.warning('上传功能已禁用');
      return;
    }
    if (uploadTimelineEnabled && uploadTimelineSections.length) {
      setUploadMode(true);
      return;
    }
    if (fileInputRef.current) fileInputRef.current.click();
  }, [DISABLE_UPLOAD_FEATURE, uploadTimelineEnabled, uploadTimelineSections]);

  const handleFilesSelected = React.useCallback((files, forcedSectionId) => {
    if (DISABLE_UPLOAD_FEATURE) {
      Toast.warning('上传功能已禁用');
      return;
    }
    const list = Array.from(files || []);
    if (!list.length) return;
    const acceptedList = [];
    let oversizedCount = 0;
    list.forEach((file) => {
      if (getUploadFileLimitError(file)) {
        oversizedCount += 1;
        return;
      }
      acceptedList.push(file);
    });
    if (oversizedCount) {
      Toast.warning(`已跳过 ${oversizedCount} 个超过 3GB 的视频`);
    }
    if (!acceptedList.length) return;
    const nextSectionId = String(forcedSectionId || selectedUploadSectionId || '');
    if (uploadTimelineEnabled && uploadTimelineSections.length && !nextSectionId) {
      Toast.warning('请先选择要上传的环节');
      setUploadMode(true);
      return;
    }
    setStagingFiles((prevFiles) => {
      const existing = new Set((prevFiles || []).map((file) => `${file.name}::${file.size}::${file.lastModified}`));
      const fresh = [];
      let skipped = 0;
      acceptedList.forEach((file) => {
        const key = `${file.name}::${file.size}::${file.lastModified}`;
        if (existing.has(key)) {
          skipped += 1;
          return;
        }
        existing.add(key);
        fresh.push(file);
      });
      if (skipped) Toast.warning(`已跳过 ${skipped} 个重复文件`);
      if (fresh.length) {
        setStagingPreviews((prev) => [
          ...(prev || []),
          ...fresh.map((file) => (isVideoMeta(file) || isBrowserUndisplayableImage(file) ? '' : URL.createObjectURL(file))),
        ]);
        setStagingSectionIds((prev) => [
          ...(prev || []),
          ...fresh.map(() => (uploadTimelineEnabled && uploadTimelineSections.length ? nextSectionId : '')),
        ]);
      }
      return [...(prevFiles || []), ...fresh];
    });
    setUploadMode(true);
    if (!uploading) setUploadProgress(null);
  }, [DISABLE_UPLOAD_FEATURE, selectedUploadSectionId, uploadTimelineEnabled, uploadTimelineSections, uploading]);

  const removeStagingFile = React.useCallback((index) => {
    setStagingFiles((prev) => {
      const next = [...(prev || [])];
      next.splice(index, 1);
      return next;
    });
    setStagingPreviews((prev) => {
      const next = [...(prev || [])];
      const removed = next.splice(index, 1);
      if (removed && removed[0]) {
        try { URL.revokeObjectURL(removed[0]); } catch (e) { }
      }
      return next;
    });
    setStagingSectionIds((prev) => {
      const next = [...(prev || [])];
      next.splice(index, 1);
      return next;
    });
    setUploadProgress(null);
  }, []);

  const assignStagingFileSection = React.useCallback((index, sectionId) => {
    setStagingSectionIds((prev) => {
      const next = [...(prev || [])];
      next[index] = String(sectionId || '');
      return next;
    });
  }, []);

  const cancelUpload = React.useCallback(() => {
    stagingPreviews.forEach((u) => { try { URL.revokeObjectURL(u); } catch (e) { } });
    setStagingFiles([]);
    setStagingPreviews([]);
    setStagingSectionIds([]);
    setUploadMode(false);
    setUploading(false);
    setUploadProgress(null);
  }, [stagingPreviews]);

  // 上传执行核心：staging 确认与"直接拖文件上传"共用
  const performUploadGroups = React.useCallback(async (groupedFiles, filesForProgress) => {
    if (!projectId) return;
    setUploading(true);
    setUploadProgress(createInitialUploadProgress(filesForProgress));
    let autoCollapsedUpload = false;
    const shouldAutoCollapseForVideoProcessing = filesForProgress.length > 0 && filesForProgress.every((file) => isVideoMeta(file));
    try {
      const results = [];
      const handleProgress = (event) => {
        if (event && event.phase === 'video-processing') {
          upsertVideoUploadPlaceholder(event, 'processing');
          if (shouldAutoCollapseForVideoProcessing) {
            autoCollapsedUpload = true;
            setUploadMode(false);
          }
        } else if (event && (event.phase === 'failed' || event.status === 'rejected')) {
          upsertVideoUploadPlaceholder(event, 'failed');
        }
        setUploadProgress((prev) => reduceUploadProgress(prev, event));
      };
      for (const [sectionId, files] of groupedFiles.entries()) {
        const groupResults = await uploadPhotoFiles(files, {
          projectId,
          timelineSectionId: uploadTimelineEnabled && uploadTimelineSections.length ? sectionId : undefined,
          onProgress: handleProgress,
        });
        results.push(...groupResults);
      }

      const failed = results.filter((r) => r && r.status === 'rejected');
      const succeeded = results.filter((r) => r && r.status === 'fulfilled');

      if (succeeded.length > 0 && failed.length === 0) {
        Toast.success('上传成功');
      } else if (succeeded.length > 0 && failed.length > 0) {
        Toast.warning(`上传完成：成功 ${succeeded.length} 张，失败 ${failed.length} 张`);
      } else {
        throw (failed[0] && failed[0].error) || new Error('上传失败');
      }

      if (succeeded.length > 0) {
        succeeded.forEach((result) => {
          if (result && result.file) removeVideoUploadPlaceholder(result.file);
        });
        const uploadedPhotos = succeeded
          .map((r) => (r && (r.response || r.photo)) || null)
          .filter((photo) => !!getPhotoRecordId(photo));
        const uploadedIds = prependUploadedPhotos(uploadedPhotos);
        uploadedIds.forEach((photoId) => scheduleAnalysisPolling(photoId));
        cancelUpload();
        // Refresh in background; don't block upload completion feedback.
        getProjectById(projectId, { demo: readOnly, includeFaces: false, timeoutMs: PROJECT_DETAIL_TIMEOUT_MS })
          .then((detail) => {
            setProject(detail);
            const built = buildImagesAndMetas(detail);
            // 项目详情接口不返回 processingStatus（DB 无此字段）：
            // 对仍无 playback 的视频保留旧 meta 里的转码中/失败状态，
            // 否则刷新几秒后占位被抹掉、查看器提前回退播还在转码的原片
            const prevById = new Map(
              (Array.isArray(photoMetasRef.current) ? photoMetasRef.current : [])
                .map((m) => [String(getPhotoRecordId(m) || ''), m])
                .filter(([k]) => k)
            );
            const mergedMetas = built.metas.map((meta) => {
              if (!isVideoMeta(meta) || getVideoPlaybackCandidate(meta)) return meta;
              const prev = prevById.get(String(getPhotoRecordId(meta) || ''));
              if (!prev || !getVideoUploadState(prev)) return meta;
              return {
                ...meta,
                processingStatus: prev.processingStatus || prev.processing_status || null,
                uploadState: prev.uploadState || prev.upload_state || null,
              };
            });
            setImages(built.images);
            setPhotoMetas(mergedMetas);
          })
          .catch(() => { /* ignore */ });
      }
    } catch (err) {
      console.error('upload error', err);
      if (autoCollapsedUpload) setUploadMode(true);
      Toast.error((err && err.userMessage) || '上传失败');
    } finally {
      setUploading(false);
    }
  }, [
    stagingFiles,
    stagingSectionIds,
    projectId,
    cancelUpload,
    DISABLE_UPLOAD_FEATURE,
    prependUploadedPhotos,
    upsertVideoUploadPlaceholder,
    removeVideoUploadPlaceholder,
    scheduleAnalysisPolling,
    readOnly,
    buildImagesAndMetas,
    uploadTimelineEnabled,
    uploadTimelineSections,
    hasUnassignedStagedFiles,
  ]);

  const confirmUpload = React.useCallback(async () => {
    if (DISABLE_UPLOAD_FEATURE) {
      Toast.warning('上传功能已禁用');
      return;
    }
    if (!stagingFiles.length || !projectId) return;
    if (uploadTimelineEnabled && uploadTimelineSections.length && hasUnassignedStagedFiles) {
      Toast.warning('还有照片未选择所属环节');
      return;
    }
    const groupedFiles = new Map();
    stagingFiles.forEach((file, index) => {
      const sectionId = uploadTimelineEnabled && uploadTimelineSections.length ? String(stagingSectionIds[index] || '') : '';
      if (!groupedFiles.has(sectionId)) groupedFiles.set(sectionId, []);
      groupedFiles.get(sectionId).push(file);
    });
    await performUploadGroups(groupedFiles, stagingFiles);
  }, [
    stagingFiles,
    stagingSectionIds,
    projectId,
    DISABLE_UPLOAD_FEATURE,
    uploadTimelineEnabled,
    uploadTimelineSections,
    hasUnassignedStagedFiles,
    performUploadGroups,
  ]);


  const openEdit = React.useCallback(() => {
    const p = project || {};
    setEditTitle(p.title || p.projectName || '');
    setEditDescription(p.description || '');
    setEditEventDate(p.date ? (p.date.slice && typeof p.date === 'string' ? new Date(p.date) : (p.date instanceof Date ? p.date : new Date(p.date))) : null);
    // populate tags for admin
    const incomingTags = p.tags || p.labels || p.tagList || p.projectTags || [];
    const normalized = Array.isArray(incomingTags) ? incomingTags.map((t) => (typeof t === 'string' ? t : String(t))).filter(Boolean) : (typeof incomingTags === 'string' ? incomingTags.split(/[;,\n]/).map(s => s.trim()).filter(Boolean) : []);
    setEditTags(normalized);
    setEditVisible(true);
  }, [project]);

  const saveEdit = React.useCallback(async () => {
    if (!projectId) return;
    try {
      // normalize eventDate to YYYY-MM-DD string or null
      let eventDatePayload = null;
      if (editEventDate) {
        if (editEventDate instanceof Date) {
          const y = editEventDate.getFullYear();
          const m = String(editEventDate.getMonth() + 1).padStart(2, '0');
          const d = String(editEventDate.getDate()).padStart(2, '0');
          eventDatePayload = `${y}-${m}-${d}`;
        } else {
          eventDatePayload = String(editEventDate).slice(0, 10);
        }
      }

      const payload = { projectName: editTitle, description: editDescription, eventDate: eventDatePayload || null };
      // only include tags when current user has permission
      if (canUpdateProject || canEditTags) {
        payload.tags = editTags && editTags.length ? editTags : [];
      }
      await updateProject(projectId, payload);
      Toast.success('已保存');
      setEditVisible(false);
      // reload
      const detail = await getProjectById(projectId, {
        demo: readOnly,
        includeFaces: false,
        timeoutMs: PROJECT_DETAIL_TIMEOUT_MS,
      });
      setProject(detail);
      const built = buildImagesAndMetas(detail);
      setImages(built.images);
      setPhotoMetas(built.metas);
    } catch (err) {
      console.error('saveEdit error', err);
      const status = err && err.status ? err.status : (err && err.cause && err.cause.status) ? err.cause.status : null;
      if (status === 401 || status === 403) {
        try { localStorage.removeItem('mamage_jwt_token'); } catch (e) { }
        Toast.error('请重新登录管理员账号');
        try { window.history.pushState({}, '', '/login'); } catch (e) { window.location.href = '/login'; }
      } else if (status === 404) {
        Toast.warning('相册已不存在');
        if (typeof onBack === 'function') onBack(true);
      } else if (status && status >= 500) {
        Toast.error('服务器异常，请稍后重试');
      } else {
        Toast.error('保存失败');
      }
    }
  }, [projectId, editTitle, editDescription, editEventDate, readOnly]);

  // ===== 时间线环节编辑 =====
  const refreshProjectDetail = React.useCallback(async () => {
    const detail = await getProjectById(projectId, {
      demo: readOnly,
      includeFaces: false,
      timeoutMs: PROJECT_DETAIL_TIMEOUT_MS,
    });
    setProject(detail);
    const built = buildImagesAndMetas(detail);
    setImages(built.images);
    setPhotoMetas(built.metas);
    return detail;
  }, [projectId, readOnly, buildImagesAndMetas]);

  const openTimelineEdit = React.useCallback(() => {
    const edits = {};
    (uploadTimelineSections || []).forEach((s) => {
      if (s && s.id) edits[String(s.id)] = { name: s.name || '', sectionTime: s.sectionTime || '' };
    });
    setSectionRowEdits(edits);
    setTimelineDraftName('');
    setTimelineDraftTime('');
    setTimelineEditVisible(true);
  }, [uploadTimelineSections]);

  const runTimelineAction = React.useCallback(async (fn, successText) => {
    if (timelineBusy) return;
    setTimelineBusy(true);
    try {
      await fn();
      await refreshProjectDetail();
      if (successText) Toast.success(successText);
    } catch (err) {
      console.error('timeline action error', err);
      const body = err && err.body ? String(err.body) : '';
      if (err && err.status === 409) Toast.warning('同名环节已存在');
      else if (err && err.status === 403) Toast.error('没有权限');
      else Toast.error(`操作失败${body ? `：${body.slice(0, 80)}` : ''}`);
    } finally {
      setTimelineBusy(false);
    }
  }, [timelineBusy, refreshProjectDetail]);

  const handleAddSection = React.useCallback(() => {
    const name = String(timelineDraftName || '').trim();
    if (!name) { Toast.warning('请输入环节名称'); return; }
    runTimelineAction(async () => {
      const created = await createTimelineSection(projectId, { name, sectionTime: String(timelineDraftTime || '').trim() || undefined });
      setTimelineDraftName('');
      setTimelineDraftTime('');
      if (created && created.id) {
        setSectionRowEdits((prev) => ({ ...prev, [String(created.id)]: { name: created.name || name, sectionTime: created.sectionTime || '' } }));
      }
    }, '环节已添加');
  }, [projectId, timelineDraftName, timelineDraftTime, runTimelineAction]);

  const handleSaveSectionRow = React.useCallback((sectionId) => {
    const edit = sectionRowEdits[String(sectionId)];
    if (!edit) return;
    const name = String(edit.name || '').trim();
    if (!name) { Toast.warning('环节名称不能为空'); return; }
    runTimelineAction(
      () => updateTimelineSection(projectId, sectionId, { name, sectionTime: String(edit.sectionTime || '').trim() || null }),
      '已保存'
    );
  }, [projectId, sectionRowEdits, runTimelineAction]);

  const handleDeleteSection = React.useCallback((section) => {
    if (!section || !section.id) return;
    Modal.confirm({
      title: `删除环节「${section.name}」？`,
      content: '该环节下的照片不会被删除，会回落到"未归类"。',
      okText: '删除',
      cancelText: '取消',
      onOk: () => runTimelineAction(
        () => deleteTimelineSection(projectId, section.id),
        '环节已删除'
      ),
    });
  }, [projectId, runTimelineAction]);

  const handleMoveSectionOrder = React.useCallback((sectionId, direction) => {
    const list = (uploadTimelineSections || []).filter((s) => s && s.id);
    const idx = list.findIndex((s) => String(s.id) === String(sectionId));
    const target = idx + direction;
    if (idx < 0 || target < 0 || target >= list.length) return;
    const ids = list.map((s) => s.id);
    [ids[idx], ids[target]] = [ids[target], ids[idx]];
    runTimelineAction(() => reorderTimelineSections(projectId, ids), null);
  }, [projectId, uploadTimelineSections, runTimelineAction]);

  // 拖拽排序：把第 from 行移动到第 target 行的位置
  const commitSectionDrag = React.useCallback((targetIdx) => {
    const from = dragSectionIdx;
    setDragSectionIdx(null);
    setDragOverSectionIdx(null);
    if (from === null || targetIdx === null || from === targetIdx) return;
    const list = (uploadTimelineSections || []).filter((s) => s && s.id);
    if (from < 0 || from >= list.length || targetIdx < 0 || targetIdx >= list.length) return;
    const ids = list.map((s) => s.id);
    const [moved] = ids.splice(from, 1);
    ids.splice(targetIdx, 0, moved);
    runTimelineAction(() => reorderTimelineSections(projectId, ids), null);
  }, [dragSectionIdx, projectId, uploadTimelineSections, runTimelineAction]);

  const handleAssignSelectedToSection = React.useCallback(async (sectionId) => {
    if (assigningSection) return;
    const idxs = Object.keys(selectedMap || {}).map((k) => Number(k)).sort((a, b) => a - b);
    const photoIds = idxs
      .map((idx) => getPhotoRecordId(photoMetas?.[idx]))
      .map((v) => Number(v))
      .filter((n) => Number.isFinite(n) && n > 0);
    if (!photoIds.length) { Toast.warning('先选择照片'); return; }
    setAssigningSection(true);
    try {
      const result = await assignPhotosTimelineSection(photoIds, sectionId);
      await refreshProjectDetail();
      setMoveSectionVisible(false);
      setDeleteMode(false);
      setSelectedMap({});
      setSelectedCount(0);
      setAllSelected(false);
      Toast.success(sectionId === null ? `已移出环节（${result.updated} 张）` : `已移入环节（${result.updated} 张）`);
    } catch (err) {
      console.error('assign section error', err);
      if (err && err.status === 400 && String(err.body || '').includes('PHOTO_PROJECT_MISMATCH')) {
        Toast.error('所选照片与环节不属于同一相册');
      } else if (err && err.status === 403) {
        Toast.error('没有权限');
      } else {
        Toast.error('移动失败，请稍后重试');
      }
    } finally {
      setAssigningSection(false);
    }
  }, [assigningSection, selectedMap, photoMetas, refreshProjectDetail]);

  // 系统文件直接拖入：免打开上传弹窗，落点决定所属环节
  const handleDirectFileDrop = React.useCallback((e, sectionId) => {
    e.preventDefault();
    if (typeof e.stopPropagation === 'function') e.stopPropagation();
    fileDragDepthRef.current = 0;
    setFileDragActive(false);
    setRailDropKey(null);
    // 嵌套落点（占位区→环节区块→window）会让同一次松手触发多次；ref 同步守卫
    if (dropGestureGuardRef.current) return;
    dropGestureGuardRef.current = true;
    setTimeout(() => { dropGestureGuardRef.current = false; }, 600);
    if (!canUploadPhotos) { Toast.warning('当前账号没有上传权限'); return; }
    if (uploading) { Toast.warning('正在上传中，请稍候再拖入'); return; }
    const dropped = Array.from((e.dataTransfer && e.dataTransfer.files) || []);
    const mediaFiles = dropped.filter((f) => /^(image|video)\//.test(f.type) || /\.(jpe?g|png|webp|gif|heic|heif|mp4|mov|m4v|webm|ogg)$/i.test(f.name || ''));
    if (!mediaFiles.length) { if (dropped.length) Toast.warning('仅支持图片或视频文件'); return; }
    const accepted = [];
    let oversized = 0;
    mediaFiles.forEach((f) => { if (getUploadFileLimitError(f)) oversized += 1; else accepted.push(f); });
    if (oversized) Toast.warning(`已跳过 ${oversized} 个超限文件`);
    if (!accepted.length) return;
    const key = uploadTimelineEnabled && uploadTimelineSections.length ? String(sectionId || '') : '';
    // 直接拖拽（未打开上传弹窗）也自动弹开上传界面，展示完整加载/进度面板；
    // 成功后 performUploadGroups→cancelUpload 会自动关闭，失败则保留弹窗展示失败明细。
    if (uploadTimelineEnabled && uploadTimelineSections.length) setSelectedUploadSectionId(key);
    setUploadMode(true);
    performUploadGroups(new Map([[key, accepted]]), accepted);
  }, [canUploadPhotos, uploading, uploadTimelineEnabled, uploadTimelineSections, performUploadGroups]);

  React.useEffect(() => { directFileDropRef.current = handleDirectFileDrop; }, [handleDirectFileDrop]);

  React.useEffect(() => {
    let raf = 0;
    let attempts = 0;
    const measure = () => {
      const el = railRef.current;
      if (!el) {
        // nav 可能晚于分组数据挂载（等 galleryPrepared），rAF 重试直到出现
        if (attempts < 30) { attempts += 1; raf = requestAnimationFrame(measure); }
        return;
      }
      setRailOverflow(el.scrollWidth > el.clientWidth + 4 || el.scrollHeight > el.clientHeight + 4);
      const spans = el.querySelectorAll('.detail-timeline-rail-text span');
      let truncated = false;
      spans.forEach((sp) => { if (sp.scrollWidth > sp.clientWidth + 1) truncated = true; });
      setRailNameTruncated(truncated);
    };
    measure();
    window.addEventListener('resize', measure);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => measure()) : null;
    if (ro && railRef.current) ro.observe(railRef.current);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener('resize', measure);
      if (ro) ro.disconnect();
    };
  }, [timelineGalleryGroups, railExpanded, railWide, useTimelineGallery]);

  // 拖拽照片放到左侧环节导航：批量移入该环节（未归类=移出）；拖入系统文件则直接上传到该环节
  const handleRailDrop = React.useCallback(async (e, group) => {
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
      handleDirectFileDrop(e, group && group.id ? group.id : '');
      return;
    }
    e.preventDefault();
    if (typeof e.stopPropagation === 'function') e.stopPropagation();
    setRailDropKey(null);
    setPhotoDragActive(false);
    if (assigningSection) return;
    let payload = null;
    try {
      const raw = e.dataTransfer.getData('application/x-mamage-photo') || e.dataTransfer.getData('application/json');
      payload = raw ? JSON.parse(raw) : null;
    } catch (err) { payload = null; }
    const items = Array.isArray(payload) ? payload : (payload ? [payload] : []);
    const photoIds = items.map((it) => Number(it && (it.id || it.photoId))).filter((n) => Number.isFinite(n) && n > 0);
    if (!photoIds.length) return;
    const sectionId = group && group.id ? Number(group.id) : null;
    setAssigningSection(true);
    try {
      const result = await assignPhotosTimelineSection(photoIds, sectionId);
      await refreshProjectDetail();
      Toast.success(sectionId === null ? `已移出环节（${result.updated} 张）` : `已移入「${group.name}」（${result.updated} 张）`);
    } catch (err) {
      console.error('rail drop assign error', err);
      Toast.error('移动失败，请稍后重试');
    } finally {
      setAssigningSection(false);
    }
  }, [assigningSection, refreshProjectDetail, handleDirectFileDrop]);

  // 窗口级文件拖入侦测：进入相册页任意位置即提示可上传；
  // 无环节相册整页即落点，带环节相册在窗口级 drop 仅收尾（各环节区/导航各自处理）
  React.useEffect(() => {
    if (!canUploadPhotos || typeof window === 'undefined') return undefined;
    const hasFiles = (e) => {
      try { return Array.from(e.dataTransfer?.types || []).includes('Files'); } catch (err) { return false; }
    };
    const onEnter = (e) => {
      if (!hasFiles(e)) return;
      fileDragDepthRef.current += 1;
      setFileDragActive(true);
    };
    const onLeave = (e) => {
      if (!hasFiles(e)) return;
      fileDragDepthRef.current = Math.max(0, fileDragDepthRef.current - 1);
      if (!fileDragDepthRef.current) { setFileDragActive(false); setRailDropKey(null); }
    };
    const onOver = (e) => { if (hasFiles(e)) e.preventDefault(); };
    const onDrop = (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      const insideZone = e.target && e.target.closest && e.target.closest('[data-file-drop-zone="1"]');
      if (!insideZone && directFileDropRef.current) {
        // 无环节相册：整页任意位置松手都上传；带环节相册落到空白处 → 未归类
        directFileDropRef.current(e, '');
        return;
      }
      fileDragDepthRef.current = 0;
      setFileDragActive(false);
      setRailDropKey(null);
    };
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('dragover', onOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('drop', onDrop);
    };
  }, [canUploadPhotos]);

  const handleDeleteProject = React.useCallback(() => {
    if (DISABLE_DELETE_FEATURE) {
      Toast.warning('删除功能已禁用');
      return;
    }
    if (!projectId) return Toast.warning('无效的项目ID');
    Modal.confirm({
      title: '确认删除相册',
      content: '删除后将不可恢复，且可能同时删除关联照片。确定要删除该相册吗？',
      onOk: async () => {
        setDeletingProject(true);
        try {
          const res = await deleteProject(projectId);
          // assume success if no exception; backend may return { success: true }
          Toast.success('相册已删除');
          if (typeof onBack === 'function') {
            onBack(true);
          }
        } catch (err) {
          console.error('deleteProject error', err);
          const status = err && err.status ? err.status : (err && err.cause && err.cause.status) ? err.cause.status : null;
          if (status === 401 || status === 403) {
            try { localStorage.removeItem('mamage_jwt_token'); } catch (e) { }
            Toast.error('权限不足或登录已过期，请重新登录或联系管理员');
            try { window.history.pushState({}, '', '/login'); } catch (e) { window.location.href = '/login'; }
          } else if (status === 404) {
            Toast.warning('相册已不存在');
            if (typeof onBack === 'function') onBack(true);
          } else if (status && status >= 500) {
            Toast.error('服务器异常，请稍后重试');
          } else {
            Toast.error('删除失败');
          }
        } finally {
          setDeletingProject(false);
        }
      }
    });
  }, [projectId, onBack, DISABLE_DELETE_FEATURE]);

  const getMediaFilteredIndexes = React.useCallback(() => {
    const total = Array.isArray(images) ? images.length : 0;
    const indexes = [];
    for (let i = 0; i < total; i += 1) {
      const meta = photoMetas?.[i] || {};
      const isVideo = isVideoMeta(meta);
      if (mediaFilter === 'video' && !isVideo) continue;
      if (mediaFilter === 'image' && isVideo) continue;
      indexes.push(i);
    }
    return indexes;
  }, [images, photoMetas, mediaFilter]);

  const toggleDeleteMode = React.useCallback(() => {
    const turningOff = !!deleteMode;
    setDeleteMode(!deleteMode);
    if (turningOff) {
      setSelectedMap({});
      setSelectedCount(0);
      setAllSelected(false);
    }
  }, [deleteMode]);

  const toggleSelect = React.useCallback((index) => {
    const key = String(index);
    const map = Object.assign({}, selectedMap || {});
    if (map[key]) delete map[key]; else map[key] = true;
    const count = Object.keys(map).length;
    const filteredKeys = new Set(getMediaFilteredIndexes().map((i) => String(i)));
    const visibleSelectedCount = Object.keys(map).filter((k) => filteredKeys.has(k)).length;
    setSelectedMap(map);
    setSelectedCount(count);
    setAllSelected(filteredKeys.size > 0 && visibleSelectedCount === filteredKeys.size);
  }, [selectedMap, getMediaFilteredIndexes]);

  const toggleSelectAll = React.useCallback(() => {
    const indexes = getMediaFilteredIndexes();
    if (!indexes.length) return;
    const map = Object.assign({}, selectedMap || {});
    const everyVisibleSelected = indexes.every((i) => !!map[String(i)]);
    if (everyVisibleSelected) {
      indexes.forEach((i) => { delete map[String(i)]; });
    } else {
      indexes.forEach((i) => { map[String(i)] = true; });
    }
    setSelectedMap(map);
    setSelectedCount(Object.keys(map).length);
    setAllSelected(!everyVisibleSelected);
  }, [getMediaFilteredIndexes, selectedMap]);

  React.useEffect(() => {
    if (!deleteMode) return;
    const indexes = getMediaFilteredIndexes();
    if (!indexes.length) {
      setAllSelected(false);
      return;
    }
    const selectedVisibleCount = indexes.filter((i) => !!selectedMap[String(i)]).length;
    setAllSelected(selectedVisibleCount === indexes.length);
  }, [deleteMode, getMediaFilteredIndexes, selectedMap]);

  const confirmDelete = React.useCallback(() => {
    if (DISABLE_DELETE_FEATURE) {
      Toast.warning('删除功能已禁用');
      return;
    }
    const indexes = Object.keys(selectedMap || {}).map(k => Number(k));
    if (!indexes.length) return Toast.warning('鏈€夋嫨鐓х墖');
    const ids = indexes.map(i => {
      const meta = (photoMetas && photoMetas[i]) || null;
      if (!meta) return null;
      return meta.id || meta.photoId || meta.photo_id || null;
    }).filter(Boolean);
    if (!ids.length) return Toast.warning('所选照片没有可删除的 ID');

    Modal.confirm({
      title: '确认删除所选照片',
      content: `删除后不可恢复，确定要删除 ${ids.length} 张照片吗？`,
      onOk: async () => {
        setDeletingPhotos(true);
        try {
          const res = await deletePhotos(ids);
          // res expected to be { deletedIds: [], notFoundIds: [] } or similar
          const deleted = (res && (res.deletedIds || res.deleted || res.deleted_ids)) || [];
          const notFound = (res && (res.notFoundIds || res.not_found_ids || res.notFound || [])) || [];
          if (Array.isArray(deleted) && deleted.length > 0) {
            Toast.success(`已删除 ${deleted.length} 张`);
          } else {
            Toast.success('删除成功');
          }
          if (Array.isArray(notFound) && notFound.length > 0) {
            Toast.warning('部分照片已不存在');
          }
          // 主画廊删过照片后相似分组缓存作废，下次打开重新拉取
          setSimGroups(null);
          setSimPhotos({});
          // reload project detail
          try {
            const detail = await getProjectById(projectId, {
              demo: readOnly,
              includeFaces: false,
              timeoutMs: PROJECT_DETAIL_TIMEOUT_MS,
            });
            setProject(detail);
            const built = buildImagesAndMetas(detail);
            setImages(built.images);
            setPhotoMetas(built.metas);
          } catch (e) {
            console.error('reload after delete failed', e);
          }
          setDeleteMode(false); setSelectedMap({}); setSelectedCount(0); setAllSelected(false);
        } catch (err) {
          console.error('delete error', err);
          // handle different status codes if available
          const status = err && err.status ? err.status : (err && err.cause && err.cause.status) ? err.cause.status : null;
          const body = err && err.body ? err.body : null;
          if (status === 400) {
            Toast.warning('请选择至少一张照片');
          } else if (status === 401 || status === 403) {
            // clear token and redirect to login
            try { localStorage.removeItem('mamage_jwt_token'); } catch (e) { }
            Toast.error('权限不足或登录已过期，请重新登录或联系管理员');
            try { window.history.pushState({}, '', '/login'); } catch (e) { window.location.href = '/login'; }
          } else {
            Toast.error('服务器异常，请稍后重试');
          }
        } finally {
          setDeletingPhotos(false);
        }
      }
    });
  }, [selectedMap, images, projectId, DISABLE_DELETE_FEATURE]);

  // ========== Download helpers ==========
  const getSelectedIndexes = React.useCallback(() => Object.keys(selectedMap || {}).map((k) => Number(k)).sort((a, b) => a - b), [selectedMap]);

  const getDownloadAdjustmentForMeta = React.useCallback((meta) => {
    const photoId = getPhotoRecordId(meta);
    return normalizePhotoAdjustments((photoId && photoAdjustmentsMap[photoId]) || meta?.adjustments || DEFAULT_PHOTO_ADJUSTMENTS);
  }, [photoAdjustmentsMap]);

  const inferDownloadExt = React.useCallback((rawUrl) => {
    try {
      const u = new URL(String(rawUrl || ''), window.location.origin);
      const m = String(u.pathname || '').match(/\.([a-zA-Z0-9]{2,6})$/);
      return m && m[1] ? `.${String(m[1]).toLowerCase()}` : '.jpg';
    } catch (e) {
      return '.jpg';
    }
  }, []);

  const buildDownloadBaseName = React.useCallback((meta, index) => {
    return String(meta?.title || meta?.name || `photo-${meta?.id || index + 1}`)
      .replace(/[\\/:*?"<>|]/g, '_')
      .slice(0, 64) || `photo-${index + 1}`;
  }, []);

  const triggerBlobDownload = React.useCallback((blob, filename) => {
    const objectUrl = URL.createObjectURL(blob);
    try {
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } finally {
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);
    }
  }, []);

  const triggerUrlDownload = React.useCallback((url, filename) => {
    const isSameOrigin = (() => {
      try {
        const u = new URL(String(url || ''), window.location.origin);
        return u.origin === window.location.origin;
      } catch (e) {
        return false;
      }
    })();
    const a = document.createElement('a');
    a.href = url;
    if (!isSameOrigin) {
      a.target = '_blank';
      a.rel = 'noopener';
    }
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }, []);

  const canvasToBlob = React.useCallback((canvas, type = 'image/jpeg', quality = 0.94) => new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('无法生成下载图片'));
    }, type, quality);
  }), []);

  const fetchDownloadPixelSource = React.useCallback(async (photoId) => {
    if (!photoId) return null;
    const token = getToken();
    const pixelUrl = `${BASE_URL || ''}/api/photos/${encodeURIComponent(String(photoId))}/pixel-source?variant=original`;
    const response = await fetch(pixelUrl, {
      method: 'GET',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      credentials: 'same-origin',
    });
    if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? '无权读取照片像素' : '无法读取照片像素');
    return response.blob();
  }, []);

  const fetchRenderedPhotoBlob = React.useCallback(async (photoId, adjustments, options = {}) => {
    return requestRenderedToneBlob(photoId, adjustments, {
      variant: options.variant || 'original',
      maxSize: options.maxSize || 4096,
      format: options.format || 'jpeg',
      quality: options.quality || 96,
      cache: false,
    });
  }, []);

  const downloadRenderedPhoto = React.useCallback(async (meta, index, options = {}) => {
    const url = meta?.originalSrc || meta?.url || meta?.thumbSrc || images[index];
    if (!url) throw new Error('无法获取媒体资源');
    const adjustments = getDownloadAdjustmentForMeta(meta);
    const baseName = buildDownloadBaseName(meta, index);

    if (isVideoMeta(meta) || options.forceOriginal || isDefaultPhotoAdjustments(adjustments)) {
      triggerUrlDownload(url, `${baseName}${inferDownloadExt(url)}`);
      return { rendered: false };
    }

    let objectUrl = '';
    try {
      const photoId = getPhotoRecordId(meta);
      const renderedBlob = await fetchRenderedPhotoBlob(photoId, adjustments, {
        variant: 'original',
        maxSize: 4096,
        format: 'jpeg',
        quality: 96,
      });
      if (renderedBlob) {
        triggerBlobDownload(renderedBlob, `${baseName}.jpg`);
        return { rendered: true };
      }

      const sourceBlob = await fetchDownloadPixelSource(photoId);
      const renderSrc = sourceBlob ? URL.createObjectURL(sourceBlob) : url;
      objectUrl = sourceBlob ? renderSrc : '';
      const canvas = document.createElement('canvas');
      await renderPhotoAdjustmentsToCanvas(canvas, renderSrc, adjustments, { maxSize: 4096 });
      const blob = await canvasToBlob(canvas, 'image/jpeg', 0.94);
      triggerBlobDownload(blob, `${baseName}.jpg`);
      return { rendered: true };
    } finally {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    }
  }, [
    buildDownloadBaseName,
    canvasToBlob,
    fetchDownloadPixelSource,
    fetchRenderedPhotoBlob,
    getDownloadAdjustmentForMeta,
    images,
    inferDownloadExt,
    triggerBlobDownload,
    triggerUrlDownload,
  ]);

  const downloadCurrentPhoto = React.useCallback(async () => {
    const idx = viewerIndex;
    const meta = (photoMetas && photoMetas[idx]) || {};
    const url = meta.originalSrc || meta.url || meta.thumbSrc || images[idx];
    if (!url) return Toast.warning('无法获取媒体资源');
    try {
      const result = await downloadRenderedPhoto(meta, idx);
      Toast.success(currentViewerIsVideo ? '已开始下载视频' : (result.rendered ? '已下载调色后的照片' : '已开始下载原图'));
    } catch (err) {
      console.error('downloadCurrentPhoto error', err);
      Toast.error(err?.message || '下载失败');
    }
  }, [viewerIndex, photoMetas, images, downloadRenderedPhoto, currentViewerIsVideo]);

  // Expose a global getter so the floating TransferStation can read current selection
  React.useEffect(() => {
    // return array of simple metas: { id, url, thumbSrc, originalSrc, projectTitle }
    window.__MAMAGE_GET_CURRENT_PROJECT_SELECTION = () => {
      try {
        const idxs = getSelectedIndexes();
        // try to infer project title from available state
        const srcProjectName = (project && (project.title || project.projectName || project.name))
          || (initialProject && (initialProject.title || initialProject.projectName || initialProject.name))
          || '项目';
        return idxs.map((i) => {
          const meta = (photoMetas && photoMetas[i]) || {};
          const pid = meta.id || meta.photoId || meta.photo_id || null;
          const cachedFaces = pid ? (viewerFaceMap && viewerFaceMap[String(pid)]) : null;
          const faceNames = extractFaceNamesFromMeta(meta, cachedFaces);
          return {
            id: pid,
            url: meta.originalSrc || meta.url || meta.thumbSrc || images[i] || null,
            thumbSrc: meta.thumbSrc || images[i] || null,
            originalSrc: meta.originalSrc || images[i] || null,
            description: (pid && photoDescMap && photoDescMap[pid]) ? photoDescMap[pid] : (meta.description || ''),
            tags: (pid && photoTagsMap && photoTagsMap[pid]) ? photoTagsMap[pid] : (safeParseTags(meta.tags) || []),
            adjustments: getDownloadAdjustmentForMeta(meta),
            projectTitle: srcProjectName,
            photographerId: meta.photographerId || meta.photographer_id || null,
            photographerName: meta.photographerName || meta.photographer_name || '',
            faceNames,
            personNames: faceNames,
            faces: Array.isArray(cachedFaces) ? cachedFaces : (Array.isArray(meta.faces) ? meta.faces : []),
          };
        }).filter(Boolean);
      } catch (e) {
        return [];
      }
    };
    return () => {
      try { delete window.__MAMAGE_GET_CURRENT_PROJECT_SELECTION; } catch (e) { window.__MAMAGE_GET_CURRENT_PROJECT_SELECTION = undefined; }
    };
  }, [getSelectedIndexes, photoMetas, images, project, initialProject, photoDescMap, photoTagsMap, viewerFaceMap, getDownloadAdjustmentForMeta]);

  const downloadSelectedIndividually = React.useCallback(async () => {
    const idxs = getSelectedIndexes();
    if (!idxs.length) return Toast.warning('未选择照片');
    let prepared = 0;
    let rendered = 0;
    let failed = 0;
    if (idxs.length > 1) Toast.info('正在准备下载照片');

    for (const i of idxs) {
      const meta = (photoMetas && photoMetas[i]) || {};
      const url = meta.originalSrc || meta.url || meta.thumbSrc || images[i];
      if (!url) continue;
      try {
        const result = await downloadRenderedPhoto(meta, i);
        if (result.rendered) rendered += 1;
        prepared += 1;
      } catch (e) {
        console.error('downloadSelectedIndividually item failed', e);
        failed += 1;
      }
      if (prepared + failed < idxs.length) {
        await new Promise((resolve) => setTimeout(resolve, 90));
      }
    }

    if (prepared > 0) {
      if (failed > 0) {
        Toast.warning(`已下载 ${prepared}/${idxs.length} 张，${failed} 张失败`);
      } else {
        Toast.success(rendered > 0 ? `已开始下载 ${prepared} 张（${rendered} 张已烘焙调色）` : `已开始下载 ${prepared} 张`);
      }
      if (prepared > 1) {
        Toast.info('若浏览器仅下载 1 张，请在浏览器设置里允许该站点“多文件下载”');
      }
    } else {
      Toast.error('下载失败');
    }
  }, [getSelectedIndexes, photoMetas, images, downloadRenderedPhoto]);




  const packDownloadSelected = React.useCallback(() => {
    const count = getSelectedIndexes().length;
    if (!count) return Toast.warning('未选择照片');
    Modal.confirm({
      title: '确认直接下载',
      content: count > 1
        ? `将直接下载 ${count} 张照片（不打包）。若浏览器拦截多文件下载，请在浏览器里允许该站点“多文件下载”。`
        : '将直接下载当前选中照片。',
      okText: '开始下载',
      cancelText: '取消',
      onOk: () => {
        downloadSelectedIndividually();
      },
    });
  }, [getSelectedIndexes, downloadSelectedIndividually]);

  const resolvedProject = project || initialProject;

  const title = resolvedProject?.title ?? resolvedProject?.projectName ?? resolvedProject?.name ?? '未命名项目';
  const subtitle = resolvedProject?.subtitle ?? resolvedProject?.tagline ?? resolvedProject?.category ?? '';
  const description = resolvedProject?.description ?? resolvedProject?.intro ?? resolvedProject?.description ?? '';
  // tags: try multiple common field names and normalize to array of strings
  const rawTags = resolvedProject?.tags || resolvedProject?.labels || resolvedProject?.projectTags || resolvedProject?.tagList || null;
  const tags = React.useMemo(() => {
    if (!rawTags) return [];
    if (Array.isArray(rawTags)) return rawTags.filter(Boolean).map((t) => (typeof t === 'string' ? t : String(t)));
    if (typeof rawTags === 'string') {
      const s = rawTags.trim();
      // try parse JSON array/string
      if ((s.startsWith('[') && s.endsWith(']')) || (s.startsWith('{') && s.endsWith('}'))) {
        try {
          const parsed = JSON.parse(s);
          if (Array.isArray(parsed)) return parsed.filter(Boolean).map((t) => (typeof t === 'string' ? t : String(t)));
          // if parsed is object, try to extract values
          return Object.values(parsed).map((v) => (v && v.name) ? v.name : String(v)).filter(Boolean);
        } catch (e) {
          // fallthrough to splitting
        }
      }
      return s.split(/[;,\n]+/).map((ss) => ss.trim()).filter(Boolean);
    }
    // object or other shape: try to extract name properties or values
    try {
      const vals = Object.values(rawTags || {});
      if (vals.length && (typeof vals[0] === 'string' || typeof vals[0] === 'number')) {
        return vals.map((v) => String(v)).filter(Boolean);
      }
      return vals.map((v) => (v && v.name) ? v.name : String(v)).filter(Boolean);
    } catch (e) {
      return [];
    }
  }, [rawTags]);

  const aiSelectionStats = React.useMemo(() => {
    const stats = { recommended: 0, medium: 0, rejected: 0, total: 0 };
    (photoMetas || []).forEach((meta) => {
      const photoId = getPhotoRecordId(meta);
      if (!photoId) return;
      const label = photoAILabelMap[photoId];
      const currentTags = Array.isArray(photoTagsMap[photoId]) ? photoTagsMap[photoId] : safeParseTags(meta.tags);
      if (label === 'recommended' || currentTags.includes('推荐')) {
        stats.recommended += 1;
      } else if (label === 'medium') {
        stats.medium += 1;
      } else if (label === 'rejected') {
        stats.rejected += 1;
      }
    });
    stats.total = stats.recommended + stats.medium + stats.rejected;
    return stats;
  }, [photoMetas, photoAILabelMap, photoTagsMap]);

  const toggleAILabels = React.useCallback(() => {
    const nextVisible = !showAILabels;
    setShowAILabels(nextVisible);
    if (!nextVisible) return;
    if (!aiSelectionStats.total) {
      Toast.info('当前相册暂无 AI 选片结果，照片分析完成后会显示推荐/不推荐标记');
      return;
    }
    Toast.info(`AI 选片：推荐 ${aiSelectionStats.recommended} 张，中等 ${aiSelectionStats.medium} 张，不推荐 ${aiSelectionStats.rejected} 张`);
  }, [showAILabels, aiSelectionStats]);

  // expose resolved project and tags for easy debugging in browser console
  React.useEffect(() => {
    try {
      // eslint-disable-next-line no-console
      console.debug('[ProjectDetail] resolvedProject:', resolvedProject);
      // eslint-disable-next-line no-console
      console.debug('[ProjectDetail] parsed tags:', tags);
      try { window.__MAMAGE_LAST_PROJECT = { resolvedProject: resolvedProject || null, tags: tags || [] }; } catch (e) { }
    } catch (e) { }
  }, [resolvedProject, tags]);
  // compute display dates: start (event) and created
  const startRaw = resolvedProject?.eventDate ?? resolvedProject?.startDate ?? resolvedProject?.date ?? resolvedProject?.shootDate ?? null;
  const createdRaw = resolvedProject?.createdAt ?? resolvedProject?.created_at ?? null;
  const updatedRaw = resolvedProject?.updatedAt ?? resolvedProject?.updated_at ?? resolvedProject?.modifiedAt ?? resolvedProject?.modified_at ?? null;
  const date = resolvedProject?.date ?? resolvedProject?.shootDate ?? resolvedProject?.updatedAt ?? resolvedProject?.createdAt ?? '';

  const formatToMinute = (val) => {
    if (!val && val !== 0) return null;
    try {
      const dt = (typeof val === 'string' || typeof val === 'number') ? new Date(val) : (val instanceof Date ? val : new Date(String(val)));
      if (isNaN(dt.getTime())) return null;
      const y = dt.getFullYear();
      const m = String(dt.getMonth() + 1).padStart(2, '0');
      const d = String(dt.getDate()).padStart(2, '0');
      const hh = String(dt.getHours()).padStart(2, '0');
      const mm = String(dt.getMinutes()).padStart(2, '0');
      return `${y}-${m}-${d} ${hh}:${mm}`;
    } catch (e) {
      return null;
    }
  };

  const startText = formatToMinute(startRaw);
  const createdText = formatToMinute(createdRaw);
  const updatedText = formatToMinute(updatedRaw);
  const count = resolvedProject?.photoCount ?? resolvedProject?.count ?? images.length;
  const coverSrc = resolvedProject?.coverSrc
    || resolvedProject?.coverThumbUrl
    || resolvedProject?.coverUrl
    || resolvedProject?.cover
    || photoMetas?.[0]?.thumbSrc
    || photoMetas?.[0]?.thumbUrl
    || photoMetas?.[0]?.thumbnail
    || photoMetas?.[0]?.url
    || images?.[0]
    || '';
  const masonryColumns = React.useMemo(() => {
    const w = galleryWidth || 0;
    if (!w) return 3;
    if (w <= 768) return 2;
    // Force desktop to at least 4 columns so it won't fall back to 3 too early.
    if (w <= 1200) return 4;
    return Math.max(4, Math.floor((w + 12) / (240 + 12)));
  }, [galleryWidth]);

  const mediaStats = React.useMemo(() => {
    let video = 0;
    let image = 0;
    (images || []).forEach((src, idx) => {
      if (!src) return;
      const meta = photoMetas?.[idx] || {};
      if (isVideoMeta(meta)) video += 1;
      else image += 1;
    });
    return { image, video, total: image + video };
  }, [photoMetas, images]);

  React.useEffect(() => {
    setGalleryRenderLimit(GALLERY_INITIAL_RENDER_LIMIT);
  }, [projectId, searchKeyword, mediaFilter]);

  const mediaFilteredIndexes = React.useMemo(() => getMediaFilteredIndexes(), [getMediaFilteredIndexes]);
  const visiblePhotoCount = Math.min(mediaFilteredIndexes.length, Math.max(GALLERY_INITIAL_RENDER_LIMIT, galleryRenderLimit));
  const visiblePhotoItems = React.useMemo(
    () => mediaFilteredIndexes
      .slice(0, visiblePhotoCount)
      .map((idx) => ({ src: images[idx], idx }))
      .filter((item) => !!item.src),
    [mediaFilteredIndexes, visiblePhotoCount, images]
  );
  const hasMoreGalleryPhotos = visiblePhotoCount < mediaFilteredIndexes.length;
  const searchKeywordTrimmed = String(searchKeyword || '').trim();
  const useTimelineGallery = Boolean(uploadTimelineEnabled && uploadTimelineSections.length);
  const timelineGalleryGroups = React.useMemo(() => {
    if (!useTimelineGallery) return [];
    const normalizeDomIdPart = (value) => String(value || '')
      .replace(/[^a-zA-Z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40);
    const groups = uploadTimelineSections.map((section, sectionIndex) => ({
      ...section,
      domId: `timeline-section-${projectId}-${sectionIndex}-${normalizeDomIdPart(section.id || section.key || section.name || sectionIndex)}`,
      items: [],
    }));
    const byId = new Map(groups.filter((section) => section.id).map((section) => [String(section.id), section]));
    const uncategorized = {
      id: '',
      key: '__uncategorized__',
      domId: `timeline-section-${projectId}-uncategorized`,
      name: '未归类',
      sectionTime: '',
      sortOrder: 999999,
      items: [],
    };
    visiblePhotoItems.forEach(({ src, idx }) => {
      const meta = photoMetas?.[idx] || {};
      const sectionId = getPhotoTimelineSectionId(meta);
      const target = sectionId ? byId.get(String(sectionId)) : null;
      (target || uncategorized).items.push({ src, idx });
    });
    return [
      // 空环节保留占位：移空不消失，避免"环节被删了"的错觉
      ...groups,
      ...(uncategorized.items.length ? [uncategorized] : []),
    ];
  }, [useTimelineGallery, uploadTimelineSections, visiblePhotoItems, photoMetas, projectId]);

  React.useEffect(() => {
    if (!projectId || !useTimelineGallery) return;
    const key = String(projectId);
    if (timelineDefaultModeProjectRef.current === key) return;
    timelineDefaultModeProjectRef.current = key;
    if (controlledGalleryMode) {
      if (controlledGalleryMode !== 'grid' && onGalleryModeChange) onGalleryModeChange('grid');
      return;
    }
    setInternalGalleryMode('grid');
  }, [controlledGalleryMode, onGalleryModeChange, projectId, useTimelineGallery]);
  const detailSearchVisible = Boolean(searchOpen || searching || searchError || searchKeywordTrimmed);
  const mediaFilterLabel = mediaFilter === 'video' ? '视频' : (mediaFilter === 'image' ? '照片' : '全部');
  const compactCountText = mediaFilter === 'all'
    ? (hasMoreGalleryPhotos ? `${count} 张，已显示 ${visiblePhotoCount}` : `${count} 张照片`)
    : `${mediaFilterLabel} ${mediaFilteredIndexes.length} 个，已显示 ${visiblePhotoCount}`;
  const mediaFilterOptions = React.useMemo(() => ([
    { key: 'all', label: '全部', count: mediaStats.total },
    { key: 'image', label: '只看照片', count: mediaStats.image },
    { key: 'video', label: '只看视频', count: mediaStats.video },
  ]), [mediaStats]);
  React.useEffect(() => {
    if (typeof onProjectHeaderChange !== 'function') return;
    onProjectHeaderChange({
      id: projectId,
      title,
      subtitle,
      description,
      count,
      createdText,
      updatedText,
      tags,
      coverSrc: coverSrc ? resolveAssetUrl(coverSrc) : '',
    });
  }, [onProjectHeaderChange, projectId, title, subtitle, description, count, createdText, updatedText, tags, coverSrc]);
  React.useEffect(() => () => {
    if (typeof onProjectHeaderChange === 'function') onProjectHeaderChange(null);
  }, [onProjectHeaderChange]);
  const loadMoreGalleryPhotos = React.useCallback(() => {
    setGalleryRenderLimit((prev) => Math.min(
      mediaFilteredIndexes.length,
      Math.max(GALLERY_INITIAL_RENDER_LIMIT, prev + GALLERY_RENDER_BATCH_SIZE)
    ));
  }, [mediaFilteredIndexes.length]);

  const isGalleryPreparing = !loading && !error && visiblePhotoItems.length > 0 && !galleryPrepared;

  const renderTimelineGroupItems = (group) => {
    const items = Array.isArray(group?.items) ? group.items : [];
    if (galleryMode === 'masonry') {
      const cols = Math.max(1, masonryColumns);
      const buckets = Array.from({ length: cols }, () => ({ h: 0, items: [] }));
      items.forEach((item) => {
        const ratio = imageRatios[item.src] || 1.5;
        const estHeight = 1 / Math.max(0.2, ratio);
        let minCol = 0;
        for (let i = 1; i < buckets.length; i += 1) {
          if (buckets[i].h < buckets[minCol].h) minCol = i;
        }
        buckets[minCol].items.push(item);
        buckets[minCol].h += estHeight;
      });
      return (
        <div className="detail-masonry-columns detail-timeline-masonry" style={{ '--masonry-cols': buckets.length }}>
          {buckets.map((bucket, colIdx) => (
            <div className="detail-masonry-column" key={`${group.key}-col-${colIdx}`}>
              {bucket.items.map(({ src, idx }) => renderPhotoItem(src, idx))}
            </div>
          ))}
        </div>
      );
    }
    return (
      <div className="detail-timeline-grid">
        {items.map(({ src, idx }) => renderPhotoItem(src, idx))}
      </div>
    );
  };

  if (!projectId) {
    return null;
  }

  const handleImageLoad = React.useCallback((src, event) => {
    const { naturalWidth, naturalHeight } = event.target;
    if (!naturalWidth || !naturalHeight) return;
    setImageRatios((prev) => {
      if (prev[src]) return prev;
      const nextRatio = naturalWidth / naturalHeight;
      ratioCacheRef.current[src] = nextRatio;
      return { ...prev, [src]: nextRatio };
    });
  }, []);

  React.useEffect(() => {
    const list = Array.isArray(visiblePhotoItems) ? visiblePhotoItems.filter((item) => item && item.src) : [];
    if (!list.length) {
      setGalleryPrepared(true);
      return undefined;
    }

    const readMetaRatio = (meta) => {
      if (!meta || typeof meta !== 'object') return null;
      const width = Number(
        meta.width
        ?? meta.w
        ?? meta.imageWidth
        ?? meta.naturalWidth
        ?? meta.pixelWidth
      );
      const height = Number(
        meta.height
        ?? meta.h
        ?? meta.imageHeight
        ?? meta.naturalHeight
        ?? meta.pixelHeight
      );
      if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        return null;
      }
      return width / height;
    };

    const nextRatios = {};

    list.forEach(({ src, idx }) => {
      const cachedRatio = imageRatios[src] || ratioCacheRef.current[src] || readMetaRatio(photoMetas?.[idx]);
      if (cachedRatio && Number.isFinite(cachedRatio) && cachedRatio > 0) {
        nextRatios[src] = cachedRatio;
        ratioCacheRef.current[src] = cachedRatio;
      }
    });

    if (Object.keys(nextRatios).length) {
      setImageRatios((prev) => {
        let changed = false;
        const merged = { ...prev };
        Object.keys(nextRatios).forEach((src) => {
          const ratio = nextRatios[src];
          if (!ratio || !Number.isFinite(ratio) || ratio <= 0) return;
          if (merged[src] !== ratio) {
            merged[src] = ratio;
            changed = true;
          }
        });
        return changed ? merged : prev;
      });
    }

    setGalleryPrepared(true);
    return undefined;
  }, [visiblePhotoItems, photoMetas, imageRatios]);

  React.useEffect(() => {
    if (!galleryPrepared || !hasMoreGalleryPhotos) return undefined;
    const target = galleryMoreRef.current;
    if (!target || typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        loadMoreGalleryPhotos();
      }
    }, { rootMargin: '700px 0px 900px 0px' });
    observer.observe(target);
    return () => observer.disconnect();
  }, [galleryPrepared, hasMoreGalleryPhotos, loadMoreGalleryPhotos]);

  React.useEffect(() => {
    setDetailImageReadyMap((prev) => {
      const next = {};
      (images || []).forEach((src, idx) => {
        const key = `${idx}|${src}`;
        if (prev[key]) next[key] = true;
      });
      return next;
    });
  }, [images]);

  React.useEffect(() => {
    if (!galleryRef.current) return undefined;
    const update = () => {
      if (!galleryRef.current) return;
      setGalleryWidth(Math.floor(galleryRef.current.clientWidth));
    };
    update();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    if (ro) ro.observe(galleryRef.current);
    window.addEventListener('resize', update);
    return () => {
      if (ro) ro.disconnect();
      window.removeEventListener('resize', update);
    };
  }, []);

  // While dragging project photos, keep copy cursor globally and avoid forbidden icon.
  React.useEffect(() => {
    const onDragOver = (e) => {
      try {
        const types = Array.from(e.dataTransfer?.types || []);
        if (types.includes('application/x-mamage-photo')) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
        }
      } catch (err) {
        // ignore
      }
    };
    const onDrop = (e) => {
      try {
        const types = Array.from(e.dataTransfer?.types || []);
        if (types.includes('application/x-mamage-photo')) {
          e.preventDefault();
        }
      } catch (err) {
        // ignore
      }
    };
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onDrop);
    };
  }, []);

  // reset viewer original flag when opening viewer or switching slides
  React.useEffect(() => {
    if (viewerVisible) setViewerShowOriginal(false);
  }, [viewerVisible, viewerIndex]);

  React.useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    document.body.classList.toggle('mamage-viewer-open', viewerVisible);
    return () => document.body.classList.remove('mamage-viewer-open');
  }, [viewerVisible]);

  const getViewerTargetSrc = React.useCallback((index, showOriginal = false) => {
    const meta = photoMetas?.[index] || {};
    if (isVideoMeta(meta)) {
      // 优先 web 转码产物；仍在转码中的新上传不回退（由占位 UI 呈现），
      // 存量视频无 playback 时回退原始文件，保持可播。
      const playback = getVideoPlaybackCandidate(meta);
      if (playback) return playback;
      if (getVideoUploadState(meta)) return '';
      return meta.originalSrc || meta.url || '';
    }
    if (showOriginal) return meta.originalSrc || meta.url || meta.thumbSrc || images[index] || '';
    return meta.thumbSrc || images[index] || meta.originalSrc || meta.url || '';
  }, [photoMetas, images]);

  const getMetaPhotoId = React.useCallback((meta) => {
    if (!meta) return null;
    const raw = meta.id || meta.photoId || meta.photo_id || null;
    if (raw === null || raw === undefined) return null;
    const sid = String(raw).trim();
    return sid || null;
  }, []);

  const currentViewerPhotoId = React.useMemo(() => getMetaPhotoId(photoMetas?.[viewerIndex]), [photoMetas, viewerIndex, getMetaPhotoId]);
  const currentViewerIsVideo = React.useMemo(() => isVideoMeta(photoMetas?.[viewerIndex]), [photoMetas, viewerIndex]);
  const currentViewerFaces = React.useMemo(() => (currentViewerPhotoId ? (viewerFaceMap[currentViewerPhotoId] || []) : []), [currentViewerPhotoId, viewerFaceMap]);
  const currentViewerFaceError = currentViewerPhotoId ? (viewerFaceErrorMap[currentViewerPhotoId] || '') : '';
  const getAdjustmentForPhoto = React.useCallback((meta) => {
    const photoId = getPhotoRecordId(meta);
    return normalizePhotoAdjustments((photoId && photoAdjustmentsMap[photoId]) || meta?.adjustments || DEFAULT_PHOTO_ADJUSTMENTS);
  }, [photoAdjustmentsMap]);
  const currentViewerAdjustment = React.useMemo(() => getAdjustmentForPhoto(photoMetas?.[viewerIndex]), [getAdjustmentForPhoto, photoMetas, viewerIndex]);
  const currentViewerToneSrc = React.useMemo(() => getViewerTargetSrc(viewerIndex, false), [getViewerTargetSrc, viewerIndex]);

  const handleViewerImageLoad = React.useCallback((photoId, e) => {
    if (!photoId || !e?.target) return;
    const width = toFiniteNumber(e.target.naturalWidth);
    const height = toFiniteNumber(e.target.naturalHeight);
    if (!width || !height) return;
    setViewerImageNaturalMap((prev) => {
      const old = prev[photoId];
      if (old && old.width === width && old.height === height) return prev;
      return { ...(prev || {}), [photoId]: { width, height } };
    });
  }, []);

  const analyzeViewerTone = React.useCallback(async (adjustments) => {
    if (!currentViewerToneSrc) throw new Error('缺少图片地址');
    if (!currentViewerPhotoId) {
      return analyzePhotoTone(currentViewerToneSrc, adjustments, { maxSize: 640 });
    }
    const token = getToken();
    const pixelUrl = `${BASE_URL || ''}/api/photos/${encodeURIComponent(String(currentViewerPhotoId))}/pixel-source?variant=thumb`;
    const response = await fetch(pixelUrl, {
      method: 'GET',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      credentials: 'same-origin',
    });
    if (!response.ok) {
      throw new Error(response.status === 401 || response.status === 403 ? '无权读取照片像素' : '无法读取照片像素');
    }
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    try {
      return await analyzePhotoTone(objectUrl, adjustments, { maxSize: 640 });
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }, [currentViewerPhotoId, currentViewerToneSrc]);

  React.useEffect(() => {
    setViewerToneVisible(false);
    setViewerToneError('');
    setViewerToneAnalysis(null);
    setViewerToneDraft(currentViewerAdjustment);
  }, [currentViewerPhotoId, currentViewerAdjustment]);

  React.useEffect(() => {
    if (!viewerToneVisible || !currentViewerToneSrc) return undefined;
    const seq = toneAnalysisSeqRef.current + 1;
    toneAnalysisSeqRef.current = seq;
    setViewerToneAnalyzing(true);
    setViewerToneError('');
    const timer = setTimeout(() => {
      analyzeViewerTone(viewerToneDraft)
        .then((result) => {
          if (toneAnalysisSeqRef.current !== seq) return;
          setViewerToneAnalysis(result);
        })
        .catch((err) => {
          if (toneAnalysisSeqRef.current !== seq) return;
          setViewerToneAnalysis(null);
          setViewerToneError(err?.message || '直方图计算失败');
        })
        .finally(() => {
          if (toneAnalysisSeqRef.current === seq) setViewerToneAnalyzing(false);
        });
    }, 90);
    return () => clearTimeout(timer);
  }, [viewerToneVisible, currentViewerToneSrc, viewerToneDraft, analyzeViewerTone]);

  const patchPhotoAdjustmentState = React.useCallback((photoId, adjustments) => {
    if (!photoId) return;
    const normalized = normalizePhotoAdjustments(adjustments);
    setPhotoAdjustmentsMap((prev) => ({ ...(prev || {}), [photoId]: normalized }));
    setPhotoMetas((prev) => (Array.isArray(prev)
      ? prev.map((meta) => (String(getPhotoRecordId(meta) || '') === String(photoId) ? { ...(meta || {}), adjustments: normalized } : meta))
      : prev));
  }, []);

  const openToneEditor = React.useCallback(() => {
    if (!currentViewerPhotoId) return Toast.warning('无法获取照片 ID');
    setViewerEditVisible(false);
    setViewerToneDraft(currentViewerAdjustment);
    setViewerToneVisible((prev) => !prev);
  }, [currentViewerAdjustment, currentViewerPhotoId]);

  const updateToneDraft = React.useCallback((key, value) => {
    setViewerToneDraft((prev) => buildPhotoAdjustments({ ...normalizePhotoAdjustments(prev), [key]: Number(value) }, 'manual'));
  }, []);

  const autoTuneCurrentPhoto = React.useCallback(async () => {
    if (!currentViewerToneSrc) return;
    const seq = toneAnalysisSeqRef.current + 1;
    toneAnalysisSeqRef.current = seq;
    setViewerToneAnalyzing(true);
    setViewerToneError('');
    try {
      const result = await analyzeViewerTone(DEFAULT_PHOTO_ADJUSTMENTS);
      if (toneAnalysisSeqRef.current !== seq) return;
      setViewerToneAnalysis(result);
      setViewerToneDraft(result.autoAdjustments);
    } catch (err) {
      if (toneAnalysisSeqRef.current !== seq) return;
      setViewerToneError(err?.message || '自动调节失败');
    } finally {
      if (toneAnalysisSeqRef.current === seq) setViewerToneAnalyzing(false);
    }
  }, [analyzeViewerTone, currentViewerToneSrc]);

  const saveViewerTone = React.useCallback(async () => {
    if (!currentViewerPhotoId) return Toast.warning('无法获取照片 ID');
    try {
      setViewerToneSaving(true);
      const adjustments = buildPhotoAdjustments(viewerToneDraft, 'manual');
      const data = await updatePhoto(currentViewerPhotoId, { adjustments });
      const saved = normalizePhotoAdjustments(data?.adjustments || adjustments);
      patchPhotoAdjustmentState(currentViewerPhotoId, saved);
      setViewerToneDraft(saved);
      Toast.success('调色参数已保存');
    } catch (err) {
      console.error('saveViewerTone error', err);
      Toast.error(err?.body || err?.message || '保存调色参数失败');
    } finally {
      setViewerToneSaving(false);
    }
  }, [currentViewerPhotoId, patchPhotoAdjustmentState, viewerToneDraft]);

  const resetViewerTone = React.useCallback(() => {
    setViewerToneDraft(buildPhotoAdjustments(DEFAULT_PHOTO_ADJUSTMENTS, 'manual'));
  }, []);

  const getViewerFaceBoxStyle = React.useCallback((face, photoId) => {
    if (!face) return { display: 'none' };
    let left = toFiniteNumber(face.left);
    let top = toFiniteNumber(face.top);
    let width = toFiniteNumber(face.width);
    let height = toFiniteNumber(face.height);
    if (left === null || top === null || width === null || height === null) return { display: 'none' };

    if (face.unit !== 'ratio') {
      const fallback = viewerImageNaturalMap && photoId ? viewerImageNaturalMap[photoId] : null;
      const baseW = toFiniteNumber(face.imageWidth) || toFiniteNumber(fallback?.width);
      const baseH = toFiniteNumber(face.imageHeight) || toFiniteNumber(fallback?.height);
      if (baseW && baseH) {
        left = left / baseW;
        top = top / baseH;
        width = width / baseW;
        height = height / baseH;
      } else if (!(Math.abs(left) <= 1.05 && Math.abs(top) <= 1.05 && Math.abs(width) <= 1.2 && Math.abs(height) <= 1.2)) {
        return { display: 'none' };
      }
    }

    const l = Math.max(0, Math.min(1, left));
    const t = Math.max(0, Math.min(1, top));
    const w = Math.max(0.03, Math.min(1 - l, width));
    const h = Math.max(0.03, Math.min(1 - t, height));
    return {
      left: `${l * 100}%`,
      top: `${t * 100}%`,
      width: `${w * 100}%`,
      height: `${h * 100}%`,
    };
  }, [viewerImageNaturalMap]);

  const pickFacePersonHeroPhoto = React.useCallback((data) => {
    const related = Array.isArray(data?.relatedPhotos) ? data.relatedPhotos.filter(Boolean) : [];
    if (!related.length) return null;
    const sourceFacePhotoId = String(data?.sourceFace?.photoId || data?.sourceFace?.raw?.photoId || '').trim();
    if (sourceFacePhotoId) {
      const exact = related.find((p) => String(p?.photoId || p?.id || '').trim() === sourceFacePhotoId);
      if (exact) return exact;
    }
    const idx = Math.floor(Math.random() * related.length);
    return related[idx] || related[0] || null;
  }, []);

  const getFaceHeroImageStyle = React.useCallback((data, heroPhoto) => {
    const base = { width: '100%', height: '100%', objectFit: 'cover' };
    if (!data || !heroPhoto) return base;
    const sourceFace = data.sourceFace || null;
    if (!sourceFace) return base;
    const sourceFacePhotoId = String(sourceFace.photoId || sourceFace.raw?.photoId || '').trim();
    const heroPhotoId = String(heroPhoto.photoId || heroPhoto.id || '').trim();
    if (!sourceFacePhotoId || !heroPhotoId || sourceFacePhotoId !== heroPhotoId) return base;

    let left = toFiniteNumber(sourceFace.left);
    let top = toFiniteNumber(sourceFace.top);
    let width = toFiniteNumber(sourceFace.width);
    let height = toFiniteNumber(sourceFace.height);
    if (left === null || top === null || width === null || height === null) return base;

    if (sourceFace.unit !== 'ratio') {
      const iw = toFiniteNumber(sourceFace.imageWidth);
      const ih = toFiniteNumber(sourceFace.imageHeight);
      if (iw && ih) {
        left /= iw;
        top /= ih;
        width /= iw;
        height /= ih;
      } else {
        return base;
      }
    }

    const cx = Math.max(0, Math.min(1, left + (width / 2)));
    const cy = Math.max(0, Math.min(1, top + (height / 2)));
    // Push horizontal framing slightly outward from center:
    // right-side faces move a bit more right, left-side faces a bit more left.
    const biasedCx = Math.max(0.04, Math.min(0.96, 0.5 + ((cx - 0.5) * 1.18)));
    const faceSize = Math.max(width, height);
    // Make avatar a face close-up: smaller face box => stronger zoom.
    const targetFaceSizeInAvatar = 0.62;
    const rawScale = faceSize > 0 ? (targetFaceSizeInAvatar / faceSize) : 1;
    const zoom = Math.max(1, Math.min(3.4, rawScale));
    return {
      ...base,
      objectPosition: `${(biasedCx * 100).toFixed(2)}% ${(cy * 100).toFixed(2)}%`,
      transformOrigin: `${(biasedCx * 100).toFixed(2)}% ${(cy * 100).toFixed(2)}%`,
      transform: `scale(${zoom.toFixed(3)})`,
    };
  }, []);

  const closeFacePersonModal = React.useCallback(() => {
    setFacePersonVisible(false);
    setFacePersonLoading(false);
    setFacePersonSaving(false);
    setFacePersonError('');
    setFacePersonEditName('');
    setFacePersonHeroPhoto(null);
  }, []);

  const openFacePersonModal = React.useCallback(async (face) => {
    if (!face) return;
    const seedData = normalizeFacePerson({}, face);
    setFacePersonError('');
    setFacePersonVisible(true);
    setFacePersonData(seedData);
    setFacePersonEditName(seedData.personName || '');
    setFacePersonHeroPhoto(pickFacePersonHeroPhoto(seedData));

    if (!face.faceId && !face.personId) return;

    setFacePersonLoading(true);
    try {
      const data = await getFacePersonInfo({
        faceId: face.faceId || undefined,
        personId: face.personId || undefined,
        projectId: projectId || undefined,
      });
      const normalized = normalizeFacePerson(data, face);
      setFacePersonData(normalized);
      setFacePersonEditName(normalized.personName || '');
      setFacePersonHeroPhoto(pickFacePersonHeroPhoto(normalized));
    } catch (err) {
      console.error('getFacePersonInfo failed', err);
      setFacePersonError(err?.body || err?.message || '获取人物信息失败');
    } finally {
      setFacePersonLoading(false);
    }
  }, [pickFacePersonHeroPhoto, projectId]);

  const saveFacePersonName = React.useCallback(async () => {
    if (!facePersonData) return;
    const nextName = String(facePersonEditName || '').trim();
    if (!nextName) {
      Toast.warning('请输入人物姓名');
      return;
    }

    if (!facePersonData.personId && !facePersonData.faceId) {
      Toast.warning('缺少人物或人脸标识，无法保存');
      return;
    }

    setFacePersonSaving(true);
    setFacePersonError('');
    try {
      let data;
      if (facePersonData.personId) {
        data = await renameFacePerson({
          personId: facePersonData.personId,
          personName: nextName,
        });
      } else {
        data = await labelFacePerson({
          faceId: facePersonData.faceId,
          personName: nextName,
        });
      }

      const normalized = normalizeFacePerson(data, {
        faceId: facePersonData.faceId || '',
        personId: facePersonData.personId || '',
        personName: nextName,
      });
      const patched = {
        ...facePersonData,
        ...normalized,
        personName: nextName,
        displayName: nextName,
      };
      setFacePersonData(patched);
      setFacePersonEditName(nextName);

      setViewerFaceMap((prev) => {
        const targetFaceId = patched.faceId ? String(patched.faceId) : '';
        const targetPersonId = patched.personId ? String(patched.personId) : '';
        let changed = false;
        const nextMap = {};
        Object.keys(prev || {}).forEach((photoIdKey) => {
          const list = prev[photoIdKey];
          if (!Array.isArray(list)) {
            nextMap[photoIdKey] = list;
            return;
          }
          let listChanged = false;
          const nextList = list.map((face) => {
            const row = (face && typeof face === 'object') ? face : {};
            const rowFaceId = row.faceId || row.face_id ? String(row.faceId || row.face_id) : '';
            const rowPersonId = row.personId || row.person_id ? String(row.personId || row.person_id) : '';
            const matchedByFace = targetFaceId && rowFaceId && rowFaceId === targetFaceId;
            const matchedByPerson = !matchedByFace && targetPersonId && rowPersonId && rowPersonId === targetPersonId;
            if (!matchedByFace && !matchedByPerson) return row;
            listChanged = true;
            changed = true;
            const nextPersonId = targetPersonId || rowPersonId || '';
            return {
              ...row,
              personId: nextPersonId,
              personName: nextName,
              label: nextName || (nextPersonId ? `人物#${nextPersonId}` : row.label),
            };
          });
          nextMap[photoIdKey] = listChanged ? nextList : list;
        });
        return changed ? nextMap : prev;
      });

      Toast.success('人物姓名已更新');
    } catch (err) {
      console.error('saveFacePersonName failed', err);
      let msg = err?.message || '更新人物姓名失败';
      if (err?.body) {
        try {
          const parsed = typeof err.body === 'string' ? JSON.parse(err.body) : err.body;
          msg = parsed?.message || parsed?.error || msg;
        } catch (e) {
          msg = typeof err.body === 'string' ? err.body : msg;
        }
      }
      setFacePersonError(msg);
      Toast.error(msg);
    } finally {
      setFacePersonSaving(false);
    }
  }, [facePersonData, facePersonEditName]);

  const openRelatedFacePhoto = React.useCallback((photo) => {
    if (!photo) return;
    const targetIdRaw = photo.id || photo.photoId || photo.photo_id || '';
    const targetId = targetIdRaw ? String(targetIdRaw) : '';
    const targetProjectIdRaw = photo.projectId || photo.project_id || '';
    const targetProjectId = targetProjectIdRaw ? String(targetProjectIdRaw).trim() : '';
    const hitIdx = targetId ? (photoMetas || []).findIndex((m) => String(getMetaPhotoId(m) || '') === targetId) : -1;
    if (hitIdx >= 0) {
      closeFacePersonModal();
      setViewerEnableOpenZoom(false);
      setViewerShowOriginal(false);
      setViewerIndex(hitIdx);
      return;
    }
    if (targetProjectId && typeof window !== 'undefined') {
      closeFacePersonModal();
      try {
        const url = new URL(window.location.href);
        url.searchParams.set('projectId', targetProjectId);
        if (targetId) {
          url.searchParams.set('photoId', targetId);
        } else {
          url.searchParams.delete('photoId');
        }
        window.history.pushState({}, '', url);
        try {
          window.dispatchEvent(new PopStateEvent('popstate'));
        } catch (evtErr) {
          window.dispatchEvent(new Event('popstate'));
        }
        return;
      } catch (e) {
        // fallback below
      }
    }
    const url = photo.url || photo.thumbUrl || '';
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
  }, [photoMetas, getMetaPhotoId, closeFacePersonModal]);

  const getStoredFacesByPhotoId = React.useCallback((photoId) => {
    if (!photoId) return null;
    const sid = String(photoId);
    const meta = (photoMetas || []).find((m) => String(getMetaPhotoId(m) || '') === sid);
    if (!meta) return null;

    const faces = normalizeFaceDetections(meta);
    if (faces.length > 0) return faces;

    if (Array.isArray(meta.faces)) return [];
    const zeroCount = Number(meta.faceCount ?? meta.face_count ?? meta.facesCount ?? meta.faces_count);
    if (Number.isFinite(zeroCount) && zeroCount <= 0) return [];

    return null;
  }, [photoMetas, getMetaPhotoId]);

  const ensureViewerFacesCached = React.useCallback(async (photoId, opts = {}) => {
    if (!photoId) return { loaded: false, faces: [] };
    const sid = String(photoId);
    const silent = Boolean(opts && opts.silent);

    if (Object.prototype.hasOwnProperty.call(viewerFaceMap || {}, sid)) {
      const cached = Array.isArray(viewerFaceMap[sid]) ? viewerFaceMap[sid] : [];
      return { loaded: true, faces: cached };
    }

    const stored = getStoredFacesByPhotoId(sid);
    if (stored) {
      setViewerFaceMap((prev) => ({ ...(prev || {}), [sid]: stored }));
      setViewerFaceErrorMap((prev) => ({ ...(prev || {}), [sid]: '' }));
      return { loaded: true, faces: stored };
    }

    if (viewerFaceFetchPromiseRef.current[sid]) {
      return viewerFaceFetchPromiseRef.current[sid];
    }

    const task = (async () => {
      try {
        const payload = await getPhotoFaces(sid, { projectId: projectId || undefined });
        const fetched = normalizeFaceDetections(payload);
        setViewerFaceMap((prev) => ({ ...(prev || {}), [sid]: fetched }));
        setViewerFaceErrorMap((prev) => ({ ...(prev || {}), [sid]: '' }));
        return { loaded: true, faces: fetched };
      } catch (e) {
        if (!silent) {
          setViewerFaceErrorMap((prev) => ({ ...(prev || {}), [sid]: '人脸未识别完成，请稍后重试' }));
        }
        return { loaded: false, faces: [] };
      } finally {
        if (viewerFaceFetchPromiseRef.current[sid]) {
          delete viewerFaceFetchPromiseRef.current[sid];
        }
      }
    })();

    viewerFaceFetchPromiseRef.current[sid] = task;
    return task;
  }, [viewerFaceMap, getStoredFacesByPhotoId, projectId]);

  const handleDetectViewerFaces = React.useCallback(async () => {
    const meta = photoMetas?.[viewerIndex] || null;
    const photoId = getMetaPhotoId(meta);
    if (!photoId) {
      Toast.warning('当前照片缺少ID，无法显示人脸框');
      return;
    }

    if (Array.isArray(viewerFaceMap[photoId])) {
      if (!viewerFaceMap[photoId].length) {
        Toast.info('未检测到人脸');
        return;
      }
      setViewerFaceOverlayVisible((prev) => !prev);
      return;
    }

    const { loaded, faces } = await ensureViewerFacesCached(photoId);
    if (!loaded) {
      Toast.warning('人脸未识别完成，请稍后重试');
      return;
    }
    if (!faces.length) {
      Toast.info('未检测到人脸');
      return;
    }
    setViewerFaceOverlayVisible(true);
  }, [photoMetas, viewerIndex, getMetaPhotoId, viewerFaceMap, ensureViewerFacesCached]);

  React.useEffect(() => {
    if (!viewerVisible || !viewerFaceOverlayVisible) return;
    if (!currentViewerPhotoId) return;
    if (Array.isArray(viewerFaceMap[currentViewerPhotoId])) return;
    let active = true;
    (async () => {
      const { loaded } = await ensureViewerFacesCached(currentViewerPhotoId, { silent: true });
      if (!loaded && active) {
        setViewerFaceErrorMap((prev) => ({ ...(prev || {}), [currentViewerPhotoId]: '人脸未识别完成，请稍后重试' }));
      }
    })();
    return () => { active = false; };
  }, [viewerVisible, viewerFaceOverlayVisible, currentViewerPhotoId, viewerFaceMap, ensureViewerFacesCached]);

  React.useEffect(() => {
    if (viewerVisible) return;
    setViewerFaceOverlayVisible(false);
    closeFacePersonModal();
  }, [viewerVisible, closeFacePersonModal]);

  React.useEffect(() => {
    closeFacePersonModal();
  }, [viewerIndex, closeFacePersonModal]);

  const viewerCount = images.length || 0;
  const normalizeViewerIndex = React.useCallback((idx) => {
    if (!viewerCount) return 0;
    return (idx + viewerCount) % viewerCount;
  }, [viewerCount]);
  const prevViewerIndex = normalizeViewerIndex(viewerIndex - 1);
  const nextViewerIndex = normalizeViewerIndex(viewerIndex + 1);
  const viewerTrackStyle = React.useMemo(() => {
    if (!viewerCount) return { width: '100%', transform: 'translate3d(0, 0, 0)' };
    return {
      width: `${viewerCount * 100}%`,
      transform: `translate3d(-${(viewerIndex * 100) / viewerCount}%, 0, 0)`,
    };
  }, [viewerCount, viewerIndex]);
  const viewerSlideStyle = React.useMemo(() => (
    viewerCount ? { width: `${100 / viewerCount}%` } : { width: '100%' }
  ), [viewerCount]);

  React.useEffect(() => {
    if (!viewerVisible || !viewerCount || viewerIndex < 0) return undefined;
    // 视频 slide 的目标是视频文件，new Image() 预加载只会白拉字节，跳过
    const srcForPreload = (idx, showOriginal) => (
      isVideoMeta(photoMetas?.[idx]) ? '' : getViewerTargetSrc(idx, showOriginal)
    );
    const currentThumb = srcForPreload(viewerIndex, false);
    const prevThumb = srcForPreload(prevViewerIndex, false);
    const nextThumb = srcForPreload(nextViewerIndex, false);
    const currentOriginal = viewerShowOriginal ? srcForPreload(viewerIndex, true) : '';
    const candidates = [currentThumb, prevThumb, nextThumb, currentOriginal].filter(Boolean);
    const preloads = [];
    candidates.forEach((src) => {
      const img = new Image();
      img.src = src;
      if (!img.complete) {
        if (typeof img.decode === 'function') {
          img.decode().catch(() => { /* ignore */ });
        }
      }
      preloads.push(img);
    });
    return () => {
      preloads.forEach((img) => {
        img.onload = null;
        img.onerror = null;
      });
    };
  }, [viewerVisible, viewerCount, viewerIndex, prevViewerIndex, nextViewerIndex, getViewerTargetSrc, viewerShowOriginal, photoMetas]);

  const navigateViewer = React.useCallback((step) => {
    if (!viewerVisible || viewerCount <= 1) return;
    setViewerEnableOpenZoom(false);
    const direction = step > 0 ? 1 : -1;
    const nextIndex = normalizeViewerIndex(viewerIndex + direction);
    if (nextIndex === viewerIndex) return;
    // 切换照片时关闭编辑面板，避免把上一张的标签/描述保存到当前这张
    setViewerEditVisible(false);
    setViewerIndex(nextIndex);
  }, [viewerVisible, viewerCount, normalizeViewerIndex, viewerIndex]);

  const openViewerAt = React.useCallback((index, immediateSrc = '') => {
    if (index < 0) return;
    const warmSrc = immediateSrc || getViewerTargetSrc(index, false);
    setViewerEnableOpenZoom(true);
    if (warmSrc) {
      const img = new Image();
      img.src = warmSrc;
    }
    setViewerIndex(index);
    setViewerShowOriginal(false);
    setViewerVisible(true);
  }, [getViewerTargetSrc]);

  const lastAutoOpenedPhotoKeyRef = React.useRef('');
  React.useEffect(() => {
    if (!initialOpenPhotoId) return;
    if (!Array.isArray(photoMetas) || !photoMetas.length) return;
    const targetPhotoId = String(initialOpenPhotoId).trim();
    if (!targetPhotoId) return;
    const key = `${String(projectId || '')}:${targetPhotoId}`;
    if (lastAutoOpenedPhotoKeyRef.current === key) return;
    const idx = photoMetas.findIndex((m) => String(getMetaPhotoId(m) || '') === targetPhotoId);
    if (idx < 0) return;
    lastAutoOpenedPhotoKeyRef.current = key;
    openViewerAt(idx, getViewerTargetSrc(idx, false));
    if (typeof onInitialOpenPhotoHandled === 'function') {
      onInitialOpenPhotoHandled(targetPhotoId);
    }
  }, [initialOpenPhotoId, photoMetas, projectId, getMetaPhotoId, openViewerAt, getViewerTargetSrc, onInitialOpenPhotoHandled]);

  const closeViewer = React.useCallback(() => {
    setViewerVisible(false);
    setViewerEnableOpenZoom(false);
    setViewerShowOriginal(false);
  }, []);

  // viewer keyboard navigation
  React.useEffect(() => {
    if (!viewerVisible) return undefined;
    const onKey = (e) => {
      if (e.key === 'ArrowRight') {
        navigateViewer(1);
      } else if (e.key === 'ArrowLeft') {
        navigateViewer(-1);
      } else if (e.key === 'Escape') {
        closeViewer();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [viewerVisible, closeViewer, navigateViewer]);

  const handleViewerPointerDown = React.useCallback((e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    viewerPointerRef.current = {
      active: true,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
    };
  }, []);

  const handleViewerPointerUp = React.useCallback((e) => {
    const state = viewerPointerRef.current;
    if (!state.active) return;
    const dx = e.clientX - state.startX;
    const dy = e.clientY - state.startY;
    viewerPointerRef.current = { active: false, pointerId: null, startX: 0, startY: 0 };
    if (Math.abs(dx) < 48 || Math.abs(dx) <= Math.abs(dy)) return;
    navigateViewer(dx < 0 ? 1 : -1);
  }, [navigateViewer]);

  const handleViewerPointerCancel = React.useCallback(() => {
    viewerPointerRef.current = { active: false, pointerId: null, startX: 0, startY: 0 };
  }, []);

  const hasPerm = React.useCallback((key) => userPermissions.includes(key) || canAny(key), [userPermissions]);
  const canUpdateProject = hasPerm('projects.update');
  const canUploadPhotos = !DISABLE_UPLOAD_FEATURE && (hasPerm('photos.upload') || hasPerm('upload.photo'));
  const canDeletePhotos = !DISABLE_DELETE_FEATURE && hasPerm('photos.delete');
  const canDeleteProject = !DISABLE_DELETE_FEATURE && hasPerm('projects.delete');
  const canEditTags = hasPerm('tags.edit');
  const canEditPhotos = hasPerm('photos.edit');
  const canPackDownload = readOnly || hasPerm('photos.zip');
  const canEditFacePersonName = hasPerm('faces.label');

  React.useEffect(() => {
    if (!canUploadPhotos) return;
    warmUploadApiProbe();
  }, [canUploadPhotos]);

  // ========== Photo Editing Handlers ==========
  const openPhotoEditModal = React.useCallback(() => {
    if (viewerIndex < 0) return;
    const meta = (photoMetas && photoMetas[viewerIndex]) || {};
    const id = meta.id;
    // initialize editing fields from current maps / meta
    setViewerEditTags((photoTagsMap[id] && Array.isArray(photoTagsMap[id])) ? [...photoTagsMap[id]] : (safeParseTags(meta.tags) || []));
    setViewerEditDescription(photoDescMap[id] || meta.description || '');
    setViewerEditTagInput('');
    setViewerEditVisible(true);
  }, [viewerIndex, photoMetas, photoTagsMap, photoDescMap]);

  const handlePhotoEditSuccess = React.useCallback((updatedPhoto) => {
    // 更新照片信息
    const photoId = updatedPhoto.id;
    const photoIndex = photoMetas?.findIndex(m => m.id === photoId) ?? -1;

    if (photoIndex >= 0) {
      // 更新 tags 和 description
      const newTags = safeParseTags(updatedPhoto.tags);
      const newDesc = updatedPhoto.description || '';

      setPhotoTagsMap(prev => ({ ...prev, [photoId]: newTags }));
      setPhotoDescMap(prev => ({ ...prev, [photoId]: newDesc }));

      // 鍒锋柊椤圭洰鏁版嵁浠ヤ繚鎸佸悓姝?
      getProjectById(projectId, {
        demo: readOnly,
        includeFaces: false,
        timeoutMs: PROJECT_DETAIL_TIMEOUT_MS,
      }).then(detail => {
        setProject(detail);
        const built = buildImagesAndMetas(detail);
        setImages(built.images);
        setPhotoMetas(built.metas);
      }).catch(err => console.error('reload after photo edit failed', err));
    }
  }, [projectId, photoMetas, readOnly]);

  const saveViewerPhotoEdit = React.useCallback(async () => {
    const idx = viewerIndex;
    const meta = (photoMetas && photoMetas[idx]) || {};
    const photoId = meta.id;
    if (!photoId) return Toast.warning('无法获取照片 ID');
    try {
      const token = getToken();
      if (!token) {
        Toast.error('鏈櫥褰曪紝璇峰厛鐧诲綍');
        return;
      }
      const payload = { tags: viewerEditTags && viewerEditTags.length ? viewerEditTags : [], description: viewerEditDescription || '' };
      const url = `${BASE_URL || ''}/api/photos/${photoId}`;
      const res = await fetch(url, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });
      if (res.status === 401 || res.status === 403) {
        Toast.error('权限不足，仅管理员可操作');
        return;
      }
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(txt || '保存失败');
      }
      const data = await res.json();
      const updatedTags = safeParseTags(data.tags);
      setPhotoTagsMap(prev => ({ ...prev, [photoId]: updatedTags }));
      setPhotoDescMap(prev => ({ ...prev, [photoId]: data.description || '' }));
      Toast.success('已保存照片信息');
      setViewerEditVisible(false);
      // reload project detail to sync metas
      try {
        const detail = await getProjectById(projectId, {
          demo: readOnly,
          includeFaces: false,
          timeoutMs: PROJECT_DETAIL_TIMEOUT_MS,
        });
        setProject(detail);
        const built = buildImagesAndMetas(detail);
        setImages(built.images);
        setPhotoMetas(built.metas);
      } catch (e) {
        // ignore reload errors
      }
    } catch (err) {
      console.error('saveViewerPhotoEdit error', err);
      Toast.error('保存失败');
    }
  }, [viewerIndex, viewerEditTags, viewerEditDescription, projectId, photoMetas, readOnly]);

  // 打开 / 关闭 鐩镐技鍒嗙粍寮圭獥骞跺姞杞芥暟鎹?
  // 相似分组加载（弹窗与查看器合影救场共用）：返回 {groups, photos}，缓存命中直接回吐 state
  const loadSimGroups = React.useCallback(async () => {
    if (!projectId) return { groups: [], photos: {} };
    if (simGroups !== null) return { groups: simGroups, photos: simPhotos };
    setSimLoading(true);
    setSimError(null);
    try {
      const token = getToken && typeof getToken === 'function' ? getToken() : null;
      const headers = token ? { Authorization: 'Bearer ' + token } : {};
      const url = `/api/similarity/groups/simple?projectId=${projectId}${readOnly ? '&demo=1' : ''}`;
      const r = await fetch(url, { headers });
      const data = await r.json().catch(() => ({}));
      const groups = data && Array.isArray(data.groups) ? data.groups : [];
      setSimGroups(groups);
      const ids = Array.from(new Set((groups || []).flat()));
      let map = {};
      if (ids.length) {
        if (readOnly) {
          const wanted = new Set(ids.map((x) => String(x)));
          (photoMetas || []).forEach((m) => {
            if (!m) return;
            const pid = m.id || m.photoId || m.photo_id;
            const sid = pid !== undefined && pid !== null ? String(pid) : '';
            if (!sid || !wanted.has(sid)) return;
            map[sid] = {
              id: sid,
              title: m.title || m.name || `#${sid}`,
              thumbUrl: m.thumbSrc || m.thumbUrl || m.thumbnail || m.thumb || m.url || '',
              url: m.originalSrc || m.url || m.thumbSrc || '',
              projectId,
            };
          });
        } else {
          const metas = await Promise.all(ids.map(id => fetch(`/api/photos/${id}`, { headers }).then(rr => rr.ok ? rr.json() : null).catch(() => null)));
          ids.forEach((id, i) => { if (metas[i]) map[id] = metas[i]; });
        }
      }
      setSimPhotos(map);
      return { groups, photos: map };
    } catch (e) {
      console.error('load similarity groups error', e);
      setSimError('加载失败，请重试');
      setSimGroups([]);
      return { groups: [], photos: {} };
    } finally {
      setSimLoading(false);
    }
  }, [projectId, simGroups, simPhotos, readOnly, photoMetas]);

  const openSimilarityModal = React.useCallback(() => {
    if (!projectId) return;
    setSimModalVisible(true);
    loadSimGroups();
  }, [projectId, loadSimGroups]);

  // 关闭时一并重置批量选择态：×/遮罩/Esc/跳查看器等任何关闭路径都不把选择模式泄漏到下次打开
  const closeSimilarityModal = React.useCallback(() => {
    setSimModalVisible(false);
    setSimDeleteMode(false);
    setSimSelectedMap({});
    setSimSelectedCount(0);
  }, []);

  const toggleSimSelect = React.useCallback((id) => {
    setSimSelectedMap((prev) => {
      const next = Object.assign({}, prev || {});
      if (next[id]) delete next[id]; else next[id] = true;
      const count = Object.keys(next).length;
      setSimSelectedCount(count);
      return next;
    });
  }, []);

  // 相似弹窗删除公共例程：批量与单张共用（同步剪除分组/元数据/主画廊/选中态）
  const performSimDelete = React.useCallback(async (ids) => {
    try {
      setSimDeleting(true);
      const res = await deletePhotos(ids);
      // 与主画廊 confirmDelete 一致：只按服务端确认的结果提示；已不存在的照片也从本地剪掉
      const deleted = ((res && (res.deletedIds || res.deleted || res.deleted_ids)) || []).map(String);
      const notFound = ((res && (res.notFoundIds || res.not_found_ids || res.notFound)) || []).map(String);
      const removed = (deleted.length || notFound.length)
        ? Array.from(new Set(deleted.concat(notFound)))
        : ids.map(String); // 服务端未回明细时退回按请求剪除
      if (notFound.length) Toast.warning(`${notFound.length} 张照片已不存在，已同步移除`);
      if (deleted.length) Toast.success(`已删除 ${deleted.length} 张照片`);
      else if (!notFound.length) Toast.success('删除成功');
      setSimGroups((prev) => (prev || []).map(g => g.filter(id => !removed.includes(String(id)))).filter(g => g.length > 1));
      setSimPhotos((prev) => { const next = Object.assign({}, prev || {}); removed.forEach(id => delete next[id]); return next; });
      setImages((prev) => (prev || []).filter((src, idx) => { const m = photoMetas && photoMetas[idx]; return !(m && removed.includes(String(m.id))); }));
      setPhotoMetas((prev) => (prev || []).filter(m => !removed.includes(String(m.id))));
      setSimSelectedMap((prev) => {
        const next = Object.assign({}, prev || {});
        removed.forEach((id) => delete next[id]);
        setSimSelectedCount(Object.keys(next).length);
        return next;
      });
      return true;
    } catch (e) {
      console.error('sim delete failed', e);
      Toast.error('删除失败，请稍后重试');
      return false;
    } finally {
      setSimDeleting(false);
    }
  }, [photoMetas, setPhotoMetas]);

  const confirmSimDelete = React.useCallback(() => {
    if (DISABLE_DELETE_FEATURE) {
      Toast.warning('删除功能已禁用');
      return;
    }
    const ids = Object.keys(simSelectedMap || {}).filter(Boolean);
    if (!ids.length) return Toast.warning('请先选择要删除的照片');
    Modal.confirm({
      title: '确认删除所选照片',
      content: `删除后不可恢复，确定要删除 ${ids.length} 张照片吗？`,
      onOk: async () => {
        const ok = await performSimDelete(ids);
        if (ok) setSimDeleteMode(false);
      }
    });
  }, [simSelectedMap, performSimDelete, DISABLE_DELETE_FEATURE]);

  // 单张直删（缩略图角标垃圾桶）
  const confirmSimDeleteOne = React.useCallback((id, titleText) => {
    if (DISABLE_DELETE_FEATURE) {
      Toast.warning('删除功能已禁用');
      return;
    }
    Modal.confirm({
      title: '确认删除照片',
      content: `删除后不可恢复，确定要删除「${titleText || `#${id}`}」吗？`,
      onOk: () => performSimDelete([String(id)])
    });
  }, [performSimDelete, DISABLE_DELETE_FEATURE]);

  // 相似组辅助选择：AI 三档标签（tags 优先，缺失时按分数阈值回退，与服务端映射一致）
  const getSimAiLabel = React.useCallback((p) => {
    if (!p) return null;
    let tags = p.tags;
    if (typeof tags === 'string') { try { tags = JSON.parse(tags); } catch (e) { tags = []; } }
    if (Array.isArray(tags)) {
      if (tags.includes('AI recommended')) return 'recommended';
      if (tags.includes('AI rejected')) return 'rejected';
      if (tags.includes('AI medium')) return 'medium';
    }
    const s = getPhotoAiScore(p);
    if (s === null) return null;
    if (s >= 75) return 'recommended';
    if (s <= 40) return 'rejected';
    return 'medium';
  }, []);

  // 仅留最佳：选中组内除最高分外的全部照片
  const selectSimGroupExceptBest = React.useCallback((group, bestId) => {
    setSimSelectedMap((prev) => {
      const next = Object.assign({}, prev || {});
      (group || []).map((id) => String(id)).forEach((id) => {
        if (id === bestId) delete next[id];
        else next[id] = true;
      });
      setSimSelectedCount(Object.keys(next).length);
      return next;
    });
  }, []);

  // 一键合影救场（查看器入口）：AI 语义识别为"合影"的照片才在 dock 浮现入口，
  // 打开确认层后自动定位这张照片所在的连拍相似组；关层不打断后台任务
  const isGroupPhotoMeta = React.useCallback((meta) => {
    if (!meta) return false;
    let tags = meta.tags;
    if (typeof tags === 'string') { try { tags = JSON.parse(tags); } catch (e) { tags = []; } }
    if (Array.isArray(tags) && tags.some((t) => String(t).includes('合影'))) return true;
    return String(meta.description || meta.desc || '').includes('合影');
  }, []);

  // 合成产物追加到主画廊末尾（不动已有索引，避免查看器错位；下次进页面按服务端排序归位）
  const appendRescuedPhoto = React.useCallback(async (photoId) => {
    try {
      const p = await getPhotoById(photoId);
      if (!p || !p.id) return;
      const thumbSrc = resolveAssetUrl(getPhotoThumbCandidate(p)) || resolveAssetUrl(p.thumbUrl || p.url);
      const originalSrc = resolveAssetUrl(getPhotoOriginalCandidate(p)) || resolveAssetUrl(p.url);
      if (!thumbSrc) return;
      setImages((prev) => [...(prev || []), thumbSrc]);
      setPhotoMetas((prev) => [...(prev || []), { ...p, thumbSrc, originalSrc }]);
    } catch (e) {
      console.warn('append rescued photo failed', e);
    }
  }, []);

  const openViewerRescue = React.useCallback(async (meta) => {
    const photoId = meta && (meta.id || meta.photoId || meta.photo_id);
    if (!photoId) return;
    const sid = String(photoId);
    setViewerRescue({ phase: 'loading', photoId: sid });
    // 当前照片就是基底；连拍相似组的其他照片作为默认参考（可取消）。
    // 没有连拍也能开始 —— 后端会自动从人脸库找同一人的其他脸。
    const { groups } = await loadSimGroups();
    const group = (groups || []).find((g) => (g || []).map(String).includes(sid));
    const refIds = (group || []).map(String).filter((id) => id !== sid).slice(0, 4);
    const picked = {};
    refIds.forEach((id) => { picked[id] = true; });
    setViewerRescue({ phase: 'pick', photoId: sid, refIds, pickedMap: picked });
  }, [loadSimGroups]);

  const toggleViewerRescuePick = React.useCallback((id) => {
    setViewerRescue((prev) => {
      if (!prev || prev.phase !== 'pick') return prev;
      const next = Object.assign({}, prev.pickedMap || {});
      if (next[id]) delete next[id]; else next[id] = true;
      return { ...prev, pickedMap: next };
    });
  }, []);

  const startViewerRescue = React.useCallback(async () => {
    if (!viewerRescue || viewerRescue.phase !== 'pick') return;
    const refs = Object.keys(viewerRescue.pickedMap || {});
    if (refs.length > 4) { Toast.warning('参考照片最多 4 张'); return; }
    setViewerRescue({ ...viewerRescue, phase: 'running', step: '排队中' });
    try {
      const job = await runGroupRescueJob({ basePhotoId: viewerRescue.photoId, referencePhotoIds: refs }, (step) => {
        setViewerRescue((prev) => (prev && prev.phase === 'running' ? { ...prev, step } : prev));
      });
      if (job.status === 'done') {
        if (job.resultPhotoId) appendRescuedPhoto(job.resultPhotoId);
        Toast.success(`合影救场完成：替换了 ${job.replacedCount} 张人脸，新照片已加入相册`);
        setViewerRescue((prev) => (prev ? { ...prev, phase: 'done', replacedCount: job.replacedCount, resultPhotoId: job.resultPhotoId } : prev));
      } else if (job.status === 'done_noop') {
        setViewerRescue((prev) => (prev ? { ...prev, phase: 'noop', step: job.step || '这张合影里每个人已是最佳状态' } : prev));
      } else {
        setViewerRescue((prev) => (prev ? { ...prev, phase: 'failed', error: job.error || '未知错误' } : prev));
      }
    } catch (e) {
      console.error('viewer rescue failed', e);
      setViewerRescue((prev) => (prev ? { ...prev, phase: 'failed', error: '任务提交或进度查询失败' } : prev));
    }
  }, [viewerRescue, appendRescuedPhoto]);

  const closeViewerRescue = React.useCallback(() => {
    setViewerRescue((prev) => {
      if (prev && prev.phase === 'running') {
        Toast.info('合成继续在后台进行，完成后会提示');
        return { ...prev, hidden: true }; // 保留任务态，完成 Toast 仍会触发
      }
      return null;
    });
  }, []);

  // 选择模式下按组全选/取消全选
  const toggleSimSelectGroup = React.useCallback((group) => {
    setSimSelectedMap((prev) => {
      const next = Object.assign({}, prev || {});
      const ids = (group || []).map((id) => String(id));
      const allSelected = ids.length > 0 && ids.every((id) => next[id]);
      if (allSelected) ids.forEach((id) => delete next[id]);
      else ids.forEach((id) => { next[id] = true; });
      setSimSelectedCount(Object.keys(next).length);
      return next;
    });
  }, []);

  // 鎺ㄨ崘鏍囪锛氭坊鍔?鎺ㄨ崘"鏍囩
  const addRecommendationTag = React.useCallback(async () => {
    if (viewerIndex < 0 || !photoMetas || !photoMetas[viewerIndex]) return;

    const currentMeta = photoMetas[viewerIndex];
    const photoId = getPhotoRecordId(currentMeta);
    if (!photoId) {
      Toast.warning('无法获取照片 ID');
      return;
    }

    // 检查是否已有“推荐”标签
    const currentTags = photoTagsMap[photoId] || [];
    if (currentTags.includes('推荐')) {
      Toast.warning('该照片已有“推荐”标签');
      return;
    }

    try {
      const token = getToken();
      if (!token) {
        Toast.error('未登录，请先登录');
        return;
      }

      // 添加“推荐”标签到现有标签
      const newTags = [...currentTags, '推荐'];

      const url = `${BASE_URL || ''}/api/photos/${photoId}`;
      const res = await fetch(url, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ tags: newTags }),
      });

      if (res.status === 401 || res.status === 403) {
        Toast.error('权限不足，仅管理员可操作');
        return;
      }

      if (!res.ok) {
        const errText = await res.text();
        Toast.error(`操作失败: ${errText}`);
        return;
      }

      const data = await res.json();
      const updatedTags = safeParseTags(data.tags);
      setPhotoTagsMap(prev => ({ ...prev, [photoId]: updatedTags }));
      Toast.success('已添加推荐标签');
    } catch (err) {
      console.error('add recommendation failed:', err);
      Toast.error(`操作失败: ${err.message}`);
    }
  }, [viewerIndex, photoMetas, photoTagsMap]);

  const masonryBuckets = React.useMemo(() => {
    const cols = Math.max(1, masonryColumns);
    const buckets = Array.from({ length: cols }, () => ({ h: 0, items: [] }));
    visiblePhotoItems.forEach(({ src, idx }) => {
      const ratio = imageRatios[src] || 1.5;
      const estHeight = 1 / Math.max(0.2, ratio);
      let minCol = 0;
      for (let i = 1; i < buckets.length; i += 1) {
        if (buckets[i].h < buckets[minCol].h) minCol = i;
      }
      buckets[minCol].items.push({ src, idx });
      buckets[minCol].h += estHeight;
    });
    return buckets.map((b) => b.items);
  }, [visiblePhotoItems, imageRatios, masonryColumns]);

  const getRippleStyle = React.useCallback((index) => {
    void index;
    return undefined;
  }, []);

  const buildTransferItem = React.useCallback((index) => {
    const meta = (photoMetas && photoMetas[index]) || {};
    const pid = meta.id || meta.photoId || meta.photo_id || null;
    const url = meta.originalSrc || meta.url || images[index] || '';
    const thumbSrc = meta.thumbSrc || images[index] || url;
    const description = photoDescMap[pid] || meta.description || '';
    const tags = Array.isArray(photoTagsMap[pid]) ? photoTagsMap[pid] : safeParseTags(meta.tags);
    const cachedFaces = pid ? (viewerFaceMap && viewerFaceMap[String(pid)]) : null;
    const faceNames = extractFaceNamesFromMeta(meta, cachedFaces);
    return {
      id: pid || url,
      url,
      thumbSrc,
      description,
      tags: Array.isArray(tags) ? tags : [],
      projectTitle: title || '',
      photographerId: meta.photographerId || meta.photographer_id || null,
      photographerName: meta.photographerName || meta.photographer_name || '',
      faceNames,
      personNames: faceNames,
      faces: Array.isArray(cachedFaces) ? cachedFaces : (Array.isArray(meta.faces) ? meta.faces : []),
    };
  }, [photoMetas, images, photoDescMap, photoTagsMap, title, viewerFaceMap]);

  const getDragSelectionIndexes = React.useCallback((index) => {
    const key = String(index);
    const isDraggedPhotoSelected = !!(selectedMap && selectedMap[key]);
    if (!isDraggedPhotoSelected) return [index];
    return Object.keys(selectedMap || {})
      .map((k) => Number(k))
      .filter((i) => Number.isInteger(i) && i >= 0 && i < images.length && !!selectedMap[String(i)])
      .sort((a, b) => a - b);
  }, [selectedMap, images.length]);

  const handlePhotoDragStart = React.useCallback((e, index) => {
    setPhotoDragActive(true);
    try {
      const dragIndexes = getDragSelectionIndexes(index);
      const items = dragIndexes.map((i) => buildTransferItem(i)).filter((it) => !!it && !!it.url);
      const payload = items.length <= 1 ? (items[0] || buildTransferItem(index)) : items;
      const lead = Array.isArray(payload) ? payload[0] : payload;
      const count = Array.isArray(payload) ? payload.length : 1;

      e.dataTransfer.effectAllowed = 'copy';
      e.dataTransfer.setData('application/x-mamage-photo', JSON.stringify(payload));
      e.dataTransfer.setData('application/json', JSON.stringify(payload));
      e.dataTransfer.setData('text/plain', Array.isArray(payload) ? payload.map((it) => it.url || '').filter(Boolean).join('\n') : (payload.url || ''));

      // Create a "real photo card" drag preview.
      const preview = document.createElement('div');
      preview.style.width = '180px';
      preview.style.height = '120px';
      preview.style.borderRadius = '8px';
      preview.style.overflow = 'hidden';
      preview.style.boxShadow = '0 10px 24px rgba(0,0,0,0.28)';
      preview.style.background = '#fff';
      preview.style.position = 'fixed';
      preview.style.left = '-9999px';
      preview.style.top = '-9999px';
      preview.style.pointerEvents = 'none';
      preview.style.position = 'relative';

      const img = document.createElement('img');
      img.src = lead.thumbSrc || lead.url || '';
      img.style.width = '100%';
      img.style.height = '100%';
      img.style.objectFit = 'cover';
      img.draggable = false;
      preview.appendChild(img);

      if (count > 1) {
        const badge = document.createElement('div');
        badge.textContent = `${count}`;
        badge.style.position = 'absolute';
        badge.style.right = '8px';
        badge.style.bottom = '8px';
        badge.style.minWidth = '28px';
        badge.style.height = '28px';
        badge.style.padding = '0 8px';
        badge.style.borderRadius = '14px';
        badge.style.display = 'flex';
        badge.style.alignItems = 'center';
        badge.style.justifyContent = 'center';
        badge.style.background = 'rgba(15, 23, 42, 0.9)';
        badge.style.color = '#fff';
        badge.style.fontSize = '12px';
        badge.style.fontWeight = '700';
        badge.style.boxShadow = '0 4px 10px rgba(0,0,0,0.3)';
        preview.appendChild(badge);
      }

      document.body.appendChild(preview);
      dragPreviewRef.current = preview;
      e.dataTransfer.setDragImage(preview, 24, 20);
      try {
        window.dispatchEvent(new CustomEvent('mamage-photo-drag-start'));
      } catch (evtErr) {
        // ignore
      }
    } catch (err) {
      console.warn('photo dragstart failed', err);
    }
  }, [buildTransferItem, getDragSelectionIndexes]);

  const handlePhotoDragEnd = React.useCallback(() => {
    setPhotoDragActive(false);
    setRailDropKey(null);
    try {
      if (dragPreviewRef.current) {
        dragPreviewRef.current.remove();
        dragPreviewRef.current = null;
      }
      try {
        window.dispatchEvent(new CustomEvent('mamage-photo-drag-end'));
      } catch (evtErr) {
        // ignore
      }
    } catch (err) {
      // ignore
    }
  }, []);

  const renderPhotoItem = React.useCallback((src, overallIndex) => {
    const readyKey = `${overallIndex}|${src}`;
    const isReady = !!detailImageReadyMap[readyKey];
    const ratio = imageRatios[src] || 1.5;
    const meta = photoMetas?.[overallIndex] || {};
    const isVideo = isVideoMeta(meta);
    const videoUploadState = isVideo ? getVideoUploadState(meta) : '';
    const videoUnavailable = videoUploadState === 'processing' || videoUploadState === 'failed';
    const mediaSrc = isVideo ? (meta.thumbSrc || meta.thumbUrl || src || meta.originalSrc || meta.url) : src;
    const videoPosterSrc = isVideo && isImageUrl(mediaSrc) ? mediaSrc : '';
    const semanticState = isVideo ? { tags: [], description: '', pending: false, failed: false } : getPhotoSemanticState(meta);
    const timelineLabel = getPhotoTimelineSectionLabel(meta, uploadTimelineSections);
    const adjustments = getAdjustmentForPhoto(meta);
    const adjustmentStyle = getPhotoAdjustmentStyle(adjustments);
    const useExactThumbnailTone = !isDefaultPhotoAdjustments(adjustments);
    const rippleStyle = getRippleStyle(overallIndex) || {};
    const itemStyle = galleryMode === 'grid'
      ? { ...rippleStyle, aspectRatio: '1 / 1' }
      : rippleStyle;
    return (
    <div className="detail-photo-item" key={overallIndex} style={itemStyle}>
      <div className="detail-photo">
        <div style={{ position: 'relative' }}>
          {isVideo ? (
            <button
              type="button"
              className={`detail-video-thumb${videoUnavailable ? ' is-unavailable' : ''}${videoUploadState === 'failed' ? ' is-failed' : ''}`}
              draggable={!videoUnavailable}
              onDragStart={(e) => handlePhotoDragStart(e, overallIndex)}
              onDragEnd={handlePhotoDragEnd}
              onMouseEnter={() => setHoveredPhotoIdx(overallIndex)}
              onMouseLeave={() => setHoveredPhotoIdx(-1)}
              onClick={(e) => {
                if (videoUploadState === 'processing') {
                  Toast.info('视频已上传，正在转码，完成后可观看');
                  return;
                }
                if (videoUploadState === 'failed') {
                  Toast.warning('视频处理失败，请重新上传');
                  return;
                }
                if (deleteMode) {
                  toggleSelect(overallIndex);
                } else if (overallIndex >= 0) {
                  openViewerAt(overallIndex, mediaSrc || images[overallIndex] || '');
                }
              }}
              style={{ cursor: videoUnavailable ? 'not-allowed' : (deleteMode ? 'pointer' : 'zoom-in'), aspectRatio: galleryMode === 'masonry' ? `${ratio}` : undefined }}
              aria-label={videoUnavailable ? '视频转码中' : '打开视频'}
              aria-disabled={videoUnavailable ? 'true' : undefined}
            >
              {videoPosterSrc ? (
                <img
                  src={videoPosterSrc}
                  className={`detail-photo-img detail-video-thumb-media${isReady ? ' is-ready' : ''}`}
                  alt={`${title}-${overallIndex}`}
                  loading="lazy"
                  decoding="async"
                  onLoad={(event) => {
                    handleImageLoad(src, event);
                    setDetailImageReadyMap((prev) => (prev[readyKey] ? prev : { ...prev, [readyKey]: true }));
                  }}
                />
              ) : (
                <span className="detail-video-thumb-placeholder" aria-hidden="true">
                  <span>VIDEO</span>
                </span>
              )}
              {videoUnavailable ? (
                <span className="detail-video-processing-mark" aria-hidden="true" />
              ) : (
                <span className="detail-video-play" aria-hidden="true">▶</span>
              )}
              <span className={`detail-video-badge${videoUnavailable ? ' is-processing' : ''}`}>
                {videoUploadState === 'failed' ? '处理失败' : (videoUploadState === 'processing' ? '已上传 · 转码中' : '视频')}
              </span>
            </button>
          ) : (
            <ViewerToneImage
              src={src}
              photoId={getPhotoRecordId(meta)}
              adjustments={adjustments}
              exact={useExactThumbnailTone}
              maxSize={720}
              pixelVariant="thumb"
              hiddenImageInteractive
              alt={`${title}-${overallIndex}`}
              loading="lazy"
              decoding="async"
              className={`detail-photo-img${isReady ? ' is-ready' : ''}`}
              draggable
              onDragStart={(e) => handlePhotoDragStart(e, overallIndex)}
              onDragEnd={handlePhotoDragEnd}
              onLoad={(event) => {
                handleImageLoad(src, event);
                setDetailImageReadyMap((prev) => (prev[readyKey] ? prev : { ...prev, [readyKey]: true }));
              }}
              style={{ display: 'block', cursor: deleteMode ? 'pointer' : 'zoom-in', aspectRatio: galleryMode === 'masonry' ? `${ratio}` : undefined, ...(adjustmentStyle || {}) }}
              data-original={photoMetas && photoMetas[overallIndex] ? (photoMetas[overallIndex].originalSrc || images[overallIndex]) : images[overallIndex]}
              data-tried="0"
              onError={(e) => {
                try {
                  const img = e.target;
                  const tried = img.getAttribute('data-tried');
                  if (tried === '0') {
                    img.setAttribute('data-tried', '1');
                    const original = img.getAttribute('data-original');
                    if (original) img.src = original;
                  }
                } catch (err) { }
              }}
              onMouseEnter={() => setHoveredPhotoIdx(overallIndex)}
              onMouseLeave={() => setHoveredPhotoIdx(-1)}
              onClick={(e) => {
                if (deleteMode) {
                  toggleSelect(overallIndex);
                } else if (overallIndex >= 0) {
                  openViewerAt(overallIndex, e.currentTarget.currentSrc || e.currentTarget.src || images[overallIndex] || '');
                }
              }}
            />
          )}
          {(() => {
            const rawName = meta.photographerName || meta.photographer_name || meta.photographer || (meta.photographerId ? String(meta.photographerId) : null) || (meta.photographer_id ? String(meta.photographer_id) : null);
            const hasName = rawName && String(rawName).trim();
            let photographerLabel = null;
            if (hasName) {
              photographerLabel = String(rawName);
            } else {
              try {
                const list = (project && (project.photos || project.images || project.gallery)) || (initialProject && (initialProject.photos || initialProject.images || initialProject.gallery)) || [];
                const found = Array.isArray(list) ? list.find(p => p && (String(p.id) === String(meta.id) || String(p.photoId) === String(meta.id))) : null;
                const fb = found ? (found.photographerName || found.photographer || found.photographer_name || found.photographerId || found.photographer_id) : null;
                if (fb) photographerLabel = String(fb);
              } catch (e) { }
              if (!photographerLabel) {
                photographerLabel = meta.photographerId ? `摄影师#${meta.photographerId}` : (meta.photographer_id ? `摄影师#${meta.photographer_id}` : '未知摄影师');
              }
            }
            return (
              <div className="detail-photo-chip-row">
                <div className="detail-photo-chip" title={photographerLabel}>{photographerLabel}</div>
                {timelineLabel ? (
                  <div className="detail-photo-chip detail-photo-chip--section" title={timelineLabel}>{timelineLabel}</div>
                ) : null}
              </div>
            );
          })()}
          {deleteMode && (
            <div style={{ position: 'absolute', right: 8, top: 8, width: 32, height: 32, borderRadius: 16, background: selectedMap[String(overallIndex)] ? '#ff5252' : 'rgba(0,0,0,0.45)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }} onClick={(e) => { e.stopPropagation(); toggleSelect(overallIndex); }}>
              {selectedMap[String(overallIndex)] ? '✓' : ''}
            </div>
          )}
          {!isVideo && (hoveredPhotoIdx === overallIndex || semanticState.pending || semanticState.failed) && !deleteMode && (
            <div className={`detail-tag-overlay${semanticState.pending ? ' is-analysis-pending' : ''}${semanticState.failed ? ' is-analysis-failed' : ''}`}>
              {(() => {
                const tags = semanticState.tags;
                const hasTags = tags && tags.length > 0;
                if (semanticState.pending || semanticState.failed || hasTags) {
                  return (
                    <div className="detail-tag-strip">
                      {semanticState.pending && (
                        <span className="detail-tag-chip detail-tag-chip--analysis">
                          <span className="detail-analysis-dot" />
                          分析中
                        </span>
                      )}
                      {semanticState.failed && !hasTags && (
                        <span className="detail-tag-chip detail-tag-chip--failed">分析失败</span>
                      )}
                    {tags.slice(0, 5).map((tag, i) => (
                      <span key={i} className="detail-tag-chip">{tag}</span>
                    ))}
                    </div>
                  );
                }
                return <span className="detail-tag-empty">暂无标签</span>;
              })()}
            </div>
          )}
          {!isVideo && showAILabels && photoAILabelMap[photoMetas?.[overallIndex]?.id] && (() => {
            const label = photoAILabelMap[photoMetas?.[overallIndex]?.id];
            const score = getPhotoAiScore(photoMetas?.[overallIndex]);
            return (
              <div className="detail-photo-chip detail-photo-chip--floating" style={{ right: 8, top: 8, color: getAISelectionColor(label) }}>
                {getAISelectionLabel(label)}{score !== null ? ` ${score}` : ''}
              </div>
            );
          })()}
          {(() => {
            const pid = photoMetas?.[overallIndex]?.id;
            if (isVideo || !pid) return null;
            const hasRecommend = (photoTagsMap[pid] || []).includes('推荐');
            if (!hasRecommend) return null;
            return (
              <div className="detail-photo-chip detail-photo-chip--floating" style={{ right: 8, top: showAILabels && photoAILabelMap[pid] ? 40 : 8 }}>
                推荐
              </div>
            );
          })()}
        </div>
      </div>
    </div>
    );
  }, [title, handlePhotoDragStart, handlePhotoDragEnd, handleImageLoad, deleteMode, photoMetas, images, hoveredPhotoIdx, photoTagsMap, showAILabels, photoAILabelMap, selectedMap, toggleSelect, project, initialProject, getRippleStyle, openViewerAt, detailImageReadyMap, imageRatios, galleryMode, getPhotoSemanticState, getAdjustmentForPhoto, uploadTimelineSections]);

  return (
    <div className="detail-page">
      {canUploadPhotos ? (
        <input
          id="project-file-input"
          ref={fileInputRef}
          style={{ display: 'none' }}
          type="file"
          accept="image/*,video/*,.avif,.heic,.heif,.tif,.tiff,.dng,.cr2,.cr3,.crw,.nef,.nrw,.arw,.sr2,.srf,.raf,.orf,.rw2,.raw,.pef,.srw,.x3f,.rwl,.3fr,.fff,.iiq,.mrw,.dcr,.kdc,.mos,.erf"
          multiple
          onChange={(e) => {
            handleFilesSelected(e.target.files);
            try { e.target.value = ''; } catch (err) { }
          }}
          aria-hidden="true"
        />
      ) : null}

      {detailSearchVisible ? (
        <div className="detail-header detail-header--search-only">
          <div className="detail-header-inner">
            <div className="detail-search-row">
              <Input
                className="detail-search-input"
                value={searchKeyword}
                onChange={(v) => setSearchKeyword(v)}
                placeholder="搜索照片 / 标签 / 摄影师"
                prefix={<IconSearch />}
                showClear
              />
              <div className="detail-search-status">
                {searching ? <Text type="tertiary">搜索中</Text> : null}
                {searchKeywordTrimmed ? (
                  <Text type="tertiary">{`${images.length} 张`}</Text>
                ) : null}
              </div>
              <Button
                className="detail-search-close"
                icon={<IconClose />}
                theme="borderless"
                onClick={() => {
                  if (searchKeywordTrimmed) setSearchKeyword('');
                  setSearchOpen(false);
                }}
                aria-label="收起搜索"
                title="收起搜索"
              />
            </div>
            {searchError ? (
              <Text type="danger" className="detail-search-error">{searchError}</Text>
            ) : null}
          </div>
        </div>
      ) : null}

      <nav className={`detail-bottom-nav${dragActive ? ' is-drag-active' : ''}`} aria-label="相册底部操作">
        <button
          type="button"
          className={`detail-bottom-nav-item detail-bottom-nav-item--select${deleteMode ? ' is-active' : ''}`}
          onClick={toggleDeleteMode}
          aria-pressed={deleteMode}
        >
          <span className="detail-bottom-nav-icon detail-bottom-nav-icon--select" aria-hidden="true">{deleteMode ? '✓' : ''}</span>
          <span>{deleteMode ? (selectedCount ? `已选 ${selectedCount}` : '完成') : '选择'}</span>
        </button>

        {canUploadPhotos ? (
          <button
            type="button"
            className={`detail-bottom-upload${dragActive ? ' is-drag-active' : ''}${uploadHover ? ' is-hovered' : ''}`}
            onClick={openUploadPicker}
            onMouseEnter={() => setUploadHover(true)}
            onMouseLeave={() => setUploadHover(false)}
            onDragOver={(e) => {
              e.preventDefault();
              if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
              setDragActive(true);
            }}
            onDragEnter={(e) => {
              e.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              setDragActive(false);
            }}
            onDrop={(e) => {
              e.preventDefault();
              setDragActive(false);
              if (e.dataTransfer && e.dataTransfer.files) handleFilesSelected(e.dataTransfer.files);
            }}
            aria-label={stagingFiles && stagingFiles.length > 0 ? `${stagingFiles.length} 个待上传` : '上传照片或视频'}
            title={stagingFiles && stagingFiles.length > 0 ? `${stagingFiles.length} 个待上传` : '点击或拖入照片/视频'}
          >
            <IconPlus />
            <span className="detail-bottom-upload-hint">{dragActive ? '松开上传' : '上传'}</span>
          </button>
        ) : (
          <button
            type="button"
            className="detail-bottom-upload is-disabled"
            disabled
            aria-label="上传不可用"
          >
            <IconPlus />
            <span className="detail-bottom-upload-hint">上传</span>
          </button>
        )}

        <button
          type="button"
          className={`detail-bottom-nav-item detail-bottom-nav-item--actions${actionSheetOpen ? ' is-active' : ''}`}
          onClick={() => setActionSheetOpen(true)}
          aria-expanded={actionSheetOpen}
          aria-label="打开功能"
        >
          <span className="detail-bottom-nav-icon" aria-hidden="true"><IconMoreStroked /></span>
          <span>功能</span>
        </button>
      </nav>

      {actionSheetOpen ? (
        <button
          type="button"
          className="detail-actions-backdrop"
          onClick={() => setActionSheetOpen(false)}
          aria-label="关闭相册操作"
        />
      ) : null}

      <div className={`detail-actions-sheet${actionSheetOpen ? ' is-open' : ''}`} role="dialog" aria-modal="true" aria-hidden={!actionSheetOpen}>
        <div className="detail-actions-grip" />
        <div className="detail-actions-head">
          <div>
            <div className="detail-actions-title">相册操作</div>
            <div className="detail-actions-subtitle">{compactCountText}</div>
          </div>
          <Button
            className="detail-sheet-close"
            icon={<IconClose />}
            theme="borderless"
            onClick={() => setActionSheetOpen(false)}
            aria-label="关闭"
          />
        </div>

        <div className="detail-media-filter" role="group" aria-label="媒体类型筛选">
          {mediaFilterOptions.map((option) => (
            <button
              key={option.key}
              type="button"
              className={`detail-media-filter-btn${mediaFilter === option.key ? ' is-active' : ''}`}
              onClick={() => {
                setMediaFilter(option.key);
                setActionSheetOpen(false);
              }}
              aria-pressed={mediaFilter === option.key}
            >
              <span>{option.label}</span>
              <strong>{option.count}</strong>
            </button>
          ))}
        </div>

        <div className="detail-actions-grid">
          <Button
            className="detail-action-tile"
            theme="borderless"
            onClick={() => {
              handleGalleryModeChange(galleryMode === 'grid' ? 'masonry' : 'grid');
              setActionSheetOpen(false);
            }}
            aria-label="切换照片布局"
          >
            <span className="detail-action-icon is-accent-slate" aria-hidden="true">{galleryMode === 'grid' ? <IconMasonryView /> : <IconGridView />}</span>
            <span className="detail-action-copy">
              <span className="detail-action-title">{galleryMode === 'grid' ? '瀑布流' : '网格'}</span>
              <span className="detail-action-desc">切换排列</span>
            </span>
          </Button>

          <Button
            className={`detail-action-tile${showAILabels ? ' is-active' : ''}`}
            theme="borderless"
            onClick={() => {
              toggleAILabels();
              setActionSheetOpen(false);
            }}
            aria-label="AI 选片"
          >
            <span className="detail-action-icon is-accent-violet" aria-hidden="true"><IconSparkleAI /></span>
            <span className="detail-action-copy">
              <span className="detail-action-title">AI 选片</span>
              <span className="detail-action-desc">{aiSelectionStats.total ? `推荐 ${aiSelectionStats.recommended} / 中等 ${aiSelectionStats.medium} / 不推荐 ${aiSelectionStats.rejected}` : '等待分析结果'}</span>
            </span>
          </Button>

          <Button
            className="detail-action-tile"
            theme="borderless"
            onClick={() => {
              setActionSheetOpen(false);
              openSimilarityModal();
            }}
            aria-label="查看相似照片"
          >
            <span className="detail-action-icon is-accent-teal" aria-hidden="true"><IconSimilarStack /></span>
            <span className="detail-action-copy">
              <span className="detail-action-title">相似照片</span>
              <span className="detail-action-desc">成组查看</span>
            </span>
          </Button>

          <Button
            className={`detail-action-tile${detailSearchVisible ? ' is-active' : ''}`}
            theme="borderless"
            onClick={() => {
              setSearchOpen(true);
              setActionSheetOpen(false);
            }}
            aria-label="搜索照片"
          >
            <span className="detail-action-icon is-accent-blue" aria-hidden="true"><IconSearch /></span>
            <span className="detail-action-copy">
              <span className="detail-action-title">搜索</span>
              <span className="detail-action-desc">{searchKeywordTrimmed ? `${images.length} 张结果` : '照片/标签/人'}</span>
            </span>
          </Button>

          <IfCan perms={['projects.update']}>
            <Button
              className="detail-action-tile"
              theme="borderless"
              onClick={() => {
                setActionSheetOpen(false);
                openEdit();
              }}
              aria-label="修改相册信息"
            >
              <span className="detail-action-icon is-accent-amber" aria-hidden="true"><IconInfoEdit /></span>
              <span className="detail-action-copy">
                <span className="detail-action-title">修改信息</span>
                <span className="detail-action-desc">标题/日期/标签</span>
              </span>
            </Button>
          </IfCan>
          <IfCan perms={['projects.update']}>
            <Button
              className="detail-action-tile"
              theme="borderless"
              onClick={() => {
                setActionSheetOpen(false);
                openTimelineEdit();
              }}
              aria-label="编辑时间线环节"
            >
              <span className="detail-action-icon is-accent-green" aria-hidden="true"><IconTimelineFlow /></span>
              <span className="detail-action-copy">
                <span className="detail-action-title">编辑时间线</span>
                <span className="detail-action-desc">环节增删/排序/命名</span>
              </span>
            </Button>
          </IfCan>
        </div>

        {(description || (tags && tags.length > 0) || startText || createdText || date) ? (
          <div className="detail-actions-info">
            {(startText || createdText || date) ? (
              <div className="detail-actions-info-row">
                {startText ? <span>开始 {startText}</span> : null}
                {createdText ? <span>创建 {createdText}</span> : null}
                {!startText && !createdText && date ? <span>{date}</span> : null}
              </div>
            ) : null}
            {description ? <p>{description}</p> : null}
            {tags && tags.length > 0 ? (
              <div className="detail-actions-tags">
                {tags.map((t, idx) => (
                  <Tag key={idx} size="small" type="light" color="grey">
                    {t}
                  </Tag>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <div
        className={`detail-gallery ${galleryMode === 'masonry' ? 'detail-gallery--masonry' : 'detail-gallery--grid'} ${useTimelineGallery ? 'detail-gallery--timeline' : ''} ${isGalleryPreparing ? 'is-preparing' : ''}`}
        ref={galleryRef}
      >
        {loading && (
          <div className="detail-loading-state">
            <HexLoader size={60} className="detail-loading-mark" />
            <div className="detail-loading-title">正在加载相册</div>
            <div className="detail-loading-subtitle">照片马上出现</div>
          </div>
        )}

        {!loading && error && (
          <div style={{ width: '100%', display: 'flex', justifyContent: 'center', padding: '60px 0' }}>
            <Text type="danger">{error}</Text>
          </div>
        )}

        {!loading && !error && images.length === 0 && (
          <div style={{ width: '100%', display: 'flex', justifyContent: 'center', padding: '60px 0' }}>
            <Empty description="该项目暂无图片" />
          </div>
        )}

        {!loading && !error && images.length > 0 && mediaFilteredIndexes.length === 0 && (
          <div style={{ width: '100%', display: 'flex', justifyContent: 'center', padding: '60px 0' }}>
            <Empty description={mediaFilter === 'video' ? '当前相册暂无视频' : '当前相册暂无照片'} />
          </div>
        )}

        {isGalleryPreparing && (
          galleryMode === 'masonry' ? (
            <div className="detail-masonry-columns detail-masonry-columns--placeholder" style={{ '--masonry-cols': masonryColumns }}>
              {masonryBuckets.map((bucket, colIdx) => (
                <div className="detail-masonry-column" key={`masonry-placeholder-col-${colIdx}`}>
                  {bucket.map(({ src, idx }) => (
                    <div className="detail-photo-item detail-photo-item--skeleton" key={`masonry-placeholder-${idx}`}>
                      <div className="detail-photo detail-photo--skeleton" style={{ aspectRatio: `${imageRatios[src] || 1.5}` }} />
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ) : (
            visiblePhotoItems.map(({ src, idx }) => (
              <div className="detail-photo-item detail-photo-item--skeleton" key={`grid-placeholder-${idx}`}>
                <div className="detail-photo detail-photo--skeleton" />
              </div>
            ))
          )
        )}

        {!loading && !error && galleryPrepared && (
          useTimelineGallery ? (
            <div className={`detail-timeline-layout${railWide ? ' is-rail-wide' : ''}`}>
              <nav ref={railRef} className={`detail-timeline-rail${photoDragActive || fileDragActive ? ' is-drop-mode' : ''}${railExpanded ? ' is-expanded-full' : ''}`} data-file-drop-zone="1" aria-label="时间轴快速导航">
                <span className="detail-timeline-rail-line" aria-hidden="true" />
                {photoDragActive || fileDragActive ? (
                  <span className="detail-timeline-rail-hint">{fileDragActive ? '松手上传到环节' : '松手移入环节'}</span>
                ) : null}
                {timelineGalleryGroups.map((group) => {
                  const railKey = group.key || group.id || group.name;
                  return (
                  <a
                    key={`rail-${railKey}`}
                    className={`detail-timeline-rail-item${(photoDragActive || fileDragActive) && railDropKey === railKey ? ' is-drag-over' : ''}`}
                    href={`#${group.domId}`}
                    title={group.sectionTime ? `${group.name} · ${group.sectionTime}` : group.name}
                    onDragOver={(e) => {
                      if (!photoDragActive && !fileDragActive) return;
                      e.preventDefault();
                      e.dataTransfer.dropEffect = fileDragActive ? 'copy' : 'move';
                      if (railDropKey !== railKey) setRailDropKey(railKey);
                    }}
                    onDragLeave={() => {
                      setRailDropKey((prev) => (prev === railKey ? null : prev));
                    }}
                    onDrop={(e) => handleRailDrop(e, group)}
                  >
                    <span className="detail-timeline-rail-dot" aria-hidden="true" />
                    <span className="detail-timeline-rail-text">
                      <span>{group.name}</span>
                      {group.sectionTime ? <em>{group.sectionTime}</em> : null}
                    </span>
                    <strong>{group.items.length}</strong>
                  </a>
                  );
                })}
                {(railOverflow || railExpanded) ? (
                  <button
                    type="button"
                    className="detail-timeline-rail-toggle"
                    onClick={() => setRailExpanded((v) => !v)}
                    aria-expanded={railExpanded}
                  >
                    {railExpanded ? '收起' : `展开全部 (${timelineGalleryGroups.length})`}
                  </button>
                ) : null}
                {(railNameTruncated || railWide) ? (
                  <button
                    type="button"
                    className="detail-timeline-rail-widen"
                    onClick={() => setRailWide((v) => !v)}
                    title={railWide ? '收起导航宽度' : '向右展开显示完整环节名'}
                    aria-label={railWide ? '收起导航宽度' : '向右展开显示完整环节名'}
                  >{railWide ? '«' : '»'}</button>
                ) : null}
              </nav>
              <div className="detail-timeline-gallery">
                {timelineGalleryGroups.map((group) => {
                  const sectionRailKey = group.key || group.id || group.name;
                  return (
                  <section
                    id={group.domId}
                    className={`detail-timeline-section${fileDragActive && railDropKey === sectionRailKey ? ' is-file-drop-over' : ''}`}
                    key={sectionRailKey}
                    data-file-drop-zone="1"
                    onDragOver={(e) => {
                      if (!fileDragActive) return;
                      e.preventDefault();
                      e.dataTransfer.dropEffect = 'copy';
                      if (railDropKey !== sectionRailKey) setRailDropKey(sectionRailKey);
                    }}
                    onDragLeave={() => {
                      if (fileDragActive) setRailDropKey((prev) => (prev === sectionRailKey ? null : prev));
                    }}
                    onDrop={(e) => { if (fileDragActive) handleDirectFileDrop(e, group.id || ''); }}
                  >
                    <div className="detail-timeline-head">
                      <div className="detail-timeline-title">
                        <span>{group.name}</span>
                        {group.sectionTime ? <em>{group.sectionTime}</em> : null}
                      </div>
                      <span className="detail-timeline-count">{group.items.length} 张</span>
                    </div>
                    {group.items.length ? renderTimelineGroupItems(group) : (
                      <div
                        className={`detail-timeline-empty${photoDragActive || fileDragActive ? ' is-drop-ready' : ''}`}
                        onDragOver={(e) => { if (photoDragActive || fileDragActive) { e.preventDefault(); e.dataTransfer.dropEffect = fileDragActive ? 'copy' : 'move'; } }}
                        onDrop={(e) => handleRailDrop(e, group)}
                      >
                        {fileDragActive ? '松手上传到该环节' : (photoDragActive ? '松手移入该环节' : '该环节暂无照片 · 可拖拽照片移入')}
                      </div>
                    )}
                  </section>
                  );
                })}
              </div>
            </div>
          ) : galleryMode === 'masonry' ? (
            <div className="detail-masonry-columns" style={{ '--masonry-cols': masonryColumns }}>
              {masonryBuckets.map((bucket, colIdx) => (
                <div className="detail-masonry-column" key={`masonry-col-${colIdx}`}>
                  {bucket.map(({ src, idx }) => renderPhotoItem(src, idx))}
                </div>
              ))}
            </div>
          ) : (
            visiblePhotoItems.map(({ src, idx }) => renderPhotoItem(src, idx))
          )
        )}
        {!loading && !error && galleryPrepared && hasMoreGalleryPhotos ? (
          <div className="detail-gallery-more" ref={galleryMoreRef}>
            <Button type="tertiary" onClick={loadMoreGalleryPhotos}>
              加载更多{mediaFilter === 'video' ? '视频' : '照片'}（已显示 {visiblePhotoCount} / {mediaFilteredIndexes.length}）
            </Button>
          </div>
        ) : null}
        {deleteMode ? (
          <div className="detail-selection-inline is-expanded">
            <div className="detail-selection-actions">
              <Button className="detail-selection-btn detail-selection-btn--select" onClick={toggleSelectAll}>{allSelected ? '取消全选' : '全选'}</Button>
              {canPackDownload ? <Button className="detail-selection-btn detail-selection-btn--download" onClick={packDownloadSelected} type="tertiary">直接下载</Button> : null}
              {uploadTimelineSections.length > 0 ? (
                <IfCan perms={['photos.edit']}>
                  <Button
                    className="detail-selection-btn"
                    type="tertiary"
                    disabled={selectedCount <= 0 || assigningSection}
                    loading={assigningSection}
                    onClick={() => setMoveSectionVisible(true)}
                    title={selectedCount > 0 ? `把 ${selectedCount} 张照片移入环节` : '先选择照片'}
                  >
                    移入环节{selectedCount > 0 ? ` (${selectedCount})` : ''}
                  </Button>
                </IfCan>
              ) : null}
              <Button
                className="detail-selection-btn detail-selection-btn--danger"
                onClick={canDeletePhotos ? confirmDelete : undefined}
                type="danger"
                loading={deletingPhotos}
                disabled={deletingPhotos || !canDeletePhotos || selectedCount <= 0}
                title={!canDeletePhotos ? '当前账号没有删除照片权限' : (selectedCount > 0 ? `删除 ${selectedCount} 张照片` : '先选择照片')}
              >
                删除{selectedCount > 0 ? ` (${selectedCount})` : ''}
              </Button>
            </div>
          </div>
        ) : null}

        {fileDragActive && canUploadPhotos ? (
          <div className="detail-file-drop-overlay" aria-hidden="true">
            <div className="detail-file-drop-overlay-card">
              {useTimelineGallery ? '拖到目标环节或左侧导航，松手上传' : '松手上传到相册'}
            </div>
          </div>
        ) : null}

        {/* 编辑弹窗 */}
        <Modal
          title="修改项目信息"
          className="detail-edit-modal"
          visible={editVisible}
          onOk={saveEdit}
          onCancel={() => setEditVisible(false)}
          okText="保存"
          cancelText="取消"
          width={isMobile ? 'calc(100vw - 16px)' : undefined}
          bodyStyle={isMobile ? { maxHeight: '70vh', overflowY: 'auto', padding: '12px' } : undefined}
        >
          <div className="detail-edit-modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Input value={editTitle} onChange={(v) => setEditTitle(v)} placeholder="项目标题" />
            <TextArea value={editDescription} onChange={(v) => setEditDescription(v)} rows={4} placeholder="项目描述" />
            {(canUpdateProject || canEditTags) ? (
              <div>
                <div style={{ marginBottom: 6 }}>项目标签（按回车添加）</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {(editTags || []).map((t, i) => (
                    <Tag key={t + i} size="small" type="light" onClick={() => { /* no-op */ }}>{t}
                      <button style={{ marginLeft: 6, border: 'none', background: 'transparent', cursor: 'pointer' }} onClick={(e) => { e.stopPropagation(); setEditTags((s) => s.filter(x => x !== t)); }}>×</button>
                    </Tag>
                  ))}
                  <input className="detail-edit-tag-input" value={editTagInput} onChange={(e) => setEditTagInput(e.target.value)} onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ',') {
                      e.preventDefault();
                      const v = (editTagInput || '').trim();
                      if (v && !(editTags || []).includes(v)) setEditTags((s) => [...(s || []), v]);
                      setEditTagInput('');
                    }
                  }} placeholder="输入标签并回车" style={{ minWidth: 160, padding: '6px 8px' }} />
                </div>
              </div>
            ) : null}
            <DateTimePicker
              dateOnly
              value={(() => {
                if (!editEventDate) return '';
                if (editEventDate instanceof Date && !Number.isNaN(editEventDate.getTime())) {
                  return `${editEventDate.getFullYear()}-${String(editEventDate.getMonth() + 1).padStart(2, '0')}-${String(editEventDate.getDate()).padStart(2, '0')}`;
                }
                return String(editEventDate).slice(0, 10);
              })()}
              onChange={(v) => setEditEventDate(v ? new Date(`${v}T00:00:00`) : null)}
              placeholder="活动日期（可选）"
              style={{ width: '100%' }}
              clearable
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 6 }}>
              {canDeleteProject ? (
                <Button className="detail-edit-delete-btn" type="danger" onClick={handleDeleteProject} loading={deletingProject} disabled={deletingProject}>删除项目</Button>
              ) : null}
            </div>
          </div>
        </Modal>

        {/* 时间线环节编辑弹窗（操作即时生效） */}
        <Modal
          title="编辑时间线"
          className="detail-edit-modal"
          visible={timelineEditVisible}
          onCancel={() => setTimelineEditVisible(false)}
          footer={(
            <Button type="primary" onClick={() => setTimelineEditVisible(false)}>完成</Button>
          )}
          width={isMobile ? 'calc(100vw - 16px)' : 560}
          bodyStyle={{ maxHeight: '62vh', overflowY: 'auto', padding: isMobile ? '12px' : undefined }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {uploadTimelineSections.length === 0 ? (
              <Text style={{ color: 'var(--mg-text-2, #888)' }}>还没有环节，先在下方添加一个。</Text>
            ) : uploadTimelineSections.map((section, idx) => {
              const key = String(section.id || '');
              const edit = sectionRowEdits[key] || { name: section.name || '', sectionTime: section.sectionTime || '' };
              const dirty = edit.name !== (section.name || '') || (edit.sectionTime || '') !== (section.sectionTime || '');
              const timeInputValue = sectionTimeToInputValue(edit.sectionTime);
              const legacyTimeText = edit.sectionTime && !timeInputValue ? edit.sectionTime : '';
              const isDragOver = dragOverSectionIdx === idx && dragSectionIdx !== null && dragSectionIdx !== idx;
              return (
                <div
                  key={key || section.key}
                  onDragOver={(e) => { if (dragSectionIdx !== null) { e.preventDefault(); setDragOverSectionIdx(idx); } }}
                  onDrop={(e) => { e.preventDefault(); commitSectionDrag(idx); }}
                  style={{
                    display: 'flex', gap: 6, alignItems: 'center', flexWrap: isMobile ? 'wrap' : 'nowrap',
                    borderRadius: 8, padding: '2px 0',
                    outline: isDragOver ? '2px solid rgba(76,141,255,0.75)' : 'none',
                    opacity: dragSectionIdx === idx ? 0.5 : 1,
                  }}
                >
                  {!isMobile ? (
                    <span
                      draggable={!timelineBusy}
                      onDragStart={(e) => {
                        setDragSectionIdx(idx);
                        try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', key); } catch (err) { }
                      }}
                      onDragEnd={() => { setDragSectionIdx(null); setDragOverSectionIdx(null); }}
                      title="拖拽调整顺序"
                      style={{ cursor: 'grab', userSelect: 'none', padding: '0 4px', color: 'var(--mg-text-2, #999)', fontSize: 16, lineHeight: 1 }}
                      aria-label={`拖拽移动环节 ${section.name}`}
                    >⠿</span>
                  ) : null}
                  <Input
                    value={edit.name}
                    onChange={(v) => setSectionRowEdits((prev) => ({ ...prev, [key]: { ...edit, name: v } }))}
                    placeholder="环节名称"
                    style={{ flex: 2, minWidth: 110 }}
                  />
                  <DateTimePicker
                    value={timeInputValue}
                    onChange={(v) => setSectionRowEdits((prev) => ({ ...prev, [key]: { ...edit, sectionTime: inputValueToSectionTime(v) } }))}
                    clearable
                    title={legacyTimeText ? `原时间文本：${legacyTimeText}（重新选择后覆盖）` : '环节时间'}
                    style={{ flex: 1.4, minWidth: 168 }}
                  />
                  {isMobile ? (
                    <>
                      <Button theme="borderless" disabled={timelineBusy || idx === 0} onClick={() => handleMoveSectionOrder(section.id, -1)} title="上移">↑</Button>
                      <Button theme="borderless" disabled={timelineBusy || idx === uploadTimelineSections.length - 1} onClick={() => handleMoveSectionOrder(section.id, 1)} title="下移">↓</Button>
                    </>
                  ) : null}
                  <Button type="primary" theme="borderless" disabled={timelineBusy || !dirty} onClick={() => handleSaveSectionRow(section.id)}>保存</Button>
                  <Button type="danger" theme="borderless" disabled={timelineBusy} onClick={() => handleDeleteSection(section)}>删除</Button>
                  {legacyTimeText ? (
                    <span style={{ flexBasis: '100%', fontSize: 12, color: 'var(--mg-text-2, #999)' }}>原时间文本：{legacyTimeText}（重新选择后覆盖）</span>
                  ) : null}
                </div>
              );
            })}
            <div style={{ borderTop: '1px solid rgba(128,128,128,0.25)', paddingTop: 10, display: 'flex', gap: 6, alignItems: 'center', flexWrap: isMobile ? 'wrap' : 'nowrap' }}>
              <Input value={timelineDraftName} onChange={(v) => setTimelineDraftName(v)} placeholder="新环节名称" style={{ flex: 2, minWidth: 110 }} />
              <DateTimePicker
                value={sectionTimeToInputValue(timelineDraftTime)}
                onChange={(v) => setTimelineDraftTime(inputValueToSectionTime(v))}
                clearable
                title="环节时间（可选）"
                style={{ flex: 1.4, minWidth: 168 }}
              />
              <Button type="primary" loading={timelineBusy} disabled={timelineBusy} onClick={handleAddSection}>添加环节</Button>
            </div>
            <Text style={{ fontSize: 12, color: 'var(--mg-text-2, #888)' }}>{isMobile ? '重命名/改时间后点该行"保存"；删除环节时照片会回落到"未归类"。' : '拖动 ⠿ 调整顺序；重命名/改时间后点该行"保存"；删除环节时照片会回落到"未归类"。'}</Text>
          </div>
        </Modal>

        {/* 选中照片移入环节弹窗 */}
        <Modal
          title={`移入环节（已选 ${selectedCount} 张）`}
          className="detail-edit-modal"
          visible={moveSectionVisible}
          onCancel={() => setMoveSectionVisible(false)}
          footer={null}
          width={isMobile ? 'calc(100vw - 16px)' : 420}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: '52vh', overflowY: 'auto' }}>
            {uploadTimelineSections.map((section) => (
              <Button
                key={String(section.id || section.key)}
                theme="light"
                disabled={assigningSection || !section.id}
                onClick={() => handleAssignSelectedToSection(section.id)}
                style={{ justifyContent: 'flex-start', textAlign: 'left' }}
              >
                {section.name}{section.sectionTime ? `（${section.sectionTime}）` : ''}
              </Button>
            ))}
            <Button
              theme="borderless"
              disabled={assigningSection}
              onClick={() => handleAssignSelectedToSection(null)}
              style={{ justifyContent: 'flex-start', textAlign: 'left' }}
            >
              移出环节（未归类）
            </Button>
          </div>
        </Modal>

        {/* 相似分组弹窗 */}
        <Modal
          title="相似照片分组"
          className="detail-sim-modal"
          visible={simModalVisible}
          onCancel={closeSimilarityModal}
          footer={null}
          size="large"
          width={isMobile ? 'calc(100vw - 16px)' : undefined}
          bodyStyle={isMobile ? { maxHeight: '72vh', overflowY: 'auto', padding: '10px 12px 12px' } : undefined}
        >
          <div className="similarity-modal-body">
            {canDeletePhotos ? (
              <div className="similarity-toolbar">
                {!simDeleteMode ? (
                  <Button onClick={() => setSimDeleteMode(true)} type="tertiary">批量选择</Button>
                ) : (
                  <>
                    <Button onClick={() => { setSimDeleteMode(false); setSimSelectedMap({}); setSimSelectedCount(0); }} type="tertiary">取消选择</Button>
                    <PermButton perms={['photos.delete']} onClick={confirmSimDelete} type="danger" loading={simDeleting} disabled={simDeleting}>删除 ({simSelectedCount})</PermButton>
                  </>
                )}
              </div>
            ) : null}
            {simLoading ? (
              <div className="similarity-state">
                <Spin tip="正在分析相似照片" />
              </div>
            ) : simError ? (
              <div className="similarity-state">
                <Text type="danger">{simError}</Text>
              </div>
            ) : (simGroups && simGroups.length) ? (
              <div className="similarity-list">
                {simGroups.map((g, gi) => {
                  // 组内 AI 最高分 = 建议保留（至少两张有分才有比较意义）
                  const scoredIds = g
                    .map((id) => ({ id: String(id), score: getPhotoAiScore(simPhotos[id]) }))
                    .filter((x) => x.score !== null);
                  const bestId = scoredIds.length >= 2
                    ? scoredIds.reduce((a, b) => (b.score > a.score ? b : a)).id
                    : null;
                  return (
                  <div key={gi} className="similarity-group">
                    <div className="similarity-group-head">
                      <span>相似组 {gi + 1}</span>
                      <span className="similarity-group-head-side">
                        <span className="similarity-group-count">{g.length} 张照片</span>
                        {canDeletePhotos && simDeleteMode && bestId ? (
                          <button
                            type="button"
                            className="similarity-group-selectall similarity-group-keepbest"
                            title="选中除 AI 最高分外的全部照片"
                            onClick={() => selectSimGroupExceptBest(g, bestId)}
                          >
                            仅留最佳
                          </button>
                        ) : null}
                        {canDeletePhotos && simDeleteMode ? (
                          <button
                            type="button"
                            className="similarity-group-selectall"
                            onClick={() => toggleSimSelectGroup(g)}
                          >
                            {g.length > 0 && g.every((id) => simSelectedMap[String(id)]) ? '取消全选' : '全选本组'}
                          </button>
                        ) : null}
                      </span>
                    </div>
                    <div className="similarity-group-images">
                      {g.map((id) => {
                        const p = simPhotos[id];
                        const thumb = p ? (p.thumbUrl || p.url || p.thumbSrc || p.originalSrc) : null;
                        const titleText = p ? (p.title || p.name || `#${id}`) : `#${id}`;
                        const url = thumb || (p && (p.url || p.originalSrc)) || (BASE_URL ? `${BASE_URL}/photos/${id}` : `/api/photos/${id}`);
                        const selected = !!simSelectedMap[String(id)];
                        const aiScore = getPhotoAiScore(p);
                        const aiLabel = getSimAiLabel(p);
                        const aiQuality = getPhotoAiQuality(p);
                        const isBest = bestId !== null && String(id) === bestId;
                        return (
                          <div key={id} className={`similarity-thumb${selected ? ' is-selected' : ''}`}>
                            {aiScore !== null ? (
                              <div
                                className={`similarity-thumb-ai${isBest ? ' is-best' : ''}`}
                                style={isBest ? undefined : { color: getAISelectionColor(aiLabel) }}
                                title={formatAiQualityTooltip(aiQuality, aiScore) || undefined}
                              >
                                {isBest ? `建议保留 ${aiScore}` : `${getAISelectionLabel(aiLabel).replace(/^AI/, '')} ${aiScore}`}
                              </div>
                            ) : null}
                            {thumb ? (
                              <img src={thumb} alt={titleText} className="similarity-thumb-img" onClick={() => {
                                if (simDeleteMode) {
                                  toggleSimSelect(String(id));
                                  return;
                                }
                                // try to open in viewer by finding index
                                const findIdx = (photoMetas || []).findIndex(m => String(m.id) === String(id));
                                if (findIdx >= 0) {
                                  closeSimilarityModal();
                                  setTimeout(() => {
                                    openViewerAt(findIdx, thumb || url);
                                  }, 0);
                                } else {
                                  window.open(url, '_blank');
                                }
                              }} />
                            ) : (
                              <div className="similarity-thumb-empty" />
                            )}
                            {canDeletePhotos && simDeleteMode && (
                              <button type="button" className="similarity-select-mark" onClick={(e) => { e.stopPropagation(); toggleSimSelect(String(id)); }}>{selected ? '✓' : ''}</button>
                            )}
                            <div className="similarity-thumb-foot">
                              <div className="similarity-thumb-title">{titleText}</div>
                              {canDeletePhotos && !simDeleteMode && (
                                <button
                                  type="button"
                                  className="similarity-thumb-delete"
                                  aria-label={`删除 ${titleText}`}
                                  disabled={simDeleting}
                                  onClick={(e) => { e.stopPropagation(); confirmSimDeleteOne(id, titleText); }}
                                >
                                  <IconTrash />
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  );
                })}
              </div>
            ) : (
              <div className="similarity-state">
                <Empty description="未发现相似分组" />
              </div>
            )}
          </div>
        </Modal>

        <Modal
          title={uploading ? getUploadProgressTitle(uploadProgress) : `准备上传 (${stagingFiles.length})`}
          visible={uploadMode}
          onOk={confirmUpload}
          onCancel={uploading ? () => Toast.warning('正在上传，请等待完成') : cancelUpload}
          okButtonProps={{
            loading: uploading,
            disabled: !stagingFiles.length || (uploadTimelineEnabled && uploadTimelineSections.length && hasUnassignedStagedFiles),
          }}
          okText="确认上传"
          cancelText="取消"
          closable={!uploading}
          width={isMobile ? 'calc(100vw - 12px)' : 720}
          bodyStyle={isMobile ? { maxHeight: '68vh', overflowY: 'auto', padding: '10px 0 0' } : undefined}
          className="detail-upload-modal"
        >
          <div className="detail-upload-body">
            {uploadTimelineEnabled && uploadTimelineSections.length ? (
              <div className="detail-upload-timeline-panel">
                <div className="detail-upload-timeline-title">选择上传环节</div>
                <div className="detail-upload-timeline" role="radiogroup" aria-label="上传环节">
                  <div className="detail-upload-timeline-track" aria-hidden="true" />
                  {uploadTimelineSections.map((section, index) => {
                    const sectionId = String(section.id || '');
                    const active = sectionId === String(selectedUploadSectionId || '');
                    const stagedCount = stagingCountBySectionId.get(sectionId) || 0;
                    return (
                      <button
                        key={section.key || sectionId}
                        type="button"
                        className={`detail-upload-timeline-node ${index % 2 ? 'is-lower' : 'is-upper'}${active ? ' is-active' : ''}`}
                        onClick={() => setSelectedUploadSectionId(sectionId)}
                        role="radio"
                        aria-checked={active}
                      >
                        <span className="detail-upload-node-dot" aria-hidden="true" />
                        <span className="detail-upload-node-label">{section.name || '未命名环节'}</span>
                        {section.sectionTime ? <span className="detail-upload-node-time">{section.sectionTime}</span> : null}
                        {stagedCount ? <span className="detail-upload-node-count">{stagedCount}</span> : null}
                      </button>
                    );
                  })}
                </div>
                <div className="detail-upload-current-hint">
                  {selectedUploadSection ? `请上传「${selectedUploadSection.name}」环节照片或视频` : '请选择要上传的环节'}
                </div>
              </div>
            ) : null}

            <button
              type="button"
              className={`detail-upload-dropzone${dragActive ? ' is-drag-active' : ''}`}
              onClick={() => {
                if (uploadTimelineEnabled && uploadTimelineSections.length && !selectedUploadSectionId) {
                  Toast.warning('请先选择要上传的环节');
                  return;
                }
                if (fileInputRef.current) fileInputRef.current.click();
              }}
              onDragOver={(e) => {
                e.preventDefault();
                if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
                setDragActive(true);
              }}
              onDragEnter={(e) => {
                e.preventDefault();
                setDragActive(true);
              }}
              onDragLeave={(e) => {
                e.preventDefault();
                setDragActive(false);
              }}
              onDrop={(e) => {
                e.preventDefault();
                setDragActive(false);
                if (e.dataTransfer && e.dataTransfer.files) handleFilesSelected(e.dataTransfer.files, selectedUploadSectionId);
              }}
            >
              <IconPlus />
              <span>
                {uploadTimelineEnabled && uploadTimelineSections.length
                  ? (selectedUploadSection ? `为「${selectedUploadSection.name}」添加照片/视频` : '请选择环节后上传')
                  : (stagingFiles.length ? `继续添加（${stagingFiles.length} 个）` : '选择或拖入照片/视频')}
              </span>
            </button>

            {uploadProgress ? (
              <div className="detail-upload-progress-panel" aria-live="polite">
                <div className="detail-upload-progress-head">
                  <div>
                    <strong>{getUploadProgressTitle(uploadProgress)}</strong>
                    <span>
                      {uploadProgress.completedFiles + uploadProgress.failedFiles} / {uploadProgress.totalFiles} 个
                      {uploadProgress.activeFileName ? ` · ${getUploadPhaseLabel(uploadProgress.activePhase)}：${uploadProgress.activeFileName}` : ''}
                    </span>
                  </div>
                  <b>{uploadProgress.percent || 0}%</b>
                </div>
                <div className="detail-upload-progress-track">
                  <span style={{ width: `${uploadProgress.percent || 0}%` }} />
                </div>
                <div className="detail-upload-progress-meta">
                  <span>{formatUploadBytes(uploadProgress.loadedBytes)} / {formatUploadBytes(uploadProgress.totalBytes)}</span>
                  {uploadProgress.remainingSeconds !== null && uploadProgress.remainingSeconds !== undefined ? (
                    <span>预计剩余 {formatUploadRemainingTime(uploadProgress.remainingSeconds)}</span>
                  ) : null}
                  {uploadProgress.failedFiles ? <span>{uploadProgress.failedFiles} 个失败</span> : null}
                </div>
                <div className="detail-upload-progress-list">
                  {uploadProgressItems.map((item) => (
                    <div
                      key={item.key}
                      className={`detail-upload-progress-file is-${item.status === 'rejected' || item.phase === 'failed' ? 'failed' : item.status === 'fulfilled' || item.phase === 'done' ? 'done' : 'active'}`}
                    >
                      <span className="detail-upload-progress-file-name">{item.name}</span>
                      <span className="detail-upload-progress-file-phase">{getUploadPhaseLabel(item.phase, item.status)}</span>
                      <span className="detail-upload-progress-file-bar"><i style={{ width: `${item.percent || 0}%` }} /></span>
                      <span className="detail-upload-progress-file-percent">
                        {item.percent || 0}%
                        {item.remainingSeconds !== null && item.remainingSeconds !== undefined && item.status !== 'rejected' && item.phase !== 'failed' ? (
                          <em>剩 {formatUploadRemainingTime(item.remainingSeconds)}</em>
                        ) : null}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="detail-upload-section-groups">
              {stagedUploadGroups.map((group) => (
                <section
                  key={group.key}
                  className={`detail-upload-section-group${group.active ? ' is-active' : ''}`}
                  onDragOver={(e) => {
                    e.preventDefault();
                    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (e.dataTransfer && e.dataTransfer.files) handleFilesSelected(e.dataTransfer.files, group.sectionId);
                  }}
                >
                  <div className="detail-upload-section-head">
                    <div className="detail-upload-section-title">
                      <span>{group.name}</span>
                      {group.sectionTime ? <em>{group.sectionTime}</em> : null}
                    </div>
                    <span className="detail-upload-section-count">{group.items.length} 个</span>
                  </div>
                  {group.items.length ? (
                    <div className="detail-upload-preview-grid">
                      {group.items.map((item) => {
                        const itemProgress = uploadProgress?.items?.[getUploadFileKey(item.file)] || null;
                        const isPreviewVideo = isVideoMeta(item.file);
                        const isPreviewUndisplayable = !isPreviewVideo && isBrowserUndisplayableImage(item.file);
                        return (
                          <div
                            key={`${item.index}-${item.preview || item.file.name}`}
                            className={`detail-upload-preview-item${isPreviewVideo ? ' is-video' : ''}${itemProgress ? ' has-upload-progress' : ''}${uploadTimelineEnabled && uploadTimelineSections.length ? ' has-section-select' : ''}`}
                          >
                            {isPreviewVideo ? (
                              <>
                                <span className="detail-upload-preview-video-placeholder">
                                  <span>VIDEO</span>
                                </span>
                                <span className="detail-upload-preview-video-badge">视频</span>
                              </>
                            ) : isPreviewUndisplayable ? (
                              <>
                                <span className="detail-upload-preview-video-placeholder">
                                  <span>{undisplayableFormatLabel(item.file)}</span>
                                </span>
                                <span className="detail-upload-preview-video-badge">转JPEG</span>
                              </>
                            ) : (
                              <img src={item.preview} alt={`preview-${item.index}`} className="detail-upload-preview-media" />
                            )}
                            <button
                              type="button"
                              className="detail-upload-preview-remove"
                              onClick={(e) => {
                                e.stopPropagation();
                                removeStagingFile(item.index);
                              }}
                              disabled={uploading}
                              aria-label="移除媒体"
                              title="移除"
                            >
                              ×
                            </button>
                            {itemProgress ? (
                              <div className={`detail-upload-preview-progress${itemProgress.status === 'fulfilled' || itemProgress.phase === 'done' ? ' is-done' : itemProgress.status === 'rejected' || itemProgress.phase === 'failed' ? ' is-failed' : ''}`}>
                                <span>{getUploadPhaseLabel(itemProgress.phase, itemProgress.status)}</span>
                                <b>
                                  {itemProgress.percent || 0}%
                                  {itemProgress.remainingSeconds !== null && itemProgress.remainingSeconds !== undefined && itemProgress.status !== 'rejected' && itemProgress.phase !== 'failed' ? (
                                    <em>剩 {formatUploadRemainingTime(itemProgress.remainingSeconds)}</em>
                                  ) : null}
                                </b>
                                <i><em style={{ width: `${itemProgress.percent || 0}%` }} /></i>
                              </div>
                            ) : null}
                            {uploadTimelineEnabled && uploadTimelineSections.length ? (
                              <select
                                className="detail-upload-preview-section"
                                value={item.sectionId}
                                onChange={(e) => assignStagingFileSection(item.index, e.target.value)}
                                disabled={uploading}
                                aria-label="调整媒体环节"
                              >
                                <option value="">未选择环节</option>
                                {uploadTimelineSections.map((section) => (
                                  <option key={section.key || section.id} value={section.id}>
                                    {section.name || '未命名环节'}
                                  </option>
                                ))}
                              </select>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="detail-upload-section-empty">暂无媒体，可直接拖入这一环节</div>
                  )}
                </section>
              ))}
              {!stagedUploadGroups.length ? (
                <div className="detail-upload-section-empty">请选择照片或视频后上传</div>
              ) : null}
            </div>
          </div>
        </Modal>

        <Modal
          title="人物信息"
          className="person-sheet-modal"
          visible={facePersonVisible}
          onCancel={closeFacePersonModal}
          footer={null}
          zIndex={10050}
          width={isMobile ? 'calc(100vw - 12px)' : 760}
          bodyStyle={{ maxHeight: isMobile ? '72vh' : '70vh', overflowY: 'auto' }}
        >
          {facePersonLoading ? (
            <div className="person-sheet-loading">
              <div className="person-loading-visual" aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
              <div className="person-loading-copy">
                <div className="person-loading-title">正在同步人物信息</div>
                <div className="person-loading-subtitle">整理人脸与关联照片</div>
              </div>
              <div className="person-loading-skeleton">
                <span />
                <span />
                <span />
              </div>
            </div>
          ) : null}

          {facePersonError ? (
            <div className="person-sheet-error">
              <Text type="danger">{facePersonError}</Text>
            </div>
          ) : null}

          {facePersonData ? (
            (() => {
              const relatedPhotos = Array.isArray(facePersonData.relatedPhotos) ? facePersonData.relatedPhotos : [];
              const heroPhoto = facePersonHeroPhoto || relatedPhotos[0] || null;
              const heroSrc = heroPhoto ? (heroPhoto.url || heroPhoto.thumbUrl || '') : '';
              const heroImgStyle = getFaceHeroImageStyle(facePersonData, heroPhoto);

              return (
                <div className="person-sheet">
                  <div className="person-sheet-hero">
                    <div className="person-sheet-avatar">
                      {heroSrc ? (
                        <img src={heroSrc} alt={facePersonData.displayName} style={heroImgStyle} />
                      ) : (
                        <div className="person-sheet-avatar-empty">无头像</div>
                      )}
                    </div>
                    <div className="person-sheet-meta">
                      <div className="person-sheet-name-row">
                        <Tag size="large" type="solid" color="blue">
                          {facePersonData.displayName}
                        </Tag>
                        {facePersonData.personId ? (
                          <Tag size="small" type="light" color="grey">人物ID: {facePersonData.personId}</Tag>
                        ) : null}
                        {facePersonData.faceId ? (
                          <Tag size="small" type="light" color="grey">人脸ID: {facePersonData.faceId}</Tag>
                        ) : null}
                      </div>

                      {facePersonData.description ? (
                        <div className="person-sheet-desc">{facePersonData.description}</div>
                      ) : null}

                      <div className="person-sheet-stats">该组织下该人物照片：{relatedPhotos.length}</div>

                      <div className="person-sheet-edit-row">
                        <Input
                          value={facePersonEditName}
                          onChange={(v) => setFacePersonEditName(v)}
                          placeholder={facePersonData.personId ? '输入人物姓名' : '输入姓名并绑定到该人脸'}
                          disabled={!canEditFacePersonName || facePersonSaving}
                          maxLength={80}
                          style={{ flex: 1 }}
                        />
                        <Button
                          theme="solid"
                          type="primary"
                          onClick={saveFacePersonName}
                          loading={facePersonSaving}
                          disabled={!canEditFacePersonName || facePersonSaving}
                        >
                          保存姓名
                        </Button>
                      </div>
                      {!canEditFacePersonName ? (
                        <Text type="tertiary" size="small">你没有人物标注权限（faces.label）</Text>
                      ) : null}
                    </div>
                  </div>

                  {relatedPhotos.length > 0 ? (
                    <div className="person-sheet-grid">
                      {relatedPhotos.map((item, idx) => {
                        const thumb = item.thumbUrl || item.url || '';
                        const titleText = item.title || `照片 ${idx + 1}`;
                        const albumLabel = item.projectName || (item.projectId ? `相册 #${item.projectId}` : '原图');
                        return (
                          <article className="person-sheet-card" key={`${item.id || 'face-photo'}-${idx}`}>
                            <button
                              type="button"
                              className="person-sheet-thumb-btn"
                              onClick={() => openRelatedFacePhoto(item)}
                              title="点击预览照片"
                            >
                              {thumb ? (
                                <img
                                  src={thumb}
                                  alt={titleText}
                                  className="person-sheet-thumb"
                                />
                              ) : (
                                <div className="person-sheet-thumb person-sheet-thumb-empty">无图</div>
                              )}
                            </button>

                            <div className="person-sheet-card-body">
                              <div className="person-sheet-card-title" title={titleText}>{titleText}</div>
                              <button
                                type="button"
                                className="person-sheet-album-link"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (!item.projectId || typeof window === 'undefined') return;
                                  const target = `/?projectId=${encodeURIComponent(String(item.projectId))}`;
                                  window.open(target, '_blank', 'noopener,noreferrer');
                                }}
                                title="跳转相册"
                              >
                                {albumLabel}
                              </button>
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  ) : (
                    <Empty description="暂无关联照片" />
                  )}
                </div>
              );
            })()
          ) : null}
        </Modal>

        {/* Image viewer overlay (no container) */}
        {viewerVisible ? (
        <div className="viewer-overlay is-open" onClick={closeViewer} aria-hidden="false">
            <div className="viewer-wrap">
              {/* 顶部状态栏：关闭+计数+摄影师·环节 | AI 分+推荐+原图开关（只读状态集中于此） */}
              <div className="viewer-topbar" onClick={(e) => e.stopPropagation()}>
                <div className="viewer-topbar-left">
                  <button type="button" className="viewer-topbar-close" aria-label="关闭" onClick={() => closeViewer()}>
                    <IconClose />
                  </button>
                  <span className="viewer-topbar-counter">{Math.min(viewerIndex + 1, images.length)} / {images.length}</span>
                  {(() => {
                    const meta = (photoMetas && photoMetas[viewerIndex]) || {};
                    const rawName = meta.photographerName || meta.photographer_name || meta.photographer || (meta.photographerId ? String(meta.photographerId) : null) || (meta.photographer_id ? String(meta.photographer_id) : null);
                    let label = rawName && String(rawName).trim() ? String(rawName) : null;
                    if (!label) {
                      try {
                        const list = (project && (project.photos || project.images || project.gallery)) || (initialProject && (initialProject.photos || initialProject.images || initialProject.gallery)) || [];
                        const found = Array.isArray(list) ? list.find(p => p && (String(p.id) === String(meta.id) || String(p.photoId) === String(meta.id))) : null;
                        const fb = found ? (found.photographerName || found.photographer || found.photographer_name || found.photographerId || found.photographer_id) : null;
                        if (fb) label = String(fb);
                      } catch (e) { /* ignore */ }
                      if (!label) label = meta.photographerId ? `摄影师#${meta.photographerId}` : (meta.photographer_id ? `摄影师#${meta.photographer_id}` : null);
                    }
                    const section = meta.timelineSectionName || null;
                    const text = [label, section].filter(Boolean).join(' · ');
                    return text ? <span className="viewer-topbar-meta" title={text}>{text}</span> : null;
                  })()}
                </div>
                <div className="viewer-topbar-right">
                  {!currentViewerIsVideo && showAILabels && photoMetas?.[viewerIndex]?.id && photoAILabelMap[photoMetas[viewerIndex].id] ? (() => {
                    const label = photoAILabelMap[photoMetas[viewerIndex].id];
                    const meta = photoMetas[viewerIndex];
                    const score = getPhotoAiScore(meta);
                    const quality = getPhotoAiQuality(meta);
                    return (
                      <span
                        className={`viewer-chip viewer-topbar-chip ${getAISelectionChipClass(label)}`}
                        title={formatAiQualityTooltip(quality, score) || undefined}
                      >
                        {getAISelectionLabel(label)}{score !== null ? ` ${score}` : ''}
                      </span>
                    );
                  })() : null}
                  {(() => {
                    const pid = photoMetas?.[viewerIndex]?.id;
                    if (currentViewerIsVideo || !pid) return null;
                    if (!(photoTagsMap[pid] || []).includes('推荐')) return null;
                    return <span className="viewer-chip viewer-topbar-chip viewer-chip--recommend">推荐</span>;
                  })()}
                  {!currentViewerIsVideo && photoMetas && photoMetas[viewerIndex] ? (
                    <button
                      type="button"
                      className={`viewer-topbar-toggle${viewerShowOriginal ? ' is-on' : ''}`}
                      onClick={() => { setViewerEnableOpenZoom(false); setViewerShowOriginal((v) => !v); }}
                    >
                      {viewerShowOriginal ? '缩略图' : '原图'}
                    </button>
                  ) : null}
                </div>
              </div>
              {images.length > 1 ? (
                <button
                  type="button"
                  className="viewer-nav viewer-nav-left"
                  onClick={(e) => { e.stopPropagation(); navigateViewer(-1); }}
                  aria-label="上一张"
                >
                  <IconChevronLeft />
                </button>
              ) : null}

              <div
                className="viewer-img-wrap"
                style={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}
                onPointerDown={handleViewerPointerDown}
                onPointerUp={handleViewerPointerUp}
                onPointerCancel={handleViewerPointerCancel}
              >
                {photoMetas && photoMetas[viewerIndex] ? (
                  <>
                    <div className="viewer-img-stage" onClick={(e) => e.stopPropagation()}>
                      <div className="viewer-carousel" style={viewerTrackStyle}>
                        {images.map((_, idx) => {
                          const slideSrc = idx === viewerIndex && viewerShowOriginal
                            ? getViewerTargetSrc(idx, true)
                            : getViewerTargetSrc(idx, false);
                          const slideMeta = photoMetas?.[idx] || null;
                          const isSlideVideo = isVideoMeta(slideMeta);
                          const slidePhotoId = getMetaPhotoId(slideMeta);
                          const slideFaces = slidePhotoId ? (viewerFaceMap[slidePhotoId] || []) : [];
                          const showFaceBoxes = !isSlideVideo && idx === viewerIndex && viewerFaceOverlayVisible && slideFaces.length > 0;
                          const slideAdjustments = idx === viewerIndex && viewerToneVisible ? viewerToneDraft : getAdjustmentForPhoto(slideMeta);
                          const slideAdjustmentStyle = getPhotoAdjustmentStyle(slideAdjustments);
                          const useExactTonePreview = !isSlideVideo && idx === viewerIndex && !isDefaultPhotoAdjustments(slideAdjustments);
                          return (
                            <div className={`viewer-slide${idx === viewerIndex ? ' is-active' : ''}`} style={viewerSlideStyle} key={`viewer-slide-${idx}`}>
                              <div className="viewer-face-image-surface">
                                {isSlideVideo ? (
                                  slideSrc ? (
                                    <video
                                      src={slideSrc}
                                      className="viewer-carousel-img viewer-carousel-video"
                                      controls
                                      playsInline
                                      preload="metadata"
                                      onLoadedMetadata={(e) => {
                                        if (!slidePhotoId || !e?.target) return;
                                        const width = toFiniteNumber(e.target.videoWidth);
                                        const height = toFiniteNumber(e.target.videoHeight);
                                        if (!width || !height) return;
                                        setViewerImageNaturalMap((prev) => ({ ...(prev || {}), [slidePhotoId]: { width, height } }));
                                      }}
                                    />
                                  ) : (
                                    <div className="viewer-carousel-img viewer-video-processing">
                                      {getVideoUploadState(slideMeta) === 'failed' ? '视频处理失败' : '视频转码中，稍后可播放'}
                                    </div>
                                  )
                                ) : (
                                  <ViewerToneImage
                                    src={slideSrc}
                                    photoId={slidePhotoId}
                                    adjustments={slideAdjustments}
                                    exact={useExactTonePreview}
                                    maxSize={viewerShowOriginal ? 2600 : 1600}
                                    pixelVariant={viewerShowOriginal ? 'original' : 'thumb'}
                                    alt={`viewer-${idx}`}
                                    className={`viewer-carousel-img${idx === viewerIndex && viewerEnableOpenZoom ? ' viewer-img--open-zoom' : ''}`}
                                    style={slideAdjustmentStyle}
                                    onLoad={(e) => handleViewerImageLoad(slidePhotoId, e)}
                                  />
                                )}
                                {showFaceBoxes ? (
                                  <div className="viewer-face-layer">
                                    {slideFaces.map((face, fidx) => (
                                      <button
                                        key={`${face.faceId || 'face'}-${fidx}`}
                                        type="button"
                                        className="viewer-face-box"
                                        style={getViewerFaceBoxStyle(face, slidePhotoId)}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          openFacePersonModal(face);
                                        }}
                                        title={face.label || `人脸#${face.faceNo || (fidx + 1)}`}
                                      >
                                        <span className="viewer-face-box-label">
                                          {face.label || `人脸#${face.faceNo || (fidx + 1)}`}
                                        </span>
                                      </button>
                                    ))}
                                  </div>
                                ) : null}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </>
                ) : images[viewerIndex] ? (
                    <div className="viewer-img-stage" onClick={(e) => e.stopPropagation()}>
                      <div className="viewer-carousel" style={viewerTrackStyle}>
                        {images.map((src, idx) => {
                          const fallbackAdjustments = idx === viewerIndex && viewerToneVisible ? viewerToneDraft : getAdjustmentForPhoto(photoMetas?.[idx]);
                          const fallbackAdjustmentStyle = getPhotoAdjustmentStyle(fallbackAdjustments);
                          const useExactTonePreview = idx === viewerIndex && !isDefaultPhotoAdjustments(fallbackAdjustments);
                          return (
                          <div className={`viewer-slide${idx === viewerIndex ? ' is-active' : ''}`} style={viewerSlideStyle} key={`viewer-fallback-slide-${idx}`}>
                            <div className="viewer-face-image-surface">
                              <ViewerToneImage
                                src={src}
                                photoId={getMetaPhotoId(photoMetas?.[idx])}
                                adjustments={fallbackAdjustments}
                                exact={useExactTonePreview}
                                alt={`viewer-${idx}`}
                                className={`viewer-carousel-img${idx === viewerIndex && viewerEnableOpenZoom ? ' viewer-img--open-zoom' : ''}`}
                                style={fallbackAdjustmentStyle}
                              />
                            </div>
                          </div>
                          );
                        })}
                      </div>
                    </div>
                ) : null}
              </div>

              {viewerToneVisible && !currentViewerIsVideo && (photoMetas && photoMetas[viewerIndex]) ? (
                <div className="viewer-tone-panel" onClick={(e) => e.stopPropagation()}>
                  <div className="viewer-tone-head">
                    <div>
                      <div className="viewer-tone-title">照片调色</div>
                      <div className="viewer-tone-subtitle">非破坏式参数，原图不变</div>
                    </div>
                    <button type="button" className="viewer-tone-close" onClick={() => setViewerToneVisible(false)} aria-label="关闭调色">×</button>
                  </div>

                  <div className="viewer-tone-histogram">
                    <HistogramView histogram={viewerToneAnalysis?.adjustedHistogram} />
                    <div className="viewer-tone-histogram-scale">
                      <span>暗部</span>
                      <span>中间调</span>
                      <span>高光</span>
                    </div>
                    {viewerToneError ? (
                      <div className="viewer-tone-error">{viewerToneError}</div>
                    ) : (
                      <div className="viewer-tone-clipping">
                        {viewerToneAnalyzing ? '计算直方图中' : `阴影溢出 ${Math.round((viewerToneAnalysis?.clipping?.shadows || 0) * 1000) / 10}% · 高光溢出 ${Math.round((viewerToneAnalysis?.clipping?.highlights || 0) * 1000) / 10}%`}
                      </div>
                    )}
                  </div>

                  <div className="viewer-tone-actions">
                    <button type="button" onClick={autoTuneCurrentPhoto} disabled={viewerToneAnalyzing}>自动</button>
                    <button type="button" onClick={resetViewerTone}>重置</button>
                    <button type="button" className="is-primary" onClick={saveViewerTone} disabled={viewerToneSaving}>
                      {viewerToneSaving ? '保存中' : '保存'}
                    </button>
                  </div>

                  <div className="viewer-tone-sliders">
                    {[
                      ['brightness', '亮度', -100, 100],
                      ['contrast', '对比度', -100, 100],
                      ['highlights', '高光', -100, 100],
                      ['shadows', '阴影', -100, 100],
                      ['whites', '白色', -100, 100],
                      ['blacks', '黑色', -100, 100],
                      ['temperature', '白平衡', -100, 100],
                      ['tint', '色调', -100, 100],
                    ].map(([key, label, min, max]) => (
                      <label className="viewer-tone-slider" key={key}>
                        <span>{label}</span>
                        <input
                          type="range"
                          min={min}
                          max={max}
                          step="1"
                          value={Math.round(Number(viewerToneDraft[key] || 0))}
                          onChange={(e) => updateToneDraft(key, e.target.value)}
                        />
                        <strong>{Math.round(Number(viewerToneDraft[key] || 0))}</strong>
                      </label>
                    ))}
                  </div>
                </div>
              ) : null}

              {/* 底部信息+操作坞：语义信息卡 + 一条图标操作栏，全部集中在此 */}
              <div className="viewer-dock" onClick={(e) => e.stopPropagation()}>
                {photoMetas && photoMetas[viewerIndex] ? (() => {
                       const state = getPhotoSemanticState(photoMetas[viewerIndex] || {});
                       const { description, tags, pending } = state;
                       const hasDesc = !!description;
                       const hasTags = tags.length > 0;
                       const hasVerdict = !!getPhotoAiQuality(photoMetas[viewerIndex]);
                       if (!hasDesc && !hasTags && !pending && !viewerEditVisible && !hasVerdict) return null;
                       return (
                         <div
                           className={`viewer-info-card${viewerEditVisible ? ' is-editing' : ''}`}
                          onClick={viewerEditVisible ? (e) => e.stopPropagation() : undefined}
                        >
                          {viewerEditVisible ? (
                            <div className="viewer-edit-panel">
                              <TextArea className="viewer-edit-textarea" value={viewerEditDescription} onChange={(v) => setViewerEditDescription(v)} rows={4} placeholder="照片描述" />
                              <div className="viewer-edit-label">照片标签（按回车添加）</div>
                              <div className="viewer-edit-tags">
                                {(viewerEditTags || []).map((t, i) => (
                                  <Tag key={t + i} size="small" type="light">{t}
                                    <button className="viewer-edit-tag-remove" onClick={(e) => { e.stopPropagation(); setViewerEditTags((s) => s.filter(x => x !== t)); }}>×</button>
                                  </Tag>
                                ))}
                                <input className="viewer-edit-tag-input" value={viewerEditTagInput} onChange={(e) => setViewerEditTagInput(e.target.value)} onKeyDown={(e) => {
                                  if (e.key === 'Enter' || e.key === ',') {
                                    e.preventDefault();
                                    const v = (viewerEditTagInput || '').trim();
                                    if (v && !(viewerEditTags || []).includes(v)) setViewerEditTags((s) => [...(s || []), v]);
                                    setViewerEditTagInput('');
                                  }
                                }} placeholder="输入标签并回车" />

                                <div className="viewer-edit-actions">
                                  <button type="button" className="viewer-original-btn viewer-action-primary" onClick={(e) => { e.stopPropagation(); saveViewerPhotoEdit(); }}>保存</button>
                                  <button type="button" className="viewer-original-btn viewer-action-muted" onClick={(e) => { e.stopPropagation(); setViewerEditVisible(false); }}>取消</button>
                                </div>
                              </div>
                            </div>
                           ) : (
                             <div className="viewer-semantic-panel">
                               {pending && !hasDesc && !hasTags && (
                                 <div className="viewer-analysis-pending">
                                   <span className="detail-analysis-dot" />
                                   语义分析中
                                 </div>
                               )}
                               {hasDesc && (
                                 <div className="viewer-description">{description}</div>
                               )}
                               {hasTags && (
                                 <div className="viewer-semantic-tags">
                                   {tags.map((tag, i) => (
                                     <span key={i} className="viewer-semantic-tag">{tag}</span>
                                   ))}
                                 </div>
                              )}
                              {(() => {
                                const meta = photoMetas[viewerIndex] || {};
                                const quality = getPhotoAiQuality(meta);
                                const score = getPhotoAiScore(meta);
                                if (!quality || (!quality.reason && score === null)) return null;
                                return (
                                  <div className="viewer-ai-verdict" title={formatAiQualityTooltip(quality, score) || undefined}>
                                    <span className="viewer-ai-verdict-score">AI 选片{score !== null ? ` ${score} 分` : ''}</span>
                                    {quality.reason ? <span className="viewer-ai-verdict-reason">{quality.reason}</span> : null}
                                    {Array.isArray(quality.flags) && quality.flags.length ? (
                                      <span className="viewer-ai-verdict-flags">{quality.flags.join(' · ')}</span>
                                    ) : null}
                                  </div>
                                );
                              })()}
                            </div>
                          )}
                        </div>
                      );
                    })() : null}
                <div className="viewer-dock-actions">
                  {!readOnly && !currentViewerIsVideo && (photoMetas && photoMetas[viewerIndex]) && (
                    <button
                      type="button"
                      className={`viewer-dock-btn${viewerFaceOverlayVisible ? ' is-active' : ''}`}
                      title={viewerFaceOverlayVisible ? '隐藏人脸框' : '显示人脸框'}
                      onClick={(e) => { e.stopPropagation(); handleDetectViewerFaces(); }}
                    >
                      <IconFaceScan />
                      <span>人脸框</span>
                    </button>
                  )}
                  {!readOnly && !currentViewerIsVideo && canEditPhotos && (photoMetas && photoMetas[viewerIndex]) && (
                    <button
                      type="button"
                      className={`viewer-dock-btn${viewerToneVisible ? ' is-active' : ''}`}
                      title={viewerToneVisible ? '关闭调色' : '调色'}
                      onClick={(e) => { e.stopPropagation(); openToneEditor(); }}
                    >
                      <IconSliders />
                      <span>调色</span>
                    </button>
                  )}
                  {(photoMetas && photoMetas[viewerIndex]) && (
                    <button
                      type="button"
                      className="viewer-dock-btn"
                      title={currentViewerIsVideo ? '修改视频信息' : '修改照片信息'}
                      onClick={(e) => { e.stopPropagation(); openPhotoEditModal(); }}
                    >
                      <IconInfoEdit />
                      <span>编辑信息</span>
                    </button>
                  )}
                  {(() => {
                    const meta = photoMetas?.[viewerIndex];
                    if (!meta || !meta.id) return null;
                    const hasRecommendTag = (photoTagsMap[meta.id] || []).includes('推荐');
                    const hasAIRecommend = photoAILabelMap[meta.id] === 'recommended';
                    if (!canEditTags || hasRecommendTag || hasAIRecommend) return null;
                    return (
                      <button
                        type="button"
                        className="viewer-dock-btn"
                        title="添加推荐标记"
                        onClick={(e) => { e.stopPropagation(); addRecommendationTag(); }}
                      >
                        <IconStar />
                        <span>推荐</span>
                      </button>
                    );
                  })()}
                  {!readOnly && !currentViewerIsVideo && canEditPhotos && isGroupPhotoMeta(photoMetas?.[viewerIndex]) ? (
                    <button
                      type="button"
                      className="viewer-dock-btn"
                      title="AI 从连拍中为每个人挑最佳表情，合成一张新合影"
                      onClick={(e) => { e.stopPropagation(); openViewerRescue(photoMetas?.[viewerIndex]); }}
                    >
                      <IconGroupRescue />
                      <span>合影救场</span>
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="viewer-dock-btn viewer-dock-btn--primary"
                    title={currentViewerIsVideo ? '下载该视频' : '下载该照片'}
                    onClick={(e) => { e.stopPropagation(); downloadCurrentPhoto(); }}
                  >
                    <IconDownload />
                    <span>下载</span>
                  </button>
                </div>
                {currentViewerFaceError ? (
                  <div className="viewer-dock-error" title={currentViewerFaceError}>{currentViewerFaceError}</div>
                ) : null}
              </div>

              {images.length > 1 ? (
                <button
                  type="button"
                  className="viewer-nav viewer-nav-right"
                  onClick={(e) => { e.stopPropagation(); navigateViewer(1); }}
                  aria-label="下一张"
                >
                  <IconChevronRight />
                </button>
              ) : null}
            </div>
          </div>
        ) : null}

        {/* Inline viewer edit 鈥?replaced modal with inline editor under the photo */}

        {/* 合影救场确认层：查看器语义入口打开，自动圈出连拍组 */}
        {viewerRescue && !viewerRescue.hidden ? (
          <Modal
            title="合影救场"
            className="viewer-rescue-modal"
            visible
            onCancel={closeViewerRescue}
            footer={null}
            width={isMobile ? 'calc(100vw - 16px)' : 560}
          >
            <div className="viewer-rescue-body">
              {viewerRescue.phase === 'loading' ? (
                <div className="viewer-rescue-state"><Spin tip="正在寻找这张照片的连拍参考" /></div>
              ) : viewerRescue.phase === 'pick' ? (
                <>
                  <div className="viewer-rescue-hint">
                    以<b>当前照片为基底</b>，AI 会为里面的每个人检查表情：闭眼或状态不佳的，从参考照片
                    {viewerRescue.refIds && viewerRescue.refIds.length ? '和人脸库' : '（这张没有连拍参考）或人脸库'}
                    里找同一人的最佳瞬间换上。原照片不受影响。
                  </div>
                  {viewerRescue.refIds && viewerRescue.refIds.length ? (
                    <>
                      <div className="viewer-rescue-subtitle">连拍参考（可取消勾选）</div>
                      <div className="viewer-rescue-grid">
                        {viewerRescue.refIds.map((id) => {
                          const p = simPhotos[id];
                          const thumb = p ? (p.thumbUrl || p.url || p.thumbSrc) : null;
                          const picked = !!(viewerRescue.pickedMap && viewerRescue.pickedMap[id]);
                          return (
                            <button
                              key={id}
                              type="button"
                              className={`viewer-rescue-thumb${picked ? ' is-picked' : ''}`}
                              onClick={() => toggleViewerRescuePick(id)}
                              title={picked ? '点击取消选择' : '点击选择'}
                            >
                              {thumb ? <img src={thumb} alt={`#${id}`} loading="lazy" /> : <span className="viewer-rescue-thumb-fallback">#{id}</span>}
                              <span className={`viewer-rescue-thumb-check${picked ? ' is-on' : ''}`} aria-hidden>✓</span>
                            </button>
                          );
                        })}
                      </div>
                    </>
                  ) : (
                    <div className="viewer-rescue-subtitle">没有找到连拍，将直接从人脸库为每个人寻找替补脸。</div>
                  )}
                  <div className="viewer-rescue-actions">
                    <Button onClick={closeViewerRescue} type="tertiary">取消</Button>
                    <Button type="primary" onClick={startViewerRescue}>
                      开始修复{Object.keys(viewerRescue.pickedMap || {}).length ? `（${Object.keys(viewerRescue.pickedMap || {}).length} 张参考）` : '（用人脸库）'}
                    </Button>
                  </div>
                </>
              ) : viewerRescue.phase === 'running' ? (
                <div className="viewer-rescue-state">
                  <Spin tip={viewerRescue.step || '合成中'} />
                  <Text type="secondary">大约需要 1-2 分钟。可以关闭此窗口，完成后会提示。</Text>
                </div>
              ) : viewerRescue.phase === 'done' ? (
                <div className="viewer-rescue-state">
                  <Text>合成完成：替换了 {viewerRescue.replacedCount} 张人脸，新照片已加入相册末尾。</Text>
                  <Button type="primary" onClick={() => setViewerRescue(null)}>好的</Button>
                </div>
              ) : viewerRescue.phase === 'noop' ? (
                <div className="viewer-rescue-state">
                  <Text>{viewerRescue.step || '这张合影里每个人已是最佳状态，无需合成。'}</Text>
                  <Button onClick={() => setViewerRescue(null)} type="tertiary">知道了</Button>
                </div>
              ) : (
                <div className="viewer-rescue-state">
                  <Text type="danger">合成失败：{viewerRescue.error || '未知错误'}</Text>
                  <Button onClick={() => setViewerRescue(null)} type="tertiary">关闭</Button>
                </div>
              )}
            </div>
          </Modal>
        ) : null}

      </div>
    </div>
  );
}

export default ProjectDetail;
