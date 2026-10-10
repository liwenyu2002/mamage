// src/ProjectCard.jsx
import React from 'react';
import { fetchRandomByProject } from './services/photoQueryService';
import { fetchProjectPreviews, PROJECT_PREVIEW_LIMIT } from './services/projectPreviewService';
import { resolveAssetUrl } from './services/request';
import { pickProjectPreviewSrc as pickThumbSrc, projectPreviewSourceKey, findProjectPreviewPhotoId } from './utils/projectPreviewPhotos';
import { IconGridView, IconListView, IconSimilarStack, IconStar } from './ui/icons';
import './ProjectCard.css';

const FALLBACK_THUMB_CACHE = new Map();
const FALLBACK_THUMB_IN_FLIGHT = new Map();
const FALLBACK_THUMB_MAX_CONCURRENT = 3;
let fallbackThumbActiveCount = 0;
const fallbackThumbQueue = [];

function runFallbackThumbQueue() {
  if (fallbackThumbActiveCount >= FALLBACK_THUMB_MAX_CONCURRENT) return;
  const next = fallbackThumbQueue.shift();
  if (!next) return;
  fallbackThumbActiveCount += 1;
  Promise.resolve()
    .then(next.task)
    .then(next.resolve, next.reject)
    .finally(() => {
      fallbackThumbActiveCount = Math.max(0, fallbackThumbActiveCount - 1);
      runFallbackThumbQueue();
    });
}

function scheduleFallbackThumbFetch(task) {
  return new Promise((resolve, reject) => {
    fallbackThumbQueue.push({ task, resolve, reject });
    runFallbackThumbQueue();
  });
}

const truncateText = (text, maxLength = 30) => {
  const safe = String(text || '');
  if (safe.length <= maxLength) return safe;
  return safe.substring(0, maxLength) + '...';
};

const sameStringList = (a, b) => {
  if (a === b) return true;
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
};

function ImportStatusBadge({ summary }) {
  if (!summary || summary.status === 'completed') return null;
  const { status, scanStatus } = summary;
  const done = Number(summary.doneCount) || 0;
  const discovered = Number(summary.discoveredCount) || 0;
  const total = Math.max(Number(summary.selectedCount) || 0, Number(summary.reportedTotal) || 0, discovered);
  const active = status === 'queued' || status === 'running';
  const label = status === 'queued' ? '等待转存'
    : status === 'running' ? (scanStatus === 'completed' ? '正在转存' : '正在解析')
      : status === 'paused' ? '转存已暂停'
        : status === 'completed_with_errors' ? (done ? '部分照片未转存' : '转存失败')
          : status === 'cancelled' ? '转存已停止' : null;
  if (!label) return null;
  const detail = status === 'running' && scanStatus !== 'completed'
    ? (discovered ? `已发现 ${discovered} 张` : '')
    : total ? `${done}/${total} 张` : (done ? `已转存 ${done} 张` : '');
  const showProgress = active && total > 0 && (scanStatus === 'completed' || Number(summary.reportedTotal) > 0);
  return (
    <div className={`project-card__import is-${status}`} aria-label={`${label}${detail ? `，${detail}` : ''}`}>
      <span className="project-card__import-dot" aria-hidden="true" />
      <span className="project-card__import-label">{label}</span>
      {detail ? <span className="project-card__import-count">{detail}</span> : null}
      {showProgress ? <span className="project-card__import-track" aria-hidden="true">
        <span style={{ width: `${Math.min(100, Math.round((done / total) * 100))}%` }} />
      </span> : null}
    </div>
  );
}

