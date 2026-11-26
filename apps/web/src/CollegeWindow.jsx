import React from 'react';
import { Button, Modal, Toast } from './ui';
import { IconChevronRight, IconPlus, IconSparkleAI, IconClose, IconShare } from './ui/icons';
import { request, resolveAssetUrl } from './services/request';
import { getAll as getStationItems, getMediaKind, subscribe as subscribeStation, STATION_PHOTO_DRAG_TYPE } from './services/transferStore';
import { copyText } from './utils/clipboard';
import './CollegeWindow.css';

const ROOT = '/api/college-window';
const LIMIT = 12;
const ORIGINAL_MODE = 'original-link';
const originalNotice = '拿到链接的人可以查看和下载原图，不应用裁切和调色，原文件可能包含拍摄信息。';
const messages = {
  COLLEGE_WINDOW_NOT_FOUND: '这张照片已不存在、已发布或不再符合供图范围。',
  COLLEGE_WINDOW_REVIEW_CHANGED: '照片或资料已变更，请重新预览确认后再发布。',
  COLLEGE_WINDOW_ORIGINAL_UNAVAILABLE: '找不到可供图的原图，未发布这张照片。',
  COLLEGE_WINDOW_ORIGINAL_CONFIRMATION_REQUIRED: '发布方式已改为原图链接，请刷新页面后重新确认。',
  COLLEGE_WINDOW_UNAVAILABLE: '学院窗服务暂不可用。',
  COLLEGE_WINDOW_BUSY: '请求较多，请稍后再试。',
  COLLEGE_WINDOW_SEARCH_EXPIRED: '本轮匹配已过期，请重新选图。',
  COLLEGE_WINDOW_BATCH_ACTIVE: '已有一批照片正在发布。',
  COLLEGE_WINDOW_BATCH_PLAN_EXPIRED: '确认已过期，请关闭后重新打开批量发布。',
  COLLEGE_WINDOW_BATCH_EMPTY: '所选范围中没有可发布的照片。',
  COLLEGE_WINDOW_BATCH_ACCESS_CHANGED: '供图权限已变更，剩余照片未发布。',
  COLLEGE_WINDOW_BATCH_FAILED: '处理已中止，已发布的照片保留。',
  COLLEGE_WINDOW_BATCH_MODE_CHANGED: '发布方式已变更，剩余照片未发布，请重新确认。',
};
function problem(error) {
  if (messages[error.message]) return messages[error.message];
  if (error.status === 403) return '当前工作空间没有学院窗管理权限。';
  if (error.status === 404) return '学院窗尚未开启。';
  return error.status ? error.message : '网络连接失败，请稍后重试。';
}

function stationPhotoIds(items) {
  return [...new Set(items.filter(item => getMediaKind(item) === 'image' && /^[1-9]\d*$/.test(String(item?.id)))
    .map(item => Number(item.id)).filter(id => Number.isSafeInteger(id) && id <= 0xffffffff))];
}

function isStationDrag(event) {
  return Array.from(event.dataTransfer?.types || []).includes(STATION_PHOTO_DRAG_TYPE);
}

async function copyPublicImage(path) {
  const url = new URL(resolveAssetUrl(path), window.location.origin).href;
  try { await copyText(url); Toast.success('已复制原图链接'); }
  catch { Toast.error('复制失败，可在预览中打开并复制链接。'); }
}

function usePublishedImage(send, id) {
  const [state, setState] = React.useState({});
  React.useEffect(() => {
    if (!id) return undefined;
    const controller = new AbortController();
    let url;
    send(`/published/${id}/image`, { signal: controller.signal, readResponse: res => res.blob() }).then(blob => {
      if (controller.signal.aborted) return;
      url = URL.createObjectURL(blob);
      setState({ id, url });
    }).catch(error => {
      if (!controller.signal.aborted) setState({ id, error: problem(error) });
    });
    return () => { controller.abort(); if (url) URL.revokeObjectURL(url); };
  }, [id, send]);
  return state.id === id ? state : {};
}

