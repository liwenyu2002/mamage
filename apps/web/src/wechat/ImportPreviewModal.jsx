// 推文导入预览层：整篇文章逐块渲染 + 块选择（单击 toggle / 框选批量）+ 双击原地编辑。
// 契约：/private/tmp/claude-501/-Users-liwenyu/f413e1a5-8f0f-436d-b775-8c9faffa99f1/scratchpad/composer-v4-contracts.md 第 4 节
// 约束：不改 WechatComposer.jsx/CanvasEditor.jsx/pointerDrag.js/themes.js/docModel.js/composer.css；本层完全自持状态与样式。
//
// 交互状态机（三态，同一时刻只处于一态）：
// - 普通态：默认。滚动区 pointerdown 落在块上且未过 5px 阈值 → 单击 toggle；落空/拖动 → 进框选态。
// - 编辑态：普通态下双击某块 → 进入；该块 contentEditable，写回 localBlocks。失焦(blur)提交并回普通态；
//   编辑态块内部的 pointerdown 直接 return（不 toggle 不进框选）；pointerdown 落在其它块上先 commitEdit 再按普通态处理。
// - 框选态：普通态 pointerdown 后 move 超 5px 阈值 → 进入；rAF 节流用容器相对坐标算相交块预高亮；
//   pointerup 定案（Alt=从选中里减，否则并入选中）回普通态；pointercancel 或 Esc（框选中优先响应）丢弃预案回普通态。
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import DOMPurify from 'dompurify';
import './importPreview.css';

const SANITIZE_CONFIG = { FORBID_TAGS: ['script', 'style', 'iframe'], ADD_ATTR: ['style', 'referrerpolicy'] };
const DRAG_THRESHOLD_PX = 5;
const DOUBLE_CLICK_WINDOW_MS = 400;

function rectsIntersect(a, b) {
  return a.left < b.left + b.width && a.left + a.width > b.left && a.top < b.top + b.height && a.top + a.height > b.top;
}

