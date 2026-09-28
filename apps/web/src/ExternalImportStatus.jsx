import React from 'react';
import { Button } from './ui';
import {
  cancelExternalImport,
  getExternalImport,
  getExternalImportIssues,
  getExternalImportUpdates,
  hideExternalImportSource,
  listExternalImports,
  resumeExternalImport,
} from './services/externalImportService';
import './ExternalImportStatus.css';

const ACTIVE = new Set(['queued', 'running', 'paused']);
const ISSUE_LABELS = {
  SOURCE_EXPIRED: '来源链接已过期', SOURCE_MISSING: '来源照片不存在',
  SOURCE_RATE_LIMIT: '来源网站限制访问', SOURCE_TOO_LARGE: '超过 500 MB',
  SOURCE_NOT_IMAGE: '不是支持的照片', SOURCE_REDIRECT: '来源地址发生跳转',
  INVALID_IMAGE: '照片文件无法读取', PROJECT_CHANGED: '相册归属已变更',
  HEIC_PREVIEW_UNAVAILABLE: 'HEIC 预览不可用', TRANSFER_FAILED: '转存失败',
  UNSUPPORTED_RAW: 'RAW 暂不支持，已跳过',
  SCAN_INCOMPLETE: '扫描未完成，稍后继续', TEMPLATE_INCOMPLETE: '网页结构未能完整解析',
  SCAN_FAILED: '解析失败', WORKER_INTERRUPTED: '服务中断，稍后重试',
};