function PublishedThumb({ send, item }) {
  const target = React.useRef(null);
  const [nearby, setNearby] = React.useState(false);
  const photo = usePublishedImage(send, nearby && !item.publicImagePath ? item.id : null);
  React.useEffect(() => {
    if (!('IntersectionObserver' in window)) { setNearby(true); return undefined; }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setNearby(true); observer.disconnect(); }
    }, { rootMargin: '100px' });
    observer.observe(target.current);
    return () => observer.disconnect();
  }, []);
  return <span ref={target} className="college-window-tile-media">
    {item.publicImagePath ? (item.thumbUrl ? <img src={resolveAssetUrl(item.thumbUrl)} loading="lazy" alt="" /> : <span>无缩略图</span>)
      : photo.url ? <img src={photo.url} alt="" /> : photo.error ? <span>图片不可用</span> : null}
  </span>;
}

function Preview({ send, preview, close, onConfirm, hasNext }) {
  const [state, setState] = React.useState({});
  const [decoded, setDecoded] = React.useState(false);
  const link = preview.item.publicImagePath;
  const published = usePublishedImage(send, link ? null : preview.item.id);
  React.useEffect(() => {
    if (preview.item.id) return undefined;
    const controller = new AbortController();
    send(`/candidates/${preview.item.photoId}/preview`, { signal: controller.signal }).then(data => {
      if (!controller.signal.aborted) setState({ data });
    }).catch(error => {
      if (!controller.signal.aborted) setState({ error: problem(error) });
    });
    return () => controller.abort();
  }, [send, preview.item.id, preview.item.photoId]);

  const data = preview.item.id ? preview.item : state.data;
  const url = preview.item.id ? (link ? resolveAssetUrl(link) : published.url)
    : data?.imageUrl ? resolveAssetUrl(data.imageUrl) : null;
  const error = published.error || state.error;
  return <Modal visible title={preview.item.id ? '已发布照片' : '确认供图'} onCancel={close}
    width={860} className="college-window-preview" footer={preview.item.id ? (link ? <>
      <a className="college-window-original-link" href={resolveAssetUrl(link)} target="_blank" rel="noreferrer">打开原图链接</a>
      <Button type="primary" icon={<IconShare />} onClick={() => copyPublicImage(link)}>复制原图链接</Button>
    </> : null) : <>
      <Button type="tertiary" onClick={close}>返回</Button>
      <Button type="primary" disabled={!url || !decoded || !data?.review} onClick={() => onConfirm(data)}>
        {hasNext ? '确认并看下一张' : '确认这张'}
      </Button>
    </>}>
    {error ? <p role="alert" className="college-window-error">{error}</p> : !url ? <p role="status">正在读取供图预览…</p> :
      <img src={url} className="college-window-preview-photo" alt={data.albumName || '供图预览'}
        onLoad={() => setDecoded(true)} onError={() => setState({ error: '供图预览加载失败。' })} />}
    {!preview.item.id && <p className="college-window-batch-note">{originalNotice}</p>}
    {data && <dl className="college-window-metadata">
      <dt>相册</dt><dd>{data.albumName || '不提供'}</dd>
      <dt>人物</dt><dd>{data.peopleNames?.join('、') || '无确认标注'}</dd>
      <dt>描述</dt><dd>{data.description || '不提供'}</dd>
    </dl>}
  </Modal>;
}

const batchActive = job => ['queued', 'running'].includes(job?.status);

