import React from 'react';
import { createPortal } from 'react-dom';
import { IconPlus, IconMoreStroked } from './ui/icons';
import './AlbumActionBar.css';

export default function AlbumActionBar({
  label = '相册底部操作', selecting, selectedCount = 0, onSelect, onFunctions, functionsOpen,
  primaryLabel, primaryHint, primaryDisabled = false, primaryProps = {}, dragActive = false, hovered = false,
}) {
  return createPortal(<nav className={`detail-bottom-nav${dragActive ? ' is-drag-active' : ''}`} aria-label={label}>
    <button type="button" className={`detail-bottom-nav-item detail-bottom-nav-item--select${selecting ? ' is-active' : ''}`}
      onClick={onSelect} aria-pressed={Boolean(selecting)}>
      <span className="detail-bottom-nav-icon detail-bottom-nav-icon--select" aria-hidden="true">{selecting ? '\u2713' : ''}</span>
      <span>{selecting ? (selectedCount ? `已选 ${selectedCount}` : '完成') : '选择'}</span>
    </button>
    <button {...primaryProps} type="button" disabled={primaryDisabled} aria-label={primaryLabel}
      title={primaryProps.title || primaryLabel}
      className={`detail-bottom-upload${primaryDisabled ? ' is-disabled' : ''}${dragActive ? ' is-drag-active' : ''}${hovered ? ' is-hovered' : ''}`}>
      <IconPlus /><span className="detail-bottom-upload-hint">{primaryHint}</span>
    </button>
    <button type="button" className={`detail-bottom-nav-item detail-bottom-nav-item--actions${functionsOpen ? ' is-active' : ''}`}
      onClick={onFunctions} aria-expanded={Boolean(functionsOpen)} aria-label="打开功能">
      <span className="detail-bottom-nav-icon" aria-hidden="true"><IconMoreStroked /></span><span>功能</span>
    </button>
  </nav>, document.body);
}
