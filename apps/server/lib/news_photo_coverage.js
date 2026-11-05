const IMAGE = /!\[([^\]\n]*)\]\(([^)\s]+)\)/g;
const CREDIT = /^(?:文字|文案|撰稿|摄影|图片|供图|编辑|排版|校对|初审|复审|终审|审核|责编|来源)\s*[:：|｜]/;

// This runs once on generation, never on edits: deleting a photo later is intentional.
function completeSelectedPhotos(markdown, selectedPhotos) {
  const selected = new Map(selectedPhotos.map(photo => [String(photo.id), photo]));
  const seen = new Set(), placeholders = [];
  let result = String(markdown).replace(IMAGE, (_token, alt, href) => {
    const id = /^PHOTO:([1-9]\d*)$/.exec(href)?.[1];
    if (!selected.has(id) || seen.has(id)) return '';
    seen.add(id);
    placeholders.push({ id, url: null, alt, photographerId: selected.get(id).photographerId || null });
    return `\n\n![${alt}](PHOTO:${id})\n\n`;
  });
  const missing = [...selected.keys()].filter(id => !seen.has(id));
  if (missing.length) {
    const lines = result.trimEnd().split('\n');
    let insert = lines.length;
    while (insert > 0 && (!lines[insert - 1].trim() || CREDIT.test(lines[insert - 1].trim()))) insert--;
    lines.splice(insert, 0, '', ...missing.flatMap(id => [`![](PHOTO:${id})`, '']));
    result = lines.join('\n');
    for (const id of missing) placeholders.push({ id, url: null, alt: '', photographerId: selected.get(id).photographerId || null });
  }
  return { markdown: result.replace(/\n{3,}/g, '\n\n').trim(), placeholders,
    coverage: { selected: selected.size, included: selected.size, completed: missing.length } };
}

module.exports = { completeSelectedPhotos };
