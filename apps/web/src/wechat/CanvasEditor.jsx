// 公众号排版器 v3 画布编辑组件。契约：
// /private/tmp/claude-501/-Users-liwenyu/f413e1a5-8f0f-436d-b775-8c9faffa99f1/scratchpad/canvas-editor-contracts.md
// 约束：本文件对 doc 的所有结构性修改一律通过 onChange(nextDoc[, opts]) 交给调用方，自身不持有 doc 状态、
// 不做撤销/重做（历史栈是调用方 createHistory 的职责，这里只在 opts.transient 上如实标注"是否为打字中间态"）；
// 不改动 WechatComposer.jsx / themes.js / builtinBlocks*.js / wechatExport.js，样式渲染只经 applyBlock。
import React from 'react';
import { applyBlock, BUILTIN_BLOCKS_BY_ID, WECHAT_THEMES } from './themes.js';
import { makeUid, sanitizeParaHtml } from './docModel.js';
import { setDragPayload, getDragPayload, hasDragPayload, clearDragPayload } from './dragContext.js';
import './canvas.css';

// 占位 token 用于"先占位渲染整块模板，再把 content/caption 槽位换成可编辑 span"的两段式渲染——
// applyBlock 是纯字符串替换，不认识 contentEditable，槽位包装必须由本文件在渲染后手工处理。
// 用 \u0000 是因为它绝不会出现在正常文案里，且在 split/join 阶段就已被替换掉，不会真正进入 innerHTML。
const SLOT_TOKEN = '\u0000CVE_SLOT\u0000';

// 拖拽 mime type：外部样式块拖入 vs 画布内部块排序，两条 drop 路径共用同一条插入指示线逻辑，
// dragover 阶段只能读 dataTransfer.types（读不到 getData 的实际内容），靠 type 名区分走哪条分支。
const EXTERNAL_DND_TYPE = 'application/x-wxc-style-block';
const INTERNAL_DND_TYPE = 'application/x-cve-block';

