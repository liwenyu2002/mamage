import React from 'react';
import { Modal, Toast } from './ui';
import { request } from './services/request';
import { discardRecoverableWechatDraft, getBatch, listRecoverableWechatDrafts } from './services/newsMatrixService';
import { normalizeNewsPhoto, NEWS_PHOTO_LIMIT } from './utils/newsPhotoSelection';
import { hasNewsDraft } from './utils/newsWriterState';

const WECHAT = 'wechat_article';
const statusLabels = { pending: '等待生成', running: '生成中', failed: '生成失败' };

function readSnapshot(key) {
  try {
    const raw = localStorage.getItem(key);
    return { key, raw, draft: JSON.parse(raw || 'null') };
  } catch (_) { return { key, raw: null, draft: null }; }
}

function wechatSnapshots(key, previousKey) {
  if (!key) return [];
  return [readSnapshot(key), readSnapshot(previousKey)].filter(({ draft }) => {
    if (!hasNewsDraft(draft)) return false;
    // The writer also stores other platforms in this key. Don't offer to delete a different platform's draft.
    const channel = draft.selectedChannels?.[0] || draft.activeChannelKey;
    return channel ? channel === WECHAT : !Object.keys(draft.channelContent || {}).length || !!draft.channelContent?.[WECHAT];
  });
}

const sameBatch = (a, b) => Boolean(a && b) && String(a) === String(b);

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

export default function useWechatDraftRecovery(draftKey, onOpen) {
  const [items, setItems] = React.useState([]);
  const [attempt, reload] = React.useReducer(value => value + 1, 0);
  const [revision, refreshLocal] = React.useReducer(value => value + 1, 0);
  const [loading, setLoading] = React.useState(Boolean(draftKey));
  const [failed, setFailed] = React.useState(false);
  const [busy, setBusy] = React.useState(null);
  const operationRef = React.useRef(null);
  const listRef = React.useRef(null);
  const previousKey = draftKey && draftKey + ':before-recovery';
  const local = React.useMemo(() => wechatSnapshots(draftKey, previousKey), [draftKey, previousKey, revision]);

  React.useEffect(() => {
    if (!draftKey) return undefined;
    const controller = new AbortController();
    listRef.current = controller;
    setLoading(true);
    setFailed(false);
    listRecoverableWechatDrafts(controller.signal).then(data => {
      if (!controller.signal.aborted) setItems(Array.isArray(data.items) ? data.items : []);
    }).catch(() => { if (!controller.signal.aborted) setFailed(true); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [draftKey, attempt]);
  React.useEffect(() => {
    if (!draftKey) return undefined;
    const refresh = event => { if (event.key === draftKey || event.key === previousKey || event.key === null) refreshLocal(); };
    window.addEventListener('storage', refresh);
    return () => {
      operationRef.current?.controller?.abort();
      window.removeEventListener('storage', refresh);
    };
  }, [draftKey, previousKey]);

  const openDraft = draft => {
    const { draft: existing, raw } = readSnapshot(draftKey);
    if (draft && hasNewsDraft(existing)) {
      try { localStorage.setItem(previousKey, raw); }
      catch (_) { Toast.error('当前草稿无法保留，未切换稿件'); return false; }
    }
    onOpen(draft);
    return true;
  };

  const open = async item => {
    if (operationRef.current) return;
    if (item.local) {
      if (readSnapshot(item.local.key).raw !== item.local.raw) {
        refreshLocal();
        Toast.info('草稿已更新，请重新打开');
        return;
      }
      openDraft(item.local.key === draftKey ? null : item.local.draft);
      return;
    }
    const controller = new AbortController();
    const operation = { key: item.key, action: 'open', controller };
    operationRef.current = operation;
    setBusy(operation);
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
      operationRef.current = null;
      setBusy(null);
    }
  };

  const discard = item => Modal.confirm({
    title: '删除草稿',
    content: `确定删除「${item.name}」？已保存的推文不受影响。`,
    okText: '删除',
    cancelText: '取消',
    onOk: async () => {
      if (operationRef.current) return;
      const snapshots = wechatSnapshots(draftKey, previousKey);
      if (item.local && !snapshots.some(snapshot => snapshot.key === item.local.key && snapshot.raw === item.local.raw)) {
        refreshLocal();
        Toast.info('草稿已更新，未删除');
        return;
      }
      const targets = snapshots.filter(snapshot => item.batchId
        ? sameBatch(snapshot.draft.batchId, item.batchId) : snapshot.key === item.local?.key);
      const operation = { key: item.key, action: 'delete' };
      operationRef.current = operation;
      setBusy(operation);
      try {
        if (item.batchId) {
          try { await discardRecoverableWechatDraft(item.batchId); }
          catch (error) {
            // A local copy may outlive its batch; it can still be discarded.
            if (!item.local || error.status !== 404 || JSON.parse(error.body || '{}').code !== 4041) throw error;
          }
          listRef.current?.abort();
          setItems(previous => previous.filter(row => !sameBatch(row.batchId, item.batchId)));
          reload();
        }
        for (const snapshot of targets) {
          if (localStorage.getItem(snapshot.key) === snapshot.raw) localStorage.removeItem(snapshot.key);
        }
        Toast.success('草稿已删除');
      } catch (_) {
        Toast.error('删除草稿失败，请稍后重试');
      } finally {
        operationRef.current = null;
        setBusy(null);
        refreshLocal();
      }
    },
  });

  const drafts = [];
  if (draftKey) {
    for (const snapshot of local) {
      const { draft } = snapshot;
      if (drafts.some(item => sameBatch(item.batchId, draft.batchId) || item.local.raw === snapshot.raw)) continue;
      const online = items.find(item => sameBatch(item.batchId, draft.batchId));
      drafts.push({ key: snapshot.key, local: snapshot, batchId: draft.batchId,
        name: String(draft.channelContent?.[WECHAT]?.title || online?.title || draft.formValues?.eventName
          || String(draft.formValues?.sourceMaterial || '').trim().split('\n')[0].slice(0, 80) || '无标题推文').trim() || '无标题推文',
        updatedAt: draft.savedAt || online?.createdAt,
        status: statusLabels[online?.status || draft.batchStatus] || '草稿' });
    }
    for (const item of items) {
      if (drafts.some(draft => sameBatch(draft.batchId, item.batchId))) continue;
      drafts.push({ key: 'batch:' + item.batchId, batchId: item.batchId,
        name: String(item.title || '').trim() || '无标题推文', updatedAt: item.createdAt, status: statusLabels[item.status] || '草稿' });
    }
  }
  return { drafts, loading: !!draftKey && loading, failed: !!draftKey && failed, reload, busy, open, discard };
}
