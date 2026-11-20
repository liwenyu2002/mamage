import React from 'react';
import { Button, GlassSelect, Modal, Toast } from './ui';
import { Clock3, Check, CircleX } from 'lucide-react';
import { getMyMembershipRequests, skipOrganizationChoice, applyToOrganization,
  withdrawOrganizationRequest, readMembershipNotifications } from './services/workspaceJoinService';
import './WorkspaceJoin.css';

const labels = { pending: '待审批', approved: '已通过', rejected: '未通过', withdrawn: '已撤回' };

export default function WorkspaceJoinChooser({ visible, onClose, onUpdated }) {
  const [data, setData] = React.useState(null);
  const [unitId, setUnitId] = React.useState('');
  const [reason, setReason] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const [revision, reload] = React.useReducer(n => n + 1, 0);
  React.useEffect(() => {
    if (!visible) return undefined;
    const controller = new AbortController();
    setError('');
    getMyMembershipRequests(controller.signal).then(value => {
      if (controller.signal.aborted) return;
      setData(value);
      const unread = value.requests.filter(item => !item.readAt && item.reviewedAt)
        .map(item => ({ id: item.id, revision: item.reviewRevision }));
      if (unread.length) void readMembershipNotifications(unread).catch(() => {});
    }).catch(e => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, [visible, revision]);
  const close = async () => {
    if (busy) return;
    setBusy(true); setError('');
    try { if (data?.needsChoice) await skipOrganizationChoice(); onClose(); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };
  const submit = async event => {
    event.preventDefault();
    if (!unitId || busy) return;
    setBusy(true); setError('');
    try {
      await applyToOrganization({ unitId: Number(unitId), reason });
      setUnitId(''); setReason(''); Toast.success('申请已提交'); onUpdated?.(); onClose();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };
  const withdraw = async id => {
    setBusy(true); setError('');
    try { await withdrawOrganizationRequest(id); reload(); onUpdated?.(); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };
  const available = (data?.units || []).filter(unit => !data.requests.some(item => item.unitId === unit.id && ['pending', 'approved'].includes(item.status)));
  return <Modal visible={visible} title="加入组织" width="min(520px, calc(100vw - 24px))" className="workspace-join-dialog"
    onCancel={close} closable={!busy} maskClosable={false} footer={null}>
    {error ? <p className="join-error" role="alert">{error}<Button size="small" onClick={reload}>重试</Button></p> : null}
    {!data ? <p role="status">正在读取组织信息…</p> : <>
      <form onSubmit={submit} className="workspace-join-form">
        <GlassSelect label="申请加入" value={unitId} disabled={busy} onChange={setUnitId}
          options={[{ value: '', label: available.length ? '选择组织' : '暂无可申请的组织' }, ...available.map(unit => ({ value: String(unit.id), label: unit.name }))]} />
        <label>申请说明<span className="join-muted">选填</span>
          <textarea value={reason} maxLength={300} rows={3} disabled={busy} onChange={event => setReason(event.target.value)} placeholder="所在班级、团队或参与的工作" />
        </label>
        <div className="join-actions"><Button disabled={busy} onClick={close}>{data.hasMembership ? '完成' : '暂不加入，使用个人工具'}</Button>
          <Button type="primary" theme="solid" disabled={!unitId || busy} loading={busy} onClick={submit}>提交申请</Button></div>
      </form>
      {data.requests.length > 0 ? <section className="join-my-requests" aria-label="我的入组申请"><h3>我的申请</h3>
        {data.requests.map(item => <div className="join-request-result" key={item.id}>
          <span className={`join-state is-${item.status}`}>{item.status === 'pending' ? <Clock3 size={16} /> : item.status === 'approved' ? <Check size={16} /> : <CircleX size={16} />}{labels[item.status]}</span>
          <div><strong>{item.unitName}</strong>{item.reviewNote ? <p>{item.reviewNote}</p> : null}{item.archivedAt ? <small>组织已停用</small> : null}</div>
          {item.status === 'pending' ? <Button size="small" disabled={busy} onClick={() => withdraw(item.id)}>撤回</Button> : null}
        </div>)}
      </section> : null}
    </>}
  </Modal>;
}
