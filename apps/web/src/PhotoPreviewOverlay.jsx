import React from 'react';
import { createPortal } from 'react-dom';
import { IconClose, IconListView } from './ui/icons';
import useMediaViewerDialog from './useMediaViewerDialog';
import { GlassReveal, ViewerDisplaySettings, useViewerAppearance } from './ui/Glass';
import './ProjectDetail.css';
import './mediaViewer.css';

function PhotoPreviewOverlay({ visible, src, title, originalFilename, description, tags, onClose }) {
  const [detailsVisible, setDetailsVisible] = React.useState(() => typeof window !== 'undefined' && window.innerWidth > 900);
  const appearance = useViewerAppearance();
  useMediaViewerDialog(visible && !!src, onClose);
  if (!visible || !src) return null;
  const safeTags = Array.isArray(tags) ? tags.filter(Boolean) : [];
  return createPortal(
    <div className="viewer-overlay viewer-overlay--workspace is-open" {...appearance.surfaceProps} role="dialog" aria-modal="true" aria-label="照片预览" onClick={onClose}>
      <div className="mamage-dynamic-backdrop viewer-backdrop" aria-hidden="true" />
      <div className={`viewer-wrap${detailsVisible ? ' has-details' : ''}`}>
        <div className="viewer-topbar" onClick={event => event.stopPropagation()}>
          <div className="viewer-topbar-left">
            <button type="button" className="viewer-topbar-close" aria-label="关闭预览" onClick={onClose}><IconClose /></button>
            <strong className="viewer-topbar-title">{title || '照片预览'}</strong>
          </div>
          <ViewerDisplaySettings appearance={appearance.appearance} onChange={appearance.update} />
        </div>
        <div className="viewer-img-wrap">
          <div className="viewer-img-stage" onClick={event => event.stopPropagation()}>
            <div className="viewer-carousel" style={{ width: '100%' }}><div className="viewer-slide is-active" style={{ width: '100%' }}>
              <img src={src} alt={title || '照片预览'} className="viewer-carousel-img" />
            </div></div>
          </div>
        </div>
        <div className="viewer-dock" onClick={event => event.stopPropagation()}>
          <GlassReveal open={detailsVisible} className="viewer-panel-slot">
          <aside className="viewer-details-panel glass-reveal-surface" id="photo-preview-details" aria-label="媒体信息">
            <div className="viewer-sidebar-head"><div><span>照片信息</span><strong>{originalFilename || title || '未命名'}</strong></div>
              <button type="button" title="关闭信息" aria-label="关闭信息" onClick={() => setDetailsVisible(false)}><IconClose /></button>
            </div>
            <div className="viewer-info-card">
              <p className="viewer-description">{description || '暂无描述'}</p>
              {!!safeTags.length && <div className="viewer-semantic-tags">{safeTags.map((tag, index) => <span className="viewer-semantic-tag" key={`${tag}-${index}`}>{tag}</span>)}</div>}
            </div>
          </aside>
          </GlassReveal>
          <div className="viewer-dock-actions" role="toolbar" aria-label="媒体操作">
            <button type="button" className={`viewer-dock-btn viewer-dock-btn--info${detailsVisible ? ' is-active' : ''}`} aria-label={detailsVisible ? '隐藏信息' : '显示信息'} aria-expanded={detailsVisible} aria-controls="photo-preview-details"
              title={detailsVisible ? '隐藏信息' : '显示信息'} onClick={() => setDetailsVisible(value => !value)}><IconListView /><span>信息</span></button>
          </div>
        </div>
      </div>
    </div>, document.body,
  );
}

export default React.memo(PhotoPreviewOverlay);
