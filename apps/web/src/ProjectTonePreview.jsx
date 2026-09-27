import React from 'react';
import { getToken } from './services/authService';
import { BASE_URL } from './services/request';
import {
  isDefaultPhotoAdjustments,
  normalizePhotoAdjustments,
  renderPhotoAdjustmentsToCanvas,
} from './utils/photoAdjustments';

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

