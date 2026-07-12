// 公众号排版器 v3 画布编辑组件。契约：
// /private/tmp/claude-501/-Users-liwenyu/f413e1a5-8f0f-436d-b775-8c9faffa99f1/scratchpad/canvas-editor-contracts.md
// 约束：本文件对 doc 的所有结构性修改一律通过 onChange(nextDoc[, opts]) 交给调用方，自身不持有 doc 状态、
// 不做撤销/重做（历史栈是调用方 createHistory 的职责，这里只在 opts.transient 上如实标注"是否为打字中间态"）；
// 不改动 WechatComposer.jsx / themes.js / builtinBlocks*.js / wechatExport.js，样式渲染只经 applyBlock。
import React from 'react';
import DOMPurify from 'dompurify';
import { applyBlock, BUILTIN_BLOCKS_BY_ID, WECHAT_THEMES } from './themes.js';
import {
  makeUid, sanitizeParaHtml, sanitizeRawHtml,
  splitRawHtml, replaceRawImgSrc, applyRawImgStyle,
} from './docModel.js';
import { beginDrag, registerDropZone } from './pointerDrag.js';
import './canvas.css';

// 画布主渲染路径的客户端兜底清洗：样式块的 htmlTemplate 可能来自"我的库"或收藏快照，
// 后端手写正则清洗存在 <svg/onload=> 一类分隔符绕过，这里对 applyBlock 产出统一过一遍 DOMPurify，
// 与 renderBlockPreview/ImportPreviewModal/docToHtml 的口径一致（style/referrerpolicy 放行，禁可执行标签）。
function purifyBlockHtml(html) {
  return DOMPurify.sanitize(String(html || ''), {
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input'],
    ADD_ATTR: ['style', 'referrerpolicy'],
  });
}

// 占位 token 用于"先占位渲染整块模板，再把 content/caption 槽位换成可编辑 span"的两段式渲染——
// applyBlock 是纯字符串替换，不认识 contentEditable，槽位包装必须由本文件在渲染后手工处理。
// 用 \u0000 是因为它绝不会出现在正常文案里，且在 split/join 阶段就已被替换掉，不会真正进入 innerHTML。
const SLOT_TOKEN = '\u0000CVE_SLOT\u0000';

// 根据鼠标 Y 坐标与已渲染块的外包矩形，找最近的插入间隙：鼠标落在某块垂直中线之上则插入该块前，
// 否则继续比较下一块；全部块都在鼠标上方（含空画布）则插入末尾/顶部。
// top 是指示线相对画布外边框（getBoundingClientRect().top）的像素偏移，供指示线定位用。
function computeDropTarget(clientY, blockEls, canvasTop) {
  if (blockEls.length === 0) {
    return { index: 0, top: 16 };
  }
  for (let i = 0; i < blockEls.length; i += 1) {
    const rect = blockEls[i].getBoundingClientRect();
    const mid = rect.top + rect.height / 2;
    if (clientY < mid) {
      return { index: i, top: rect.top - canvasTop - 6 };
    }
  }
  const lastRect = blockEls[blockEls.length - 1].getBoundingClientRect();
  return { index: blockEls.length, top: lastRect.bottom - canvasTop + 6 };
}

// 与 themes.js 内部 FALLBACK_BLOCK_IDS 保持同一组 id（themes.js 未导出该表，这里按其公开的 minimal
// 预设块 id 重复声明，仅用于"blocksById 缺项"时画布本身也能有兜底展示，不影响 themes.js 的渲染逻辑）。
const FALLBACK_BLOCK_ID_BY_TYPE = {
  h2: 'builtin-h2-minimal',
  h3: 'builtin-h3-minimal',
  quote: 'builtin-quote-minimal',
  divider: 'builtin-divider-double-line',
  imageCard: 'builtin-imageCard-minimal-underline',
  signoff: 'builtin-signoff-end-badge',
};

// 换色面板固定 8 色：5 个内置主题色（保持与 WECHAT_THEMES 同源，主题色改了这里自动跟着变）+
// 3 个额外点缀色，凑够契约要求的"8 色小面板"。
const EXTRA_ACCENTS = ['#6c3fc5', '#0f766e', '#c2185b'];
const ACCENT_SWATCHES = WECHAT_THEMES.map((t) => t.accent).concat(EXTRA_ACCENTS).slice(0, 8);

const SLOT_PLACEHOLDER_BY_TYPE = {
  h2: '点击输入标题',
  h3: '点击输入标题',
  quote: '点击输入引用文字',
  signoff: '点击输入落款文字',
};
const CAPTION_PLACEHOLDER = '点击添加图注（可选）';
const PARA_PLACEHOLDER = '点击输入正文…';

// 空图片卡兜底占位图：内联 SVG，避免 <img src=""> 在部分浏览器下触发对当前页面地址的多余请求
const EMPTY_IMAGE_PLACEHOLDER = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#f2f2f2"/><text x="320" y="188" font-size="20" fill="#999" text-anchor="middle">点击选择图片</text></svg>',
);

