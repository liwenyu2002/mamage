const cheerio = require('cheerio');
const { parsed } = require('./wechat_monitor_content');

const percent = value => /^\d+(?:\.\d+)?%$/.test(value || '') ? parseFloat(value) : null;

// Infer only plain equal-width photo columns. Decorative/SVG assemblies are not galleries.
function observedGalleries(row) {
  const blocks = parsed(row.blocks, []);
  if (!Array.isArray(blocks)) return [];
  const $ = cheerio.load(blocks.filter(block => typeof block === 'string').join(''), null, false);
  const found = new Map();
  $('section,div').each((_, element) => {
    const node = $(element), style = node.css();
    const children = node.children().toArray();
    if (![2, 3].includes(children.length) || !['flex', 'inline-flex'].includes(style.display)
      || /column|reverse/.test(`${style['flex-flow']} ${style['flex-direction']}`)
      || node.find('svg,script,iframe,video,table').length || node.text().trim()) return;
    const columns = children.length;
    const widths = children.map(child => percent($(child).css('width')));
    if (widths.some(width => width == null || Math.abs(width - 100 / columns) > 3)) return;
    if (node.find('*').addBack().toArray().some(child => {
      const css = $(child).css();
      return (css.transform && css.transform !== 'none') || /absolute|fixed/.test(css.position || '')
        || Object.entries(css).some(([key, value]) => /^(margin|top|left|right|bottom)/.test(key) && /-\d/.test(value));
    })) return;
    const imageCounts = children.map(child => $(child).find('img').length);
    if (imageCounts.some(count => count < 1 || count > 6)) return;
    // Small icons nested in broad columns can otherwise look like photo grids.
    const images = node.find('img').toArray();
    if (images.some(img => {
      const chain = $(img).parentsUntil(element).addBack().toArray();
      return chain.some(parent => {
        const width = $(parent).css('width') || '';
        return /^\d+(?:\.\d+)?px$/.test(width) && parseFloat(width) < 96;
      });
    })) return;
    const insetWidths = images.map(img => {
      const cell = children.find(child => $(child).find(img).length);
      return $(img).parentsUntil(cell).toArray().map(parent => percent($(parent).css('width')))
        .find(width => width != null && width >= 80 && width < 100);
    }).filter(width => width != null);
    const insetPercent = insetWidths.length === images.length && insetWidths.every(width => width === insetWidths[0])
      ? Math.round((100 - insetWidths[0]) / 2 * 10) / 10 : 0;
    const key = `${columns}:${insetPercent}`;
    const previous = found.get(key);
    found.set(key, { columns, insetPercent, occurrences: (previous?.occurrences || 0) + 1,
      articleId: Number(row.id), revisionId: Number(row.current_revision_id), sourceTitle: row.title,
      sourceUrl: row.source_url, evidence: { display: style.display, widths, imageCounts } });
  });
  return [...found.values()];
}

module.exports = { observedGalleries };
