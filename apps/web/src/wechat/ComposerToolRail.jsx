// src/wechat/ComposerToolRail.jsx
// 秀米式左侧工具栏：布局模式 / 全局属性 / 全文统计 / 编辑辅助。
// 全局属性写回 blockConfig(body/accent/page)，画布与导出同源；统计只读；布局模式/编辑辅助为视图开关。
import React from 'react';
import { computeDocStats } from './docModel.js';
import NumInput from './NumInput.jsx';
import './composerTools.css';

const ACCENTS = ['#1a1a1a', '#c0392b', '#1f4e8c', '#2f9e44', '#e8590c', '#7048e8', '#0c8599', '#d6336c'];

function IconLayout() {
  return (<svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden="true"><rect x="3.5" y="3.5" width="7" height="7" rx="1.4" fill="currentColor" /><rect x="13.5" y="3.5" width="7" height="7" rx="1.4" fill="currentColor" /><rect x="3.5" y="13.5" width="7" height="7" rx="1.4" fill="currentColor" /><rect x="13.5" y="13.5" width="7" height="7" rx="1.4" fill="currentColor" /></svg>);
}
function IconProps() {
  return (<svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden="true"><path d="M12 3v18M4.2 7.5l15.6 9M19.8 7.5l-15.6 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>);
}
function IconStats() {
  return (<svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden="true"><rect x="4" y="12" width="4" height="8" rx="1" fill="currentColor" /><rect x="10" y="7" width="4" height="13" rx="1" fill="currentColor" /><rect x="16" y="4" width="4" height="16" rx="1" fill="currentColor" /></svg>);
}
function IconEye() {
  return (<svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden="true"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" stroke="currentColor" strokeWidth="1.8" /><circle cx="12" cy="12" r="2.6" stroke="currentColor" strokeWidth="1.8" /></svg>);
}

// 数值步进行
function Stepper({ label, value, onDec, onInc, display }) {
  return (
    <div className="ctr-row">
      <span className="ctr-row-label">{label}</span>
      <button type="button" className="ctr-step" onClick={onDec} aria-label={`减小${label}`}>−</button>
      <span className="ctr-row-val">{display != null ? display : value}</span>
      <button type="button" className="ctr-step" onClick={onInc} aria-label={`增大${label}`}>＋</button>
    </div>
  );
}

function Toggle({ label, on, onChange }) {
  return (
    <button type="button" className={`ctr-toggle${on ? ' is-on' : ''}`} onClick={() => onChange(!on)} role="switch" aria-checked={on}>
      <span className="ctr-toggle-track"><span className="ctr-toggle-knob" /></span>
      <span className="ctr-toggle-label">{label}</span>
    </button>
  );
}

// props: { doc, layoutMode, onToggleLayout, editAids, onEditAids, body, accent, page, onGlobalProps }
export default function ComposerToolRail({
  doc, layoutMode, onToggleLayout, editAids, onEditAids, body, accent, page, onGlobalProps,
}) {
  const [openTool, setOpenTool] = React.useState(null); // 'props' | 'stats' | 'aids' | null
  const rootRef = React.useRef(null);

  // 点外部关闭弹层
  React.useEffect(() => {
    if (!openTool) return undefined;
    const onDown = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) setOpenTool(null); };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [openTool]);

  const b = body || {};
  const aids = editAids || {};
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const setBody = (patch) => onGlobalProps({ body: { ...b, ...patch } });
  const setPage = (patch) => onGlobalProps({ page: { ...(page || {}), ...patch } });

  const fontSize = b.fontSize != null ? Number(b.fontSize) : 15;
  const lineHeight = b.lineHeight != null ? Number(b.lineHeight) : 1.75;
  const letterSpacing = b.letterSpacing != null ? Number(b.letterSpacing) : 0.5;
  const paraSpacing = b.paraSpacing != null ? Number(b.paraSpacing) : 20;
  const color = b.color || '#333333';
  const justify = b.justify !== false;
  const textIndent = Boolean(b.textIndent);
  const pageBg = (page && page.bg) || '';
  const pagePad = (page && page.paddingX != null) ? Number(page.paddingX) : 0;

  const stats = React.useMemo(() => computeDocStats(doc), [doc]);

  const toggleTool = (t) => setOpenTool((cur) => (cur === t ? null : t));

  return (
    <div className="ctr-rail" ref={rootRef}>
      <button
        type="button"
        className={`ctr-icon${layoutMode ? ' is-on' : ''}`}
        onClick={() => { onToggleLayout(!layoutMode); setOpenTool(null); }}
        title="布局模式：显示每个元素的边框和类型，看清整体结构"
        aria-pressed={layoutMode}
      ><IconLayout /></button>

      <button
        type="button"
        className={`ctr-icon${openTool === 'props' ? ' is-open' : ''}`}
        onClick={() => toggleTool('props')}
        title="全局属性：正文字号/行距/字间距/颜色/主题色/页面背景"
        aria-expanded={openTool === 'props'}
      ><IconProps /></button>

      <button
        type="button"
        className={`ctr-icon${openTool === 'stats' ? ' is-open' : ''}`}
        onClick={() => toggleTool('stats')}
        title="全文统计：字数 / 段落 / 图片 / 阅读时长"
        aria-expanded={openTool === 'stats'}
      ><IconStats /></button>

      <button
        type="button"
        className={`ctr-icon${openTool === 'aids' ? ' is-open' : ''}`}
        onClick={() => toggleTool('aids')}
        title="编辑辅助：元素边框 / 序号 / 斑马底色"
        aria-expanded={openTool === 'aids'}
      ><IconEye /></button>

      {openTool === 'props' && (
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
              {ACCENTS.map((hex) => (
                <button key={hex} type="button" className={`ctr-swatch${accent === hex ? ' is-on' : ''}`} style={{ background: hex }} aria-label={hex} onClick={() => onGlobalProps({ accent: hex })} />
              ))}
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
      )}

      {openTool === 'stats' && (
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
      )}

      {openTool === 'aids' && (
        <div className="ctr-panel">
          <div className="ctr-panel-title">编辑辅助</div>
          <Toggle label="显示元素边框" on={!!aids.outline} onChange={(v) => onEditAids({ ...aids, outline: v })} />
          <Toggle label="显示元素序号" on={!!aids.index} onChange={(v) => onEditAids({ ...aids, index: v })} />
          <Toggle label="斑马底色（隔行）" on={!!aids.zebra} onChange={(v) => onEditAids({ ...aids, zebra: v })} />
          <p className="ctr-hint">辅助线只在编辑时显示，不影响复制/预览/导出。</p>
        </div>
      )}
    </div>
  );
}
