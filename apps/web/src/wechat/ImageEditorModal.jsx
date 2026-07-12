// 图片编辑弹层：裁切/旋转/翻转/比例/滤镜，纯 Canvas 实现，输出编辑后图片的 data URL。
// 结构参照 ImportPreviewModal.jsx（createPortal 全屏弹层 + 遮罩不关/Esc 关），零 npm 新依赖。
//
// 坐标系与导出管线（务必先读这段再改逻辑）：
// 1) crop={x,y,w,h} 用 [0,1] 相对量存储，相对"oriented 包围盒"——原图按 rotation 转正后的包围盒：
//    rotation∈{90,270} 时 orientedW/H=naturalH/naturalW（互换），{0,180} 时不换。旋转切换会用新
//    oriented 尺寸重算默认裁切框（不做旧框坐标换算，等价"每次改朝向重新取景"）。
// 2) 舞台尺寸 displayW/H = fitContain(orientedW, orientedH, MAX_W, MAX_H)；裁切框/把手屏幕像素
//    = 相对值 * displayW/H，仅用于交互，不参与导出计算。
// 3) 实时预览：.wie-imgwrap 90/270 时预旋转盒子与 stage 互换宽高，transform 顺序固定为
//    translate(-50%,-50%) rotate(deg) scaleX(flipH) scaleY(flipV)（先翻转后旋转），filter 为 CSS 实时预览。
// 4) 导出：离屏 canvas=orientedW x orientedH；translate(center)->rotate(rad)->scale(flipH,flipV)->
//    filter=同一滤镜串->drawImage(img,-naturalW/2,-naturalH/2,...)，变换调用顺序与 CSS 一致，像素对齐预览。
// 5) 裁切：crop*orientedW/H 取整后从离屏 canvas 抠图；宽超 1280 等比缩到 1280；按扩展名选 png/jpeg
//    （jpeg 先填白底防透明区变黑）。
// 6) 跨域：<img crossOrigin="anonymous">；toDataURL 若抛 SecurityError（无 CORS 授权，如 mmbiz 图）
//    在弹层内示错，不静默失败、不外抛、不自动 onCancel。
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './imageEditor.css';

const STAGE_MAX_W = 560;
const STAGE_MAX_H = 360;
const MIN_CROP_PX = 24;
const HANDLES = ['nw', 'n', 'ne', 'w', 'e', 'sw', 's', 'se'];

const DEFAULT_FILTERS = { brightness: 1, contrast: 1, saturate: 1, grayscale: 0 };

const FILTER_LIMITS = {
  brightness: { min: 0.5, max: 1.5 },
  contrast: { min: 0.5, max: 1.5 },
  saturate: { min: 0, max: 2 },
  grayscale: { min: 0, max: 1 },
};

const FILTER_LABELS = {
  brightness: '亮度',
  contrast: '对比度',
  saturate: '饱和度',
  grayscale: '灰度',
};

const FILTER_PRESETS = [
  { key: 'original', label: '原图', values: { brightness: 1, contrast: 1, saturate: 1, grayscale: 0 } },
  { key: 'bw', label: '黑白', values: { brightness: 1, contrast: 1.05, saturate: 1, grayscale: 1 } },
  { key: 'vintage', label: '复古', values: { brightness: 1.05, contrast: 0.9, saturate: 0.7, grayscale: 0 } },
  { key: 'fresh', label: '清新', values: { brightness: 1.08, contrast: 1.02, saturate: 1.15, grayscale: 0 } },
];

const RATIOS = { free: null, '1:1': 1, '4:3': 4 / 3, '3:4': 3 / 4, '16:9': 16 / 9, '9:16': 9 / 16 };
const RATIO_ORDER = ['free', '1:1', '4:3', '3:4', '16:9', '9:16'];
const RATIO_LABELS = { free: '自由', '1:1': '1:1', '4:3': '4:3', '3:4': '3:4', '16:9': '16:9', '9:16': '9:16' };

function clamp(v, min, max) {
  return Math.min(Math.max(v, min), max);
}