// title/caption/content 在拼进 innerHTML 前必须转义——themes.js 的 escapeHtml 未导出，
// 规则须与其保持一致（& < > " '），因此在此按同一转义表复制一份，不做其它变体。
function escapeHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// 判定当前焦点是否处于"文本录入态"（contenteditable 或原生表单控件），命中则键盘删块必须让路，
// 否则用户在标题输入框等处按 Backspace 会被画布误当成删块操作。
function isTypingTarget(el) {
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

// 复制块=深拷贝换新 uid：JSON 往返而非浅 spread，防止将来 DocBlock 出现嵌套字段时被两个块共享引用。
function cloneBlockWithNewUid(block) {
  const cloned = JSON.parse(JSON.stringify(block));
  cloned.uid = makeUid();
  return cloned;
}

// ---------------------------------------------------------------------------
// 文字样式命令（秀米式）：全部作用于当前 selection，前提是选区落在指定宿主（本块的
// contenteditable）内——落在别处一律不执行，防止误改其它块/页面输入框。
// execCommand 虽已 deprecated，但公众号排版场景（秀米/135 同款实现）全浏览器仍可用，
// 且是唯一无需自研 Range 引擎的选区级富文本方案。
// ---------------------------------------------------------------------------

function selectionInsideHost(hostEl) {
  const sel = window.getSelection && window.getSelection();
  if (!sel || sel.rangeCount === 0) return false;
  const node = sel.anchorNode;
  return !!(node && hostEl && hostEl.contains(node));
}

const TEXT_FONT_SIZES = [
  { key: 'S', px: 14 },
  { key: 'M', px: 15 },
  { key: 'L', px: 17 },
  { key: 'XL', px: 20 },
];

// execCommand('fontSize') 只接受 1-7 档：先打成第 7 档，再把产物（styleWithCSS 下是
// span font-size:xxx-large，Safari 可能仍输出 font[size=7]）统一替换为目标 px 的 span。
function applySelectionFontSize(hostEl, px) {
  document.execCommand('styleWithCSS', false, true);
  document.execCommand('fontSize', false, '7');
  hostEl.querySelectorAll('span').forEach((s) => {
    if (s.style && s.style.fontSize === 'xxx-large') s.style.fontSize = `${px}px`;
  });
  hostEl.querySelectorAll('font[size="7"]').forEach((f) => {
    const span = document.createElement('span');
    span.style.fontSize = `${px}px`;
    while (f.firstChild) span.appendChild(f.firstChild);
    f.replaceWith(span);
  });
}

function execTextCommand(hostEl, cmd, value) {
  if (!hostEl || !selectionInsideHost(hostEl)) return false;
  document.execCommand('styleWithCSS', false, true);
  if (cmd === 'fontSize') {
    applySelectionFontSize(hostEl, value);
  } else if (cmd === 'foreColor') {
    document.execCommand('foreColor', false, value);
  } else {
    // bold / italic / underline / removeFormat / justifyLeft / justifyCenter / justifyRight
    document.execCommand(cmd, false, null);
  }
  return true;
}

// 正文段落内联样式：数值口径与 themes.js computeBodyStyles 的 p 规格一致（15px/1.75/两端对齐/
// 首行缩进开关），是刻意重复而非复用——两处输出目标不同（一个是 React style 对象，一个是内联 style 字符串）。
function computeParaStyle(bodyConfig, accent) {
  const cfg = bodyConfig || {};
  const fontSize = Number(cfg.fontSize) || 15;
  const lineHeight = cfg.lineHeight || 1.75;
  const justify = cfg.justify !== false;
  const textIndent = Boolean(cfg.textIndent);
  return {
    fontSize: `${fontSize}px`,
    lineHeight: String(lineHeight),
    color: '#333333',
    letterSpacing: '0.03em',
    textAlign: justify ? 'justify' : 'left',
    textIndent: textIndent ? '2em' : undefined,
    margin: '0 0 20px',
    '--cve-accent': accent || '#1a1a1a',
  };
}

function resolveStyleBlock(blocksById, block) {
  const map = blocksById || {};
  return map[block.blockId] || BUILTIN_BLOCKS_BY_ID[FALLBACK_BLOCK_ID_BY_TYPE[block.type]] || null;
}

// ---------------------------------------------------------------------------
// 分隔线：无内容、无编辑，只走 applyBlock 渲染 + accent
// ---------------------------------------------------------------------------
function DividerView({ styleBlock, accent }) {
  const html = React.useMemo(() => purifyBlockHtml(applyBlock(styleBlock, { accent })), [styleBlock, accent]);
  // eslint-disable-next-line react/no-danger
  return <div className="cve-divider-host" dangerouslySetInnerHTML={{ __html: html }} />;
}

// ---------------------------------------------------------------------------
// h2/h3/quote/signoff 共用：整块模板渲染 + content 槽位原地编辑
// ---------------------------------------------------------------------------
function StyledSlotView({ block, styleBlock, accent, onCommitContent }) {
  const hostRef = React.useRef(null);

  // 模板骨架只在样式/颜色变化（换样式、换色）时才需要重算；文字内容单独在下面的 effect 里回填，
  // 二者分离是为了避免"打字过程中因为 doc.content 变化触发整段 innerHTML 重写、导致光标跳动"。
  const templateHtml = React.useMemo(
    () => applyBlock(styleBlock, { content: SLOT_TOKEN, accent }),
    [styleBlock, accent],
  );

  React.useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const active = document.activeElement;
    // 正在编辑该槽位时跳过重绘：doc.content 只会在失焦提交后才变化，那时槽位已不在编辑态，重绘无损。
    if (
      active
      && host.contains(active)
      && active.getAttribute
      && active.getAttribute('data-cve-slot') === 'content'
    ) {
      return;
    }
    const placeholder = escapeHtml(SLOT_PLACEHOLDER_BY_TYPE[block.type] || '点击输入文字');
    const slotHtml = `<span data-cve-slot="content" data-cve-placeholder="${placeholder}">${escapeHtml(block.content || '')}</span>`;
    // 先在原始模板上 split/join 塞入可编辑 span（token 含 ，purify 会剥掉故必须在清洗前替换），
    // 再对拼装结果整体过 DOMPurify——恶意模板标签被剥，data-cve-slot span 与 img 存活
    host.innerHTML = purifyBlockHtml(templateHtml.split(SLOT_TOKEN).join(slotHtml));
    const slot = host.querySelector('[data-cve-slot="content"]');
    if (slot) slot.contentEditable = 'true';
  }, [templateHtml, block.content, block.type]);

  const handleBlur = (e) => {
    const target = e.target;
    if (target && target.getAttribute && target.getAttribute('data-cve-slot') === 'content') {
      onCommitContent(target.innerText);
    }
  };

  // eslint-disable-next-line react/no-danger -- innerHTML 由上面的 effect 手工管理，此处不设置初始子节点
  return <div ref={hostRef} className="cve-styled-host" onBlur={handleBlur} />;
}

