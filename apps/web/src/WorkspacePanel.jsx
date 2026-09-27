import React from 'react';
import { Button, GlassSelect, Modal, MotionModal, SegmentedControl, Toast } from './ui';
import { IconChevronRight, IconShare } from './ui/icons';
import {
  listWorkspaceAlbums,
  listReceivedShares, listSentShares, getInternalShare, createInternalShare,
  retryInternalCopy,
  revokeInternalShare, listUnitMembers, searchUnitCandidates, listRecipients,
  setUnitMember, removeUnitMember, listFaceGrants, grantFaceSearch, revokeFaceSearch,
  listPublicShares, createPublicShare, revokePublicShare, listPendingPublicPhotos, approvePublicPhotos,
  getAiWorkspaceStats,
} from './services/workspaceService';
import { publicEntryUrl } from './services/networkService';
import './WorkspacePanel.css';

const MODES = [
  { value: 'read', label: '只读', detail: '实时同步，可查看和下载原片' },
  { value: 'copy', label: '可复制', detail: '生成独立副本，之后不随源相册变化' },
  { value: 'collaborate', label: '共同编辑', detail: '可继续上传和修改，最长 90 天' },
];

function WorkspaceSelect({ children, disabled, ...props }) {
  return <span className={`workspace-select${disabled ? ' is-disabled' : ''}`}>
    <select {...props} disabled={disabled}>{children}</select>
    <IconChevronRight className="workspace-select-chevron" />
  </span>;
}

function parseCopyResult(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch (_) { return null; }
}

function statusLabel(share) {
  if (share.revokedAt) return '已撤销';
  if (share.expiresAt && new Date(share.expiresAt).getTime() <= Date.now()) return '已过期';
  if (share.mode === 'copy') {
    if (share.copyStatus === 'ready') return '副本已就绪';
    if (share.copyStatus === 'failed') return '复制失败';
    return '正在复制';
  }
  return share.mode === 'collaborate' ? '共同编辑' : '只读';
}

function shortDate(value) {
  if (!value) return '永久有效';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '未知' : date.toLocaleDateString('zh-CN');
}

function expiryLabel(value) {
  return value ? `${shortDate(value)}到期` : '永久有效';
}

