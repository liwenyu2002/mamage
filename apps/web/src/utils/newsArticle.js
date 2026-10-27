import { marked } from 'marked';

export function articleBodyMarkdown(markdown, title) {
  const tokens = marked.lexer(String(markdown || ''), { gfm: true });
  const heading = tokens.find(token => token.type !== 'space');
  if (heading?.type !== 'heading' || heading.depth !== 1 || heading.text.trim() !== String(title || '').trim()) return String(markdown || '');
  return tokens.filter(token => token !== heading).map(token => token.raw).join('').replace(/^\n+/, '');
}

export function articleBlocks(markdown) {
  return marked.lexer(String(markdown || ''), { gfm: true }).map((token, index) => {
    const image = token.type === 'paragraph' && token.tokens?.length === 1 && token.tokens[0].type === 'image' ? token.tokens[0] : null;
    return { id: index, raw: token.raw, type: image ? 'image' : token.type,
      text: image ? image.text : token.type === 'heading' ? token.text : token.raw.trimEnd(),
      depth: token.depth, href: image?.href, tail: token.raw.match(/\s*$/)?.[0] || '' };
  });
}

export function changeArticleBlock(block, text) {
  const tail = block.tail ?? '';
  const raw = block.type === 'heading' ? `${'#'.repeat(block.depth)} ${text}${tail}`
    : block.type === 'image' ? `![${text.replace(/([\\\[\]])/g, '\\$1').replace(/\n/g, ' ')}](${block.href.replace(/\(/g, '%28').replace(/\)/g, '%29')})${tail}`
      : `${text}${tail}`;
  return { ...block, text, raw };
}
