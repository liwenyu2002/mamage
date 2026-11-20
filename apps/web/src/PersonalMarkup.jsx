import React from 'react';
import { MousePointer2, Square, ArrowUpRight, Type, EyeOff, Undo2, Redo2, Trash2 } from 'lucide-react';
import { Button } from './ui';
import { renderPersonalCanvas } from './utils/personalImageTools';
import { getToneAdjustmentKey } from './utils/photoAdjustments';
import { ANNOTATION_COLORS, createPersonalAnnotation, paintPersonalAnnotations, annotationBounds,
  hitPersonalAnnotation, movePersonalAnnotation, annotationToCanvasPoint, resizePersonalAnnotation } from './utils/personalAnnotations';

const modes = [{ id: 'select', label: '选择标注', icon: MousePointer2 }, { id: 'rectangle', label: '矩形标注', icon: Square },
  { id: 'arrow', label: '箭头标注', icon: ArrowUpRight }, { id: 'text', label: '文字标注', icon: Type }, { id: 'redact', label: '隐私遮挡', icon: EyeOff }];

export function PersonalMarkupControls({ item, value, onChange, selectedId, onSelected, onEdit, disabled }) {
  const annotations = item.annotations || [], selected = annotations.find(mark => mark.id === selectedId);
  const patchStyle = patch => {
    onChange(previous => ({ ...previous, ...patch }));
    if (!selected) return;
    const changes = { ...(patch.color && selected.kind !== 'redact' ? { color: patch.color } : {}),
      ...(patch.maskColor && selected.kind === 'redact' ? { color: patch.maskColor } : {}),
      ...(patch.text != null && selected.kind === 'text' ? { text: patch.text.slice(0, 200) } : {}),
      ...(patch.lineWidth ? { lineWidth: patch.lineWidth / 600 } : {}), ...(patch.fontSize ? { fontSize: patch.fontSize / 600 } : {}) };
    if (Object.keys(changes).length) onEdit(annotations.map(mark => mark.id === selectedId ? { ...mark, ...changes } : mark));
  };
  const mask = value.mode === 'redact' || selected?.kind === 'redact';
  return <aside className="personal-options personal-markup-options" aria-label="标注工具">
    <h2>标注与隐私</h2>
    {mask ? <fieldset className="personal-swatches"><legend>遮挡颜色</legend>{['#000000', '#ffffff'].map(option => <button key={option} type="button" title={option === '#000000' ? '黑色实心遮挡' : '白色实心遮挡'}
      aria-label={option === '#000000' ? '黑色实心遮挡' : '白色实心遮挡'} aria-pressed={(selected?.color || value.maskColor) === option} disabled={disabled}
      style={{ '--swatch': option }} onClick={() => patchStyle({ maskColor: option })} />)}</fieldset>
      : <fieldset className="personal-swatches"><legend>标注颜色</legend>{ANNOTATION_COLORS.map((option, index) => <button key={option} type="button" title={['红色', '蓝色', '绿色', '黑色', '白色'][index]}
        aria-label={['红色', '蓝色', '绿色', '黑色', '白色'][index]} aria-pressed={(selected?.color || value.color) === option} disabled={disabled}
        style={{ '--swatch': option }} onClick={() => patchStyle({ color: option })} />)}</fieldset>}
    {!mask && (value.mode === 'text' || selected?.kind === 'text') ? <>
      <label>标注文字<textarea aria-label="标注文字" value={selected?.kind === 'text' ? selected.text : value.text} disabled={disabled} maxLength={200} rows={3} onChange={event => patchStyle({ text: event.target.value })} /></label>
      <label>字号<input aria-label="标注字号" type="number" min="12" max="96" value={Math.round(selected?.fontSize ? selected.fontSize * 600 : value.fontSize)} disabled={disabled} onChange={event => patchStyle({ fontSize: Number(event.target.value) })} /></label>
    </> : !mask ? <label>线条粗细<input aria-label="标注线条粗细" type="range" min="1" max="12" value={Math.round(selected?.lineWidth ? selected.lineWidth * 600 : value.lineWidth)} disabled={disabled} onChange={event => patchStyle({ lineWidth: Number(event.target.value) })} /></label> : null}
    <div className="personal-markup-history"><Button title="撤销标注" aria-label="撤销标注" icon={<Undo2 size={17} />} disabled={disabled || !item.annotationPast?.length} onClick={() => { onEdit('undo'); onSelected(null); }} />
      <Button title="重做标注" aria-label="重做标注" icon={<Redo2 size={17} />} disabled={disabled || !item.annotationFuture?.length} onClick={() => { onEdit('redo'); onSelected(null); }} />
      <Button title="删除所选标注" aria-label="删除所选标注" icon={<Trash2 size={17} />} disabled={disabled || !selected} onClick={() => { onEdit(annotations.filter(mark => mark.id !== selectedId)); onSelected(null); }} /></div>
    <dl><dt>标注</dt><dd>{annotations.filter(mark => mark.kind !== 'redact').length} 处</dd><dt>实心遮挡</dt><dd>{annotations.filter(mark => mark.kind === 'redact').length} 处</dd><dt>导出</dt><dd>合并到图片像素</dd></dl>
  </aside>;
}

