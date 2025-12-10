import React from 'react';
import { Modal, Input, TextArea, DatePicker, Toast } from '@douyinfe/semi-ui';
import './CreateAlbumModal.css';
import { me as fetchMe } from './services/authService';
import { uploadPhotos } from './services/photoService';

function TagChip({ tag, onRemove }) {
  const [hover, setHover] = React.useState(false);
  return (
    <div className="cam-tag" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <span className="cam-tag-text">{tag}</span>
      {hover && <button className="cam-tag-remove" onClick={(e) => { e.stopPropagation(); onRemove(tag); }}>×</button>}
    </div>
  );
}

export default function CreateAlbumModal({ visible, onClose, onCreated, createProject }) {
  const [name, setName] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [tagInput, setTagInput] = React.useState('');
  const [tags, setTags] = React.useState([]);
  const [startDate, setStartDate] = React.useState(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [userPermissions, setUserPermissions] = React.useState([]);
  const [stagingFiles, setStagingFiles] = React.useState([]);
  const [stagingPreviews, setStagingPreviews] = React.useState([]);

  React.useEffect(() => {
    if (!visible) {
      setName(''); setDescription(''); setTagInput(''); setTags([]); setStartDate(null); setSubmitting(false);
      // cleanup staging previews
      stagingPreviews.forEach((u) => { try { URL.revokeObjectURL(u); } catch (e) {} });
      setStagingFiles([]); setStagingPreviews([]);
    }
  }, [visible]);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const u = await fetchMe();
        if (cancelled) return;
        // u.permissions is array from backend RBAC
        const perms = Array.isArray(u && u.permissions) ? u.permissions : [];
        setUserPermissions(perms);
      } catch (e) {
        // ignore
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const addTag = React.useCallback((t) => {
    const val = (t || '').trim();
    if (!val) return;
    if (tags.includes(val)) return;
    if (tags.length >= 20) return Toast.warning('标签数量达到上限');
    setTags((s) => [...s, val]);
  }, [tags]);

  const removeTag = React.useCallback((t) => setTags((s) => s.filter(x => x !== t)), []);

  const onTagKeyDown = React.useCallback((e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      const v = tagInput.trim();
      if (v) addTag(v);
      setTagInput('');
    }
  }, [tagInput, addTag]);

  const handleFilesSelected = React.useCallback((files) => {
    const MAX = 10;
    const incoming = Array.from(files || []);
    if (!incoming.length) return;

    setStagingFiles((prevFiles) => {
      const prevSigs = new Set(prevFiles.map(f => `${f.name}::${f.size}::${f.lastModified}`));
      const toAdd = [];
      let dupCount = 0;
      for (const f of incoming) {
        const sig = `${f.name}::${f.size}::${f.lastModified}`;
        if (prevSigs.has(sig)) {
          dupCount += 1;
          continue;
        }
        prevSigs.add(sig);
        toAdd.push(f);
        if (prevSigs.size >= MAX) break;
      }

      if (dupCount > 0) {
        try { Toast.warning(`已跳过 ${dupCount} 张重复图片`); } catch (e) {}
      }

      const combined = [...prevFiles, ...toAdd].slice(0, MAX);

      // update previews for newly added files
      setStagingPreviews((prevPreviews) => {
        const newPreviews = toAdd.map(f => URL.createObjectURL(f));
        const combinedPreviews = [...prevPreviews, ...newPreviews];
        if (combinedPreviews.length > MAX) {
          const removed = combinedPreviews.splice(MAX);
          removed.forEach(u => { try { URL.revokeObjectURL(u); } catch (e) {} });
        }
        return combinedPreviews.slice(0, MAX);
      });

      if (combined.length >= MAX && toAdd.length < incoming.length) {
        try { Toast.warning(`一次最多上传 ${MAX} 张照片，已达到上限`); } catch (e) {}
      }

      return combined;
    });
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
      // revoke the removed objectURL
      if (removed && removed[0]) {
        try { URL.revokeObjectURL(removed[0]); } catch (e) {}
      }
      return next;
    });
  }, []);


  const handleSubmit = React.useCallback(async () => {
    if (!name.trim()) return Toast.warning('项目名称为必填');
    setSubmitting(true);
    try {
      const payload = {
        title: name.trim(),
        description: description.trim() || undefined,
        // only include tags when current user has permission
        ...(userPermissions.includes('projects.create') && tags && tags.length ? { tags } : {}),
        eventDate: startDate ? (startDate instanceof Date ? `${startDate.getFullYear()}-${String(startDate.getMonth()+1).padStart(2,'0')}-${String(startDate.getDate()).padStart(2,'0')}` : String(startDate).slice(0,10)) : undefined
      };
      let result;
      if (typeof createProject === 'function') {
        result = await createProject(payload);
        if (typeof onCreated === 'function') {
          try { await onCreated(result || payload); } catch (e) { /* ignore */ }
        }
      } else if (typeof onCreated === 'function') {
        // caller handles creation and may return created object
        result = await onCreated(payload);
      }
      Toast.success('已创建项目');
      // 如果用户在新建时选择了照片，且服务器返回了新项目 id，则上传照片到该项目
      try {
        const MAX = 10;
        const filesToUpload = (stagingFiles && stagingFiles.length) ? stagingFiles.slice(0, MAX) : [];
        const projectId = result && (result.id || result._id || result.projectId || result.id === 0 ? result.id : null) || null;
        if (filesToUpload.length > 0) {
          if (!projectId) {
            Toast.warning('已创建项目，但未能获取项目 ID，照片未自动上传');
          } else {
            for (const f of filesToUpload) {
              try {
                await uploadPhotos({ file: f, projectId });
              } catch (e) {
                console.error('upload photo during createAlbum failed', e);
              }
            }
            Toast.success('已上传所选照片');
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
  }, [name, description, tags, startDate, createProject, onCreated, onClose]);

  return (
    <Modal
      title="新建相册"
      visible={visible}
      onCancel={onClose}
      onOk={handleSubmit}
      okButtonProps={{ loading: submitting }}
      cancelText="取消"
      okText="创建"
      closable
    >
      <div className="cam-form">
        <Input value={name} onChange={(v) => setName(v)} placeholder="项目名称（必填）" />
        <TextArea value={description} onChange={(v) => setDescription(v)} rows={3} placeholder="项目描述（可选）" />

        <div style={{ marginTop: 12 }}>
          <div style={{ marginBottom: 6 }}>添加照片（可选，最多 10 张）</div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <label style={{ display: 'inline-block' }}>
              <input type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={(e) => handleFilesSelected(e.target.files)} />
              <div style={{ padding: '8px 12px', border: '1px dashed #d9d9d9', borderRadius: 6, cursor: 'pointer', color: '#333' }}>选择照片</div>
            </label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              {stagingPreviews.map((p, i) => (
                <div key={i} style={{ width: 72, height: 72, overflow: 'hidden', borderRadius: 4, background: '#f5f5f5', position: 'relative' }}>
                  <img src={p} alt={`preview-${i}`} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); removeStagingFile(i); }}
                    aria-label="移除照片"
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
              ))}
            </div>
          </div>
        </div>

        {userPermissions.includes('projects.create') ? (
          <div>
            <div style={{ marginBottom: 6 }}>项目标签（按回车添加）</div>
            <div className="cam-tags-row">
              {tags.map((t) => <TagChip key={t} tag={t} onRemove={removeTag} />)}
              <input className="cam-tag-input" value={tagInput} onChange={(e) => setTagInput(e.target.value)} onKeyDown={onTagKeyDown} placeholder="输入标签并回车" />
            </div>
          </div>
        ) : null}

        <div style={{ marginTop: 12 }}>
          <DatePicker value={startDate} onChange={(v) => setStartDate(v)} format="yyyy-MM-dd" placeholder="开展日期（可选）" style={{ width: '100%' }} />
        </div>
      </div>
    </Modal>
  );
}
