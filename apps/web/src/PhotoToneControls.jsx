import React from 'react';
import { IconClose, IconChevronLeft, IconChevronRight } from './ui/icons';
import { Crop, SlidersHorizontal, RotateCcw, RotateCw, Columns2 } from 'lucide-react';
import './PhotoToneControls.css';

export default function PhotoToneControls({ draft, analysis, busy, facesLoading, saving, error, dirty,
  comparison, holdingOriginal, onCompare, onHoldOriginal, onChange, onGestureStart, onGestureEnd, onAuto, onReset,
  onSave, onClose, onUndo, onRedo, canUndo, canRedo, histogram,
  mode = 'tone', onMode, aspect, onAspect, onRotate, onResetCrop, sourceSize, outputSize }) {
  React.useEffect(() => {
    const release = () => onHoldOriginal(false);
    const onVisibility = () => { if (document.hidden) release(); };
    window.addEventListener('blur', release);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('blur', release);
      document.removeEventListener('visibilitychange', onVisibility);
      release();
    };
  }, [onHoldOriginal]);
  const releaseHold = event => {
    onHoldOriginal(false);
    if (event.pointerId != null && event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const groups = [
    ['明暗', [['exposure', '曝光', -4, 4, 0.05],
      ['contrast', '对比度'], ['highlights', '高光'], ['shadows', '阴影'], ['whites', '白色色阶'], ['blacks', '黑色色阶']]],
    ['白平衡', [['temperature', '色温'], ['tint', '色调']]],
    ['色彩', [['vibrance', '自然饱和度'], ['saturation', '饱和度']]],
    ['肤色', [['skinSaturation', '肤色饱和度'], ['skinBrightness', '肤色亮度']]],
  ];
  return (
    <section className="viewer-tone-panel glass-reveal-surface tone-editor" aria-label="照片调色" onClick={e => e.stopPropagation()}>
      <header className="tone-editor-head">
        <div className="tone-editor-title"><h2>编辑照片</h2><span>{dirty ? '未保存' : '已保存'}</span></div>
        <div className="tone-head-chart" aria-label="亮度直方图">{histogram}</div>
        <button type="button" className="tone-icon" aria-label="关闭调色" title="关闭调色" onClick={onClose}><IconClose /></button>
      </header>
      <div className="tone-editor-body">
        <div className="tone-edit-modes" role="tablist" aria-label="编辑工具">
          <button role="tab" type="button" aria-selected={mode === 'tone'} disabled={saving} onClick={() => onMode('tone')}><SlidersHorizontal size={16} />调色</button>
          <button role="tab" type="button" aria-selected={mode === 'crop'} disabled={saving} onClick={() => onMode('crop')}><Crop size={16} />裁切与旋转</button>
        </div>
        {sourceSize && <div className="tone-source-size">原图 {sourceSize.width} × {sourceSize.height}<span>{outputSize && `${outputSize.width} × ${outputSize.height}`}</span></div>}
        <div className="tone-chart" aria-label="亮度直方图">{histogram}
          <div className="tone-clipping"><span>黑场 {((analysis?.clipping?.shadows || 0) * 100).toFixed(1)}%</span><span>高光截断 {((analysis?.clipping?.highlights || 0) * 100).toFixed(1)}%</span></div>
        </div>
        <div className="tone-editor-tools">
          <div className="tone-compare" role="group" aria-label="原图对照">
            <button type="button" aria-pressed={comparison === 'side'} onClick={() => { onMode('tone'); onCompare(comparison === 'side' ? 'adjusted' : 'side'); }}><Columns2 size={14} />双图对比</button>
            <button type="button" aria-pressed={comparison === 'split'} onClick={() => { onMode('tone'); onCompare(comparison === 'split' ? 'adjusted' : 'split'); }}>划线对比</button>
          </div>
          <button type="button" className="tone-icon" title="撤销" aria-label="撤销调色" disabled={!canUndo || saving} onClick={onUndo}><IconChevronLeft /></button>
          <button type="button" className="tone-icon" title="重做" aria-label="重做调色" disabled={!canRedo || saving} onClick={onRedo}><IconChevronRight /></button>
        </div>
        <div className="tone-comparison-actions">
        <span className="tone-metering" role="status">{facesLoading ? '读取人脸区域' : analysis?.metering?.mode === 'faces' ? `人脸优先 · ${analysis.metering.faceCount} 人` : '全图测光'}</span>
        <button type="button" className="tone-hold-original" aria-pressed={holdingOriginal} disabled={mode === 'crop' || !analysis || Boolean(error)}
          onPointerDown={event => {
            if (event.button !== 0 || !event.isPrimary) return;
            event.preventDefault();
            event.currentTarget.focus({ preventScroll: true });
            event.currentTarget.setPointerCapture(event.pointerId);
            onHoldOriginal(true);
          }}
          onPointerUp={releaseHold} onPointerCancel={releaseHold} onLostPointerCapture={() => onHoldOriginal(false)}
          onBlur={() => onHoldOriginal(false)} onContextMenu={event => event.preventDefault()}
          onKeyDown={event => {
            if (event.key !== ' ' && event.key !== 'Enter') return;
            event.preventDefault(); event.stopPropagation(); onHoldOriginal(true);
          }}
          onKeyUp={event => {
            if (event.key !== ' ' && event.key !== 'Enter') return;
            event.preventDefault(); event.stopPropagation(); onHoldOriginal(false);
          }}>按住看原图</button>
        </div>
        {error && <p className="tone-editor-error" role="alert">{error}</p>}
        {mode === 'crop' && <fieldset className="tone-group tone-geometry" disabled={saving || !sourceSize}>
          <legend>裁切比例</legend>
          <div className="tone-ratios" role="group" aria-label="裁切比例">
            {[[undefined, '自由'], [sourceSize?.width / sourceSize?.height, '原比例'], [1, '1:1'], [4 / 3, '4:3'], [3 / 4, '3:4'], [16 / 9, '16:9'], [9 / 16, '9:16']].map(([value, label]) =>
              <button type="button" key={label} aria-pressed={aspect === value} onClick={() => onAspect(value)}>{label}</button>)}
          </div>
          <div className="tone-rotation-tools">
            <button type="button" className="tone-icon" title="向左旋转 90 度" aria-label="向左旋转 90 度" onClick={() => onRotate(draft.rotation - 90)}><RotateCcw size={16} /></button>
            <button type="button" className="tone-icon" title="向右旋转 90 度" aria-label="向右旋转 90 度" onClick={() => onRotate(draft.rotation + 90)}><RotateCw size={16} /></button>
            <button type="button" className="tone-reset-crop" onClick={onResetCrop}>还原裁切</button>
          </div>
          <div className="tone-control">
            <label htmlFor="tone-rotation">旋转角度</label>
            <input className="tone-number" aria-label="旋转角度数值" type="number" min={-180} max={180} step={0.1} value={draft.rotation || 0}
              onFocus={onGestureStart} onBlur={onGestureEnd} onChange={e => onRotate(Number(e.target.value))} />
            <input id="tone-rotation" type="range" min={-180} max={180} step={0.1} value={draft.rotation || 0}
              onPointerDown={onGestureStart} onPointerUp={onGestureEnd} onPointerCancel={onGestureEnd}
              onKeyDown={onGestureStart} onKeyUp={onGestureEnd} onChange={e => onRotate(Number(e.target.value))} />
          </div>
        </fieldset>}
        {mode === 'tone' && groups.map(([title, controls]) => (
          <fieldset className="tone-group" key={title} disabled={saving}>
            <legend>{title}</legend>
            {controls.map(([key, label, min = -100, max = 100, step = 1]) => {
              const value = Number(Number(draft[key] || 0).toFixed(2));
              return <div className={`tone-control tone-control--${key}`} key={key}>
                <label htmlFor={`tone-${key}`} title="双击归零" onDoubleClick={() => onChange(key, 0)}>{label}{key === 'exposure' && <span> EV</span>}</label>
                <input id={`tone-value-${key}`} className="tone-number" type="number" aria-label={`${label}数值`} min={min} max={max} step={step} value={value}
                  onFocus={onGestureStart} onBlur={onGestureEnd} onChange={e => onChange(key, e.target.value)} />
                <input id={`tone-${key}`} type="range" min={min} max={max} step={step} value={value}
                  onPointerDown={onGestureStart} onPointerUp={onGestureEnd} onPointerCancel={onGestureEnd}
                  onKeyDown={onGestureStart} onKeyUp={onGestureEnd}
                  onChange={e => onChange(key, e.target.value)} />
              </div>;
            })}
          </fieldset>
        ))}
      </div>
      <footer className="tone-editor-footer">
        <button type="button" onClick={onAuto} disabled={busy || facesLoading || saving || !analysis}>自动明暗</button>
        <button type="button" onClick={onReset} disabled={saving}>重置</button>
        <button type="button" className="tone-save" onClick={onSave} disabled={saving || busy || !dirty || Boolean(error)}>{saving ? '保存中' : '保存'}</button>
      </footer>
    </section>
  );
}
