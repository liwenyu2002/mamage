import { Schema } from 'prosemirror-model';
import { articleBlocks, changeArticleBlock } from './newsArticle';
import { sourceRanges } from './newsEditorSelection';

const attrs = { original: { default: null } };
export const newsEditorSchema = new Schema({ nodes: {
  doc: { content: 'block+' },
  paragraph: { content: 'text*', group: 'block', attrs, toDOM: () => ['div', { class: 'news-edit-block news-edit-paragraph' }, 0], parseDOM: [{ tag: 'p' }, { tag: 'div' }] },
  heading: { content: 'text*', group: 'block', defining: true, attrs: { ...attrs, depth: { default: 1 } },
    toDOM: node => [`h${node.attrs.depth}`, { class: node.attrs.depth === 1 ? 'news-edit-title' : 'news-edit-subtitle' }, 0],
    parseDOM: [1, 2, 3, 4, 5, 6].map(depth => ({ tag: `h${depth}`, attrs: { depth } })) },
  photo: { content: 'text*', group: 'block', defining: true, isolating: true, attrs: { ...attrs, href: {} },
    toDOM: node => ['figure', { class: 'news-edit-block news-edit-photo' },
      ['img', { src: node.attrs.href, alt: node.textContent, contenteditable: 'false', loading: 'lazy' }],
      ['figcaption', { class: 'news-edit-caption', role: 'textbox', 'aria-label': '图片说明', 'aria-multiline': 'true' }, 0]] },
  text: { group: 'inline' },
} });

export function editorDocument(markdown) {
  const nodes = []; let gap = '', hasBlock = false;
  const empty = count => { for (let i = 0; i < count; i++) nodes.push(newsEditorSchema.nodes.paragraph.create()); };
  for (const block of articleBlocks(markdown)) {
    if (block.type === 'space') { gap += block.raw; continue; }
    // Two newlines separate blocks; each additional pair represents an empty paragraph.
    empty(Math.max(0, Math.floor((gap.match(/\n/g) || []).length / 2) - (hasBlock ? 1 : 0)));
    const type = block.type === 'image' && /^(https?:\/\/|\/[^/])/.test(block.href) ? 'photo' : block.type === 'heading' ? 'heading' : 'paragraph';
    nodes.push(newsEditorSchema.nodes[type].create({ original: block, depth: block.depth, href: block.href }, block.text ? newsEditorSchema.text(block.text) : null));
    gap = block.tail; hasBlock = true;
  }
  empty(Math.floor((gap.match(/\n/g) || []).length / 2) + (hasBlock ? 0 : 1));
  return newsEditorSchema.nodes.doc.create(null, nodes.length ? nodes : newsEditorSchema.nodes.paragraph.create());
}

export function editorBlockStyle(state) {
  const styles = new Set();
  state.doc.nodesBetween(state.selection.from, state.selection.to, node => {
    if (node.type.name === 'photo') { styles.add('photo'); return false; }
    if (node.isTextblock) styles.add(node.type.name === 'heading' ? `h${node.attrs.depth}` : 'paragraph');
  });
  return styles.size === 1 ? [...styles][0] : '';
}

export function setEditorBlockStyle(style) {
  return (state, dispatch) => {
    if (!['paragraph', 'h1', 'h2', 'h3'].includes(style)) return false;
    const type = style === 'paragraph' ? newsEditorSchema.nodes.paragraph : newsEditorSchema.nodes.heading;
    const depth = style === 'paragraph' ? null : Number(style.slice(1));
    const transaction = state.tr;
    state.doc.nodesBetween(state.selection.from, state.selection.to, (node, pos) => {
      if (node.type.name === 'photo') return false;
      if (node.isTextblock && (node.type !== type || (depth && node.attrs.depth !== depth))) transaction.setNodeMarkup(pos, type, { original: null, ...(depth ? { depth } : {}) });
    });
    if (!transaction.docChanged) return false;
    dispatch?.(transaction.setMeta('newsEditBoundary', true).scrollIntoView());
    return true;
  };
}

export function editorMarkdown(doc) {
  const entries = []; let offset = 0;
  doc.forEach((node, pos) => {
    const original = node.attrs.original, text = node.textContent;
    const kind = node.type.name === 'photo' ? 'image' : node.type.name;
    const block = original?.text === text && original.type === kind && (kind !== 'heading' || original.depth === node.attrs.depth) ? original : changeArticleBlock({
      type: kind, depth: node.attrs.depth, href: node.attrs.href, tail: '',
    }, kind === 'heading' || kind === 'image' ? text.replace(/[\r\n]+/g, ' ') : text);
    const raw = block.raw.trimEnd();
    entries.push({ node, pos, block, raw, start: offset }); offset += raw.length + 2;
  });
  return { markdown: entries.map(entry => entry.raw).join('\n\n'), entries };
}

export function editorSelection(doc, selection) {
  const { markdown, entries } = editorMarkdown(doc), { from, to } = selection;
  const ranges = [];
  entries.forEach(({ node, pos, block, raw, start }) => {
    const a = Math.max(0, from - pos - 1), b = Math.min(node.textContent.length, to - pos - 1);
    if (b < a || (from !== to && b === a)) return;
    if (node.type.name === 'photo') {
      if (from >= pos + 1 && to <= pos + 1 + node.textContent.length) {
        let offset = 0;
        const parsed = articleBlocks(markdown).find(item => { const match = offset === start; offset += item.raw.length; return match; });
        if (parsed) ranges.push({ uid: `b-${parsed.id}`, start: a, end: b });
      }
    } else {
      const textStart = start + (block.type === 'heading' ? raw.indexOf(block.text) : 0);
      ranges.push(...sourceRanges(markdown, textStart + a, textStart + b));
    }
  });
  return { ...(ranges.length === 1 ? ranges[0] : {}), ranges, markdown, text: from === to ? '' : doc.textBetween(from, to, '\n') };
}
