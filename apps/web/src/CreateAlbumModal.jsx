import React from 'react';
import { Modal, Input, TextArea, DatePicker, Toast } from '@douyinfe/semi-ui';
import './CreateAlbumModal.css';

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

  React.useEffect(() => {
    if (!visible) {
      setName(''); setDescription(''); setTagInput(''); setTags([]); setStartDate(null); setSubmitting(false);
    }
  }, [visible]);

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

  const handleSubmit = React.useCallback(async () => {
    if (!name.trim()) return Toast.warning('项目名称为必填');
    setSubmitting(true);
    try {
      const payload = {
        title: name.trim(),
        description: description.trim() || undefined,
        tags: tags.length ? tags : undefined,
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

        <div>
          <div style={{ marginBottom: 6 }}>项目标签（按回车添加）</div>
          <div className="cam-tags-row">
            {tags.map((t) => <TagChip key={t} tag={t} onRemove={removeTag} />)}
            <input className="cam-tag-input" value={tagInput} onChange={(e) => setTagInput(e.target.value)} onKeyDown={onTagKeyDown} placeholder="输入标签并回车" />
          </div>
        </div>

        <div style={{ marginTop: 12 }}>
          <DatePicker value={startDate} onChange={(v) => setStartDate(v)} format="yyyy-MM-dd" placeholder="开展日期（可选）" style={{ width: '100%' }} />
        </div>
      </div>
    </Modal>
  );
}