// ---------------------------------------------------------------------------
// 图片卡：图片点击换图，图注原地编辑（与 StyledSlotView 同一套槽位替换手法）
// ---------------------------------------------------------------------------
function ImageCardView({ block, styleBlock, accent, onImageClick, onCommitCaption }) {
  const hostRef = React.useRef(null);
  const src = block.src && String(block.src).trim() ? block.src : EMPTY_IMAGE_PLACEHOLDER;

  const templateHtml = React.useMemo(
    () => applyBlock(styleBlock, { src: escapeHtml(src), caption: SLOT_TOKEN, accent }),
    [styleBlock, accent, src],
  );

  React.useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const active = document.activeElement;
    if (
      active
      && host.contains(active)
      && active.getAttribute
      && active.getAttribute('data-cve-slot') === 'caption'
    ) {
      return;
    }
    const placeholder = escapeHtml(CAPTION_PLACEHOLDER);
    const slotHtml = `<span data-cve-slot="caption" data-cve-placeholder="${placeholder}">${escapeHtml(block.caption || '')}</span>`;
    host.innerHTML = purifyBlockHtml(templateHtml.split(SLOT_TOKEN).join(slotHtml));
    const slot = host.querySelector('[data-cve-slot="caption"]');
    if (slot) slot.contentEditable = 'true';
    const img = host.querySelector('img');
    // 内置模板规定图片一律不带 class（存活规则禁止 class=），这里赋值不存在覆盖冲突的风险
    if (img) {
      img.className = 'cve-image-click-target';
      // 画布内的 imgStyle 预览：宽度/圆角直接内联，裁切用 aspect-ratio+object-fit（现代浏览器）；
      // 导出走 docToHtmlRaw 的 padding-bottom 容器方案，两者视觉一致
      const st = block.imgStyle || {};
      const narrowed = st.widthPct && st.widthPct < 100;
      img.style.width = narrowed ? `${st.widthPct}%` : '';
      img.style.display = narrowed ? 'block' : '';
      img.style.marginLeft = narrowed ? 'auto' : '';
      img.style.marginRight = narrowed ? 'auto' : '';
      img.style.borderRadius = st.radius ? `${st.radius}px` : '';
      img.style.aspectRatio = st.aspect ? st.aspect.replace(':', ' / ') : '';
      img.style.objectFit = st.aspect ? 'cover' : '';
    }
  }, [templateHtml, block.caption, block.imgStyle]);

  const handleClick = (e) => {
    if (e.target && e.target.tagName === 'IMG') onImageClick();
  };
  const handleBlur = (e) => {
    const target = e.target;
    if (target && target.getAttribute && target.getAttribute('data-cve-slot') === 'caption') {
      onCommitCaption(target.innerText);
    }
  };

  return <div ref={hostRef} className="cve-imagecard-host" onClick={handleClick} onBlur={handleBlur} />;
}

// ---------------------------------------------------------------------------
// 普通段落：整段 contentEditable，非受控 DOM（同上，避免打字中间态触发 innerHTML 重写）
// ---------------------------------------------------------------------------
function ParaView({ block, bodyStyle, onTransient, onCommit }) {
  const ref = React.useRef(null);

  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (document.activeElement === el) return; // 编辑中：外部 doc.html 的回写不覆盖正在输入的 DOM
    el.innerHTML = block.html || '';
  }, [block.html]);

  const handleInput = (e) => onTransient(e.currentTarget.innerHTML);
  const handleBlur = (e) => onCommit(e.currentTarget.innerHTML);
  // 粘贴一律降级为纯文本插入，脏 HTML（外部样式/多余标签）交给失焦提交时的 sanitizeParaHtml 兜底清洗，
  // 这里提前挡一道是为了不让编辑区在粘贴瞬间出现与全文风格不一致的杂色/字号。
  const handlePaste = (e) => {
    e.preventDefault();
    const clipboard = e.clipboardData || window.clipboardData;
    const text = clipboard ? clipboard.getData('text/plain') : '';
    if (document.execCommand) {
      document.execCommand('insertText', false, text);
    } else {
      e.currentTarget.appendChild(document.createTextNode(text));
    }
  };

  return (
    <p
      ref={ref}
      className="cve-para"
      contentEditable
      suppressContentEditableWarning
      data-cve-placeholder={PARA_PLACEHOLDER}
      style={bodyStyle}
      onInput={handleInput}
      onBlur={handleBlur}
      onPaste={handlePaste}
    />
  );
}

// ---------------------------------------------------------------------------
// 整文导入的原样内容块：保留原文全部内联样式的富 HTML，整块 contentEditable 改字，
// 结构（换样式/换色/槽位）操作不适用；失焦提交时过 sanitizeRawHtml 白名单清洗
// ---------------------------------------------------------------------------
function RawView({ block, activeImgIndex, onTransient, onCommit, onSelectImg }) {
  const ref = React.useRef(null);

  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // 编辑中（焦点落在本块任意后代）不回写 innerHTML，防光标跳动；提交发生在失焦后，重绘无损
    if (document.activeElement && (document.activeElement === el || el.contains(document.activeElement))) return;
    el.innerHTML = block.html || '';
  }, [block.html]);

  // 选中图片的高亮标记直接打在 DOM 属性上（innerHTML 非 React 管理，无法走 className）
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.querySelectorAll('img').forEach((img, i) => {
      if (i === activeImgIndex) img.setAttribute('data-cve-img-active', '1');
      else img.removeAttribute('data-cve-img-active');
    });
  }, [activeImgIndex, block.html]);

  const handleInput = (e) => onTransient(e.currentTarget.innerHTML);
  const handleBlur = (e) => onCommit(e.currentTarget.innerHTML);
  // 点图片=选中该图（工具条切图片样式区），不进入文字编辑语义
  const handleClick = (e) => {
    if (e.target && e.target.tagName === 'IMG') {
      const imgs = Array.from(ref.current.querySelectorAll('img'));
      onSelectImg(imgs.indexOf(e.target));
      return;
    }
    onSelectImg(null);
  };

  return (
    <div
      ref={ref}
      className="cve-raw-host"
      contentEditable
      suppressContentEditableWarning
      onInput={handleInput}
      onBlur={handleBlur}
      onClick={handleClick}
    />
  );
}

// ---------------------------------------------------------------------------
// 浮动块工具条（两行）：第一行结构操作（上移/下移/复制/删除/换样式/换色/拆分/后插段落），
// 第二行按块类型上下文出现——para/raw=文字样式（B/I/U/字号/字色/对齐/清除，作用于选区），
// imageCard 或 raw 内选中图片=图片样式（宽度/圆角/裁切/换图）。
// 第二行按钮一律在 pointerdown 阶段 preventDefault+stopPropagation：不夺走 contenteditable
// 焦点（否则选区塌掉 execCommand 落空），也不触发块级选中/拖拽。
// ---------------------------------------------------------------------------

const IMG_WIDTH_CHOICES = [50, 75, 100];
const IMG_RADIUS_CHOICES = [{ label: '直角', v: 0 }, { label: '圆角', v: 8 }, { label: '大圆', v: 16 }];
const IMG_ASPECT_CHOICES = [{ label: '原图', v: null }, { label: '1:1', v: '1:1' }, { label: '4:3', v: '4:3' }, { label: '16:9', v: '16:9' }];
const TEXT_COLOR_CHOICES = ['#111111', '#666666', '#c0392b', '#1f4e8c', '#2f9e44', '#e8590c', '#7048e8', '#0c8599'];

function toolbarRowGuard(e) {
  e.preventDefault();
  e.stopPropagation();
}

