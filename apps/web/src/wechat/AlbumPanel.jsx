// 排版器左侧面板"相册"Tab。契约：
// /private/tmp/claude-501/-Users-liwenyu/f413e1a5-8f0f-436d-b775-8c9faffa99f1/scratchpad/composer-v4-contracts.md 第 2 节
// 约束：不持有画布/收藏状态，插入与收藏均只通过 props 回调交给调用方；本组件自身只管相册/照片两级列表与本地搜索防抖。
// 约束：normalize 后的 photo 形状 {id,url,thumbUrl,description,projectId,projectTitle} 是收藏 payload 的落库快照，
// 字段增减会直接改变收藏记录内容，不得随意扩充。
import React from 'react';
import { fetchProjectList, getProjectById } from '../services/projectService';
import { searchPhotos } from '../services/photoQueryService';
import { resolveAssetUrl } from '../services/request';
import { beginDrag } from './pointerDrag';
import './albumPanel.css';

const ALBUM_PAGE_SIZE = 20;
const PHOTO_SEARCH_PAGE_SIZE = 60;
const SEARCH_DEBOUNCE_MS = 300;

// 相册列表项：兼容 fetchProjectList 返回的 projectName/coverThumbUrl/coverUrl（见 mamage-server routes/projects.js GET /list）。
function normalizeAlbum(raw) {
  if (!raw) return null;
  const id = raw.id !== undefined && raw.id !== null ? String(raw.id) : '';
  if (!id) return null;
  const cover = raw.coverThumbUrl || raw.coverUrl || '';
  return {
    id,
    name: raw.projectName || raw.name || '未命名相册',
    eventDate: raw.eventDate || '',
    coverThumbUrl: cover ? resolveAssetUrl(cover) : '',
  };
}

// 照片 normalize：字段源头见 mamage-server routes/projects.js GET /:id（project.photos）与
// routes/photos.js GET /api/photos/search（list 项），两处字段名一致（url/thumbUrl/projectId/projectName/type），
// 服务端已用 buildUploadUrl 转成绝对地址，这里的 resolveAssetUrl 对绝对地址是幂等直通。
function normalizePhoto(raw, fallbackAlbum) {
  if (!raw) return null;
  const rawId = raw.id !== undefined && raw.id !== null ? raw.id : raw.photoId;
  if (rawId === undefined || rawId === null || rawId === '') return null;
  const rawUrl = raw.url || raw.fullUrl || '';
  const rawThumb = raw.thumbUrl || raw.thumb_url || raw.fullThumbUrl || rawUrl;
  const projectId = raw.projectId !== undefined && raw.projectId !== null
    ? String(raw.projectId)
    : (fallbackAlbum && fallbackAlbum.id !== undefined ? String(fallbackAlbum.id) : '');
  const projectTitle = raw.projectName || (fallbackAlbum && fallbackAlbum.name) || '';
  return {
    id: String(rawId),
    url: resolveAssetUrl(rawUrl),
    thumbUrl: rawThumb ? resolveAssetUrl(rawThumb) : resolveAssetUrl(rawUrl),
    description: raw.description || raw.title || '',
    projectId,
    projectTitle,
  };
}

function filterOutVideos(list) {
  return (Array.isArray(list) ? list : []).filter(
    (p) => String((p && p.type) || '').toLowerCase() !== 'video'
  );
}

function formatEventDate(d) {
  if (!d) return '';
  const s = String(d);
  return s.length >= 10 ? s.slice(0, 10) : s;
}

