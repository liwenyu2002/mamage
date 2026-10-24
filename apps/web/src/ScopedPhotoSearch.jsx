import React from 'react';
import { Button } from './ui';
import { IconSparkleAI, IconSimilarStack } from './ui/icons';
import SearchFeedback, { SearchSkeleton } from './SearchFeedback';
import { searchPhotos } from './services/photoQueryService';
import './scopedPhotoSearch.css';

export default function ScopedPhotoSearch({ query, folderId, scopeName, unitId, onOpen, children }) {
  const [state, setState] = React.useState({ list: [], loading: true, phase: 'starting' });
  const [revision, refresh] = React.useReducer(value => value + 1, 0);
  const [related, setRelated] = React.useState(false);
  const requestRef = React.useRef(null);
  const stateRef = React.useRef(state);
  stateRef.current = state;

  const load = React.useCallback(async (page = 1) => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    const base = page > 1 ? stateRef.current.list : [];
    const current = () => !controller.signal.aborted && requestRef.current === controller;
    setState({ list: base, loading: true, phase: 'starting', page, search: null });
    const accept = response => {
      if (!current()) return;
      if (folderId && (response.search?.scope?.type !== 'folder' || response.search.scope.id !== folderId)) {
        throw new Error('检索服务未确认当前文件夹范围。');
      }
      const list = [...new Map([...base, ...(response.list || [])].map(photo => [String(photo.id), photo])).values()];
      setState(old => ({ ...old, list, total: response.total, hasMore: response.hasMore, search: response.search }));
    };
    try {
      const response = await searchPhotos({ q: query, folderId, page, pageSize: 24, smart: true, related,
        headers: { 'x-mamage-unit-id': unitId ? String(unitId) : 'legacy' }, signal: controller.signal,
        onProgress: event => {
          if (!current()) return;
          if (event.type === 'results') { accept(event.data); setState(old => ({ ...old, phase: 'receiving' })); }
          else if (event.type === 'status') setState(old => ({ ...old, phase: event.phase, search: event.search || old.search }));
        } });
      if (!current()) return;
      accept(response);
      setState(old => ({ ...old, loading: false, phase: 'complete' }));
    } catch (error) {
      if (!current()) return;
      const denied = [401, 403, 404].includes(Number(error.status));
      setState(old => ({ ...old, ...(denied ? { list: [], search: null } : {}), loading: false, phase: 'error', hasMore: false,
        error: denied ? '检索范围已变化或无权访问，请重新打开文件夹。' : '检索暂时中断，请重试。' }));
    }
  }, [query, folderId, unitId, related]);

  React.useEffect(() => {
    void load();
    return () => requestRef.current?.abort();
  }, [load, revision]);

  return <section className="scoped-search" aria-label="文件夹智能检索结果" aria-busy={state.loading}>
    <div className="scoped-search-heading"><div><IconSparkleAI /><strong>{scopeName || '小组空间'}</strong>
      <span>{folderId ? '本文件夹及子文件夹' : '当前小组'}</span></div>
      {Number.isFinite(state.total) && <span>{state.total} 张结果</span>}</div>
    {children}
    {state.search?.chips?.length > 0 && <div className="scoped-search-chips" aria-label="智能搜索理解结果">
      {state.search.chips.map(chip => <span key={chip}>{chip}</span>)}
    </div>}
    <SearchFeedback search={state.search} loading={state.loading} phase={state.phase} found={state.list.length}
      onRefresh={refresh} onRelated={() => setRelated(true)} onStrict={() => setRelated(false)} />
    {state.error && <div className="scoped-search-error" role="alert">{state.error}<Button onClick={refresh}>重试</Button></div>}
    {state.loading && !state.list.length && <SearchSkeleton />}
    {!state.loading && !state.error && !state.list.length && <p className="scoped-search-empty">
      {state.search?.visual && !state.search.visual.coverageComplete ? '暂未确认符合条件的照片' : '此范围内没有匹配的照片'}
    </p>}
    <div className="scoped-search-grid">{state.list.map((photo, index) => <button type="button" key={photo.id}
      className="scoped-search-photo search-result-enter" style={{ '--search-order': index % 8 }}
      onClick={() => onOpen({ id: photo.projectId }, { photoId: photo.id, src: photo.thumbUrl || photo.url })}
      aria-label={`打开照片 ${photo.title || photo.id}`}>
      <div className="scoped-search-image">{photo.thumbUrl || photo.url ? <img src={photo.thumbUrl || photo.url}
        alt={photo.description || photo.title || ''} loading="lazy" decoding="async" /> : <IconSimilarStack />}</div>
      <span className="scoped-search-photo-meta"><strong>{photo.projectName || '相册'}</strong>
        <span>{photo.timelineSectionName || photo.photographerName || (photo.type === 'video' ? '视频' : '照片')}</span></span>
    </button>)}</div>
    {state.hasMore && <div className="scoped-search-more"><Button disabled={state.loading} loading={state.loading}
      onClick={() => load((state.page || 1) + 1)}>加载更多</Button></div>}
  </section>;
}
