import React from 'react';
import { Modal, Input, TextArea, DatePicker, Toast } from '@douyinfe/semi-ui';
import './CreateAlbumModal.css';
import { uploadPhotos } from './services/photoService';
import { getProjectById } from './services/projectService';
import { getPermissions } from './permissions/permissionStore';

function TagChip({ tag, onRemove }) {
  const [hover, setHover] = React.useState(false);
  return (
    <div className="cam-tag" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <span className="cam-tag-text">{tag}</span>
      {hover && <button className="cam-tag-remove" onClick={(e) => { e.stopPropagation(); onRemove(tag); }}>脳</button>}
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
  const [userPermissions, setUserPermissions] = React.useState(() => getPermissions());
  const [stagingFiles, setStagingFiles] = React.useState([]);
  const [stagingPreviews, setStagingPreviews] = React.useState([]);

  React.useEffect(() => {
    if (!visible) {
      setName('');
      setDescription('');
      setTagInput('');
      setTags([]);
      setStartDate(null);
      setSubmitting(false);
      stagingPreviews.forEach((u) => { try { URL.revokeObjectURL(u); } catch (e) {} });
      setStagingFiles([]);
      setStagingPreviews([]);
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
    if (tags.length >= 20) return Toast.warning('鏍囩鏁伴噺杈惧埌涓婇檺');
    setTags((s) => [...s, val]);
  }, [tags]);

  const removeTag = React.useCallback((t) => setTags((s) => s.filter((x) => x !== t)), []);

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

    setStagingFiles((prevFiles) => {
      const prevSigs = new Set(prevFiles.map((f) => `${f.name}::${f.size}::${f.lastModified}`));
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
      }

      if (dupCount > 0) {
        try { Toast.warning(`已跳过 ${dupCount} 张重复图片`); } catch (e) {}
      }

      const combined = [...prevFiles, ...toAdd];

      setStagingPreviews((prevPreviews) => {
        const newPreviews = toAdd.map((f) => URL.createObjectURL(f));
        return [...prevPreviews, ...newPreviews];
      });

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
      if (removed && removed[0]) {
        try { URL.revokeObjectURL(removed[0]); } catch (e) {}
      }
      return next;
    });
  }, []);

  const handleSubmit = React.useCallback(async () => {
    if (!name.trim()) return Toast.warning('椤圭洰鍚嶇О涓哄繀濉」');
    setSubmitting(true);
    try {
      const payload = {
        title: name.trim(),
        description: description.trim() || undefined,
        ...(userPermissions.includes('projects.create') && tags && tags.length ? { tags } : {}),
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

      Toast.success('已创建项目');

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
            Toast.warning('宸插垱寤洪」鐩紝浣嗘湭鑳借幏鍙栭」鐩?ID锛岀収鐗囨湭鑷姩涓婁紶');
          } else {
            try {
              const token = (typeof window !== 'undefined') ? (localStorage.getItem('mamage_jwt_token') || '') : '';
              console.debug('[CreateAlbumModal] starting uploads', { projectId, tokenPresent: !!token, files: filesToUpload.length });
              if (!token) {
                Toast.warning('鏈娴嬪埌鐧诲綍 token锛屼笂浼犲彲鑳戒細澶辫触');
              }
            } catch (e) {}

            try {
              const uploadPromises = filesToUpload.map((f) =>
                uploadPhotos({ file: f, projectId }).then(() => ({ status: 'fulfilled', fileName: f.name }))
                  .catch((err) => ({ status: 'rejected', fileName: f.name, error: err }))
              );

              const results = await Promise.all(uploadPromises);
              const rejected = results.filter((r) => r.status === 'rejected');
              if (rejected.length > 0) {
                console.error('[CreateAlbumModal] some uploads failed', rejected);
                try { Toast.error(`部分图片上传失败：${rejected.length} 张`); } catch (e) {}
              } else {
                try { Toast.success('已上传所选照片'); } catch (e) {}
              }
            } catch (e) {
              console.error('parallel uploads failed unexpectedly', e);
              try { Toast.error('鍥剧墖涓婁紶澶辫触'); } catch (ee) {}
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
      Toast.error('鍒涘缓澶辫触');
    } finally {
      setSubmitting(false);
    }
  }, [name, description, tags, startDate, createProject, onCreated, onClose, stagingFiles, userPermissions]);

  return (
    <Modal
      title="鏂板缓鐩稿唽"
      visible={visible}
      onCancel={onClose}
      onOk={handleSubmit}
      okButtonProps={{ loading: submitting }}
      cancelText="鍙栨秷"
      okText="鍒涘缓"
      closable
    >
      <div className="cam-form">
        <Input value={name} onChange={(v) => setName(v)} placeholder="椤圭洰鍚嶇О锛堝繀濉級" />
        <TextArea value={description} onChange={(v) => setDescription(v)} rows={3} placeholder="椤圭洰鎻忚堪锛堝彲閫夛級" />

        <div style={{ marginTop: 12 }}>
          <div style={{ marginBottom: 6 }}>添加照片（可选，不限数量）</div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <label style={{ display: 'inline-block' }}>
              <input type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={(e) => handleFilesSelected(e.target.files)} />
              <div style={{ padding: '8px 12px', border: '1px dashed #d9d9d9', borderRadius: 6, cursor: 'pointer', color: '#333' }}>閫夋嫨鐓х墖</div>
            </label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              {stagingPreviews.map((p, i) => (
                <div key={i} style={{ width: 72, height: 72, overflow: 'hidden', borderRadius: 4, background: '#f5f5f5', position: 'relative' }}>
                  <img src={p} alt={`preview-${i}`} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); removeStagingFile(i); }}
                    aria-label="绉婚櫎鐓х墖"
                    title="绉婚櫎"
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
                    脳
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
          <DatePicker value={startDate} onChange={(v) => setStartDate(v)} format="yyyy-MM-dd" placeholder="寮€濮嬫棩鏈燂紙鍙€夛級" style={{ width: '100%' }} />
        </div>
      </div>
    </Modal>
  );
}