function BulkDialog({ send, candidates, excluded, search, close, onStart }) {
  const [mode, setMode] = React.useState(candidates.length ? 'candidates' : 'matches');
  const [plan, setPlan] = React.useState(null);
  const [error, setError] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const lock = React.useRef(false);
  React.useEffect(() => {
    const controller = new AbortController();
    setPlan(null);
    setError('');
    const selection = mode === 'matches' ? { searchId: search?.searchId } : { photoIds: candidates.map(item => item.photoId) };
    send('/bulk/prepare', { method: 'POST', signal: controller.signal, data: { mode, excluded, ...selection } })
      .then(value => { if (!controller.signal.aborted) setPlan(value); })
      .catch(err => { if (!controller.signal.aborted) setError(problem(err)); });
    return () => controller.abort();
  }, [send, mode, candidates, excluded, search]);

  async function start() {
    if (lock.current || plan?.mode !== mode || !plan.count) return;
    lock.current = true;
    setSubmitting(true);
    setError('');
    try {
      onStart(await send('/bulk', { method: 'POST', data: { planId: plan.id, publicationMode: ORIGINAL_MODE } }));
    } catch (err) {
      setError(problem(err));
    } finally {
      lock.current = false;
      setSubmitting(false);
    }
  }
  return <Modal visible title="批量发布照片" width={480}
    onCancel={() => { if (!lock.current) close(); }} footer={<>
      <Button type="tertiary" disabled={submitting} onClick={close}>取消</Button>
      <Button type="primary" disabled={submitting || plan?.mode !== mode || !plan.count}
        loading={submitting} onClick={start}>{plan?.mode === mode ? `确认发布 ${plan.count} 张` : '确认发布'}</Button>
    </>}>
    <fieldset className="college-window-batch-options" aria-label="发布范围" disabled={submitting}>
      {!!candidates.length && <label>
        <input type="radio" name="college-window-batch-scope" checked={mode === 'candidates'} onChange={() => { setPlan(null); setMode('candidates'); }} />
        <span>当前候选</span><small>{candidates.length} 张</small>
      </label>}
      {search?.searchId && <label>
        <input type="radio" name="college-window-batch-scope" checked={mode === 'matches'} onChange={() => { setPlan(null); setMode('matches'); }} />
        <span>本轮全部匹配</span><small>{search.total} 张</small>
      </label>}
    </fieldset>
    <p className="college-window-batch-note">
      {mode === 'matches' && search?.nextPage && '包含尚未加载的结果。'}已排除的照片不会发布。{originalNotice}
    </p>
    {plan?.contentFilter && <p className="college-window-batch-note">无人脸或无人条件仅依据图库标注初筛。</p>}
    {error ? <p role="alert" className="college-window-error">{error}</p>
      : !plan && <p role="status" className="college-window-batch-note">正在核对可发布照片…</p>}
  </Modal>;
}

function BatchStatus({ job, stopping, onStop }) {
  const active = batchActive(job);
  const title = { queued: '等待发布', running: '正在发布', done: '批量发布完成', cancelled: '已停止剩余发布', failed: '批量发布中止' }[job.status];
  return <div className="college-window-batch-status">
    <div className="college-window-batch-progress" role="status">
      <div><strong>{title}</strong> <span>{job.processed} / {job.total} 张</span></div>
      {active && <progress aria-label="发布进度" value={job.processed} max={job.total} />}
      <div className="college-window-secondary">
        已发布 {job.published} 张{job.skipped > 0 && ` · 跳过 ${job.skipped} 张`}{job.failed > 0 && ` · 失败 ${job.failed} 张`}
        {job.error && ` · ${messages[job.error] || messages.COLLEGE_WINDOW_BATCH_FAILED}`}
      </div>
    </div>
    {active && <Button type="secondary" disabled={stopping} loading={stopping} onClick={onStop}>停止剩余发布</Button>}
  </div>;
}

