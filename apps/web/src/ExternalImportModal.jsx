import React from 'react';
import { Button, MotionModal } from './ui';
import { scanExternalAlbum, startExternalImport, listExternalImports, getExternalImport, cancelExternalImport } from './services/externalImportService';
import './ExternalImportModal.css';

const ACTIVE_STATUSES = new Set(['queued', 'running']);
const ERROR_LABELS = {
  SOURCE_EXPIRED: '来源链接已过期',
  SOURCE_MISSING: '来源照片不存在',
  SOURCE_RATE_LIMIT: '来源网站限制访问',
  SOURCE_TOO_LARGE: '来源文件过大',
  SOURCE_NOT_IMAGE: '来源文件不是照片',
  SOURCE_REDIRECT: '来源地址发生跳转',
  INVALID_IMAGE: '照片文件无法读取',
  PROJECT_CHANGED: '目标相册归属已变更',
  TRANSFER_FAILED: '转存失败',
};

function ExternalImportModal({ visible, onClose, projectId, sections = [], onImported }) {
  const [url, setUrl] = React.useState('');
  const [scan, setScan] = React.useState(null);
  const [selected, setSelected] = React.useState(new Set());
  const [sectionId, setSectionId] = React.useState('');
  const [sectionMappings, setSectionMappings] = React.useState({});
  const [acknowledged, setAcknowledged] = React.useState(false);
  const [scanning, setScanning] = React.useState(false);
  const [starting, setStarting] = React.useState(false);
  const [jobId, setJobId] = React.useState(null);
  const [job, setJob] = React.useState(null);
  const [error, setError] = React.useState('');
  const notifiedJobs = React.useRef(new Set());

  React.useEffect(() => {
    if (!visible || !projectId) return undefined;
    let active = true;
    listExternalImports(projectId).then((data) => {
      if (!active) return;
      const latest = data?.jobs?.find((entry) => ACTIVE_STATUSES.has(entry.status));
      if (latest) setJobId(latest.id);
    }).catch(() => null);
    return () => { active = false; };
  }, [visible, projectId]);

  React.useEffect(() => {
    if (!jobId) return undefined;
    let active = true;
    let timer;
    const poll = async () => {
      try {
        const next = await getExternalImport(jobId);
        if (!active) return;
        setJob(next);
        if (ACTIVE_STATUSES.has(next.status)) timer = window.setTimeout(poll, 2200);
        else if (!notifiedJobs.current.has(String(jobId))) {
          notifiedJobs.current.add(String(jobId));
          Promise.resolve(onImported?.()).catch(() => null);
        }
      } catch (err) {
        if (active) timer = window.setTimeout(poll, 5000);
      }
    };
    poll();
    return () => { active = false; window.clearTimeout(timer); };
  }, [jobId, onImported]);

  const photos = scan?.photos || [];
  const allSelected = photos.length > 0 && selected.size === photos.length;
  const done = Number(job?.counts?.done || 0);
  const skipped = Number(job?.counts?.skipped || 0);
  const failed = Number(job?.counts?.failed || 0);
  const handled = done + skipped + failed;
  const progress = job?.selectedCount ? Math.round((handled / job.selectedCount) * 100) : 0;

  const handleScan = async (event) => {
    event?.preventDefault();
    setError('');
    setScan(null);
    setJobId(null);
    setJob(null);
    setAcknowledged(false);
    setSectionMappings({});
    setScanning(true);
    try {
      const result = await scanExternalAlbum(url.trim());
      setScan(result);
      setSelected(new Set(result.photos.map((photo) => String(photo.id))));
    } catch (err) {
      setError(err?.message || '扫描失败，请检查链接');
    } finally { setScanning(false); }
  };

  const handleStart = async () => {
    if (!scan || !selected.size || starting) return;
    if (sections.length && !sectionId) { setError('请先选择转入环节'); return; }
    if (!acknowledged) { setError('请先确认带水印版本'); return; }
    setStarting(true);
    setError('');
    try {
      const result = await startExternalImport({
        scanId: scan.scanId,
        projectId,
        timelineSectionId: sectionId || null,
        sectionMappings,
        photoIds: [...selected],
        confirmRights: true,
      });
      setJobId(result.jobId);
    } catch (err) { setError(err?.message || '创建转存任务失败'); }
    finally { setStarting(false); }
  };

  const handleCancelJob = async () => {
    if (!jobId) return;
    try {
      await cancelExternalImport(jobId);
      setJob((prev) => prev ? { ...prev, cancelRequested: 1 } : prev);
    } catch (err) { setError(err?.message || '取消失败'); }
  };

  const togglePhoto = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <MotionModal
      visible={visible}
      onCancel={onClose}
      title="链接转存"
      className="external-import-modal"
      width="min(820px, calc(100vw - 24px))"
      footer={jobId ? (
        <>
          {job && ACTIVE_STATUSES.has(job.status) && !job.cancelRequested ? <Button type="tertiary" onClick={handleCancelJob}>停止后续转存</Button> : null}
          {job && !ACTIVE_STATUSES.has(job.status) ? <Button type="tertiary" onClick={() => { setJobId(null); setJob(null); setScan(null); setError(''); }}>新建转存</Button> : null}
          <Button type="primary" onClick={onClose}>完成</Button>
        </>
      ) : scan ? (
        <>
          <Button type="tertiary" onClick={() => setScan(null)}>重新扫描</Button>
          <Button type="primary" onClick={handleStart} loading={starting} disabled={!selected.size || !acknowledged || (sections.length > 0 && !sectionId)}>
            转存 {selected.size} 张
          </Button>
        </>
      ) : <Button type="tertiary" onClick={onClose}>关闭</Button>}
    >
      <div className="external-import-body">
        {!jobId ? (
          <form className="external-import-url-row" onSubmit={handleScan}>
            <label htmlFor="external-import-url">照片链接</label>
            <div className="external-import-url-control">
              <input
                id="external-import-url"
                type="url"
                inputMode="url"
                placeholder="粘贴外部相册 HTTPS 链接"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                required
                disabled={scanning || starting}
              />
              <Button type="primary" onClick={handleScan} loading={scanning} disabled={!url.trim() || scanning}>扫描</Button>
            </div>
          </form>
        ) : null}

        {scanning ? <div className="external-import-state" role="status">正在读取相册照片…</div> : null}
        {error ? <div className="external-import-error" role="alert">{error}</div> : null}

        {scan && !jobId ? (
          <>
            <div className="external-import-summary">
              <div>
                <strong>{scan.title}</strong>
                <span>已发现 {scan.scannedCount} / {scan.reportedTotal} 张{scan.complete ? '' : ' · 尚未扫描完整'}</span>
              </div>
              <span className="external-import-source">{scan.templateSource === 'builtin' ? '内置模板' : scan.templateSource === 'cache' ? '复用模板' : 'AI 解析'}</span>
            </div>
            <div className="external-import-toolbar">
              <button type="button" className="external-import-select-all" onClick={() => setSelected(allSelected ? new Set() : new Set(photos.map((photo) => String(photo.id))))}>
                {allSelected ? '取消全选' : '全选'}
              </button>
              <span>已选 {selected.size} 张</span>
            </div>
            <div className="external-import-grid" role="group" aria-label="选择要转存的照片">
              {photos.map((photo) => {
                const checked = selected.has(String(photo.id));
                return (
                  <button
                    type="button"
                    key={photo.id}
                    className={`external-import-photo${checked ? ' is-selected' : ''}`}
                    aria-pressed={checked}
                    aria-label={`${checked ? '取消选择' : '选择'} ${photo.filename}`}
                    onClick={() => togglePhoto(String(photo.id))}
                  >
                    <img src={photo.previewUrl} alt="" loading="lazy" referrerPolicy="no-referrer" />
                    <span className="external-import-check" aria-hidden="true" />
                    <span className="external-import-filename">{photo.filename}</span>
                  </button>
                );
              })}
            </div>
            {sections.length ? (
              <div className="external-import-section-row">
                <label htmlFor="external-import-section">默认转入环节</label>
                <select id="external-import-section" value={sectionId} onChange={(event) => setSectionId(event.target.value)}>
                  <option value="">请选择环节</option>
                  {sections.map((section) => <option key={section.id} value={section.id}>{section.name}</option>)}
                </select>
              </div>
            ) : null}
            {sections.length && scan.suggestedSections?.length ? (
              <div className="external-import-section-map">
                <strong>来源环节对应</strong>
                {scan.suggestedSections.map((name) => (
                  <label key={name}>
                    <span>{name}</span>
                    <select value={sectionMappings[name] || ''} onChange={(event) => setSectionMappings((prev) => ({ ...prev, [name]: event.target.value }))}>
                      <option value="">使用默认环节</option>
                      {sections.map((section) => <option key={section.id} value={section.id}>{section.name}</option>)}
                    </select>
                  </label>
                ))}
              </div>
            ) : null}
            <label className="external-import-ack">
              <input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} />
              <span>{scan.quality === 'watermarked_original_view'
                ? '我已获得转存授权，并了解此相册只能导入网页可查看的带水印版本。'
                : '我已获得转存授权，并已核对来源照片的清晰度及使用范围。'}</span>
            </label>
          </>
        ) : null}

        {jobId ? (
          <div className="external-import-job" aria-live="polite">
            <strong>{job?.sourceTitle || scan?.title || '转存任务'}</strong>
            <span>{job?.status === 'queued' ? '等待开始' : job?.status === 'running' ? (job.cancelRequested ? '正在停止，当前照片完成后结束' : `正在转存${job.activeFileName ? ` · ${job.activeFileName}` : ''}`) : job?.status === 'cancelled' ? '已停止' : job?.status === 'completed_with_errors' ? '已结束，部分照片失败' : '转存完成'}</span>
            <div className="external-import-progress-track"><span style={{ width: `${progress}%` }} /></div>
            <div className="external-import-progress-meta">
              <span>{handled} / {job?.selectedCount || 0}</span>
              <span>成功 {done}{skipped ? ` · 已有 ${skipped}` : ''}{failed ? ` · 失败 ${failed}` : ''}</span>
            </div>
            {job?.issues?.length ? (
              <div className="external-import-issues">
                {job.issues.map((issue) => <div key={issue.sourcePhotoId}>{issue.filename} · {issue.status === 'skipped' ? '相册中已有' : ERROR_LABELS[issue.errorCode] || '转存失败'}</div>)}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </MotionModal>
  );
}

export default ExternalImportModal;