// 按 ratioValue（null=自由）在 dw x dh 的舞台里取一个居中、留出把手抓取余量的默认裁切框。
function defaultCropRect(ratioValue, dw, dh) {
  if (!dw || !dh) return { x: 0.1, y: 0.1, w: 0.8, h: 0.8 };
  if (!ratioValue) return { x: 0.1, y: 0.1, w: 0.8, h: 0.8 };
  let boxW = dw;
  let boxH = boxW / ratioValue;
  if (boxH > dh) {
    boxH = dh;
    boxW = boxH * ratioValue;
  }
  boxW *= 0.92;
  boxH *= 0.92;
  const w = clamp(boxW / dw, 0.05, 1);
  const h = clamp(boxH / dh, 0.05, 1);
  return { x: (1 - w) / 2, y: (1 - h) / 2, w, h };
}

// 等比缩到 maxW/maxH 内（不放大），供舞台显示尺寸使用。
function fitContain(w, h, maxW, maxH) {
  if (!w || !h) return { displayW: 1, displayH: 1 };
  const scale = Math.min(maxW / w, maxH / h, 1);
  return { displayW: Math.max(1, Math.round(w * scale)), displayH: Math.max(1, Math.round(h * scale)) };
}

function cssFilterString(f) {
  return `brightness(${f.brightness}) contrast(${f.contrast}) saturate(${f.saturate}) grayscale(${f.grayscale})`;
}

