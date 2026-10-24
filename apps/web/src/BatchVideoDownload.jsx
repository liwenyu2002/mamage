import React from 'react';
import { Button } from './ui';
import { IconClose, IconDownload } from './ui/icons';
import { batchVideoDownload } from './services/batchVideoDownload';
import './batchVideoDownload.css';

const bytes = value => value >= 1024 ** 3 ? `${(value / 1024 ** 3).toFixed(1)} GB`
  : value >= 1024 ** 2 ? `${(value / 1024 ** 2).toFixed(1)} MB` : value >= 1024 ? `${(value / 1024).toFixed(1)} KB` : `${value} B`;
const labels = { picking: '选择保存文件夹', preparing: '正在连接下载', running: '正在保存视频', done: '视频已保存',
  partial: '部分视频未保存', cancelled: '下载已取消', cancelling: '正在取消', failed: '下载未开始', 'handed-off': '已交给浏览器下载' };

export default function BatchVideoDownload() {
  const job = React.useSyncExternalStore(batchVideoDownload.subscribe, batchVideoDownload.getSnapshot, () => null);
  const [collapsed, setCollapsed] = React.useState(false);
  React.useEffect(() => { setCollapsed(false); }, [job?.startedAt]);
  React.useEffect(() => {
    if (!job || job.mode !== 'folder' || !batchVideoDownload.isRunning()) return undefined;
    const warn = event => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [job?.status, job?.mode]);
  if (!job) return null;
  const active = ['picking', 'preparing', 'running', 'cancelling'].includes(job.status);
  const saved = job.items.filter(item => item.status === 'saved').length;
  const loaded = job.items.reduce((sum, item) => sum + item.loaded, 0);
  const failed = job.items.filter(item => ['failed', 'cancelled'].includes(item.status)).length;
  const title = labels[job.status] || '批量下载';
  const startZip = () => { void batchVideoDownload.start(job.ids, { forceZip: true, mediaKind: job.mediaKind }); };
  const summary = [job.mediaCounts?.photos ? `${job.mediaCounts.photos} 张照片` : '',
    job.mediaCounts?.videos ? `${job.mediaCounts.videos} 个视频` : ''].filter(Boolean).join(' · ') || `${job.ids.length} 项`;
  const hasSize = Number.isFinite(job.totalBytes) && job.unknownSizeCount < job.ids.length;
  return <aside className={`video-download${collapsed ? ' is-collapsed' : ''}`} aria-label="批量下载" aria-live="polite">
    <header>
      <button type="button" className="video-download-heading" onClick={() => setCollapsed(!collapsed)} aria-expanded={!collapsed}>
        <IconDownload width={18} height={18} /><strong>{title}</strong><span>{job.ids.length} 个</span>
      </button>
      <button type="button" className="video-download-close" title={active ? '收起下载进度' : '关闭下载进度'} aria-label={active ? '收起下载进度' : '关闭下载进度'}
        onClick={() => active ? setCollapsed(true) : batchVideoDownload.dismiss()}><IconClose width={16} height={16} /></button>
    </header>
    {!collapsed && <div className="video-download-content">
      <p className="video-download-size"><span>{job.unknownSizeCount > 0 && hasSize ? '已知体积至少' : '预计体积'}</span>
        <strong>{hasSize ? `${job.unknownSizeCount ? '' : '约 '}${bytes(job.totalBytes)}` : active ? '查询中' : '暂未知'}</strong></p>
      {job.unknownSizeCount > 0 && <p className="video-download-note">{job.unknownSizeCount} 项大小未知</p>}
      {job.mode === 'zip' ? <><p>流式 ZIP · {summary}{job.status === 'handed-off' ? ' · 浏览器已接管' : ''}</p>
        {job.zipName && <p className="video-download-archive" title={job.zipName}>{job.zipName}</p>}</>
        : <><p>已保存 {saved} / {job.ids.length} 个 <span>{bytes(loaded)}</span></p>
          <progress max={Math.max(1, job.ids.length)} value={saved} aria-label="已保存的视频数量" />
          <div className="video-download-items">{job.items.map(item => <div key={item.id} className="video-download-item">
            <span title={item.name}>{item.name}</span><small>{item.status === 'saved' ? '已保存' : item.status === 'failed' ? item.error
              : item.status === 'cancelled' ? '已取消' : item.status === 'waiting' ? '等待中'
                : item.total ? `${Math.min(99, Math.floor(item.loaded / item.total * 100))}%` : bytes(item.loaded)}</small>
          </div>)}</div></>}
      {job.error && <p role="alert" className="video-download-error">{job.error}</p>}
      <footer>
        {active && <Button onClick={() => batchVideoDownload.cancel()} disabled={job.status === 'cancelling'}>取消下载</Button>}
        {!active && failed > 0 && <Button onClick={() => { void batchVideoDownload.retry(); }}>重试未完成项</Button>}
        {!active && ['failed', 'partial', 'cancelled'].includes(job.status) && <Button onClick={startZip}>流式 ZIP 下载</Button>}
      </footer>
    </div>}
  </aside>;
}
