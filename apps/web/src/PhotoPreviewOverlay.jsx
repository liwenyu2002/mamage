import React from 'react';
import './ProjectDetail.css';

function PhotoPreviewOverlay({
  visible,
  src,
  title,
  description,
  tags,
  onClose,
}) {
  React.useEffect(() => {
    if (!visible) return undefined;
    const onKeyDown = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [visible, onClose]);

  if (!visible || !src) return null;

  const safeTags = Array.isArray(tags) ? tags.filter(Boolean) : [];

  return (
    <div className="viewer-overlay is-open" onClick={onClose} aria-hidden="false">
      <div className="viewer-wrap">
        <button
          type="button"
          className="viewer-close-btn"
          aria-label="关闭预览"
          onClick={(e) => {
            e.stopPropagation();
            onClose?.();
          }}
        >
          ×
        </button>

        <div className="viewer-img-wrap" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
          <div className="viewer-img-stage" onClick={(e) => e.stopPropagation()}>
            <div className="viewer-carousel" style={{ transform: 'translate3d(0, 0, 0)', width: '100%' }}>
              <div className="viewer-slide is-active" style={{ width: '100%', minWidth: '100%' }}>
                <img
                  src={src}
                  alt={title || '照片预览'}
                  className="viewer-carousel-img viewer-img--open-zoom"
                />
              </div>
            </div>
          </div>

          <div className="viewer-chip viewer-chip--left">
            {title || '照片预览'}
          </div>

          <div
            className="viewer-info-card"
            style={{ background: 'rgba(0,0,0,0.45)', color: '#fff' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ pointerEvents: 'none' }}>
              <div style={{ marginBottom: safeTags.length > 0 ? 8 : 0, fontSize: 14 }}>
                {description || '暂无描述'}
              </div>
              {safeTags.length > 0 ? (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {safeTags.map((tag, i) => (
                    <span key={`${tag}-${i}`} style={{ background: '#1890ff', padding: '4px 8px', borderRadius: 3, whiteSpace: 'nowrap', fontSize: 12 }}>
                      {tag}
                    </span>
                  ))}
                </div>
              ) : (
                <div style={{ fontSize: 12, opacity: 0.78 }}>暂无标签</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default React.memo(PhotoPreviewOverlay);
