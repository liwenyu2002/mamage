import React from 'react';
import ReactDOM from 'react-dom';
import { Toast, Tooltip } from '@douyinfe/semi-ui';
import { getAll, getCount, add, clear, subscribe, removeById } from './services/transferStore';
import { resolveAssetUrl } from './services/request';

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || 'files.zip';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function getFilenameFromContentDisposition(resp) {
  try {
    const cd = resp.headers.get('content-disposition') || '';
    if (!cd) return null;
    const mStar = cd.match(/filename\*=(?:UTF-8'')?([^;\n]+)/i);
    if (mStar && mStar[1]) return decodeURIComponent(mStar[1].trim().replace(/^\"|\"$/g, ''));
    const mQuoted = cd.match(/filename=\"([^\"\n]+)\"/i);
    if (mQuoted && mQuoted[1]) return mQuoted[1];
    const m = cd.match(/filename=([^;\n]+)/i);
    if (m && m[1]) return m[1].trim().replace(/^\"|\"$/g, '');
  } catch (e) {
    // ignore
  }
  return null;
}

export default function TransferStation() {
  const detectMobile = React.useCallback(() => {
    if (typeof window === 'undefined') return false;
    const width = window.innerWidth || 0;
    return width <= 900;
  }, []);

  const [count, setCount] = React.useState(getCount());
  const [items, setItems] = React.useState(getAll());
  const [open, setOpen] = React.useState(false);
  const [expanded, setExpanded] = React.useState(false);
  const [shareOptionsOpen, setShareOptionsOpen] = React.useState(false);
  const [hoverKey, setHoverKey] = React.useState(null);
  const [pressedKey, setPressedKey] = React.useState(null);
  const [dragOver, setDragOver] = React.useState(false);
  const [isDraggingPhoto, setIsDraggingPhoto] = React.useState(false);
  const [panelMounted, setPanelMounted] = React.useState(false);
  const [panelVisible, setPanelVisible] = React.useState(false);
  const [isMobile, setIsMobile] = React.useState(() => detectMobile());
  const [vvInset, setVvInset] = React.useState({ right: 0, bottom: 0 });
  const closeTimerRef = React.useRef(null);
  const stationRef = React.useRef(null);
  const shareExpiryOptions = React.useMemo(() => ([
    { label: '1分钟', s: 60 },
    { label: '1小时', s: 3600 },
    { label: '6小时', s: 3600 * 6 },
    { label: '12小时', s: 3600 * 12 },
    { label: '1天', s: 86400 },
    { label: '7天', s: 86400 * 7 },
    { label: '1个月', s: 86400 * 30 },
    { label: '永久', s: null },
  ]), []);

  React.useEffect(() => {
    const unsub = subscribe((list) => {
      setCount((list || []).length);
      setItems(list || []);
    });
    return unsub;
  }, []);

  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const apply = () => setIsMobile(detectMobile());
    apply();
    window.addEventListener('resize', apply);
    window.addEventListener('orientationchange', apply);
    return () => {
      window.removeEventListener('resize', apply);
      window.removeEventListener('orientationchange', apply);
    };
  }, [detectMobile]);

  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const applyInset = () => {
      try {
        const vv = window.visualViewport;
        if (!vv) {
          setVvInset({ right: 0, bottom: 0 });
          return;
        }
        const rightGap = Math.max(0, Math.round(window.innerWidth - (vv.offsetLeft + vv.width)));
        const bottomGap = Math.max(0, Math.round(window.innerHeight - (vv.offsetTop + vv.height)));
        setVvInset({ right: rightGap, bottom: bottomGap });
      } catch (e) {
        setVvInset({ right: 0, bottom: 0 });
      }
    };

    applyInset();
    window.addEventListener('resize', applyInset);
    window.addEventListener('orientationchange', applyInset);
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', applyInset);
      window.visualViewport.addEventListener('scroll', applyInset);
    }
    return () => {
      window.removeEventListener('resize', applyInset);
      window.removeEventListener('orientationchange', applyInset);
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', applyInset);
        window.visualViewport.removeEventListener('scroll', applyInset);
      }
    };
  }, []);

  React.useEffect(() => {
    if (open) {
      setPanelMounted(true);
      const t = setTimeout(() => setPanelVisible(true), 16);
      return () => clearTimeout(t);
    }
    setPanelVisible(false);
    const t = setTimeout(() => setPanelMounted(false), 320);
    return () => clearTimeout(t);
  }, [open]);

  React.useEffect(() => {
    if (!panelMounted) {
      setPanelVisible(false);
      return;
    }
  }, [panelMounted]);

  const handleStore = React.useCallback(() => {
    const getter = window.__MAMAGE_GET_CURRENT_PROJECT_SELECTION;
    if (typeof getter !== 'function') {
      Toast.warning('当前页面没有可读取的选择，先在相册里勾选照片后再点“存入”。');
      return;
    }
    try {
      const list = getter() || [];
      if (!list.length) {
        Toast.info('当前没有选中任何照片');
        return;
      }
      let added = 0;
      let skipped = 0;
      for (const it of list) {
        const mapped = {
          id: it.id || it.url || null,
          url: it.url || it.fullUrl || it.cosUrl || it.src || it.original || null,
          thumbSrc: it.thumbSrc || it.thumb || it.thumbUrl || it.url || null,
          description: it.description || it.caption || it.alt || it.title || '',
          tags: Array.isArray(it.tags) ? it.tags : (it.tagList || []),
          projectTitle: it.projectTitle || it.source || '',
        };
        const ok = add(mapped);
        if (ok) added += 1;
        else skipped += 1;
      }
      Toast.success(`已存入 ${added} 张，重复或超限 ${skipped} 张`);
    } catch (e) {
      console.error('transfer store add failed', e);
      Toast.error('存入失败');
    }
  }, []);

  const handleClear = React.useCallback(() => {
    clear();
    Toast.info('已清空中转站');
  }, []);

  const handlePackDownload = React.useCallback(async () => {
    const list = getAll();
    if (!list || list.length === 0) {
      Toast.warning('中转站为空');
      return;
    }
    const ids = list.map((p) => p.id).filter(Boolean);
    if (!ids.length) {
      Toast.warning('中转站内没有可下载的照片 ID');
      return;
    }

    const zipName = `transfer_${Date.now()}`;
    try {
      const token = (typeof window !== 'undefined') ? (localStorage.getItem('mamage_jwt_token') || '') : '';
      if (!token) {
        Toast.warning('打包下载需要先登录');
        return;
      }

      const resp = await fetch('/api/photos/zip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        credentials: 'same-origin',
        body: JSON.stringify({ photoIds: ids, zipName }),
      });
      if (!resp.ok) {
        const txt = await resp.text();
        throw new Error(txt || `server responded ${resp.status}`);
      }
      const blob = await resp.blob();
      const serverFilename = getFilenameFromContentDisposition(resp) || `${zipName}.zip`;
      downloadBlob(blob, serverFilename);
      Toast.success('已开始打包下载');
    } catch (e) {
      console.error('transfer pack download failed', e);
      Toast.error(`打包下载失败: ${e?.message || '请求错误'}`);
    }
  }, []);

  const createShareWithExpiry = React.useCallback(async (expiresInSeconds) => {
    const list = getAll();
    if (!list || list.length === 0) {
      Toast.warning('中转站为空');
      return;
    }
    const ids = list.map((p) => p.id).filter(Boolean);
    if (!ids.length) {
      Toast.warning('中转站内没有可分享的照片 ID');
      return;
    }

    try {
      const token = (typeof window !== 'undefined') ? (localStorage.getItem('mamage_jwt_token') || '') : '';
      if (!token) {
        Toast.warning('创建分享需要先登录');
        return;
      }

      const body = {
        shareType: 'collection',
        photoIds: ids,
        expiresInSeconds: (typeof expiresInSeconds === 'number' ? expiresInSeconds : null),
      };
      const resp = await fetch('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        credentials: 'same-origin',
        body: JSON.stringify(body),
      });
      if (!resp.ok) {
        const txt = await resp.text();
        throw new Error(txt || `server responded ${resp.status}`);
      }

      const data = await resp.json().catch(() => ({}));
      let code = data.code || data.shareCode || (data.data && (data.data.code || data.data.shareCode)) || null;
      const rawUrl = data.url || data.shareUrl || data.data?.url || data.data?.shareUrl || null;
      if (!code && rawUrl) {
        try {
          const m = String(rawUrl).match(/(?:\/api\/share|\/share)\/([A-Za-z0-9-_]+)/i);
          if (m && m[1]) code = m[1];
        } catch (e) {
          // ignore
        }
      }

      let shareLink = null;
      const frontendOrigin = (typeof window !== 'undefined') ? String(window.location.origin).replace(/\/+$/, '') : '';
      if (code) {
        shareLink = `${frontendOrigin}/share/${code}`;
      } else if (rawUrl) {
        if (/^https?:\/\//i.test(rawUrl)) {
          const m = String(rawUrl).match(/(?:\/api\/share|\/share)\/([A-Za-z0-9-_]+)/i);
          if (m && m[1]) shareLink = `${frontendOrigin}/share/${m[1]}`;
          else shareLink = rawUrl;
        } else {
          const m2 = String(rawUrl).match(/(?:\/api\/share|\/share)\/([A-Za-z0-9-_]+)/i);
          if (m2 && m2[1]) shareLink = `${frontendOrigin}/share/${m2[1]}`;
          else shareLink = `${frontendOrigin}${rawUrl.startsWith('/') ? rawUrl : '/' + rawUrl}`;
        }
      }

      if (!shareLink) {
        Toast.success('已创建分享（未返回可用链接）');
        return;
      }

      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(shareLink);
          Toast.success('分享链接已复制到剪贴板');
        } else {
          const ta = document.createElement('textarea');
          ta.value = shareLink;
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          ta.remove();
          Toast.success('分享链接已复制到剪贴板');
        }
      } catch (e) {
        Toast.info(`已创建分享：${shareLink}`);
      }
    } catch (e) {
      console.error('create share failed', e);
      Toast.error(`创建分享失败: ${e?.message || '请求错误'}`);
    }
  }, []);

  const getPhotoUrl = React.useCallback((p) => {
    const raw = p?.url || p?.original || p?.fullUrl || p?.src || p?.thumbSrc || '';
    return raw ? resolveAssetUrl(raw) : '';
  }, []);

  const handleCopyRichHtml = React.useCallback(async () => {
    const list = getAll();
    if (!list || list.length === 0) {
      Toast.warning('中转站为空');
      return;
    }
    const urls = list.map((p) => getPhotoUrl(p)).filter(Boolean);
    if (!urls.length) {
      Toast.warning('中转站内没有可用链接');
      return;
    }

    const html = urls.map((u) => `<img src="${u}" />`).join('\n');
    const plain = urls.join('\n');

    try {
      if (navigator.clipboard && navigator.clipboard.write && typeof ClipboardItem !== 'undefined') {
        try {
          const blobHtml = new Blob([html], { type: 'text/html' });
          const blobPlain = new Blob([plain], { type: 'text/plain' });
          const item = new ClipboardItem({ 'text/html': blobHtml, 'text/plain': blobPlain });
          await navigator.clipboard.write([item]);
          Toast.success('已复制图片（富文本+链接）');
          return;
        } catch (e) {
          // Continue to plain-text fallback for clients like WeChat input boxes.
        }
      }

      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(plain);
        Toast.success('已复制图片链接');
        return;
      }

      const ta = document.createElement('textarea');
      ta.value = plain;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      Toast.success('已复制图片链接');
    } catch (e) {
      console.error('copy rich html failed', e);
      Toast.error('复制失败，请在 HTTPS 页面或系统浏览器重试');
    }
  }, [getPhotoUrl]);

  const handleToggleExpand = React.useCallback(() => {
    setExpanded((v) => !v);
  }, []);

  const handleToggleOpen = React.useCallback(() => {
    setOpen((v) => {
      const next = !v;
      if (!next) {
        setExpanded(false);
        setShareOptionsOpen(false);
      }
      return next;
    });
  }, []);

  const handleMouseEnter = React.useCallback(() => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const handleMouseLeave = React.useCallback(() => {
    // Use click-outside to close; avoid hover-leave closing which breaks precise operations.
  }, []);

  const handleRemove = React.useCallback((photo) => {
    try {
      const key = photo.id || photo.url;
      if (!key) return;
      removeById(key);
      Toast.success('已从中转站删除');
    } catch (e) {
      console.error('remove from transfer failed', e);
      Toast.error('删除失败');
    }
  }, []);

  const handleDragOver = React.useCallback((e) => {
    try {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      setDragOver(true);
      setIsDraggingPhoto(true);
      setOpen(true);
    } catch (e2) {
      // ignore
    }
  }, []);

  const handleDragLeave = React.useCallback((e) => {
    try {
      const rt = e.relatedTarget;
      if (!rt || !e.currentTarget.contains(rt)) {
        setDragOver(false);
      }
    } catch (e2) {
      setDragOver(false);
    }
  }, []);

  const handleDrop = React.useCallback((e) => {
    e.preventDefault();
    setDragOver(false);
    setIsDraggingPhoto(false);

    let payload = null;
    try {
      const raw = e.dataTransfer.getData('application/x-mamage-photo') || e.dataTransfer.getData('application/json') || '';
      if (raw) payload = JSON.parse(raw);
    } catch (err) {
      payload = null;
    }

    if (!payload) {
      Toast.warning('未识别到可存入中转站的照片');
      return;
    }

    const ok = add(payload);
    if (ok) Toast.success('已拖入中转站');
    else Toast.warning('中转站已满或该照片已存在');
  }, []);

  React.useEffect(() => {
    const onDragStartEvt = () => {
      setIsDraggingPhoto(true);
      setOpen(true);
    };
    const onDragEndEvt = () => {
      setIsDraggingPhoto(false);
      setDragOver(false);
    };

    window.addEventListener('mamage-photo-drag-start', onDragStartEvt);
    window.addEventListener('mamage-photo-drag-end', onDragEndEvt);
    window.addEventListener('drop', onDragEndEvt);
    window.addEventListener('dragend', onDragEndEvt);

    return () => {
      window.removeEventListener('mamage-photo-drag-start', onDragStartEvt);
      window.removeEventListener('mamage-photo-drag-end', onDragEndEvt);
      window.removeEventListener('drop', onDragEndEvt);
      window.removeEventListener('dragend', onDragEndEvt);
    };
  }, []);

  React.useEffect(() => {
    if (!open) return undefined;
    const onDocClick = (e) => {
      try {
        const inside = e.target && typeof e.target.closest === 'function'
          ? e.target.closest('[data-transfer-station-root=\"1\"]')
          : null;
        if (inside) return;
        setOpen(false);
        setExpanded(false);
        setShareOptionsOpen(false);
      } catch (err) {
        // ignore
      }
    };
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, [open]);

  const getInteractiveTransform = React.useCallback((key) => {
    const isPressed = pressedKey === key;
    const isHovered = hoverKey === key;
    return isPressed ? 'scale(0.98)' : (isHovered ? 'translateY(-1px)' : 'none');
  }, [hoverKey, pressedKey]);

  const bindCircleEvents = React.useCallback((key) => ({
    onMouseEnter: () => setHoverKey(key),
    onMouseLeave: () => {
      setHoverKey((v) => (v === key ? null : v));
      setPressedKey((v) => (v === key ? null : v));
    },
    onPointerDown: () => setPressedKey(key),
    onPointerUp: () => setPressedKey((v) => (v === key ? null : v)),
    onPointerCancel: () => setPressedKey((v) => (v === key ? null : v)),
  }), []);

  const containerStyle = isMobile ? {
    position: 'fixed',
    right: 12,
    bottom: 'max(12px, env(safe-area-inset-bottom))',
    zIndex: 2100,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end',
    padding: 0,
    borderRadius: 18,
    transition: 'transform 180ms ease, background 180ms ease, box-shadow 180ms ease',
    transform: `scale(${dragOver ? 1.08 : (isDraggingPhoto ? 1.04 : 1)})`,
    background: 'transparent',
    boxShadow: 'none',
  } : {
    position: 'fixed',
    right: 16,
    top: '50%',
    zIndex: 2000,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: isDraggingPhoto ? 10 : 0,
    borderRadius: 18,
    transition: 'transform 180ms ease, background 180ms ease, box-shadow 180ms ease, padding 180ms ease',
    transform: `translateY(-50%) scale(${dragOver ? 1.12 : (isDraggingPhoto ? 1.07 : 1)})`,
    background: isDraggingPhoto ? 'rgba(44, 123, 229, 0.14)' : 'transparent',
    boxShadow: isDraggingPhoto ? '0 10px 26px rgba(44,123,229,0.25)' : 'none',
  };

  const triggerStyle = isMobile ? {
    width: 58,
    height: 58,
    borderRadius: 999,
    border: dragOver ? '1px solid #4c9eff' : '1px solid rgba(15,23,42,0.08)',
    background: dragOver ? '#e8f3ff' : '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 0,
    cursor: 'pointer',
    userSelect: 'none',
    transition: 'transform 140ms ease, box-shadow 140ms ease, background 140ms ease',
    willChange: 'transform',
    transform: getInteractiveTransform('trigger'),
    boxShadow: open ? '0 10px 22px rgba(37,99,235,0.28)' : '0 8px 20px rgba(15,23,42,0.2)',
    position: 'relative',
  } : {
    width: isDraggingPhoto ? 132 : 116,
    height: isDraggingPhoto ? 64 : 56,
    borderRadius: 14,
    border: dragOver ? '1px solid #4c9eff' : '1px solid rgba(15,23,42,0.12)',
    background: dragOver ? '#e8f3ff' : '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: '0 10px',
    cursor: 'pointer',
    userSelect: 'none',
    transition: 'transform 140ms ease, box-shadow 140ms ease, background 140ms ease',
    willChange: 'transform',
    transform: getInteractiveTransform('trigger'),
    boxShadow: dragOver ? '0 8px 20px rgba(76,158,255,0.35)' : '0 6px 16px rgba(15,23,42,0.14)',
  };

  const actionButtonStyle = (key, extra = {}) => ({
    width: '100%',
    height: isMobile ? 40 : 36,
    borderRadius: 10,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 1px 3px rgba(15,23,42,0.08)',
    background: hoverKey === key ? '#e9f2ff' : '#f8fafc',
    color: '#0f172a',
    fontSize: isMobile ? 12 : 13,
    fontWeight: 600,
    userSelect: 'none',
    cursor: 'pointer',
    transition: 'transform 120ms ease, box-shadow 120ms ease, background 120ms ease',
    transform: getInteractiveTransform(key),
    whiteSpace: 'nowrap',
    ...extra,
  });

  const actionPanelStyle = isMobile ? {
    position: 'fixed',
    left: 12,
    right: 12,
    bottom: 'calc(max(12px, env(safe-area-inset-bottom)) + 70px)',
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    alignItems: 'stretch',
    padding: 12,
    borderRadius: 16,
    background: 'rgba(255,255,255,0.98)',
    border: '1px solid rgba(16,24,40,0.08)',
    boxShadow: '0 18px 36px rgba(15,23,42,0.2)',
    backdropFilter: 'blur(8px)',
    overflow: 'visible',
    opacity: panelVisible ? 1 : 0,
    pointerEvents: panelVisible ? 'auto' : 'none',
    transformOrigin: 'bottom center',
    transform: panelVisible ? 'translateY(0) scale(1)' : 'translateY(18px) scale(0.98)',
    transition: 'opacity 220ms ease, transform 300ms cubic-bezier(0.2, 0.9, 0.2, 1)',
    zIndex: 2200,
    maxHeight: 'min(74vh, 620px)',
  } : {
    position: 'absolute',
    right: 0,
    top: isDraggingPhoto ? 124 : 110,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    alignItems: 'stretch',
    width: 120,
    padding: 10,
    borderRadius: 14,
    background: 'rgba(255,255,255,0.96)',
    border: '1px solid rgba(16,24,40,0.08)',
    boxShadow: '0 12px 28px rgba(15,23,42,0.16)',
    backdropFilter: 'blur(6px)',
    overflow: 'visible',
    opacity: panelVisible ? 1 : 0,
    pointerEvents: panelVisible ? 'auto' : 'none',
    transformOrigin: 'top center',
    transform: panelVisible ? 'translateY(0) scaleY(1)' : 'translateY(-6px) scaleY(0.72)',
    transition: 'opacity 240ms ease, transform 300ms cubic-bezier(0.22, 1, 0.36, 1)',
  };

  const triggerNode = (
    <div
      style={triggerStyle}
      onClick={handleToggleOpen}
      {...bindCircleEvents('trigger')}
      title="中转站"
      aria-expanded={open}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleToggleOpen();
        }
      }}
    >
      {!isMobile && <span style={{ fontSize: 13, fontWeight: 700, color: '#0f172a', whiteSpace: 'nowrap', marginLeft: 6 }}>中转站</span>}
      <span
        style={isMobile
          ? { position: 'absolute', right: -3, top: -3, minWidth: 22, height: 22, borderRadius: 11, background: '#2563eb', color: '#fff', fontSize: 11, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '0 6px', border: '2px solid #fff' }
          : { marginLeft: 'auto', minWidth: 24, height: 24, borderRadius: 12, background: '#2563eb', color: '#fff', fontSize: 12, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '0 6px' }}
      >
        {count}
      </span>
    </div>
  );

  const previewPanelNode = (
    <div
      style={{
        ...(isMobile
          ? {
            width: '100%',
            maxHeight: 250,
            height: 250,
            overflowY: 'auto',
            overflowX: 'hidden',
            padding: 8,
            borderRadius: 12,
            border: '1px solid rgba(15,23,42,0.08)',
            background: '#fff',
            boxShadow: '0 6px 16px rgba(15,23,42,0.08)',
          }
          : {
            position: 'absolute',
            right: 132,
            top: 0,
            width: 300,
            maxHeight: 360,
            background: 'rgba(255,255,255,0.98)',
            boxShadow: '0 14px 32px rgba(15,23,42,0.18)',
            borderRadius: 12,
            border: '1px solid rgba(15,23,42,0.08)',
            padding: 10,
            overflowY: 'auto',
            overflowX: 'hidden',
            zIndex: 2500,
          }),
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
      onMouseEnter={handleMouseEnter}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 6px' }}>
        <div style={{ fontSize: 13, color: '#0f172a', fontWeight: 700 }}>已存入 ({count})</div>
        <div style={{ fontSize: 12, color: '#64748b', cursor: 'pointer' }} onClick={() => setExpanded(false)}>关闭</div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {items && items.length ? items.map((p, idx) => (
          <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 8px', borderRadius: 10, background: '#f8fafc', border: '1px solid #eef2f7' }}>
            <div style={{ width: 72, height: 72, overflow: 'hidden', borderRadius: 8, flex: '0 0 72px', background: '#f1f5f9' }}>
              <img src={p.thumbSrc || p.url} alt={`thumb-${idx}`} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
            </div>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
              <div style={{ fontSize: 12, color: '#1e293b' }}>
                {p.projectTitle ? (
                  <>
                    来自
                    <span style={{ fontWeight: 700, color: '#2563eb', display: 'inline', whiteSpace: 'normal', wordBreak: 'break-word', margin: '0 4px' }}>
                      {p.projectTitle.length > 12 ? (p.projectTitle.slice(0, 12) + '...') : p.projectTitle}
                    </span>
                    的照片
                  </>
                ) : (p.id || p.url || '未命名')}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <div style={{ fontSize: 12, color: '#2563eb', cursor: 'pointer', fontWeight: 600 }} onClick={() => handleRemove(p)}>删除</div>
              </div>
            </div>
          </div>
        )) : (
          <div style={{ padding: 16, color: '#64748b', textAlign: 'center' }}>中转站为空</div>
        )}
      </div>
    </div>
  );

  if (isMobile) {
    const mobileRight = 12 + vvInset.right;
    const mobileBottom = 12 + vvInset.bottom;
    const mobilePanelBottom = mobileBottom + 168;
    const mobileActions = [
      { key: 'store', label: '存入', onClick: () => { handleStore(); setOpen(false); } },
      { key: 'preview', label: expanded ? '收起' : '预览', onClick: () => { setExpanded((v) => !v); setShareOptionsOpen(false); } },
      { key: 'pack', label: '打包', onClick: () => { handlePackDownload(); setOpen(false); } },
      { key: 'share', label: '分享', onClick: () => { setShareOptionsOpen((v) => !v); setExpanded(false); } },
      { key: 'copy', label: '复制', onClick: () => { handleCopyRichHtml(); setOpen(false); } },
      { key: 'clear', label: '清空', onClick: () => { handleClear(); setOpen(false); } },
    ];
    const fanAngles = [-178, -160, -142, -124, -106, -88];
    const fanRadius = 104;
    const shareFanAngles = [-178, -166, -154, -142, -130, -118, -106, -94];
    const shareFanRadius = 156;
    const fabSize = 60;

    const mobileNode = (
      <>
        {open && (
          <div
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(2,6,23,0.16)',
              backdropFilter: 'blur(1px)',
              zIndex: 2080,
            }}
            onClick={() => {
              setOpen(false);
              setExpanded(false);
              setShareOptionsOpen(false);
            }}
          />
        )}

        {expanded && (
          <div
            data-transfer-station-root="1"
            style={{
              position: 'fixed',
              right: mobileRight,
              bottom: mobilePanelBottom,
              width: 'min(92vw, 360px)',
              maxHeight: '58vh',
              overflowY: 'auto',
              zIndex: 2110,
              borderRadius: 14,
              border: '1px solid rgba(15,23,42,0.1)',
              background: 'rgba(255,255,255,0.98)',
              boxShadow: '0 18px 32px rgba(15,23,42,0.24)',
              padding: 10,
            }}
          >
            {previewPanelNode}
          </div>
        )}

        <div
          ref={stationRef}
          data-transfer-station-root="1"
          style={{
            position: 'fixed',
            right: mobileRight,
            bottom: mobileBottom,
            zIndex: 2140,
            width: fabSize,
            height: fabSize,
            transform: 'translate3d(0,0,0)',
          }}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <div style={{ position: 'relative', width: '100%', height: '100%' }}>
            {mobileActions.map((a, idx) => {
              const rad = fanAngles[idx] * Math.PI / 180;
              const dx = Math.cos(rad) * fanRadius;
              const dy = Math.sin(rad) * fanRadius;
              const shown = open;
              return (
                <button
                  key={a.key}
                  title={a.key === 'preview' ? '预览列表' : a.key === 'share' ? '分享' : undefined}
                  onClick={a.onClick}
                  style={{
                    position: 'absolute',
                    right: 6,
                    bottom: 6,
                    width: 42,
                    height: 42,
                    border: 'none',
                    borderRadius: 999,
                    background: a.key === 'clear' ? '#fff1f2' : '#ffffff',
                    color: a.key === 'clear' ? '#b91c1c' : '#0f172a',
                    boxShadow: '0 8px 16px rgba(15,23,42,0.22)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexDirection: 'column',
                    fontSize: 10,
                    fontWeight: 700,
                    cursor: 'pointer',
                    transform: shown ? `translate(${dx}px, ${dy}px) scale(1)` : 'translate(0,0) scale(0.7)',
                    opacity: shown ? 1 : 0,
                    pointerEvents: shown ? 'auto' : 'none',
                    transition: `transform 280ms cubic-bezier(0.2, 1, 0.2, 1), opacity 180ms ease`,
                    transitionDelay: shown ? `${idx * 18}ms` : '0ms',
                  }}
                >
                  <span style={{ lineHeight: 1 }}>{a.label}</span>
                </button>
              );
            })}

            {shareExpiryOptions.map((opt, idx) => {
              const rad = shareFanAngles[idx] * Math.PI / 180;
              const dx = Math.cos(rad) * shareFanRadius;
              const dy = Math.sin(rad) * shareFanRadius;
              const shown = open && shareOptionsOpen;
              return (
                <button
                  key={`share-${opt.label}`}
                  title={`分享有效期：${opt.label}`}
                  onClick={() => { setShareOptionsOpen(false); setOpen(false); createShareWithExpiry(opt.s); }}
                  style={{
                    position: 'absolute',
                    right: 6,
                    bottom: 6,
                    width: 46,
                    height: 46,
                    border: '1px solid rgba(37,99,235,0.2)',
                    borderRadius: 999,
                    background: '#eff6ff',
                    color: '#1d4ed8',
                    boxShadow: '0 8px 16px rgba(15,23,42,0.2)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 11,
                    fontWeight: 700,
                    cursor: 'pointer',
                    transform: shown ? `translate(${dx}px, ${dy}px) scale(1)` : 'translate(0,0) scale(0.72)',
                    opacity: shown ? 1 : 0,
                    pointerEvents: shown ? 'auto' : 'none',
                    transition: 'transform 260ms cubic-bezier(0.2, 1, 0.2, 1), opacity 180ms ease',
                    transitionDelay: shown ? `${idx * 16}ms` : '0ms',
                  }}
                >
                  {opt.label}
                </button>
              );
            })}

            <button
              onClick={handleToggleOpen}
              style={{
                position: 'absolute',
                right: 0,
                bottom: 0,
                width: fabSize,
                height: fabSize,
                borderRadius: 999,
                border: dragOver ? '1px solid #4c9eff' : '1px solid rgba(15,23,42,0.08)',
                background: '#fff',
                boxShadow: open ? '0 12px 24px rgba(37,99,235,0.3)' : '0 8px 20px rgba(15,23,42,0.24)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 22,
                cursor: 'pointer',
                transform: open ? 'rotate(45deg)' : 'rotate(0deg)',
                transition: 'transform 220ms ease, box-shadow 220ms ease',
              }}
              aria-expanded={open}
              aria-label="中转站菜单"
            >
              {open ? '+' : '📁'}
            </button>

            <span
              style={{
                position: 'absolute',
                right: -2,
                top: -2,
                minWidth: 22,
                height: 22,
                borderRadius: 11,
                background: '#2563eb',
                color: '#fff',
                fontSize: 11,
                fontWeight: 700,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '0 6px',
                border: '2px solid #fff',
              }}
            >
              {count}
            </span>
          </div>
        </div>
      </>
    );
    if (typeof document !== 'undefined' && document.body) {
      return ReactDOM.createPortal(mobileNode, document.body);
    }
    return mobileNode;
  }

  return (
    <div
      ref={stationRef}
      data-transfer-station-root="1"
      style={containerStyle}
      aria-label="transfer-station"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <a
        href="https://aqzp8yijm6s.feishu.cn/share/base/form/shrcnwu5HlSiXlpt6JiqumTVKec"
        target="_blank"
        rel="noopener noreferrer"
        style={{ textDecoration: 'none', marginBottom: 8 }}
      >
        <div style={{ padding: '6px 10px', borderRadius: 8, background: '#1d4ed8', color: '#fff', fontSize: 12, cursor: 'pointer', boxShadow: '0 2px 10px rgba(29,78,216,0.35)' }}>反馈问题</div>
      </a>

      <Tooltip
        content={'中转站：支持“存入选中”或“直接拖拽照片”。可打包下载、复制富文本、分享外链。'}
        position="left"
      >
        {triggerNode}
      </Tooltip>

      {panelMounted && (
        <div style={actionPanelStyle} onMouseEnter={handleMouseEnter}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={actionButtonStyle('store')} title="存入当前选择" onClick={handleStore} {...bindCircleEvents('store')}>存入</div>
            <div style={actionButtonStyle('expand')} title="展开中转预览" onClick={handleToggleExpand} {...bindCircleEvents('expand')}>
              {expanded ? '收起' : '预览'}
            </div>
            <div style={actionButtonStyle('pack')} title="打包下载" onClick={handlePackDownload} {...bindCircleEvents('pack')}>打包</div>
            <div style={actionButtonStyle('share')} title="分享中转站" onClick={() => setShareOptionsOpen((v) => !v)} {...bindCircleEvents('share')}>分享</div>
            <div style={actionButtonStyle('copy')} title="复制为富文本 (HTML)" onClick={handleCopyRichHtml} {...bindCircleEvents('copy')}>复制</div>
            <div style={actionButtonStyle('clear', { background: '#fff1f2', color: '#b91c1c' })} title="清空中转站" onClick={handleClear} {...bindCircleEvents('clear')}>清空</div>
          </div>

          {shareOptionsOpen && (
            <div
              style={{ position: 'absolute', top: 0, left: -242, width: 210, background: '#fff', boxShadow: '0 8px 20px rgba(0,0,0,0.14)', borderRadius: 10, padding: 8, zIndex: 2600, border: '1px solid rgba(15,23,42,0.08)' }}
              onMouseEnter={() => setShareOptionsOpen(true)}
              onMouseLeave={() => setShareOptionsOpen(false)}
            >
              <div style={{ fontSize: 13, marginBottom: 8, color: '#334155', fontWeight: 700 }}>分享过期时间</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {shareExpiryOptions.map((opt) => (
                  <button
                    key={opt.label}
                    onClick={() => { setShareOptionsOpen(false); createShareWithExpiry(opt.s); }}
                    style={{ textAlign: 'left', padding: '8px 10px', borderRadius: 8, border: '1px solid #e2e8f0', background: '#f8fafc', cursor: 'pointer', color: '#334155', fontWeight: 600 }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {expanded && previewPanelNode}
        </div>
      )}
    </div>
  );
}

