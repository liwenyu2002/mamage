// src/ShareView.jsx
import React from 'react';
import { Typography, Button, Card, ButtonGroup } from '@douyinfe/semi-ui';
import { resolveAssetUrl } from './services/request';
import './ProjectDetail.css';

const { Title, Text } = Typography;

function formatDate(s) {
    try {
        return new Date(s).toLocaleString();
    } catch (e) {
        return String(s || '');
    }
}

export default function ShareView({ share = {}, onBack }) {
    const [viewMode, setViewMode] = React.useState('grid'); // 'grid' or 'masonry'
    const createdBy = share.createdBy || null;
    const creatorName = share.creatorName || share.sharedBy || share.owner || share.creator || share.shareBy || (share.photos && share.photos[0] && share.photos[0].photographerName) || '匿名';
    const createdAt = share.createdAt || share.created || '';
    const expiresAtField = (typeof share.expiresAt !== 'undefined') ? share.expiresAt : null;
    const remainingSecondsField = (typeof share.remainingSeconds === 'number') ? share.remainingSeconds : null;
    const isExpired = (share && (share.error === 'EXPIRED' || (typeof share.message === 'string' && /过期/.test(share.message)) || (remainingSecondsField === 0)));
    const title = share.title || (share.project && (share.project.title || share.project.name)) || '分享内容';

    const photos = Array.isArray(share.photos) ? share.photos : (Array.isArray(share.images) ? share.images : []);

    const galleryRef = React.useRef(null);
    const [colCount, setColCount] = React.useState(0);

    React.useEffect(() => {
        const minColWidth = 300; // px
        function updateCols() {
            try {
                const w = galleryRef.current ? galleryRef.current.clientWidth : window.innerWidth;
                const cols = Math.max(1, Math.floor(w / minColWidth));
                setColCount(cols);
            } catch (e) {
                setColCount(1);
            }
        }
        updateCols();
        if (typeof ResizeObserver !== 'undefined' && galleryRef.current) {
            const ro = new ResizeObserver(() => updateCols());
            ro.observe(galleryRef.current);
            window.addEventListener('resize', updateCols);
            return () => { try { ro.disconnect(); } catch (e) { } window.removeEventListener('resize', updateCols); };
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

    // selection + viewer states
    const [selectMode, setSelectMode] = React.useState(false);
    const [selectedMap, setSelectedMap] = React.useState({}); // idx -> true
    const selectedCount = Object.keys(selectedMap).length;

    const toggleSelect = (idx) => {
        setSelectedMap((prev) => {
            const copy = Object.assign({}, prev);
            if (copy[idx]) delete copy[idx]; else copy[idx] = true;
            return copy;
        });
    };

    const selectAll = () => {
        const all = {};
        photos.forEach((_, i) => { all[i] = true; });
        setSelectedMap(all);
    };

    const clearSelection = () => setSelectedMap({});

    // viewer
    const [viewerVisible, setViewerVisible] = React.useState(false);
    const [viewerIndex, setViewerIndex] = React.useState(0);
    // keep per-photo original view state to avoid global toggling and unnecessary bandwidth
    const [viewerShowOriginalMap, setViewerShowOriginalMap] = React.useState({}); // idx -> bool

    const openViewer = (idx) => { setViewerIndex(idx); setViewerVisible(true); };
    const closeViewer = () => setViewerVisible(false);
    const viewerPrev = () => setViewerIndex((i) => Math.max(0, i - 1));
    const viewerNext = () => setViewerIndex((i) => Math.min(photos.length - 1, i + 1));

    // download selected (simple sequential fetch)
    const downloadSelected = async () => {
        const idxs = Object.keys(selectedMap).map((k) => Number(k)).sort((a, b) => a - b);
        if (!idxs.length) return;
        let failed = 0;
        for (const idx of idxs) {
            const p = photos[idx];
            const url = originalFor(p) || thumbFor(p);
            if (!url) continue;
            try {
                // Try to fetch the resource (will fail on CORS if remote does not allow)
                const resp = await fetch(url, { mode: 'cors' });
                if (resp.ok) {
                    const blob = await resp.blob();
                    const ext = (url.split('.').pop().split('?')[0] || 'jpg').slice(0, 5);
                    const name = `photo_${idx}.${ext}`;
                    const href = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = href;
                    a.download = name;
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                    URL.revokeObjectURL(href);
                    continue;
                }
                // non-ok response -> fallback
                window.open(url, '_blank');
                failed += 1;
            } catch (err) {
                // fetch failed (often CORS) -> open in new tab so user can Save As
                console.warn('downloadSelected fetch failed, falling back to open in new tab', err);
                try { window.open(url, '_blank'); } catch (e) { /* ignore */ }
                failed += 1;
            }
        }
        if (failed > 0) {
            // inform user about partial failures (likely CORS on the storage host)
            try {
                // use native alert to ensure visibility
                alert(`有 ${failed} 张图片无法自动下载（可能被目标服务器禁止跨域）。已在新标签页打开它们，请右键另存为。要实现自动打包下载，请在后端代理或为图片域添加 CORS 允许头。`);
            } catch (e) { }
        }
    };

    // countdown state (prefer explicit remainingSeconds from API, else compute from expiresAt)
    const [remainingSec, setRemainingSec] = React.useState(() => {
        if (typeof remainingSecondsField === 'number') return remainingSecondsField;
        if (expiresAtField) {
            const diff = Math.floor((new Date(expiresAtField).getTime() - Date.now()) / 1000);
            return isNaN(diff) ? null : Math.max(0, diff);
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
        const days = Math.floor(s / 86400); s %= 86400;
        const hrs = Math.floor(s / 3600); s %= 3600;
        const mins = Math.floor(s / 60); const secs = s % 60;
        return `${days ? days + '天 ' : ''}${hrs ? hrs + '小时 ' : ''}${mins ? mins + '分 ' : ''}${secs}秒`;
    };

    return (
        <div style={{ padding: 24 }}>
            <div style={{ width: '100%', margin: 0 }}>
                <Card title={title} bordered style={{ width: '100%' }}>
                    {!isExpired ? (
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                            <div>
                                <div style={{ fontSize: 14, color: '#333' }}><strong>分享者：</strong><span style={{ marginLeft: 8 }}>{creatorName}{createdBy ? ` (id:${createdBy})` : ''}</span></div>
                                <div style={{ fontSize: 12, color: '#666', marginTop: 6 }}><strong>创建时间：</strong><span style={{ marginLeft: 8 }}>{formatDate(createdAt)}</span></div>
                                <div style={{ fontSize: 12, color: '#666', marginTop: 4 }}>
                                    <strong>过期：</strong>
                                    <span style={{ marginLeft: 8 }}>{expiresAtField ? formatDate(expiresAtField) : '永不过期'}</span>
                                    {remainingSec !== null ? <span style={{ marginLeft: 12, color: '#d9363e' }}>(剩余：{fmtRemaining(remainingSec)})</span> : null}
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
                                    <Button onClick={() => setSelectMode(true)} style={{ marginLeft: 8 }}>选择</Button>
                                ) : (
                                    <>
                                        <Button onClick={selectAll} theme="borderless">全选</Button>
                                        <Button onClick={clearSelection} theme="borderless">取消</Button>
                                        <Button onClick={downloadSelected} disabled={selectedCount === 0} type="primary">下载 ({selectedCount})</Button>
                                        <Button onClick={() => { setSelectMode(false); clearSelection(); }} style={{ marginLeft: 8 }}>完成</Button>
                                    </>
                                )}
                            </div>
                            <div />
                        </div>
                    ) : null}

                    {photos && photos.length ? (
                        viewMode === 'grid' ? (
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
                                {photos.map((p, idx) => (
                                    <div key={idx} style={{ position: 'relative' }}>
                                        <div className="detail-photo" style={{ cursor: 'pointer' }} onClick={() => { if (selectMode) toggleSelect(idx); else openViewer(idx); }}>
                                            <img src={thumbFor(p)} alt={p && (p.title || p.description || `photo-${idx}`)} style={{ width: '100%', height: 200, objectFit: 'cover', display: 'block' }} />
                                        </div>
                                        {selectMode ? (
                                            <div style={{ position: 'absolute', left: 8, top: 8 }}>
                                                <input type="checkbox" checked={!!selectedMap[idx]} onChange={(e) => { e.stopPropagation(); toggleSelect(idx); }} />
                                            </div>
                                        ) : null}
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div ref={galleryRef} style={{ columnCount: colCount || undefined, columnGap: 12 }}>
                                {photos.map((p, idx) => (
                                    <div key={idx} style={{ display: 'inline-block', width: '100%', marginBottom: 12, overflow: 'hidden', background: '#f6f6f6', WebkitColumnBreakInside: 'avoid', breakInside: 'avoid', position: 'relative' }}>
                                        <div className="detail-photo" style={{ cursor: 'pointer' }} onClick={() => { if (selectMode) toggleSelect(idx); else openViewer(idx); }}>
                                            <img src={thumbFor(p)} alt={p && (p.title || p.description || `photo-${idx}`)} style={{ width: '100%', display: 'block', height: 'auto' }} />
                                        </div>
                                        {selectMode ? (
                                            <div style={{ position: 'absolute', left: 8, top: 8 }}>
                                                <input type="checkbox" checked={!!selectedMap[idx]} onChange={(e) => { e.stopPropagation(); toggleSelect(idx); }} />
                                            </div>
                                        ) : null}
                                    </div>
                                ))}
                            </div>
                        )
                    ) : (
                        <div style={{ padding: 24 }}>
                            {share && share.message ? (
                                <Text style={{ color: '#d9363e' }}>{share.message}</Text>
                            ) : (
                                <Text>未找到任何照片。</Text>
                            )}
                        </div>
                    )}
                </Card>

                {viewerVisible ? (
                    <div className="viewer-overlay" onClick={closeViewer}>
                        <div className="viewer-wrap">
                            <button className="viewer-nav viewer-nav-left" onClick={(e) => { e.stopPropagation(); viewerPrev(); }} aria-label="prev">‹</button>
                            <div className="viewer-img-wrap" onClick={(e) => e.stopPropagation()}>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center' }}>
                                    <img className="viewer-img" src={(viewerShowOriginalMap[viewerIndex]) ? originalFor(photos[viewerIndex]) : thumbFor(photos[viewerIndex])} alt="preview" />
                                    <div style={{ display: 'flex', justifyContent: 'center', width: '100%' }}>
                                        <Button
                                            onClick={() => setViewerShowOriginalMap((m) => (Object.assign({}, m, { [viewerIndex]: !m[viewerIndex] })))}
                                            style={{
                                                background: 'rgba(0,0,0,0.6)',
                                                color: '#fff',
                                                borderRadius: 4,
                                                padding: '6px 14px'
                                            }}
                                        >
                                            {(viewerShowOriginalMap[viewerIndex]) ? '查看缩略' : '查看原图'}
                                        </Button>
                                    </div>
                                    <button
                                        className="viewer-close-btn"
                                        onClick={(e) => { e.stopPropagation(); closeViewer(); }}
                                        aria-label="关闭查看器"
                                    >
                                        ×
                                    </button>
                                    <div style={{ maxWidth: '80vw', color: '#fff', textAlign: 'center' }}>
                                        <div style={{ fontSize: 14 }}>{photos[viewerIndex] && (photos[viewerIndex].title || '')}</div>
                                        <div style={{ fontSize: 12, color: '#ddd' }}>{photos[viewerIndex] && (photos[viewerIndex].description || '')}</div>
                                    </div>
                                </div>
                            </div>
                            <button className="viewer-nav viewer-nav-right" onClick={(e) => { e.stopPropagation(); viewerNext(); }} aria-label="next">›</button>
                        </div>
                    </div>
                ) : null}
            </div>
        </div>
    );
}
