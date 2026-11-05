import { marked } from 'marked';
import { parseImageGroupMarker, imageGroupMarker, withDraftImageGroups } from './newsImageGroups';

export function withoutImageGroupMarkers(markdown) {
  return articleBlocks(markdown).map(block => block.type === 'image' && block.galleryId
    ? changeArticleBlock({ ...block, galleryId: null }, block.text).raw : block.raw).join('');
}

export function renderDraftArticle(markdown) {
  const html = marked.parse(String(markdown || ''), { gfm: true });
  if (typeof DOMParser === 'undefined') return html;
  const document = new DOMParser().parseFromString(html, 'text/html');
  const blocks = withDraftImageGroups(articleBlocks(markdown).filter(block => block.type !== 'space'));
  const candidates = [...document.body.children].filter(node => node.tagName === 'P' && node.children.length === 1 && node.firstElementChild.tagName === 'IMG' && !node.textContent.trim());
  const images = blocks.filter(block => block.type === 'image');
  // Leave unusual/raw HTML alone instead of guessing which image belongs to which block.
  if (candidates.length !== images.length || images.some((block, i) => candidates[i].firstElementChild.getAttribute('src') !== block.href)) return html;
  const elements = new Map(images.map((block, i) => [block, candidates[i]]));
  for (let start = 0; start < blocks.length; start++) {
    const first = blocks[start];
    if (first.type !== 'image' || !first.galleryId) continue;
    let end = start + 1;
    while (end < blocks.length && blocks[end].type === 'image' && blocks[end].galleryId === first.galleryId) end++;
    const group = document.createElement('section'); group.className = 'news-draft-image-group';
    const columns = Math.min(first.galleryColumns, end - start);
    group.style.cssText = `display:grid;grid-template-columns:repeat(${columns},minmax(0,1fr));gap:8px;margin:24px 0;`;
    group.setAttribute('data-gallery-columns', String(columns));
    elements.get(first).before(group);
    for (let i = start; i < end; i++) {
      const element = elements.get(blocks[i]), cell = document.createElement('section');
      cell.style.minWidth = '0'; cell.append(element.firstElementChild); group.append(cell); element.remove();
    }
    start = end - 1;
  }
  return document.body.innerHTML;
}

export function articleBodyMarkdown(markdown, title) {
  const tokens = marked.lexer(String(markdown || ''), { gfm: true });
  const heading = tokens.find(token => token.type !== 'space');
  if (heading?.type !== 'heading' || heading.depth !== 1 || heading.text.trim() !== String(title || '').trim()) return String(markdown || '');
  return tokens.filter(token => token !== heading).map(token => token.raw).join('').replace(/^\n+/, '');
}

export function articleBlocks(markdown) {
  const tokens = marked.lexer(String(markdown || ''), { gfm: true });
  const blocks = [];
  for (let index = 0; index < tokens.length; index++) {
    let token = tokens[index], prefix = '', metadata = null;
    const candidate = token.type === 'html' ? parseImageGroupMarker(token.raw) : null;
    if (candidate) {
      let next = index + 1;
      while (tokens[next]?.type === 'space') next++;
      if (tokens[next]?.type === 'paragraph' && tokens[next].tokens?.length === 1 && tokens[next].tokens[0].type === 'image') {
        prefix = tokens.slice(index, next).map(item => item.raw).join('');
        metadata = candidate; index = next; token = tokens[index];
      }
    }
    const image = token.type === 'paragraph' && token.tokens?.length === 1 && token.tokens[0].type === 'image' ? token.tokens[0] : null;
    blocks.push({ id: index, raw: prefix + token.raw, type: image ? 'image' : token.type,
      text: image ? image.text : token.type === 'heading' ? token.text : token.raw.trimEnd(),
      depth: token.depth, href: image?.href, ...metadata, tail: token.raw.match(/\s*$/)?.[0] || '' });
  }
  return blocks;
}

export function changeArticleBlock(block, text) {
  const tail = block.tail ?? '';
  const raw = block.type === 'heading' ? `${'#'.repeat(block.depth)} ${text}${tail}`
    : block.type === 'image' ? `${imageGroupMarker(block)}![${text.replace(/([\\\[\]])/g, '\\$1').replace(/\n/g, ' ')}](${block.href.replace(/\(/g, '%28').replace(/\)/g, '%29')})${tail}`
      : `${text}${tail}`;
  return { ...block, text, raw };
}