function hasDndType(dataTransfer, type) {
  if (dataTransfer && dataTransfer.types && Array.from(dataTransfer.types).includes(type)) return true;
  // Safari 等浏览器在 dragover 阶段可能丢自定义 mime：退回共享拖拽上下文判断
  const kind = type === INTERNAL_DND_TYPE ? 'canvas-block' : 'style-block';
  return !!getDragPayload(kind);
}

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
  const html = React.useMemo(() => applyBlock(styleBlock, { accent }), [styleBlock, accent]);
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
    host.innerHTML = templateHtml.split(SLOT_TOKEN).join(slotHtml);
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
    host.innerHTML = templateHtml.split(SLOT_TOKEN).join(slotHtml);
    const slot = host.querySelector('[data-cve-slot="caption"]');
    if (slot) slot.contentEditable = 'true';
    const img = host.querySelector('img');
    // 内置模板规定图片一律不带 class（存活规则禁止 class=），这里赋值不存在覆盖冲突的风险
    if (img) img.className = 'cve-image-click-target';
  }, [templateHtml, block.caption]);

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
// 浮动块工具条：上移/下移/复制/删除/换样式/换色圆点(仅 accentEditable)/后插段落
// ---------------------------------------------------------------------------
function BlockToolbar({
  block, index, total, styleBlock, flip,
  onMoveUp, onMoveDown, onDuplicate, onDelete, onChangeStyle, onChangeAccent, onInsertParaAfter,
}) {
  const [swatchOpen, setSwatchOpen] = React.useState(false);
  const canChangeStyle = block.kind === 'styled';
  const canChangeAccent = block.kind === 'styled' && styleBlock && styleBlock.accentEditable === true;

  return (
    <div
      className={`cve-toolbar ${flip ? 'cve-toolbar--below' : 'cve-toolbar--above'}`}
      onClick={(e) => e.stopPropagation()}
    >
      <button type="button" className="cve-toolbar-btn" disabled={index === 0} onClick={onMoveUp} title="上移" aria-label="上移">↑</button>
      <button type="button" className="cve-toolbar-btn" disabled={index === total - 1} onClick={onMoveDown} title="下移" aria-label="下移">↓</button>
      <button type="button" className="cve-toolbar-btn" onClick={onDuplicate} title="复制" aria-label="复制">复制</button>
      <button type="button" className="cve-toolbar-btn" onClick={onDelete} title="删除" aria-label="删除">删除</button>
      {canChangeStyle && (
        <button type="button" className="cve-toolbar-btn" onClick={onChangeStyle} title="换样式" aria-label="换样式">样式</button>
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
  );
}

// ---------------------------------------------------------------------------
// 单个块的外层包裹：选中态/hover 态边框、浮动工具条定位、按 kind/type 派发到具体渲染
// ---------------------------------------------------------------------------
function BlockWrapper({
  block, index, total, selected, styleBlock, accent, bodyStyle,
  onSelect, onMoveUp, onMoveDown, onDuplicate, onDelete,
  onChangeStyle, onChangeAccent, onInsertParaAfter, onImageClick,
  onCommitContent, onCommitCaption, onParaTransient, onParaCommit,
  onDragHandleEnd,
}) {
  const flip = index === 0; // 首块工具条会被画布上沿裁掉，翻到块下方展示

  // 把手 mousedown 必须 preventDefault：块正文多是 contenteditable/输入框，若不挡住，
  // 按下把手会被浏览器当成"点进最近的可编辑区域"处理，出现文字光标而不是纯拖拽手势。
  const handleHandleMouseDown = (e) => {
    e.preventDefault();
  };

  const handleHandleDragStart = (e) => {
    e.dataTransfer.effectAllowed = 'move';
    setDragPayload('canvas-block', { uid: block.uid });
    try {
      e.dataTransfer.setData(INTERNAL_DND_TYPE, JSON.stringify({ uid: block.uid }));
      e.dataTransfer.setData('text/plain', 'cve-block');
    } catch (err) { /* 共享上下文已兜底 */ }
    const wrapperEl = e.currentTarget.parentElement; // 把手是 .cve-block 的第一个子节点，取父即整块
    if (wrapperEl && e.dataTransfer.setDragImage) {
      e.dataTransfer.setDragImage(wrapperEl, 20, 20);
    }
  };

  function renderBody() {
    if (block.kind === 'para') {
      return <ParaView block={block} bodyStyle={bodyStyle} onTransient={onParaTransient} onCommit={onParaCommit} />;
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
        draggable
        onMouseDown={handleHandleMouseDown}
        onDragStart={handleHandleDragStart}
        onDragEnd={() => clearDragPayload()}
        onDragEnd={onDragHandleEnd}
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
          onMoveUp={onMoveUp}
          onMoveDown={onMoveDown}
          onDuplicate={onDuplicate}
          onDelete={onDelete}
          onChangeStyle={onChangeStyle}
          onChangeAccent={onChangeAccent}
          onInsertParaAfter={onInsertParaAfter}
        />
      )}
      <div className="cve-block-body">{renderBody()}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 画布主组件
// ---------------------------------------------------------------------------
export default function CanvasEditor({
  doc,
  onChange = () => {},
  selectedUid = null,
  onSelect = () => {},
  blocksById,
  globalAccent = null,
  bodyConfig,
  onRequestStylePicker = () => {},
  onRequestImagePick = () => {},
  onExternalDrop = () => {},
}) {
  const canvasRef = React.useRef(null);
  const list = Array.isArray(doc) ? doc : [];

  // 拖拽插入指示线状态：{ index, top } | null。index 是"插到 list 的哪个下标"，
  // top 是指示线相对画布外边框的像素偏移（渲染用）。两者一起算，一起清。
  const [dropIndicator, setDropIndicator] = React.useState(null);
  // dragover 节流：一帧内只重算一次 rect（rAF），但要用最新鼠标 Y——每次 dragover 先把 Y 存进 ref，
  // 真正挂起的 rAF 回调执行时读 ref 最新值，不会因为节流丢新坐标。
  const dragRafRef = React.useRef(null);
  const pendingClientYRef = React.useRef(0);
  // dragenter/dragleave 会在"父→子"切换时先 leave 再 enter（子元素挡住父元素触发的假离开），
  // 用计数器而非单次 leave 判断是否真正离开画布，比较 relatedTarget 在部分浏览器下不可靠。
  const dragDepthRef = React.useRef(0);

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

  // 拖拽经过画布：外部样式块 or 内部块排序才 preventDefault（放行浏览器默认行为，非法拖拽不响应）；
  // rect 计算做 rAF 节流，避免 dragover 高频触发时每次都遍历全部块。
  const handleCanvasDragOver = (e) => {
    if (!hasDndType(e.dataTransfer, EXTERNAL_DND_TYPE) && !hasDndType(e.dataTransfer, INTERNAL_DND_TYPE)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    pendingClientYRef.current = e.clientY;
    if (dragRafRef.current != null) return;
    dragRafRef.current = requestAnimationFrame(() => {
      dragRafRef.current = null;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const canvasRect = canvas.getBoundingClientRect();
      const blockEls = Array.from(canvas.querySelectorAll(':scope > .cve-block'));
      setDropIndicator(computeDropTarget(pendingClientYRef.current, blockEls, canvasRect.top));
    });
  };

  const handleCanvasDragEnter = (e) => {
    if (!hasDndType(e.dataTransfer, EXTERNAL_DND_TYPE) && !hasDndType(e.dataTransfer, INTERNAL_DND_TYPE)) return;
    e.preventDefault();
    dragDepthRef.current += 1;
  };

  const handleCanvasDragLeave = (e) => {
    if (!hasDndType(e.dataTransfer, EXTERNAL_DND_TYPE) && !hasDndType(e.dataTransfer, INTERNAL_DND_TYPE)) return;
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setDropIndicator(null);
  };

  const handleCanvasDrop = (e) => {
    const external = hasDndType(e.dataTransfer, EXTERNAL_DND_TYPE);
    const internal = hasDndType(e.dataTransfer, INTERNAL_DND_TYPE);
    if (!external && !internal) return;
    e.preventDefault();
    dragDepthRef.current = 0;
    if (dragRafRef.current != null) {
      cancelAnimationFrame(dragRafRef.current);
      dragRafRef.current = null;
    }
    // 插入位置以 drop 事件自身坐标为准重算，不依赖 dragover 缓存的指示线 state——
    // rAF 节流下最后一帧可能未落地，缓存缺失时不能错落到末尾
    let insertIndex = list.length;
    const canvasEl = canvasRef.current;
    if (canvasEl) {
      const blockEls = [...canvasEl.querySelectorAll('.cve-block')];
      const target = computeDropTarget(e.clientY, blockEls, canvasEl.getBoundingClientRect().top);
      if (target) insertIndex = target.index;
    } else if (dropIndicator) {
      insertIndex = dropIndicator.index;
    }
    setDropIndicator(null);

    if (external) {
      const raw = e.dataTransfer.getData(EXTERNAL_DND_TYPE);
      let payload = null;
      try {
        payload = raw ? JSON.parse(raw) : null;
      } catch (err) {
        payload = null; // 外部拖入的 payload 解析失败一律丢弃，不让画布因脏数据崩溃
      }
      if (!payload) payload = getDragPayload('style-block'); // dataTransfer 读不到时回退共享上下文
      clearDragPayload();
      if (payload) onExternalDrop(payload, insertIndex);
      return;
    }

    // 画布内部排序：先按原下标移除，若原下标在插入点之前则插入点要减一（数组少了一格），
    // 落回原位（toIdx === fromIdx）视为无操作，不产生新的 doc 引用。
    const raw = e.dataTransfer.getData(INTERNAL_DND_TYPE);
    let data = null;
    try {
      data = raw ? JSON.parse(raw) : null;
    } catch (err) {
      data = null;
    }
    if (!data) data = getDragPayload('canvas-block');
    clearDragPayload();
    if (!data || !data.uid) return;
    const fromIdx = list.findIndex((b) => b.uid === data.uid);
    if (fromIdx < 0) return;
    const toIdx = fromIdx < insertIndex ? insertIndex - 1 : insertIndex;
    if (toIdx === fromIdx) return;
    const next = list.slice();
    const [moved] = next.splice(fromIdx, 1);
    next.splice(toIdx, 0, moved);
    onChange(next);
    onSelect(data.uid); // 拖拽重排后保持该块选中
  };

  const clearDropIndicator = React.useCallback(() => {
    dragDepthRef.current = 0;
    setDropIndicator(null);
  }, []);

  // 安全网：如果拖拽在画布外结束（用户松手位置不是合法 drop 目标），drop 事件不会触发，
  // 靠 window 级 dragend（会从拖拽源冒泡上来）兜底清除指示线，避免指示线卡死不消失。
  React.useEffect(() => {
    window.addEventListener('dragend', clearDropIndicator);
    return () => window.removeEventListener('dragend', clearDropIndicator);
  }, [clearDropIndicator]);

  return (
    <div
      className="cve-canvas"
      ref={canvasRef}
      onClick={handleCanvasClick}
      onDragEnter={handleCanvasDragEnter}
      onDragOver={handleCanvasDragOver}
      onDragLeave={handleCanvasDragLeave}
      onDrop={handleCanvasDrop}
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
            onDragHandleEnd={clearDropIndicator}
          />
        );
      })}
    </div>
  );
}

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
    // payload 是拖拽源用 JSON.stringify 塞进 dataTransfer('application/x-wxc-style-block') 的原始对象，
    // 本组件只负责 JSON.parse 后原样转发，不解释其字段；父组件按自己的样式库块结构解析并转成 DocBlock 插入 insertIndex。
    const block = styleLibraryPayloadToDocBlock(payload); // 父组件自行实现，不属于本组件契约
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
- 外部样式块拖入画布：本组件只做"识别 mime type + 算插入位置 + 转发"，不生成 DocBlock；onExternalDrop(payload, insertIndex)
  的 payload 就是拖拽源 setData('application/x-wxc-style-block', JSON.stringify(...)) 时塞的内容，父组件需自行转成 DocBlock
  （含 makeUid()）后插入 doc 的 insertIndex 位置并 onSelect 新块。
- 画布内部块拖拽重排（拖拽把手 .cve-drag-handle）完全由本组件闭环完成，父组件只会收到一次结构性 onChange，不涉及 onExternalDrop。
- 画布不持有历史栈，⌘Z/⌘⇧Z 不被拦截，父组件需自行在 document 级别监听撤销/重做快捷键。
`;
