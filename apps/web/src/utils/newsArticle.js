import { marked } from 'marked';
import { parseImageGroupMarker, imageGroupMarker, withDraftImageGroups } from './newsImageGroups';

const reviewRole = line => /^\s*(?:\*{1,2}|_{1,2})?(初审|终审)(?:\*{1,2}|_{1,2})?\s*[：:|｜]/.exec(line)?.[1];

export function hasReviewCredits(text) {
  const roles = String(text || '').split('\n').map(reviewRole);
  return roles.includes('初审') && roles.includes('终审');
}

export function normalizeReviewCredits(markdown) {
  const lines = String(markdown || '').split(/\r?\n/), next = [];
  for (let i = 0; i < lines.length; i++) {
    if (reviewRole(lines[i]) === '初审') {
      let last = i + 1;
      while (last < lines.length && !lines[last].trim()) last++;
      if (last < lines.length && reviewRole(lines[last]) === '终审') {
        next.push(lines[i].trimEnd() + '  ', lines[last]);
        i = last;
        continue;
      }
    }
    next.push(lines[i]);
  }
  return next.join('\n');
}

export function withoutImageGroupMarkers(markdown) {
  return articleBlocks(markdown).map(block => block.type === 'image' && block.galleryId
    ? changeArticleBlock({ ...block, galleryId: null }, block.text).raw : block.raw).join('');
}

function imageWithoutCaption(raw, href) {
  let depth = 1;
  // The lexer has already identified an image. Keep its destination spelling and optional title.
  for (let i = 2; i < raw.length; i++) {
    if (raw[i] === '\\') i++;
    else if (raw[i] === '`' && depth === 1) {
      const end = raw.indexOf('`', i + 1);
      if (end < 0) break;
      i = end;
    }
    else if (raw[i] === '[') depth++;
    else if (raw[i] === ']' && --depth === 0) {
      const destination = raw.slice(i + 1);
      if (destination.startsWith('(')) return '![]' + destination;
      break;
    }
  }
  return changeArticleBlock({ type: 'image', href }, '').raw;
}

export function withoutImageCaptions(markdown) {
  const original = String(markdown || '');
  const source = original.replace(/\r\n?/g, '\n');
  const crlf = Array.from(original.matchAll(/\r\n/g), (match, i) => match.index - i);
  let endings = 0;
  const originalOffset = offset => {
    while (crlf[endings] < offset) endings++;
    return offset + endings;
  };
  const sections = [];
  let cursor = 0, copied = 0;
  // Splice the original source because the lexer can omit link definitions between blocks.
  for (const block of articleBlocks(source)) {
    const start = source.indexOf(block.raw, cursor);
    if (start < 0) return original;
    cursor = start + block.raw.length;
    if (block.type !== 'image' || !block.text.trim()) continue;
    const image = block.raw.indexOf(block.imageRaw);
    if (image < 0) return original;
    const from = originalOffset(start + image);
    const to = originalOffset(start + image + block.imageRaw.length);
    sections.push(original.slice(copied, from), imageWithoutCaption(original.slice(from, to), block.href));
    copied = to;
  }
  return sections.length ? sections.concat(original.slice(copied)).join('') : original;
}

export function renderDraftArticle(markdown) {
  const draft = normalizeReviewCredits(markdown);
  const html = marked.parse(draft, { gfm: true });
  if (typeof DOMParser === 'undefined') return html;
  const document = new DOMParser().parseFromString(html, 'text/html');
  const blocks = withDraftImageGroups(articleBlocks(draft).filter(block => block.type !== 'space'));
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
    if (end - start < 2) continue;
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
      depth: token.depth, href: image?.href, ...(image ? { imageRaw: image.raw } : {}), ...metadata, tail: token.raw.match(/\s*$/)?.[0] || '' });
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
