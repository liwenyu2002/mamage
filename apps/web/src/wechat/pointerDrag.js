// 自研指针拖拽引擎：排版器内所有拖拽（样式库块拖入画布、画布块把手排序）统一走这里。
// 弃用 HTML5 原生 DnD 的原因：真实浏览器下 dragstart 是否触发受 draggable 祖先/内部 img 默认拖拽/
// 文本选区多方干扰，dragover 必须 preventDefault 才放行 drop 的"门"又无法被自动化验证，两轮返工
// 均无法在用户环境稳定复现——pointer 事件全程自控，没有这些隐式门槛。
// 约束：触屏（pointerType==='touch'）不启动拖拽，保持点击插入路径，避免与列表滚动手势冲突。

const DRAG_THRESHOLD_PX = 5;
// 指针贴近视口上下边缘时的自动滚动（仅在指针移动时步进；指针静止不动不会持续滚动，够用且实现最简）
const EDGE_SCROLL_ZONE_PX = 80;
const EDGE_SCROLL_STEP_PX = 24;

let zones = [];
let session = null;

/**
 * 注册一个 drop 区域。handlers: { onMove(point, payload), onLeave(), onDrop(point, payload) }。
 * point = { x, y }（client 坐标），payload = { kind, data }。返回注销函数。
 */
export function registerDropZone(el, handlers) {
  const zone = { el, handlers };
  zones.push(zone);
  return () => {
    zones = zones.filter((z) => z !== zone);
    if (session && session.activeZone === zone) session.activeZone = null;
  };
}

function findZoneAt(x, y) {
  // 后注册的优先（视觉上通常叠在上层）；当前只有画布一个 zone，此顺序仅为将来扩展保底
  for (let i = zones.length - 1; i >= 0; i -= 1) {
    const r = zones[i].el.getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return zones[i];
  }
  return null;
}

function makeGhost(label) {
  const el = document.createElement('div');
  el.className = 'wxc-drag-ghost';
  el.textContent = label || '拖拽中';
  document.body.appendChild(el);
  return el;
}

function positionGhost(ghost, x, y) {
  ghost.style.left = `${x + 14}px`;
  ghost.style.top = `${y + 10}px`;
}

function edgeAutoScroll(y) {
  if (y < EDGE_SCROLL_ZONE_PX) {
    window.scrollBy(0, -EDGE_SCROLL_STEP_PX);
  } else if (y > window.innerHeight - EDGE_SCROLL_ZONE_PX) {
    window.scrollBy(0, EDGE_SCROLL_STEP_PX);
  }
}

function teardown() {
  if (!session) return;
  const s = session;
  session = null;
  document.removeEventListener('pointermove', s.onMove);
  document.removeEventListener('pointerup', s.onUp);
  document.removeEventListener('pointercancel', s.onCancel);
  document.removeEventListener('keydown', s.onKey);
  if (s.ghost && s.ghost.parentNode) s.ghost.parentNode.removeChild(s.ghost);
  document.body.classList.remove('wxc-dragging');
  if (s.activeZone && s.activeZone.handlers.onLeave) s.activeZone.handlers.onLeave();
}

// 拖拽结束（pointerup）后浏览器仍会在拖拽源上派发一次 click——必须吞掉，
// 否则"拖入画布"会紧跟一次"点击插入"，同一个块进画布两份。
function suppressNextClick() {
  const suppress = (e) => {
    e.stopPropagation();
    e.preventDefault();
    document.removeEventListener('click', suppress, true);
  };
  document.addEventListener('click', suppress, true);
  // click 可能根本不来（松手位置不在任何可点元素上），下一轮宏任务后无条件拆除
  setTimeout(() => document.removeEventListener('click', suppress, true), 0);
}

/**
 * 在拖拽源的 onPointerDown 里调用。未超过移动阈值就松手＝普通点击，本引擎不做任何事、
 * 不拦截后续 click；超过阈值则进入拖拽态（幽灵标签跟随指针、命中 zone 通知 onMove/onDrop）。
 * Escape 取消本次拖拽。
 */
export function beginDrag(startEvent, { kind, data, ghostLabel }) {
  if (session) return;
  if (startEvent.pointerType === 'touch') return;
  if (startEvent.button !== 0) return;

  const startX = startEvent.clientX;
  const startY = startEvent.clientY;

  const s = {
    kind,
    data,
    ghost: null,
    activeZone: null,
    dragging: false,
    cancelled: false,
  };

  s.onMove = (e) => {
    if (s.cancelled) return;
    if (!s.dragging) {
      if (Math.abs(e.clientX - startX) < DRAG_THRESHOLD_PX && Math.abs(e.clientY - startY) < DRAG_THRESHOLD_PX) return;
      s.dragging = true;
      s.ghost = makeGhost(ghostLabel);
      document.body.classList.add('wxc-dragging');
      // 阈值前的微小移动可能已拉出文本选区，进入拖拽态时清掉，避免视觉上像在拖文字
      const sel = window.getSelection && window.getSelection();
      if (sel && sel.removeAllRanges) sel.removeAllRanges();
    }
    e.preventDefault();
    positionGhost(s.ghost, e.clientX, e.clientY);
    edgeAutoScroll(e.clientY);

    const zone = findZoneAt(e.clientX, e.clientY);
    if (zone !== s.activeZone) {
      if (s.activeZone && s.activeZone.handlers.onLeave) s.activeZone.handlers.onLeave();
      s.activeZone = zone;
    }
    if (zone && zone.handlers.onMove) {
      zone.handlers.onMove({ x: e.clientX, y: e.clientY }, { kind: s.kind, data: s.data });
    }
  };

  s.onUp = (e) => {
    const didDrag = s.dragging; // Escape 取消后依然要吞 click（用户意图是拖拽而非点击）
    const canDrop = s.dragging && !s.cancelled;
    const zone = canDrop ? findZoneAt(e.clientX, e.clientY) : null;
    teardown();
    if (didDrag) suppressNextClick();
    if (canDrop && zone && zone.handlers.onDrop) {
      zone.handlers.onDrop({ x: e.clientX, y: e.clientY }, { kind: s.kind, data: s.data });
    }
  };

  s.onCancel = () => teardown();

  s.onKey = (e) => {
    if (e.key !== 'Escape') return;
    // 标记 cancelled 而不是直接 teardown：松手前仍要吞掉后续 click（用户已表现出拖拽意图）
    s.cancelled = true;
    if (s.ghost && s.ghost.parentNode) s.ghost.parentNode.removeChild(s.ghost);
    s.ghost = null;
    document.body.classList.remove('wxc-dragging');
    if (s.activeZone && s.activeZone.handlers.onLeave) s.activeZone.handlers.onLeave();
    s.activeZone = null;
  };

  session = s;
  document.addEventListener('pointermove', s.onMove);
  document.addEventListener('pointerup', s.onUp);
  document.addEventListener('pointercancel', s.onCancel);
  document.addEventListener('keydown', s.onKey);
}
