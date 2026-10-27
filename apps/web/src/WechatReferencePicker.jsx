import React from 'react';
import { Button, Input, Modal } from './ui';
import { request } from './services/request';
import { referenceFindings } from './utils/wechatReferences';
import { IconChevronRight } from './ui/icons';

export default function WechatReferencePicker({ workspaceId, selected, onChange }) {
  const [open, setOpen] = React.useState(false), [query, setQuery] = React.useState(''), [search, setSearch] = React.useState('');
  const [page, setPage] = React.useState(1), [items, setItems] = React.useState([]), [hasMore, setHasMore] = React.useState(false);
  const [checked, setChecked] = React.useState([]), [busy, setBusy] = React.useState(false), [error, setError] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const headers = React.useMemo(() => ({ 'X-Mamage-Unit-Id': workspaceId ? String(workspaceId) : 'legacy' }), [workspaceId]);
  React.useEffect(() => {
    if (!open) return undefined;
    const controller = new AbortController(); setError(''); setItems([]); setLoading(true);
    const params = new URLSearchParams({ page, ...(search ? { q: search } : {}) });
    request(`/api/wechat-monitor/articles?${params}`, { headers, signal: controller.signal }).then(result => {
      if (!controller.signal.aborted) { setItems(result.items || []); setHasMore(Boolean(result.hasMore)); }
    }).catch(failure => { if (!controller.signal.aborted) { setItems([]); setError(failure.message || '参考文章暂不可用'); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [open, page, search, headers]);
  const begin = () => { setChecked((selected || []).map(item => item.id)); setOpen(true); };
  const confirm = async () => {
    if (busy) return; setBusy(true); setError('');
    try {
      const details = await Promise.all(checked.map(id => request(`/api/wechat-monitor/articles/${id}`, { headers })));
      if (details.some(item => item.analysisState !== 'ready' || !item.analysis?.summary)) throw Error('所选文章尚未完成分析，请选择已分析的文章');
      const values = details.map(item => ({ id: item.id, revisionId: item.revisionId, title: item.title, analysis: {
        summary: item.analysis.summary, lessons: (Array.isArray(item.analysis.lessons) ? item.analysis.lessons : [])
          .filter(lesson => lesson && typeof lesson.principle === 'string').map(lesson => ({
          principle: lesson.principle, application: lesson.application, caveat: lesson.caveat,
        })),
      } }));
      if (referenceFindings(values).length > 20000) throw Error('所选文章的写法总结超过 20000 字，请减少参考文章');
      onChange(values); setOpen(false);
    } catch (failure) { setError(failure.message || '读取参考文章失败'); }
    finally { setBusy(false); }
  };
  return <>
    <div className="news-reference-actions">
      <span className="mamage-field-label">参考文章</span>
      <button type="button" className="mamage-glass-select-trigger mamage-select-selection" aria-label="选择参考文章"
        aria-haspopup="dialog" aria-expanded={open} onClick={begin}>
        <span title={selected?.length ? selected.map(item => item.title).join('、') : '自动匹配相似文章'}>
          {selected?.length ? selected.map(item => item.title).join('、') : '自动匹配相似文章'}</span><IconChevronRight />
      </button>
    </div>
    <Modal title="选择参考文章" visible={open} onCancel={() => { if (!busy) setOpen(false); }} onOk={confirm} okText={busy ? '读取中' : '使用参考'}>
      <form className="news-reference-search" onSubmit={event => { event.preventDefault(); setPage(1); setSearch(query.trim()); }}>
        <Input aria-label="搜索参考文章" value={query} onChange={setQuery} placeholder="搜索标题" /><Button size="small" onClick={() => { setPage(1); setSearch(query.trim()); }}>搜索</Button>
      </form>
      {error ? <p className="news-input-error" role="alert">{error}</p> : null}
      <div className="news-reference-list">{loading ? <p role="status">正在读取参考文章</p> : items.map(item => <label key={item.id}>
        <input type="checkbox" disabled={item.analysisState !== 'ready'} checked={checked.includes(item.id)} onChange={event => {
          const checked = event.target.checked;
          setChecked(previous => checked ? [...previous, item.id] : previous.filter(id => id !== item.id));
        }} />
        <span><strong>{item.title}</strong><small>{item.author} · {item.analysisState === 'ready' ? '已分析' : '分析未完成'}</small></span>
      </label>)}{!loading && !items.length && !error ? <p>暂无参考文章</p> : null}</div>
      <div className="news-reference-pages"><Button size="small" disabled={page === 1} onClick={() => setPage(value => value - 1)}>上一页</Button>
        <span>{page}</span><Button size="small" disabled={!hasMore} onClick={() => setPage(value => value + 1)}>下一页</Button></div>
    </Modal>
  </>;
}
