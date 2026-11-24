import React from 'react';
import { ChartColumn, Code, Copy, Download, Ellipsis, Eye, FileUp, LayoutGrid, LoaderCircle,
  ScanLine, SlidersHorizontal, Smartphone, Text } from 'lucide-react';
import { computeDocStats } from './docModel.js';
import NumInput from './NumInput.jsx';
import './composerTools.css';

const ACCENTS = ['#1a1a1a', '#c0392b', '#1f4e8c', '#2f9e44', '#e8590c', '#7048e8', '#0c8599', '#d6336c'];

const MORE_ACTIONS = [
  { key: 'download', label: '下载图片包', icon: Download },
  { key: 'markdown', label: '复制 Markdown', icon: Text },
  { key: 'svg', label: '复制 SVG 源码', icon: Code },
  { key: 'draft', label: '发送到草稿箱（即将开放）', icon: FileUp, disabled: true },
];

function RailButton({ label, shortLabel, name = label, icon: Icon, className = '', busy, ...props }) {
  return <button type="button" className={`ctr-icon ${className}`} aria-label={name} title={name}
    disabled={busy} aria-busy={busy || undefined} {...props}>
    {busy ? <LoaderCircle className="ctr-spinner" size={18} aria-hidden="true" /> : <Icon size={18} strokeWidth={1.8} aria-hidden="true" />}
    <span className={`ctr-icon-label${shortLabel ? ' has-short-label' : ''}`}>{label}</span>
    {shortLabel ? <span className="ctr-icon-short">{shortLabel}</span> : null}
  </button>;
}
function Toggle({ label, on, onChange }) {
  return (
    <button type="button" className={`ctr-toggle${on ? ' is-on' : ''}`} onClick={() => onChange(!on)} role="switch" aria-checked={on}>
      <span className="ctr-toggle-track"><span className="ctr-toggle-knob" /></span>
      <span className="ctr-toggle-label">{label}</span>
    </button>);

}

