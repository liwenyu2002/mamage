import { normalizeGeometry, rotatedSize, cropPixels } from '../../../server/lib/photo_tone/geometry.mjs';

export const ANNOTATION_COLORS = ['#d63b43', '#2468c9', '#23805f', '#16191c', '#ffffff'];
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const color = value => /^#[0-9a-f]{6}$/i.test(value || '') ? value : '#16191c';

function geometry(width, height, adjustments, uncropped = false) {
  const value = normalizeGeometry(adjustments), bounds = rotatedSize(width, height, value.rotation);
  return { angle: value.rotation * Math.PI / 180, bounds,
    area: cropPixels(bounds.width, bounds.height, uncropped ? null : value.crop) };
}

export function assertPersonalCanvasSize(width, height, adjustments) {
  const { area } = geometry(width, height, adjustments);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > 24000000
    || Math.max(width, height, area.width, area.height) > 16384 || area.width * area.height > 24000000) {
    throw new Error('编辑后的图片尺寸过大，请缩小裁切区域');
  }
  return area;
}

export function canvasToAnnotationPoint(point, width, height, adjustments) {
  const { angle, bounds, area } = geometry(width, height, adjustments);
  const x = point.x + area.left - bounds.width / 2, y = point.y + area.top - bounds.height / 2;
  return { x: (x * Math.cos(angle) + y * Math.sin(angle) + width / 2) / width,
    y: (-x * Math.sin(angle) + y * Math.cos(angle) + height / 2) / height };
}

export function annotationToCanvasPoint(point, width, height, adjustments, uncropped = false) {
  const { angle, bounds, area } = geometry(width, height, adjustments, uncropped);
  const x = point.x * width - width / 2, y = point.y * height - height / 2;
  return { x: x * Math.cos(angle) - y * Math.sin(angle) + bounds.width / 2 - area.left,
    y: x * Math.sin(angle) + y * Math.cos(angle) + bounds.height / 2 - area.top };
}

