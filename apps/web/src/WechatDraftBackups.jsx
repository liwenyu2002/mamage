import React from 'react';
import { Modal, Button, SegmentedControl } from './ui';
import { IconTrash } from './ui/icons';
import { listCompositions, getComposition, deleteComposition } from './services/wechatCompositionService';

export default function WechatDraftBackups({ onClose, onRestore }) {
  const [kind, setKind] = React.useState('content');
  const [items, setItems] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState('');
  const [busy, setBusy] = React.useState(null);
  const [epoch, setEpoch] = React.useState(0);
  React.useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    listCompositions().then(response => { if (active) setItems(response.items || []); })
      .catch(() => { if (active) setError('备份列表暂时无法读取'); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [epoch]);
  const restore = async item => {
    setBusy(item.id); setError('');
    try { const full = await getComposition(item.id); onRestore(full); }
    catch (failure) { setError(failure.message || '无法恢复该备份'); }
    finally { setBusy(null); }
  };
  return <Modal visible title="稿件备份" onCancel={onClose} footer={null} width={720}>
    <div className="wechat-backups">
      <SegmentedControl label="备份类型" value={kind} onChange={setKind} options={[{ value: 'content', label: '内容稿' }, { value: 'layout', label: '排版稿' }]} />
      {loading ? <p role="status">正在读取备份…</p> : null}
      {error ? <p role="alert">{error} <Button size="small" onClick={() => setEpoch(value => value + 1)}>重试</Button></p> : null}
      {items.filter(item => (item.draftKind || 'layout') === kind).map(item => <div className="wechat-backup-row" key={item.id}>
        <div><strong>{item.title || item.name}</strong><small>{new Date(item.updatedAt).toLocaleString('zh-CN')} · {item.blockCount} 个内容块</small></div>
        <Button size="small" disabled={busy !== null} onClick={() => restore(item)}>恢复{kind === 'content' ? '内容稿' : '排版稿'}</Button>
        <Button size="small" theme="borderless" icon={<IconTrash />} title="删除此备份" aria-label={`删除备份 ${item.id}`} disabled={busy !== null}
          onClick={() => Modal.confirm({ title: '删除这份备份？', content: '仅删除此备份，不影响当前内容稿和排版稿。', okText: '删除备份', onOk: async () => {
            setBusy(item.id); try { await deleteComposition(item.id); setItems(previous => previous.filter(row => row.id !== item.id)); }
            catch (failure) { setError('删除失败，请重试'); } finally { setBusy(null); }
          } })} />
      </div>)}
      {!loading && !error && !items.some(item => (item.draftKind || 'layout') === kind) ? <p>暂无{kind === 'content' ? '内容稿' : '排版稿'}备份</p> : null}
    </div>
  </Modal>;
}
