// 同页拖拽的共享状态：dataTransfer 自定义 mime 在 dragover 阶段跨浏览器不可靠
// （Safari 可能丢失/改写自定义 type，getData 在 drop 前一律读不到），
// 排版器的拖拽全部发生在同一页面内，直接用模块级变量传递 payload 最稳。
// dataTransfer 仍然要 setData 一份（Firefox 需要非空数据才启动拖拽会话）。

let current = null; // { kind: 'style-block'|'canvas-block', data: object }

export function setDragPayload(kind, data) {
  current = { kind, data };
}

export function getDragPayload(kind) {
  if (!current) return null;
  if (kind && current.kind !== kind) return null;
  return current.data;
}

export function hasDragPayload() {
  return current !== null;
}

export function clearDragPayload() {
  current = null;
}
