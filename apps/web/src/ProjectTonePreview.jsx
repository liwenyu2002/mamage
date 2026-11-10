import React from 'react';
import { getToken } from './services/authService';
import { BASE_URL } from './services/request';
import { IconChevronLeft, IconChevronRight } from './ui/icons';
import ReactCrop from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';
import { drawPhotoGeometry, canvasFromPixels } from './utils/photoGeometry';
import {
  isDefaultPhotoAdjustments,
  normalizePhotoAdjustments,
  renderPhotoAdjustmentsToCanvas,
  loadTonePixels,
  getToneAdjustmentKey,
} from './utils/photoAdjustments';


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

export async function requestRenderedToneBlob(photoId, adjustments, options = {}) {
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
      fullResolution: variant === 'original',
    }),
  }).then((response) => {
    if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? '无权渲染照片' : '无法渲染照片');
    if (normalizePhotoAdjustments(adjustments).version === 3 && response.headers.get('X-MaMage-Tone-Engine') !== 'mamage-tone-v3-srgb') {
      throw new Error('当前服务器尚不支持新版调色，未下载不一致的结果');
    }
    return response.blob();
  }).catch((err) => {
    if (cacheKey) renderedToneThumbBlobCache.delete(cacheKey);
    throw err;
  });

  return cacheKey ? rememberRenderedToneThumb(cacheKey, loadPromise) : loadPromise;
}

