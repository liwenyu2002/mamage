import React from 'react';
import { Modal, Input, TextArea, DatePicker, Toast } from './ui';
import './CreateAlbumModal.css';
import { getUploadFileLimitError, uploadPhotoFiles } from './services/photoService';
import { getProjectById } from './services/projectService';
import { getPermissions } from './permissions/permissionStore';
import {
  createInitialUploadProgress,
  formatUploadBytes,
  formatUploadRemainingTime,
  getUploadPhaseLabel,
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
  const [initialUploadSectionKey, setInitialUploadSectionKey] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [userPermissions, setUserPermissions] = React.useState(() => getPermissions());
  const [stagingFiles, setStagingFiles] = React.useState([]);
  const [stagingPreviews, setStagingPreviews] = React.useState([]);
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
      setInitialUploadSectionKey('');
      sectionKeyRef.current = 2;
      setSubmitting(false);
      stagingPreviews.forEach((u) => { try { URL.revokeObjectURL(u); } catch (e) {} });
      setStagingFiles([]);
      setStagingPreviews([]);
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

  React.useEffect(() => {
    if (!timelineEnabled) {
      setInitialUploadSectionKey('');
      return;
    }
    if (normalizedTimelineSections.length && !normalizedTimelineSections.some((section) => String(section.sourceKey) === String(initialUploadSectionKey))) {
      setInitialUploadSectionKey(String(normalizedTimelineSections[0].sourceKey));
    }
  }, [timelineEnabled, normalizedTimelineSections, initialUploadSectionKey]);

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
    setInitialUploadSectionKey((prev) => (String(prev) === String(key) ? '' : prev));
  }, []);

  const onTagKeyDown = React.useCallback((e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      const v = tagInput.trim();
      if (v) addTag(v);
      setTagInput('');
    }
  }, [tagInput, addTag]);

  const handleFilesSelected = React.useCallback((files) => {
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
        const newPreviews = toAdd.map((f) => URL.createObjectURL(f));
        return [...prevPreviews, ...newPreviews];
      });

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
    setUploadProgress(null);
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
              const selectedSection = timelineEnabled
                ? normalizedTimelineSections.find((section) => String(section.sourceKey) === String(initialUploadSectionKey))
                : null;
              const createdSections = Array.isArray(result && result.timelineSections) ? result.timelineSections : [];
              const matchedCreatedSection = selectedSection
                ? (createdSections.find((section) => String(section.name || '') === selectedSection.name && Number(section.sortOrder || 0) === Number(selectedSection.sortOrder || 0))
                  || createdSections.find((section) => String(section.name || '') === selectedSection.name))
                : null;
              const results = await uploadPhotoFiles(filesToUpload, {
                projectId,
                timelineSectionId: matchedCreatedSection && matchedCreatedSection.id ? matchedCreatedSection.id : undefined,
                onProgress: handleProgress,
              });
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
  }, [name, description, tags, startDate, timelineEnabled, normalizedTimelineSections, initialUploadSectionKey, createProject, onCreated, onClose, stagingFiles, userPermissions]);

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
                <div className="cam-timeline-row" key={section.key}>
                  <input
                    className="cam-timeline-name"
                    value={section.name}
                    onChange={(e) => updateTimelineSection(section.key, { name: e.target.value })}
                    placeholder={`环节 ${idx + 1}`}
                  />
                  <input
                    className="cam-timeline-time"
                    value={section.sectionTime}
                    onChange={(e) => updateTimelineSection(section.key, { sectionTime: e.target.value })}
                    placeholder="时间（可选）"
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
          {timelineEnabled && normalizedTimelineSections.length > 0 ? (
            <label className="cam-upload-section">
              <span>首批媒体环节</span>
              <select value={initialUploadSectionKey} onChange={(e) => setInitialUploadSectionKey(e.target.value)}>
                {normalizedTimelineSections.map((section) => (
                  <option key={section.sourceKey} value={section.sourceKey}>
                    {section.sectionTime ? `${section.name} · ${section.sectionTime}` : section.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <div className="cam-upload-row">
            <label className="cam-file-label">
              <input
                type="file"
                accept="image/*,video/*"
                multiple
                style={{ display: 'none' }}
                disabled={submitting}
                onChange={(e) => {
                  handleFilesSelected(e.target.files);
                  try { e.target.value = ''; } catch (err) {}
                }}
              />
              <div className="cam-file-picker">选择照片/视频</div>
            </label>
            <div className="cam-preview-row">
              {stagingPreviews.map((p, i) => {
                const isVideo = isVideoFile(stagingFiles[i]);
                return (
                <div key={i} className="cam-preview-item">
                  {isVideo ? (
                    <>
                      <video src={p} className="cam-preview-media" muted playsInline preload="metadata" />
                      <span className="cam-preview-video-badge">视频</span>
                    </>
                  ) : (
                    <img src={p} alt={`preview-${i}`} className="cam-preview-media" />
                  )}
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); removeStagingFile(i); }}
                    disabled={submitting}
                    aria-label="移除媒体"
                    title="移除"
                    style={{
                      position: 'absolute',
                      right: 4,
                      top: 4,
                      width: 20,
                      height: 20,
                      borderRadius: 10,
                      border: 'none',
                      background: 'rgba(0,0,0,0.6)',
                      color: '#fff',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                      padding: 0,
                      lineHeight: 1,
                    }}
                  >
                    ×
                  </button>
                </div>
              );})}
            </div>
          </div>
          {uploadProgress ? (
            <div className="cam-upload-progress" aria-live="polite">
              <div className="cam-upload-progress-head">
                <div>
                  <strong>{uploadProgress.failedFiles ? '上传有失败' : '正在上传'}</strong>
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