function BlockToolbar({
  block, index, total, styleBlock, flip, anchorTop, getHostEl, activeRawImgIndex,
  onMoveUp, onMoveDown, onDuplicate, onDelete, onChangeStyle, onChangeAccent, onInsertParaAfter,
  onSplitRaw, onImgStyle, onRawImgStyle, onImgReplace,
}) {
  const [swatchOpen, setSwatchOpen] = React.useState(false);
  const [textSwatchOpen, setTextSwatchOpen] = React.useState(false);
  const canChangeStyle = block.kind === 'styled';
  const canChangeAccent = block.kind === 'styled' && styleBlock && styleBlock.accentEditable === true;
  const isTextBlock = block.kind === 'para' || block.kind === 'raw';
  const isImageCard = block.kind === 'styled' && block.type === 'imageCard';
  const showRawImg = block.kind === 'raw' && activeRawImgIndex != null;
  const imgStyle = block.imgStyle || {};
  // anchorTop 非 null=跟随光标/选区/图片的浮动模式（top 由内联样式给,transform 决定锚点上/下方）；
  // null=默认钉块顶
  const anchored = anchorTop != null;

  const runText = (cmd, value) => {
    execTextCommand(getHostEl(), cmd, value);
  };

  return (
    <div
      className={`cve-toolbar${anchored ? ' cve-toolbar--anchored' : ''} ${flip ? 'cve-toolbar--below' : 'cve-toolbar--above'}`}
      style={anchored ? { top: `${anchorTop}px` } : undefined}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="cve-toolbar-row">
        <button type="button" className="cve-toolbar-btn" disabled={index === 0} onClick={onMoveUp} title="上移" aria-label="上移">↑</button>
        <button type="button" className="cve-toolbar-btn" disabled={index === total - 1} onClick={onMoveDown} title="下移" aria-label="下移">↓</button>
        <button type="button" className="cve-toolbar-btn" onClick={onDuplicate} title="复制" aria-label="复制">复制</button>
        <button type="button" className="cve-toolbar-btn" onClick={onDelete} title="删除" aria-label="删除">删除</button>
        {canChangeStyle && (
          <button type="button" className="cve-toolbar-btn" onClick={onChangeStyle} title="换样式" aria-label="换样式">样式</button>
        )}
        {block.kind === 'raw' && (
          <button type="button" className="cve-toolbar-btn" onClick={onSplitRaw} title="把容器拆成独立元素" aria-label="拆分容器">拆分</button>
        )}
        {canChangeAccent && (
          <div className="cve-toolbar-swatch-wrap">
            <button
              type="button"
              className="cve-toolbar-btn cve-toolbar-dot-btn"
              onClick={() => setSwatchOpen((v) => !v)}
              title="换色"
              aria-label="换色"
            >
              <span className="cve-dot-preview" style={{ backgroundColor: block.accent || '#1a1a1a' }} />
            </button>
            {swatchOpen && (
              <div className="cve-swatch-panel">
                {ACCENT_SWATCHES.map((hex) => (
                  <button
                    key={hex}
                    type="button"
                    className="cve-swatch"
                    style={{ backgroundColor: hex }}
                    aria-label={hex}
                    onClick={() => { onChangeAccent(hex); setSwatchOpen(false); }}
                  />
                ))}
              </div>
            )}
          </div>
        )}
        <button type="button" className="cve-toolbar-btn" onClick={onInsertParaAfter} title="后插段落" aria-label="后插段落">+段</button>
      </div>

      {isTextBlock && !showRawImg && (
        <div className="cve-toolbar-row cve-toolbar-row--ctx" onPointerDown={toolbarRowGuard}>
          <button type="button" className="cve-toolbar-btn" onClick={() => runText('bold')} title="加粗"><b>B</b></button>
          <button type="button" className="cve-toolbar-btn" onClick={() => runText('italic')} title="斜体"><i>I</i></button>
          <button type="button" className="cve-toolbar-btn" onClick={() => runText('underline')} title="下划线"><u>U</u></button>
          <span className="cve-toolbar-sep" />
          {TEXT_FONT_SIZES.map((s) => (
            <button key={s.key} type="button" className="cve-toolbar-btn cve-toolbar-btn--sz" onClick={() => runText('fontSize', s.px)} title={`${s.px}px`}>{s.key}</button>
          ))}
          <span className="cve-toolbar-sep" />
          <div className="cve-toolbar-swatch-wrap">
            <button type="button" className="cve-toolbar-btn cve-toolbar-dot-btn" onClick={() => setTextSwatchOpen((v) => !v)} title="文字颜色" aria-label="文字颜色">
              <span className="cve-dot-preview cve-dot-preview--text">A</span>
            </button>
            {textSwatchOpen && (
              <div className="cve-swatch-panel">
                {TEXT_COLOR_CHOICES.map((hex) => (
                  <button
                    key={hex}
                    type="button"
                    className="cve-swatch"
                    style={{ backgroundColor: hex }}
                    aria-label={hex}
                    onPointerDown={toolbarRowGuard}
                    onClick={() => { runText('foreColor', hex); setTextSwatchOpen(false); }}
                  />
                ))}
              </div>
            )}
          </div>
          <span className="cve-toolbar-sep" />
          <button type="button" className="cve-toolbar-btn" onClick={() => runText('justifyLeft')} title="左对齐">左</button>
          <button type="button" className="cve-toolbar-btn" onClick={() => runText('justifyCenter')} title="居中">中</button>
          <button type="button" className="cve-toolbar-btn" onClick={() => runText('justifyRight')} title="右对齐">右</button>
          <span className="cve-toolbar-sep" />
          <button type="button" className="cve-toolbar-btn" onClick={() => runText('removeFormat')} title="清除格式">清除</button>
        </div>
      )}

      {isImageCard && (
        <div className="cve-toolbar-row cve-toolbar-row--ctx" onPointerDown={toolbarRowGuard}>
          <span className="cve-toolbar-label">宽</span>
          {IMG_WIDTH_CHOICES.map((w) => (
            <button key={w} type="button" className={`cve-toolbar-btn${(imgStyle.widthPct || 100) === w ? ' is-on' : ''}`} onClick={() => onImgStyle({ ...imgStyle, widthPct: w })}>{w}%</button>
          ))}
          <span className="cve-toolbar-sep" />
          {IMG_RADIUS_CHOICES.map((r) => (
            <button key={r.v} type="button" className={`cve-toolbar-btn${(imgStyle.radius || 0) === r.v ? ' is-on' : ''}`} onClick={() => onImgStyle({ ...imgStyle, radius: r.v })}>{r.label}</button>
          ))}
          <span className="cve-toolbar-sep" />
          {IMG_ASPECT_CHOICES.map((a) => (
            <button key={String(a.v)} type="button" className={`cve-toolbar-btn${(imgStyle.aspect || null) === a.v ? ' is-on' : ''}`} onClick={() => onImgStyle({ ...imgStyle, aspect: a.v })}>{a.label}</button>
          ))}
          <span className="cve-toolbar-sep" />
          <button type="button" className="cve-toolbar-btn" onClick={() => onImgReplace(null)} title="从中转站/相册换图">换图</button>
        </div>
      )}

      {showRawImg && (
        <div className="cve-toolbar-row cve-toolbar-row--ctx" onPointerDown={toolbarRowGuard}>
          <span className="cve-toolbar-label">图片</span>
          {IMG_WIDTH_CHOICES.map((w) => (
            <button key={w} type="button" className="cve-toolbar-btn" onClick={() => onRawImgStyle({ widthPct: w })}>{w}%</button>
          ))}
          <span className="cve-toolbar-sep" />
          {IMG_RADIUS_CHOICES.map((r) => (
            <button key={r.v} type="button" className="cve-toolbar-btn" onClick={() => onRawImgStyle({ radius: r.v })}>{r.label}</button>
          ))}
          <span className="cve-toolbar-sep" />
          <button type="button" className="cve-toolbar-btn" onClick={() => onImgReplace(activeRawImgIndex)} title="替换这张图">换图</button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 单个块的外层包裹：选中态/hover 态边框、浮动工具条定位、按 kind/type 派发到具体渲染
// ---------------------------------------------------------------------------
function BlockWrapper({
  block, index, total, selected, styleBlock, accent, bodyStyle, activeRawImgIndex,
  onSelect, onMoveUp, onMoveDown, onDuplicate, onDelete,
  onChangeStyle, onChangeAccent, onInsertParaAfter, onImageClick,
  onCommitContent, onCommitCaption, onParaTransient, onParaCommit,
  onRawTransient, onRawCommit, onSelectRawImg,
  onSplitRaw, onImgStyle, onRawImgStyle, onImgReplace, toolbarAnchor,
}) {
  // 浮动锚点存在时垂直跟随光标（flip 由锚点视口位置定）；否则回退默认：首块钉块下方防裁,其余块上方
  const anchored = toolbarAnchor != null;
  const flip = anchored ? toolbarAnchor.flip : index === 0;
  const bodyRef = React.useRef(null); // 文字样式命令的选区作用域校验用（execCommand 宿主）

  // 把手按下即交给指针拖拽引擎；preventDefault 挡住"按下把手被当成点进相邻可编辑区"的文字光标，
  // 把手本身没有点击语义，吞掉 click 无副作用。
  const handleHandlePointerDown = (e) => {
    e.preventDefault();
    beginDrag(e, { kind: 'canvas-block', data: { uid: block.uid }, ghostLabel: '移动到目标位置…' });
  };

  function renderBody() {
    if (block.kind === 'para') {
      return <ParaView block={block} bodyStyle={bodyStyle} onTransient={onParaTransient} onCommit={onParaCommit} />;
    }
    if (block.kind === 'raw') {
      return (
        <RawView
          block={block}
          activeImgIndex={activeRawImgIndex}
          onTransient={onRawTransient}
          onCommit={onRawCommit}
          onSelectImg={onSelectRawImg}
        />
      );
    }
    if (!styleBlock) {
      return <div className="cve-block-error">样式块缺失（id：{block.blockId || '未设置'}）</div>;
    }
    if (block.type === 'divider') {
      return <DividerView styleBlock={styleBlock} accent={accent} />;
    }
    if (block.type === 'imageCard') {
      return (
        <ImageCardView
          block={block}
          styleBlock={styleBlock}
          accent={accent}
          onImageClick={onImageClick}
          onCommitCaption={onCommitCaption}
        />
      );
    }
    return <StyledSlotView block={block} styleBlock={styleBlock} accent={accent} onCommitContent={onCommitContent} />;
  }

  return (
    <div
      className={`cve-block${selected ? ' cve-block--selected' : ''}`}
      data-cve-uid={block.uid}
      onClick={(e) => { e.stopPropagation(); onSelect(); }}
    >
      <div
        className="cve-drag-handle"
        onPointerDown={handleHandlePointerDown}
        title="拖拽排序"
        aria-label="拖拽排序"
      >
        ⠿
      </div>
      {selected && (
        <BlockToolbar
          key={block.uid}
          block={block}
          index={index}
          total={total}
          styleBlock={styleBlock}
          flip={flip}
          anchorTop={anchored ? toolbarAnchor.top : null}
          getHostEl={() => bodyRef.current}
          activeRawImgIndex={activeRawImgIndex}
          onMoveUp={onMoveUp}
          onMoveDown={onMoveDown}
          onDuplicate={onDuplicate}
          onDelete={onDelete}
          onChangeStyle={onChangeStyle}
          onChangeAccent={onChangeAccent}
          onInsertParaAfter={onInsertParaAfter}
          onSplitRaw={onSplitRaw}
          onImgStyle={onImgStyle}
          onRawImgStyle={onRawImgStyle}
          onImgReplace={onImgReplace}
        />
      )}
      <div className="cve-block-body" ref={bodyRef}>{renderBody()}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 画布主组件
// ---------------------------------------------------------------------------
function CanvasEditor({
  doc,
  onChange = () => {},
  selectedUid = null,
  onSelect = () => {},
  blocksById,
  globalAccent = null,
  bodyConfig,
  onRequestStylePicker = () => {},
  onRequestImagePick = () => {}, // (uid, imgIndex?)：imgIndex 非空=raw 块内第 N 张图换图
  onExternalDrop = () => {},
  onNotify = () => {}, // (type, message)：画布内需要轻提示时回调（如拆分失败），父组件接 Toast
}, ref) {
  const canvasRef = React.useRef(null);
  const list = Array.isArray(doc) ? doc : [];

  // 最近一次 raw 块内的光标位置：{ uid, range }。用于"容器内点击插入样式元素"——
  // 点击左侧样式库会夺走 raw 编辑区的焦点使选区塌缩，故提前在此缓存 Range，插入时用缓存值。
  const lastRawCaretRef = React.useRef(null);

  // raw 块内当前选中的图片：{ uid, imgIndex } | null。选中块变化/点击非图片处清除
  const [activeRawImg, setActiveRawImg] = React.useState(null);
  React.useEffect(() => {
    if (!activeRawImg) return;
    if (activeRawImg.uid !== selectedUid) setActiveRawImg(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedUid]);

  // 浮动工具条锚点：{ top, flip } | null。top=工具条相对选中块顶部的 px 偏移，flip=放锚点下方。
  // 长容器里工具条不再钉块顶（改块下方内容时够不到），而是跟随光标/选区/选中图片的垂直位置。
  // null=尚未编辑（回退默认块顶定位，第一行结构按钮可见）。
  const [toolbarAnchor, setToolbarAnchor] = React.useState(null);
  const toolbarRafRef = React.useRef(null);

  const recomputeToolbarAnchor = React.useCallback(() => {
    const canvas = canvasRef.current;
    if (!selectedUid || !canvas) { setToolbarAnchor(null); return; }
    const blockEl = canvas.querySelector(`[data-cve-uid="${selectedUid}"]`);
    if (!blockEl) { setToolbarAnchor(null); return; }
    const blockRect = blockEl.getBoundingClientRect();

    let anchorViewTop = null;
    // 1) raw 图片选中优先：锚到该图片
    if (activeRawImg && activeRawImg.uid === selectedUid) {
      const img = blockEl.querySelectorAll('.cve-raw-host img')[activeRawImg.imgIndex];
      if (img) anchorViewTop = img.getBoundingClientRect().top;
    }
    // 2) 选区（含折叠光标）在本块内：锚到选区顶部
    if (anchorViewTop == null) {
      const sel = window.getSelection && window.getSelection();
      if (sel && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        if (blockEl.contains(range.commonAncestorContainer)) {
          let rect = range.getBoundingClientRect();
          if (!rect || (!rect.top && !rect.height)) {
            // 折叠光标在部分浏览器 rect 全 0，退回起点元素的 rect
            const node = range.startContainer;
            const el = node && (node.nodeType === 1 ? node : node.parentElement);
            if (el) rect = el.getBoundingClientRect();
          }
          if (rect && (rect.top || rect.height)) anchorViewTop = rect.top;
        }
      }
    }
    if (anchorViewTop == null) { setToolbarAnchor(null); return; }
    // 锚点离视口顶部不足（页头 ~70 + 两行工具条 ~90）则翻到锚点下方，避免被裁
    const flip = anchorViewTop < 170;
    setToolbarAnchor({ top: anchorViewTop - blockRect.top, flip });
  }, [selectedUid, activeRawImg]);

  // 选区落在某个 raw 块内时,缓存其 uid+Range（点样式库前的最后一次光标位置）
  const captureRawCaret = React.useCallback(() => {
    const sel = window.getSelection && window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    const node = range.commonAncestorContainer;
    const el = node && (node.nodeType === 1 ? node : node.parentElement);
    const rawHost = el && el.closest && el.closest('.cve-raw-host');
    if (!rawHost) return;
    const blockEl = rawHost.closest('[data-cve-uid]');
    if (!blockEl) return;
    lastRawCaretRef.current = { uid: blockEl.getAttribute('data-cve-uid'), range: range.cloneRange() };
  }, []);

  // 选区变化时重算工具条锚点 + 缓存 raw 光标（rAF 合并高频 selectionchange，避免打字每字符 setState 抖动）
  React.useEffect(() => {
    const schedule = () => {
      captureRawCaret();
      if (toolbarRafRef.current != null) return;
      toolbarRafRef.current = requestAnimationFrame(() => {
        toolbarRafRef.current = null;
        recomputeToolbarAnchor();
      });
    };
    recomputeToolbarAnchor();
    document.addEventListener('selectionchange', schedule);
    return () => {
      document.removeEventListener('selectionchange', schedule);
      if (toolbarRafRef.current != null) { cancelAnimationFrame(toolbarRafRef.current); toolbarRafRef.current = null; }
    };
  }, [recomputeToolbarAnchor, captureRawCaret]);

  // 拖拽插入指示线状态：{ index, top } | null。index 是"插到 list 的哪个下标"，
  // top 是指示线相对画布外边框的像素偏移（渲染用）。两者一起算，一起清。
  const [dropIndicator, setDropIndicator] = React.useState(null);
  // 指针移动节流：一帧内只重算一次 rect（rAF），但要用最新鼠标 Y——每次 onMove 先把 Y 存进 ref，
  // 真正挂起的 rAF 回调执行时读 ref 最新值，不会因为节流丢新坐标。
  const dragRafRef = React.useRef(null);
  const pendingClientYRef = React.useRef(0);
  // drop zone 只在挂载时注册一次，回调经由该 ref 读取每次渲染的最新 props/doc，避免闭包吃到旧值
  const latestRef = React.useRef(null);

  const updateBlock = React.useCallback((uid, patch, opts) => {
    const next = list.map((b) => (b.uid === uid ? { ...b, ...patch } : b));
    onChange(next, opts);
  }, [list, onChange]);

  const moveBlock = React.useCallback((uid, dir) => {
    const idx = list.findIndex((b) => b.uid === uid);
    if (idx < 0) return;
    const swapIdx = idx + dir;
    if (swapIdx < 0 || swapIdx >= list.length) return; // 边界处理交给工具条按钮的 disabled 态，这里兜底
    const next = list.slice();
    const tmp = next[idx];
    next[idx] = next[swapIdx];
    next[swapIdx] = tmp;
    onChange(next);
  }, [list, onChange]);

  const duplicateBlock = React.useCallback((uid) => {
    const idx = list.findIndex((b) => b.uid === uid);
    if (idx < 0) return;
    const clone = cloneBlockWithNewUid(list[idx]);
    const next = list.slice();
    next.splice(idx + 1, 0, clone);
    onChange(next);
    onSelect(clone.uid);
  }, [list, onChange, onSelect]);

  const deleteBlock = React.useCallback((uid) => {
    const next = list.filter((b) => b.uid !== uid);
    onChange(next);
    if (selectedUid === uid) onSelect(null);
  }, [list, onChange, selectedUid, onSelect]);

  const insertParaAfter = React.useCallback((uid) => {
    const idx = list.findIndex((b) => b.uid === uid);
    const block = { uid: makeUid(), kind: 'para', html: '' };
    const next = list.slice();
    next.splice(idx < 0 ? next.length : idx + 1, 0, block);
    onChange(next);
    onSelect(block.uid);
  }, [list, onChange, onSelect]);

  const changeAccent = React.useCallback((uid, hex) => {
    updateBlock(uid, { accent: hex });
  }, [updateBlock]);

  // raw 容器拆分：顶层子元素各自成块（单容器自动下钻），替换原块并选中第一个新块。
  // 拆不开（单叶子元素）不改 doc，只轻提示——用户诉求是"把误合成一个容器的多个元素提出来"。
  const splitRaw = React.useCallback((uid) => {
    const idx = list.findIndex((b) => b.uid === uid);
    if (idx < 0) return;
    const parts = splitRawHtml(list[idx].html || '');
    if (!Array.isArray(parts) || parts.length < 2) {
      onNotify('info', '这个容器已是最小单元，拆不出更多元素');
      return;
    }
    const newBlocks = parts.map((html) => ({ uid: makeUid(), kind: 'raw', html }));
    const next = list.slice();
    next.splice(idx, 1, ...newBlocks);
    onChange(next);
    onSelect(newBlocks[0].uid);
    setActiveRawImg(null);
    onNotify('success', `已拆分为 ${newBlocks.length} 个元素`);
  }, [list, onChange, onSelect, onNotify]);

  // imageCard 的图片样式（宽度/圆角/裁切）：存块级 imgStyle 字段，画布与导出各自渲染
  const setImgStyle = React.useCallback((uid, imgStyle) => {
    updateBlock(uid, { imgStyle });
  }, [updateBlock]);

  // raw 块内选中图片的样式：直接改写 html 里该 img 的内联 style
  const setRawImgStyle = React.useCallback((uid, imgIndex, styleObj) => {
    const block = list.find((b) => b.uid === uid);
    if (!block) return;
    updateBlock(uid, { html: applyRawImgStyle(block.html || '', imgIndex, styleObj) });
  }, [list, updateBlock]);

  // 空画布默认给一个 para，仅在挂载时兜底一次；用户之后主动删空画布不再强行补回，
  // 那是"当前没有内容"的合法状态，不是需要被纠正的异常。
  const didInitRef = React.useRef(false);
  React.useEffect(() => {
    if (didInitRef.current) return;
    didInitRef.current = true;
    if (list.length === 0) {
      const block = { uid: makeUid(), kind: 'para', html: '' };
      onChange([block]);
      onSelect(block.uid);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 选中块变化时滚动到可见区域（插入/复制/换样式后自动定位）
  React.useEffect(() => {
    if (!selectedUid) return;
    const el = canvasRef.current && canvasRef.current.querySelector(`[data-cve-uid="${selectedUid}"]`);
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selectedUid]);

  // 键盘：Backspace/Delete 仅在"有块被选中且当前不处于任何文本录入态"时删块；
  // 其它按键（含 ⌘Z/⌘⇧Z）一律不 preventDefault/不 stopPropagation，原样冒泡给父级处理撤销/重做。
  // 挂在 document 而非某个 DOM 节点上，是因为选中块后焦点可能停留在 document.body（wrapper 本身不可 focus），
  // 挂在画布内部节点会因为"事件只向上冒泡、不向下派发"而永远收不到。
  React.useEffect(() => {
    function handleKeyDown(e) {
      if (isTypingTarget(document.activeElement)) return;
      if (!selectedUid) return;
      if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();
        deleteBlock(selectedUid);
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [selectedUid, deleteBlock]);

  const handleCanvasClick = (e) => {
    if (e.target === canvasRef.current) onSelect(null);
  };

  // 每次渲染刷新 ref，drop zone 回调永远读到最新的 doc 与回调 props
  latestRef.current = { list, onChange, onSelect, onExternalDrop, selectedUid };

  // 向父组件暴露命令式能力：把一段样式元素 HTML 插入到"当前选中 raw 容器"的光标处（嵌套）。
  // 成功返回 true（父组件据此不再新建顶层块），无有效 raw 光标返回 false（父组件回退新块）。
  React.useImperativeHandle(ref, () => ({
    insertIntoRawCaret(html) {
      const cap = lastRawCaretRef.current;
      const latest = latestRef.current;
      if (!cap || !latest || !html) return false;
      if (cap.uid !== latest.selectedUid) return false; // 光标块必须就是当前选中块，防跨块误插
      const canvas = canvasRef.current;
      const blockEl = canvas && canvas.querySelector(`[data-cve-uid="${cap.uid}"]`);
      const rawHost = blockEl && blockEl.querySelector('.cve-raw-host');
      if (!rawHost || !rawHost.contains(cap.range.commonAncestorContainer)) return false; // 光标节点已不在该容器内
      const tmp = document.createElement('div');
      tmp.innerHTML = String(html);
      const frag = document.createDocumentFragment();
      while (tmp.firstChild) frag.appendChild(tmp.firstChild);
      const range = cap.range;
      range.deleteContents();
      range.insertNode(frag);
      // 直接改了 rawHost 的 DOM，读回 innerHTML 走 sanitizeRawHtml 提交（与 RawView 失焦提交同源）
      const next = latest.list.map((b) => (b.uid === cap.uid ? { ...b, html: sanitizeRawHtml(rawHost.innerHTML) } : b));
      latest.onChange(next);
      return true;
    },
  }), []);

  // 把画布注册为指针拖拽引擎的 drop zone：onMove 算指示线（rAF 节流），onDrop 按松手坐标重算
  // 插入位置（不依赖节流缓存的指示线 state，最后一帧可能未落地）。只注册一次，卸载时注销。
  React.useEffect(() => {
    const el = canvasRef.current;
    if (!el) return undefined;

    const cancelPendingFrame = () => {
      if (dragRafRef.current != null) {
        cancelAnimationFrame(dragRafRef.current);
        dragRafRef.current = null;
      }
    };

    const unregister = registerDropZone(el, {
      onMove: (pt) => {
        pendingClientYRef.current = pt.y;
        if (dragRafRef.current != null) return;
        dragRafRef.current = requestAnimationFrame(() => {
          dragRafRef.current = null;
          const canvas = canvasRef.current;
          if (!canvas) return;
          const canvasRect = canvas.getBoundingClientRect();
          const blockEls = Array.from(canvas.querySelectorAll(':scope > .cve-block'));
          setDropIndicator(computeDropTarget(pendingClientYRef.current, blockEls, canvasRect.top));
        });
      },
      onLeave: () => {
        cancelPendingFrame();
        setDropIndicator(null);
      },
      onDrop: (pt, payload) => {
        cancelPendingFrame();
        setDropIndicator(null);
        const latest = latestRef.current;
        if (!latest || !payload) return;
        const curList = latest.list;
        const canvas = canvasRef.current;
        let insertIndex = curList.length;
        if (canvas) {
          const blockEls = Array.from(canvas.querySelectorAll(':scope > .cve-block'));
          const target = computeDropTarget(pt.y, blockEls, canvas.getBoundingClientRect().top);
          if (target) insertIndex = target.index;
        }

        if (payload.kind === 'style-block' || payload.kind === 'photo-item') {
          // 外部拖入统一转发 {kind, data}：样式块 data={type,blockId}，照片 data=photo 对象，
          // 具体如何转成 DocBlock 由父组件按 kind 分支决定
          if (payload.data) latest.onExternalDrop({ kind: payload.kind, data: payload.data }, insertIndex);
          return;
        }
        if (payload.kind !== 'canvas-block' || !payload.data || !payload.data.uid) return;
        // 画布内部排序：先按原下标移除，若原下标在插入点之前则插入点要减一（数组少了一格），
        // 落回原位（toIdx === fromIdx）视为无操作，不产生新的 doc 引用。
        const fromIdx = curList.findIndex((b) => b.uid === payload.data.uid);
        if (fromIdx < 0) return;
        const toIdx = fromIdx < insertIndex ? insertIndex - 1 : insertIndex;
        if (toIdx === fromIdx) return;
        const next = curList.slice();
        const [moved] = next.splice(fromIdx, 1);
        next.splice(toIdx, 0, moved);
        latest.onChange(next);
        latest.onSelect(payload.data.uid); // 拖拽重排后保持该块选中
      },
    });
    return unregister;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className="cve-canvas"
      ref={canvasRef}
      onClick={handleCanvasClick}
      onDragStart={(e) => e.preventDefault()}
    >
      {list.length === 0 && <div className="cve-empty-hint">从左侧样式库点击插入第一个块</div>}
      {dropIndicator && (
        <div className="cve-drop-indicator" style={{ top: dropIndicator.top }} />
      )}
      {list.map((block, idx) => {
        const styleBlock = block.kind === 'styled' ? resolveStyleBlock(blocksById, block) : null;
        const accent = block.accent || globalAccent || '#1a1a1a';
        return (
          <BlockWrapper
            key={block.uid}
            block={block}
            index={idx}
            total={list.length}
            selected={block.uid === selectedUid}
            styleBlock={styleBlock}
            accent={accent}
            bodyStyle={computeParaStyle(bodyConfig, globalAccent)}
            activeRawImgIndex={activeRawImg && activeRawImg.uid === block.uid ? activeRawImg.imgIndex : null}
            toolbarAnchor={block.uid === selectedUid ? toolbarAnchor : null}
            onSelect={() => onSelect(block.uid)}
            onMoveUp={() => moveBlock(block.uid, -1)}
            onMoveDown={() => moveBlock(block.uid, 1)}
            onDuplicate={() => duplicateBlock(block.uid)}
            onDelete={() => deleteBlock(block.uid)}
            onChangeStyle={() => onRequestStylePicker(block.type, block.uid)}
            onChangeAccent={(hex) => changeAccent(block.uid, hex)}
            onInsertParaAfter={() => insertParaAfter(block.uid)}
            onImageClick={() => onRequestImagePick(block.uid)}
            onCommitContent={(text) => updateBlock(block.uid, { content: text })}
            onCommitCaption={(text) => updateBlock(block.uid, { caption: text })}
            onParaTransient={(html) => updateBlock(block.uid, { html }, { transient: true })}
            onParaCommit={(html) => updateBlock(block.uid, { html: sanitizeParaHtml(html) })}
            onRawTransient={(html) => updateBlock(block.uid, { html }, { transient: true })}
            onRawCommit={(html) => updateBlock(block.uid, { html: sanitizeRawHtml(html) })}
            onSelectRawImg={(imgIndex) => setActiveRawImg(imgIndex == null ? null : { uid: block.uid, imgIndex })}
            onSplitRaw={() => splitRaw(block.uid)}
            onImgStyle={(imgStyle) => setImgStyle(block.uid, imgStyle)}
            onRawImgStyle={(styleObj) => setRawImgStyle(block.uid, activeRawImg ? activeRawImg.imgIndex : 0, styleObj)}
            onImgReplace={(imgIndex) => onRequestImagePick(block.uid, imgIndex == null ? undefined : imgIndex)}
          />
        );
      })}
    </div>
  );
}

// forwardRef：父组件通过 ref.current.insertIntoRawCaret(html) 实现"容器内点击插入样式元素"
export default React.forwardRef(CanvasEditor);

// ---------------------------------------------------------------------------
// 接线方参考：CanvasEditor 的 props 用法（仅文档用途，不参与运行时逻辑）
// ---------------------------------------------------------------------------
export const CANVAS_EDITOR_USAGE = `
<CanvasEditor
  doc={doc}                                    // DocBlock[]，来自 docModel，父组件持有单一状态源
  onChange={(nextDoc, opts) => {
    setDoc(nextDoc);
    if (!opts || !opts.transient) history.push(nextDoc); // 仅非 transient 才入历史栈
  }}
  selectedUid={selectedUid}
  onSelect={(uid) => setSelectedUid(uid)}
  blocksById={mergedBlocksById}                 // 内置块 + 组织提取块合并后的索引（同 themes.js 用法）
  globalAccent={currentPreset.accent}
  bodyConfig={currentPreset.body}
  onRequestStylePicker={(type, uid) => openLibrary({ filterType: type, replaceTarget: uid })}
  onRequestImagePick={(uid) => openPhotoPicker(uid)}
  onExternalDrop={(payload, insertIndex) => {
    // payload = { kind: 'style-block'|'photo-item', data }，data 是拖拽源 beginDrag 传入的原对象
    // （样式块 {type,blockId}，照片 {id,url,thumbUrl,description,...}）；本组件原样转发不解释字段，
    // 父组件按 kind 转成 DocBlock 插入 insertIndex。
    const block = externalPayloadToDocBlock(payload); // 父组件自行实现，不属于本组件契约
    const next = doc.slice();
    next.splice(insertIndex, 0, block);
    onChange(next);
    setSelectedUid(block.uid);
  }}
/>

行为要点：
- 结构性操作（插/删/移/复制/换样式/换色/拖拽重排/外部拖入）：onChange 不带 opts，父级应视为"提交"并 push 历史栈。
- 段落打字过程：onChange(next, { transient: true })，父级只更新 doc、不 push 历史；失焦时补一次非 transient 提交。
- 样式块文字（h2/h3/quote/signoff/imageCard 图注）不产生 transient 调用，只在失焦时提交一次。
- 换样式/换图不由本组件完成，仅转发 onRequestStylePicker/onRequestImagePick，实际替换由父组件回填 doc。
- 拖拽统一走 pointerDrag.js 自研引擎（非 HTML5 DnD）：拖拽源在 onPointerDown 里调 beginDrag(e, { kind, data, ghostLabel })，
  画布已把自身注册为 drop zone。外部样式块用 kind='style-block'，落点转发 onExternalDrop(data, insertIndex)，
  父组件需自行转成 DocBlock（含 makeUid()）后插入并 onSelect 新块。
- 画布内部块拖拽重排（拖拽把手 .cve-drag-handle，kind='canvas-block'）完全由本组件闭环完成，
  父组件只会收到一次结构性 onChange，不涉及 onExternalDrop。
- kind='raw' 块（整文导入产物）：整块 contentEditable 富文本改字，失焦提交时经 sanitizeRawHtml 清洗；
  不支持换样式/换色，其余工具条操作（移动/复制/删除/后插段落）与普通块一致。
- 画布不持有历史栈，⌘Z/⌘⇧Z 不被拦截，父组件需自行在 document 级别监听撤销/重做快捷键。
`;
