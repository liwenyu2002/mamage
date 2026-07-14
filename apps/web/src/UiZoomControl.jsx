// src/UiZoomControl.jsx
// 桌面端「整体界面缩放」悬浮控件：放大/缩小整个 UI，偏好持久化到 localStorage。
// 缩放通过给 <html> 设 CSS zoom 实现（页面级缩放语义：fixed 元素随视口一起缩放，不溢出）。
// 控件自身用反向 zoom 抵消，保持恒定大小与位置。
import React from 'react';
import './UiZoomControl.css';

const ZOOM_KEY = 'mamage-ui-zoom';
export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 2;
const ZOOM_STEP = 0.1;

export function clampZoom(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 1;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(n * 100) / 100));
}

// 缩放状态 + 持久化。返回 [zoom, setZoom]，setZoom 支持值或更新函数。
export function useUiZoom() {
  const [zoom, setZoomState] = React.useState(() => {
    try {
      const raw = localStorage.getItem(ZOOM_KEY);
      if (raw != null) return clampZoom(parseFloat(raw));
    } catch (e) { /* ignore */ }
    return 1;
  });
  const setZoom = React.useCallback((next) => {
    setZoomState((prev) => {
      const val = clampZoom(typeof next === 'function' ? next(prev) : next);
      try { localStorage.setItem(ZOOM_KEY, String(val)); } catch (e) { /* ignore */ }
      return val;
    });
  }, []);
  return [zoom, setZoom];
}

// 把某个缩放值应用到 <html>。传 1 则清除。
export function applyDocumentZoom(zoom) {
  if (typeof document === 'undefined') return;
  const el = document.documentElement;
  if (!el) return;
  if (!zoom || Math.abs(zoom - 1) < 0.001) el.style.zoom = '';
  else el.style.zoom = String(zoom);
}

function IconMinus() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
      <line x1="5" y1="12" x2="19" y2="12" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}
function IconPlus() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
      <line x1="12" y1="5" x2="12" y2="19" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      <line x1="5" y1="12" x2="19" y2="12" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

// value: 当前缩放(0.5~2)；onChange(nextOrUpdater)
export default function UiZoomControl({ value, onChange }) {
  const pct = Math.round(value * 100);
  const atMax = value >= ZOOM_MAX - 0.001;
  const atMin = value <= ZOOM_MIN + 0.001;
  // 反向 zoom：控件净缩放=1，保持恒定大小与视口定位，不受 <html> 缩放影响
  const counterZoom = value ? 1 / value : 1;
  return (
    <div
      className="ui-zoom-control"
      style={{ zoom: counterZoom }}
      role="group"
      aria-label="界面缩放"
    >
      <button
        type="button"
        className="ui-zoom-btn"
        onClick={() => onChange((v) => v + ZOOM_STEP)}
        disabled={atMax}
        aria-label="放大界面"
        title="放大界面"
      >
        <IconPlus />
      </button>
      <button
        type="button"
        className="ui-zoom-value"
        onClick={() => onChange(1)}
        aria-label={`当前界面缩放 ${pct}%，点击恢复 100%`}
        title="点击恢复 100%"
      >
        {pct}%
      </button>
      <button
        type="button"
        className="ui-zoom-btn"
        onClick={() => onChange((v) => v - ZOOM_STEP)}
        disabled={atMin}
        aria-label="缩小界面"
        title="缩小界面"
      >
        <IconMinus />
      </button>
    </div>
  );
}
