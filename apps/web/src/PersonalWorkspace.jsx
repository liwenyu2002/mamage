import React from 'react';
import { Images, Plus, Download, Trash2, ArrowLeft, ArrowRight, SlidersHorizontal, FileDown, PanelsTopLeft, Ruler, Users, ShieldCheck, X, FileImage, Pencil } from 'lucide-react';
import { Button, GlassSelect } from './ui';
import ViewerToneImage from './ProjectTonePreview';
import PhotoToneControls from './PhotoToneControls';
import WorkspaceJoinChooser from './WorkspaceJoinChooser';
import PersonalRasterPreview from './PersonalRasterPreview';
import PersonalMarkup, { PersonalMarkupControls } from './PersonalMarkup';
import PersonalPdfOptions from './PersonalPdfOptions';
import PersonalFileThumbnail from './PersonalFileThumbnail';
import { annotationEdit, paintPersonalAnnotations, assertPersonalCanvasSize } from './utils/personalAnnotations';
import { getMyMembershipRequests } from './services/workspaceJoinService';
import { DEFAULT_PHOTO_ADJUSTMENTS, buildPhotoAdjustments, getToneAdjustmentKey } from './utils/photoAdjustments';
import { rotatedSize, cropPixels, fitCropAspect, straightenedCrop } from '../../server/lib/photo_tone/geometry.mjs';
import { printDimensions } from './utils/personalImageLayout';
import { readPersonalFile, exportPersonalImage, exportPersonalZip, renderPersonalCollage, encodePersonalCanvas, downloadPersonalBlob } from './utils/personalImageTools';
import './PersonalWorkspace.css';
import { getNavigation } from './utils/navigation';

const tools = [
  { id: 'edit', label: '原图编辑', icon: SlidersHorizontal },
  { id: 'compress', label: '压缩转图', icon: FileDown },
  { id: 'collage', label: '组图拼版', icon: PanelsTopLeft },
  { id: 'pdf', label: '图片转 PDF', icon: FileImage },
  { id: 'markup', label: '标注遮挡', icon: Pencil },
  { id: 'inspect', label: '尺寸检查', icon: Ruler },
];
const bytes = value => value >= 1000000 ? `${(value / 1000000).toFixed(1)} MB` : `${Math.ceil(value / 1000)} KB`;

function Histogram({ values }) {
  const bins = Array.isArray(values) && values.length ? values : Array(256).fill(0), max = Math.max(1, ...bins);
  const points = bins.map((value, i) => `${i / 255 * 100},${100 - Math.sqrt(value / max) * 92}`).join(' ');
  return <svg className="tone-histogram-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><polygon points={`0,100 ${points} 100,100`} /><polyline points={points} /></svg>;
}

