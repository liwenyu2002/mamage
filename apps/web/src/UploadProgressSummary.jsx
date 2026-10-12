import React from 'react';
import { IconChevronRight } from './ui/icons';
import {
  formatUploadBytes,
  formatUploadRemainingTime,
  getUploadPhaseLabel,
  getUploadProgressTitle,
} from './utils/uploadProgress';
import './UploadProgressSummary.css';

export default function UploadProgressSummary({ progress }) {
  const [detailsOpen, setDetailsOpen] = React.useState(false);
  React.useEffect(() => {
    if (progress?.failedFiles) setDetailsOpen(true);
  }, [progress?.failedFiles]);
  if (!progress) return null;

  const total = progress.totalFiles || progress.order?.length || 0;
  const finished = (progress.completedFiles || 0) + (progress.failedFiles || 0);
  const transferringDone = total > finished && progress.totalBytes > 0
    && progress.loadedBytes >= progress.totalBytes;
  const reportedPercent = Math.max(0, Math.min(100, Number(progress.percent) || 0));
  const percent = progress.totalBytes > 0 && progress.loadedBytes < progress.totalBytes
    ? Math.min(99, reportedPercent)
    : reportedPercent;
  const title = transferringDone ? '传输完成，处理中' : getUploadProgressTitle(progress);
  const activeLabel = progress.activeFileName
    ? `${getUploadPhaseLabel(progress.activePhase)} · ${progress.activeFileName}`
    : (progress.failedFiles ? `${progress.failedFiles} 个文件上传失败` : `${finished} / ${total} 个文件已完成`);
  const remaining = !transferringDone && progress.remainingSeconds != null
    ? `约剩 ${formatUploadRemainingTime(progress.remainingSeconds)}`
    : '';

  return (
    <section className="upload-summary" aria-label="上传进度">
      <div className="upload-summary-head">
        <div className="upload-summary-heading">
          <strong aria-live="polite">{title}</strong>
          <span>已完成 {progress.completedFiles || 0} / {total}{progress.failedFiles ? ` · ${progress.failedFiles} 个失败` : ''}</span>
        </div>
        <div className="upload-summary-metric">
          <b>{transferringDone ? '处理中' : `${percent}%`}</b>
          <small>{formatUploadBytes(progress.loadedBytes)} / {formatUploadBytes(progress.totalBytes)}</small>
        </div>
      </div>
      <div
        className="upload-summary-track"
        role="progressbar"
        aria-label="文件传输进度"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
      >
        <span style={{ width: `${percent}%` }} />
      </div>
      <div className="upload-summary-activity">
        <span title={activeLabel}>{activeLabel}</span>
        {remaining ? <span>{remaining}</span> : null}
      </div>
      {total > 1 || progress.failedFiles ? (
        <details className="upload-summary-details" open={detailsOpen} onToggle={(event) => setDetailsOpen(event.currentTarget.open)}>
          <summary>
            <span>文件明细</span>
            <IconChevronRight aria-hidden="true" />
          </summary>
          {detailsOpen ? <div className="upload-summary-files">
            {(progress.order || []).map((key) => progress.items?.[key]).filter(Boolean).map((item) => {
              const failed = item.status === 'rejected' || item.phase === 'failed';
              const done = item.status === 'fulfilled' || item.phase === 'done';
              const error = failed && (item.error?.userMessage || item.error?.message || (typeof item.error === 'string' ? item.error : ''));
              return (
                <div className={`upload-summary-file${failed ? ' is-failed' : done ? ' is-done' : ''}`} key={item.key}>
                  <span className="upload-summary-file-name" title={item.name}>{item.name}</span>
                  <span className="upload-summary-file-state">{getUploadPhaseLabel(item.phase, item.status)}</span>
                  {error ? <small title={error}>{error}</small> : null}
                </div>
              );
            })}
          </div> : null}
        </details>
      ) : null}
    </section>
  );
}
