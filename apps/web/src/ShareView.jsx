import React from 'react';
import FindMeModal from './FindMeModal';
import { resolveAssetUrl, rewriteMediaUrlsDeep } from './services/request';
import {
  IconChevronLeft, IconChevronRight, IconClose, IconDownload,
  IconFaceScan, IconGridView, IconMasonryView,
} from './ui/icons';
import './ShareView.css';

function formatDate(v) {
  const date = new Date(v);
  if (Number.isNaN(date.getTime())) return String(v || '');
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' }).format(date);
}

function normalizeShareTimelineSections(input) {
  if (!Array.isArray(input)) return [];
  return input
    .map((section, idx) => {
      const rawId = section?.id ?? section?.sectionId ?? section?.timelineSectionId ?? '';
      const id = rawId === null || rawId === undefined ? '' : String(rawId).trim();
      const name = String(section?.name || section?.title || section?.label || '').trim();
      const sectionTime = String(section?.sectionTime || section?.section_time || section?.time || '').trim();
      const sortOrder = Number.isFinite(Number(section?.sortOrder ?? section?.sort_order))
        ? Number(section?.sortOrder ?? section?.sort_order)
        : idx;
      return { id, key: id || `${name}:${idx}`, name, sectionTime, sortOrder };
    })
    .filter((section) => section.name)
    .sort((a, b) => (a.sortOrder - b.sortOrder) || String(a.name).localeCompare(String(b.name), 'zh-Hans-CN'));
}

function getSharePhotoSectionId(photo) {
  const raw = photo?.timelineSectionId ?? photo?.timeline_section_id ?? photo?.sectionId ?? '';
  if (raw === null || raw === undefined) return '';
  return String(raw).trim();
}

// 从 URL 推断查看器单张下载的文件扩展名。
function inferExt(rawUrl) {
  try {
    const u = new URL(String(rawUrl || ''), window.location.origin);
    const m = String(u.pathname || '').match(/\.([a-zA-Z0-9]{2,6})$/);
    return m && m[1] ? `.${String(m[1]).toLowerCase()}` : '.jpg';
  } catch (e) {
    return '.jpg';
  }
}

function getSharePhotoSectionLabel(photo, sections) {
  const direct = String(photo?.timelineSectionName || photo?.timeline_section_name || photo?.sectionName || '').trim();
  if (direct) return direct;
  const sectionId = getSharePhotoSectionId(photo);
  if (!sectionId) return '';
  const found = (sections || []).find((section) => String(section.id || '') === sectionId);
  return found ? found.name : '';
}

