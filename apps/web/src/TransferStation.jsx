import React from 'react';
import { Button, Toast, Tooltip } from '@douyinfe/semi-ui';
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
  const [count, setCount] = React.useState(getCount());
  const [items, setItems] = React.useState(getAll());
  const [expanded, setExpanded] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const [hoverKey, setHoverKey] = React.useState(null);
  const [pressedKey, setPressedKey] = React.useState(null);
  const closeTimerRef = React.useRef(null);

  const TRIGGER_HEIGHT = 56;

  React.useEffect(() => {
    const unsub = subscribe((list) => {
      setCount((list || []).length);
      setItems(list || []);
    });
    return unsub;
  }, []);

  React.useEffect(() => {
    return () => {
      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
    };
  }, []);

  const handleStore = React.useCallback(() => {
    const getter = window.__MAMAGE_GET_CURRENT_PROJECT_SELECTION;
    if (typeof getter !== 'function') {
      Toast.warning('当前页面未暴露选中数据，先在项目页选择后再点击 “存入”。');
      return;
    }
      try {
      const items = getter() || [];
      if (!items.length) return Toast.info('当前未选中任何照片');
      // normalize items before adding to transfer store to ensure description/tags/url exist
      let added = 0; let skipped = 0;
      for (const it of items) {
        const mapped = {
          id: it.id || it.url || null,
          url: it.url || it.fullUrl || it.cosUrl || it.src || it.original || null,
          thumbSrc: it.thumbSrc || it.thumb || it.thumbUrl || it.url || null,
          description: it.description || it.caption || it.alt || it.title || '',
          tags: Array.isArray(it.tags) ? it.tags : (it.tagList || []),
          projectTitle: it.projectTitle || it.source || ''
        };
        const ok = add(mapped);
        if (ok) added++; else skipped++;
      }
      Toast.success(`已存入 ${added} 张，已存在/超限 ${skipped} 张`);
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
    if (!list || list.length === 0) return Toast.warning('中转站为空');
    const ids = list.map((p) => p.id).filter(Boolean);
    if (!ids.length) return Toast.warning('中转站内项目无可下载 ID');
    const zipName = `transfer_${Date.now()}`;
    try {
      const token = (typeof window !== 'undefined') ? (localStorage.getItem('mamage_jwt_token') || '') : '';
      if (!token) {
        Toast.warning('当前未登录，打包下载需要登录后操作');
        return;
      }

      const resp = await fetch('/api/photos/zip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
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
      Toast.success('打包下载开始');
    } catch (e) {
      console.error('transfer pack download failed', e);
      Toast.error('打包下载失败: ' + (e?.message || '请求错误'));
    }
  }, []);

  const getPhotoUrl = React.useCallback((p) => {
    const raw = p?.url || p?.original || p?.fullUrl || p?.src || p?.thumbSrc || '';
    return raw ? resolveAssetUrl(raw) : '';
  }, []);

  const handleCopyRichHtml = React.useCallback(async () => {
    const list = getAll();
    if (!list || list.length === 0) return Toast.warning('中转站为空');
    const urls = list.map((p) => getPhotoUrl(p)).filter(Boolean);
    if (!urls.length) return Toast.warning('中转站内无可用链接');

    const html = urls.map((u) => `<img src="${u}" />`).join('\n');
    const plain = urls.join('\n');

    try {
      // 优先写入富文本类型 text/html（现代浏览器，需 https 或 localhost）
      if (navigator.clipboard && navigator.clipboard.write && typeof ClipboardItem !== 'undefined') {
        const blobHtml = new Blob([html], { type: 'text/html' });
        const blobPlain = new Blob([plain], { type: 'text/plain' });
        const item = new ClipboardItem({ 'text/html': blobHtml, 'text/plain': blobPlain });
        await navigator.clipboard.write([item]);
        Toast.success('已复制富文本（HTML）到剪贴板');
        return;
      }

      // 回退：只复制文本（HTML 字符串）
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(html);
        Toast.success('已复制富文本（HTML）到剪贴板');
        return;
      }

      // 最后回退到 textarea 复制
      const ta = document.createElement('textarea');
      ta.value = html;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      Toast.success('已复制富文本（HTML）到剪贴板');
    } catch (e) {
      console.error('copy rich html failed', e);
      Toast.error('复制失败');
    }
  }, [getPhotoUrl]);

  const handleToggleExpand = React.useCallback(() => {
    setExpanded((v) => !v);
  }, []);

  const handleToggleOpen = React.useCallback(() => {
    setOpen((v) => {
      const nv = !v;
      if (!nv) setExpanded(false); // close preview when collapsing
      return nv;
    });
  }, []);

  const handleMouseEnter = React.useCallback(() => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    setOpen(true);
  }, []);

  const handleMouseLeave = React.useCallback(() => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    // Delay closing slightly so the mouse can cross small gaps.
    closeTimerRef.current = setTimeout(() => {
      setOpen(false);
      setExpanded(false);
      closeTimerRef.current = null;
    }, 220);
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

  const containerStyle = {
    position: 'fixed',
    right: 18,
    top: '40%',
    transform: 'translateY(-50%)',
    zIndex: 2000,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center'
  };

  const anchorStyle = {
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 10,
  };

  const triggerWrapStyle = {
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
  };

  const panelStyle = {
    position: 'absolute',
    top: TRIGGER_HEIGHT + 8, // below the trigger button (small gap)
    left: '50%',
    transform: 'translateX(-50%)',
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    alignItems: 'center',
  };

  const circleStyle = {
    width: 56,
    height: 56,
    borderRadius: 28,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
    background: '#fff',
    cursor: 'pointer',
    fontSize: 12,
    userSelect: 'none',
    transition: 'transform 120ms ease, box-shadow 120ms ease',
    willChange: 'transform'
  };

  const getInteractiveTransform = React.useCallback((key) => {
    const isPressed = pressedKey === key;
    const isHovered = hoverKey === key;
    return isPressed ? 'scale(0.96)' : (isHovered ? 'translateY(-1px)' : 'none');
  }, [hoverKey, pressedKey]);

  const getCircleInteractiveStyle = React.useCallback((key, extra) => {
    return {
      ...circleStyle,
      ...(extra || {}),
      transform: getInteractiveTransform(key),
    };
  }, [circleStyle, getInteractiveTransform]);

  const folderTriggerStyle = React.useCallback((key) => ({
    width: 88,
    height: TRIGGER_HEIGHT,
    position: 'relative',
    cursor: 'pointer',
    userSelect: 'none',
    transition: 'transform 120ms ease',
    willChange: 'transform',
    transform: getInteractiveTransform(key),
    filter: 'drop-shadow(0 2px 8px rgba(0,0,0,0.12))',
  }), [TRIGGER_HEIGHT, getInteractiveTransform]);

  const folderTabStyle = {
    position: 'absolute',
    left: 12,
    top: 8,
    width: 34,
    height: 14,
    borderTopLeftRadius: 10,
    borderTopRightRadius: 10,
    borderBottomLeftRadius: 6,
    borderBottomRightRadius: 6,
    background: '#fff',
  };

  const folderBodyStyle = {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 16,
    bottom: 0,
    borderRadius: 14,
    background: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  };

  const folderLabelStyle = {
    fontSize: 12,
    padding: 6,
    lineHeight: 1.1,
    whiteSpace: 'nowrap',
  };

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

  return (
    <div
      style={containerStyle}
      aria-label="transfer-station"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <div style={anchorStyle}>
        <a href="https://aqzp8yijm6s.feishu.cn/share/base/form/shrcnwu5HlSiXlpt6JiqumTVKec" target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none' }}>
          <div style={{ padding: '6px 10px', borderRadius: 6, background: '#0070cc', color: '#fff', fontSize: 12, cursor: 'pointer', boxShadow: '0 2px 6px rgba(0,0,0,0.12)' }}>点击跳转反馈问题</div>
        </a>
        <div style={triggerWrapStyle} onMouseEnter={handleMouseEnter}>
          <Tooltip
            content={
              '中转站用法：在任意相册中点击相册中右上角的选择，勾选特定照片后点击中转站-存入，可在功能区导入中转站中照片或者直接下载'
            }
            position="left"
          >
            <div
              style={folderTriggerStyle('trigger')}
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
              <div style={folderTabStyle} />
              <div style={folderBodyStyle}>
                <div style={folderLabelStyle}>中转站{Number(count) > 0 ? ` (${count})` : ''}</div>
              </div>
            </div>
          </Tooltip>

          {open && (
            <div style={panelStyle} onMouseEnter={handleMouseEnter}>
            <div style={getCircleInteractiveStyle('store')} title="存入当前选中" onClick={handleStore} {...bindCircleEvents('store')}>存入</div>
            <div style={getCircleInteractiveStyle('expand')} title="展开中转预览" onClick={handleToggleExpand} {...bindCircleEvents('expand')}>{expanded ? '收起' : '展开'}</div>
            <div style={getCircleInteractiveStyle('pack')} title="打包下载" onClick={handlePackDownload} {...bindCircleEvents('pack')}>打包</div>
            <div style={getCircleInteractiveStyle('copy')} title="复制为富文本（HTML）" onClick={handleCopyRichHtml} {...bindCircleEvents('copy')}>复制</div>
            <div style={getCircleInteractiveStyle('clear')} title="清空中转站" onClick={handleClear} {...bindCircleEvents('clear')}>清空</div>

            {expanded && (
              <div
                style={{
                  position: 'absolute',
                  right: 72,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  width: 240,
                  maxHeight: 320,
                  background: '#fff',
                  boxShadow: '0 6px 20px rgba(0,0,0,0.12)',
                  borderRadius: 8,
                  padding: 8,
                  overflowY: 'auto',
                  overflowX: 'hidden',
                  zIndex: 2500,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                }}
                onMouseEnter={handleMouseEnter}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 6px' }}>
                  <div style={{ fontSize: 13, color: '#333' }}>已存入 ({count})</div>
                  <div style={{ fontSize: 12, color: '#666', cursor: 'pointer' }} onClick={() => setExpanded(false)}>关闭</div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {items && items.length ? items.map((p, idx) => (
                    <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 6px', borderRadius: 6 }}>
                      <div style={{ width: 72, height: 72, overflow: 'hidden', borderRadius: 4, flex: '0 0 72px', background: '#f6f6f6' }}>
                        <img src={p.thumbSrc || p.url} alt={`thumb-${idx}`} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                      </div>
                      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
                        <div style={{ fontSize: 12, color: '#222' }}>
                          {p.projectTitle ? (
                            <>
                              从
                              <span style={{ fontWeight: 700, color: '#0070cc', display: 'inline', whiteSpace: 'normal', wordBreak: 'break-word' }}>
                                {p.projectTitle.length > 10 ? (p.projectTitle.slice(0, 10) + '...') : p.projectTitle}
                              </span>
                              中选中
                            </>
                          ) : (p.id || p.url || '未命名')}
                        </div>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <div style={{ fontSize: 12, color: '#0070cc', cursor: 'pointer' }} onClick={() => handleRemove(p)}>删除</div>
                        </div>
                      </div>
                    </div>
                  )) : (
                    <div style={{ padding: 12, color: '#666', textAlign: 'center' }}>中转站为空</div>
                  )}
                </div>
              </div>
            )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