export default function AlbumPanel({ onInsertPhoto, onToggleFavorite, favoritePhotoKeys }) {
  const [view, setView] = React.useState('list'); // 'list' | 'grid'

  // ── 相册列表视图 ──
  const [keyword, setKeyword] = React.useState('');
  const [albums, setAlbums] = React.useState([]);
  const [albumsLoading, setAlbumsLoading] = React.useState(false);
  const [albumsLoadingMore, setAlbumsLoadingMore] = React.useState(false);
  const [albumsError, setAlbumsError] = React.useState('');
  const [albumPage, setAlbumPage] = React.useState(1);
  const [albumHasMore, setAlbumHasMore] = React.useState(false);

  const albumReqIdRef = React.useRef(0);
  const albumFirstRunRef = React.useRef(true);

  const loadAlbums = React.useCallback((kw, page, append) => {
    const reqId = (albumReqIdRef.current += 1);
    if (append) setAlbumsLoadingMore(true); else setAlbumsLoading(true);
    setAlbumsError('');
    fetchProjectList({ page, pageSize: ALBUM_PAGE_SIZE, keyword: kw })
      .then((res) => {
        if (albumReqIdRef.current !== reqId) return;
        const normalized = (res.list || []).map(normalizeAlbum).filter(Boolean);
        setAlbums((prev) => (append ? [...prev, ...normalized] : normalized));
        setAlbumHasMore(!!res.hasMore);
        setAlbumPage(res.page || page);
      })
      .catch((e) => {
        if (albumReqIdRef.current !== reqId) return;
        setAlbumsError((e && e.message) || '相册加载失败');
      })
      .finally(() => {
        if (albumReqIdRef.current !== reqId) return;
        setAlbumsLoading(false);
        setAlbumsLoadingMore(false);
      });
  }, []);

  // 首屏立即拉第一页（不等防抖）；此后 keyword 变化才走 300ms 防抖。
  React.useEffect(() => {
    if (albumFirstRunRef.current) {
      albumFirstRunRef.current = false;
      loadAlbums('', 1, false);
      return undefined;
    }
    const timer = setTimeout(() => loadAlbums(keyword, 1, false), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyword]);

  const handleLoadMoreAlbums = React.useCallback(() => {
    if (albumsLoadingMore || !albumHasMore) return;
    loadAlbums(keyword, albumPage + 1, true);
  }, [albumsLoadingMore, albumHasMore, keyword, albumPage, loadAlbums]);

  // ── 照片网格视图 ──
  const [currentAlbum, setCurrentAlbum] = React.useState(null); // {id, name}
  const [photoQuery, setPhotoQuery] = React.useState('');
  const [photos, setPhotos] = React.useState([]);
  const [photosLoading, setPhotosLoading] = React.useState(false);
  const [photosError, setPhotosError] = React.useState('');

  const photoReqIdRef = React.useRef(0);
  // 空搜索词时展示的相册全量照片缓存，避免用户清空搜索框时重新打一次网络请求。
  const allProjectPhotosRef = React.useRef([]);

  const loadAllProjectPhotos = React.useCallback((album) => {
    if (!album) return;
    const reqId = (photoReqIdRef.current += 1);
    setPhotosLoading(true);
    setPhotosError('');
    getProjectById(album.id, { includeFaces: false })
      .then((res) => {
        if (photoReqIdRef.current !== reqId) return;
        const raw = filterOutVideos(res && res.photos);
        const normalized = raw.map((p) => normalizePhoto(p, album)).filter(Boolean);
        allProjectPhotosRef.current = normalized;
        setPhotos(normalized);
      })
      .catch((e) => {
        if (photoReqIdRef.current !== reqId) return;
        setPhotosError((e && e.message) || '照片加载失败');
      })
      .finally(() => {
        if (photoReqIdRef.current !== reqId) return;
        setPhotosLoading(false);
      });
  }, []);

  const runPhotoSearch = React.useCallback((album, q) => {
    if (!album) return;
    const reqId = (photoReqIdRef.current += 1);
    setPhotosLoading(true);
    setPhotosError('');
    searchPhotos({ q, projectId: album.id, pageSize: PHOTO_SEARCH_PAGE_SIZE })
      .then((res) => {
        if (photoReqIdRef.current !== reqId) return;
        const raw = filterOutVideos(res && res.list);
        const normalized = raw.map((p) => normalizePhoto(p, album)).filter(Boolean);
        setPhotos(normalized);
      })
      .catch((e) => {
        if (photoReqIdRef.current !== reqId) return;
        setPhotosError((e && e.message) || '搜索失败');
      })
      .finally(() => {
        if (photoReqIdRef.current !== reqId) return;
        setPhotosLoading(false);
      });
  }, []);

  const openAlbum = React.useCallback((album) => {
    setView('grid');
    setCurrentAlbum(album);
    setPhotoQuery('');
    setPhotos([]);
    allProjectPhotosRef.current = [];
    loadAllProjectPhotos(album);
  }, [loadAllProjectPhotos]);

  const backToList = React.useCallback(() => {
    setView('list');
    setCurrentAlbum(null);
    setPhotos([]);
    setPhotoQuery('');
  }, []);

  // 只响应搜索框输入防抖；有意不把 currentAlbum 放进依赖——切相册由 openAlbum 直接管理 photos/
  // 缓存，这里的闭包始终读到当前渲染时的 currentAlbum，不会因未入依赖而读到过期值。
  React.useEffect(() => {
    if (!currentAlbum) return undefined;
    const q = photoQuery.trim();
    if (!q) {
      setPhotos(allProjectPhotosRef.current);
      setPhotosError('');
      return undefined;
    }
    const timer = setTimeout(() => runPhotoSearch(currentAlbum, q), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photoQuery]);

  const retryPhotos = React.useCallback(() => {
    if (!currentAlbum) return;
    const q = photoQuery.trim();
    if (!q) loadAllProjectPhotos(currentAlbum);
    else runPhotoSearch(currentAlbum, q);
  }, [currentAlbum, photoQuery, loadAllProjectPhotos, runPhotoSearch]);

  const isFavPhoto = React.useCallback((photoId) => {
    if (!favoritePhotoKeys || typeof favoritePhotoKeys.has !== 'function') return false;
    return favoritePhotoKeys.has(String(photoId));
  }, [favoritePhotoKeys]);

  const handleStarClick = React.useCallback((e, photo) => {
    e.stopPropagation();
    onToggleFavorite(photo, !isFavPhoto(photo.id));
  }, [onToggleFavorite, isFavPhoto]);

  return (
    <div className="wxc-alb-panel">
      {view === 'list' ? (
        <React.Fragment>
          <div className="wxc-alb-search">
            <input
              className="wxc-alb-search-input"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="搜索相册名…"
            />
          </div>
          <div className="wxc-alb-list">
            {albums.map((album) => (
              <div
                key={album.id}
                className="wxc-alb-item"
                onClick={() => openAlbum(album)}
              >
                <div className={`wxc-alb-item-cover${album.coverThumbUrl ? '' : ' wxc-alb-item-cover--empty'}`}>
                  {album.coverThumbUrl ? (
                    <img src={album.coverThumbUrl} alt="" loading="lazy" draggable={false} />
                  ) : null}
                </div>
                <div className="wxc-alb-item-meta">
                  <div className="wxc-alb-item-name">{album.name}</div>
                  <div className="wxc-alb-item-date">{formatEventDate(album.eventDate)}</div>
                </div>
              </div>
            ))}
            {!albumsLoading && !albumsError && albums.length === 0 ? (
              <div className="wxc-alb-state">没有找到相册</div>
            ) : null}
            {albumsLoading ? <div className="wxc-alb-state">加载中…</div> : null}
            {albumsError ? (
              <div className="wxc-alb-state wxc-alb-state--error">
                {albumsError}
                <button type="button" className="wxc-alb-retry-btn" onClick={() => loadAlbums(keyword, 1, false)}>重试</button>
              </div>
            ) : null}
            {!albumsLoading && !albumsError && albumHasMore ? (
              <button
                type="button"
                className="wxc-alb-loadmore"
                disabled={albumsLoadingMore}
                onClick={handleLoadMoreAlbums}
              >
                {albumsLoadingMore ? '加载中…' : '加载更多'}
              </button>
            ) : null}
          </div>
        </React.Fragment>
      ) : (
        <React.Fragment>
          <div className="wxc-alb-toolbar">
            <button type="button" className="wxc-alb-back-btn" onClick={backToList}>‹ 返回</button>
            <div className="wxc-alb-toolbar-title">{currentAlbum ? currentAlbum.name : ''}</div>
          </div>
          <div className="wxc-alb-photo-search">
            <input
              className="wxc-alb-photo-search-input"
              value={photoQuery}
              onChange={(e) => setPhotoQuery(e.target.value)}
              placeholder="相册内搜索…"
            />
          </div>
          <div className="wxc-alb-grid">
            {photos.map((photo) => {
              const fav = isFavPhoto(photo.id);
              return (
                <div
                  key={photo.id}
                  className="wxc-alb-photo"
                  onClick={() => onInsertPhoto(photo)}
                  onPointerDown={(e) => beginDrag(e, { kind: 'photo-item', data: photo, ghostLabel: photo.description || '照片' })}
                  onDragStart={(e) => e.preventDefault()}
                >
                  <img
                    className="wxc-alb-photo-img"
                    src={photo.thumbUrl || photo.url}
                    alt={photo.description || ''}
                    loading="lazy"
                    draggable={false}
                  />
                  <button
                    type="button"
                    className={`wxc-alb-star${fav ? ' is-active' : ''}`}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => handleStarClick(e, photo)}
                    aria-label={fav ? '取消收藏' : '收藏'}
                    title={fav ? '取消收藏' : '收藏'}
                  >
                    {fav ? '★' : '☆'}
                  </button>
                </div>
              );
            })}
            {!photosLoading && !photosError && photos.length === 0 ? (
              <div className="wxc-alb-state">{photoQuery.trim() ? '没有找到匹配的照片' : '这个相册还没有照片'}</div>
            ) : null}
            {photosLoading ? <div className="wxc-alb-state">加载中…</div> : null}
            {photosError ? (
              <div className="wxc-alb-state wxc-alb-state--error">
                {photosError}
                <button type="button" className="wxc-alb-retry-btn" onClick={retryPhotos}>重试</button>
              </div>
            ) : null}
          </div>
        </React.Fragment>
      )}
    </div>
  );
}