function ProjectCard({
  id,
  title,
  subtitle,
  date,
  startDate,
  createdAt,
  updatedAt,
  description,
  originLabel,
  count,
  pinned = false,
  images = [],
  cover = null,
  thumbnails = [],
  previewPhotos = [],
  importStatus,
  previewScope,
  selectionMode = false,
  onClick,
  onPreviewOpen,
  onHoverIntent,
}) {
  const main = cover || images[0];
  const resolvedMain = main ? resolveAssetUrl(pickThumbSrc(main) || main) : null;

  const normalizedImages = React.useMemo(() => (
    (Array.isArray(images) ? images : [])
      .map((it) => resolveAssetUrl(pickThumbSrc(it) || it))
      .filter(Boolean)
  ), [images]);
  const normalizedThumbnails = React.useMemo(() => (
    (Array.isArray(thumbnails) ? thumbnails : [])
      .map((it) => resolveAssetUrl(pickThumbSrc(it) || it))
      .filter(Boolean)
  ), [thumbnails]);

  const [fallbackThumbs, setFallbackThumbs] = React.useState([]);
  const [fallbackPhotos, setFallbackPhotos] = React.useState([]);
  const [coverOverride, setCoverOverride] = React.useState(null);
  const [loadedMap, setLoadedMap] = React.useState({});
  const [failedMap, setFailedMap] = React.useState({});
  const [hoverPreview, setHoverPreview] = React.useState(null);
  const [previewExpanded, setPreviewExpanded] = React.useState(false);
  const [diverseThumbs, setDiverseThumbs] = React.useState(null);
  const [previewLoading, setPreviewLoading] = React.useState(false);
  const previewPointerInside = React.useRef(false);
  const thumbGridRef = React.useRef(null);
  const restorePreviewFocus = React.useRef(null);
  const mediaId = React.useId();
  const markFailed = (src) => {
    if (!src) return;
    setFailedMap((prev) => (prev[src] ? prev : { ...prev, [src]: true }));
  };
  const [isVisible, setIsVisible] = React.useState(false);
  const cardRef = React.useRef(null);
  const previewRevision = `${updatedAt || ''}:${count ?? ''}`;

  React.useEffect(() => {
    setDiverseThumbs(null);
    setPreviewExpanded(false);
    setHoverPreview(null);
    setFallbackPhotos([]);
    setFallbackThumbs([]);
    setCoverOverride(null);
    previewPointerInside.current = false;
  }, [id, previewRevision, previewScope?.userId, previewScope?.unitId, previewScope?.organizationId]);

  React.useEffect(() => {
    if (!previewExpanded || !id || diverseThumbs !== null) return undefined;
    let cancelled = false;
    const timer = setTimeout(() => {
      setPreviewLoading(true);
      fetchProjectPreviews(id, { scope: previewScope, revision: previewRevision }).then(list => {
        if (cancelled) return;
        const sources = list.map(item => resolveAssetUrl(pickThumbSrc(item))).filter(Boolean);
        if (!sources.length) return;
        const buttons = [...(thumbGridRef.current?.querySelectorAll('button') || [])];
        const focusedIndex = buttons.indexOf(document.activeElement);
        if (focusedIndex >= 0 && document.activeElement.matches(':focus-visible')) restorePreviewFocus.current = focusedIndex;
        setDiverseThumbs(list);
      }).catch(() => {}).finally(() => { if (!cancelled) setPreviewLoading(false); });
    }, 120);
    return () => { cancelled = true; clearTimeout(timer); setPreviewLoading(false); };
  }, [id, previewExpanded, diverseThumbs, previewRevision, previewScope]);

  React.useLayoutEffect(() => {
    if (restorePreviewFocus.current === null) return;
    const buttons = [...(thumbGridRef.current?.querySelectorAll('button') || [])];
    buttons[Math.min(restorePreviewFocus.current, buttons.length - 1)]?.focus({ preventScroll: true });
    restorePreviewFocus.current = null;
  }, [diverseThumbs]);

  React.useEffect(() => {
    const node = cardRef.current;
    if (!node || typeof onHoverIntent !== 'function') return undefined;
    const run = () => onHoverIntent();
    node.addEventListener('pointerenter', run, { passive: true });
    node.addEventListener('focusin', run);
    return () => {
      node.removeEventListener('pointerenter', run);
      node.removeEventListener('focusin', run);
    };
  }, [onHoverIntent]);

  React.useEffect(() => {
    let canceled = false;
    const availablePreviewCount = new Set([...normalizedThumbnails, ...normalizedImages, resolvedMain].filter(Boolean)).size;
    const expectedPreviewCount = Number(count) > 0 ? Math.min(4, Number(count)) : 4;
    if (!id || !isVisible || (count != null && Number(count) === 0) || availablePreviewCount >= expectedPreviewCount) {
      return undefined;
    }

    const applyFallbacks = (list) => {
      if (canceled) return;
      const srcs = list.map(item => resolveAssetUrl(pickThumbSrc(item))).filter(Boolean);
      setFallbackPhotos(list);
      const existing = new Set([...normalizedThumbnails, ...normalizedImages]);
      const filtered = srcs.filter((s) => s && s !== resolvedMain && !existing.has(s));
      const nextFallbacks = filtered.slice(0, 3);
      setFallbackThumbs((prev) => (sameStringList(prev, nextFallbacks) ? prev : nextFallbacks));
      const firstAbs = srcs.find((s) => /^https?:\/\//i.test(s));
      const isRelativeMain = !!(resolvedMain && resolvedMain.startsWith('/'));
      if (isRelativeMain && firstAbs) {
        setCoverOverride((prev) => (prev === firstAbs ? prev : firstAbs));
      }
    };

    const cacheKey = String(id);
    const cached = FALLBACK_THUMB_CACHE.get(cacheKey);
    if (cached) {
      applyFallbacks(cached);
      return () => {
        canceled = true;
      };
    }

    let promise = FALLBACK_THUMB_IN_FLIGHT.get(cacheKey);
    if (!promise) {
      promise = scheduleFallbackThumbFetch(() => fetchRandomByProject(id, 6))
        .then((res) => {
          const list = Array.isArray(res?.list) ? res.list : (Array.isArray(res) ? res : []);
          FALLBACK_THUMB_CACHE.set(cacheKey, list);
          FALLBACK_THUMB_IN_FLIGHT.delete(cacheKey);
          return list;
        })
        .catch((err) => {
          FALLBACK_THUMB_IN_FLIGHT.delete(cacheKey);
          throw err;
        });
      FALLBACK_THUMB_IN_FLIGHT.set(cacheKey, promise);
    }

    promise.then(applyFallbacks).catch(() => {});
    return () => {
      canceled = true;
    };
  }, [id, isVisible, count, normalizedThumbnails, normalizedImages, resolvedMain]);

  React.useEffect(() => {
    setHoverPreview(null);
  }, [id]);

  React.useEffect(() => {
    if (isVisible) return undefined;
    const node = cardRef.current;
    if (!node || typeof IntersectionObserver === 'undefined') {
      setIsVisible(true);
      return undefined;
    }
    const isMobile = typeof window !== 'undefined' && window.innerWidth <= 768;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setIsVisible(true);
        observer.disconnect();
      }
    }, { rootMargin: isMobile ? '220px 0px' : '360px 0px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, [isVisible]);

  const pickByMaxId = () => {
    const candidates = [];
    const pushFromItem = (it) => {
      if (!it || typeof it !== 'object') return;
      const rawId = it.id || it.photoId || it.photo_id;
      const src = pickThumbSrc(it);
      const numId = Number(rawId);
      if (!Number.isFinite(numId) || !src) return;
      candidates.push({ id: numId, src: resolveAssetUrl(src) });
    };
    if (Array.isArray(thumbnails)) thumbnails.forEach(pushFromItem);
    if (Array.isArray(images)) images.forEach(pushFromItem);
    if (cover && typeof cover === 'object') pushFromItem(cover);
    if (!candidates.length) return null;
    candidates.sort((a, b) => b.id - a.id);
    return candidates[0].src || null;
  };

  const byIdCover = pickByMaxId();
  const coverDisplayed = coverOverride
    || resolvedMain
    || byIdCover
    || normalizedThumbnails[0]
    || fallbackThumbs[0]
    || normalizedImages[0];

  const combined = [];
  const pushIfUnique = (s) => {
    if (!s || s === coverDisplayed || combined.includes(s)) return;
    combined.push(s);
  };
  normalizedThumbnails.forEach(pushIfUnique);
  fallbackThumbs.forEach(pushIfUnique);
  normalizedImages.forEach(pushIfUnique);
  pushIfUnique(resolvedMain);
  const uniqueSources = (sources) => {
    const seen = new Set();
    return sources.filter(src => {
      if (!src || failedMap[src]) return false;
      // Media signatures can change between the initial list and hover request.
      const key = projectPreviewSourceKey(src);
      if (seen.has(key)) return false;
      seen.add(key); return true;
    });
  };
  const baseSources = uniqueSources([coverDisplayed || resolvedMain, ...combined]).slice(0, PROJECT_PREVIEW_LIMIT + 1);
  const diverseSources = diverseThumbs ? uniqueSources([coverDisplayed || resolvedMain, ...diverseThumbs.map(item => resolveAssetUrl(pickThumbSrc(item)))]).slice(0, PROJECT_PREVIEW_LIMIT + 1) : [];
  const previewSources = count != null && Number(count) === 0 ? [] : diverseSources.length > 1 ? diverseSources : baseSources;
  const others = previewSources.slice(1, previewExpanded ? PROJECT_PREVIEW_LIMIT + 1 : 4);
  const previewColumns = Math.min(10, Math.max(1, others.length));
  const previewRows = Math.ceil(others.length / previewColumns);
  const activeSource = previewSources.includes(hoverPreview) ? hoverPreview : previewSources[0];
  const activeIndex = previewSources.indexOf(activeSource);
  const coverSources = uniqueSources([previewSources[0], activeSource]);
  const visibleCover = loadedMap[activeSource] ? activeSource : previewSources[0];
  const closePreview = () => { setPreviewExpanded(false); setHoverPreview(null); };

  const formatDay = (d) => {
    if (!d) return null;
    try {
      const dt = typeof d === 'string' ? new Date(d) : (d instanceof Date ? d : new Date(String(d)));
      if (Number.isNaN(dt.getTime())) {
        const s = String(d || '');
        return s.length >= 10 ? s.slice(0, 10) : s;
      }
      const y = dt.getFullYear();
      const m = String(dt.getMonth() + 1).padStart(2, '0');
      const day = String(dt.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    } catch (e) {
      return String(d || '').slice(0, 10);
    }
  };

  let dateLabel = '';
  let dateText = null;
  if (startDate) {
    dateLabel = '开展于';
    dateText = formatDay(startDate);
  } else if (createdAt) {
    dateLabel = '创建于';
    dateText = formatDay(createdAt);
  } else if (date) {
    dateText = formatDay(date);
  }

  const descText = (description && String(description).trim())
    ? truncateText(description, 40)
    : '';

  const markLoaded = (src) => {
    if (!src) return;
    setLoadedMap((prev) => (prev[src] ? prev : { ...prev, [src]: true }));
  };

  return (
    <article className="project-card project-card--visual" ref={cardRef} aria-label={title}>
      <button type="button" className="project-card__open" onClick={onClick} aria-label={`打开相册 ${title}`}>
        <span className="project-card__cover-image" id={mediaId} data-active-preview={activeIndex}>
          {coverSources.map((src) => <img key={src} src={src} alt="" loading="lazy" decoding="async" draggable={false}
            className={`project-card__img${loadedMap[src] ? ' is-ready' : ''}${src === visibleCover ? ' is-active' : ''}`}
            onLoad={() => markLoaded(src)} onError={() => markFailed(src)} />)}
          {!previewSources.length && <span className="project-card__cover-empty"><IconGridView /><span>暂无照片</span></span>}
          <span className="project-card__count"><IconSimilarStack /><span>{count ?? previewSources.length} 作品</span>{pinned && <IconStar className="project-card__pin" aria-label="已置顶" />}</span>
          {activeIndex > 0 && <span className="project-card__frame-index" aria-hidden="true">{String(activeIndex + 1).padStart(2, '0')} / {String(previewSources.length).padStart(2, '0')}</span>}
        </span>
      </button>
      {others.length > 0 && <div ref={thumbGridRef} className={`project-card__thumb-grid${previewExpanded && others.length > 3 ? ' is-expanded' : ''}`} style={{ '--project-preview-columns': previewColumns, '--project-preview-rows': previewRows }} role="group" aria-label={`${title} 照片预览`} aria-busy={previewLoading}
        onPointerEnter={(event) => { if (!selectionMode && event.pointerType === 'mouse') { previewPointerInside.current = true; setPreviewExpanded(true); } }}
        onPointerLeave={() => { previewPointerInside.current = false; setHoverPreview(null); if (!thumbGridRef.current?.contains(document.activeElement) || !document.activeElement?.matches(':focus-visible')) setPreviewExpanded(false); }}
        onFocus={(event) => { if (!selectionMode && event.target.matches(':focus-visible')) setPreviewExpanded(true); }}
        onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) { setHoverPreview(null); if (!previewPointerInside.current) setPreviewExpanded(false); } }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') { event.currentTarget.querySelector('button')?.focus({ preventScroll: true }); closePreview(); return; }
          if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          const buttons = [...event.currentTarget.querySelectorAll('button')];
          const index = buttons.indexOf(document.activeElement);
          const step = previewRows > 1 && ['ArrowUp', 'ArrowDown'].includes(event.key) ? previewColumns : 1;
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
            : (index + (['ArrowRight', 'ArrowDown'].includes(event.key) ? step : -step) + buttons.length) % buttons.length;
          buttons[next]?.focus({ preventScroll: true });
        }}>
        {others.map((src, index) => <button type="button" className="project-card__thumb" key={src} aria-controls={mediaId}
          aria-label={selectionMode ? `选择相册 ${title}，小图 ${index + 1}` : `打开 ${title} 第 ${index + 2} 张照片`} title={selectionMode ? '选择相册' : `打开第 ${index + 2} 张照片`}
          onPointerEnter={(event) => { if (!selectionMode && event.pointerType === 'mouse') setHoverPreview(src); }}
          onFocus={(event) => { if (!selectionMode && event.currentTarget.matches(':focus-visible')) setHoverPreview(src); }}
          onClick={(event) => {
            event.stopPropagation();
            const photoId = findProjectPreviewPhotoId(src, [...(diverseThumbs || []), ...previewPhotos, ...thumbnails, ...fallbackPhotos, ...images, cover], resolveAssetUrl);
            if (onPreviewOpen) onPreviewOpen({ photoId, src });
            else onClick?.();
          }}>
          <img src={src} alt="" loading="lazy" decoding="async" draggable={false}
            className={`project-card__img${loadedMap[src] ? ' is-ready' : ''}`}
            onLoad={() => markLoaded(src)} onError={() => markFailed(src)} />
        </button>)}
      </div>}
      <div className="project-card__info">
        <button type="button" className="project-card__copy" onClick={onClick} aria-label={`进入相册 ${title}`}>
          <strong className="project-card__title" title={title}>{title}</strong>
          <span className="project-card__detail">
            {dateText && <span className="project-card__date" title={`${dateLabel} ${dateText}`}>{dateText}</span>}
            {subtitle && <span className="project-card__tag" title={subtitle}><IconListView /><span>{subtitle}</span></span>}
          </span>
        </button>
        <ImportStatusBadge summary={importStatus} />
        {originLabel ? <span className="project-card__origin" title={`来自 ${originLabel}`}>来自 {originLabel}</span> : null}
        {descText ? <span className="project-card__description" title={String(description)}>{descText}</span> : null}
      </div>
    </article>
  );
}

export default ProjectCard;
