import React from 'react';
import { Modal, Input, TextArea, DatePicker, DateTimePicker, Toast } from './ui';
import { sectionTimeToInputValue, inputValueToSectionTime } from './utils/sectionTime';
import './CreateAlbumModal.css';
import { getUploadFileLimitError, uploadPhotoFiles } from './services/photoService';
import { getProjectById } from './services/projectService';
import { getPermissions } from './permissions/permissionStore';
import {
  createInitialUploadProgress,
  formatUploadBytes,
  formatUploadRemainingTime,
  getUploadPhaseLabel,
  getUploadProgressTitle,
  reduceUploadProgress,
} from './utils/uploadProgress';

function TagChip({ tag, onRemove }) {
  const [hover, setHover] = React.useState(false);
  return (
    <div className="cam-tag" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <span className="cam-tag-text">{tag}</span>
      {hover && <button className="cam-tag-remove" onClick={(e) => { e.stopPropagation(); onRemove(tag); }}>×</button>}
    </div>
  );
}

function isVideoFile(file) {
  const mime = String(file && file.type || '').toLowerCase();
  if (mime.startsWith('video/')) return true;
  const name = String(file && file.name || '').toLowerCase();
  return /\.(mp4|m4v|mov|webm|ogv|ogg)$/i.test(name);
}

