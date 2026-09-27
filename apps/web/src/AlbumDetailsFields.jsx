import React from 'react';
import { DateTimePicker, Input, TextArea, Toast } from './ui';
import { IconClose, IconPlus } from './ui/icons';
import './AlbumDetailsFields.css';

export default function AlbumDetailsFields({
  title,
  onTitleChange,
  description,
  onDescriptionChange,
  eventDate,
  onEventDateChange,
  tags = [],
  onTagsChange,
  showTags = true,
  disabled = false,
}) {
  const [tagInput, setTagInput] = React.useState('');
  const titleId = React.useId();
  const descriptionId = React.useId();
  const tagInputId = React.useId();

  const addTag = React.useCallback(() => {
    const next = tagInput.trim();
    if (!next) return;
    if (tags.includes(next)) {
      setTagInput('');
      return;
    }
    if (tags.length >= 20) {
      Toast.warning('最多添加 20 个标签');
      return;
    }
    onTagsChange?.([...tags, next]);
    setTagInput('');
  }, [tagInput, tags, onTagsChange]);

  return (
    <div className="album-details-fields">
      <div className="album-field">
        <label className="album-field-label" htmlFor={titleId}>相册名称 <span className="album-field-required">*</span></label>
        <Input id={titleId} value={title} onChange={onTitleChange} disabled={disabled} placeholder="输入相册名称" autoComplete="off" />
      </div>
      <div className="album-field">
        <label className="album-field-label" htmlFor={descriptionId}>相册描述 <span className="album-field-optional">可选</span></label>
        <TextArea id={descriptionId} value={description} onChange={onDescriptionChange} disabled={disabled} rows={3} placeholder="记录这组照片的主题" />
      </div>
      <div className="album-field">
        <span className="album-field-label">活动日期 <span className="album-field-optional">可选</span></span>
        <DateTimePicker dateOnly value={eventDate} onChange={onEventDateChange} placeholder="选择活动日期" style={{ width: '100%' }} disabled={disabled} clearable />
      </div>
      {showTags ? (
        <div className="album-field">
          <label className="album-field-label" htmlFor={tagInputId}>相册标签 <span className="album-field-optional">{tags.length}/20</span></label>
          <div className="album-tag-editor">
            {tags.map((tag) => (
              <span className="album-tag" key={tag}>
                <span>{tag}</span>
                <button type="button" disabled={disabled} onClick={() => onTagsChange?.(tags.filter((item) => item !== tag))} aria-label={`删除标签 ${tag}`} title="删除标签">
                  <IconClose />
                </button>
              </span>
            ))}
            <input
              id={tagInputId}
              value={tagInput}
              disabled={disabled || tags.length >= 20}
              onChange={(event) => setTagInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ',') {
                  event.preventDefault();
                  addTag();
                }
              }}
              placeholder={tags.length ? '继续添加标签' : '输入标签后按回车'}
            />
            {tagInput.trim() ? (
              <button type="button" className="album-tag-add" onClick={addTag} disabled={disabled} aria-label="添加标签" title="添加标签">
                <IconPlus />
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
