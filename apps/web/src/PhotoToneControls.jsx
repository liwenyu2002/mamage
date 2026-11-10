import React from 'react';
import { IconClose, IconChevronLeft, IconChevronRight } from './ui/icons';
import './PhotoToneControls.css';

export default function PhotoToneControls({ draft, analysis, busy, facesLoading, saving, error, dirty,
  comparison, holdingOriginal, onCompare, onHoldOriginal, onChange, onGestureStart, onGestureEnd, onAuto, onReset,
  onSave, onClose, onUndo, onRedo, canUndo, canRedo, histogram }) {
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
        <div className="tone-editor-title"><h2>调色</h2><span>{dirty ? '未保存' : '已保存'}</span></div>
        <div className="tone-head-chart" aria-label="亮度直方图">{histogram}</div>
        <button type="button" className="tone-icon" aria-label="关闭调色" title="关闭调色" onClick={onClose}><IconClose /></button>
      </header>
      <div className="tone-editor-body">
        <div className="tone-chart" aria-label="亮度直方图">{histogram}
          <div className="tone-clipping"><span>黑场 {((analysis?.clipping?.shadows || 0) * 100).toFixed(1)}%</span><span>高光截断 {((analysis?.clipping?.highlights || 0) * 100).toFixed(1)}%</span></div>
        </div>
        <div className="tone-editor-tools">
          <div className="tone-compare" role="group" aria-label="原图对照">
            <button type="button" aria-pressed={comparison === 'adjusted'} onClick={() => onCompare('adjusted')}>调整后</button>
            <button type="button" aria-pressed={comparison === 'original'} onClick={() => onCompare('original')}>原图</button>
            <button type="button" aria-pressed={comparison === 'split'} onClick={() => onCompare('split')}>划线对比</button>
          </div>
          <button type="button" className="tone-icon" title="撤销" aria-label="撤销调色" disabled={!canUndo || saving} onClick={onUndo}><IconChevronLeft /></button>
          <button type="button" className="tone-icon" title="重做" aria-label="重做调色" disabled={!canRedo || saving} onClick={onRedo}><IconChevronRight /></button>
        </div>
        <div className="tone-comparison-actions">
        <span className="tone-metering" role="status">{facesLoading ? '读取人脸区域' : analysis?.metering?.mode === 'faces' ? `人脸优先 · ${analysis.metering.faceCount} 人` : '全图测光'}</span>
        <button type="button" className="tone-hold-original" aria-pressed={holdingOriginal} disabled={!analysis || Boolean(error)}
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
        {groups.map(([title, controls]) => (
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