function ImportPreviewModal({ visible, result, canvasHasContent, onCancel, onImport }) {
  const [localBlocks, setLocalBlocks] = useState([]);
  const [selected, setSelected] = useState(() => new Set());
  const [editingIndex, setEditingIndex] = useState(null);
  const [isDragSelecting, setIsDragSelecting] = useState(false);
  const [rubberRect, setRubberRect] = useState(null);
  const [preSelected, setPreSelected] = useState(() => new Set());

  const scrollRef = useRef(null);
  const blockRefs = useRef([]); // 指向每块外层 wrapper，用于矩形相交判定与 data-index 查找
  const editBodyRef = useRef(null); // 指向当前编辑态块的 contentEditable 内层节点（同一时刻至多一个）
  const pointerStateRef = useRef({ down: false });
  const pendingPointRef = useRef(null);
  const rafRef = useRef(null);
  const preSelectedRef = useRef(new Set());
  const lastClickRef = useRef({ index: null, time: 0 });
  const lastResultRef = useRef(null);
  // editingIndex 的 ref 镜像：Esc 全局监听里要同步读"是否正在编辑某块"，state 闭包会滞后
  const editingIndexRef = useRef(null);
  editingIndexRef.current = editingIndex;

  // visible=true 且 result 引用变化时重置全部内部状态（同一 result 反复开合不重置，保留本地编辑）
  useEffect(() => {
    if (visible && result && lastResultRef.current !== result) {
      lastResultRef.current = result;
      const blocks = Array.isArray(result.blocks) ? result.blocks.slice() : [];
      setLocalBlocks(blocks);
      setSelected(new Set(blocks.map((_, i) => i)));
      setEditingIndex(null);
      setIsDragSelecting(false);
      setRubberRect(null);
      setPreSelected(new Set());
      preSelectedRef.current = new Set();
      pointerStateRef.current = { down: false };
      lastClickRef.current = { index: null, time: 0 };
      blockRefs.current = [];
    }
  }, [visible, result]);

  useEffect(() => () => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
  }, []);

  // 长文可能十几张 mmbiz 大图，一次性全量加载会拖慢预览首屏——给每张 img 补 loading="lazy"
  // （后端属性白名单剥掉了原文的 loading）。标签级正则安全：img 无内容体。
  const sanitizedBlocks = useMemo(
    () => localBlocks.map((html) => {
      const clean = DOMPurify.sanitize(html || '', SANITIZE_CONFIG);
      return clean.replace(/<img\b(?![^>]*\bloading=)/gi, '<img loading="lazy"');
    }),
    [localBlocks],
  );

  function resetDragVisuals() {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    pendingPointRef.current = null;
    pointerStateRef.current = { down: false };
    setIsDragSelecting(false);
    setRubberRect(null);
    setPreSelected(new Set());
    preSelectedRef.current = new Set();
  }

  function commitEdit() {
    setEditingIndex((idx) => {
      if (idx == null) return null;
      const el = editBodyRef.current;
      if (el) {
        const html = el.innerHTML;
        setLocalBlocks((prev) => {
          const next = prev.slice();
          next[idx] = html;
          return next;
        });
      }
      editBodyRef.current = null;
      return null;
    });
  }

  function toggleIndex(idx) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }

  // 由指针 client 坐标同步算出当前框选矩形与相交块集合。
  // 抽成独立函数是因为 pointerup 定案必须同步调用它——rAF 节流的预选集在快速拖放时
  // 可能落后一帧（up 先于最后一次 rAF 回调到达），依赖缓存会漏掉框尾的块。
  const computeRubber = useCallback((clientX, clientY) => {
    const st = pointerStateRef.current;
    const container = scrollRef.current;
    if (!container) return null;
    const containerRect = container.getBoundingClientRect();
    const scrollLeft = container.scrollLeft;
    const scrollTop = container.scrollTop;
    const curX = clientX - containerRect.left + scrollLeft;
    const curY = clientY - containerRect.top + scrollTop;
    const rect = {
      left: Math.min(st.startContentX, curX),
      top: Math.min(st.startContentY, curY),
      width: Math.abs(curX - st.startContentX),
      height: Math.abs(curY - st.startContentY),
    };
    const hits = new Set();
    blockRefs.current.forEach((el, i) => {
      if (!el) return;
      const r = el.getBoundingClientRect();
      const bRect = {
        left: r.left - containerRect.left + scrollLeft,
        top: r.top - containerRect.top + scrollTop,
        width: r.width,
        height: r.height,
      };
      if (rectsIntersect(rect, bRect)) hits.add(i);
    });
    return { rect, hits };
  }, []);

  const performRecompute = useCallback(() => {
    rafRef.current = null;
    const st = pointerStateRef.current;
    const point = pendingPointRef.current;
    if (!st.down || !st.moved || !point) return;
    const result = computeRubber(point.clientX, point.clientY);
    if (!result) return;
    setRubberRect(result.rect);
    preSelectedRef.current = result.hits;
    setPreSelected(result.hits);
  }, [computeRubber]);

  function scheduleRecompute() {
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(performRecompute);
  }

  function handlePointerDown(e) {
    if (e.button !== 0) return;
    const container = scrollRef.current;
    if (!container) return;
    const blockEl = e.target.closest ? e.target.closest('.wxc-ipv-block') : null;
    const candidateIndex = blockEl ? Number(blockEl.dataset.index) : null;

    if (editingIndex != null) {
      if (candidateIndex === editingIndex) return; // 编辑态块内：交给原生 contentEditable，不 toggle 不框选
      commitEdit();
    }

    const containerRect = container.getBoundingClientRect();
    // 此处刻意不 setPointerCapture：capture 会把后续 click/dblclick 一并 retarget 到容器，
    // 块上的 onDoubleClick（进入编辑态）就永远收不到——capture 延迟到真正进入框选时再做
    pointerStateRef.current = {
      down: true,
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startContentX: e.clientX - containerRect.left + container.scrollLeft,
      startContentY: e.clientY - containerRect.top + container.scrollTop,
      candidateIndex,
      moved: false,
    };
  }

  function handlePointerMove(e) {
    const st = pointerStateRef.current;
    if (!st.down) return;
    const dx = e.clientX - st.startClientX;
    const dy = e.clientY - st.startClientY;
    if (!st.moved && Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) {
      st.moved = true;
      setIsDragSelecting(true);
      // 进入框选才 capture：保证拖出容器边界仍收到 move/up；单击与双击路径不 capture，
      // 否则 click/dblclick 被 retarget 到容器、块级双击编辑失效
      const container = scrollRef.current;
      if (container && container.setPointerCapture) {
        try { container.setPointerCapture(e.pointerId); } catch (err) { /* jsdom 等无此 API */ }
      }
    }
    if (st.moved) {
      pendingPointRef.current = { clientX: e.clientX, clientY: e.clientY, altKey: e.altKey };
      scheduleRecompute();
    }
  }

  function handlePointerUp(e) {
    const st = pointerStateRef.current;
    if (!st.down) return;
    const container = scrollRef.current;
    if (container && container.hasPointerCapture && container.hasPointerCapture(e.pointerId)) {
      container.releasePointerCapture(e.pointerId);
    }
    if (st.moved) {
      const alt = e.altKey;
      // 定案同步重算，不用 rAF 缓存的 preSelectedRef——快速拖放时 up 会先于最后一帧 rAF 到达
      const result = computeRubber(e.clientX, e.clientY);
      const hits = result ? result.hits : preSelectedRef.current;
      setSelected((prev) => {
        const next = new Set(prev);
        hits.forEach((i) => {
          if (alt) next.delete(i);
          else next.add(i);
        });
        return next;
      });
      resetDragVisuals();
    } else {
      const idx = st.candidateIndex;
      pointerStateRef.current = { down: false };
      if (idx != null) {
        const now = Date.now();
        const last = lastClickRef.current;
        const isSecondOfDouble = last.index === idx && now - last.time < DOUBLE_CLICK_WINDOW_MS;
        if (!isSecondOfDouble) toggleIndex(idx);
        lastClickRef.current = { index: idx, time: now };
      }
    }
  }

  function handlePointerCancel() {
    if (!pointerStateRef.current.down) return;
    resetDragVisuals();
  }

  function handleBlockDoubleClick(idx) {
    if (editingIndex === idx) return;
    if (editingIndex != null) commitEdit();
    setEditingIndex(idx);
  }

  // 编辑态挂载时一次性灌入 sanitize 后的 html 并聚焦；此后不再受 dangerouslySetInnerHTML 控制，
  // 避免 React 重渲染打字过程中的光标位置
  useEffect(() => {
    if (editingIndex == null) return;
    const el = editBodyRef.current;
    if (!el) return;
    el.innerHTML = sanitizedBlocks[editingIndex] || '';
    el.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingIndex]);

  useEffect(() => {
    if (!visible) return undefined;
    function onKeyDown(e) {
      if (e.key !== 'Escape') return;
      const st = pointerStateRef.current;
      if (st.down && st.moved) {
        resetDragVisuals();
        return;
      }
      // 编辑态优先：Esc 只退出当前块编辑并提交，不关整个预览层（否则辛苦改的字连同框选全丢）
      if (editingIndexRef.current != null) {
        commitEdit();
        return;
      }
      onCancel();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, onCancel]);

  function selectAll() {
    setSelected(new Set(localBlocks.map((_, i) => i)));
  }
  function clearAll() {
    setSelected(new Set());
  }
  function invertAll() {
    setSelected((prev) => {
      const next = new Set();
      localBlocks.forEach((_, i) => {
        if (!prev.has(i)) next.add(i);
      });
      return next;
    });
  }

  function handleImportClick(mode) {
    const orderedSelected = localBlocks.filter((_, i) => selected.has(i));
    onImport(orderedSelected, mode);
  }

  if (!visible) return null;

  const total = localBlocks.length;
  const imageCount = result && typeof result.imageCount === 'number' ? result.imageCount : 0;

  return createPortal(
    <div className="wxc-ipv-mask">
      <div className="wxc-ipv-panel" role="dialog" aria-modal="true">
        <div className="wxc-ipv-header">
          <div className="wxc-ipv-header-main">
            <div className="wxc-ipv-title">{(result && result.title) || '未命名文章'}</div>
            <div className="wxc-ipv-meta">
              {result && result.author ? <span className="wxc-ipv-author">{result.author}</span> : null}
              <span className="wxc-ipv-stats">{total} 块 · {imageCount} 图</span>
            </div>
          </div>
          <button type="button" className="wxc-ipv-close" onClick={onCancel} aria-label="关闭">×</button>
        </div>

        <div
          className={`wxc-ipv-scroll${isDragSelecting ? ' is-dragging' : ''}`}
          ref={scrollRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
          onDragStart={(e) => e.preventDefault()}
        >
          <div className="wxc-ipv-content">
            {localBlocks.map((_, idx) => {
              const isEditing = editingIndex === idx;
              const isSelected = selected.has(idx);
              const isPre = preSelected.has(idx);
              const cls = [
                'wxc-ipv-block',
                isSelected ? 'is-selected' : '',
                isEditing ? 'is-editing' : '',
                isPre ? 'is-preselect' : '',
              ].filter(Boolean).join(' ');
              return (
                // 注意：dangerouslySetInnerHTML 与 JSX children 不能共存于同一节点（React 会抛异常），
                // 故 html 内容单独放内层 body 节点，勾选角标作为 wrapper 的兄弟节点
                <div
                  key={idx}
                  data-index={idx}
                  className={cls}
                  ref={(el) => { blockRefs.current[idx] = el; }}
                  onDoubleClick={() => handleBlockDoubleClick(idx)}
                >
                  <div
                    className="wxc-ipv-block-body"
                    contentEditable={isEditing}
                    suppressContentEditableWarning={isEditing}
                    onBlur={isEditing ? commitEdit : undefined}
                    ref={(el) => { if (isEditing) editBodyRef.current = el; }}
                    dangerouslySetInnerHTML={isEditing ? undefined : { __html: sanitizedBlocks[idx] }}
                  />
                  {isSelected && !isEditing ? <span className="wxc-ipv-check">✓</span> : null}
                </div>
              );
            })}
            {rubberRect ? (
              <div
                className="wxc-ipv-rubber"
                style={{ left: rubberRect.left, top: rubberRect.top, width: rubberRect.width, height: rubberRect.height }}
              />
            ) : null}
          </div>
        </div>

        <div className="wxc-ipv-footer">
          <div className="wxc-ipv-footer-left">
            <span className="wxc-ipv-count">已选 {selected.size} / 共 {total} 块</span>
            <button type="button" className="wxc-ipv-btn wxc-ipv-btn-ghost" onClick={selectAll}>全选</button>
            <button type="button" className="wxc-ipv-btn wxc-ipv-btn-ghost" onClick={clearAll}>清空</button>
            <button type="button" className="wxc-ipv-btn wxc-ipv-btn-ghost" onClick={invertAll}>反选</button>
          </div>
          <div className="wxc-ipv-footer-right">
            <button type="button" className="wxc-ipv-btn wxc-ipv-btn-ghost" onClick={onCancel}>取消</button>
            {canvasHasContent ? (
              <>
                <button
                  type="button"
                  className="wxc-ipv-btn wxc-ipv-btn-primary"
                  disabled={selected.size === 0}
                  onClick={() => handleImportClick('replace')}
                >
                  替换画布
                </button>
                <button
                  type="button"
                  className="wxc-ipv-btn wxc-ipv-btn-secondary"
                  disabled={selected.size === 0}
                  onClick={() => handleImportClick('append')}
                >
                  追加到末尾
                </button>
              </>
            ) : (
              <button
                type="button"
                className="wxc-ipv-btn wxc-ipv-btn-primary"
                disabled={selected.size === 0}
                onClick={() => handleImportClick('replace')}
              >
                导入画布
              </button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export default ImportPreviewModal;
