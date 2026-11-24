import React from 'react';
import { Button, Toast } from './ui';
import { request } from './services/request';
import { getBatch, listRecoverableWechatDrafts } from './services/newsMatrixService';
import { normalizeNewsPhoto, NEWS_PHOTO_LIMIT } from './utils/newsPhotoSelection';
import { hasNewsDraft } from './utils/newsWriterState';

const WECHAT = 'wechat_article';
const statusLabels = { pending: '等待生成', running: '生成中', succeeded: '已生成 · 未保存', failed: '生成失败' };

function readDraft(key) {
  try { return key ? JSON.parse(localStorage.getItem(key) || 'null') : null; } catch (_) { return null; }
}

function dateLabel(value) {
  const date = new Date(value);
  return value && Number.isFinite(date.getTime())
    ? date.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : '';
}

async function loadRecoveryPhotos(ids = [], signal) {
  const selection = ids.slice(0, NEWS_PHOTO_LIMIT);
  const photos = [];
  // Bound concurrency and keep the original order. A removed photo must not block access to the text.
  for (let i = 0; i < selection.length; i += 5) {
    if (signal.aborted) break;
    const results = await Promise.allSettled(selection.slice(i, i + 5).map(id =>
      request(`/api/photos/${encodeURIComponent(id)}`, { method: 'GET', signal })));
    for (const result of results) {
      if (result.status !== 'fulfilled') continue;
      const photo = normalizeNewsPhoto(result.value);
      if (photo) {
        const { id, url, thumbUrl, description, tags, projectId, projectTitle, photographerId, photographerName } = photo;
        photos.push({ id, url, thumbUrl, description, tags, projectId, projectTitle, photographerId, photographerName });
      }
    }
  }
  return photos;
}

export default function WechatDraftRecovery({ draftKey, onOpen }) {
  const [items, setItems] = React.useState([]);
  const [attempt, setAttempt] = React.useState(0);
  const [failed, setFailed] = React.useState(false);
  const [opening, setOpening] = React.useState(null);
  const openingRef = React.useRef(null);
  const titleId = React.useId();
  const current = readDraft(draftKey);
  const previousKey = draftKey && draftKey + ':before-recovery';
  const previous = readDraft(previousKey);
  const hasLocal = hasNewsDraft(current);
  const hasPrevious = hasNewsDraft(previous);
  const remote = items.filter(row => String(row.batchId) !== String(current?.batchId));

  React.useEffect(() => {
    if (!draftKey) return undefined;
    const controller = new AbortController();
    setFailed(false);
    listRecoverableWechatDrafts(controller.signal).then(data => {
      if (!controller.signal.aborted) setItems(Array.isArray(data.items) ? data.items : []);
    }).catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [draftKey, attempt]);
  React.useEffect(() => () => openingRef.current?.abort(), []);

  const openDraft = draft => {
    const existing = readDraft(draftKey);
    if (draft && hasNewsDraft(existing)) {
      try { localStorage.setItem(previousKey, JSON.stringify(existing)); }
      catch (_) { Toast.error('当前草稿无法保留，未切换稿件'); return false; }
    }
    onOpen(draft);
    return true;
  };

  const openBatch = async item => {
    if (openingRef.current) return;
    const controller = new AbortController();
    openingRef.current = controller;
    setOpening(item.batchId);
    try {
      const batch = await getBatch(item.batchId, { recover: true, signal: controller.signal });
      const recovery = batch.recovery;
      if (!recovery || !batch.jobs?.some(job => job.channelKey === WECHAT)) throw Error('未找到可恢复的稿件');
      const photos = await loadRecoveryPhotos(recovery.selectedPhotoIds, controller.signal);
      if (controller.signal.aborted) return;
      const opened = openDraft({
        formValues: recovery.form, selectedPhotos: photos, interviewText: recovery.interviewText,
        advancedPrompt: recovery.writingRequirements, participantChips: recovery.participantChips,
        selectedChannels: batch.jobs.map(job => job.channelKey), activeChannelKey: WECHAT,
        batchId: batch.batchId, batchStatus: 'pending', generationStartedAt: new Date(batch.createdAt).getTime() || Date.now(),
        channelJobs: Object.fromEntries(batch.jobs.map(job => [job.channelKey, { jobId: job.jobId, status: job.status }])),
        savedAt: Date.now(),
      });
      if (opened && photos.length < (recovery.selectedPhotoIds?.length || 0)) Toast.info('部分照片暂不可读，稿件文字仍可恢复');
    } catch (_) {
      if (!controller.signal.aborted) Toast.error('暂时无法恢复稿件，请重试');
    } finally {
      openingRef.current = null;
      if (!controller.signal.aborted) setOpening(null);
    }
  };

  if (!draftKey || (!hasLocal && !hasPrevious && !remote.length && !failed)) return null;
  const localTitle = draft => draft.channelContent?.[WECHAT]?.title || draft.formValues?.eventName || '无标题内容稿';
  return <section className="wechat-draft-recovery" aria-labelledby={titleId}>
    <h3 id={titleId}>未保存稿件</h3>
    {hasLocal && <div className="wechat-recovery-row">
      <div><strong>{localTitle(current)}</strong><small>本机草稿 · {dateLabel(current.savedAt)}</small></div>
      <Button size="small" disabled={opening !== null} onClick={() => openDraft(null)}>继续编辑</Button>
    </div>}
    {hasPrevious && <div className="wechat-recovery-row">
      <div><strong>{localTitle(previous)}</strong><small>上一份本机草稿 · {dateLabel(previous.savedAt)}</small></div>
      <Button size="small" disabled={opening !== null} onClick={() => openDraft(previous)}>打开上一稿</Button>
    </div>}
    {remote.map(item => <div className="wechat-recovery-row" key={item.batchId}>
      <div><strong>{String(item.title || '').trim() || '无标题生成任务'}</strong>
        <small>{statusLabels[item.status] || '待恢复'} · {dateLabel(item.createdAt)}</small></div>
      <Button size="small" loading={opening === item.batchId} disabled={opening !== null}
        onClick={() => openBatch(item)}>{['pending', 'running'].includes(item.status) ? '查看进度' : '恢复稿件'}</Button>
    </div>)}
    {failed && <div className="wechat-recovery-row" role="status"><small>暂时无法读取线上稿件</small>
      <Button size="small" onClick={() => setAttempt(value => value + 1)}>重试</Button></div>}
  </section>;
}