export default function PersonalWorkspace({ currentUser, membershipSummary, onEnterOrganization }) {
  const [items, setItems] = React.useState([]), itemsRef = React.useRef([]);
  const [selected, setSelected] = React.useState('');
  const [tool, setTool] = React.useState('edit');
  const [joinOpen, setJoinOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [progress, setProgress] = React.useState('');
  const [error, setError] = React.useState('');
  const [result, setResult] = React.useState(null);
  const [toneMode, setToneMode] = React.useState('tone');
  const [comparison, setComparison] = React.useState('adjusted');
  const [holding, setHolding] = React.useState(false);
  const [analysis, setAnalysis] = React.useState(null);
  const [toneBusy, setToneBusy] = React.useState(false);
  const [toneError, setToneError] = React.useState('');
  const [aspect, setAspect] = React.useState(undefined);
  const [history, setHistory] = React.useState({ past: [], future: [] });
  const gesture = React.useRef(null), controller = React.useRef(null), alive = React.useRef(true);
  const leaving = React.useRef(false);
  const [format, setFormat] = React.useState('png');
  const [maxEdge, setMaxEdge] = React.useState(2400);
  const [targetKB, setTargetKB] = React.useState(200);
  const [limitSize, setLimitSize] = React.useState(true);
  const [allowResize, setAllowResize] = React.useState(true);
  const [collage, setCollage] = React.useState({ width: 2400, columns: 2, gap: 24, labels: true });
  const [collageBusy, setCollageBusy] = React.useState(false);
  const [collageSize, setCollageSize] = React.useState(null);
  const [pdf, setPdf] = React.useState({ title: '图片资料', paper: 'a4', orientation: 'auto', margin: 10 });
  const [markup, setMarkup] = React.useState({ mode: 'rectangle', color: '#d63b43', maskColor: '#000000', lineWidth: 3, fontSize: 32, text: '' });
  const [selectedAnnotation, setSelectedAnnotation] = React.useState(null);
  const collageCanvas = React.useRef(null), picker = React.useRef(null);
  const [dpi, setDpi] = React.useState(300), [printWidth, setPrintWidth] = React.useState(100);
  const active = items.find(item => item.id === selected) || items[0];
  const draft = active?.adjustments || DEFAULT_PHOTO_ADJUSTMENTS;
  const editKey = JSON.stringify([getToneAdjustmentKey(draft), active?.annotations || []]);
  const bounds = active ? rotatedSize(active.width, active.height, draft.rotation) : null;
  const output = bounds ? cropPixels(bounds.width, bounds.height, draft.crop) : null;
  const physical = output && dpi >= 1 && dpi <= 2400 ? printDimensions(output.width, output.height, dpi) : null;
  itemsRef.current = items;

  React.useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; controller.current?.abort(); itemsRef.current.forEach(item => URL.revokeObjectURL(item.url)); };
  }, []);
  React.useEffect(() => getNavigation().block(next => {
    if (!itemsRef.current.length || leaving.current || new URL(next, window.location.origin).pathname === '/personal') return true;
    return window.confirm('离开将结束本次临时编辑，请先下载需要的图片。确定离开吗？');
  }), []);
  React.useEffect(() => {
    const warn = event => { if (!itemsRef.current.length) return; event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, []);
  React.useEffect(() => {
    const abort = new AbortController();
    getMyMembershipRequests(abort.signal).then(value => { if (!abort.signal.aborted && value.needsChoice && currentUser?.needsAssignment) setJoinOpen(true); }).catch(() => {});
    return () => abort.abort();
  }, [currentUser?.id]);
  React.useEffect(() => {
    setAnalysis(null); setToneError(''); setToneBusy(Boolean(active)); setHistory({ past: [], future: [] });
    setToneMode('tone'); setAspect(undefined); setComparison('adjusted'); setHolding(false); gesture.current = null;
    setSelectedAnnotation(null);
  }, [active?.id]);
  React.useEffect(() => {
    if (tool !== 'edit') setHolding(false);
    if (tool === 'edit' && active) setToneBusy(true);
  }, [tool]);
  React.useEffect(() => {
    if (tool !== 'collage' || !items.length) return undefined;
    const abort = new AbortController();
    setCollageBusy(true); setCollageSize(null);
    const timer = setTimeout(async () => {
      let canvas;
      try {
        canvas = await renderPersonalCollage(items, { ...collage, signal: abort.signal });
        if (abort.signal.aborted) return;
        const target = collageCanvas.current;
        if (target) { target.width = canvas.width; target.height = canvas.height; target.getContext('2d').drawImage(canvas, 0, 0); }
        setCollageSize({ width: canvas.width, height: canvas.height }); setError('');
      } catch (e) { if (!abort.signal.aborted) setError(e.message); }
      finally { if (canvas) canvas.width = canvas.height = 0; if (!abort.signal.aborted) setCollageBusy(false); }
    }, 180);
    return () => { abort.abort(); clearTimeout(timer); };
  }, [items, collage, tool]);

  const addFiles = async files => {
    if (busy) return;
    const list = Array.from(files || []);
    if (items.length + list.length > 20) return setError('一次最多处理 20 张图片');
    setBusy(true); setError(''); setResult(null);
    const added = [], errors = [];
    try {
      for (const file of list) {
        try { added.push(await readPersonalFile(file)); } catch (e) { errors.push(`${file.name}：${e.message}`); }
        if (!alive.current) { added.forEach(item => URL.revokeObjectURL(item.url)); return; }
      }
      setItems(previous => [...previous, ...added]);
      if (!active && added.length) setSelected(added[0].id);
      if (errors.length) setError(errors.join('；'));
    } finally { if (alive.current) setBusy(false); if (picker.current) picker.current.value = ''; }
  };
  const remove = id => {
    if (busy) return;
    const item = items.find(value => value.id === id);
    if (item) URL.revokeObjectURL(item.url);
    const next = items.filter(value => value.id !== id);
    setItems(next); if (selected === id) setSelected(next[0]?.id || ''); setResult(null);
  };
  const reorder = (index, delta) => {
    if (busy || index + delta < 0 || index + delta >= items.length) return;
    setItems(previous => { const next = [...previous]; [next[index], next[index + delta]] = [next[index + delta], next[index]]; return next; });
  };
  const commit = (value, record = true) => {
    if (!active) return;
    const next = buildPhotoAdjustments(value, value.source || 'manual');
    try { assertPersonalCanvasSize(active.width, active.height, next); }
    catch (e) { setError(e.message); return; }
    if (getToneAdjustmentKey(next) === getToneAdjustmentKey(draft)) return;
    if (record && !gesture.current?.recorded) {
      setHistory(previous => ({ past: [...previous.past, draft].slice(-15), future: [] }));
      if (gesture.current) gesture.current.recorded = true;
    }
    if (getToneAdjustmentKey({ ...next, rotation: 0, crop: null }) !== getToneAdjustmentKey({ ...draft, rotation: 0, crop: null })) setToneBusy(true);
    setItems(previous => previous.map(item => item.id === active.id ? { ...item, adjustments: next } : item));
    setResult(null);
  };
  const change = (key, value) => {
    if (key === 'rotation' && active) {
      const rotated = rotatedSize(active.width, active.height, Number(value));
      commit({ ...draft, rotation: Number(value), crop: fitCropAspect(rotated.width, rotated.height,
        straightenedCrop(active.width, active.height, Number(value)), aspect), source: 'manual' });
    } else commit({ ...draft, [key]: key === 'crop' ? value : Number(value), source: 'manual' });
  };
  const changeAspect = value => {
    setAspect(value);
    if (active && value) change('crop', fitCropAspect(bounds.width, bounds.height, straightenedCrop(active.width, active.height, draft.rotation), value));
  };
  const moveHistory = direction => {
    const value = direction === 'undo' ? history.past.at(-1) : history.future[0];
    if (!value) return;
    setHistory(direction === 'undo' ? { past: history.past.slice(0, -1), future: [draft, ...history.future] }
      : { past: [...history.past, draft], future: history.future.slice(1) });
    commit(value, false);
  };
  const chooseTool = id => { setTool(id); setError(''); setResult(null); if (id === 'compress') setFormat('jpeg'); if (id === 'markup') setFormat('png'); };
  const editAnnotations = next => {
    if (!active || busy) return;
    try {
      const update = annotationEdit(active, next);
      setItems(previous => previous.map(item => item.id === active.id ? { ...item, ...update } : item));
      setResult(null); setError('');
    } catch (e) { setError(e.message); }
  };
  const paintAnnotations = React.useCallback((canvas, options) => paintPersonalAnnotations(canvas, active?.annotations, options), [active?.id, active?.annotations]);
  const download = async () => {
    if (!active || busy || (tool === 'collage' && (collageBusy || !collageSize))) return;
    const abort = new AbortController(); controller.current = abort;
    setBusy(true); setProgress('正在处理'); setError(''); setResult(null);
    try {
      if (tool === 'compress' && limitSize && !(targetKB >= 1)) throw new Error('体积上限至少为 1 KB');
      if (tool === 'pdf') {
        const { exportPersonalPdf } = await import(/* webpackChunkName: "personal-pdf" */ './utils/personalPdf');
        const result = await exportPersonalPdf(items, { ...pdf, signal: abort.signal }, (done, total) => setProgress(`${done} / ${total} 页`));
        if (!alive.current || abort.signal.aborted) return;
        downloadPersonalBlob(result.blob, result.name); setResult({ pages: result.pages, bytes: result.blob.size });
      } else if (tool === 'collage') {
        const result = await encodePersonalCanvas(collageCanvas.current, { format: 'png', maxEdge: Math.max(collageSize.width, collageSize.height), signal: abort.signal });
        if (!alive.current || abort.signal.aborted) return;
        downloadPersonalBlob(result.blob, 'mamage-figure-panels.png'); setResult({ ...result, bytes: result.blob.size });
      } else if (tool === 'compress' && items.length > 1) {
        const result = await exportPersonalZip(items, { format, maxEdge, targetKB: limitSize ? targetKB : 0, allowResize, signal: abort.signal }, (done, total) => setProgress(`${done} / ${total}`));
        if (!alive.current || abort.signal.aborted) return;
        downloadPersonalBlob(result.blob, 'mamage-images.zip'); setResult({ count: result.results.length, bytes: result.blob.size });
      } else {
        const result = await exportPersonalImage(active, { format, maxEdge: tool === 'compress' ? maxEdge : Math.max(output.width, output.height),
          targetKB: tool === 'compress' && limitSize ? targetKB : 0, allowResize, signal: abort.signal });
        if (!alive.current || abort.signal.aborted) return;
        downloadPersonalBlob(result.blob, result.name); setResult({ ...result, bytes: result.blob.size });
        if (tool === 'edit' || tool === 'markup') setItems(previous => previous.map(item => item.id === active.id ? { ...item, exportedKey: editKey } : item));
      }
    } catch (e) { if (e.name !== 'AbortError' && alive.current) setError(e.message); }
    finally { if (alive.current) { setBusy(false); setProgress(''); } }
  };
  const enterOrganization = () => {
    if (items.length && !window.confirm('进入组织图库将结束本次临时编辑，请先下载需要的图片。确定离开吗？')) return;
    leaving.current = true;
    Promise.resolve(onEnterOrganization?.()).catch(e => setError(e.message)).finally(() => { leaving.current = false; });
  };

  return <section className="personal-workspace" aria-label="个人图片工具">
    <header className="personal-heading"><div><h1>个人工具</h1><span><ShieldCheck size={14} />本地会话 · {items.length} 张图片</span></div>
      <div className="personal-membership-actions">
        {membershipSummary?.hasMembership ? <Button size="small" onClick={enterOrganization}>进入组织图库</Button> : null}
        <Button size="small" icon={<Users size={16} />} onClick={() => setJoinOpen(true)}>组织申请{membershipSummary?.unreadCount ? <span className="membership-menu-count">{membershipSummary.unreadCount}</span> : null}</Button>
      </div></header>
    <div className="personal-toolbar">
      <nav className="personal-tool-tabs" role="tablist" aria-label="图片工具">{tools.map(({ id, label, icon: Icon }) => <button type="button" role="tab" key={id}
        aria-selected={tool === id} disabled={busy} onClick={() => chooseTool(id)}><Icon size={17} /><span>{label}</span></button>)}</nav>
      <div className="personal-file-actions"><input type="file" accept="image/jpeg,image/png,image/webp,image/avif" multiple ref={picker}
        aria-label="选择本地图片" onChange={event => addFiles(event.target.files)} hidden />
        <Button size="small" icon={<Plus size={17} />} disabled={busy} onClick={() => picker.current?.click()}>添加图片</Button>
        <Button size="small" type="primary" theme="solid" icon={<Download size={17} />} loading={busy} disabled={!active || (tool === 'edit' && (toneBusy || Boolean(toneError))) || (tool === 'collage' && (collageBusy || !collageSize))} onClick={download}>
          {tool === 'pdf' ? '下载 PDF' : tool === 'collage' ? '下载组图' : tool === 'compress' && items.length > 1 ? '批量下载 ZIP' : '下载图片'}</Button>
        {busy ? <Button size="small" title="取消处理" aria-label="取消处理" icon={<X size={16} />} onClick={() => controller.current?.abort()} /> : null}
      </div>
    </div>
    {error ? <p className="personal-error" role="alert">{error}</p> : null}
    {result ? <p className="personal-result" role="status">已导出{result.pages ? ` ${result.pages} 页 PDF` : result.count ? ` ${result.count} 张图片` : ` ${result.width} × ${result.height}`}{` · ${bytes(result.bytes)}`}</p> : null}
    <div className={`personal-tool-layout${active ? '' : ' is-empty'}`}>
      {items.length > 0 ? <aside className="personal-file-rail" aria-label="本地图片列表">{items.map((item, index) => <div className={`personal-file${active?.id === item.id ? ' is-active' : ''}`} key={item.id}>
        <button type="button" className="personal-file-pick" disabled={busy} aria-pressed={active?.id === item.id} title={item.name} onClick={() => setSelected(item.id)}>
          <PersonalFileThumbnail item={item} /><span>{index + 1}. {item.name}</span>{item.annotations?.some(mark => mark.kind === 'redact') ? <small className="personal-file-masked"><ShieldCheck size={10} />已设遮挡</small> : null}</button>
        <div className="personal-file-controls"><button type="button" title="前移图片" aria-label={`前移 ${item.name}`} disabled={busy || index === 0} onClick={() => reorder(index, -1)}><ArrowLeft size={13} /></button>
          <button type="button" title="后移图片" aria-label={`后移 ${item.name}`} disabled={busy || index === items.length - 1} onClick={() => reorder(index, 1)}><ArrowRight size={13} /></button>
          <button type="button" title="移除图片" aria-label={`移除 ${item.name}`} disabled={busy} onClick={() => remove(item.id)}><Trash2 size={13} /></button></div>
      </div>)}</aside> : null}
      <div className="personal-preview" aria-label="图片预览" data-tool={tool}>
        {!active ? <div className="personal-empty"><Images size={38} strokeWidth={1.25} /><span>未选择图片</span></div> : tool === 'edit' ?
          <ViewerToneImage key={active.id} src={active.url} adjustments={draft} interactive exact comparison={holding ? 'original' : comparison}
            cropMode={toneMode === 'crop'} cropAspect={aspect} editingDisabled={busy} alt={active.name} className="personal-editor-image"
            onCropChange={crop => change('crop', crop)} onCropStart={() => { gesture.current = { recorded: false }; }} onCropEnd={() => { gesture.current = null; }}
            onPaintCanvas={paintAnnotations} onAnalysis={value => { setAnalysis(value); setToneBusy(false); setToneError(''); }} onToneError={message => { setToneError(message); setToneBusy(false); }} />
          : tool === 'markup' ? <PersonalMarkup key={active.id} item={active} value={markup} onChange={setMarkup} selectedId={selectedAnnotation} onSelected={setSelectedAnnotation} onEdit={editAnnotations} disabled={busy} />
          : tool === 'collage' ? <><canvas ref={collageCanvas} className="personal-collage-canvas" aria-label="组图预览" />{collageBusy ? <span className="personal-canvas-progress" role="status">正在生成组图…</span> : null}</>
            : <PersonalRasterPreview item={active} pdf={tool === 'pdf' ? pdf : undefined} />}
        {active ? <span className="personal-preview-meta">{tool === 'pdf' ? `第 ${items.indexOf(active) + 1} 页 / 共 ${items.length} 页` : tool === 'collage' ? (collageSize ? `${collageSize.width} × ${collageSize.height}` : '') : `${output.width} × ${output.height} · ${bytes(active.size)}`}</span> : null}
      </div>
      {active ? tool === 'edit' ? <PhotoToneControls draft={draft} analysis={analysis} busy={toneBusy} saving={busy} error={toneError}
        dirty={editKey !== active.exportedKey} comparison={comparison} holdingOriginal={holding}
        saveLabel="导出" savedLabel="已导出" dirtyLabel="待导出"
        onCompare={setComparison} onHoldOriginal={setHolding} onChange={change} onGestureStart={() => { gesture.current = { recorded: false }; }} onGestureEnd={() => { gesture.current = null; }}
        onAuto={() => { if (analysis?.autoAdjustments) commit({ ...draft, ...Object.fromEntries(['exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks'].map(key => [key, analysis.autoAdjustments[key]])), source: 'auto' }); }}
        onReset={() => commit(DEFAULT_PHOTO_ADJUSTMENTS)} onSave={download} onClose={() => chooseTool('inspect')} onUndo={() => moveHistory('undo')} onRedo={() => moveHistory('redo')}
        canUndo={history.past.length > 0} canRedo={history.future.length > 0} histogram={<Histogram values={analysis?.adjustedHistogram} />}
        mode={toneMode} onMode={setToneMode} aspect={aspect} onAspect={changeAspect} onRotate={value => change('rotation', value)} onResetCrop={() => change('crop', null)}
        sourceSize={{ width: active.width, height: active.height }} outputSize={output} />
        : tool === 'markup' ? <PersonalMarkupControls item={active} value={markup} onChange={setMarkup} selectedId={selectedAnnotation} onSelected={setSelectedAnnotation} onEdit={editAnnotations} disabled={busy} />
        : tool === 'pdf' ? <PersonalPdfOptions value={pdf} onChange={setPdf} count={items.length} disabled={busy} /> : <aside className="personal-options" aria-label="工具参数">
        {tool === 'compress' ? <><h2>压缩与转换</h2>
          <GlassSelect label="导出格式" value={format} onChange={setFormat} disabled={busy} options={[{ value: 'jpeg', label: 'JPG' }, { value: 'png', label: 'PNG' }, { value: 'webp', label: 'WebP' }]} />
          <label>最长边（像素）<input type="number" min="1" max="16384" value={maxEdge} disabled={busy} onChange={event => setMaxEdge(Number(event.target.value))} /></label>
          <label className="personal-check"><input type="checkbox" checked={limitSize} disabled={busy} onChange={event => setLimitSize(event.target.checked)} />限制文件大小</label>
          <label>每张体积上限（KB）<input type="number" min="1" max="40000" value={targetKB} disabled={busy || !limitSize} onChange={event => setTargetKB(Number(event.target.value))} /></label>
          <label className="personal-check"><input type="checkbox" checked={allowResize} disabled={busy || !limitSize} onChange={event => setAllowResize(event.target.checked)} />超限时允许缩小尺寸</label>
          <dl><dt>处理数量</dt><dd>{items.length} 张</dd><dt>原图总大小</dt><dd>{bytes(items.reduce((sum, item) => sum + item.size, 0))}</dd></dl>
        </> : tool === 'collage' ? <><h2>组图拼版</h2>
          <label>画布宽度（像素）<input type="number" min="320" max="8192" step="100" value={collage.width} disabled={busy} onChange={event => setCollage(value => ({ ...value, width: Number(event.target.value) }))} /></label>
          <GlassSelect label="列数" value={String(collage.columns)} disabled={busy} onChange={value => setCollage(previous => ({ ...previous, columns: Number(value) }))} options={[1, 2, 3, 4].map(value => ({ value: String(value), label: `${value} 列` }))} />
          <label>间距（像素）<input type="number" min="0" max="200" value={collage.gap} disabled={busy} onChange={event => setCollage(value => ({ ...value, gap: Number(event.target.value) }))} /></label>
          <label className="personal-check"><input type="checkbox" checked={collage.labels} disabled={busy} onChange={event => setCollage(value => ({ ...value, labels: event.target.checked }))} />A / B / C 子图编号</label>
          <dl><dt>图片</dt><dd>{items.length} 张</dd><dt>导出格式</dt><dd>PNG</dd><dt>画面</dt><dd>完整保留比例</dd></dl>
        </> : <><h2>图片尺寸</h2><dl><dt>原始像素</dt><dd>{active.width} × {active.height}</dd><dt>编辑后像素</dt><dd>{output.width} × {output.height}</dd><dt>原文件大小</dt><dd>{bytes(active.size)}</dd></dl>
          <label>打印参考 DPI<input type="number" min="1" max="2400" value={dpi} onChange={event => setDpi(Number(event.target.value))} /></label>
          <dl><dt>对应打印尺寸</dt><dd>{physical ? `${physical.widthMm.toFixed(1)} × ${physical.heightMm.toFixed(1)} mm` : '—'}</dd></dl>
          <label>排版宽度（mm）<input type="number" min="1" max="2000" value={printWidth} onChange={event => setPrintWidth(Number(event.target.value))} /></label>
          <dl><dt>此宽度下的有效 DPI</dt><dd>{printWidth > 0 ? Math.round(output.width / (printWidth / 25.4)) : '—'}</dd><dt>重采样</dt><dd>未放大像素</dd></dl>
        </>}
      </aside> : null}
    </div>
    <footer className="personal-session-status"><span><ShieldCheck size={14} />服务器存储：未上传</span><span>{progress || '临时会话'}</span></footer>
    <WorkspaceJoinChooser visible={joinOpen} onClose={() => setJoinOpen(false)} />
  </section>;
}
