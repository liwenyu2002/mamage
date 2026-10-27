import { articleBlocks } from './newsArticle';

// DOM offsets are translated back to fresh Markdown tokens, never stale block IDs.
export function sourceRanges(markdown, start, end) {
  let offset = 0;
  const ranges = [];
  for (const block of articleBlocks(markdown)) {
    const base = offset;
    offset += block.raw.length;
    if (block.type === 'space' || block.type === 'image') continue;
    const textStart = base + (block.type === 'heading' ? block.raw.indexOf(block.text) : 0);
    const textEnd = textStart + block.text.length;
    if (start === end ? start >= textStart && start <= textEnd : end > textStart && start < textEnd) {
      ranges.push({ uid: `b-${block.id}`, start: Math.max(0, start - textStart), end: Math.min(block.text.length, end - textStart) });
    }
  }
  return ranges;
}

export function floatingPosition(anchor, size, viewport) {
  const gap = 12, leftEdge = viewport.left || 0, topEdge = viewport.top || 0;
  const width = Math.min(size.width || 420, viewport.width - gap * 2);
  const height = Math.min(size.height || 190, viewport.height - gap * 2);
  const x = anchor?.x ?? leftEdge + (viewport.width - width) / 2;
  const top = anchor?.top ?? topEdge + 100, bottom = anchor?.bottom ?? top;
  const below = bottom + gap;
  const y = below + height <= topEdge + viewport.height - gap ? below : top - height - gap;
  return { left: Math.max(leftEdge + gap, Math.min(x, leftEdge + viewport.width - width - gap)),
    top: Math.max(topEdge + gap, Math.min(y, topEdge + viewport.height - height - gap)), width, maxHeight: viewport.height - gap * 2 };
}