// 按来源 URL 扩展名粗略判断导出格式：.png 保留透明用 png，其余一律 jpeg（含白底兜底）。
function pickExportMime(srcUrl) {
  const s = String(srcUrl || '');
  if (/^data:image\/png/i.test(s)) return 'image/png';
  try {
    const u = new URL(s, typeof window !== 'undefined' ? window.location.href : undefined);
    if (/\.png$/i.test(u.pathname)) return 'image/png';
  } catch (err) {
    if (/\.png(\?|#|$)/i.test(s)) return 'image/png';
  }
  return 'image/jpeg';
}

// 单个可拖拽/缩放裁切框：8 把手改尺寸（按 ratioValue 锁比例），框体内部拖动整体平移。
// 内部用 dragRef 记录拖拽起点，rAF 节流写回，指针 capture 保证拖出框外仍收得到事件。
function CropOverlay({ stageRef, displayW, displayH, crop, ratioValue, onCropChange }) {
  const dragRef = useRef(null);
  const rafRef = useRef(null);
  const pendingRef = useRef(null);

  useEffect(() => () => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
  }, []);

  const px = {
    left: crop.x * displayW,
    top: crop.y * displayH,
    width: crop.w * displayW,
    height: crop.h * displayH,
  };

  function applyPending() {
    rafRef.current = null;
    const rect = pendingRef.current;
    if (!rect || !displayW || !displayH) return;
    onCropChange({
      x: clamp(rect.left / displayW, 0, 1),
      y: clamp(rect.top / displayH, 0, 1),
      w: clamp(rect.width / displayW, 0, 1),
      h: clamp(rect.height / displayH, 0, 1),
    });
  }

  function schedule(rect) {
    pendingRef.current = rect;
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(applyPending);
  }

  function clientToStage(e) {
    const rect = stageRef.current ? stageRef.current.getBoundingClientRect() : { left: 0, top: 0 };
    return {
      x: clamp(e.clientX - rect.left, 0, displayW),
      y: clamp(e.clientY - rect.top, 0, displayH),
    };
  }

  function computeResize(st, p) {
    const handle = st.handle;
    const curX = p.x;
    const curY = p.y;

    const freeTop = handle.includes('n');
    const freeBottom = handle.includes('s');
    const freeLeft = handle.includes('w');
    const freeRight = handle.includes('e');

    let top = st.startTop;
    let bottom = st.startTop + st.startHeight;
    let left = st.startLeft;
    let right = st.startLeft + st.startWidth;

    if (freeTop) top = clamp(curY, 0, bottom - MIN_CROP_PX);
    if (freeBottom) bottom = clamp(curY, top + MIN_CROP_PX, displayH);
    if (freeLeft) left = clamp(curX, 0, right - MIN_CROP_PX);
    if (freeRight) right = clamp(curX, left + MIN_CROP_PX, displayW);

    let width = right - left;
    let height = bottom - top;

    if (ratioValue) {
      const hFree = freeLeft || freeRight;
      const vFree = freeTop || freeBottom;
      if (hFree && vFree) {
        if (width / ratioValue <= height) height = width / ratioValue;
        else width = height * ratioValue;
      } else if (hFree) {
        height = width / ratioValue;
      } else if (vFree) {
        width = height * ratioValue;
      }
      width = Math.min(width, displayW);
      height = Math.min(height, displayH);
      if (width / height > ratioValue) width = height * ratioValue;
      else height = width / ratioValue;

      if (hFree && vFree) {
        left = freeLeft ? right - width : left;
        right = left + width;
        top = freeTop ? bottom - height : top;
        bottom = top + height;
      } else if (hFree) {
        left = freeLeft ? right - width : left;
        right = left + width;
        const centerY = st.startTop + st.startHeight / 2;
        top = centerY - height / 2;
        bottom = top + height;
      } else if (vFree) {
        top = freeTop ? bottom - height : top;
        bottom = top + height;
        const centerX = st.startLeft + st.startWidth / 2;
        left = centerX - width / 2;
        right = left + width;
      }

      // 居中伸缩可能出界：整体平移拉回舞台范围内（尺寸已 <= 舞台，故只需平移一次即可回夹）
      if (top < 0) { bottom -= top; top = 0; }
      if (bottom > displayH) { top -= (bottom - displayH); bottom = displayH; }
      if (left < 0) { right -= left; left = 0; }
      if (right > displayW) { left -= (right - displayW); right = displayW; }
      top = clamp(top, 0, Math.max(0, displayH - height));
      left = clamp(left, 0, Math.max(0, displayW - width));
      bottom = top + height;
      right = left + width;
    }

    return { left, top, width: right - left, height: bottom - top };
  }

  function onHandleDown(e, handle) {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) { /* 非指针环境忽略 */ }
    dragRef.current = {
      type: 'resize',
      handle,
      pointerId: e.pointerId,
      startLeft: px.left,
      startTop: px.top,
      startWidth: px.width,
      startHeight: px.height,
    };
  }

  function onBodyDown(e) {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) { /* 非指针环境忽略 */ }
    const p = clientToStage(e);
    dragRef.current = {
      type: 'move',
      pointerId: e.pointerId,
      startLeft: px.left,
      startTop: px.top,
      startWidth: px.width,
      startHeight: px.height,
      grabDX: p.x - px.left,
      grabDY: p.y - px.top,
    };
  }

  function onDragMove(e) {
    const st = dragRef.current;
    if (!st) return;
    const p = clientToStage(e);
    let rect;
    if (st.type === 'move') {
      const left = clamp(p.x - st.grabDX, 0, Math.max(0, displayW - st.startWidth));
      const top = clamp(p.y - st.grabDY, 0, Math.max(0, displayH - st.startHeight));
      rect = { left, top, width: st.startWidth, height: st.startHeight };
    } else {
      rect = computeResize(st, p);
    }
    schedule(rect);
  }

  function onDragEnd(e) {
    if (!dragRef.current) return;
    try { e.currentTarget.releasePointerCapture(dragRef.current.pointerId); } catch (err) { /* 忽略 */ }
    dragRef.current = null;
  }

  return (
    <div className="wie-cropbox" style={{ left: px.left, top: px.top, width: px.width, height: px.height }}>
      <div
        className="wie-crop-body"
        onPointerDown={onBodyDown}
        onPointerMove={onDragMove}
        onPointerUp={onDragEnd}
        onPointerCancel={onDragEnd}
      />
      {HANDLES.map((h) => (
        <div
          key={h}
          className={`wie-handle wie-handle-${h}`}
          onPointerDown={(e) => onHandleDown(e, h)}
          onPointerMove={onDragMove}
          onPointerUp={onDragEnd}
          onPointerCancel={onDragEnd}
        />
      ))}
    </div>
  );
}

