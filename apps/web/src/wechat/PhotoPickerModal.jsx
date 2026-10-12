import React from 'react';
import { Modal, Toast } from '../ui';
import { fetchProjectList, getProjectById } from '../services/projectService';
import { request, resolveAssetUrl } from '../services/request';

// 三源选图弹窗：中转站 / 相册 / AI 搜图。
// 修"换图死路"：原来只有中转站一个源，而编辑器内没有入站入口；现在相册浏览与
// 全库自然语言搜图（smart=1，含人物/场景/推荐质量解析）都在弹窗内完成。
// 选中统一走 onPick(item)，item 形状与中转站条目一致：{id, thumbUrl, fullUrl, description}。

function toPickItem(p) {
  const thumb = resolveAssetUrl(p.thumbUrl || p.url || p.thumb || '');
  const full = resolveAssetUrl(p.url || p.originalUrl || p.original || thumb);
  const id = p.id != null ? String(p.id) : (p.photoId != null ? String(p.photoId) : '');
  if (!id || !thumb) return null;
  return {
    id,
    thumbUrl: thumb,
    fullUrl: full || thumb,
    description: p.description || p.title || '',
    aiScore: p.aiScore != null ? p.aiScore : null,
  };
}

function PhotoGrid({ items, onPick, emptyText }) {
  if (!items.length) {
    return <div className="ppk-empty">{emptyText || '暂无照片'}</div>;
  }
  return (
    <div className="wxc-photopick-grid">
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          className="wxc-photopick-thumb"
          onClick={() => onPick(it)}
          title={it.description || `照片 #${it.id}`}
        >
          {it.thumbUrl ? (
            <img src={it.thumbUrl} alt={it.description || `#${it.id}`} loading="lazy" />
          ) : (
            <span className="wxc-photopick-fallback">#{it.id}</span>
          )}
        </button>
      ))}
    </div>
  );
}

function AlbumTab({ onPick }) {
  const [albums, setAlbums] = React.useState(null); // null=加载中
  const [album, setAlbum] = React.useState(null);   // 当前相册 {id, name}
  const [photos, setPhotos] = React.useState([]);
  const [loadingPhotos, setLoadingPhotos] = React.useState(false);

  React.useEffect(() => {
    let canceled = false;
    fetchProjectList({ page: 1, pageSize: 50 })
      .then((r) => {
        if (canceled) return;
        setAlbums(Array.isArray(r && r.list) ? r.list : []);
      })
      .catch(() => { if (!canceled) setAlbums([]); });
    return () => { canceled = true; };
  }, []);

  const openAlbum = React.useCallback((a) => {
    setAlbum(a);
    setLoadingPhotos(true);
    setPhotos([]);
    getProjectById(a.id, { includeFaces: false })
      .then((r) => {
        const list = Array.isArray(r && r.photos) ? r.photos : (Array.isArray(r && r.list) ? r.list : []);
        setPhotos(list.map(toPickItem).filter(Boolean));
      })
      .catch(() => Toast.error('拉取相册照片失败'))
      .finally(() => setLoadingPhotos(false));
  }, []);

  if (albums === null) return <div className="ppk-empty">正在加载相册…</div>;
  if (album) {
    return (
      <div>
        <button type="button" className="ppk-back" onClick={() => { setAlbum(null); setPhotos([]); }}>
          ← 返回相册列表{album.name ? `（${album.name}）` : ''}
        </button>
        {loadingPhotos ? <div className="ppk-empty">正在加载照片…</div> : (
          <PhotoGrid items={photos} onPick={onPick} emptyText="该相册暂无照片" />
        )}
      </div>
    );
  }
  if (!albums.length) return <div className="ppk-empty">还没有相册</div>;
  return (
    <div className="ppk-album-list">
      {albums.map((a) => (
        <button key={a.id} type="button" className="ppk-album-item" onClick={() => openAlbum(a)}>
          {a.coverThumbUrl || a.coverUrl ? <img src={resolveAssetUrl(a.coverThumbUrl || a.coverUrl)} alt="" loading="lazy" /> : null}
          <span className="ppk-album-name">{a.projectName || a.title || a.name || `相册 #${a.id}`}</span>
        </button>
      ))}
    </div>
  );
}

function AiSearchTab({ onPick }) {
  const [q, setQ] = React.useState('');
  const [items, setItems] = React.useState([]);
  const [hint, setHint] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [searched, setSearched] = React.useState(false);

  const run = React.useCallback(() => {
    const query = q.trim();
    if (!query) { Toast.warning('输入描述，如：讲台演讲 特写 推荐'); return; }
    setBusy(true);
    setHint('');
    request('/api/photos/search', {
      method: 'GET',
      data: { q: query, smart: 1, page: 1, pageSize: 24, sort: 'relevance' },
    })
      .then((d) => {
        setItems((d && d.list ? d.list : []).map(toPickItem).filter(Boolean));
        const srch = (d && d.search) || {};
        setHint(srch.relaxedHint || '');
      })
      .catch((e) => Toast.error(`搜图失败：${(e && e.message) || '稍后再试'}`))
      .finally(() => { setBusy(false); setSearched(true); });
  }, [q]);

  return (
    <div>
      <div className="ppk-search-row">
        <input
          className="ppk-search-input"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') run(); }}
          placeholder="自然语言搜全库：如「王婧琦 讲台 特写」或「颁奖 合影 推荐」"
        />
        <button type="button" className="ppk-search-btn" disabled={busy} onClick={run}>
          {busy ? '搜索中…' : 'AI 搜图'}
        </button>
      </div>
      {hint ? <div className="ppk-hint">{hint}</div> : null}
      {busy && !items.length ? <div className="ppk-empty">AI 正在理解并检索照片…</div> : null}
      {!busy && searched && !items.length ? <div className="ppk-empty">没有匹配的照片，换个说法试试（如加「推荐」、去「特写」）</div> : null}
      <PhotoGrid items={items} onPick={onPick} emptyText="" />
    </div>
  );
}

export default function PhotoPickerModal({ visible, onClose, stationItems, onPick, replacing }) {
  const [tab, setTab] = React.useState('station');
  const close = React.useCallback(() => { setTab('station'); onClose(); }, [onClose]);

  return (
    <Modal
      visible={visible}
      title={replacing ? '选择照片（替换当前图片）' : '选择照片（插入画布）'}
      onCancel={close}
      footer={null}
      width={640}
    >
      <div className="ppk-tabs" role="tablist">
        {[['station', '中转站'], ['album', '相册'], ['ai', 'AI 搜图']].map(([key, name]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            className={`ppk-tab${tab === key ? ' is-active' : ''}`}
            onClick={() => setTab(key)}
          >
            {name}
          </button>
        ))}
      </div>
      {tab === 'station' ? (
        <PhotoGrid
          items={stationItems}
          onPick={onPick}
          emptyText="中转站还没有照片。可切换到「相册」或「AI 搜图」直接选。"
        />
      ) : null}
      {tab === 'album' ? <AlbumTab onPick={onPick} /> : null}
      {tab === 'ai' ? <AiSearchTab onPick={onPick} /> : null}
    </Modal>
  );
}
