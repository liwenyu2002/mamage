import React from 'react';
import { beginDrag } from './pointerDrag';
import './favoritesPanel.css';

// 左侧面板「收藏」Tab：排版收藏（样式与片段混排）+ 照片收藏，纯展示+交互转发，不持有数据源
// （styleFavs/snippetFavs/photoFavs/删除均由父组件通过 props 驱动，本组件不发请求）。
// 约束：拖拽/点击互斥交给 pointerDrag 自身的阈值判定，这里不重复处理；
// 微缩预览的 html 已由父组件 renderBlockHtml 过 DOMPurify，本组件不再二次清洗。

function FavoritesPanel({
  styleFavs = [],
  photoFavs = [],
  snippetFavs = [],
  renderBlockHtml,
  renderSnippetHtml,
  onInsertBlock,
  onInsertPhoto,
  onInsertSnippet,
  onRemoveFav,
}) {
  const layoutFavs = React.useMemo(() => [
    ...styleFavs.map((favorite) => ({ favorite, type: 'style' })),
    ...snippetFavs.map((favorite) => ({ favorite, type: 'snippet' })),
  ].sort((a, b) => {
    const aTime = Date.parse(a.favorite.createdAt || '') || 0;
    const bTime = Date.parse(b.favorite.createdAt || '') || 0;
    if (aTime !== bTime) return bTime - aTime;
    return Number(b.favorite.id || 0) - Number(a.favorite.id || 0);
  }), [styleFavs, snippetFavs]);

  const stylePreviews = React.useMemo(() => {
    const previews = new Map();
    styleFavs.forEach((fav) => {
      const payload = fav.payload || {};
      const blockLike = { id: fav.refKey, ...payload };
      previews.set(fav.id, typeof renderBlockHtml === 'function' ? renderBlockHtml(blockLike) : '');
    });
    return previews;
  }, [styleFavs, renderBlockHtml]);

  const snippetPreviews = React.useMemo(() => {
    const previews = new Map();
    snippetFavs.forEach((fav) => {
      previews.set(fav.id, typeof renderSnippetHtml === 'function' ? renderSnippetHtml(fav) : '');
    });
    return previews;
  }, [snippetFavs, renderSnippetHtml]);

  return (
    <div className="wxc-fav-panel">
      <section className="wxc-fav-section">
        <div className="wxc-fav-section-title">排版收藏</div>
        {layoutFavs.length === 0 ? (
          <div className="wxc-fav-empty">在样式库或画布中点 ★ 收藏</div>
        ) : (
          <div className="wxc-fav-layout-grid">
            {layoutFavs.map(({ favorite: fav, type }) => {
              if (type === 'snippet') {
                const payload = fav.payload || {};
                const count = Array.isArray(payload.blocks) ? payload.blocks.length : 0;
                const previewHtml = snippetPreviews.get(fav.id) || '';
                return (
                  <div
                    key={fav.id}
                    role="button"
                    tabIndex={0}
                    className="wxc-fav-snippet"
                    onClick={() => onInsertSnippet && onInsertSnippet(fav)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && onInsertSnippet) onInsertSnippet(fav); }}
                    title="点击插入到画布末尾"
                  >
                    <div className="wxc-fav-preview-stage">
                      <div
                        className="wxc-fav-preview-canvas"
                        // eslint-disable-next-line react/no-danger
                        dangerouslySetInnerHTML={{ __html: previewHtml }}
                      />
                    </div>
                    <div className="wxc-fav-block-meta">
                      <span className="wxc-fav-snippet-name">{payload.name || '未命名排版'}</span>
                      <span className="wxc-fav-snippet-count">{count} 块</span>
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
              }
              const payload = fav.payload || {};
              const blockLike = { id: fav.refKey, ...payload };
              const previewHtml = stylePreviews.get(fav.id) || '';
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
                  <div className="wxc-fav-preview-stage">
                    <div
                      className="wxc-fav-preview-canvas"
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