export default function ShareView({ share = {}, onBack }) {
  const [viewMode, setViewMode] = React.useState('grid');
  const shareCode = share.shareCode || share.code || '';
  const [photos, setPhotos] = React.useState(() => (
    Array.isArray(share.photos) ? share.photos : (Array.isArray(share.images) ? share.images : [])
  ));
  const pageSize = Number(share.limit) || 100;
  const [hasMore, setHasMore] = React.useState(() => Boolean(shareCode && photos.length >= pageSize));
  const [moreLoading, setMoreLoading] = React.useState(false);
  const [moreError, setMoreError] = React.useState('');

  const creatorName = share.creatorName
    || share.sharedBy
    || share.owner
    || share.creator
    || share.shareBy
    || (share.photos && share.photos[0] && share.photos[0].photographerName)
    || '分享者';
  const expiresAtField = typeof share.expiresAt !== 'undefined' ? share.expiresAt : null;
  const remainingSecondsField = typeof share.remainingSeconds === 'number' ? share.remainingSeconds : null;
  const fallbackExpiry = React.useRef(remainingSecondsField === null ? null : Date.now() + remainingSecondsField * 1000);
  const [nowMs, setNowMs] = React.useState(Date.now);
  React.useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 60000);
    return () => window.clearInterval(timer);
  }, []);
  const expirationTime = expiresAtField ? new Date(expiresAtField).getTime() : fallbackExpiry.current;
  const remainingSec = Number.isFinite(expirationTime)
    ? Math.max(0, Math.floor((expirationTime - nowMs) / 1000)) : null;
  const isUnavailable = !!(share && (
    share.error
    || (typeof share.message === 'string' && /过期/.test(share.message))
    || remainingSec === 0
  ));
  const unavailableTitle = share.error === 'LOAD_FAILED' ? '暂时无法打开分享'
    : share.error === 'NOT_FOUND' ? '分享链接不存在' : '分享链接已失效';
  const title = share.title || share.projectName
    || (share.project && (share.project.title || share.project.name)) || '照片分享';

  const loadMore = async () => {
    if (!shareCode || !hasMore || moreLoading) return;
    setMoreLoading(true);
    setMoreError('');
    try {
      const response = await fetch(`/api/share/${encodeURIComponent(shareCode)}?limit=${pageSize}&offset=${photos.length}`);
      if (!response.ok) throw new Error('加载失败，请重试');
      const data = rewriteMediaUrlsDeep(await response.json());
      const next = Array.isArray(data.photos) ? data.photos : [];
      setPhotos((current) => current.concat(next));
      setHasMore(next.length >= pageSize);
    } catch (err) {
      setMoreError(err?.message || '加载失败，请重试');
    } finally {
      setMoreLoading(false);
    }
  };

  const timelineSections = React.useMemo(() => normalizeShareTimelineSections(share.timelineSections || share.timeline_sections), [share]);
  const timelineGroups = React.useMemo(() => {
    const hasPhotoSection = photos.some((photo) => getSharePhotoSectionId(photo) || getSharePhotoSectionLabel(photo, timelineSections));
    if (!timelineSections.length && !hasPhotoSection) return [];
    const groups = timelineSections.map((section) => ({ ...section, items: [] }));
    const byId = new Map(groups.filter((section) => section.id).map((section) => [String(section.id), section]));
    const byName = new Map(groups.map((section) => [String(section.name), section]));
    const dynamicGroups = [];
    const ungrouped = { id: '', key: '__uncategorized__', name: '未归类', sectionTime: '', sortOrder: 999999, items: [] };
    photos.forEach((photo, idx) => {
      const sectionId = getSharePhotoSectionId(photo);
      const label = getSharePhotoSectionLabel(photo, timelineSections);
      let group = sectionId ? byId.get(sectionId) : null;
      if (!group && label) group = byName.get(label);
      if (!group && label) {
        group = { id: '', key: `dynamic:${label}`, name: label, sectionTime: '', sortOrder: dynamicGroups.length, items: [] };
        dynamicGroups.push(group);
        byName.set(label, group);
      }
      (group || ungrouped).items.push({ photo, idx });
    });
    return [
      ...groups.filter((group) => group.items.length),
      ...dynamicGroups.filter((group) => group.items.length),
      ...(ungrouped.items.length ? [ungrouped] : []),
    ];
  }, [photos, timelineSections]);

  const thumbFor = (p) => {
    if (!p) return null;
    if (typeof p === 'string') return resolveAssetUrl(p);
    return resolveAssetUrl(p.thumbUrl || p.thumb || p.thumbnail || p.url || p.imageUrl || p.src || p.fileUrl || p);
  };

  const originalFor = (p) => {
    if (!p) return null;
    if (typeof p === 'string') return resolveAssetUrl(p);
    return resolveAssetUrl(p.url || p.originalUrl || p.original || p.full || p.large || p.imageUrl || p.src || p.fileUrl || p);
  };

  // 公开分享的单张照片下载优先走全尺寸、限体积的公网下载版；缺失时保持原图回退。
  const publicDownloadFor = (p) => {
    if (!p || typeof p === 'string') return null;
    return resolveAssetUrl(p.publicDownloadUrl || p.public_download_url || p.webDownloadUrl || '');
  };

  const isVideoPhoto = (p) => {
    if (!p || typeof p === 'string') return false;
    const t = String(p.type || p.mediaType || p.media_type || '').toLowerCase();
    if (t === 'video') return true;
    return /\.(mp4|m4v|mov|webm|ogv)(\?|$)/i.test(String(p.url || ''));
  };

  // 视频缩略图只认后端的 JPEG poster（thumb_url），没有就不给 <img> 塞 mp4
  const posterFor = (p) => {
    if (!p || typeof p === 'string') return null;
    const raw = p.thumbUrl || p.thumb || p.thumbnail || '';
    return raw ? resolveAssetUrl(raw) : null;
  };

  // 播放优先转码产物，老数据回退原始文件
  const playbackFor = (p) => {
    if (!p || typeof p === 'string') return null;
    return resolveAssetUrl(p.playbackUrl || p.playback_url || p.url || '') || null;
  };

  const [viewerVisible, setViewerVisible] = React.useState(false);
  const [viewerIndex, setViewerIndex] = React.useState(0);
  const [viewerShowOriginalMap, setViewerShowOriginalMap] = React.useState({});
  const [videoErrorMap, setVideoErrorMap] = React.useState({});

  // 限定翻页序列（photos 索引数组）：拍照找我等场景只在命中集合内切换；null=整册顺序。普通打开自动清空。
  const [viewerSeq, setViewerSeq] = React.useState(null);
  const openViewer = (idx) => { setViewerSeq(null); setViewerIndex(idx); setViewerVisible(true); setSvChrome(true); };

  // 沉浸式查看器的手机交互：滑动翻页 + 轻点切换顶/底栏
  const [svChrome, setSvChrome] = React.useState(true);
  const svTouchRef = React.useRef(null);
  const svSwipedRef = React.useRef(false);
  const svTouchStart = (e) => {
    const t = e.touches && e.touches[0];
    if (t) svTouchRef.current = { x: t.clientX, y: t.clientY };
  };
  const svTouchEnd = (e) => {
    const s = svTouchRef.current;
    svTouchRef.current = null;
    const t = e.changedTouches && e.changedTouches[0];
    if (!s || !t) return;
    const dx = t.clientX - s.x;
    const dy = t.clientY - s.y;
    if (Math.abs(dx) > 56 && Math.abs(dx) > Math.abs(dy) * 1.4) {
      svSwipedRef.current = true;
      window.setTimeout(() => { svSwipedRef.current = false; }, 400);
      if (dx < 0) viewerNext(); else viewerPrev();
    }
  };
  const downloadCurrentViewerPhoto = () => {
    const p = photos[viewerIndex];
    if (!p) return;
    const url = (isVideoPhoto(p) ? null : publicDownloadFor(p)) || originalFor(p) || thumbFor(p);
    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    a.download = `photo_${viewerIndex}${inferExt(url)}`;
    a.target = '_blank';
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  // 拍照找我（公开分享页,分享码鉴权）：命中照片 → 打开查看器,且翻页限定在命中集合内(按相似度顺序)
  const [findMeOpen, setFindMeOpen] = React.useState(false);
  const photoIndexById = (pid) => photos.findIndex((p) => {
    const raw = p && (p.id || p.photoId || p.photo_id);
    return raw != null && String(raw) === String(pid);
  });
  const handleFindMePick = (m, allMatches) => {
    const idx = photoIndexById(m && m.photoId);
    if (idx < 0) return;
    const seq = (Array.isArray(allMatches) ? allMatches : [])
      .map((x) => photoIndexById(x.photoId))
      .filter((i) => i >= 0);
    setFindMeOpen(false);
    openViewer(idx); // 内部会清 seq
    if (seq.length > 1) setViewerSeq(seq); // 同一批 setState,序列最终生效
  };
  const closeViewer = () => setViewerVisible(false);
  const viewerPrev = () => setViewerIndex((i) => {
    if (viewerSeq && viewerSeq.length) {
      const p = viewerSeq.indexOf(i);
      return p > 0 ? viewerSeq[p - 1] : i;
    }
    return Math.max(0, i - 1);
  });
  const viewerNext = () => setViewerIndex((i) => {
    if (viewerSeq && viewerSeq.length) {
      const p = viewerSeq.indexOf(i);
      return (p >= 0 && p < viewerSeq.length - 1) ? viewerSeq[p + 1] : i;
    }
    return Math.min(photos.length - 1, i + 1);
  });

  // 查看器键盘操作：Esc 关闭、左右方向键翻页（lightbox 标准交互）
  React.useEffect(() => {
    if (!viewerVisible) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') closeViewer();
      else if (e.key === 'ArrowLeft') viewerPrev();
      else if (e.key === 'ArrowRight') viewerNext();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [viewerVisible, photos.length]);

  React.useEffect(() => {
    if (!viewerVisible) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, [viewerVisible]);

  const expiryHint = remainingSec !== null && remainingSec <= 7 * 86400
    ? remainingSec >= 86400 ? `剩余 ${Math.ceil(remainingSec / 86400)} 天`
      : remainingSec >= 3600 ? `剩余 ${Math.ceil(remainingSec / 3600)} 小时`
        : '即将过期'
    : '';

  const renderPhotoCard = (p, idx, masonry = false, grouped = false) => {
    const sectionLabel = grouped ? '' : getSharePhotoSectionLabel(p, timelineSections);
    const isVideo = isVideoPhoto(p);
    const poster = isVideo ? posterFor(p) : null;
    const image = isVideo ? poster : thumbFor(p);
    return (
      <button type="button" key={p?.id || idx}
        className={`share-photo${masonry ? ' is-masonry' : ''}${photos.length === 1 ? ' is-single' : ''}`}
        onClick={() => openViewer(idx)} aria-label={`查看第 ${idx + 1} 张${isVideo ? '视频' : '照片'}`}>
        {image ? (
            <img
              src={image}
              alt={p?.title || p?.description || ''}
              loading={idx < 4 ? 'eager' : 'lazy'} decoding="async"
            />
          ) : <span className="share-photo-placeholder">{isVideo ? '视频暂无封面' : '照片暂不可用'}</span>}
        {isVideo ? <span className="share-photo-play" aria-hidden="true">▶</span> : null}
        {sectionLabel ? <span className="share-photo-section">{sectionLabel}</span> : null}
      </button>
    );
  };

  const renderGallery = (items, grouped = false) => (
    <div className={`share-gallery-${viewMode}${photos.length === 1 ? ' is-single' : ''}`}>
      {items.map(({ photo, idx }) => renderPhotoCard(photo, idx, viewMode === 'masonry', grouped))}
    </div>
  );

  return (
    <main className="share-page">
      <div className="share-page-inner">
        <nav className="share-nav" aria-label="公开分享导航">
          {typeof onBack === 'function' ? (
            <button type="button" className="share-back" onClick={onBack} aria-label="返回图库">
              <IconChevronLeft aria-hidden="true" /><span>返回图库</span>
            </button>
          ) : <span className="share-nav-spacer" />}
          <span className="share-brand">MaMage <span>公开分享</span></span>
          {!isUnavailable && shareCode && photos.length > 0 ? (
            <button type="button" className="share-findme" onClick={() => setFindMeOpen(true)}>
              <IconFaceScan aria-hidden="true" /><span>拍照找我</span>
            </button>
          ) : <span className="share-nav-spacer" />}
        </nav>

        <header className="share-heading">
          <div className="share-heading-main">
            <h1>{isUnavailable ? unavailableTitle : title}</h1>
            {!isUnavailable && share.note ? <p className="share-note">{share.note}</p> : null}
            {!isUnavailable ? (
              <div className="share-byline">
                <span>{creatorName} 分享</span>
                {share.organizationName ? <span>{share.organizationName}</span> : null}
                {share.createdAt ? <span>{formatDate(share.createdAt)} 创建</span> : null}
                <span>{expiresAtField ? `有效至 ${formatDate(expiresAtField)}` : '长期有效'}</span>
                {expiryHint ? <span className="share-expiry-hint">{expiryHint}</span> : null}
              </div>
            ) : (
              <div className="share-unavailable">
                <p className="share-unavailable-copy">{share.message || '此链接已过期或被撤销。'}</p>
                {share.error === 'LOAD_FAILED' ? (
                  <button type="button" onClick={() => window.location.reload()}>重新加载</button>
                ) : null}
              </div>
            )}
          </div>
        </header>

        {!isUnavailable ? (
          <section className="share-content" aria-label="分享的照片和视频">
            <div className="share-gallery-toolbar">
              <strong>作品 <span>{photos.length}{hasMore ? '+' : ''}</span></strong>
              {photos.length > 1 ? (
                <div className="share-layout-switch" role="group" aria-label="照片排列方式">
                  <button type="button" className={viewMode === 'grid' ? 'is-active' : ''}
                    onClick={() => setViewMode('grid')} aria-label="宫格视图" title="宫格视图" aria-pressed={viewMode === 'grid'}>
                    <IconGridView aria-hidden="true" />
                  </button>
                  <button type="button" className={viewMode === 'masonry' ? 'is-active' : ''}
                    onClick={() => setViewMode('masonry')} aria-label="瀑布流视图" title="瀑布流视图" aria-pressed={viewMode === 'masonry'}>
                    <IconMasonryView aria-hidden="true" />
                  </button>
                </div>
              ) : null}
            </div>
            {photos.length ? (
              timelineGroups.length ? (
                <div className="share-sections">
                  {timelineGroups.map((group) => (
                    <section className="share-section" key={group.key || group.name}>
                      <div className="share-section-heading">
                        <h2>{group.name}</h2>
                        {group.sectionTime ? <time>{group.sectionTime}</time> : null}
                        <span>{group.items.length} 张</span>
                      </div>
                      {renderGallery(group.items, true)}
                    </section>
                  ))}
                </div>
              ) : renderGallery(photos.map((photo, idx) => ({ photo, idx })))
            ) : <p className="share-empty">这个分享还没有照片。</p>}
            {hasMore ? (
              <div className="share-load-more">
                {moreError ? <span role="alert">{moreError}</span> : null}
                <button type="button" onClick={loadMore} disabled={moreLoading}>
                  {moreLoading ? '正在加载…' : '加载更多照片'}
                </button>
              </div>
            ) : null}
          </section>
        ) : null}

        {viewerVisible ? (() => {
          const p = photos[viewerIndex] || {};
          const isVid = isVideoPhoto(p);
          // 限定序列(找我结果)时,计数与首末判断都按序列内位置
          const seqPos = (viewerSeq && viewerSeq.length) ? viewerSeq.indexOf(viewerIndex) : -1;
          const navTotal = seqPos >= 0 ? viewerSeq.length : photos.length;
          const navPos = seqPos >= 0 ? seqPos : viewerIndex;
          return (
            /* 沉浸式查看器（手机优先）：纯黑全屏图区 + 可隐藏的顶/底栏；左右滑动翻页,轻点切换栏 */
            <div className="sv-viewer" role="dialog" aria-label="照片查看器">
              <div
                className="sv-stage"
                onTouchStart={svTouchStart}
                onTouchEnd={svTouchEnd}
                onClick={(e) => {
                  if (svSwipedRef.current) { svSwipedRef.current = false; return; }
                  if (e.target.tagName === 'VIDEO' || (e.target.closest && e.target.closest('button, a'))) return;
                  if (e.target === e.currentTarget) { closeViewer(); return; }
                  const w = window.innerWidth || 1;
                  if (e.clientX < w * 0.3) { viewerPrev(); return; }
                  if (e.clientX > w * 0.7) { viewerNext(); return; }
                  setSvChrome((v) => !v);
                }}
              >
                {isVid ? (
                  videoErrorMap[viewerIndex] ? (
                    <div className="sv-video-error">该视频暂时无法在线播放（可能仍在转码或格式不受浏览器支持），可下载后观看。</div>
                  ) : (
                    <video
                      className="sv-media"
                      src={playbackFor(p)}
                      poster={posterFor(p) || undefined}
                      controls
                      playsInline
                      preload="metadata"
                      onError={() => setVideoErrorMap((m) => ({ ...m, [viewerIndex]: true }))}
                    />
                  )
                ) : (
                  <img
                    className="sv-media"
                    src={viewerShowOriginalMap[viewerIndex] ? originalFor(p) : thumbFor(p)}
                    alt={p.title || '照片'}
                    draggable={false}
                  />
                )}
              </div>

              <div className={`sv-bar sv-bar-top${svChrome ? '' : ' sv-bar-hidden'}`}>
                <button type="button" className="sv-btn" onClick={closeViewer} aria-label="关闭"><IconClose aria-hidden="true" /></button>
                <span className="sv-counter">{navPos + 1} / {navTotal}{seqPos >= 0 ? ' · 找我结果' : ''}</span>
                {!isVid ? (
                  <button
                    type="button"
                    className="sv-btn sv-btn-text"
                    onClick={() => setViewerShowOriginalMap((m) => ({ ...m, [viewerIndex]: !m[viewerIndex] }))}
                  >
                    {viewerShowOriginalMap[viewerIndex] ? '缩略图' : '原图'}
                  </button>
                ) : <span className="sv-btn sv-btn-ghost" aria-hidden="true" />}
              </div>

              <div className={`sv-bar sv-bar-bottom${svChrome ? '' : ' sv-bar-hidden'}`}>
                <div className="sv-meta">
                  {p.title ? <div className="sv-title">{p.title}</div> : null}
                  {p.description ? <div className="sv-desc">{p.description}</div> : null}
                </div>
                <button type="button" className="sv-btn sv-btn-text" onClick={downloadCurrentViewerPhoto}>
                  <IconDownload aria-hidden="true" />下载
                </button>
              </div>

              <button type="button" className="sv-nav sv-nav-left" onClick={viewerPrev} disabled={navPos <= 0} aria-label="上一张"><IconChevronLeft aria-hidden="true" /></button>
              <button type="button" className="sv-nav sv-nav-right" onClick={viewerNext} disabled={navPos >= navTotal - 1} aria-label="下一张"><IconChevronRight aria-hidden="true" /></button>
            </div>
          );
        })() : null}

        <FindMeModal
          visible={findMeOpen}
          mode="share"
          shareCode={shareCode}
          onClose={() => setFindMeOpen(false)}
          onPickPhoto={handleFindMePick}
        />
      </div>
    </main>
  );
}
