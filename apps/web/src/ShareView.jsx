import React from 'react';
import { Typography, Button, Card } from './ui';
import FindMeModal from './FindMeModal';
import { resolveAssetUrl } from './services/request';
import './ProjectDetail.css';

const { Text } = Typography;

function formatDate(v) {
  try {
    return new Date(v).toLocaleString();
  } catch (e) {
    return String(v || '');
  }
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
  const [viewMode, setViewMode] = React.useState('grid'); // grid | masonry

  const createdBy = share.createdBy || null;
  const creatorName = share.creatorName
    || share.sharedBy
    || share.owner
    || share.creator
    || share.shareBy
    || (share.photos && share.photos[0] && share.photos[0].photographerName)
    || '匿名';
  const createdAt = share.createdAt || share.created || '';
  const expiresAtField = typeof share.expiresAt !== 'undefined' ? share.expiresAt : null;
  const remainingSecondsField = typeof share.remainingSeconds === 'number' ? share.remainingSeconds : null;
  const isExpired = !!(share && (
    share.error === 'EXPIRED'
    || (typeof share.message === 'string' && /过期/.test(share.message))
    || remainingSecondsField === 0
  ));
  const title = share.title || (share.project && (share.project.title || share.project.name)) || '分享内容';

  const photos = Array.isArray(share.photos) ? share.photos : (Array.isArray(share.images) ? share.images : []);
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

  const galleryRef = React.useRef(null);
  const [colCount, setColCount] = React.useState(() => {
    try {
      if (typeof window === 'undefined') return 2;
      return window.innerWidth <= 768 ? 2 : Math.max(2, Math.floor(window.innerWidth / 260));
    } catch (e) {
      return 2;
    }
  });
  const [isMobileLayout, setIsMobileLayout] = React.useState(() => {
    try {
      return typeof window !== 'undefined' ? window.innerWidth <= 768 : false;
    } catch (e) {
      return false;
    }
  });

  React.useEffect(() => {
    function updateCols() {
      try {
        const w = galleryRef.current ? galleryRef.current.clientWidth : window.innerWidth;
        const viewportWidth = window.innerWidth || w;
        const mobileLayout = viewportWidth <= 768;
        setIsMobileLayout(mobileLayout);
        setColCount(mobileLayout ? 2 : Math.max(2, Math.floor(w / 260)));
      } catch (e) {
        const mobileLayout = typeof window !== 'undefined' ? window.innerWidth <= 768 : false;
        setIsMobileLayout(mobileLayout);
        setColCount(mobileLayout ? 2 : 3);
      }
    }

    updateCols();
    if (typeof ResizeObserver !== 'undefined' && galleryRef.current) {
      const ro = new ResizeObserver(updateCols);
      ro.observe(galleryRef.current);
      window.addEventListener('resize', updateCols);
      return () => {
        try { ro.disconnect(); } catch (e) { }
        window.removeEventListener('resize', updateCols);
      };
    }
    window.addEventListener('resize', updateCols);
    return () => window.removeEventListener('resize', updateCols);
  }, []);

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

  const shareCode = share.shareCode || share.code || '';

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

  const [remainingSec, setRemainingSec] = React.useState(() => {
    if (typeof remainingSecondsField === 'number') return remainingSecondsField;
    if (expiresAtField) {
      const diff = Math.floor((new Date(expiresAtField).getTime() - Date.now()) / 1000);
      return Number.isNaN(diff) ? null : Math.max(0, diff);
    }
    return null;
  });

  React.useEffect(() => {
    if (remainingSec === null) return undefined;
    const t = setInterval(() => setRemainingSec((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearInterval(t);
  }, [remainingSec]);

  const fmtRemaining = (s) => {
    if (s === null || typeof s === 'undefined') return null;
    if (s <= 0) return '已过期';
    const days = Math.floor(s / 86400);
    const r1 = s % 86400;
    const hrs = Math.floor(r1 / 3600);
    const r2 = r1 % 3600;
    const mins = Math.floor(r2 / 60);
    const secs = r2 % 60;
    return `${days ? `${days}天 ` : ''}${hrs ? `${hrs}小时 ` : ''}${mins ? `${mins}分 ` : ''}${secs}秒`;
  };

  // 手机端极限缩边距/缝隙，最大化照片可视面积
  const pagePadding = isMobileLayout ? 3 : 24;
  const galleryGap = isMobileLayout ? 2 : 12;
  const gridColumns = isMobileLayout ? 'repeat(3, minmax(0, 1fr))' : 'repeat(auto-fill, minmax(220px, 1fr))';
  const renderPhotoCard = (p, idx, masonry = false) => {
    const sectionLabel = getSharePhotoSectionLabel(p, timelineSections);
    const isVideo = isVideoPhoto(p);
    const poster = isVideo ? posterFor(p) : null;
    return (
      <div key={idx} style={{ position: 'relative', ...(masonry ? { display: 'inline-block', width: '100%', marginBottom: galleryGap, overflow: 'hidden', background: '#f6f6f6', WebkitColumnBreakInside: 'avoid', breakInside: 'avoid' } : {}) }}>
        <div
          className="detail-photo"
          style={{ cursor: 'pointer', aspectRatio: masonry ? undefined : '1 / 1' }}
          onClick={() => openViewer(idx)}
        >
          {isVideo && !poster ? (
            <div style={{ width: '100%', height: masonry ? 160 : '100%', background: '#111726', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.75)', fontSize: 13, letterSpacing: '0.08em' }}>
              VIDEO
            </div>
          ) : (
            <img
              src={isVideo ? poster : thumbFor(p)}
              alt={p && (p.title || p.description || `photo-${idx}`)}
              style={masonry ? { width: '100%', display: 'block', height: 'auto' } : { width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            />
          )}
          {isVideo ? (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
              <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'rgba(0,0,0,0.55)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, paddingLeft: 4 }}>▶</div>
            </div>
          ) : null}
          {sectionLabel ? <div className="detail-photo-section-chip">{sectionLabel}</div> : null}
        </div>
      </div>
    );
  };

  return (
    <div style={{ padding: pagePadding }}>
      <div style={{ width: '100%', margin: 0 }}>
        {typeof onBack === 'function' ? (
          <div style={{ marginBottom: 10 }}>
            <Button onClick={() => onBack()} aria-label="返回图库">← 返回图库</Button>
          </div>
        ) : null}
        <Card title={title} bordered style={{ width: '100%' }}>
          {!isExpired ? (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div>
                <div style={{ fontSize: 14, color: '#333' }}>
                  <strong>分享者：</strong>
                  <span style={{ marginLeft: 8 }}>{creatorName}{createdBy ? ` (id:${createdBy})` : ''}</span>
                </div>
                <div style={{ fontSize: 12, color: '#666', marginTop: 6 }}>
                  <strong>创建时间：</strong>
                  <span style={{ marginLeft: 8 }}>{formatDate(createdAt)}</span>
                </div>
                <div style={{ fontSize: 12, color: '#666', marginTop: 4 }}>
                  <strong>过期：</strong>
                  <span style={{ marginLeft: 8 }}>{expiresAtField ? formatDate(expiresAtField) : '永不过期'}</span>
                  {remainingSec !== null ? (
                    <span style={{ marginLeft: 12, color: '#d9363e' }}>(剩余：{fmtRemaining(remainingSec)})</span>
                  ) : null}
                </div>
              </div>
              <div />
            </div>
          ) : null}

          {!isExpired ? (
            <div className="share-toolbar">
              <div className="share-actions">
                {/* 视图切换收成一个小图标钮：显示"点了会切到"的布局图标 */}
                <Button
                  className="share-view-toggle"
                  title={viewMode === 'grid' ? '切换为瀑布流' : '切换为宫格'}
                  aria-label={viewMode === 'grid' ? '切换为瀑布流' : '切换为宫格'}
                  onClick={() => setViewMode(viewMode === 'grid' ? 'masonry' : 'grid')}
                >
                  {viewMode === 'grid' ? (
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                      <rect x="1" y="1" width="6" height="9" rx="1" /><rect x="9" y="1" width="6" height="5" rx="1" />
                      <rect x="1" y="12" width="6" height="3" rx="1" /><rect x="9" y="8" width="6" height="7" rx="1" />
                    </svg>
                  ) : (
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                      <rect x="1" y="1" width="6" height="6" rx="1" /><rect x="9" y="1" width="6" height="6" rx="1" />
                      <rect x="1" y="9" width="6" height="6" rx="1" /><rect x="9" y="9" width="6" height="6" rx="1" />
                    </svg>
                  )}
                </Button>
                {shareCode && photos.length > 0 ? (
                  <Button onClick={() => setFindMeOpen(true)}>📸 拍照找我</Button>
                ) : null}
              </div>
            </div>
          ) : null}

          {photos && photos.length ? (
            timelineGroups.length ? (
              <div className="detail-timeline-gallery">
                {timelineGroups.map((group) => (
                  <section className="detail-timeline-section" key={group.key || group.name}>
                    <div className="detail-timeline-head">
                      <div className="detail-timeline-title">
                        <span>{group.name}</span>
                        {group.sectionTime ? <em>{group.sectionTime}</em> : null}
                      </div>
                      <span className="detail-timeline-count">{group.items.length} 张</span>
                    </div>
                    {viewMode === 'grid' ? (
                      <div className="detail-timeline-grid">
                        {group.items.map(({ photo, idx }) => renderPhotoCard(photo, idx))}
                      </div>
                    ) : (
                      <div style={{ columnCount: colCount || undefined, columnGap: galleryGap }}>
                        {group.items.map(({ photo, idx }) => renderPhotoCard(photo, idx, true))}
                      </div>
                    )}
                  </section>
                ))}
              </div>
            ) : viewMode === 'grid' ? (
              <div style={{ display: 'grid', gridTemplateColumns: gridColumns, gap: galleryGap }}>
                {photos.map((p, idx) => renderPhotoCard(p, idx))}
              </div>
            ) : (
              <div ref={galleryRef} style={{ columnCount: colCount || undefined, columnGap: galleryGap }}>
                {photos.map((p, idx) => renderPhotoCard(p, idx, true))}
              </div>
            )
          ) : (
            <div style={{ padding: 24 }}>
              {share && share.message ? <Text style={{ color: '#d9363e' }}>{share.message}</Text> : <Text>未找到任何照片。</Text>}
            </div>
          )}
        </Card>

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
                  // 点视频控件/按钮不拦截；其余区域按横向位置分区：左30%上一张/右30%下一张/中间切换顶底栏
                  if (e.target.tagName === 'VIDEO' || (e.target.closest && e.target.closest('button, a'))) return;
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
                <button type="button" className="sv-btn" onClick={closeViewer} aria-label="关闭">✕</button>
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
                <button type="button" className="sv-btn sv-btn-text" onClick={downloadCurrentViewerPhoto}>⬇ 下载</button>
              </div>

              {/* 桌面侧边翻页箭头（触屏隐藏,用滑动） */}
              <button type="button" className="sv-nav sv-nav-left" onClick={viewerPrev} disabled={navPos <= 0} aria-label="上一张">‹</button>
              <button type="button" className="sv-nav sv-nav-right" onClick={viewerNext} disabled={navPos >= navTotal - 1} aria-label="下一张">›</button>
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
    </div>
  );
}