export default function ComposerToolRail({
  doc, layoutMode, onToggleLayout, editAids, onEditAids, body, accent, page, onGlobalProps, publish,
}) {
  const [openTool, setOpenTool] = React.useState(null);
  const rootRef = React.useRef(null);
  const menuRef = React.useRef(null);
  const menuId = React.useId();
  const focusTrigger = React.useCallback(() => {
    rootRef.current?.querySelector('.ctr-icon[aria-expanded="true"]')?.focus({ preventScroll: true });
  }, []);

  React.useEffect(() => {
    if (!openTool) return undefined;
    const onDown = event => { if (!rootRef.current?.contains(event.target)) setOpenTool(null); };
    const onKey = event => {
      if (event.key !== 'Escape' || event.isComposing) return;
      focusTrigger();
      setOpenTool(null);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [openTool, focusTrigger]);
  React.useEffect(() => {
    if (openTool === 'more') menuRef.current?.querySelector('button:not(:disabled)')?.focus({ preventScroll: true });
  }, [openTool]);

  const b = body || {};
  const aids = editAids || {};

  const setBody = (patch) => onGlobalProps({ body: { ...b, ...patch } });
  const setPage = (patch) => onGlobalProps({ page: { ...(page || {}), ...patch } });

  const fontSize = b.fontSize != null ? Number(b.fontSize) : 15;
  const lineHeight = b.lineHeight != null ? Number(b.lineHeight) : 1.75;
  const letterSpacing = b.letterSpacing != null ? Number(b.letterSpacing) : 0.5;
  const paraSpacing = b.paraSpacing != null ? Number(b.paraSpacing) : 20;
  const color = b.color || '#333333';
  const justify = b.justify !== false;
  const textIndent = Boolean(b.textIndent);
  const pageBg = page && page.bg || '';
  const pagePad = page && page.paddingX != null ? Number(page.paddingX) : 0;

  const stats = React.useMemo(() => computeDocStats(doc), [doc]);

  const toggleTool = (t) => setOpenTool((cur) => cur === t ? null : t);
  const runPublish = (action, fromMenu = false) => {
    if (fromMenu) focusTrigger();
    setOpenTool(null);
    action?.();
  };
  const onMenuKey = event => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const items = [...event.currentTarget.querySelectorAll('button:not(:disabled)')];
    const index = items.indexOf(document.activeElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
      : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
  };

  return (
    <aside className="ctr-rail" aria-label="排版工具栏" ref={rootRef}
      onBlur={event => { if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) setOpenTool(null); }}>
      <div className="ctr-dock">
        <div className="ctr-group" role="group" aria-label="编辑工具">
          <RailButton label="布局" name="布局模式" icon={LayoutGrid} aria-pressed={layoutMode}
            onClick={() => { onToggleLayout(!layoutMode); setOpenTool(null); }} />
          <RailButton label="属性" name="全局属性" icon={SlidersHorizontal} aria-expanded={openTool === 'props'} onClick={() => toggleTool('props')} />
          <RailButton label="统计" name="全文统计" icon={ChartColumn} aria-expanded={openTool === 'stats'} onClick={() => toggleTool('stats')} />
          <RailButton label="辅助" name="编辑辅助" icon={ScanLine} aria-expanded={openTool === 'aids'} onClick={() => toggleTool('aids')} />
        </div>
        <div className="ctr-group" role="group" aria-label="发布操作">
          <RailButton label="复制推文" shortLabel="复制" name="复制到公众号" icon={Copy} className="is-primary" onClick={() => runPublish(publish.copy)} />
          <RailButton label="推文预览" shortLabel="推文" icon={Eye} onClick={() => runPublish(publish.articlePreview)} />
          <RailButton label="手机预览" shortLabel="扫码" icon={Smartphone} busy={publish.mobilePending} onClick={() => runPublish(publish.mobilePreview)} />
          <RailButton label="更多" icon={Ellipsis} aria-haspopup="menu" aria-controls={openTool === 'more' ? menuId : undefined}
            aria-expanded={openTool === 'more'} onClick={() => toggleTool('more')} />
        </div>

        {openTool === 'more' ? <div className="ctr-panel ctr-menu" ref={menuRef} id={menuId}
          role="menu" aria-label="更多发布操作" onKeyDown={onMenuKey}>
          {MORE_ACTIONS.map(({ key, label, icon: Icon, disabled }) => (
            <button type="button" className="ctr-menu-item" role="menuitem" tabIndex={-1} key={key} disabled={disabled}
              onClick={() => runPublish(publish[key], true)}>
              <Icon size={16} aria-hidden="true" /><span>{label}</span>
            </button>
          ))}
        </div> : null}

      {openTool === 'props' &&
      <div className="ctr-panel">
          <div className="ctr-panel-title">全局属性</div>
          <div className="ctr-row"><span className="ctr-row-label">正文字号</span><NumInput value={fontSize} onChange={(v) => setBody({ fontSize: v == null ? undefined : v })} min={12} max={40} step={1} suffix="px" /></div>
          <div className="ctr-row"><span className="ctr-row-label">行距</span><NumInput value={lineHeight} onChange={(v) => setBody({ lineHeight: v == null ? undefined : v })} min={1} max={3} step={0.1} /></div>
          <div className="ctr-row"><span className="ctr-row-label">字间距</span><NumInput value={letterSpacing} onChange={(v) => setBody({ letterSpacing: v == null ? undefined : v })} min={0} max={12} step={0.5} suffix="px" /></div>
          <div className="ctr-row"><span className="ctr-row-label">段间距</span><NumInput value={paraSpacing} onChange={(v) => setBody({ paraSpacing: v == null ? undefined : v })} min={0} max={100} step={2} suffix="px" /></div>
          <div className="ctr-row">
            <span className="ctr-row-label">正文颜色</span>
            <input type="color" className="ctr-color" value={/^#[0-9a-fA-F]{6}$/.test(color) ? color : '#333333'} onChange={(e) => setBody({ color: e.target.value })} aria-label="正文颜色" />
            <button type="button" className="ctr-mini" onClick={() => setBody({ color: undefined })}>默认</button>
          </div>
          <div className="ctr-row">
            <span className="ctr-row-label">对齐</span>
            <div className="ctr-seg">
              <button type="button" className={`ctr-seg-btn${justify ? ' is-on' : ''}`} onClick={() => setBody({ justify: true })}>两端</button>
              <button type="button" className={`ctr-seg-btn${!justify ? ' is-on' : ''}`} onClick={() => setBody({ justify: false })}>左</button>
            </div>
          </div>
          <Toggle label="首行缩进 2 字" on={textIndent} onChange={(v) => setBody({ textIndent: v })} />
          <div className="ctr-row ctr-row--wrap">
            <span className="ctr-row-label">主题色</span>
            <div className="ctr-swatches">
              {ACCENTS.map((hex) =>
            <button key={hex} type="button" className={`ctr-swatch${accent === hex ? ' is-on' : ''}`} style={{ background: hex }} aria-label={hex} onClick={() => onGlobalProps({ accent: hex })} />
            )}
              <label className="ctr-swatch ctr-swatch--custom" title="自定义主题色">
                <input type="color" value={/^#[0-9a-fA-F]{6}$/.test(accent || '') ? accent : '#1a1a1a'} onChange={(e) => onGlobalProps({ accent: e.target.value })} />
              </label>
            </div>
          </div>
          <div className="ctr-divider" />
          <div className="ctr-row">
            <span className="ctr-row-label">页面背景</span>
            <input type="color" className="ctr-color" value={/^#[0-9a-fA-F]{6}$/.test(pageBg) ? pageBg : '#ffffff'} onChange={(e) => setPage({ bg: e.target.value })} aria-label="页面背景" />
            <button type="button" className="ctr-mini" onClick={() => setPage({ bg: undefined })}>无</button>
          </div>
          <div className="ctr-row"><span className="ctr-row-label">左右留白</span><NumInput value={pagePad} onChange={(v) => setPage({ paddingX: v == null ? undefined : v })} min={0} max={80} step={2} suffix="px" /></div>
          <button type="button" className="ctr-reset" onClick={() => onGlobalProps({ body: null, page: null })}>恢复默认</button>
        </div>
      }

      {openTool === 'stats' &&
      <div className="ctr-panel">
          <div className="ctr-panel-title">全文统计</div>
          <div className="ctr-stat"><span>字数（中文字+英文词）</span><b>{stats.wordCount}</b></div>
          <div className="ctr-stat"><span>中文字符</span><b>{stats.cjk}</b></div>
          <div className="ctr-stat"><span>英文单词</span><b>{stats.words}</b></div>
          <div className="ctr-stat"><span>字符总数（不含空格）</span><b>{stats.chars}</b></div>
          <div className="ctr-divider" />
          <div className="ctr-stat"><span>元素块</span><b>{stats.blocks}</b></div>
          <div className="ctr-stat"><span>文字段落</span><b>{stats.paragraphs}</b></div>
          <div className="ctr-stat"><span>图片</span><b>{stats.images}</b></div>
          <div className="ctr-stat"><span>预计阅读</span><b>约 {stats.readMinutes} 分钟</b></div>
        </div>
      }

      {openTool === 'aids' &&
      <div className="ctr-panel">
          <div className="ctr-panel-title">编辑辅助</div>
          <Toggle label="显示元素边框" on={!!aids.outline} onChange={(v) => onEditAids({ ...aids, outline: v })} />
          <Toggle label="显示元素序号" on={!!aids.index} onChange={(v) => onEditAids({ ...aids, index: v })} />
          <Toggle label="斑马底色（隔行）" on={!!aids.zebra} onChange={(v) => onEditAids({ ...aids, zebra: v })} />
          <p className="ctr-hint">辅助线只在编辑时显示，不影响复制/预览/导出。</p>
        </div>
      }
      </div>
    </aside>);

}