export default function WorkspacePanel({ visible, onClose, workspaceInfo, initialProjectId,
  initialPhotoIds = [], albumShareProject = null, onOpenProject }) {
  const activeUnitId = workspaceInfo?.activeUnitId;
  const activeUnit = workspaceInfo?.units?.find((unit) => Number(unit.id) === Number(activeUnitId));
  const albumShareProjectId = Number(albumShareProject?.id) || null;
  const canManage = Boolean(workspaceInfo?.collegeAdmin || activeUnit?.role === 'manager');
  const canShare = Boolean(workspaceInfo?.collegeAdmin || ['editor', 'manager'].includes(activeUnit?.role));
  const [tab, setTab] = React.useState('received');
  const [received, setReceived] = React.useState([]);
  const [sent, setSent] = React.useState([]);
  const [publicShares, setPublicShares] = React.useState([]);
  const [projects, setProjects] = React.useState([]);
  const [members, setMembers] = React.useState([]);
  const [faceGrants, setFaceGrants] = React.useState([]);
  const [aiStats, setAiStats] = React.useState([]);
  const [detail, setDetail] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [targetUnitId, setTargetUnitId] = React.useState('');
  const [targetUserId, setTargetUserId] = React.useState('');
  const [recipients, setRecipients] = React.useState([]);
  const [projectId, setProjectId] = React.useState('');
  const [mode, setMode] = React.useState('read');
  const [expiry, setExpiry] = React.useState('30');
  const [candidateQuery, setCandidateQuery] = React.useState('');
  const [candidates, setCandidates] = React.useState([]);
  const [candidateId, setCandidateId] = React.useState('');
  const [candidateRole, setCandidateRole] = React.useState('member');
  const [publicSync, setPublicSync] = React.useState('approval');
  const [publicExpiry, setPublicExpiry] = React.useState('30');
  const [pendingCode, setPendingCode] = React.useState('');
  const [pendingPhotos, setPendingPhotos] = React.useState([]);
  const [pendingIds, setPendingIds] = React.useState([]);
  const [closing, setClosing] = React.useState(false);
  const closeTimer = React.useRef(null);

  React.useEffect(() => () => window.clearTimeout(closeTimer.current), []);

  const handleCancel = () => {
    if (!albumShareProjectId) return onClose();
    if (closing) return;
    setClosing(true);
    closeTimer.current = window.setTimeout(onClose, 220);
  };

  const refreshLists = React.useCallback(async () => {
    const [inbox, outbox, publicLinks] = await Promise.all([
      albumShareProjectId ? [] : listReceivedShares(), listSentShares(), listPublicShares(),
    ]);
    setReceived(Array.isArray(inbox) ? inbox : []);
    setSent(Array.isArray(outbox) ? outbox : []);
    setPublicShares(Array.isArray(publicLinks) ? publicLinks : []);
  }, [albumShareProjectId]);

  React.useEffect(() => {
    if (!visible || !activeUnitId) return undefined;
    let live = true;
    setTab(albumShareProjectId ? (canShare ? 'create' : 'sent')
      : (initialPhotoIds.length || initialProjectId ? 'create' : 'received'));
    setProjectId(albumShareProjectId ? String(albumShareProjectId) : (initialProjectId ? String(initialProjectId) : ''));
    setDetail(null);
    Promise.all([
      refreshLists(),
      albumShareProjectId ? null : listWorkspaceAlbums().then((rows) => {
        if (live) setProjects(rows || []);
      }),
      !albumShareProjectId && canManage ? listUnitMembers(activeUnitId).then((rows) => { if (live) setMembers(rows || []); }) : null,
      !albumShareProjectId && canManage ? getAiWorkspaceStats().then((data) => { if (live) setAiStats(data.rows || []); }) : null,
      !albumShareProjectId && workspaceInfo?.collegeAdmin ? listFaceGrants().then((rows) => { if (live) setFaceGrants(rows || []); }) : null,
    ]).catch((err) => { if (live) Toast.error(err.message || '工作空间加载失败'); });
    return () => { live = false; };
  }, [visible, activeUnitId, initialProjectId, initialPhotoIds.length, albumShareProjectId, canManage, canShare,
    workspaceInfo?.collegeAdmin, refreshLists]);

  const visibleSent = albumShareProjectId
    ? sent.filter((share) => share.shareType === 'album' && Number(share.projectId) === albumShareProjectId)
    : sent;
  const visiblePublicShares = albumShareProjectId
    ? publicShares.filter((share) => Number(share.projectId) === albumShareProjectId)
    : publicShares;

  React.useEffect(() => {
    if (!visible || !targetUnitId) { setRecipients([]); return undefined; }
    let live = true;
    listRecipients(targetUnitId).then((rows) => { if (live) setRecipients(rows || []); })
      .catch(() => { if (live) setRecipients([]); });
    return () => { live = false; };
  }, [visible, targetUnitId]);

  React.useEffect(() => {
    if (!visible || !canManage || candidateQuery.trim().length < 2) {
      setCandidates([]);
      return undefined;
    }
    let live = true;
    const timer = setTimeout(() => {
      searchUnitCandidates(activeUnitId, candidateQuery.trim())
        .then((rows) => { if (live) setCandidates(rows || []); })
        .catch(() => { if (live) setCandidates([]); });
    }, 250);
    return () => { live = false; clearTimeout(timer); };
  }, [visible, canManage, activeUnitId, candidateQuery]);

  React.useEffect(() => {
    if (!visible || !received.some((share) => share.mode === 'copy' && !['ready', 'failed'].includes(share.copyStatus))) {
      return undefined;
    }
    const timer = setInterval(() => { refreshLists().catch(() => {}); }, 3000);
    return () => clearInterval(timer);
  }, [visible, received, refreshLists]);

  const openDetail = async (share) => {
    setBusy(true);
    try {
      const data = await getInternalShare(share.id);
      setDetail(data);
    } catch (err) { Toast.error(err.message || '分享已失效'); }
    finally { setBusy(false); }
  };

  const loadMoreDetail = async () => {
    if (!detail?.hasMore || busy) return;
    setBusy(true);
    try {
      const next = await getInternalShare(detail.id, detail.photos.length);
      setDetail((current) => current?.id === detail.id
        ? { ...next, photos: [...current.photos, ...(next.photos || [])] } : current);
    } catch (err) { Toast.error(err.message || '更多照片加载失败'); }
    finally { setBusy(false); }
  };

  const submitShare = async () => {
    const selectedProjectId = albumShareProjectId || Number(projectId);
    if (!targetUnitId) return Toast.warning('请选择接收部门');
    if (!initialPhotoIds.length && !selectedProjectId) return Toast.warning('请选择相册');
    setBusy(true);
    try {
      const body = {
        shareType: initialPhotoIds.length ? 'collection' : 'album',
        ...(initialPhotoIds.length ? { photoIds: initialPhotoIds } : { projectId: selectedProjectId }),
        targetUnitId: Number(targetUnitId), targetUserId: targetUserId ? Number(targetUserId) : null,
        mode,
        ...(expiry === 'permanent' ? { permanent: true } : { expiresInDays: Number(expiry) }),
      };
      await createInternalShare(body);
      await refreshLists();
      setTab('sent');
      Toast.success(mode === 'copy' ? '已开始生成独立副本' : '分享已创建');
    } catch (err) { Toast.error(err.message || '创建分享失败'); }
    finally { setBusy(false); }
  };

  const revoke = async (share) => {
    if (!window.confirm('撤销后，对方将不能继续访问此分享。确定撤销吗？')) return;
    setBusy(true);
    try { await revokeInternalShare(share.id); await refreshLists(); Toast.success('分享已撤销'); }
    catch (err) { Toast.error(err.message || '撤销失败'); }
    finally { setBusy(false); }
  };

  const retryCopy = async (share) => {
    setBusy(true);
    try {
      await retryInternalCopy(share.id);
      await refreshLists();
      Toast.success('已重新开始复制');
    } catch (err) { Toast.error(err.message || '重试失败'); }
    finally { setBusy(false); }
  };

  const addMember = async () => {
    if (!candidateId) return Toast.warning('请选择用户');
    setBusy(true);
    try {
      await setUnitMember(activeUnitId, candidateId, candidateRole);
      setMembers(await listUnitMembers(activeUnitId));
      setCandidateId('');
      setCandidateQuery('');
      Toast.success('成员已更新');
    } catch (err) { Toast.error(err.message || '更新成员失败'); }
    finally { setBusy(false); }
  };

  const submitPublicShare = async () => {
    const selectedProjectId = albumShareProjectId || Number(projectId);
    if (!selectedProjectId) return Toast.warning('请选择相册');
    setBusy(true);
    try {
      const created = await createPublicShare({
        shareType: 'project', projectId: selectedProjectId,
        syncMode: canManage ? publicSync : 'approval',
        expiresInSeconds: Number(publicExpiry) * 86400,
      });
      await refreshLists();
      const link = `${publicEntryUrl()}/share/${created.code}`;
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(link);
        Toast.success('公开链接已创建并复制');
      } else Toast.info(link);
    } catch (err) { Toast.error(err.message || '创建公开链接失败'); }
    finally { setBusy(false); }
  };

  const openPending = async (code) => {
    setBusy(true);
    try {
      const result = await listPendingPublicPhotos(code);
      setPendingCode(code);
      setPendingPhotos(result.photos || []);
      setPendingIds([]);
    } catch (err) { Toast.error(err.message || '待确认照片加载失败'); }
    finally { setBusy(false); }
  };

  const approvePending = async () => {
    if (!pendingIds.length) return Toast.warning('请选择照片');
    setBusy(true);
    try {
      await approvePublicPhotos(pendingCode, pendingIds);
      await refreshLists();
      await openPending(pendingCode);
      Toast.success('已同步到公开链接');
    } catch (err) { Toast.error(err.message || '确认失败'); }
    finally { setBusy(false); }
  };

  const changeFaceGrant = async (userId, granted) => {
    setBusy(true);
    try {
      if (granted) await grantFaceSearch(userId);
      else await revokeFaceSearch(userId);
      setFaceGrants(await listFaceGrants());
      Toast.success(granted ? '已授权人脸检索' : '已取消人脸检索授权');
    } catch (err) { Toast.error(err.message || '权限更新失败'); }
    finally { setBusy(false); }
  };

  const Dialog = albumShareProjectId ? MotionModal : Modal;

  return (
    <Dialog visible={visible && !closing} onCancel={handleCancel} title={albumShareProjectId ? '分享相册' : (activeUnit?.name || '工作空间')}
      className={`workspace-dialog${albumShareProjectId ? ' is-album-share' : ''}`}
      width={albumShareProjectId ? 700 : 920} bodyStyle={{ maxHeight: 'min(76vh, 760px)', overflowY: 'auto' }} footer={null}>
      {!activeUnitId ? <div className="workspace-empty">历史相册暂不支持部门分享，请先切换到一个部门。</div> : <>
        {albumShareProjectId ? (
          <div className="workspace-album-summary">
            <span>当前相册</span>
            <strong title={albumShareProject.title}>{albumShareProject.title || '未命名相册'}</strong>
            <span>{activeUnit?.name}</span>
          </div>
        ) : null}
        {albumShareProjectId ? <SegmentedControl className="workspace-album-tabs" kind="tabs" label="相册分享方式"
          value={tab} onChange={(next) => { setTab(next); setDetail(null); }}
          options={(canShare ? [
            ['create', '部门分享'], ['public', '公开链接'], ['sent', '部门记录'],
          ] : [['sent', '部门记录']]).map(([value, label]) => ({ value, label }))} />
          : <div className="workspace-tabs" role="tablist" aria-label="工作空间">
          {([
            ['received', '与我共享'], ['sent', '已发分享'],
            ...(canShare ? [['create', '创建分享']] : []),
            ...(canShare ? [['public', '公开链接']] : []),
            ...(canManage ? [['members', '成员']] : []),
          ]).map(([key, label]) => (
            <button type="button" role="tab" aria-selected={tab === key} key={key}
              className={tab === key ? 'is-active' : ''} onClick={() => { setTab(key); setDetail(null); }}>
              {label}
            </button>
          ))}
        </div>}

        {tab === 'received' && <div className="workspace-section">
          {!received.length ? <div className="workspace-empty">暂无收到的分享</div> : received.map((share) => {
            const copy = parseCopyResult(share.copyResult);
            const origin = [share.sourceOrganizationName, share.sourceUnitName].filter(Boolean).join(' / ');
            return <div className="workspace-row" key={share.id}>
              <div className="workspace-row-main">
                <strong>{share.albumName || (share.shareType === 'collection' ? '照片集合' : '相册')}</strong>
                {origin ? <span className="workspace-share-origin">来自 {origin}</span> : null}
                <span className="workspace-row-meta">
                  {share.sharedByName ? <span>{share.sharedByName} 分享</span> : null}
                  <span className={`workspace-status${share.copyStatus === 'failed' ? ' is-error' : ''}`}>{statusLabel(share)}</span>
                  <span>{expiryLabel(share.expiresAt)}</span>
                </span>
              </div>
              {copy?.projectId ? <button type="button" onClick={() => { onOpenProject(copy.projectId); onClose(); }}>打开副本</button>
                : share.mode === 'copy' && share.copyStatus === 'failed'
                  ? <button type="button" disabled={busy} onClick={() => retryCopy(share)}>重试</button>
                  : share.mode !== 'copy' ? <button type="button" disabled={busy} onClick={() => openDetail(share)}>查看</button> : null}
            </div>;
          })}
          {detail && <div className="workspace-share-detail">
            <div className="workspace-detail-head">
              <strong>{detail.albumName || '共享照片'}</strong>
              <button type="button" onClick={() => setDetail(null)} aria-label="关闭分享预览">×</button>
            </div>
            <div className="workspace-share-context">
              来自 {[detail.sourceOrganizationName, detail.sourceUnitName].filter(Boolean).join(' / ')}
              {detail.sharedByName ? ` · ${detail.sharedByName} 分享` : ''}
              {detail.createdAt ? ` · ${shortDate(detail.createdAt)}` : ''}
            </div>
            {detail.mode === 'collaborate' && detail.projectId &&
              <button type="button" onClick={() => { onOpenProject(detail.projectId); onClose(); }}>打开相册编辑</button>}
            <div className="workspace-photo-grid">
              {(detail.photos || []).map((photo) => <a key={photo.id} href={photo.url} target="_blank" rel="noreferrer"
                title={photo.title || '打开原片'}>
                <img src={photo.thumbUrl || photo.url} alt={photo.title || '共享照片'} loading="lazy" />
                <span>{photo.title || (photo.type === 'video' ? '视频' : '照片')}</span>
              </a>)}
            </div>
            {detail.hasMore && <button type="button" disabled={busy} onClick={loadMoreDetail}>
              {busy ? '加载中' : `加载更多（${detail.photos.length}/${detail.total}）`}
            </button>}
          </div>}
        </div>}

        {tab === 'sent' && <div className="workspace-section">
          {!visibleSent.length ? <div className="workspace-empty">还没有发出的部门分享</div> : visibleSent.map((share) =>
            <div className="workspace-row" key={share.id}>
              <div className="workspace-row-main">
                <strong>{share.albumName || '照片集合'}</strong>
                <span className="workspace-row-meta">
                  <span>发给 {share.targetUserName || share.targetUnitName}</span>
                  <span className={`workspace-status${share.copyStatus === 'failed' ? ' is-error' : ''}`}>{statusLabel(share)}</span>
                  <span>{expiryLabel(share.expiresAt)}</span>
                </span>
              </div>
              {!share.revokedAt && <button type="button" disabled={busy} onClick={() => revoke(share)}>撤销</button>}
            </div>)}
        </div>}

        {tab === 'create' && canShare && (albumShareProjectId ? <div className="workspace-album-form">
          <div className="workspace-album-fields">
            <GlassSelect label="接收部门" value={targetUnitId} placeholder="选择部门"
              options={(workspaceInfo?.shareTargets || [])
                .filter((unit) => Number(unit.id) !== Number(activeUnitId))
                .map((unit) => ({ value: String(unit.id), label: unit.name }))}
              onChange={(next) => { setTargetUnitId(String(next)); setTargetUserId(''); }} />
            <GlassSelect label="接收人" value={targetUserId} disabled={!targetUnitId}
              options={targetUnitId ? [
                { value: '', label: '部门所有成员' },
                ...recipients.map((person) => ({ value: String(person.id), label: person.name || person.email })),
              ] : [{ value: '', label: '先选择部门' }]}
              onChange={(next) => setTargetUserId(String(next))} />
          </div>
          <div className="workspace-album-mode">
            <span className="mamage-field-label">分享方式</span>
            <SegmentedControl label="分享方式" options={MODES} value={mode} onChange={(next) => {
              setMode(next);
              if (next === 'collaborate' && expiry === 'permanent') setExpiry('30');
            }} />
            <p className="workspace-mode-help" key={mode}>{MODES.find((option) => option.value === mode)?.detail}</p>
          </div>
          <div className="workspace-album-actions">
            <GlassSelect label="有效期" value={expiry} upward
              options={[
                { value: '7', label: '7 天' }, { value: '30', label: '30 天' }, { value: '90', label: '90 天' },
                ...(mode === 'collaborate' ? [] : [{ value: 'permanent', label: '永久' }]),
              ]} onChange={(next) => setExpiry(String(next))} />
            <Button type="primary" theme="neu" icon={<IconShare />} loading={busy}
              disabled={!targetUnitId} onClick={submitShare}>分享给部门</Button>
          </div>
        </div> : <div className="workspace-form">
          {!albumShareProjectId ? <label className="workspace-field"><span className="workspace-field-label">分享素材</span>
            {initialPhotoIds.length ? <span className="workspace-selected-count">{initialPhotoIds.length} 项选中素材</span> :
              <WorkspaceSelect value={projectId} onChange={(event) => setProjectId(event.target.value)}>
                <option value="">选择相册</option>
                {projects.map((project) => <option key={project.id} value={project.id}>{project.name || project.title}</option>)}
              </WorkspaceSelect>}
          </label> : null}
          <label className="workspace-field"><span className="workspace-field-label">接收部门</span>
            <WorkspaceSelect value={targetUnitId} onChange={(event) => { setTargetUnitId(event.target.value); setTargetUserId(''); }}>
              <option value="">选择部门</option>
              {(workspaceInfo?.shareTargets || []).filter((unit) => Number(unit.id) !== Number(activeUnitId))
                .map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}
            </WorkspaceSelect>
          </label>
          <label className="workspace-field"><span className="workspace-field-label">接收人</span>
            <WorkspaceSelect value={targetUserId} disabled={!targetUnitId} onChange={(event) => setTargetUserId(event.target.value)}>
              <option value="">部门所有成员</option>
              {recipients.map((person) => <option key={person.id} value={person.id}>{person.name || person.email}</option>)}
            </WorkspaceSelect>
          </label>
          <div className="workspace-mode-field">
            <span className="workspace-field-label">分享方式</span>
            <div className="workspace-mode-list" role="radiogroup" aria-label="分享方式">
              {MODES.map((option) => <label key={option.value} className={mode === option.value ? 'is-selected' : ''}>
                <input type="radio" name="workspace-share-mode" value={option.value} checked={mode === option.value}
                  onChange={() => { setMode(option.value); if (expiry === 'permanent' && option.value === 'collaborate') setExpiry('30'); }} />
                <strong>{option.label}</strong>
              </label>)}
            </div>
            <p className="workspace-mode-help">{MODES.find((option) => option.value === mode)?.detail}</p>
          </div>
          <label className="workspace-field"><span className="workspace-field-label">有效期</span>
            <WorkspaceSelect value={expiry} onChange={(event) => setExpiry(event.target.value)}>
              <option value="7">7 天</option><option value="30">30 天</option><option value="90">90 天</option>
              {mode !== 'collaborate' && <option value="permanent">永久</option>}
            </WorkspaceSelect>
          </label>
          <div className="workspace-form-actions">
            <button type="button" disabled={busy || !targetUnitId} onClick={submitShare}>
              <IconShare />{busy ? '正在处理' : '分享给部门'}
            </button>
          </div>
        </div>)}

        {tab === 'public' && canShare && <div className="workspace-section">
          {albumShareProjectId ? <div className="workspace-album-public-form">
            <div className="workspace-album-fields">
              <GlassSelect label="新增照片" value={publicSync} disabled={!canManage}
                options={[
                  { value: 'approval', label: '新增照片需负责人确认' },
                  ...(canManage ? [{ value: 'automatic', label: '新增照片自动同步' }] : []),
                ]} onChange={(next) => setPublicSync(String(next))} />
              <GlassSelect label="有效期" value={publicExpiry}
                options={[{ value: '7', label: '7 天' }, { value: '30', label: '30 天' }, { value: '90', label: '90 天' }]}
                onChange={(next) => setPublicExpiry(String(next))} />
            </div>
            <div className="workspace-album-actions">
              <p>链接可查看和下载照片。</p>
              <Button type="primary" theme="neu" icon={<IconShare />} loading={busy}
                onClick={submitPublicShare}>创建链接</Button>
            </div>
          </div> : <div className="workspace-public-create">
            {!albumShareProjectId ? <label className="workspace-field"><span className="workspace-field-label">相册</span><WorkspaceSelect value={projectId} onChange={(event) => setProjectId(event.target.value)} aria-label="选择公开分享相册">
              <option value="">选择相册</option>
              {projects.map((project) => <option key={project.id} value={project.id}>{project.name || project.title}</option>)}
            </WorkspaceSelect></label> : null}
            <label className="workspace-field"><span className="workspace-field-label">新增照片</span><WorkspaceSelect value={publicSync} disabled={!canManage}
              onChange={(event) => setPublicSync(event.target.value)} aria-label="新增照片同步方式">
              <option value="approval">新增照片需负责人确认</option>
              {canManage && <option value="automatic">新增照片自动同步</option>}
            </WorkspaceSelect></label>
            <label className="workspace-field"><span className="workspace-field-label">有效期</span><WorkspaceSelect value={publicExpiry} onChange={(event) => setPublicExpiry(event.target.value)} aria-label="公开链接有效期">
              <option value="7">7 天</option><option value="30">30 天</option><option value="90">90 天</option>
            </WorkspaceSelect></label>
            <button type="button" disabled={busy || !(albumShareProjectId || projectId)} onClick={submitPublicShare}>创建链接</button>
          </div>}
          {visiblePublicShares.map((share) => <div className="workspace-row" key={share.code}>
            <div className="workspace-row-main">
              <strong>{share.albumName || share.title || '照片集合'}</strong>
              <span>{share.syncMode === 'automatic' ? '自动同步' : '人工确认'} · {expiryLabel(share.expiresAt)}
                {Number(share.pendingCount) > 0 ? ` · ${share.pendingCount} 张待确认` : ''}</span>
            </div>
            <button type="button" onClick={() => {
              const link = `${publicEntryUrl()}/share/${share.code}`;
              if (navigator.clipboard?.writeText) {
                navigator.clipboard.writeText(link).then(() => Toast.success('链接已复制'))
                  .catch(() => Toast.info(link));
              } else Toast.info(link);
            }}>复制链接</button>
            {canManage && Number(share.pendingCount) > 0 && <button type="button" disabled={busy}
              onClick={() => openPending(share.code)}>确认照片</button>}
            <button type="button" disabled={busy} onClick={async () => {
              if (!window.confirm('撤销这个公开链接吗？')) return;
              setBusy(true);
              try { await revokePublicShare(share.code); await refreshLists(); Toast.success('链接已撤销'); }
              catch (err) { Toast.error(err.message || '撤销失败'); }
              finally { setBusy(false); }
            }}>撤销</button>
          </div>)}
          {pendingCode && <div className="workspace-share-detail">
            <div className="workspace-detail-head"><strong>待确认照片</strong>
              <button type="button" onClick={() => setPendingCode('')} aria-label="关闭待确认照片">×</button></div>
            <div className="workspace-photo-grid">
              {pendingPhotos.map((photo) => <label className="workspace-pending-photo" key={photo.id}>
                <img src={photo.thumbUrl} alt={photo.title || '待确认照片'} loading="lazy" />
                <span><input type="checkbox" checked={pendingIds.includes(photo.id)} onChange={(event) =>
                  setPendingIds((ids) => event.target.checked ? [...ids, photo.id] : ids.filter((id) => id !== photo.id))} />
                  {photo.title || '照片'}</span>
              </label>)}
            </div>
            <button type="button" disabled={busy || !pendingIds.length} onClick={approvePending}>确认选中照片</button>
          </div>}
        </div>}

        {tab === 'members' && canManage && <div className="workspace-section">
          {aiStats.length > 0 && <div className="workspace-stats">
            <strong>近 30 天 AI 使用</strong>
            {aiStats.map((item) => <span key={item.unitId || 'legacy'}>
              {item.unitName || '历史'}：{item.jobCount} 次 · {item.tokensUsed} tokens
            </span>)}
          </div>}
          <div className="workspace-member-add">
            <input value={candidateQuery} onChange={(event) => { setCandidateQuery(event.target.value); setCandidateId(''); }}
              placeholder="搜索姓名或邮箱" aria-label="搜索学院成员" />
            <WorkspaceSelect value={candidateId} onChange={(event) => setCandidateId(event.target.value)} aria-label="选择成员">
              <option value="">选择用户</option>
              {candidates.map((person) => <option key={person.id} value={person.id}>{person.name} · {person.email}</option>)}
            </WorkspaceSelect>
            <WorkspaceSelect value={candidateRole} onChange={(event) => setCandidateRole(event.target.value)} aria-label="部门角色">
              <option value="member">成员</option><option value="editor">编辑</option>
              {workspaceInfo?.collegeAdmin && <option value="manager">负责人</option>}
            </WorkspaceSelect>
            <button type="button" disabled={busy || !candidateId} onClick={addMember}>添加</button>
            {workspaceInfo?.collegeAdmin && candidateId && <button type="button" disabled={busy}
              onClick={() => changeFaceGrant(candidateId, true)}>授权人脸检索</button>}
          </div>
          {members.map((member) => <div className="workspace-row" key={member.id}>
            <div className="workspace-row-main"><strong>{member.name}</strong><span>{member.email} · {member.role}</span></div>
            {workspaceInfo?.collegeAdmin && <button type="button" disabled={busy}
              onClick={() => changeFaceGrant(member.id, !faceGrants.some((grant) => Number(grant.userId) === Number(member.id)))}>
              {faceGrants.some((grant) => Number(grant.userId) === Number(member.id)) ? '取消人脸授权' : '授权人脸检索'}
            </button>}
            <button type="button" disabled={busy || (member.role === 'manager' && !workspaceInfo?.collegeAdmin)}
              onClick={async () => {
                if (!window.confirm(`移除 ${member.name} 吗？`)) return;
                setBusy(true);
                try { await removeUnitMember(activeUnitId, member.id); setMembers(await listUnitMembers(activeUnitId)); Toast.success('已移除成员'); }
                catch (err) { Toast.error(err.message || '移除失败'); }
                finally { setBusy(false); }
              }}>移除</button>
          </div>)}
        </div>}
      </>}
    </Dialog>
  );
}
