import React from 'react';
import { Check, X, RefreshCw, Inbox } from 'lucide-react';
import { Button } from './ui';
import { getMembershipInbox, reviewOrganizationRequest, MEMBERSHIP_EVENT } from './services/workspaceJoinService';
import './WorkspaceJoin.css';

export default function MembershipRequestsPanel({ unitId, onUpdated }) {
  const [history, setHistory] = React.useState(false);
  const [data, setData] = React.useState(null);
  const [error, setError] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [editing, setEditing] = React.useState(null);
  const [note, setNote] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [revision, reload] = React.useReducer(n => n + 1, 0);
  React.useEffect(() => {
    const refresh = () => { if (!document.hidden) reload(); };
    const timer = setInterval(refresh, 30000);
    window.addEventListener(MEMBERSHIP_EVENT, refresh);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener(MEMBERSHIP_EVENT, refresh);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, []);
  React.useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    getMembershipInbox({ ...(unitId ? { unitId } : {}), status: history ? 'history' : 'pending' }, controller.signal)
      .then(value => { if (!controller.signal.aborted) setData(Array.isArray(value?.requests) ? value : { requests: [], total: 0 }); })
      .catch(e => { if (!controller.signal.aborted) setError(e.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [unitId, history, revision]);
  const review = async () => {
    setBusy(true); setError('');
    try { await reviewOrganizationRequest(editing.id, { decision: editing.decision, note }); setEditing(null); setNote(''); onUpdated?.(); reload(); }
    catch (e) { setError(e.message); reload(); }
    finally { setBusy(false); }
  };
  return <section className="membership-requests-panel" id="membership-requests" aria-label="组织入组申请">
    <header className="join-panel-heading"><div><h2>入组申请</h2><span>{data?.total ?? 0}</span></div>
      <Button size="small" title="刷新申请" aria-label="刷新申请" icon={<RefreshCw size={16} />} loading={loading} onClick={reload} /></header>
    <div className="join-view-tabs" role="tablist" aria-label="申请状态">
      <button type="button" role="tab" aria-selected={!history} disabled={busy} onClick={() => { setHistory(false); setEditing(null); }}>待审批</button>
      <button type="button" role="tab" aria-selected={history} disabled={busy} onClick={() => { setHistory(true); setEditing(null); }}>已处理</button>
    </div>
    {error ? <p className="join-error" role="alert">{error}</p> : null}
    <div aria-busy={loading}>
      {data?.requests.map(item => <article className="join-review-row" key={item.id}>
        <div className="join-review-identity"><strong>{item.name}</strong><span>{item.unitName}</span>
          <small>{[item.studentNo, item.email].filter(Boolean).join(' · ')}</small>
          {item.reason ? <p>{item.reason}</p> : null}
          <time>{new Date(item.createdAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</time>
        </div>
        {item.status === 'pending' ? <div className="join-review-actions">
          <Button size="small" icon={<X size={16} />} disabled={busy} onClick={() => { setEditing({ id: item.id, decision: 'reject' }); setNote(''); }}>不通过</Button>
          <Button size="small" type="primary" icon={<Check size={16} />} disabled={busy} onClick={() => { setEditing({ id: item.id, decision: 'approve' }); setNote(''); }}>通过</Button>
        </div> : <span className={`join-state is-${item.status}`}>{item.status === 'approved' ? '已通过' : '未通过'}</span>}
        {editing?.id === item.id ? <div className="join-review-confirm">
          <strong>{editing.decision === 'approve' ? `确认让 ${item.name} 加入 ${item.unitName}，成为协作者？` : `不通过 ${item.name} 的申请？`}</strong>
          <label>审批说明<span className="join-muted">选填，对申请人可见</span>
            <textarea maxLength={300} rows={2} value={note} disabled={busy} onChange={event => setNote(event.target.value)} /></label>
          <div className="join-actions"><Button size="small" disabled={busy} onClick={() => setEditing(null)}>取消</Button>
            <Button size="small" type="primary" theme="solid" loading={busy} onClick={review}>{editing.decision === 'approve' ? '确认通过' : '确认不通过'}</Button></div>
        </div> : null}
        {item.reviewNote ? <p className="join-reviewed-note">{item.reviewNote}</p> : null}
      </article>)}
      {!loading && !error && !data?.requests.length ? <div className="join-empty"><Inbox size={24} /><span>{history ? '暂无审批记录' : '没有待审批的申请'}</span></div> : null}
    </div>
  </section>;
}