function ExternalImportStatus({ projectId, loading, initialPhotoCursor, refreshKey, onPhotos, onSections }) {
  const [jobId, setJobId] = React.useState(null);
  const [job, setJob] = React.useState(null);
  const [sources, setSources] = React.useState([]);
  const [error, setError] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [showIssues, setShowIssues] = React.useState(false);
  const [issuesPage, setIssuesPage] = React.useState(null);
  const [dismissed, setDismissed] = React.useState(false);
  const photoCursor = React.useRef(null);
  const latestCursor = React.useRef(initialPhotoCursor);
  const updatesBusy = React.useRef(false);

  React.useEffect(() => { latestCursor.current = initialPhotoCursor; }, [initialPhotoCursor]);

  React.useEffect(() => {
    setJobId(null);
    setJob(null);
    setSources([]);
    setShowIssues(false);
    setIssuesPage(null);
    photoCursor.current = null;
  }, [projectId]);

  React.useEffect(() => {
    if (!projectId || loading) return undefined;
    let alive = true;
    const refresh = async () => {
      try {
        const data = await listExternalImports(projectId);
        if (!alive) return;
        setSources(data.sources || []);
        const latest = data.jobs?.find((entry) => ACTIVE.has(entry.status)) || data.jobs?.[0];
        setJobId(latest?.id || null);
      } catch (err) { if (alive) setError(err?.message || '转存状态暂不可用'); }
    };
    refresh();
    const timer = window.setInterval(refresh, 15000);
    return () => { alive = false; window.clearInterval(timer); };
  }, [projectId, loading, refreshKey]);

  React.useEffect(() => {
    if (!jobId || loading) return undefined;
    let alive = true;
    let timer;
    setShowIssues(false);
    setIssuesPage(null);
    photoCursor.current = latestCursor.current || 0;
    setDismissed(window.localStorage.getItem(`mamage-import-dismissed-${jobId}`) === '1');
    const poll = async () => {
      try {
        const next = await getExternalImport(jobId);
        if (!alive || Number(next.projectId) !== Number(projectId)) return;
        setJob(next);
        setError('');
        if (!updatesBusy.current) {
          updatesBusy.current = true;
          try {
            for (let page = 0; page < 3; page += 1) {
              const updates = await getExternalImportUpdates(jobId, photoCursor.current || 0);
              if (!alive) return;
              if (updates.photos?.length) {
                onPhotos(updates.photos);
                photoCursor.current = Math.max(photoCursor.current || 0, ...updates.photos.map((photo) => Number(photo.id)));
              }
              if (updates.sections?.length) onSections(updates.sections);
              if (!updates.hasMore) break;
            }
          } finally { updatesBusy.current = false; }
        }
        timer = window.setTimeout(poll, ACTIVE.has(next.status) ? 2500 : 10000);
      } catch (err) {
        if (alive) {
          setError(err?.message || '转存状态暂不可用');
          timer = window.setTimeout(poll, 6000);
        }
      }
    };
    poll();
    return () => { alive = false; window.clearTimeout(timer); };
  }, [jobId, projectId, loading, onPhotos, onSections]);

  const handleAction = async (action) => {
    if (!job || busy) return;
    setBusy(true);
    try {
      if (action === 'stop') await cancelExternalImport(job.id);
      else await resumeExternalImport(job.id);
      setJob(await getExternalImport(job.id));
    } catch (err) { setError(err?.message || '操作失败'); }
    finally { setBusy(false); }
  };

  const handleHideSource = async (id) => {
    try {
      await hideExternalImportSource(id);
      const latest = await listExternalImports(projectId);
      setSources(latest.sources || []);
    } catch (err) { setError(err?.message || '隐藏来源失败'); }
  };

  const toggleIssues = async () => {
    if (!showIssues && job) {
      try { setIssuesPage(await getExternalImportIssues(job.id)); }
      catch (err) { setError(err?.message || '读取失败详情失败'); }
    }
    setShowIssues((value) => !value);
  };

  const loadMoreIssues = async () => {
    const previous = issuesPage?.issues || [];
    if (!job || !previous.length) return;
    try {
      const next = await getExternalImportIssues(job.id, previous[previous.length - 1].id);
      setIssuesPage({ issues: [...previous, ...next.issues], hasMore: next.hasMore });
    } catch (err) { setError(err?.message || '读取失败详情失败'); }
  };

  const done = Number(job?.counts?.done || 0);
  const skipped = Number(job?.counts?.skipped || 0);
  const failed = Number(job?.counts?.failed || 0);
  const knownTotal = Math.max(Number(job?.reportedTotal || 0), Number(job?.discoveredCount || 0));
  const determinate = Boolean(job?.reportedTotal || job?.scanStatus === 'completed');
  const progress = knownTotal ? Math.min(100, Math.round(((done + skipped + failed) / knownTotal) * 100)) : 0;
  const stateLabel = job?.status === 'queued' ? '等待解析'
    : job?.status === 'running' ? (job.scanStatus === 'completed' ? '正在转存' : '正在解析并转存')
      : job?.status === 'paused' ? (job.scanErrorCode === 'SOURCE_RATE_LIMIT' ? '来源限流，稍后继续' : '稍后继续')
        : job?.status === 'cancelled' ? '已停止'
          : job?.status === 'completed_with_errors' ? '部分照片未转存'
            : '转存完成';
  const showJob = job && Number(job.projectId) === Number(projectId) && !(job.status === 'completed' && dismissed);

  if (!showJob && !sources.length && !error) return null;
  return (
    <section className="external-import-status" aria-label="链接转存状态">
      {showJob ? (
        <div className="external-import-banner" aria-live="polite">
          <div className="external-import-banner-main">
            <span className={`external-import-state-dot is-${job.status}`} aria-hidden="true" />
            <strong>{stateLabel}</strong>
            <span className="external-import-banner-title" title={job.sourceTitle}>{job.sourceTitle}</span>
            <span className="external-import-banner-counts">
              发现 {job.discoveredCount}{job.reportedTotal ? ` / ${job.reportedTotal}` : ''} · 转存 {done}
              {skipped ? ` · 已有 ${skipped}` : ''}{failed ? ` · 失败 ${failed}` : ''}
            </span>
            <div className="external-import-banner-actions">
              {job.canControl && ACTIVE.has(job.status) && !job.cancelRequested ? (
                <Button type="tertiary" size="small" loading={busy} onClick={() => handleAction('stop')}>停止</Button>
              ) : null}
              {job.canControl && ['cancelled', 'completed_with_errors'].includes(job.status) ? (
                <Button type="tertiary" size="small" loading={busy} onClick={() => handleAction('resume')}>继续转存</Button>
              ) : null}
              {job.status === 'completed' ? (
                <Button type="tertiary" size="small" onClick={() => {
                  window.localStorage.setItem(`mamage-import-dismissed-${job.id}`, '1');
                  setDismissed(true);
                }}>收起</Button>
              ) : null}
              {(failed || job.scanErrorCode) ? (
                <Button type="tertiary" size="small" onClick={toggleIssues}>
                  {showIssues ? '收起详情' : '查看详情'}
                </Button>
              ) : null}
            </div>
          </div>
          {ACTIVE.has(job.status) ? (
            <div className={`external-import-track${determinate ? '' : ' is-indeterminate'}`} role="progressbar"
              aria-valuemin={0} aria-valuemax={determinate ? knownTotal || 1 : undefined} aria-valuenow={determinate ? done + skipped + failed : undefined}>
              <span style={determinate ? { width: `${progress}%` } : undefined} />
            </div>
          ) : null}
          {job.cancelRequested && ACTIVE.has(job.status) ? <span className="external-import-detail">当前照片完成后停止</span> : null}
          {job.activeFileName && job.status === 'running' ? <span className="external-import-detail">正在处理 {job.activeFileName}</span> : null}
          {showIssues ? (
            <div className="external-import-issues">
              {job.scanErrorCode ? <div>解析：{ISSUE_LABELS[job.scanErrorCode] || job.scanErrorCode}</div> : null}
              {(issuesPage?.issues || job.issues || []).map((issue) =>
                <div key={issue.id}>{issue.filename} · {ISSUE_LABELS[issue.errorCode] || '转存失败'}</div>)}
              {issuesPage?.hasMore ? <Button type="tertiary" size="small" onClick={loadMoreIssues}>加载更多</Button> : null}
            </div>
          ) : null}
        </div>
      ) : null}
      {sources.length ? (
        <div className="external-import-sources">
          {sources.map((source) => <div className="external-import-source" key={source.id}>
            <span>部分照片转存自 <strong>{source.title || source.domain}</strong> · {source.domain}</span>
            <span>{source.photoCount || 0} 张 · {new Date(source.startedAt).toLocaleDateString('zh-CN')}</span>
            {source.url ? <a href={source.url} target="_blank" rel="noopener noreferrer">来源</a> : null}
            {source.url ? <button type="button" onClick={() => handleHideSource(source.id)} aria-label={`隐藏 ${source.domain} 来源记录`}>隐藏</button> : null}
          </div>)}
        </div>
      ) : null}
      {error ? <div className="external-import-status-error" role="alert">{error}</div> : null}
    </section>
  );
}

export default ExternalImportStatus;
