import React from 'react';
import { Button } from './ui';
import { IconSearch, IconPlus, IconChevronLeft, IconChevronRight, IconDownload, IconClose } from './ui/icons';
import { request } from './services/request';
import { sanitizeRawHtml } from './wechat/docModel';
import './wechatMonitor.css';

const statusLabels = { pending: '等待处理', running: '处理中', retry: '延迟重试', succeeded: '完成', blocked: '来源受限', failed: '失败',
  skipped: '不在回溯范围',
  watching: '目录检查中', needs_source: '待接入来源', stale: '待重新分析', ready: '已分析', candidate: '系列候选', supported: '多篇支持' };
const kinds = { discover: '发现文章', fetch: '逆向采集', analyze: '文风分析', summarize: '关联总结', regroup: '更新分类' };
const time = value => value ? new Date(Number(value)).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) : '尚无记录';
function errorMessage(error) { try { return JSON.parse(error.body).message || error.message; } catch { return error.message || '读取失败'; } }
function Evidence({ values = [] }) { return <div className="wxm-evidence">{values.map((value, index) => <blockquote key={index}>{value}</blockquote>)}</div>; }
function Learning({ analysis, dimensions = {} }) {
  if (!analysis) return <p className="wxm-empty">尚未完成文风分析</p>;
  return <div className="wxm-learning">
    <p className="wxm-summary">{analysis.summary}</p>
    {Object.entries(analysis.dimensions || {}).map(([key, item]) => <section key={key}><h3>{dimensions[key] || key}</h3>
      {item.notObserved ? <span className="wxm-tag">未观察到或资料不足</span> : null}
      <p>{item.finding}</p><Evidence values={item.evidence} />
      {Object.keys(item.metrics || {}).length ? <details className="wxm-metrics"><summary>HTML/CSS 指标证据</summary><pre>{JSON.stringify(item.metrics, null, 2)}</pre></details> : null}</section>)}
    <section><h3>可迁移写法</h3>{analysis.lessons?.map((item, index) => <div className="wxm-lesson" key={index}>
      <strong>{item.principle}</strong><p>{item.application}</p><p className="wxm-muted">边界：{item.caveat}</p><Evidence values={item.evidence} />
    </div>)}</section>
    <p className="wxm-muted">{analysis.visualLimitation}；结论仅代表已收录样本。</p>
  </div>;
}
function ArticleDetail({ article, dimensions, onBack, onArticle }) {
  const [view, setView] = React.useState('analysis');
  const source = React.useMemo(() => {
    const safe = sanitizeRawHtml((article.blocks || []).join(''));
    return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: data: ${location.origin}; style-src 'unsafe-inline'; base-uri ${location.origin}; form-action 'none'"><base href="${location.origin}/"><style>body{margin:16px auto;max-width:677px;overflow-wrap:anywhere;font:16px/1.8 sans-serif}img{max-width:100%;height:auto}</style></head><body>${safe}</body></html>`;
  }, [article.id, article.revisionId]);
  return <div className="wxm-detail">
    <div className="wxm-detail-heading"><Button size="small" theme="borderless" icon={<IconChevronLeft />} onClick={onBack}>返回</Button>
      <a href={article.sourceUrl} target="_blank" rel="noopener noreferrer">微信原文</a></div>
    <h2>{article.title}</h2><p className="wxm-muted">{article.author} · {article.metadata?.datePrecision === 'day' ? time(article.publishedAt).split(' ')[0] : time(article.publishedAt)} · {article.identityStatus === 'biz_verified' ? '公众号标识匹配' : '公众号名称匹配'}</p>
    <nav className="wxm-tabs" aria-label="文章研究视图">{[['analysis', '文风研究'], ['original', '逆向原文'], ['related', `相似文章 ${article.relations.length}`]].map(([key, name]) =>
      <button type="button" key={key} aria-current={view === key ? 'page' : undefined} onClick={() => setView(key)}>{name}</button>)}</nav>
    {view === 'analysis' ? <>{article.analysisState === 'stale' ? <p role="status" className="wxm-notice">原文已更新，下方为上一版分析，重新分析尚未完成。</p> : null}
      {article.analysisError ? <p role="alert" className="wxm-error">{['pending', 'running', 'retry'].includes(article.analysisState) ? '上次分析未完成：' : '分析未完成：'}{article.analysisError.message} · {article.analysisError.code}</p> : null}
      <Learning analysis={article.analysis} dimensions={dimensions} /></> : null}
    {view === 'original' ? <><p className="wxm-muted">{article.blocks.length} 个内容块 · {article.styleBlocks.length} 个可复用样式 · 版本 {article.revisionId}</p>
      <iframe className="wxm-original" title="逆向文章预览" sandbox="" referrerPolicy="no-referrer" srcDoc={source} /></> : null}
    {view === 'related' ? article.relations.length ? <div>{article.relations.map(item => <section className="wxm-relation" key={item.id}>
      <button type="button" onClick={() => onArticle(item.id)}>{item.title}<IconChevronRight /></button>
      <span className="wxm-tag">{item.evidence?.kind === 'topic_only' ? '事实或题材相近，非通用写法' : '写作手法关联'}</span>
      <p>{item.summary}</p><Evidence values={[...(item.evidence?.low || []), ...(item.evidence?.high || [])]} />
    </section>)}</div> : <p className="wxm-empty">尚无经过双篇证据核验的关联</p> : null}
  </div>;
}
export default function WechatMonitor({ workspaceId }) {
  const api = React.useCallback((path, options = {}) => request('/api/wechat-monitor' + path, { ...options,
    headers: { 'X-Mamage-Unit-Id': workspaceId ? String(workspaceId) : 'legacy', ...options.headers } }), [workspaceId]);
  const [overview, setOverview] = React.useState(null), [tab, setTab] = React.useState('articles');
  const [accountId, setAccountId] = React.useState(''), [scene, setScene] = React.useState(''), [query, setQuery] = React.useState('');
  const [search, setSearch] = React.useState(''), [page, setPage] = React.useState(1), [refresh, setRefresh] = React.useState(0);
  const [jobStatus, setJobStatus] = React.useState('');
  const [jobCursors, setJobCursors] = React.useState([null]);
  const [items, setItems] = React.useState([]), [hasMore, setHasMore] = React.useState(false), [loading, setLoading] = React.useState(true);
  const [listTab, setListTab] = React.useState('articles');
  const [detailId, setDetailId] = React.useState(null), [article, setArticle] = React.useState(null), [group, setGroup] = React.useState(null);
  const [error, setError] = React.useState(''), [busy, setBusy] = React.useState(false), [notice, setNotice] = React.useState('');
  const [importing, setImporting] = React.useState(false), [links, setLinks] = React.useState(''), [importAccount, setImportAccount] = React.useState('');
  const [eventsFor, setEventsFor] = React.useState(null), [events, setEvents] = React.useState(null);
  const [dataRevision, setDataRevision] = React.useState(0);
  const lastListRequest = React.useRef(null);
  React.useEffect(() => {
    const controller = new AbortController(); let running = false, lastSignature = null, overviewFailed = false;
    const load = async () => {
      if (running || document.hidden) return; running = true;
      try {
        const result = await api('/overview', { signal: controller.signal });
        if (!controller.signal.aborted) {
          const signature = JSON.stringify([result.accounts.map(item => [item.id, item.articleCount, item.analyzedCount, item.identityVerified]), result.jobs]);
          if (overviewFailed || lastSignature !== null && signature !== lastSignature) setDataRevision(value => value + 1);
          if (overviewFailed) setError('');
          overviewFailed = false;
          lastSignature = signature; setOverview(result);
        }
      }
      catch (failure) { if (!controller.signal.aborted) { overviewFailed = true; setError(errorMessage(failure)); } }
      finally { running = false; }
    };
    load(); const timer = setInterval(load, 15000);
    return () => { clearInterval(timer); controller.abort(); };
  }, [api, refresh]);
  React.useEffect(() => {
    const controller = new AbortController(); setError('');
    let path = tab === 'articles' ? '/articles?' + new URLSearchParams({ page, ...(accountId ? { accountId } : {}), ...(scene ? { scene } : {}), ...(search ? { q: search } : {}) })
      : tab === 'groups' ? '/groups' : '/jobs?' + new URLSearchParams({ ...(accountId ? { accountId } : {}), ...(jobStatus ? { status: jobStatus } : {}),
        ...(jobCursors[page - 1] ? { before: jobCursors[page - 1] } : {}) });
    if (lastListRequest.current?.api !== api || lastListRequest.current?.path !== path) setLoading(true);
    lastListRequest.current = { api, path };
    api(path, { signal: controller.signal }).then(result => { if (!controller.signal.aborted) { setItems(result.items); setListTab(tab); setHasMore(Boolean(result.hasMore)); } })
      .catch(failure => { if (!controller.signal.aborted) { setItems([]); setError(errorMessage(failure)); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [api, tab, accountId, scene, search, page, jobStatus, jobCursors, refresh, dataRevision]);
  React.useEffect(() => { setDetailId(null); setArticle(null); setGroup(null); setItems([]); setOverview(null); setAccountId(''); setScene('');
    setPage(1); setJobCursors([null]); setEventsFor(null); }, [api]);
  React.useEffect(() => { setArticle(null); setGroup(null); }, [api, tab, detailId]);
  React.useEffect(() => {
    if (!detailId) return undefined;
    const controller = new AbortController(); setError('');
    api(`/${tab === 'groups' ? 'groups' : 'articles'}/${detailId}`, { signal: controller.signal }).then(result => {
      if (!controller.signal.aborted) (tab === 'groups' ? setGroup : setArticle)(result);
    }).catch(failure => { if (!controller.signal.aborted) setError(errorMessage(failure)); });
    return () => controller.abort();
  }, [api, tab, detailId, refresh, dataRevision]);
  React.useEffect(() => {
    if (!eventsFor || tab !== 'jobs') return undefined;
    const controller = new AbortController(); setEvents(null);
    api(`/jobs/${eventsFor}/events`, { signal: controller.signal }).then(result => { if (!controller.signal.aborted) setEvents(result.items); })
      .catch(failure => { if (!controller.signal.aborted) setError(errorMessage(failure)); });
    return () => controller.abort();
  }, [api, eventsFor, tab, refresh, dataRevision]);
  const mutate = async (path, data, message, method = 'POST') => {
    if (busy) return false; setBusy(true); setError(''); setNotice('');
    try { await api(path, { method, data }); setNotice(message); setRefresh(value => value + 1); return true; }
    catch (failure) { setError(errorMessage(failure)); return false; }
    finally { setBusy(false); }
  };
  const pending = overview?.jobs.filter(item => ['pending', 'retry', 'running'].includes(item.status)).reduce((sum, item) => sum + Number(item.count), 0) || 0;
  const blocked = overview?.jobs.filter(item => ['blocked', 'failed'].includes(item.status)).reduce((sum, item) => sum + Number(item.count), 0) || 0;
  const rows = listTab === tab && !loading ? items : [];
  return <div className="wxm" aria-label="推文监控与学习">
    <header className="wxm-heading"><div><h1>推文观察</h1><span>{overview?.accounts.reduce((sum, item) => sum + item.articleCount, 0) || 0} 篇已入库 · {pending} 项待处理 · {blocked} 项受限或失败</span></div>
      <div className="wxm-heading-actions"><Button size="small" theme="borderless" onClick={() => setRefresh(value => value + 1)}>刷新</Button>
        {overview?.canManage ? <Button size="small" icon={<IconDownload />} disabled={busy || !overview.accounts.length} onClick={() => { setImportAccount(accountId || String(overview.accounts[0].id)); setImporting(true); }}>导入原文链接</Button> : null}</div></header>
    {error ? <p role="alert" className="wxm-error">{error}</p> : null}
    {notice ? <p role="status" className="wxm-notice">{notice}</p> : null}
    {overview && !overview.engineEnabled ? <p className="wxm-notice" role="status">后台监控尚未启用，已入库文章仍可查看。</p> : null}
    {overview && !overview.accounts.length ? <div className="wxm-empty"><p>尚未添加监控目标</p>{overview.canManage ? <Button icon={<IconPlus />} disabled={busy}
      onClick={() => mutate('/bootstrap', {}, '已添加哈工大、北京中关村学院；历史起点为 2024-01-01')}>添加两个目标公众号</Button> : null}</div> : null}
    <div className="wxm-sources">{overview?.accounts.map(item => <section className="wxm-source" key={item.id}>
      <div className="wxm-source-line"><strong>{item.name}</strong><span className="wxm-tag">{item.enabled ? statusLabels[item.state] || '待检查' : '已暂停'}</span>
        {overview.canManage ? <label className="wxm-toggle"><input aria-label={`启用${item.name}监控`} type="checkbox" checked={item.enabled} disabled={busy}
          onChange={async event => {
            const enabled = event.target.checked;
            setOverview(previous => ({ ...previous, accounts: previous.accounts.map(row => row.id === item.id ? { ...row, enabled } : row) }));
            if (!await mutate(`/accounts/${item.id}`, { enabled }, enabled ? '监控已启用' : '监控已暂停', 'PATCH')) {
              setOverview(previous => ({ ...previous, accounts: previous.accounts.map(row => row.id === item.id ? { ...row, enabled: item.enabled } : row) }));
            }
          }} /></label> : null}</div>
      <div className="wxm-source-stats"><b>{item.articleCount}</b> 篇 · 已分析 {item.analyzedCount} · 候选链接 {item.candidateLinks || 0} · 起点 {item.since}</div>
      <p className="wxm-muted">{item.identityVerified ? '公众号标识已交叉核验' : '公众号名称匹配，标识待核验'}</p>
      <p className="wxm-muted">已收录范围：{item.earliestAt ? time(item.earliestAt).split(' ')[0] + ' 至 ' + time(item.latestAt).split(' ')[0] : '尚未核验到正文'} · 历史完整性未知</p>
      {item.restrictedFetches ? <p className="wxm-source-error">{item.restrictedFetches} 项正文任务受限或失败，目录检查正常不代表正文已收录。</p> : null}
      <div className="wxm-source-links"><span>每 {Math.round(item.intervalSeconds / 60)} 分钟 · 检查于 {time(item.lastCheckedAt)}</span><a href={item.sogou.url} target="_blank" rel="noopener noreferrer">搜狗人工检索</a>
        {overview.canManage ? <button type="button" disabled={busy || !item.enabled} onClick={() => mutate(`/accounts/${item.id}/check`, {}, '已安排官网目录检查')}>检查更新</button> : null}</div>
      {item.error ? <p className="wxm-source-error">{item.error}</p> : null}
      <details className="wxm-coverage"><summary>历史覆盖台账</summary><div>{item.monthlyCoverage.map(month => <span key={month.from} data-state={month.state}>
        {month.from.slice(0, 7)}<small>{month.count ? `已收录 ${month.count} 篇` : '尚未核验'}</small></span>)}</div></details>
    </section>)}</div>
    {overview?.accounts.length ? <p className="wxm-source-policy">搜狗自动采集受 robots 与用户协议限制；后台使用官网公开目录发现微信链接。微信验证页、未知日期与身份不符都会单独记录，不算已收齐。</p> : null}
    {importing ? <section className="wxm-import" aria-label="导入微信原文链接"><div className="wxm-source-line"><h2>导入微信原文链接</h2><Button theme="borderless" size="small" icon={<IconClose />} aria-label="关闭导入链接" onClick={() => setImporting(false)} /></div>
      <select aria-label="导入目标公众号" value={importAccount} onChange={event => setImportAccount(event.target.value)}>{overview?.accounts.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
      <textarea aria-label="微信原文链接" value={links} onChange={event => setLinks(event.target.value)} rows={4} placeholder="https://mp.weixin.qq.com/s/…" />
      <Button size="small" icon={<IconDownload />} disabled={busy || !links.trim()} onClick={async () => {
        const urls = links.split(/\s+/).filter(Boolean);
        if (await mutate(`/accounts/${importAccount}/import`, { urls }, '链接已进入后台核验与逆向采集队列')) { setImporting(false); setLinks(''); }
      }}>加入采集队列</Button></section> : null}
    {overview?.accounts.length ? <>
      <div className="wxm-toolbar"><nav className="wxm-tabs" aria-label="推文学习视图">{[['articles', '文章'], ['groups', '系列与场景'], ['jobs', '后台任务']].map(([key, label]) =>
        <button type="button" key={key} aria-current={tab === key ? 'page' : undefined} onClick={() => { setTab(key); setDetailId(null); setPage(1); setJobCursors([null]); setEventsFor(null); }}>{label}</button>)}</nav>
        {tab !== 'groups' ? <select aria-label="筛选公众号" value={accountId} onChange={event => { setAccountId(event.target.value); setDetailId(null); setPage(1); setJobCursors([null]); setEventsFor(null); }}><option value="">全部公众号</option>{overview.accounts.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select> : null}
        {tab === 'jobs' ? <select aria-label="筛选任务状态" value={jobStatus} onChange={event => { setJobStatus(event.target.value); setPage(1); setJobCursors([null]); setEventsFor(null); }}><option value="">全部状态</option>{['pending', 'running', 'retry', 'succeeded', 'blocked', 'failed', 'skipped'].map(value => <option key={value} value={value}>{statusLabels[value]}</option>)}</select> : null}
        {tab === 'articles' ? <><select aria-label="筛选场景" value={scene} onChange={event => { setScene(event.target.value); setDetailId(null); setPage(1); }}><option value="">全部场景</option>{Object.entries(overview.scenes).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
          <form onSubmit={event => { event.preventDefault(); setSearch(query.trim()); setPage(1); }}><input aria-label="搜索已收录文章" placeholder="搜索文章" value={query} onChange={event => setQuery(event.target.value)} /><button aria-label="搜索文章" title="搜索文章" type="submit"><IconSearch /></button></form></> : null}
      </div>
      <div className={`wxm-body ${detailId ? 'has-detail' : ''}`}>
        <div className="wxm-results">{loading ? <p role="status" className="wxm-empty">正在读取…</p> : !rows.length ? <p className="wxm-empty">{tab === 'articles' ? '尚无已核验入库的文章' : tab === 'groups' ? '有文章分析完成后，会出现系列候选与场景分类' : '尚无后台任务'}</p> : null}
          {tab === 'articles' ? rows.map(item => <button key={item.id} type="button" className="wxm-article-row" aria-pressed={detailId === item.id} onClick={() => setDetailId(item.id)}>
            <div><span className="wxm-muted">{item.author} · {time(item.publishedAt).split(' ')[0]}</span><span className="wxm-tag">{statusLabels[item.analysisState]}</span></div>
            <h2>{item.title}</h2><p>{item.summary || (['failed', 'blocked'].includes(item.analysisState) ? '分析未完成，可在后台任务查看原因'
              : item.analysisState === 'running' ? '后台正在分析文风与结构' : '等待分析文风与结构')}</p>{item.scene ? <small>{overview.scenes[item.scene]}</small> : null}
          </button>) : null}
          {tab === 'groups' ? rows.map(item => <button key={item.id} type="button" className="wxm-group-row" aria-pressed={detailId === item.id} onClick={() => setDetailId(item.id)}>
            <span className="wxm-tag">{item.kind === 'series' ? statusLabels[item.state] : '场景分类'}</span><h2>{item.name}</h2><span>{item.count} 篇已收录样本</span>
            <p>{item.summary?.summary || (item.state === 'candidate' ? '等待另一篇独立文章交叉核验' : '关联总结等待后台处理')}</p>
          </button>) : null}
          {tab === 'jobs' ? <div className="wxm-jobs">{rows.map(item => <div key={item.id} className="wxm-job-row"><div><strong>{kinds[item.kind]}</strong><span className={`wxm-tag is-${item.status}`}>{statusLabels[item.status]}</span><small>#{item.id} · {item.attempts} 次执行</small></div>
            {item.sourceOrigin ? <p className="wxm-muted">{item.sourceOrigin}</p> : null}
            {item.error ? <p>{item.error}{item.errorCode ? <small> · {item.errorCode}</small> : null}</p> : null}{item.status === 'retry' ? <small>下次重试 {time(item.nextRunAt)}</small> : null}
            <button type="button" aria-expanded={eventsFor === item.id} onClick={() => setEventsFor(previous => previous === item.id ? null : item.id)}>执行记录</button>
            {eventsFor === item.id ? events ? <ol className="wxm-events">{events.map((event, index) => <li key={index}>
              <span>第 {event.attempt} 次 · {statusLabels[event.status]} · {time(event.createdAt)}</span>{event.error ? <p>{event.error}</p> : null}
            </li>)}</ol> : <p role="status">正在读取执行记录…</p> : null}
            {overview.canManage && ['failed', 'blocked'].includes(item.status) ? <button type="button" disabled={busy} onClick={() => mutate(`/jobs/${item.id}/retry`, {}, '已安排重新检查；来源仍受限时将再次记录并停止')}>重新检查</button> : null}
          </div>)}</div> : null}
          {tab === 'articles' && (hasMore || page > 1) ? <div className="wxm-pagination"><Button size="small" aria-label="上一页文章" icon={<IconChevronLeft />} disabled={page <= 1} onClick={() => setPage(value => value - 1)} />
            <span>{page}</span><Button size="small" aria-label="下一页文章" icon={<IconChevronRight />} disabled={!hasMore} onClick={() => setPage(value => value + 1)} /></div> : null}
          {tab === 'jobs' && (hasMore || page > 1) ? <div className="wxm-pagination">
            <Button size="small" aria-label="上一页任务" title="上一页任务" icon={<IconChevronLeft />} disabled={page <= 1 || loading}
              onClick={() => { setPage(value => Math.max(1, value - 1)); setEventsFor(null); }} />
            <span>{page}</span><Button size="small" aria-label="下一页任务" title="下一页任务" icon={<IconChevronRight />} disabled={!hasMore || loading || !rows.length}
              onClick={() => { setJobCursors(previous => [...previous.slice(0, page), rows.at(-1).id]); setPage(value => value + 1); setEventsFor(null); }} />
          </div> : null}
        </div>
        {detailId ? <div className="wxm-detail-wrap">{article ? <ArticleDetail key={article.id} article={article} dimensions={overview.dimensions} onBack={() => setDetailId(null)} onArticle={setDetailId} />
          : group ? <div className="wxm-detail"><Button size="small" theme="borderless" icon={<IconChevronLeft />} onClick={() => setDetailId(null)}>返回</Button><h2>{group.name}</h2>
            <p className="wxm-muted">{group.count} 篇已收录样本 · {group.state === 'candidate' || group.count < 2 ? '等待独立样本交叉核验'
              : group.summaryCurrent ? '总结与当前样本一致' : '总结等待更新'}</p>
            {group.summary ? <><p>{group.summary.summary}</p>{group.summary.patterns?.map((item, index) => <section key={index}><h3>{item.principle}</h3><p>{item.application}</p><p className="wxm-muted">边界：{item.caveat}</p>
              {item.support.map(support => <div key={support.articleId}><button type="button" className="wxm-inline-link" onClick={() => { setTab('articles'); setDetailId(support.articleId); }}>{group.members.find(member => member.id === support.articleId)?.title || `文章 ${support.articleId}`}</button><Evidence values={[support.quote]} /></div>)}</section>)}
              {group.summary.differences?.length ? <section><h3>差异与反例边界</h3>{group.summary.differences.map((item, index) => <p key={index}>{item}</p>)}</section> : null}</> : <p className="wxm-empty">尚未形成多篇证据支持的总结</p>}
            <section><h3>样本文章</h3>{group.members.map(item => <button className="wxm-inline-link" type="button" key={item.id} onClick={() => { setTab('articles'); setDetailId(item.id); }}>{item.title}</button>)}</section>
          </div> : <p role="status" className="wxm-empty">正在读取详情…</p>}</div> : null}
      </div>
    </> : null}
  </div>;
}