export default function CreateAlbumModal({ visible, onClose, onCreated, createProject }) {
  const [name, setName] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [tagInput, setTagInput] = React.useState('');
  const [tags, setTags] = React.useState([]);
  const [startDate, setStartDate] = React.useState(null);
  const [timelineEnabled, setTimelineEnabled] = React.useState(false);
  const [timelineSections, setTimelineSections] = React.useState(() => [{ key: 1, name: '', sectionTime: '' }]);
  const [submitting, setSubmitting] = React.useState(false);
  const [userPermissions, setUserPermissions] = React.useState(() => getPermissions());
  const [stagingFiles, setStagingFiles] = React.useState([]);
  const [stagingPreviews, setStagingPreviews] = React.useState([]);
  // 与 stagingFiles 平行：每个文件归属的环节本地 key（'' = 未归类）
  const [stagingSectionKeys, setStagingSectionKeys] = React.useState([]);
  const filePickerRef = React.useRef(null);
  const pendingSectionKeyRef = React.useRef('');
  const [uploadProgress, setUploadProgress] = React.useState(null);
  const sectionKeyRef = React.useRef(2);

  React.useEffect(() => {
    if (!visible) {
      setName('');
      setDescription('');
      setTagInput('');
      setTags([]);
      setStartDate(null);
      setTimelineEnabled(false);
      setTimelineSections([{ key: 1, name: '', sectionTime: '' }]);
      sectionKeyRef.current = 2;
      setSubmitting(false);
      stagingPreviews.forEach((u) => { try { URL.revokeObjectURL(u); } catch (e) {} });
      setStagingFiles([]);
      setStagingPreviews([]);
      setStagingSectionKeys([]);
      setUploadProgress(null);
    }
  }, [visible]);

  React.useEffect(() => {
    if (!visible) return;
    setUserPermissions(getPermissions());
  }, [visible]);

  const addTag = React.useCallback((t) => {
    const val = (t || '').trim();
    if (!val) return;
    if (tags.includes(val)) return;
    if (tags.length >= 20) return Toast.warning('标签数量达到上限');
    setTags((s) => [...s, val]);
  }, [tags]);

  const removeTag = React.useCallback((t) => setTags((s) => s.filter((x) => x !== t)), []);

  const normalizedTimelineSections = React.useMemo(() => timelineSections
    .map((section, idx) => ({
      sourceKey: section.key,
      name: String(section.name || '').trim(),
      sectionTime: String(section.sectionTime || '').trim(),
      sortOrder: idx,
    }))
    .filter((section) => section.name)
    .map((section) => ({
      ...section,
      sectionTime: section.sectionTime || null,
    })), [timelineSections]);

  // 环节被删除后，归属它的暂存文件回落"未归类"
  React.useEffect(() => {
    const valid = new Set(normalizedTimelineSections.map((s) => String(s.sourceKey)));
    setStagingSectionKeys((prev) => prev.map((k) => (k && !valid.has(String(k)) ? '' : k)));
  }, [normalizedTimelineSections]);

  // 分环节的暂存容器（与相册内上传弹窗一致）；未启用时间轴则单容器
  const stagedUploadGroups = React.useMemo(() => {
    const items = stagingFiles.map((file, index) => ({
      file,
      index,
      preview: stagingPreviews[index],
      key: String(stagingSectionKeys[index] || ''),
    }));
    if (!timelineEnabled || !normalizedTimelineSections.length) {
      return [{ key: '', name: '待上传媒体', sectionTime: '', items }];
    }
    const groups = normalizedTimelineSections.map((section) => ({
      key: String(section.sourceKey),
      name: section.name,
      sectionTime: section.sectionTime || '',
      items: [],
    }));
    const byKey = new Map(groups.map((group) => [group.key, group]));
    const unassigned = { key: '', name: '未归类', sectionTime: '', items: [] };
    items.forEach((item) => {
      (byKey.get(item.key) || unassigned).items.push(item);
    });
    return unassigned.items.length ? [...groups, unassigned] : groups;
  }, [stagingFiles, stagingPreviews, stagingSectionKeys, timelineEnabled, normalizedTimelineSections]);

  const addTimelineSection = React.useCallback(() => {
    const key = sectionKeyRef.current;
    sectionKeyRef.current += 1;
    setTimelineSections((prev) => [...prev, { key, name: '', sectionTime: '' }]);
  }, []);

  const updateTimelineSection = React.useCallback((key, patch) => {
    setTimelineSections((prev) => prev.map((section) => (
      section.key === key ? { ...section, ...patch } : section
    )));
  }, []);

  const removeTimelineSection = React.useCallback((key) => {
    setTimelineSections((prev) => {
      if (prev.length <= 1) return [{ ...prev[0], name: '', sectionTime: '' }];
      return prev.filter((section) => section.key !== key);
    });
  }, []);

  // 环节排序：桌面拖拽 ⠿，移动端 ↑↓
  const [dragSectionIdx, setDragSectionIdx] = React.useState(null);
  const [dragOverSectionIdx, setDragOverSectionIdx] = React.useState(null);
  const [isMobileLayout, setIsMobileLayout] = React.useState(() => {
    try { return typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches; } catch (e) { return false; }
  });
  React.useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const mq = window.matchMedia('(max-width: 768px)');
    const onChange = (e) => setIsMobileLayout(e.matches);
    try { mq.addEventListener('change', onChange); } catch (err) { mq.addListener(onChange); }
    setIsMobileLayout(mq.matches);
    return () => {
      try { mq.removeEventListener('change', onChange); } catch (err) { mq.removeListener(onChange); }
    };
  }, []);

  const moveTimelineSection = React.useCallback((idx, direction) => {
    setTimelineSections((prev) => {
      const target = idx + direction;
      if (idx < 0 || idx >= prev.length || target < 0 || target >= prev.length) return prev;
      const next = prev.slice();
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  }, []);

  const commitSectionDrag = React.useCallback((targetIdx) => {
    const from = dragSectionIdx;
    setDragSectionIdx(null);
    setDragOverSectionIdx(null);
    if (from === null || targetIdx === null || from === targetIdx) return;
    setTimelineSections((prev) => {
      if (from < 0 || from >= prev.length || targetIdx < 0 || targetIdx >= prev.length) return prev;
      const next = prev.slice();
      const [moved] = next.splice(from, 1);
      next.splice(targetIdx, 0, moved);
      return next;
    });
  }, [dragSectionIdx]);

  const onTagKeyDown = React.useCallback((e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      const v = tagInput.trim();
      if (v) addTag(v);
      setTagInput('');
    }
  }, [tagInput, addTag]);

  const handleFilesSelected = React.useCallback((files, sectionKey = '') => {
    const incoming = Array.from(files || []);
    if (!incoming.length) return;
    const acceptedIncoming = [];
    let oversizedCount = 0;
    incoming.forEach((file) => {
      if (getUploadFileLimitError(file)) {
        oversizedCount += 1;
        return;
      }
      acceptedIncoming.push(file);
    });
    if (oversizedCount > 0) {
      try { Toast.warning(`已跳过 ${oversizedCount} 个超过 3GB 的视频`); } catch (e) {}
    }
    if (!acceptedIncoming.length) return;

    setStagingFiles((prevFiles) => {
      const prevSigs = new Set(prevFiles.map((f) => `${f.name}::${f.size}::${f.lastModified}`));
      const toAdd = [];
      let dupCount = 0;
      for (const f of acceptedIncoming) {
        const sig = `${f.name}::${f.size}::${f.lastModified}`;
        if (prevSigs.has(sig)) {
          dupCount += 1;
          continue;
        }
        prevSigs.add(sig);
        toAdd.push(f);
      }

      if (dupCount > 0) {
        try { Toast.warning(`已跳过 ${dupCount} 个重复文件`); } catch (e) {}
      }

      const combined = [...prevFiles, ...toAdd];

      setStagingPreviews((prevPreviews) => {
        const newPreviews = toAdd.map((f) => (isVideoFile(f) ? '' : URL.createObjectURL(f)));
        return [...prevPreviews, ...newPreviews];
      });
      setStagingSectionKeys((prevKeys) => [...prevKeys, ...toAdd.map(() => String(sectionKey || ''))]);

      return combined;
    });
    setUploadProgress(null);
  }, []);

  const removeStagingFile = React.useCallback((index) => {
    setStagingFiles((prev) => {
      const next = [...prev];
      next.splice(index, 1);
      return next;
    });
    setStagingPreviews((prev) => {
      const next = [...prev];
      const removed = next.splice(index, 1);
      if (removed && removed[0]) {
        try { URL.revokeObjectURL(removed[0]); } catch (e) {}
      }
      return next;
    });
    setStagingSectionKeys((prev) => {
      const next = [...prev];
      next.splice(index, 1);
      return next;
    });
    setUploadProgress(null);
  }, []);

  const assignStagingFileSection = React.useCallback((index, sectionKey) => {
    setStagingSectionKeys((prev) => {
      const next = [...prev];
      next[index] = String(sectionKey || '');
      return next;
    });
  }, []);

  const openFilePicker = React.useCallback((sectionKey = '') => {
    pendingSectionKeyRef.current = String(sectionKey || '');
    filePickerRef.current?.click();
  }, []);

  const uploadProgressItems = React.useMemo(() => {
    if (!uploadProgress || !uploadProgress.items) return [];
    return (uploadProgress.order || [])
      .map((key) => uploadProgress.items[key])
      .filter(Boolean);
  }, [uploadProgress]);

  const handleSubmit = React.useCallback(async () => {
    if (!name.trim()) return Toast.warning('相册名称为必填项');
    if (timelineEnabled && normalizedTimelineSections.length === 0) {
      return Toast.warning('开启时间轴后至少需要填写一个环节名称');
    }
    setSubmitting(true);
    try {
      const payloadSections = normalizedTimelineSections.map(({ name: sectionName, sectionTime, sortOrder }) => ({
        name: sectionName,
        sectionTime,
        sortOrder,
      }));
      const payload = {
        title: name.trim(),
        description: description.trim() || undefined,
        ...(userPermissions.includes('projects.create') && tags && tags.length ? { tags } : {}),
        timelineEnabled,
        timelineSections: timelineEnabled ? payloadSections : [],
        eventDate: startDate
          ? (startDate instanceof Date
            ? `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}-${String(startDate.getDate()).padStart(2, '0')}`
            : String(startDate).slice(0, 10))
          : undefined,
      };

      let result;
      if (typeof createProject === 'function') {
        result = await createProject(payload);
      } else if (typeof onCreated === 'function') {
        result = await onCreated(payload);
      }

      Toast.success('已创建相册');

      try {
        const filesToUpload = (stagingFiles && stagingFiles.length) ? stagingFiles : [];
        console.debug('[CreateAlbumModal] filesToUpload count', filesToUpload.length, 'stagingFiles count', (stagingFiles && stagingFiles.length) || 0);
        const projectId = result && (result.id || result._id || result.projectId || (result.id === 0 ? result.id : null)) || null;

        if (filesToUpload.length === 0) {
          if (typeof onCreated === 'function') {
            try { await onCreated(result); } catch (e) { /* ignore */ }
          }
        }

        if (filesToUpload.length > 0) {
          if (!projectId) {
            Toast.warning('已创建相册，但未获取到相册 ID，媒体未自动上传');
          } else {
            try {
              const token = (typeof window !== 'undefined') ? (localStorage.getItem('mamage_jwt_token') || '') : '';
              console.debug('[CreateAlbumModal] starting uploads', { projectId, tokenPresent: !!token, files: filesToUpload.length });
              if (!token) {
                Toast.warning('未检测到登录 token，上传可能会失败');
              }
            } catch (e) {}

            try {
              setUploadProgress(createInitialUploadProgress(filesToUpload));
              const handleProgress = (event) => {
                setUploadProgress((prev) => reduceUploadProgress(prev, event));
              };
              // 本地环节 key → 创建后的真实 section id（按 name+sortOrder 匹配）
              const createdSections = Array.isArray(result && result.timelineSections) ? result.timelineSections : [];
              const createdIdForKey = (sourceKey) => {
                if (!timelineEnabled || !sourceKey) return undefined;
                const local = normalizedTimelineSections.find((section) => String(section.sourceKey) === String(sourceKey));
                if (!local) return undefined;
                const matched = createdSections.find((section) => String(section.name || '') === local.name && Number(section.sortOrder || 0) === Number(local.sortOrder || 0))
                  || createdSections.find((section) => String(section.name || '') === local.name);
                return matched && matched.id ? matched.id : undefined;
              };
              // 按归属环节分组上传（文件在各自环节容器里选择/拖入）
              const groupsByKey = new Map();
              filesToUpload.forEach((file, index) => {
                const key = String(stagingSectionKeys[index] || '');
                if (!groupsByKey.has(key)) groupsByKey.set(key, []);
                groupsByKey.get(key).push(file);
              });
              const results = [];
              for (const [sourceKey, groupFiles] of groupsByKey) {
                const groupResults = await uploadPhotoFiles(groupFiles, {
                  projectId,
                  timelineSectionId: createdIdForKey(sourceKey),
                  onProgress: handleProgress,
                });
                results.push(...groupResults);
              }
              const rejected = results.filter((r) => r.status === 'rejected');
              if (rejected.length > 0) {
                console.error('[CreateAlbumModal] some uploads failed', rejected);
                const firstUserMessage = rejected.map((item) => item && item.error && item.error.userMessage).find(Boolean);
                try { Toast.error(firstUserMessage || `部分媒体上传失败：${rejected.length} 个`); } catch (e) {}
              } else {
                try { Toast.success('已上传所选媒体'); } catch (e) {}
              }
            } catch (e) {
              console.error('parallel uploads failed unexpectedly', e);
              try { Toast.error((e && e.userMessage) || '媒体上传失败'); } catch (ee) {}
            }

            try {
              const full = await getProjectById(projectId);
              if (typeof onCreated === 'function') {
                try { await onCreated(full); } catch (e) { /* ignore caller errors */ }
              }
            } catch (e) {
              console.warn('Failed to reload project after uploads', e);
              if (typeof onCreated === 'function') {
                try { await onCreated(result); } catch (err) { /* ignore */ }
              }
            }
          }
        }
      } catch (e) {
        console.error('post-create upload failed', e);
      }

      if (onClose) onClose();
    } catch (e) {
      console.error('create project failed', e);
      Toast.error('创建失败');
    } finally {
      setSubmitting(false);
    }
  }, [name, description, tags, startDate, timelineEnabled, normalizedTimelineSections, stagingSectionKeys, createProject, onCreated, onClose, stagingFiles, userPermissions]);

  return (
    <Modal
      title="新建相册"
      visible={visible}
      onCancel={submitting ? () => Toast.warning('正在创建或上传，请等待完成') : onClose}
      onOk={handleSubmit}
      okButtonProps={{ loading: submitting }}
      cancelText="取消"
      okText="创建"
      closable={!submitting}
    >
      <div className="cam-form">
        <Input value={name} onChange={(v) => setName(v)} placeholder="相册名称（必填）" />
        <TextArea value={description} onChange={(v) => setDescription(v)} rows={3} placeholder="相册描述（可选）" />

        <div className={`cam-timeline-panel${timelineEnabled ? ' is-enabled' : ''}`}>
          <label className="cam-timeline-toggle">
            <input
              type="checkbox"
              checked={timelineEnabled}
              onChange={(e) => setTimelineEnabled(e.target.checked)}
            />
            <span>
              <strong>添加时间轴</strong>
              <em>用于按活动环节上传和浏览媒体</em>
            </span>
          </label>

          {timelineEnabled ? (
            <div className="cam-timeline-sections">
              {timelineSections.map((section, idx) => (
                <div
                  className={`cam-timeline-row${dragOverSectionIdx === idx && dragSectionIdx !== null && dragSectionIdx !== idx ? ' is-drag-over' : ''}${dragSectionIdx === idx ? ' is-dragging' : ''}`}
                  key={section.key}
                  onDragOver={(e) => { if (dragSectionIdx !== null) { e.preventDefault(); setDragOverSectionIdx(idx); } }}
                  onDrop={(e) => { e.preventDefault(); commitSectionDrag(idx); }}
                >
                  {!isMobileLayout ? (
                    <span
                      className="cam-timeline-drag"
                      draggable
                      onDragStart={(e) => {
                        setDragSectionIdx(idx);
                        try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(section.key)); } catch (err) { }
                      }}
                      onDragEnd={() => { setDragSectionIdx(null); setDragOverSectionIdx(null); }}
                      title="拖拽调整顺序"
                      aria-label={`拖拽移动环节 ${section.name || idx + 1}`}
                    >⠿</span>
                  ) : (
                    <span className="cam-timeline-move">
                      <button type="button" className="cam-icon-button" disabled={idx === 0} onClick={() => moveTimelineSection(idx, -1)} aria-label="上移">↑</button>
                      <button type="button" className="cam-icon-button" disabled={idx === timelineSections.length - 1} onClick={() => moveTimelineSection(idx, 1)} aria-label="下移">↓</button>
                    </span>
                  )}
                  <input
                    className="cam-timeline-name"
                    value={section.name}
                    onChange={(e) => updateTimelineSection(section.key, { name: e.target.value })}
                    placeholder={`环节 ${idx + 1}`}
                  />
                  <DateTimePicker
                    className="cam-timeline-time"
                    value={sectionTimeToInputValue(section.sectionTime)}
                    onChange={(v) => updateTimelineSection(section.key, { sectionTime: inputValueToSectionTime(v) })}
                    placeholder="时间（可选）"
                    clearable
                    title="环节时间（可选）"
                  />
                  <button type="button" className="cam-icon-button" onClick={() => removeTimelineSection(section.key)} aria-label="删除环节">
                    ×
                  </button>
                </div>
              ))}
              <button type="button" className="cam-add-section" onClick={addTimelineSection}>添加环节</button>
            </div>
          ) : null}
        </div>

        <div className="cam-upload-block">
          <div className="cam-section-label">添加照片/视频（可选，不限数量）</div>
          <input
            ref={filePickerRef}
            type="file"
            accept="image/*,video/*"
            multiple
            style={{ display: 'none' }}
            disabled={submitting}
            onChange={(e) => {
              handleFilesSelected(e.target.files, pendingSectionKeyRef.current);
              try { e.target.value = ''; } catch (err) {}
            }}
          />
          <div className="cam-upload-groups">
            {stagedUploadGroups.map((group) => (
              <section
                key={group.key || '__all__'}
                className="cam-upload-group"
                onDragOver={(e) => {
                  e.preventDefault();
                  if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
                    handleFilesSelected(e.dataTransfer.files, group.key);
                  }
                }}
              >
                <div className="cam-upload-group-head">
                  <div className="cam-upload-group-title">
                    <span>{group.name}</span>
                    {group.sectionTime ? <em>{group.sectionTime}</em> : null}
                  </div>
                  <div className="cam-upload-group-actions">
                    <span className="cam-upload-group-count">{group.items.length} 个</span>
                    <button type="button" className="cam-file-picker cam-file-picker--sm" disabled={submitting} onClick={() => openFilePicker(group.key)}>
                      添加
                    </button>
                  </div>
                </div>
                {group.items.length ? (
                  <div className="cam-preview-row">
                    {group.items.map((item) => {
                      const isVideo = isVideoFile(item.file);
                      return (
                        <div key={item.index} className="cam-preview-item">
                          {isVideo ? (
                            <>
                              <span className="cam-preview-video-placeholder">
                                <span>VIDEO</span>
                              </span>
                              <span className="cam-preview-video-badge">视频</span>
                            </>
                          ) : (
                            <img src={item.preview} alt={`preview-${item.index}`} className="cam-preview-media" />
                          )}
                          <button
                            type="button"
                            className="cam-preview-remove"
                            onClick={(e) => { e.stopPropagation(); removeStagingFile(item.index); }}
                            disabled={submitting}
                            aria-label="移除媒体"
                            title="移除"
                          >
                            ×
                          </button>
                          {timelineEnabled && normalizedTimelineSections.length ? (
                            <select
                              className="cam-preview-section"
                              value={item.key}
                              onChange={(e) => assignStagingFileSection(item.index, e.target.value)}
                              disabled={submitting}
                              aria-label="调整媒体环节"
                            >
                              <option value="">未归类</option>
                              {normalizedTimelineSections.map((section) => (
                                <option key={section.sourceKey} value={String(section.sourceKey)}>{section.name}</option>
                              ))}
                            </select>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="cam-upload-group-empty">点击"添加"或把文件拖到这里</div>
                )}
              </section>
            ))}
          </div>
          {uploadProgress ? (
            <div className="cam-upload-progress" aria-live="polite">
              <div className="cam-upload-progress-head">
                <div>
                  <strong>{getUploadProgressTitle(uploadProgress)}</strong>
                  <span>
                    {uploadProgress.completedFiles + uploadProgress.failedFiles} / {uploadProgress.totalFiles} 个
                    {uploadProgress.activeFileName ? ` · ${getUploadPhaseLabel(uploadProgress.activePhase)}：${uploadProgress.activeFileName}` : ''}
                  </span>
                </div>
                <b>{uploadProgress.percent || 0}%</b>
              </div>
              <div className="cam-upload-progress-track">
                <span style={{ width: `${uploadProgress.percent || 0}%` }} />
              </div>
              <div className="cam-upload-progress-meta">
                <span>{formatUploadBytes(uploadProgress.loadedBytes)} / {formatUploadBytes(uploadProgress.totalBytes)}</span>
                {uploadProgress.remainingSeconds !== null && uploadProgress.remainingSeconds !== undefined ? (
                  <span>预计剩余 {formatUploadRemainingTime(uploadProgress.remainingSeconds)}</span>
                ) : null}
                {uploadProgress.failedFiles ? <span>{uploadProgress.failedFiles} 个失败</span> : null}
              </div>
              <div className="cam-upload-progress-list">
                {uploadProgressItems.map((item) => (
                  <div
                    key={item.key}
                    className={`cam-upload-progress-file is-${item.status === 'rejected' || item.phase === 'failed' ? 'failed' : item.status === 'fulfilled' || item.phase === 'done' ? 'done' : 'active'}`}
                  >
                    <span>{item.name}</span>
                    <em>{getUploadPhaseLabel(item.phase, item.status)}</em>
                    <i><b style={{ width: `${item.percent || 0}%` }} /></i>
                    <strong>
                      {item.percent || 0}%
                      {item.remainingSeconds !== null && item.remainingSeconds !== undefined && item.status !== 'rejected' && item.phase !== 'failed' ? (
                        <small>剩 {formatUploadRemainingTime(item.remainingSeconds)}</small>
                      ) : null}
                    </strong>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        {userPermissions.includes('projects.create') ? (
          <div>
            <div style={{ marginBottom: 6 }}>相册标签（按回车添加）</div>
            <div className="cam-tags-row">
              {tags.map((t) => <TagChip key={t} tag={t} onRemove={removeTag} />)}
              <input className="cam-tag-input" value={tagInput} onChange={(e) => setTagInput(e.target.value)} onKeyDown={onTagKeyDown} placeholder="输入标签并回车" />
            </div>
          </div>
        ) : null}

        <div style={{ marginTop: 12 }}>
          <DatePicker value={startDate} onChange={(v) => setStartDate(v)} format="yyyy-MM-dd" placeholder="活动日期（可选）" style={{ width: '100%' }} />
        </div>
      </div>
    </Modal>
  );
}