export default function PersonalMarkup({ item, value, onChange, selectedId, onSelected, onEdit, disabled }) {
  const baseRef = React.useRef(null), overlayRef = React.useRef(null), drag = React.useRef(null);
  const [ready, setReady] = React.useState(false), [error, setError] = React.useState(''), [size, setSize] = React.useState(null);
  const [pending, setPending] = React.useState(null);
  const annotations = item.annotations || [], sourceSize = { width: item.width, height: item.height };
  const sourceKey = JSON.stringify([item.id, getToneAdjustmentKey(item.adjustments)]);
  React.useEffect(() => { setPending(null); drag.current = null; }, [value.mode, sourceKey]);
  React.useEffect(() => {
    const abort = new AbortController(); setReady(false); setError(''); setSize(null);
    void (async () => {
      let source;
      try {
        source = await renderPersonalCanvas({ ...item, annotations: [] }, { signal: abort.signal });
        if (abort.signal.aborted) return;
        const base = baseRef.current, overlay = overlayRef.current;
        if (!base || !overlay) return;
        base.width = overlay.width = source.width; base.height = overlay.height = source.height;
        base.getContext('2d').drawImage(source, 0, 0); setSize({ width: source.width, height: source.height }); setReady(true);
      } catch (e) { if (!abort.signal.aborted) setError(e.message); }
      finally { if (source) source.width = source.height = 0; }
    })();
    return () => abort.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceKey]);
  React.useLayoutEffect(() => {
    const canvas = overlayRef.current;
    if (!canvas || !ready) return;
    const context = canvas.getContext('2d'); context.clearRect(0, 0, canvas.width, canvas.height);
    const marks = pending ? (annotations.some(mark => mark.id === pending.id) ? annotations.map(mark => mark.id === pending.id ? pending : mark) : [...annotations, pending]) : annotations;
    paintPersonalAnnotations(canvas, marks, { ...sourceSize, adjustments: item.adjustments });
    const selected = marks.find(mark => mark.id === (pending?.id || selectedId));
    if (selected) {
      const bounds = annotationBounds(selected, sourceSize, item.adjustments), scale = canvas.width / (canvas.getBoundingClientRect().width || canvas.width);
      context.save(); context.strokeStyle = '#2468c9'; context.lineWidth = scale;
      context.setLineDash([4 * scale, 3 * scale]); context.strokeRect(bounds.x - 3 * scale, bounds.y - 3 * scale, bounds.width + 6 * scale, bounds.height + 6 * scale);
      if (selected.kind !== 'text') {
        context.setLineDash([]); context.fillStyle = '#fff';
        selected.points.forEach(point => {
          const p = annotationToCanvasPoint(point, item.width, item.height, item.adjustments), edge = 7 * scale;
          context.fillRect(p.x - edge / 2, p.y - edge / 2, edge, edge); context.strokeRect(p.x - edge / 2, p.y - edge / 2, edge, edge);
        });
      }
      context.restore();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, annotations, pending, selectedId, sourceKey]);

  const point = event => {
    const canvas = overlayRef.current, rect = canvas.getBoundingClientRect();
    return { x: Math.max(0, Math.min(canvas.width, (event.clientX - rect.left) / rect.width * canvas.width)), y: Math.max(0, Math.min(canvas.height, (event.clientY - rect.top) / rect.height * canvas.height)) };
  };
  const begin = event => {
    if (disabled || !ready || event.button !== 0 || !event.isPrimary) return;
    event.preventDefault(); event.currentTarget.focus({ preventScroll: true });
    const start = point(event);
    if (value.mode === 'text') {
      const mark = createPersonalAnnotation('text', start, start, sourceSize, item.adjustments, value);
      if (!mark) { setError('请先填写标注文字'); return; }
      onEdit([...annotations, mark]); onSelected(mark.id); return;
    }
    let mark, handle;
    if (value.mode === 'select') {
      const selected = annotations.find(item => item.id === selectedId), tolerance = 10 * overlayRef.current.width / overlayRef.current.clientWidth;
      const index = selected && selected.kind !== 'text' ? selected.points.findIndex(point => {
        const p = annotationToCanvasPoint(point, item.width, item.height, item.adjustments);
        return Math.hypot(p.x - start.x, p.y - start.y) <= tolerance;
      }) : -1;
      if (index >= 0) { mark = selected; handle = index; }
      else mark = hitPersonalAnnotation(annotations, start, sourceSize, item.adjustments, tolerance);
      onSelected(mark?.id || null); if (!mark) return;
    }
    setError(''); drag.current = { start, mark, id: mark?.id, handle };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const move = event => {
    if (!drag.current || disabled) return;
    const current = point(event), { start, mark, handle } = drag.current;
    const next = mark ? (handle == null ? movePersonalAnnotation(mark, start, current, sourceSize, item.adjustments) : resizePersonalAnnotation(mark, handle, current, sourceSize, item.adjustments))
      : createPersonalAnnotation(value.mode, start, current, sourceSize, item.adjustments, value);
    if (next) { if (!drag.current.id) drag.current.id = next.id; setPending({ ...next, id: drag.current.id }); }
    else setPending(null);
  };
  const end = event => {
    if (!drag.current) return;
    if (pending && event.type !== 'pointercancel') {
      if (drag.current.mark) onEdit(annotations.map(mark => mark.id === pending.id ? pending : mark));
      else onEdit([...annotations, pending]);
      onSelected(pending.id);
    }
    drag.current = null; setPending(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  return <>
    <div className="personal-markup-modes" role="group" aria-label="标注模式">{modes.map(({ id, label, icon: Icon }) => <button key={id} type="button" title={label} aria-label={label}
      aria-pressed={value.mode === id} disabled={disabled} onClick={() => { onChange(previous => ({ ...previous, mode: id })); onSelected(null); }}><Icon size={20} /></button>)}</div>
    <div className="personal-markup-stage" data-ready={ready} data-mode={value.mode} style={{ '--image-ratio': size ? size.width / size.height : item.width / item.height }}>
      <canvas ref={baseRef} aria-hidden="true" hidden={!ready} />
      <canvas ref={overlayRef} className="personal-markup-overlay" tabIndex={disabled ? -1 : 0} role="img" aria-label="图片标注画布" hidden={!ready}
        onPointerDown={begin} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onLostPointerCapture={() => { drag.current = null; setPending(null); }}
        onKeyDown={event => {
          if (disabled) return;
          if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); onEdit(event.shiftKey ? 'redo' : 'undo'); onSelected(null); }
          else if (['Delete', 'Backspace'].includes(event.key) && selectedId) { event.preventDefault(); onEdit(annotations.filter(mark => mark.id !== selectedId)); onSelected(null); }
          else if (event.key === 'Escape') { setPending(null); drag.current = null; onSelected(null); }
        }} />
    </div>
    {!ready && !error ? <span className="personal-canvas-progress" role="status">正在读取原画质图片…</span> : null}
    {error ? <p className="personal-error personal-markup-error" role="alert">{error}</p> : null}
  </>;
}
