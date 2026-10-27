const segmenter = new Intl.Segmenter('zh', { granularity: 'grapheme' });

function isEmoji(segment) {
  if (/^[©®™]$/u.test(segment)) return false;
  return /\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20e3/u.test(segment);
}
function sourceEmoji(values) {
  const found = new Set();
  const visit = value => {
    if (typeof value === 'string') {
      for (const { segment } of segmenter.segment(value)) if (isEmoji(segment)) found.add(segment);
    } else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object') Object.values(value).forEach(visit);
  };
  visit(values);
  return [...found];
}
function withoutAddedEmoji(text, allowed) {
  if (typeof text !== 'string') return text;
  const keep = new Set(allowed || []);
  return [...segmenter.segment(text)].map(({ segment }) => {
    if (!isEmoji(segment) || keep.has(segment)) return segment;
    // A keycap represents a real digit, not just decoration.
    return /^[0-9#*]/.test(segment) ? segment[0] : '';
  }).join('');
}
function cleanGeneratedDraft(result, allowed) {
  for (const key of ['title', 'subtitle', 'markdown']) result[key] = withoutAddedEmoji(result[key], allowed);
  if (Array.isArray(result.placeholders)) result.placeholders = result.placeholders.map(item => item && typeof item === 'object'
    ? { ...item, alt: withoutAddedEmoji(item.alt, allowed), caption: withoutAddedEmoji(item.caption, allowed) } : item);
  if (typeof result.html === 'string' && typeof result.markdown === 'string') result.html = result.markdown.replace(/\n/g, '<br/>');
  return result;
}
module.exports = { sourceEmoji, withoutAddedEmoji, cleanGeneratedDraft };
