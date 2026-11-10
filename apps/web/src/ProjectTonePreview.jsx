import React from 'react';
import { getToken } from './services/authService';
import { BASE_URL } from './services/request';
import { IconChevronLeft, IconChevronRight } from './ui/icons';
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
  const normalized = React.useMemo(() => normalizePhotoAdjustments(adjustments), [adjustments]);
  const meteringFaces = React.useMemo(() => (faces || []).map(({ left, top, width, height, unit, imageWidth, imageHeight, score }) =>
    ({ left, top, width, height, unit, imageWidth, imageHeight, score })), [faces]);
  const meteringKey = JSON.stringify(meteringFaces);
  const meteringRef = React.useRef({ faces: meteringFaces, key: meteringKey });
  meteringRef.current = { faces: meteringFaces, key: meteringKey };
  const adjustmentKey = React.useMemo(() => getToneAdjustmentKey(normalized), [normalized]);
  const shouldRenderCanvas = Boolean(src && (interactive || (exact && !isDefaultPhotoAdjustments(normalized))));
  const [canvasReady, setCanvasReady] = React.useState(false);
  const [renderedSrc, setRenderedSrc] = React.useState('');
  const normalizedRef = React.useRef(normalized);
  const onLoadRef = React.useRef(onLoad);
  const localRef = React.useRef(null);
  const frameRef = React.useRef(null);
  const [splitPosition, setSplitPosition] = React.useState(50);
  const comparisonRef = React.useRef({ mode: comparison, split: splitPosition });
  comparisonRef.current = { mode: comparison, split: splitPosition };
  const callbacksRef = React.useRef({ onAnalysis, onToneError });
  callbacksRef.current = { onAnalysis, onToneError };
  normalizedRef.current = normalized;

  const paintComparison = React.useCallback(() => {
    const canvas = canvasRef.current, frame = frameRef.current;
    if (!canvas || !frame) return;
    const { mode, split } = comparisonRef.current;
    const context = canvas.getContext('2d', { colorSpace: 'srgb' });
    context.putImageData(mode === 'original' ? frame.original : frame.adjusted, 0, 0);
    if (mode === 'split' && split > 0) {
      context.putImageData(frame.original, 0, 0, 0, 0, Math.round(canvas.width * split / 100), canvas.height);
    }
    canvas.dataset.toneView = mode;
    canvas.dataset.toneSplit = String(split);
  }, []);

  React.useLayoutEffect(() => { if (interactive) paintComparison(); }, [interactive, comparison, splitPosition, paintComparison]);

  React.useEffect(() => {
    if (!interactive || !src) return undefined;
    let disposed = false;
    let worker;
    frameRef.current = null;
    setSplitPosition(50);
    setCanvasReady(false);
    setRenderedSrc('');
    const sourceUrl = photoId
      ? `${BASE_URL || ''}/api/photos/${encodeURIComponent(String(photoId))}/pixel-source?variant=working&maxSize=1280`
      : src;
    loadTonePixels(sourceUrl, { maxSize: Math.min(maxSize, 1280), authenticated: Boolean(photoId), token: getToken() })
      .then(source => {
        if (disposed) return;
        const original = new ImageData(source.data, source.width, source.height);
        worker = new Worker(new URL('./utils/photoTone.worker.js', import.meta.url), { type: 'module' });
        let busy = false, lastKey = '', lastMeteringKey = '', sequence = 0;
        const pump = () => {
          const key = getToneAdjustmentKey(normalizedRef.current);
          if (disposed || busy || (key === lastKey && lastMeteringKey === meteringRef.current.key)) return;
          lastKey = key; lastMeteringKey = meteringRef.current.key; busy = true;
          worker.postMessage({ type: 'render', id: ++sequence, adjustments: normalizedRef.current,
            faces: meteringRef.current.faces, meteringKey: lastMeteringKey });
        };
        worker.onmessage = ({ data: result }) => {
          busy = false;
          if (disposed) return;
          if (result.error) { callbacksRef.current.onToneError?.(result.error); return; }
          const canvas = canvasRef.current;
          if (!canvas) return;
          canvas.width = source.width; canvas.height = source.height;
          frameRef.current = { original, adjusted: new ImageData(result.pixels, source.width, source.height) };
          paintComparison();
          canvas.dataset.toneDuration = String(result.duration);
          canvas.dataset.toneKey = lastKey;
          setCanvasReady(true);
          if (lastKey === getToneAdjustmentKey(normalizedRef.current) && lastMeteringKey === meteringRef.current.key) {
            callbacksRef.current.onAnalysis?.(result.analysis);
          }
          onLoadRef.current?.({ target: { naturalWidth: source.naturalWidth, naturalHeight: source.naturalHeight } });
          pump();
        };
        worker.onerror = () => { if (!disposed) callbacksRef.current.onToneError?.('本机调色预览失败，请重新打开调色'); };
        const copy = source.data.slice();
        worker.postMessage({ type: 'source', source: { ...source, data: copy } }, [copy.buffer]);
        localRef.current = pump;
        pump();
      }).catch(error => { if (!disposed) callbacksRef.current.onToneError?.(error.message); });
    return () => { disposed = true; localRef.current = null; frameRef.current = null; worker?.terminate(); };
  }, [interactive, maxSize, photoId, src, paintComparison]);

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

  const fallbackStyle = shouldRenderCanvas && canvasReady
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
      {interactive && canvasReady && comparison === 'split' && (
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

