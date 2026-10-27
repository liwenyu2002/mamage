import React from 'react';
import { Modal, Button, Input, SegmentedControl } from './ui';
import { IconChevronLeft } from './ui/icons';
import { request, resolveAssetUrl } from './services/request';
import { getAll as getTransferAll } from './services/transferStore';
import { NEWS_PHOTO_LIMIT, normalizeNewsPhoto, mergeNewsPhotos } from './utils/newsPhotoSelection';

// Only mounted while open. Aborted requests cannot replace a newer album or search.
export default function NewsPhotoPicker({ photos, onConfirm, onClose }) {
  const [selected, setSelected] = React.useState(() => mergeNewsPhotos(photos));
  const [source, setSource] = React.useState('albums');
  const [album, setAlbum] = React.useState(null);
  const [keyword, setKeyword] = React.useState('');
  const [query, setQuery] = React.useState('');
  const [page, setPage] = React.useState(1);
  const [rows, setRows] = React.useState([]);
  const [hasMore, setHasMore] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const [attempt, setAttempt] = React.useState(0);
  const [limitNotice, setLimitNotice] = React.useState(false);
  const selectedIds = new Set(selected.map(photo => photo.id));

  React.useEffect(() => {
    if (keyword.trim() === query) return undefined;
    const timer = setTimeout(() => { setQuery(keyword.trim()); setPage(1); }, 250);
    return () => clearTimeout(timer);
  }, [keyword, query]);

  React.useEffect(() => {
    const controller = new AbortController();
    setBusy(true); setError('');
    if (page === 1) setRows([]);
    async function load() {
      try {
        if (source === 'station') {
          const seen = new Set();
          setRows((getTransferAll() || []).map(photo => normalizeNewsPhoto(photo)).filter(photo => {
            if (!photo || seen.has(photo.id)) return false;
            seen.add(photo.id); return true;
          }));
          setHasMore(false);
          return;
        }
        const response = await request(album ? '/api/photos/search' : '/api/projects/list', {
          method: 'GET', signal: controller.signal,
          data: album ? { projectId: album.id, q: '', page, pageSize: 40, smart: 0, sort: 'newest' }
            : { page, pageSize: 24, keyword: query },
        });
        if (controller.signal.aborted) return;
        const list = Array.isArray(response.list) ? response.list : [];
        const next = album ? list.map(photo => normalizeNewsPhoto(photo, album)).filter(Boolean) : list;
        setRows(previous => page === 1 ? next : [...previous, ...next.filter(item => !previous.some(old => String(old.id) === String(item.id)))]);
        setHasMore(Boolean(response.hasMore));
      } catch (failure) {
        if (!controller.signal.aborted) setError('照片材料暂时无法读取，请重试');
      } finally {
        if (!controller.signal.aborted) setBusy(false);
      }
    }
    load();
    return () => controller.abort();
  }, [source, album, query, page, attempt]);

  const choose = photo => {
    if (selectedIds.has(photo.id)) { setSelected(previous => previous.filter(item => item.id !== photo.id)); setLimitNotice(false); }
    else if (selected.length < NEWS_PHOTO_LIMIT) { setSelected(previous => mergeNewsPhotos(previous, [photo])); setLimitNotice(false); }
    else setLimitNotice(true);
  };
  const reset = () => { setRows([]); setError(''); setPage(1); };
  return <Modal visible className="news-photo-picker" title="选择活动照片" width={820} onCancel={onClose} footer={
    <div className="news-picker-footer">
      <span role="status">已选 {selected.length} / {NEWS_PHOTO_LIMIT} 张{limitNotice ? '，已达上限' : ''}</span>
      <Button theme="borderless" onClick={() => { setSelected([]); setLimitNotice(false); }}>清空选择</Button>
      <Button type="primary" onClick={() => onConfirm(selected)}>使用所选照片</Button>
    </div>}>
    <div className="news-picker">
      <div className="news-picker-toolbar">
        <SegmentedControl label="照片来源" value={source} options={[{ value: 'albums', label: '相册' }, { value: 'station', label: '中转站' }]}
          onChange={value => { setSource(value); setAlbum(null); setKeyword(''); setQuery(''); reset(); }} />
        {source === 'albums' && !album ? <Input aria-label="搜索活动相册" placeholder="搜索相册" value={keyword} onChange={setKeyword} /> : null}
      </div>
      {album ? <div className="news-picker-path">
        <Button icon={<IconChevronLeft />} size="small" theme="borderless" onClick={() => { setAlbum(null); reset(); }}>相册</Button>
        <strong>{album.projectName || album.name || album.title}</strong>
        <Button size="small" theme="borderless" disabled={busy || !rows.length} onClick={() => {
          const next = mergeNewsPhotos(selected, rows);
          setLimitNotice(selected.length + rows.filter(photo => !selectedIds.has(photo.id)).length > NEWS_PHOTO_LIMIT);
          setSelected(next);
        }}>选择本页</Button>
      </div> : null}
      <div className={`news-picker-grid${album || source === 'station' ? ' is-photos' : ''}`} aria-busy={busy}>
        {rows.map(row => album || source === 'station' ? <button type="button" className="news-picker-photo" key={row.id}
          aria-label={`选择照片 ${row.id}`} aria-pressed={selectedIds.has(row.id)} onClick={() => choose(row)}>
          <img src={resolveAssetUrl(row.thumbUrl)} alt={row.description || '活动照片'} loading="lazy" />
          <span className="news-picker-check" aria-hidden="true">{selectedIds.has(row.id) ? selected.findIndex(photo => photo.id === row.id) + 1 : ''}</span>
        </button> : <button type="button" className="news-picker-album" key={row.id}
          onClick={() => { setAlbum(row); setKeyword(''); setQuery(''); reset(); }}>
          {row.coverThumbUrl || row.coverUrl || row.cover ? <img src={resolveAssetUrl(row.coverThumbUrl || row.coverUrl || row.cover)} alt="" loading="lazy" />
            : <span className="news-picker-album-placeholder" aria-hidden="true" />}
          <strong>{row.projectName || row.name || row.title || '未命名相册'}</strong>
          <small>{row.photoCount ?? row.count ?? 0} 张</small>
        </button>)}
      </div>
      {busy ? <p className="news-picker-message" role="status">正在读取{album ? '照片' : '相册'}…</p>
        : error ? <div className="news-picker-message" role="alert">{error} <Button size="small" onClick={() => setAttempt(value => value + 1)}>重试</Button></div>
          : !rows.length ? <p className="news-picker-message">{source === 'station' ? '中转站暂无照片' : album ? '本页暂无照片' : '没有找到相册'}</p> : null}
      {hasMore && !error ? <Button className="news-picker-more" disabled={busy} onClick={() => setPage(value => value + 1)}>加载更多</Button> : null}
    </div>
  </Modal>;
}
