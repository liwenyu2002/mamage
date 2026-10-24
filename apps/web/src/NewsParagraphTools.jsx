import React from 'react';
import { Button } from './ui';
import { IconChevronRight, IconSparkleAI } from './ui/icons';
import { request } from './services/request';

function readSaved(key) {
  try {
    const value = key ? JSON.parse(localStorage.getItem(key) || 'null') : null;
    return value && typeof value.base === 'string' && value.base.length <= 50000
      && (typeof value.proposal === 'string' || value.clientRequestId) ? value : null;
  } catch { return null; }
}

export default function NewsParagraphTools({ markdown, form, confirmedNames, interviewText, storageKey, onApply }) {
  const [open, setOpen] = React.useState(false);
  const [report, setReport] = React.useState(null);
  const [selectedId, setSelectedId] = React.useState('');
  const [error, setError] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const storedKey = storageKey ? storageKey + ':paragraph' : null;
  const [restored] = React.useState(() => readSaved(storedKey));
  const [pending, setPending] = React.useState(restored && !restored.proposal ? restored : null);
  const [proposal, setProposal] = React.useState(restored?.proposal ? restored : null);
  const sources = React.useMemo(() => ({ form: { ...form, confirmedParticipantNames: confirmedNames }, interviewText }),
    [form, confirmedNames, interviewText]);
  React.useEffect(() => {
    if (!storedKey) return;
    try {
      if (proposal || pending) localStorage.setItem(storedKey, JSON.stringify(proposal || pending));
      else localStorage.removeItem(storedKey);
    } catch {}
  }, [storedKey, proposal, pending]);
  React.useEffect(() => {
    if (!open || !markdown) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const next = await request('/api/ai/news/sources', { method: 'POST', data: { markdown, ...sources }, signal: controller.signal });
        if (!controller.signal.aborted) { setReport({ ...next, base: markdown }); setError(''); }
      } catch (e) { if (!controller.signal.aborted) setError(e.message || '材料对照暂不可用'); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    }, 300);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [open, markdown, sources]);
  React.useEffect(() => {
    if (!pending) return;
    const controller = new AbortController();
    let timer;
    const poll = async () => {
      try {
        if (!document.hidden) {
          const job = await request(pending.jobId ? `/api/ai/news/jobs/${pending.jobId}`
            : `/api/ai/news/rewrites/${pending.clientRequestId}`, { signal: controller.signal });
          if (controller.signal.aborted) return;
          if (job.status === 'succeeded' && typeof job.result?.markdown === 'string') {
            setProposal({ ...pending, proposal: job.result.markdown }); setPending(null); setOpen(true); setError(''); return;
          }
          if (['failed', 'cancelled'].includes(job.status)) {
            setError(job.error || '局部改写未完成，原文已保留'); setPending(null); return;
          }
        }
      } catch (e) { if (!controller.signal.aborted && !(e.status === 404 && !pending.jobId)) setError(e.message || '正在恢复任务状态'); }
      if (!controller.signal.aborted) timer = setTimeout(poll, document.hidden ? 10000 : 2000);
    };
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [pending]);
  const selected = report?.paragraphs?.find(item => item.id === selectedId) || report?.paragraphs?.[0];
  const submitSnapshot = async snapshot => {
    setSubmitting(true); setError('');
    try {
      const job = await request('/api/ai/news/rewrite', { method: 'POST', data: { markdown: snapshot.base,
        start: snapshot.start, end: snapshot.end, mode: snapshot.mode,
        clientRequestId: snapshot.clientRequestId, ...snapshot.sourceInput } });
      if (storedKey) localStorage.setItem(storedKey, JSON.stringify({ ...snapshot, jobId: job.jobId }));
      setPending({ ...snapshot, jobId: job.jobId }); setProposal(null);
    } catch (e) { setError(e.message || '局部改写暂不可用，原文已保留'); }
    finally { setSubmitting(false); }
  };
  const rewrite = async mode => {
    if (!selected || report?.base !== markdown || submitting || pending) return;
    const snapshot = { base: markdown, start: selected.start, end: selected.end, original: selected.text,
      mode, sourceInput: sources, clientRequestId: typeof crypto.randomUUID === 'function' ? crypto.randomUUID()
        : `paragraph-${Date.now()}-${Math.random().toString(36).slice(2)}` };
    if (storedKey) localStorage.setItem(storedKey, JSON.stringify(snapshot));
    setPending(snapshot); setProposal(null);
    await submitSnapshot(snapshot);
  };
  const proposalCurrent = proposal && proposal.base === markdown
    && markdown.slice(proposal.start, proposal.end) === proposal.original;
  return <details className="news-paragraph-tools" open={open} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary><span>段落与来源</span>{pending ? <small>后台改写中</small> : null}<IconChevronRight /></summary>
    {error ? <p className="news-paragraph-error" role="alert">{error}</p> : null}
    {pending && !pending.jobId && !submitting ? <Button size="small" onClick={() => submitSnapshot(pending)}>重试提交</Button> : null}
    {loading && !report ? <p className="news-paragraph-muted">正在对照材料</p> : null}
    {report?.paragraphs?.length ? <div className="news-paragraph-body">
      <select aria-label="选择正文段落" value={selected?.id || ''} onChange={event => setSelectedId(event.target.value)}>
        {report.paragraphs.map((paragraph, index) => <option key={paragraph.id} value={paragraph.id}>
          第 {index + 1} 段 · {paragraph.text.replace(/\s+/g, ' ').slice(0, 42)}</option>)}
      </select>
      <p className="news-paragraph-original">{selected?.text}</p>
      <div className="news-paragraph-actions"><span className="news-paragraph-muted">{selected?.references.length ? '相近材料片段' : '待核对来源'}</span>
        <Button size="small" icon={<IconSparkleAI />} disabled={report?.base !== markdown || submitting || Boolean(pending)} onClick={() => rewrite('polish')}>润色</Button>
        <Button size="small" disabled={report?.base !== markdown || submitting || Boolean(pending)} onClick={() => rewrite('shorten')}>精简</Button>
        <Button size="small" disabled={report?.base !== markdown || submitting || Boolean(pending)} onClick={() => rewrite('expand')}>展开</Button></div>
      <div className="news-paragraph-references">{selected?.references.map(reference => <blockquote key={reference.id}>
        <cite>{reference.label}</cite><p>{reference.text}</p></blockquote>)}</div>
      {selected?.issues.length ? <ul className="news-paragraph-issues">{selected.issues.map((issue, index) => <li key={index}>{issue.message || '请核对该段事实与材料'}</li>)}</ul> : null}
    </div> : report ? <p className="news-paragraph-muted">暂无正文段落</p> : null}
    {proposal ? <div className="news-paragraph-proposal">
      <div className="news-paragraph-diff"><div><strong>原段落</strong><p>{proposal.original}</p></div>
        <div><strong>改写建议</strong><p>{proposal.proposal}</p></div></div>
      {!proposalCurrent ? <p className="news-paragraph-error">当前正文已变化，这条建议不能直接覆盖</p> : null}
      <div className="news-paragraph-actions"><Button size="small" type="primary" disabled={!proposalCurrent} onClick={() => {
        if (!proposalCurrent) return;
        onApply(proposal); setProposal(null);
      }}>采用建议</Button><Button size="small" onClick={() => setProposal(null)}>放弃建议</Button></div>
    </div> : null}
  </details>;
}
