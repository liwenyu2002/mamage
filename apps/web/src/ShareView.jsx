import React from 'react';
import { Typography, Button, Card, ButtonGroup, Toast } from './ui';
import { pickZipSaveHandle, fetchZipToTarget, formatBytes, formatDuration } from './services/zipDownload';
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

  const [selectMode, setSelectMode] = React.useState(false);
  const [selectedMap, setSelectedMap] = React.useState({});
  const selectedCount = Object.keys(selectedMap).length;
  const shareCode = share.shareCode || share.code || '';

  // 选中的照片真实 id（打包接口按 id 取；selectedMap 的 key 是索引）
  const photoIdOf = (p) => (p && (p.id || p.photoId || p.photo_id)) || null;
  const selectedIdList = Object.keys(selectedMap)
    .map((k) => photoIdOf(photos[Number(k)]))
    .filter(Boolean);

  const [packing, setPacking] = React.useState(false);
  const [packProgress, setPackProgress] = React.useState(null);
  // ids=null → 打包整个分享；否则打包选中的
  const packDownload = React.useCallback(async (ids) => {
    if (packing || !shareCode) return;
    if (Array.isArray(ids) && ids.length === 0) { Toast.warning('请先选择照片'); return; }
    const zipName = `${(share.title || 'share').replace(/[\\/:*?"<>|]/g, '_')}_${Date.now()}`;
    const handle = await pickZipSaveHandle(`${zipName}.zip`); // 必须在用户手势内弹
    if (handle === 'abort') return;
    setPacking(true);
    setPackProgress({ loaded: 0, total: 0 });
    let lastTick = 0;
    try {
      await fetchZipToTarget({
        shareCode,
        photoIds: Array.isArray(ids) && ids.length ? ids : undefined,
        zipName,
        fileHandle: handle || null,
        onProgress: (loaded, total, stats) => {
          const now = Date.now();
          if (now - lastTick < 120) return;
          lastTick = now;
          setPackProgress({ loaded, total, etaSeconds: stats && stats.etaSeconds });
        },
      });
      Toast.success('打包下载完成');
    } catch (e) {
      console.error('share pack download failed', e);
      Toast.error(`打包下载失败: ${e?.message || '请求错误'}`);
    } finally {
      setPacking(false);
      setPackProgress(null);
    }
  }, [packing, shareCode, share.title]);

  const toggleSelect = (idx) => {
    setSelectedMap((prev) => {
      const next = { ...prev };
      if (next[idx]) delete next[idx];
      else next[idx] = true;
      return next;
    });
  };

  const selectAll = () => {
    const all = {};
    photos.forEach((_, i) => { all[i] = true; });
    setSelectedMap(all);
  };
  const clearSelection = () => setSelectedMap({});

  const [viewerVisible, setViewerVisible] = React.useState(false);
  const [viewerIndex, setViewerIndex] = React.useState(0);
  const [viewerShowOriginalMap, setViewerShowOriginalMap] = React.useState({});
  const [videoErrorMap, setVideoErrorMap] = React.useState({});

  const openViewer = (idx) => { setViewerIndex(idx); setViewerVisible(true); };
  const closeViewer = () => setViewerVisible(false);
  const viewerPrev = () => setViewerIndex((i) => Math.max(0, i - 1));
  const viewerNext = () => setViewerIndex((i) => Math.min(photos.length - 1, i + 1));

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

  const downloadSelected = async () => {
    const idxs = Object.keys(selectedMap).map((k) => Number(k)).sort((a, b) => a - b);
    if (!idxs.length) return;

    let failed = 0;
    const inferExt = (rawUrl) => {
      try {
        const u = new URL(String(rawUrl || ''), window.location.origin);
        const m = String(u.pathname || '').match(/\.([a-zA-Z0-9]{2,6})$/);
        return m && m[1] ? `.${String(m[1]).toLowerCase()}` : '.jpg';
      } catch (e) {
        return '.jpg';
      }
    };

    for (let n = 0; n < idxs.length; n += 1) {
      const idx = idxs[n];
      const p = photos[idx];
      const url = originalFor(p) || thumbFor(p);
      if (!url) continue;
      try {
        const a = document.createElement('a');
        a.href = url;
        a.download = `photo_${idx}${inferExt(url)}`;
        a.target = '_blank';
        a.rel = 'noopener';
        document.body.appendChild(a);
        a.click();
        a.remove();
        if (n < idxs.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 80));
        }
      } catch (err) {
        console.warn('downloadSelected failed, fallback to open new tab', err);
        try { window.open(url, '_blank'); } catch (e) { }
        failed += 1;
      }
    }

    if (failed > 0) {
      try {
        alert(`有 ${failed} 张图片无法自动下载。已尝试在新标签页打开，可右键另存为。`);
      } catch (e) { }
    }
  };

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

  const pagePadding = isMobileLayout ? 12 : 24;
  const galleryGap = isMobileLayout ? 8 : 12;
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
          onClick={() => { if (selectMode) toggleSelect(idx); else openViewer(idx); }}
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
        {selectMode ? (
          <div style={{ position: 'absolute', left: 8, top: 8 }}>
            <input type="checkbox" checked={!!selectedMap[idx]} onChange={(e) => { e.stopPropagation(); toggleSelect(idx); }} />
          </div>
        ) : null}
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
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <ButtonGroup>
                  <Button type={viewMode === 'grid' ? 'primary' : 'tertiary'} onClick={() => setViewMode('grid')}>宫格</Button>
                  <Button type={viewMode === 'masonry' ? 'primary' : 'tertiary'} onClick={() => setViewMode('masonry')}>瀑布流</Button>
                </ButtonGroup>
                {!selectMode ? (
                  <>
                    <Button onClick={() => setSelectMode(true)} style={{ marginLeft: 8 }}>选择</Button>
                    {shareCode && photos.length > 0 ? (
                      <Button onClick={() => packDownload(null)} loading={packing} disabled={packing} style={{ marginLeft: 8 }}>
                        {packing ? '打包中…' : `打包下载 (${photos.length})`}
                      </Button>
                    ) : null}
                  </>
                ) : (
                  <>
                    <Button onClick={selectAll} theme="borderless">全选</Button>
                    <Button onClick={clearSelection} theme="borderless">取消</Button>
                    {shareCode ? (
                      <Button onClick={() => packDownload(selectedIdList)} disabled={selectedCount === 0 || packing} loading={packing} type="primary">
                        {packing ? '打包中…' : `打包下载 (${selectedCount})`}
                      </Button>
                    ) : (
                      <Button onClick={downloadSelected} disabled={selectedCount === 0} type="primary">下载 ({selectedCount})</Button>
                    )}
                    <Button onClick={() => { setSelectMode(false); clearSelection(); }} style={{ marginLeft: 8 }}>完成</Button>
                  </>
                )}
              </div>
              {packProgress ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#64748b' }}>
                  <div style={{ position: 'relative', width: 120, height: 6, borderRadius: 999, background: '#e5e7eb', overflow: 'hidden' }}>
                    <style>{'@keyframes mm-share-indet{0%{left:-40%}100%{left:100%}}'}</style>
                    {packProgress.total > 0 ? (
                      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${Math.min(100, (packProgress.loaded / packProgress.total) * 100)}%`, background: 'linear-gradient(90deg,#2f2f2f,#101010)', borderRadius: 999 }} />
                    ) : (
                      <div style={{ position: 'absolute', top: 0, bottom: 0, width: '40%', borderRadius: 999, background: 'linear-gradient(90deg,#2f2f2f,#101010)', animation: 'mm-share-indet 1.1s ease-in-out infinite' }} />
                    )}
                  </div>
                  <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                    已下载 {formatBytes(packProgress.loaded)}
                    {packProgress.total > 0 ? ` / ${formatBytes(packProgress.total)}` : ''}
                    {Number.isFinite(packProgress.etaSeconds) && packProgress.etaSeconds > 0.5 ? ` · 剩余约 ${formatDuration(packProgress.etaSeconds)}` : ''}
                  </span>
                </div>
              ) : <div />}
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

        {viewerVisible ? (
          <div className="viewer-overlay" onClick={closeViewer}>
            <div className="viewer-wrap">
              <button className="viewer-nav viewer-nav-left" onClick={(e) => { e.stopPropagation(); viewerPrev(); }} aria-label="上一张" />
              <div className="viewer-img-wrap" onClick={(e) => e.stopPropagation()}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center' }}>
                  {isVideoPhoto(photos[viewerIndex]) ? (
                    videoErrorMap[viewerIndex] ? (
                      <div style={{ minWidth: 'min(560px, 80vw)', minHeight: 220, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#050816', color: 'rgba(255,255,255,0.8)', fontSize: 14, borderRadius: 8, padding: 24, textAlign: 'center' }}>
                        该视频暂时无法在线播放（可能仍在转码或格式不受浏览器支持），可下载后观看。
                      </div>
                    ) : (
                      <video
                        className="viewer-img"
                        src={playbackFor(photos[viewerIndex])}
                        poster={posterFor(photos[viewerIndex]) || undefined}
                        controls
                        playsInline
                        preload="metadata"
                        style={{ maxWidth: '86vw', maxHeight: '70vh', background: '#050816' }}
                        onError={() => setVideoErrorMap((m) => ({ ...m, [viewerIndex]: true }))}
                      />
                    )
                  ) : (
                    <img className="viewer-img" src={viewerShowOriginalMap[viewerIndex] ? originalFor(photos[viewerIndex]) : thumbFor(photos[viewerIndex])} alt="预览" />
                  )}
                  {!isVideoPhoto(photos[viewerIndex]) ? (
                  <div style={{ display: 'flex', justifyContent: 'center', width: '100%' }}>
                    <Button
                      onClick={() => setViewerShowOriginalMap((m) => ({ ...m, [viewerIndex]: !m[viewerIndex] }))}
                    >
                      {viewerShowOriginalMap[viewerIndex] ? '查看缩略图' : '查看原图'}
                    </Button>
                  </div>
                  ) : null}
                  <button className="viewer-close-btn" onClick={(e) => { e.stopPropagation(); closeViewer(); }} aria-label="关闭查看器">×</button>
                  <div style={{ maxWidth: '80vw', color: '#fff', textAlign: 'center' }}>
                    <div style={{ fontSize: 14 }}>{photos[viewerIndex] && (photos[viewerIndex].title || '')}</div>
                    <div style={{ fontSize: 12, color: '#ddd' }}>{photos[viewerIndex] && (photos[viewerIndex].description || '')}</div>
                  </div>
                </div>
              </div>
              <button className="viewer-nav viewer-nav-right" onClick={(e) => { e.stopPropagation(); viewerNext(); }} aria-label="下一张" />
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