export function createPersonalAnnotation(kind, start, end, size, adjustments, style = {}) {
  if (!['rectangle', 'arrow', 'text', 'redact'].includes(kind)) throw new Error('标注类型无效');
  const { width, height } = size;
  const toSource = point => canvasToAnnotationPoint(point, width, height, adjustments);
  const text = String(style.text || '').trim().slice(0, 200);
  if (kind === 'text' ? !text : Math.hypot(end.x - start.x, end.y - start.y) < 4) return null;
  if (['rectangle', 'redact'].includes(kind) && (Math.abs(end.x - start.x) < 2 || Math.abs(end.y - start.y) < 2)) return null;
  const points = ['rectangle', 'redact'].includes(kind)
    ? [{ x: Math.min(start.x, end.x), y: Math.min(start.y, end.y) },
      { x: Math.max(start.x, end.x), y: Math.min(start.y, end.y) },
      { x: Math.max(start.x, end.x), y: Math.max(start.y, end.y) },
      { x: Math.min(start.x, end.x), y: Math.max(start.y, end.y) }]
    : kind === 'text' ? [start] : [start, end];
  return { id: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`, kind,
    points: points.map(toSource), color: kind === 'redact' ? (style.maskColor === '#ffffff' ? '#ffffff' : '#000000') : color(style.color),
    lineWidth: clamp(Number(style.lineWidth) || 3, 1, 12) / 600,
    fontSize: clamp(Number(style.fontSize) || 32, 12, 96) / 600,
    text: kind === 'text' ? text : '', angle: -normalizeGeometry(adjustments).rotation };
}

export function annotationEdit(state, next) {
  const current = state.annotations || [], past = state.annotationPast || [], future = state.annotationFuture || [];
  if (next === 'undo') return past.length ? { annotations: past.at(-1), annotationPast: past.slice(0, -1), annotationFuture: [current, ...future].slice(0, 30) } : state;
  if (next === 'redo') return future.length ? { annotations: future[0], annotationPast: [...past, current].slice(-30), annotationFuture: future.slice(1) } : state;
  if (!Array.isArray(next) || next.length > 100) throw new Error('每张图片最多支持 100 个标注');
  if (JSON.stringify(current) === JSON.stringify(next)) return state;
  return { annotations: next, annotationPast: [...past, current].slice(-30), annotationFuture: [] };
}

function projected(mark, size, adjustments, uncropped = false) {
  return mark.points.map(point => annotationToCanvasPoint(point, size.width, size.height, adjustments, uncropped));
}

function valid(mark) {
  const length = mark.kind === 'text' ? 1 : mark.kind === 'arrow' ? 2 : 4;
  return ['rectangle', 'arrow', 'text', 'redact'].includes(mark.kind) && Array.isArray(mark.points)
    && mark.points.length === length && mark.points.every(p => Number.isFinite(p.x) && Number.isFinite(p.y));
}

export function paintPersonalAnnotations(canvas, annotations = [], { width, height, adjustments = {}, uncropped = false }) {
  if (!annotations.length) return;
  if (annotations.length > 100 || annotations.some(mark => !valid(mark))) throw new Error('图片标注无效，未导出');
  const context = canvas.getContext('2d', { colorSpace: 'srgb' }), scale = Math.min(width, height);
  context.save();
  context.globalAlpha = 1; context.globalCompositeOperation = 'source-over'; context.filter = 'none';
  context.shadowBlur = 0; context.lineJoin = 'round'; context.lineCap = 'round';
  // Masks are always opaque and above every other annotation, including text.
  for (const mark of [...annotations.filter(item => item.kind !== 'redact'), ...annotations.filter(item => item.kind === 'redact')]) {
    const points = projected(mark, { width, height }, adjustments, uncropped);
    context.save();
    context.strokeStyle = context.fillStyle = mark.kind === 'redact' ? (mark.color === '#ffffff' ? '#ffffff' : '#000000') : color(mark.color);
    context.lineWidth = Math.max(1, clamp(mark.lineWidth || 0.005, 1 / 600, 12 / 600) * scale);
    if (mark.kind === 'text') {
      const fontSize = Math.max(12, clamp(mark.fontSize || 32 / 600, 12 / 600, 96 / 600) * scale);
      context.translate(points[0].x, points[0].y);
      context.rotate((normalizeGeometry(adjustments).rotation + (mark.angle || 0)) * Math.PI / 180);
      context.font = `600 ${fontSize}px Arial, "PingFang SC", "Microsoft YaHei", sans-serif`;
      context.textBaseline = 'top';
      String(mark.text || '').slice(0, 200).split('\n').slice(0, 8).forEach((line, index) => context.fillText(line, 0, index * fontSize * 1.3));
    } else {
      context.beginPath(); context.moveTo(points[0].x, points[0].y);
      points.slice(1).forEach(point => context.lineTo(point.x, point.y));
      if (mark.kind === 'arrow') {
        context.stroke();
        const [from, to] = points, angle = Math.atan2(to.y - from.y, to.x - from.x), head = Math.max(10, context.lineWidth * 4);
        context.beginPath(); context.moveTo(to.x, to.y);
        context.lineTo(to.x - head * Math.cos(angle - Math.PI / 6), to.y - head * Math.sin(angle - Math.PI / 6));
        context.lineTo(to.x - head * Math.cos(angle + Math.PI / 6), to.y - head * Math.sin(angle + Math.PI / 6));
        context.closePath(); context.fill();
      } else {
        context.closePath();
        if (mark.kind === 'redact') { context.fill(); context.lineWidth = 2; context.stroke(); }
        else context.stroke();
      }
    }
    context.restore();
  }
  context.restore();
}

export function annotationBounds(mark, size, adjustments) {
  const points = projected(mark, size, adjustments);
  if (mark.kind === 'text') {
    const font = Math.max(12, (mark.fontSize || 32 / 600) * Math.min(size.width, size.height));
    const lines = String(mark.text || '').split('\n');
    const angle = (normalizeGeometry(adjustments).rotation + (mark.angle || 0)) * Math.PI / 180;
    const w = Math.max(1, ...lines.map(line => Array.from(line).length)) * font, h = lines.length * font * 1.3;
    const origin = points[0];
    for (const [x, y] of [[w, 0], [w, h], [0, h]]) points.push({ x: origin.x + x * Math.cos(angle) - y * Math.sin(angle), y: origin.y + x * Math.sin(angle) + y * Math.cos(angle) });
  }
  const xs = points.map(p => p.x), ys = points.map(p => p.y);
  return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
}

export function hitPersonalAnnotation(annotations, point, size, adjustments, tolerance = 8) {
  return [...annotations.filter(mark => mark.kind !== 'redact'), ...annotations.filter(mark => mark.kind === 'redact')].reverse().find(mark => {
    const bounds = annotationBounds(mark, size, adjustments);
    return point.x >= bounds.x - tolerance && point.y >= bounds.y - tolerance
      && point.x <= bounds.x + bounds.width + tolerance && point.y <= bounds.y + bounds.height + tolerance;
  });
}

export function movePersonalAnnotation(mark, from, to, size, adjustments) {
  const start = canvasToAnnotationPoint(from, size.width, size.height, adjustments), end = canvasToAnnotationPoint(to, size.width, size.height, adjustments);
  const dx = end.x - start.x, dy = end.y - start.y;
  if (Math.abs(dx) + Math.abs(dy) < 1e-10) return mark;
  return { ...mark, points: mark.points.map(point => ({ x: point.x + dx, y: point.y + dy })) };
}

export function resizePersonalAnnotation(mark, handle, point, size, adjustments) {
  if (mark.kind === 'arrow') return { ...mark, points: mark.points.map((value, index) => index === handle
    ? canvasToAnnotationPoint(point, size.width, size.height, adjustments) : value) };
  if (!['rectangle', 'redact'].includes(mark.kind)) return mark;
  const opposite = annotationToCanvasPoint(mark.points[(handle + 2) % 4], size.width, size.height, adjustments);
  const next = createPersonalAnnotation(mark.kind, opposite, point, size, adjustments);
  return next ? { ...mark, points: next.points } : mark;
}
