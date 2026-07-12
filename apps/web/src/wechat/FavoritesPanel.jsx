import React from 'react';
import { beginDrag } from './pointerDrag';
import './favoritesPanel.css';

// 左侧面板「收藏」Tab：样式收藏 + 照片收藏两个分区，纯展示+交互转发，不持有数据源
// （styleFavs/photoFavs/删除均由父组件通过 props 驱动，本组件不发请求）。
// 约束：拖拽/点击互斥交给 pointerDrag 自身的阈值判定，这里不重复处理；
// 微缩预览的 html 已由父组件 renderBlockHtml 过 DOMPurify，本组件不再二次清洗。

function FavoritesPanel({
  styleFavs = [],
  photoFavs = [],
  snippetFavs = [],
  renderBlockHtml,
  onInsertBlock,
  onInsertPhoto,
  onInsertSnippet,
  onRemoveFav,
}) {
  return (
    <div className="wxc-fav-panel">
      <section className="wxc-fav-section">
        <div className="wxc-fav-section-title">样式收藏</div>
        {styleFavs.length === 0 ? (
          <div className="wxc-fav-empty">在样式库里点 ★ 收藏</div>
        ) : (
          <div className="wxc-fav-block-grid">
            {styleFavs.map((fav) => {
              const payload = fav.payload || {};
              const blockLike = { id: fav.refKey, ...payload };
              const previewHtml = typeof renderBlockHtml === 'function' ? renderBlockHtml(blockLike) : '';
              return (
                <div
                  key={fav.id}
                  role="button"
                  tabIndex={0}
                  className="wxc-fav-block"
                  onPointerDown={(e) => beginDrag(e, {
                    kind: 'style-block',
                    data: { type: payload.type, blockId: fav.refKey },
                    ghostLabel: payload.name,
                  })}
                  onDragStart={(e) => e.preventDefault()}
                  onClick={() => onInsertBlock(blockLike)}
                  onKeyDown={(e) => { if (e.key === 'Enter') onInsertBlock(blockLike); }}
                  title={payload.name ? `${payload.name}（点击插入 / 拖到画布定位插入）` : '点击插入 / 拖到画布定位插入'}
                >
                  <div className="wxc-fav-block-stage">
                    <div
                      className="wxc-fav-block-scale"
                      // eslint-disable-next-line react/no-danger
                      dangerouslySetInnerHTML={{ __html: previewHtml }}
                    />
                  </div>
                  <div className="wxc-fav-block-meta">
                    <span className="wxc-fav-block-name">{payload.name || '未命名样式'}</span>
                  </div>
                  <button
                    type="button"
                    className="wxc-fav-block-del"
                    title="取消收藏"
                    onClick={(e) => { e.stopPropagation(); onRemoveFav(fav.id); }}
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="wxc-fav-section">
        <div className="wxc-fav-section-title">片段收藏</div>
        {snippetFavs.length === 0 ? (
          <div className="wxc-fav-empty">在画布框选元素后点「★ 收藏」</div>
        ) : (
          <div className="wxc-fav-snippet-list">
            {snippetFavs.map((fav) => {
              const payload = fav.payload || {};
              const count = Array.isArray(payload.blocks) ? payload.blocks.length : 0;
              return (
                <div
                  key={fav.id}
                  role="button"
                  tabIndex={0}
                  className="wxc-fav-snippet"
                  onClick={() => onInsertSnippet && onInsertSnippet(fav)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && onInsertSnippet) onInsertSnippet(fav); }}
                  title="点击插入该片段到画布末尾"
                >
                  <span className="wxc-fav-snippet-icon" aria-hidden="true">▤</span>
                  <span className="wxc-fav-snippet-name">{payload.name || '片段'}</span>
                  <span className="wxc-fav-snippet-count">{count} 块</span>
                  <button
                    type="button"
                    className="wxc-fav-block-del"
                    title="删除该片段收藏"
                    onClick={(e) => { e.stopPropagation(); onRemoveFav(fav.id); }}
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="wxc-fav-section">
        <div className="wxc-fav-section-title">照片收藏</div>
        {photoFavs.length === 0 ? (
          <div className="wxc-fav-empty">在相册里点 ★ 收藏</div>
        ) : (
          <div className="wxc-fav-photo-grid">
            {photoFavs.map((fav) => {
              const photo = fav.payload || {};
              return (
                <div
                  key={fav.id}
                  role="button"
                  tabIndex={0}
                  className="wxc-fav-photo-card"
                  onPointerDown={(e) => beginDrag(e, {
                    kind: 'photo-item',
                    data: photo,
                    ghostLabel: photo.description || '照片',
                  })}
                  onDragStart={(e) => e.preventDefault()}
                  onClick={() => onInsertPhoto(photo)}
                  onKeyDown={(e) => { if (e.key === 'Enter') onInsertPhoto(photo); }}
                  title={photo.description || '点击插入 / 拖到画布定位插入'}
                >
                  <img src={photo.thumbUrl || photo.url} alt={photo.description || ''} loading="lazy" draggable={false} />
                  <button
                    type="button"
                    className="wxc-fav-photo-del"
                    title="取消收藏"
                    onClick={(e) => { e.stopPropagation(); onRemoveFav(fav.id); }}
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

export default FavoritesPanel;
