import { editorPhotoGroups } from './newsEditorModel';
import { MAX_WECHAT_GROUP_PHOTOS } from './newsImageGroups';

const horizontalDistance = (rect, x) => Math.max(rect.left - x, x - rect.right, 0);

export function photoDropPlacement(blocks, { x, y }, source) {
  // Grid cells in the same visual row share their top edge, even if their captions have different heights.
  const rows = [];
  for (const block of blocks) {
    const row = rows.at(-1);
    if (row && Math.abs(row.top - block.bounds.top) < 1) {
      row.items.push(block);
      row.bottom = Math.max(row.bottom, block.bounds.bottom);
    } else rows.push({ top: block.bounds.top, bottom: block.bounds.bottom, items: [block] });
  }

  const move = (index, line) => !source.grouped && (index === source.index || index === source.index + 1)
    ? null : { target: { mode: 'move', index }, line };
  let previous;
  for (const row of rows) {
    const first = row.items[0].index, after = row.items.at(-1).index + 1;
    if (y < row.top) return move(first, previous ? (previous.bottom + row.top) / 2 : row.top);
    if (y > row.bottom) { previous = row; continue; }
    const cells = row.items.filter(block => block.image);
    if (cells.length) {
      const cell = cells.reduce((nearest, block) => horizontalDistance(block.image, x) < horizontalDistance(nearest.image, x) ? block : nearest);
      const { left, top, right, bottom } = cell.image;
      const edge = Math.min(24, (bottom - top) * 0.18);
      if (y > top + edge && y < bottom - edge) {
        return cell.index === source.index ? null : {
          target: { mode: 'group', index: cell.index, after: x >= (left + right) / 2 },
          image: cell.image,
        };
      }
      return y <= top + edge ? move(first, row.top) : move(after, row.bottom);
    }
    return y < (row.top + row.bottom) / 2 ? move(first, row.top) : move(after, row.bottom);
  }
  return previous ? move(previous.items.at(-1).index + 1, previous.bottom) : null;
}

export function editorPhotoDropPlacement(editor, point, source) {
  if (source.doc !== editor.state.doc) return null;
  const blocks = [];
  source.doc.forEach((node, pos, index) => {
    const element = editor.nodeDOM(pos);
    if (!(element instanceof Element)) return;
    const bounds = element.getBoundingClientRect();
    const image = node.type.name === 'photo' && element.querySelector('img')?.getBoundingClientRect();
    blocks.push({ index, bounds, image });
  });
  const placement = photoDropPlacement(blocks, point, source);
  if (placement?.target.mode !== 'group') return placement;
  const destination = editorPhotoGroups(source.doc).find(group => group.items.some(item => item.index === placement.target.index));
  return { ...placement, full: destination?.items.length >= MAX_WECHAT_GROUP_PHOTOS && !destination.items.some(item => item.index === source.index) };
}