export default function CollegeWindow({ unitId, draft }) {
  const send = React.useCallback((path, options) => request(ROOT + path,
    { ...options, headers: { 'X-Mamage-Unit-Id': String(unitId) } }), [unitId]);
  const [view, setView] = React.useState('review');
  const [query, setQuery] = React.useState(() => draft?.current?.query ?? '');
  const [candidates, setCandidates] = React.useState(() => draft?.current?.candidates ?? []);
  const [candidateSearch, setCandidateSearch] = React.useState(() => draft?.current?.candidateSearch ?? null);
  const [reviewed, setReviewed] = React.useState(() => draft?.current?.reviewed ?? {});
  const [excluded, setExcluded] = React.useState(() => draft?.current?.excluded ?? []);
  const [stationIds, setStationIds] = React.useState(() => stationPhotoIds(getStationItems()));
  const [stationDragOver, setStationDragOver] = React.useState(false);
  const [pending, setPending] = React.useState('');
  const [message, setMessage] = React.useState('');
  const [error, setError] = React.useState('');
  const [preview, setPreview] = React.useState(null);
  const [published, setPublished] = React.useState({ photos: [], nextCursor: null });
  const [retract, setRetract] = React.useState(null);
  const [batchOpen, setBatchOpen] = React.useState(false);
  const [batch, setBatch] = React.useState(null);
  const [pollRevision, restartPolling] = React.useReducer(value => value + 1, 0);
  const knownBatch = React.useRef(draft?.current?.batchId ?? null);
  const visible = React.useRef(null);
  visible.current = { candidates, view };
  const submitLock = React.useRef(false);
  const ready = candidates.filter(item => reviewed[item.photoId]);
  const batchRunning = batchActive(batch);
  const busy = Boolean(pending) || batchRunning;

  React.useEffect(() => subscribeStation(items => setStationIds(stationPhotoIds(items))), []);
  React.useEffect(() => {
    if (draft) draft.current = { query, candidates, candidateSearch, reviewed, excluded, batchId: knownBatch.current };
  }, [draft, query, candidates, candidateSearch, reviewed, excluded, batch?.id, batch?.status]);

  React.useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    let timer;
    async function poll() {
      try {
        const { job = null } = await send('/bulk', { signal });
        if (signal.aborted) return;
        if (batchActive(job)) {
          knownBatch.current = job.id;
          setBatch(job);
          timer = setTimeout(poll, 1400);
          return;
        }
        const completed = job && job.id === knownBatch.current;
        knownBatch.current = null;
        setBatch(job);
        if (draft?.current) draft.current.batchId = null;
        if (completed && job.published > 0) {
          const { candidates: shown, view: currentView } = visible.current;
          const ids = shown.map(item => item.photoId);
          const remaining = new Set();
          for (let index = 0; index < ids.length; index += 1000) {
            const { photos } = await send('/candidates/from-station', { method: 'POST', signal, data: { photoIds: ids.slice(index, index + 1000) } });
            photos.forEach(item => remaining.add(item.photoId));
          }
          if (signal.aborted) return;
          const removed = new Set(ids.filter(id => !remaining.has(id)));
          setCandidates(items => items.filter(item => !removed.has(item.photoId)));
          setReviewed(items => Object.fromEntries(Object.entries(items).filter(([key]) => !removed.has(Number(key)))));
          setCandidateSearch(search => search?.searchId ? search : null);
          if (currentView === 'published') {
            const page = await send('/published', { signal, data: { limit: LIMIT } });
            if (!signal.aborted) setPublished(page);
          }
        }
      } catch {
        if (!signal.aborted && knownBatch.current) timer = setTimeout(poll, 2600);
      }
    }
    poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [send, draft, pollRevision]);

  async function run(action, work) {
    if (submitLock.current) return;
    submitLock.current = true;
    setPending(action);
    setError('');
    setMessage('');
    try { await work(); }
    catch (err) {
      if (err.status === 409 && action === 'publish') setReviewed({});
      setError(problem(err));
    } finally { submitLock.current = false; setPending(''); }
  }

  async function fetchCandidates(filters, page = 1, loaded = 0) {
    const result = await send('/candidates', { method: 'POST', timeoutMs: 45_000, data: { ...filters, page } });
    const seen = new Set([...candidates.map(item => item.photoId), ...excluded]);
    const photos = result.photos.filter(item => !seen.has(item.photoId));
    setCandidates(prev => [...prev, ...photos]);
    setCandidateSearch({ filters, total: result.total, loaded: loaded + result.photos.length, nextPage: result.nextPage,
      contentFilter: result.contentFilter, searchId: result.searchId });
    if (result.selectionLimited) setMessage(photos.length ? 'AI 暂未返回结果，当前候选按现有资料匹配。' : 'AI 暂未返回结果，现有资料中没有匹配照片。');
    else if (page === 1 && !photos.length) setMessage('没有新的匹配照片。');
  }
  function search() {
    const seen = new Set([...candidates.map(item => item.photoId), ...excluded]);
    return run('ai', () => fetchCandidates({ mode: 'ai', query, exclude: [...seen].slice(-500), capture: true }));
  }
  function addFromStation(source) {
    if (batchRunning) return;
    return run('station', async () => {
      const isBatch = source === 'all';
      const seen = new Set([...candidates.map(item => item.photoId), ...(isBatch ? excluded : [])]);
      const photoIds = stationPhotoIds(getStationItems())
        .filter(id => !seen.has(id) && (isBatch || String(id) === source));
      if (!photoIds.length) {
        setMessage('中转站没有新的照片可添加。');
        return;
      }
      const { photos, skipped } = await send('/candidates/from-station', { method: 'POST', data: { photoIds } });
      setCandidates(prev => [...prev, ...photos]);
      if (!isBatch && photos.length) setExcluded(prev => prev.filter(id => id !== photos[0].photoId));
      setMessage(photos.length
        ? `已从中转站添加 ${photos.length} 张${skipped ? `，另有 ${skipped} 张不符合供图范围` : ''}。`
        : '没有可添加的照片：已发布、被限制或不在供图范围内。');
    });
  }
  function handleStationDragOver(event) {
    if (!isStationDrag(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = busy ? 'none' : 'copy';
    setStationDragOver(!busy);
  }
  function handleStationDrop(event) {
    setStationDragOver(false);
    if (!isStationDrag(event)) return;
    event.preventDefault();
    addFromStation(event.dataTransfer.getData(STATION_PHOTO_DRAG_TYPE));
  }
  function moreCandidates() {
    if (!candidateSearch?.nextPage) return;
    // Keep the first request's exclusions fixed so loading or dismissing cards cannot shift the offset.
    const filters = candidateSearch.searchId ? { searchId: candidateSearch.searchId } : candidateSearch.filters;
    return run('candidate-page', () => fetchCandidates(filters, candidateSearch.nextPage, candidateSearch.loaded));
  }
  async function fetchPublished(after) {
    const page = await send('/published', { data: { limit: LIMIT, ...(after ? { after } : {}) } });
    setPublished(prev => ({ ...page, photos: after ? [...prev.photos, ...page.photos] : page.photos }));
  }
  function changeView(next) {
    if (submitLock.current || view === next) return;
    setView(next);
    setMessage('');
    setError('');
    if (next === 'published') run('list', () => fetchPublished());
  }
  function dismiss(photoId) {
    setCandidates(items => items.filter(item => item.photoId !== photoId));
    setExcluded(items => [...items, photoId]);
    setReviewed(prev => {
      const next = { ...prev };
      delete next[photoId];
      return next;
    });
  }
  function nextCandidate(item) {
    return candidates.find(candidate => candidate.photoId !== item.photoId && !reviewed[candidate.photoId]);
  }
  function confirm(data) {
    const next = nextCandidate(preview.item);
    setReviewed(prev => ({ ...prev, [data.photoId]: data.review }));
    setPreview(next ? { item: next } : null);
  }
  function publish() {
    return run('publish', async () => {
      const photos = ready.slice(0, LIMIT).map(item => ({ photoId: item.photoId, review: reviewed[item.photoId] }));
      await send('/publish', { method: 'POST', data: { photos, publicationMode: ORIGINAL_MODE } });
      const ids = new Set(photos.map(item => item.photoId));
      setCandidates(items => items.filter(item => !ids.has(item.photoId)));
      setReviewed(prev => Object.fromEntries(Object.entries(prev).filter(([key]) => !ids.has(Number(key)))));
      // Publishing removes rows from the searchable pool; the current offsets no longer apply.
      setCandidateSearch(null);
      setMessage(`已发布 ${photos.length} 张照片。`);
    });
  }
  function startBatch(job) {
    knownBatch.current = job.id;
    setBatchOpen(false);
    setMessage('');
    setError('');
    setBatch(job);
    restartPolling();
  }
  function stopBatch() {
    return run('batch-cancel', async () => {
      const { job } = await send(`/bulk/${batch.id}/cancel`, { method: 'POST' });
      if (job) { setBatch(job); restartPolling(); }
    });
  }
  function withdraw() {
    const id = retract.id;
    setRetract(null);
    return run('withdraw', async () => {
      await send(`/published/${id}`, { method: 'DELETE' });
      setPublished(prev => ({ ...prev, photos: prev.photos.filter(item => item.id !== id) }));
      setMessage('已撤回照片。');
    });
  }

  return <section className="college-window" aria-labelledby="college-window-title">
    <header className="college-window-header">
      <h1 id="college-window-title">学院窗供图</h1>
      <nav className="college-window-tabs" aria-label="学院窗">
        <button type="button" aria-pressed={view === 'review'} disabled={Boolean(pending)} onClick={() => changeView('review')}>选图确认</button>
        <button type="button" aria-pressed={view === 'published'} disabled={Boolean(pending)} onClick={() => changeView('published')}>已发布</button>
      </nav>
    </header>

    {view === 'review' && <div className="college-window-search">
      <label htmlFor="college-window-query">选图需求</label>
      <textarea id="college-window-query" rows={2} value={query} maxLength={160}
        placeholder="最近三个月的校园活动，选 10 张有现场感的照片"
        onChange={event => setQuery(event.target.value)} />
      <div className="college-window-actions">
        <Button type="primary" icon={<IconSparkleAI />} loading={pending === 'ai'} onClick={search}
          disabled={!query.trim() || busy}>{candidates.length ? 'AI 补选' : 'AI 选图'}</Button>
      </div>
    </div>}

    <div className="college-window-section-head">
      <h2>{view === 'review' ? '候选照片' : '供图列表'} <span>{view === 'review' ? candidates.length : published.photos.length}</span></h2>
      {view === 'review' ? <div className="college-window-actions">
        {ready.length > LIMIT && <span className="college-window-secondary">已确认 {ready.length} 张</span>}
        {!!ready.length && <Button type="secondary" disabled={busy} loading={pending === 'publish'} onClick={publish}>
          发布 {Math.min(LIMIT, ready.length)} 张
        </Button>}
        <Button type="primary" disabled={busy || (!candidates.length && !candidateSearch?.searchId)}
          onClick={() => setBatchOpen(true)}>批量发布</Button>
      </div> : <Button type="secondary" disabled={Boolean(pending)} onClick={() => run('list', () => fetchPublished())}>刷新</Button>}
    </div>
    {batch && <BatchStatus job={batch} stopping={pending === 'batch-cancel'} onStop={stopBatch} />}
    {view === 'review' && <div className={`college-window-station${stationDragOver ? ' is-drag-over' : ''}`}
      role="group" aria-label="中转站照片"
      onDragOver={handleStationDragOver}
      onDragLeave={event => {
        if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setStationDragOver(false);
      }}
      onDrop={handleStationDrop}>
      <div className="college-window-station-label">
        <strong>{stationDragOver ? '松开以添加' : '中转站'}</strong>
        <span className="college-window-secondary">{stationIds.length} 张照片</span>
      </div>
      <Button type="secondary" icon={<IconPlus />} disabled={!stationIds.length || busy} loading={pending === 'station'}
        onClick={() => addFromStation('all')}>添加中转站照片</Button>
    </div>}
    {error && <p role="alert" className="college-window-error">{error}</p>}
    {view === 'review' && candidateSearch?.total > 0 && <p role="status" className="college-window-message">
      本轮匹配 {candidateSearch.total} 张，已加载 {candidateSearch.loaded} 张
      {candidateSearch.contentFilter ? ' · 按图库标注初筛' : ''}
    </p>}
    {message && <p role="status" className="college-window-message">{message}</p>}
    {view === 'review' ? (candidates.length ? <div className="college-window-grid">
      {candidates.map(item => <article key={item.photoId} className="college-window-tile">
        <button type="button" className="college-window-tile-preview" aria-label={`预览 ${item.albumName || '未归类照片'}`}
          disabled={busy} onClick={() => setPreview({ item })}>
          <span className="college-window-tile-media">
            {item.thumbUrl ? <img src={resolveAssetUrl(item.thumbUrl)} loading="lazy" alt="" /> : <span>无缩略图</span>}
          </span>
        </button>
        <div className="college-window-tile-label">
          <div><strong>{item.albumName || '未提供相册名'}</strong>
            <span className={reviewed[item.photoId] ? 'college-window-confirmed' : 'college-window-secondary'}>
              {reviewed[item.photoId] ? '已确认' : '待确认'}
            </span>
          </div>
          <button type="button" className="college-window-icon" title="排除候选" aria-label="排除候选"
            disabled={busy} onClick={() => dismiss(item.photoId)}><IconClose /></button>
        </div>
      </article>)}
    </div> : <p className="college-window-empty" role="status">{pending ? '正在找图…' : '暂无候选照片'}</p>) :
      (published.photos.length ? <div className="college-window-grid">
        {published.photos.map(item => <article key={item.id} className="college-window-tile">
          <button type="button" className="college-window-tile-preview" aria-label={`预览已发布照片 ${item.albumName || ''}`}
            onClick={() => setPreview({ item })}>
            <PublishedThumb send={send} item={item} />
          </button>
          <div className="college-window-tile-label">
            <div><strong>{item.albumName || '未提供相册名'}</strong>
              <time className="college-window-secondary">{new Date(item.publishedAt).toLocaleDateString('zh-CN')}</time>
            </div>
            <div className="college-window-published-actions">
              {item.publicImagePath && <button type="button" className="college-window-icon" title="复制原图链接"
                aria-label="复制原图链接" onClick={() => copyPublicImage(item.publicImagePath)}><IconShare /></button>}
              <button type="button" className="college-window-text-button" disabled={Boolean(pending)} onClick={() => setRetract(item)}>撤回</button>
            </div>
          </div>
        </article>)}
      </div> : <p className="college-window-empty" role="status">{pending ? '正在读取…' : '暂无已发布照片'}</p>)}
    {view === 'review' && candidateSearch?.nextPage && <div className="college-window-footer">
      <Button type="secondary" disabled={busy} loading={pending === 'candidate-page'}
        icon={<IconChevronRight />} onClick={moreCandidates}>加载更多候选</Button>
    </div>}
    {view === 'published' && published.nextCursor && <div className="college-window-footer">
      <Button type="secondary" disabled={Boolean(pending)} icon={<IconChevronRight />}
        onClick={() => run('list', () => fetchPublished(published.nextCursor))}>加载更多</Button>
    </div>}
    {preview && <Preview key={preview.item.id || preview.item.photoId}
      send={send} preview={preview} close={() => setPreview(null)} onConfirm={confirm} hasNext={Boolean(nextCandidate(preview.item))} />}
    {batchOpen && <BulkDialog send={send} candidates={candidates} excluded={excluded} search={candidateSearch}
      close={() => setBatchOpen(false)} onStart={startBatch} />}
    {retract && <Modal visible title="撤回这张照片？" okText="撤回照片" onCancel={() => setRetract(null)} onOk={withdraw}>
      {retract.publicImagePath ? '分享链接撤回后失效，已打开的临时下载地址最多还可用 1 分钟。' : '对接方将无法继续获取这张照片。'}已被下载的副本不会被删除。
    </Modal>}
  </section>;
}
