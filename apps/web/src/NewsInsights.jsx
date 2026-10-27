import React from 'react';
import { Button } from './ui';
import { IconClose, IconSparkleAI } from './ui/icons';
import { request } from './services/request';
import { sanitizeRawHtml } from './wechat/docModel';

export function NewsInsights({ notes, references, referenceStatus, isGenerating, isCheckingFacts, onCheckFacts, onSupplement, onReference, selectedId, supplementLabel = '补充现场情况' }) {
  return <aside className="news-insights" aria-label="AI 建议补充">
    <div className="news-insights-heading"><IconSparkleAI /><h3>AI 建议补充</h3></div>
    {isGenerating ? <p className="news-insights-muted" role="status">新稿生成中，当前稿件保留</p> : null}
    {notes.length ? <ul className="news-insights-notes">{notes.map((note, index) => <li key={`${index}-${note}`}>{note}</li>)}</ul>
      : <p className="news-insights-muted">暂无补充建议</p>}
    <div className="news-insights-actions"><Button size="small" theme="borderless" onClick={onSupplement}>{supplementLabel}</Button>
      <Button size="small" theme="borderless" loading={isCheckingFacts} onClick={onCheckFacts}>核对当前稿</Button></div>
    <section className="news-insights-references" aria-label="文本参考">
      <h3>文本参考</h3>
      {references?.length > 0 && referenceStatus === 'automatic' ? <p className="news-insights-muted">自动匹配</p> : null}
      {references === null ? <p className="news-insights-muted">此稿未记录参考文章</p> : references.length ?
        <ul>{references.map(item => <li key={`${item.id}-${item.revisionId}`}>
          <button type="button" aria-pressed={selectedId === item.id} onClick={() => onReference(item)}>{item.title}</button>
        </li>)}</ul> : <p className="news-insights-muted">{({ no_match: '暂未匹配到合适的参考文章', unavailable: '参考文章库暂不可用', reference_limit: '参考材料已满，未加入库文章' })[referenceStatus] || '未引用库中文章'}</p>}
    </section>
  </aside>;
}

export function NewsReferencePanel({ reference, workspaceId, onClose }) {
  const [state, setState] = React.useState({ loading: true, article: null, error: '' });
  React.useEffect(() => {
    const controller = new AbortController(); setState({ loading: true, article: null, error: '' });
    request(`/api/wechat-monitor/articles/${reference.id}/revisions/${reference.revisionId}`, {
      headers: { 'X-Mamage-Unit-Id': workspaceId ? String(workspaceId) : 'legacy' }, signal: controller.signal,
    }).then(article => { if (!controller.signal.aborted) setState({ loading: false, article, error: '' }); })
      .catch(error => { if (!controller.signal.aborted) setState({ loading: false, article: null,
        error: [401, 403, 404].includes(error.status) ? '这篇参考文章的原版本不可访问或已删除' : '参考文章暂时无法读取，请稍后重试' }); });
    return () => controller.abort();
  }, [reference.id, reference.revisionId, workspaceId]);
  const source = React.useMemo(() => {
    if (!state.article) return '';
    const safe = sanitizeRawHtml((state.article.blocks || []).join(''));
    return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: data: ${location.origin}; style-src 'unsafe-inline'; base-uri ${location.origin}; form-action 'none'"><base href="${location.origin}/"><style>body{margin:16px auto;max-width:677px;overflow-wrap:anywhere;font:16px/1.8 sans-serif}img{max-width:100%;height:auto}</style></head><body>${safe}</body></html>`;
  }, [state.article]);
  return <aside className="news-reference-panel" aria-label="参考文章">
    <div className="news-reference-panel-heading"><div><span>参考文章</span><h3>{reference.title}</h3></div>
      <button type="button" aria-label="关闭参考文章" title="关闭参考文章" onClick={onClose}><IconClose /></button></div>
    {state.loading ? <p role="status">正在读取参考文章</p> : state.error ? <p role="alert">{state.error}</p> : <>
      <div className="news-reference-panel-meta">{state.article.author || '公众号文章'}</div>
      <iframe title={`${reference.title} · 原文`} sandbox="" referrerPolicy="no-referrer" srcDoc={source} />
    </>}
  </aside>;
}
