// Slot trees are shared by the editable canvas, confirmation preview and exported HTML.
// Partial final groups use every remaining image once, in the original order.
export const GALLERY_STYLES = [
  { id: 'gallery-editorial', type: 'imageGroup', name: '杂志跨页', slots: 3, legacy: true },
  { id: 'gallery-exhibition', type: 'imageGroup', name: '影像图录', slots: 3, legacy: true },
  { id: 'gallery-campus', type: 'imageGroup', name: '校园专刊', slots: 4, legacy: true },
  { id: 'gallery-portfolio', type: 'imageGroup', name: '留白展页', slots: 2, legacy: true },
  // Keep earlier draft styles readable without offering the rejected options again.
  { id: 'gallery-feature-left', type: 'imageGroup', name: '左主图 · 右侧双图', slots: 3, legacy: true },
  { id: 'gallery-lead-strip', type: 'imageGroup', name: '横幅主图 · 下方三联', slots: 4, legacy: true },
  { id: 'gallery-pair-lead', type: 'imageGroup', name: '上方双图 · 横幅收尾', slots: 3, legacy: true },
  { id: 'gallery-asymmetric', type: 'imageGroup', name: '大小对照 · 交替双联', slots: 2, legacy: true },
  { id: 'gallery-staggered', type: 'imageGroup', name: '错落留白 · 双联', slots: 2, legacy: true },
  { id: 'gallery-filmstrip', type: 'imageGroup', name: '影像三联 · 窄边框', slots: 3, legacy: true },
];
export const GALLERY_STYLES_BY_ID = Object.fromEntries(GALLERY_STYLES.map(style => [style.id, style]));
const leaf = index => ({ index });
const row = (children, weights) => ({ children, weights, direction: 'row' });
const column = children => ({ children, direction: 'column' });
const text = (value, css) => ({ text: value, css });
const styled = (node, css) => ({ ...node, css });
const frame = (node, css) => styled(column([node]), { background: '#fff', padding: '6px', ...css });
const number = index => String(index + 1).padStart(2, '0');
const folio = (index, count, color = '#25292c') => styled(row([
  text(number(index), { fontFamily: 'Georgia, serif', fontSize: '34px', lineHeight: '1', color }),
  text(`${count} 图`, { fontSize: '10px', lineHeight: '1.4', color }),
]), { justifyContent: 'space-between', alignItems: 'baseline', borderTop: `1px solid ${color}`, paddingTop: '10px', marginBottom: '10px' });

function composedGroup(id, items, index) {
  if (id === 'gallery-editorial') return styled(column([
    folio(index, items.length),
    items.length > 1 ? row([items[0], styled(column(items.slice(1)), { borderLeft: '2px solid #ba4241', paddingLeft: '10px' })], [7, 4]) : items[0],
  ]), { padding: '16px 0 22px', borderBottom: '1px solid #d9dddf', gap: '12px' });
  if (id === 'gallery-exhibition') return styled(column([
    folio(index, items.length, '#e8eded'),
    frame(items[0], { padding: '8px' }),
    ...(items.length > 1 ? [row(items.slice(1).map(item => frame(item)))] : []),
  ]), { padding: '18px', background: '#24292c', gap: '12px' });
  if (id === 'gallery-campus') return styled(column([
    styled(row([text(number(index), { color: '#fff', background: '#315ba8', fontSize: '20px', fontWeight: '700', padding: '5px 12px', lineHeight: '1.4' }),
      text(`${items.length} 图`, { color: '#315ba8', fontSize: '11px', paddingRight: '6px' })]), { justifyContent: 'space-between', borderBottom: '2px solid #315ba8', marginBottom: '8px' }),
    frame(items[0], { padding: '8px', boxShadow: '5px 5px 0 #d7e2f5', marginRight: '5px', marginBottom: '10px' }),
    ...(items.length > 1 ? [row(items.slice(1).map(item => frame(item)))] : []),
  ]), { padding: '18px', background: '#f0f4fb', border: '1px solid #dce5f3', gap: '10px' });
  if (id === 'gallery-portfolio') return styled(row(items.map((item, i) => styled(column([
    text(number(item.index), { fontFamily: 'Georgia, serif', fontSize: '22px', color: '#626b70', borderBottom: '1px solid #b8c1c6', paddingBottom: '8px', marginBottom: '6px' }),
    frame(item, { padding: '5px', border: '1px solid #e1e5e7' }),
  ]), { paddingTop: i ? '48px' : '0' })), [5, 4]), { padding: '10px 10px 24px', gap: '18px', alignItems: 'flex-start', borderBottom: '2px solid #2b3338' });
  return null;
}

export function galleryLayoutTree(id, count) {
  const style = GALLERY_STYLES_BY_ID[id];
  if (!style || !Number.isInteger(count) || count < 1) return null;
  const sections = [];
  for (let start = 0; start < count; start += style.slots) {
    const items = Array.from({ length: Math.min(style.slots, count - start) }, (_, i) => leaf(start + i));
    let group = composedGroup(id, items, start / style.slots) || row(items);
    if (items.length === style.slots) {
      if (id === 'gallery-feature-left') group = row([items[0], column(items.slice(1))], [2, 1]);
      if (id === 'gallery-lead-strip') group = column([items[0], row(items.slice(1))]);
      if (id === 'gallery-pair-lead') group = column([row(items.slice(0, 2)), items[2]]);
      if (id === 'gallery-asymmetric') group = row(items, start % 4 ? [2, 3] : [3, 2]);
      if (id === 'gallery-staggered') group = row([items[0], { ...items[1], offset: 24 }], [1, 1]);
    }
    sections.push(group);
  }
  const wideGap = ['gallery-editorial', 'gallery-exhibition', 'gallery-campus', 'gallery-portfolio'].includes(id);
  return { ...column(sections), framed: id === 'gallery-filmstrip', ...(wideGap ? { css: { gap: '24px' } } : {}) };
}

export function galleryNodeStyle(node, weight) {
  return { minWidth: '0', boxSizing: 'border-box', ...(weight != null ? { flex: `${weight} 1 0%` } : {}),
    ...(node.children ? { display: 'flex', flexDirection: node.direction, gap: '8px', alignItems: node.direction === 'row' ? 'center' : 'stretch' } : {}),
    ...(node.offset ? { paddingTop: `${node.offset}px` } : {}),
    ...(node.framed ? { padding: '10px', border: '1px solid #d9dde1', background: '#f5f6f7' } : {}), ...node.css };
}

export function galleryStyleHtml(parts, id) {
  const tree = galleryLayoutTree(id, parts.length);
  if (!tree) return parts.join('\n');
  const render = (node, weight) => {
    const css = Object.entries(galleryNodeStyle(node, weight)).map(([key, value]) => `${key.replace(/[A-Z]/g, ch => `-${ch.toLowerCase()}`)}:${value}`).join(';');
    return `<section style="${css}">${node.children ? node.children.map((child, i) => render(child, node.direction === 'row' && !node.css?.justifyContent ? node.weights?.[i] || 1 : null)).join('') : node.text != null ? node.text : parts[node.index]}</section>`;
  };
  return `<section data-gallery-style="${id}" style="margin:12px 0;">${render(tree)}</section>`;
}