export default function ViewerToneImage({
  src,
  photoId,
  adjustments,
  exact,
  maxSize = 1600,
  pixelVariant = 'thumb',
  hiddenImageInteractive = false,
  interactive = false,
  comparison = 'adjusted',
  cropMode = false,
  cropAspect,
  editingDisabled = false,
  onCropChange,
  onCropStart,
  onCropEnd,
  onSourceSize,
  faces,
  onAnalysis,
  onToneError,
  alt,
  className,
  style,
  onLoad,
  ...imgProps
}) {
  const canvasRef = React.useRef(null);
  const originalCanvasRef = React.useRef(null);
  const normalized = React.useMemo(() => normalizePhotoAdjustments(adjustments), [adjustments]);
  const meteringFaces = React.useMemo(() => (faces || []).map(({ left, top, width, height, unit, imageWidth, imageHeight, score }) =>
    ({ left, top, width, height, unit, imageWidth, imageHeight, score })), [faces]);
  const meteringKey = JSON.stringify(meteringFaces);
  const meteringRef = React.useRef({ faces: meteringFaces, key: meteringKey });
  meteringRef.current = { faces: meteringFaces, key: meteringKey };
  const adjustmentKey = React.useMemo(() => getToneAdjustmentKey(normalized), [normalized]);
  const shouldRenderCanvas = Boolean(src && (interactive || (exact && !normalized.baked && !isDefaultPhotoAdjustments(normalized))));
  const [canvasReady, setCanvasReady] = React.useState(false);
  const [renderedSrc, setRenderedSrc] = React.useState('');
  const normalizedRef = React.useRef(normalized);
  const onLoadRef = React.useRef(onLoad);
  const localRef = React.useRef(null);
  const frameRef = React.useRef(null);
  const [splitPosition, setSplitPosition] = React.useState(50);
  const comparisonRef = React.useRef({ mode: comparison, split: splitPosition });
  comparisonRef.current = { mode: comparison, split: splitPosition, cropMode };
  const callbacksRef = React.useRef({ onAnalysis, onToneError, onSourceSize });
  callbacksRef.current = { onAnalysis, onToneError, onSourceSize };
  normalizedRef.current = normalized;

  const paintComparison = React.useCallback(() => {
    const canvas = canvasRef.current, frame = frameRef.current;
    if (!canvas || !frame) return;
    const { mode, split, cropMode: cropping } = comparisonRef.current;
    drawPhotoGeometry(mode === 'original' ? frame.original : frame.adjusted, canvas,
      mode === 'original' ? {} : normalizedRef.current, cropping);
    if (mode === 'split' && split > 0 && !cropping) {
      const before = document.createElement('canvas');
      drawPhotoGeometry(frame.original, before, normalizedRef.current);
      const width = Math.round(canvas.width * split / 100);
      if (width) canvas.getContext('2d').drawImage(before, 0, 0, width, canvas.height, 0, 0, width, canvas.height);
      before.width = before.height = 0;
    }
    if (mode === 'side' && originalCanvasRef.current) drawPhotoGeometry(frame.original, originalCanvasRef.current, {});
    canvas.dataset.toneView = mode;
    canvas.dataset.toneSplit = String(split);
    canvas.dataset.toneKey = getToneAdjustmentKey({ ...frame.adjustments,
      rotation: normalizedRef.current.rotation, crop: normalizedRef.current.crop });
  }, []);

  React.useLayoutEffect(() => { if (interactive) paintComparison(); }, [interactive, comparison, cropMode, adjustmentKey, splitPosition, paintComparison]);

  React.useEffect(() => {
    if (!interactive || !src) return undefined;
    let disposed = false;
    let worker;
    let original;
    frameRef.current = null;
    setSplitPosition(50);
    setCanvasReady(false);
    setRenderedSrc('');
    const sourceUrl = photoId
      ? `${BASE_URL || ''}/api/photos/${encodeURIComponent(String(photoId))}/pixel-source?variant=working&full=1`
      : src;
    loadTonePixels(sourceUrl, { fullResolution: true, authenticated: Boolean(photoId), token: getToken() })
      .then(source => {
        if (disposed) return;
        original = canvasFromPixels(source.data, source.width, source.height);
        callbacksRef.current.onSourceSize?.({ width: source.width, height: source.height });
        worker = new Worker(new URL('./utils/photoTone.worker.js', import.meta.url), { type: 'module' });
        let busy = false, lastKey = '', lastMeteringKey = '', sequence = 0, requested;
        const colorKey = () => getToneAdjustmentKey({ ...normalizedRef.current, rotation: 0, crop: null });
        const pump = () => {
          const key = colorKey();
          if (disposed || busy || (key === lastKey && lastMeteringKey === meteringRef.current.key)) return;
          lastKey = key; lastMeteringKey = meteringRef.current.key; busy = true;
          requested = normalizedRef.current;
          worker.postMessage({ type: 'render', id: ++sequence, adjustments: requested,
            faces: meteringRef.current.faces, meteringKey: lastMeteringKey });
        };
        worker.onmessage = ({ data: result }) => {
          busy = false;
          if (disposed) return;
          if (result.error) { callbacksRef.current.onToneError?.(result.error); return; }
          const canvas = canvasRef.current;
          if (!canvas) return;
          if (frameRef.current?.adjusted) frameRef.current.adjusted.width = frameRef.current.adjusted.height = 0;
          frameRef.current = { original, adjusted: canvasFromPixels(result.pixels, source.width, source.height), adjustments: requested };
          paintComparison();
          canvas.dataset.toneDuration = String(result.duration);
          setCanvasReady(true);
          if (lastKey === colorKey() && lastMeteringKey === meteringRef.current.key) {
            callbacksRef.current.onAnalysis?.(result.analysis);
          }
          onLoadRef.current?.({ target: { naturalWidth: source.naturalWidth, naturalHeight: source.naturalHeight } });
          pump();
        };
        worker.onerror = () => { if (!disposed) callbacksRef.current.onToneError?.('本机调色预览失败，请重新打开调色'); };
        worker.postMessage({ type: 'source', source }, [source.data.buffer]);
        localRef.current = pump;
        pump();
      }).catch(error => { if (!disposed) callbacksRef.current.onToneError?.(error.message); });
    return () => {
      disposed = true; localRef.current = null;
      if (original) original.width = original.height = 0;
      if (frameRef.current?.adjusted) frameRef.current.adjusted.width = frameRef.current.adjusted.height = 0;
      frameRef.current = null; worker?.terminate();
    };
  }, [interactive, photoId, /* Editing source is original; display URL refreshes must not reload it. */ !photoId && src, paintComparison]);

  React.useEffect(() => { localRef.current?.(); }, [adjustmentKey, meteringKey]);

  React.useEffect(() => {
    normalizedRef.current = normalized;
  }, [adjustmentKey, normalized]);

  React.useEffect(() => {
    onLoadRef.current = onLoad;
  }, [onLoad]);

  React.useEffect(() => {
    if (interactive) return undefined;
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
  }, [adjustmentKey, interactive, maxSize, photoId, pixelVariant, shouldRenderCanvas, src]);

  const fallbackStyle = interactive ? { display: 'none' } : shouldRenderCanvas && canvasReady
    ? { ...(style || {}), position: 'absolute', inset: 0, opacity: 0, pointerEvents: hiddenImageInteractive ? undefined : 'none' }
    : style;
  const canvasStyle = { ...(style || {}) };
  delete canvasStyle.filter;
  delete canvasStyle.opacity;
  canvasStyle.display = canvasReady ? 'block' : 'none';

  const moveDivider = event => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (rect?.width) setSplitPosition(Math.max(0, Math.min(100, (event.clientX - rect.left) / rect.width * 100)));
  };
  const endDividerDrag = event => {
    event.stopPropagation();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const canvasElement = <canvas ref={canvasRef} className={`${className || ''} viewer-adjusted-canvas`} style={canvasStyle} aria-hidden="true" />;
  const crop = normalized.crop || { x: 0, y: 0, width: 1, height: 1 };
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
      {shouldRenderCanvas && !renderedSrc && (interactive ? (
        <div className={`tone-photo-stage${comparison === 'side' && !cropMode ? ' is-side-by-side' : ''}`}>
          {comparison === 'side' && !cropMode && <figure className="tone-before-image"><canvas ref={originalCanvasRef} className={className} /><figcaption>原图</figcaption></figure>}
          <div className="tone-after-image">
            <ReactCrop className={`tone-crop${cropMode ? ' is-cropping' : ''}`} disabled={!cropMode || editingDisabled || !canvasReady}
              crop={cropMode ? { unit: '%', x: crop.x * 100, y: crop.y * 100, width: crop.width * 100, height: crop.height * 100 } : undefined}
              aspect={cropAspect} keepSelection ruleOfThirds minWidth={16} minHeight={16}
              onDragStart={onCropStart} onDragEnd={onCropEnd}
              onChange={(_, percent) => {
                if (percent.width > 0 && percent.height > 0) onCropChange?.({ x: percent.x / 100, y: percent.y / 100, width: percent.width / 100, height: percent.height / 100 });
              }}>{canvasElement}</ReactCrop>
            {comparison === 'side' && !cropMode && <span className="tone-after-caption">调整后</span>}
          </div>
        </div>
      ) : canvasElement)}
      {interactive && !canvasReady && <div className="tone-source-loading" role="status">正在读取原画质图片</div>}
      <img
        src={src}
        alt={alt}
        className={className}
        style={fallbackStyle}
        onLoad={shouldRenderCanvas && canvasReady ? undefined : onLoad}
        {...imgProps}
      />
      {interactive && canvasReady && comparison === 'split' && !cropMode && (
        <div className="tone-comparison-overlay">
          <span className="tone-comparison-label tone-comparison-label--before">原图</span>
          <span className="tone-comparison-label tone-comparison-label--after">调整后</span>
          <div className="tone-comparison-divider" style={{ left: `${splitPosition}%` }}>
            <button type="button" role="slider" className="tone-comparison-handle"
              aria-label="前后对比分界线" title="拖动对比分界线" aria-orientation="horizontal"
              aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(splitPosition)}
              aria-valuetext={`原图 ${Math.round(splitPosition)}%`}
              onPointerDown={event => {
                if (event.button !== 0 || !event.isPrimary) return;
                event.preventDefault(); event.stopPropagation();
                event.currentTarget.focus({ preventScroll: true });
                event.currentTarget.setPointerCapture(event.pointerId);
                moveDivider(event);
              }}
              onPointerMove={event => {
                event.stopPropagation();
                if (event.currentTarget.hasPointerCapture(event.pointerId)) moveDivider(event);
              }}
              onPointerUp={endDividerDrag} onPointerCancel={endDividerDrag}
              onClick={event => event.stopPropagation()}
              onKeyDown={event => {
                if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                event.preventDefault(); event.stopPropagation();
                setSplitPosition(value => event.key === 'Home' ? 0 : event.key === 'End' ? 100 :
                  Math.max(0, Math.min(100, value + (event.key === 'ArrowLeft' ? -5 : 5))));
              }}>
              <IconChevronLeft /><IconChevronRight />
            </button>
          </div>
        </div>
      )}
    </>
  );
}