function ImageEditorModal({ visible, src, onCancel, onApply }) {
  const [loadStatus, setLoadStatus] = useState('loading'); // loading | ready | error
  const [loadErrorMsg, setLoadErrorMsg] = useState('');
  const [imgSize, setImgSize] = useState({ w: 0, h: 0 });
  const [rotation, setRotation] = useState(0); // 0/90/180/270，顺时针
  const [flipH, setFlipH] = useState(false);
  const [flipV, setFlipV] = useState(false);
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [ratioKey, setRatioKey] = useState('free');
  const [crop, setCrop] = useState({ x: 0.1, y: 0.1, w: 0.8, h: 0.8 });
  const [exportError, setExportError] = useState(null);

  const stageRef = useRef(null);
  const imgElRef = useRef(null);
  const prevVisibleRef = useRef(false);
  const lastSrcRef = useRef(null);

  // 每次"从关到开"，或开着时 src 变了，重置全部编辑状态——避免上一张图的裁切框/滤镜串到下一张。
  useEffect(() => {
    const justOpened = visible && !prevVisibleRef.current;
    prevVisibleRef.current = visible;
    if (!visible) return;
    if (justOpened || lastSrcRef.current !== src) {
      lastSrcRef.current = src;
      setRotation(0);
      setFlipH(false);
      setFlipV(false);
      setFilters(DEFAULT_FILTERS);
      setRatioKey('free');
      setCrop({ x: 0.1, y: 0.1, w: 0.8, h: 0.8 });
      setExportError(null);
      setImgSize({ w: 0, h: 0 });
      if (!src) {
        setLoadStatus('error');
        setLoadErrorMsg('未提供图片来源');
      } else {
        setLoadStatus('loading');
        setLoadErrorMsg('');
      }
    }
  }, [visible, src]);

  useEffect(() => {
    if (!visible) return undefined;
    function onKeyDown(e) {
      if (e.key === 'Escape') onCancel();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [visible, onCancel]);

  const orientedW = rotation % 180 === 0 ? imgSize.w : imgSize.h;
  const orientedH = rotation % 180 === 0 ? imgSize.h : imgSize.w;
  const { displayW, displayH } = useMemo(
    () => fitContain(orientedW, orientedH, STAGE_MAX_W, STAGE_MAX_H),
    [orientedW, orientedH],
  );

  if (!visible) return null;

  function handleImgLoad(e) {
    const w = e.target.naturalWidth;
    const h = e.target.naturalHeight;
    if (!w || !h) {
      setLoadStatus('error');
      setLoadErrorMsg('图片加载失败，无法读取尺寸');
      return;
    }
    setImgSize({ w, h });
    setLoadStatus('ready');
    const { displayW: dw, displayH: dh } = fitContain(w, h, STAGE_MAX_W, STAGE_MAX_H);
    setCrop(defaultCropRect(RATIOS[ratioKey] || null, dw, dh));
  }

  function handleImgError() {
    setLoadStatus('error');
    setLoadErrorMsg('图片加载失败，请检查图片来源是否可访问');
  }

  function handleRotate(delta) {
    const next = ((rotation + delta) % 360 + 360) % 360;
    setRotation(next);
    setExportError(null);
    if (loadStatus === 'ready' && imgSize.w && imgSize.h) {
      const rot180 = next % 180 === 0;
      const oW = rot180 ? imgSize.w : imgSize.h;
      const oH = rot180 ? imgSize.h : imgSize.w;
      const { displayW: dw, displayH: dh } = fitContain(oW, oH, STAGE_MAX_W, STAGE_MAX_H);
      setCrop(defaultCropRect(RATIOS[ratioKey] || null, dw, dh));
    }
  }

  function handleToggleFlipH() {
    setFlipH((v) => !v);
    setExportError(null);
  }

  function handleToggleFlipV() {
    setFlipV((v) => !v);
    setExportError(null);
  }

  function handleRatioSelect(key) {
    setRatioKey(key);
    setExportError(null);
    if (loadStatus === 'ready') {
      setCrop(defaultCropRect(RATIOS[key], displayW, displayH));
    }
  }

  function handleFilterChange(name, value) {
    setFilters((f) => ({ ...f, [name]: value }));
  }

  function handleFilterReset(name) {
    setFilters((f) => ({ ...f, [name]: DEFAULT_FILTERS[name] }));
  }

  function handleApplyPreset(values) {
    setFilters({ ...values });
  }

  function handleResetAll() {
    setRotation(0);
    setFlipH(false);
    setFlipV(false);
    setFilters(DEFAULT_FILTERS);
    setRatioKey('free');
    setExportError(null);
    if (loadStatus === 'ready' && imgSize.w && imgSize.h) {
      const { displayW: dw, displayH: dh } = fitContain(imgSize.w, imgSize.h, STAGE_MAX_W, STAGE_MAX_H);
      setCrop(defaultCropRect(null, dw, dh));
    }
  }

  function handleApply() {
    setExportError(null);
    const img = imgElRef.current;
    if (loadStatus !== 'ready' || !img) return;
    const naturalW = img.naturalWidth;
    const naturalH = img.naturalHeight;
    if (!naturalW || !naturalH) {
      setExportError('图片尚未就绪，请稍候重试');
      return;
    }
    const rot180 = rotation % 180 === 0;
    const oW = rot180 ? naturalW : naturalH;
    const oH = rot180 ? naturalH : naturalW;

    try {
      const orientCanvas = document.createElement('canvas');
      orientCanvas.width = oW;
      orientCanvas.height = oH;
      const octx = orientCanvas.getContext('2d');
      octx.save();
      octx.translate(oW / 2, oH / 2);
      octx.rotate((rotation * Math.PI) / 180);
      octx.scale(flipH ? -1 : 1, flipV ? -1 : 1);
      octx.filter = cssFilterString(filters);
      octx.drawImage(img, -naturalW / 2, -naturalH / 2, naturalW, naturalH);
      octx.restore();

      const cropX = clamp(Math.round(crop.x * oW), 0, oW - 1);
      const cropY = clamp(Math.round(crop.y * oH), 0, oH - 1);
      const cropW = clamp(Math.round(crop.w * oW), 1, oW - cropX);
      const cropH = clamp(Math.round(crop.h * oH), 1, oH - cropY);

      let outW = cropW;
      let outH = cropH;
      if (outW > 1280) {
        outH = Math.max(1, Math.round((outH * 1280) / outW));
        outW = 1280;
      }

      const mime = pickExportMime(src);
      const outCanvas = document.createElement('canvas');
      outCanvas.width = outW;
      outCanvas.height = outH;
      const octx2 = outCanvas.getContext('2d');
      if (mime === 'image/jpeg') {
        octx2.fillStyle = '#ffffff';
        octx2.fillRect(0, 0, outW, outH);
      }
      octx2.drawImage(orientCanvas, cropX, cropY, cropW, cropH, 0, 0, outW, outH);

      const dataUrl = outCanvas.toDataURL(mime, mime === 'image/jpeg' ? 0.9 : undefined);
      onApply(dataUrl);
    } catch (err) {
      // SecurityError：canvas 被跨域图片污染（无 CORS 授权），toDataURL 读回被浏览器拦截。
      setExportError('该图片来源不支持编辑（跨域限制），请改用中转站/相册里的照片');
    }
  }

  const rot180 = rotation % 180 === 0;
  const imgWrapStyle = {
    width: rot180 ? displayW : displayH,
    height: rot180 ? displayH : displayW,
    transform: `translate(-50%, -50%) rotate(${rotation}deg) scaleX(${flipH ? -1 : 1}) scaleY(${flipV ? -1 : 1})`,
    filter: cssFilterString(filters),
  };

  return createPortal(
    <div className="wie-mask">
      <div className="wie-panel" role="dialog" aria-modal="true">
        <div className="wie-header">
          <div className="wie-title">图片编辑</div>
          <button type="button" className="wie-close" onClick={onCancel} aria-label="关闭">×</button>
        </div>

        <div className="wie-body">
          <div className="wie-canvasarea">
            {loadStatus === 'loading' ? <div className="wie-status">加载中…</div> : null}
            {loadStatus === 'error' ? (
              <div className="wie-status wie-status-error">{loadErrorMsg || '图片加载失败'}</div>
            ) : null}
            {src ? (
              <div
                className="wie-stage"
                ref={stageRef}
                style={{
                  width: displayW,
                  height: displayH,
                  visibility: loadStatus === 'ready' ? 'visible' : 'hidden',
                  position: loadStatus === 'ready' ? 'relative' : 'absolute',
                }}
              >
                <div className="wie-imgwrap" style={imgWrapStyle}>
                  {/* crossOrigin 需在挂载前就设置好属性顺序无关，React 会同步写入 DOM 属性再触发加载。
                      referrerPolicy=no-referrer 与全站约定一致：mmbiz 图有 Referer 防盗链,不加会 403；
                      注：mmbiz 不发 CORS 头,配 crossOrigin 后跨域图仍会加载失败(onerror 走错误态),
                      这类图本就无法 canvas 导出编辑,错误态即预期结果；自家 COS 图带 ACAO,可正常编辑。 */}
                  <img
                    ref={imgElRef}
                    src={src}
                    crossOrigin="anonymous"
                    referrerPolicy="no-referrer"
                    alt=""
                    className="wie-img"
                    draggable={false}
                    onDragStart={(e) => e.preventDefault()}
                    onLoad={handleImgLoad}
                    onError={handleImgError}
                  />
                </div>
                {loadStatus === 'ready' ? (
                  <CropOverlay
                    stageRef={stageRef}
                    displayW={displayW}
                    displayH={displayH}
                    crop={crop}
                    ratioValue={RATIOS[ratioKey]}
                    onCropChange={setCrop}
                  />
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="wie-controls">
            <div className="wie-group">
              <div className="wie-group-title">旋转 / 翻转</div>
              <div className="wie-row">
                <button type="button" className="wie-btn" onClick={() => handleRotate(-90)} disabled={loadStatus !== 'ready'}>↺ 左转90°</button>
                <button type="button" className="wie-btn" onClick={() => handleRotate(90)} disabled={loadStatus !== 'ready'}>↻ 右转90°</button>
                <button
                  type="button"
                  className={`wie-btn${flipH ? ' is-on' : ''}`}
                  onClick={handleToggleFlipH}
                  disabled={loadStatus !== 'ready'}
                >⇋ 水平翻转</button>
                <button
                  type="button"
                  className={`wie-btn${flipV ? ' is-on' : ''}`}
                  onClick={handleToggleFlipV}
                  disabled={loadStatus !== 'ready'}
                >⇕ 垂直翻转</button>
              </div>
            </div>

            <div className="wie-group">
              <div className="wie-group-title">裁切比例</div>
              <div className="wie-row">
                {RATIO_ORDER.map((key) => (
                  <button
                    type="button"
                    key={key}
                    className={`wie-pill${ratioKey === key ? ' is-active' : ''}`}
                    onClick={() => handleRatioSelect(key)}
                    disabled={loadStatus !== 'ready'}
                  >
                    {RATIO_LABELS[key]}
                  </button>
                ))}
              </div>
            </div>

            <div className="wie-group">
              <div className="wie-group-title">滤镜</div>
              {Object.keys(DEFAULT_FILTERS).map((name) => (
                <div className="wie-slider-row" key={name}>
                  <div className="wie-slider-head">
                    <span className="wie-slider-label">{FILTER_LABELS[name]}</span>
                    <span className="wie-slider-value">{filters[name].toFixed(2)}</span>
                    <button type="button" className="wie-reset-mini" onClick={() => handleFilterReset(name)}>重置</button>
                  </div>
                  <input
                    type="range"
                    className="wie-slider"
                    min={FILTER_LIMITS[name].min}
                    max={FILTER_LIMITS[name].max}
                    step={0.01}
                    value={filters[name]}
                    disabled={loadStatus !== 'ready'}
                    onChange={(e) => handleFilterChange(name, Number(e.target.value))}
                  />
                </div>
              ))}
              <div className="wie-row wie-presets">
                {FILTER_PRESETS.map((p) => (
                  <button
                    type="button"
                    key={p.key}
                    className="wie-pill"
                    onClick={() => handleApplyPreset(p.values)}
                    disabled={loadStatus !== 'ready'}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {exportError ? <div className="wie-export-error">{exportError}</div> : null}

        <div className="wie-footer">
          <button type="button" className="wie-btn2 wie-btn2-ghost" onClick={onCancel}>取消</button>
          <button type="button" className="wie-btn2 wie-btn2-ghost" onClick={handleResetAll} disabled={loadStatus !== 'ready'}>重置全部</button>
          <button type="button" className="wie-btn2 wie-btn2-primary" onClick={handleApply} disabled={loadStatus !== 'ready'}>应用</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export default ImageEditorModal;
