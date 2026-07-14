// 画布编辑器文档模型：DocBlock[] 与 markdown/HTML/纯文本之间的互转 + 历史栈 + para 内容清洗。
// 契约：/private/tmp/claude-501/-Users-liwenyu/f413e1a5-8f0f-436d-b775-8c9faffa99f1/scratchpad/canvas-editor-contracts.md 第 1 节。
// 约束：只 import themes.js 的公开导出（applyBlock/BUILTIN_BLOCKS_BY_ID），不碰其私有函数；
// para 正文样式在本文件内按 body 配置独立构造，刻意与 themes.js computeBodyStyles 的 p/strong/em/a 输出格式保持一致。
import { applyBlock, BUILTIN_BLOCKS_BY_ID } from './themes.js';
import { derivePalette, applyThemeMasksToHtml } from './themeColor.js';
import DOMPurify from 'dompurify';

// 全局纵深防御：整文复现允许保留 style 里的 background-image url()（否则背景丢失），
// 但 url() 里绝不该出现 javascript:/vbscript: 伪协议。DOMPurify 默认不深解析 CSS，这里挂一个
// 钩子，把 style 属性里 url(javascript:…)/url(vbscript:…) 整条 url() 抹掉，只动这两种绝不合法的协议，
// 对 http/https/data/相对路径背景图零影响。dompurify 经打包器去重为单例，此钩子对全站所有 sanitize 生效。
if (DOMPurify && typeof DOMPurify.addHook === 'function' && !DOMPurify.__mamageStyleUrlHook) {
  DOMPurify.__mamageStyleUrlHook = true;
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node && node.getAttribute && node.hasAttribute && node.hasAttribute('style')) {
      const style = node.getAttribute('style');
      if (/url\(\s*['"]?\s*(javascript|vbscript)\s*:/i.test(style)) {
        node.setAttribute('style', style.replace(/url\(\s*['"]?\s*(javascript|vbscript)\s*:[^)]*\)/gi, 'none'));
      }
    }
  });
}

// SVG SMIL 动画标签/属性白名单。DOMPurify 默认 SVG 白名单**不含** <animate>/<set>——因为它们能经
// attributeName="href" + to="javascript:…" 在运行时改写祖先 <a> 的 href 构成 XSS，故默认整标签剥除。
// 但这正是"整文复现里可点击 SVG（如调色盘点色块局部上色）被排版器吃掉交互"的根因：begin="click" 的
// <animate>/<set> 全被清洗掉，热区 rect 变成死矩形。这里显式放行这些标签+SMIL 属性，同时用下方
// uponSanitizeElement 钩子专门堵住 animate/set 改写 href 这一条已知向量（其余属性名的动画无脚本执行面）。
export const SVG_SMIL_TAGS = ['animate', 'animatetransform', 'animatemotion', 'animatecolor', 'set', 'mpath'];
// <foreignObject> 在 SVG 里桥接 HTML，是 DOMPurify 默认封杀的 mutation-XSS 高危标签；但「整文复现」里
// 点击上色（Color Walk 那类）的彩色层就嵌在 <g><foreignObject><svg 背景图> 内，不放行就永远上不了色。
// 定向窄口子：只放行标签本身，其内容仍受全局 FORBID_TAGS（script/style/iframe/object/embed/…）与
// ADD_ATTR 白名单递归约束；再用下方钩子把 foreignObject 自身的属性收窄到只剩几何属性，压小 mXSS 面。
export const SVG_FOREIGN_TAGS = ['foreignobject'];
export const SVG_SMIL_ATTRS = [
  'attributename', 'attributetype', 'begin', 'end', 'dur', 'from', 'to', 'by', 'values',
  'keytimes', 'keysplines', 'calcmode', 'repeatcount', 'repeatdur', 'restart',
  'additive', 'accumulate', 'fill', 'min', 'max', 'href', 'xlink:href', 'pointer-events',
  // <animateTransform type="translate|scale|rotate|…"> 的 type：区分变换种类，缺了横滑轮播等位移动画失效
  'type',
  // <animateMotion> 路径运动（另一种轮播/位移做法）的声明式属性
  'path', 'keypoints', 'rotate', 'origin',
];
// ★ 通用逆向：SVG 全量标准标签（动画/滤镜/渐变/文字/裁剪/foreignObject…有限固定集合），全部放行。
// 配合下方 uponSanitizeAttribute 钩子（svg 命名空间元素保留一切属性、只挡 on*/伪协议），
// 任何秀米/135/自研的 SVG 特效都整树保真，不再逐属性打补丁。foreignObject 内的 HTML 仍按 HTML 规则清洗。
export const SVG_ALL_TAGS = [
  'svg', 'g', 'defs', 'symbol', 'use', 'switch', 'a', 'view', 'desc', 'title', 'metadata',
  'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon',
  'text', 'tspan', 'textpath', 'tref', 'altglyph', 'altglyphdef', 'altglyphitem', 'glyph', 'glyphref',
  'image', 'marker', 'mask', 'clippath', 'pattern', 'lineargradient', 'radialgradient', 'stop',
  'filter', 'feblend', 'fecolormatrix', 'fecomponenttransfer', 'fecomposite', 'feconvolvematrix',
  'fediffuselighting', 'fedisplacementmap', 'fedistantlight', 'fedropshadow', 'feflood',
  'fefunca', 'fefuncb', 'fefuncg', 'fefuncr', 'fegaussianblur', 'feimage', 'femerge', 'femergenode',
  'femorphology', 'feoffset', 'fepointlight', 'fespecularlighting', 'fespotlight', 'fetile', 'feturbulence',
  'foreignobject', 'animate', 'animatetransform', 'animatemotion', 'animatecolor', 'set', 'mpath',
];
if (DOMPurify && typeof DOMPurify.addHook === 'function' && !DOMPurify.__mamageSmilHook) {
  DOMPurify.__mamageSmilHook = true;
  const SMIL = new Set(['animate', 'set', 'animatetransform', 'animatemotion', 'animatecolor']);
  // 堵住 <animate>/<set attributeName="href"> 运行时改写祖先 <a> 的 href 为 javascript: 的 XSS 向量。
  // DOMPurify 3.x 禁止在钩子里手动 removeChild（会破坏其树遍历完整性并抛错），故这里不摘节点，
  // 只抽掉 attributeName/to/from/by/values —— 没有 attributeName 的 SMIL 动画不指向任何属性、彻底失效，
  // 既消除脚本执行面，又不影响 Color Walk 那类 attributeName="x"/"visibility" 的合法动画。
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (!node || !node.tagName || !node.getAttribute) return;
    if (!SMIL.has(node.tagName.toLowerCase())) return;
    const an = String(node.getAttribute('attributeName') || node.getAttribute('attributename') || '').trim().toLowerCase();
    const vals = ['to', 'from', 'by', 'values'].map((a) => node.getAttribute(a) || '').join(' ');
    if (an === 'href' || an === 'xlink:href' || /(javascript|vbscript|data:text\/html)\s*:/i.test(vals)) {
      ['attributeName', 'attributename', 'to', 'from', 'by', 'values'].forEach((a) => node.removeAttribute(a));
    }
  });
}
if (DOMPurify && typeof DOMPurify.addHook === 'function' && !DOMPurify.__mamageForeignHook) {
  DOMPurify.__mamageForeignHook = true;
  // foreignObject 只保留几何属性(x/y/width/height)，其余属性一律剥掉——收窄命名空间桥接可携带的向量；
  // 其子树内容已由全局标签/属性白名单递归清洗(script/style/on*/iframe 等照旧禁)。
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (!node || !node.tagName || node.tagName.toLowerCase() !== 'foreignobject' || !node.attributes) return;
    Array.from(node.attributes).forEach((a) => {
      if (!/^(x|y|width|height)$/i.test(a.name)) node.removeAttribute(a.name);
    });
  });
}
if (DOMPurify && typeof DOMPurify.addHook === 'function' && !DOMPurify.__mamageSvgAttrHook) {
  DOMPurify.__mamageSvgAttrHook = true;
  const SVG_NS = 'http://www.w3.org/2000/svg';
  // ★ 通用逆向核心：对 SVG 命名空间的元素，强制保留 DOMPurify 默认会剥掉的任意属性（type/font-size/
  // enable-background/自定义 data-*/滤镜参数…），只挡两类真正的注入面：on* 事件、以及 URL 类属性里的
  // js/vbscript 伪协议。foreignObject 内的 HTML 元素不是 svg 命名空间 → 不放宽，仍走 DOMPurify 默认 HTML 清洗。
  DOMPurify.addHook('uponSanitizeAttribute', (node, data) => {
    if (!node || node.namespaceURI !== SVG_NS) return;
    const name = String(data.attrName || '').toLowerCase();
    if (/^on/.test(name)) return; // 事件处理器：不放行
    if (/^(href|xlink:href|src)$/.test(name) && /(javascript|vbscript|data:text\/html)\s*:/i.test(data.attrValue || '')) return;
    data.forceKeepAttr = true;
  });
}

// ---------------------------------------------------------------------------
// 基础工具
// ---------------------------------------------------------------------------

// title/caption/content 等来自用户输入或 markdown 原文，拼进 HTML 前必须转义；docModel 不从 themes.js
// 借用同名私有函数（那是私有实现），在这里独立维护一份等价逻辑
function escapeHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// content 字段（h2/h3/quote/signoff）是纯文本，但允许内嵌字面量 "<br>" 表示换行（多行引用/标题续行）。
// 渲染时需要把 <br> 当真实换行标签保留，同时把其余任意字符（包括用户手误打出的尖括号）安全转义，
// 用 split/join 而不是正则一把梭替换，避免 <br> 前后文本里恰好出现 "<br>" 字面片段被重复处理。
function escapeContentWithBreaks(text) {
  return String(text == null ? '' : text)
    .split('<br>')
    .map(escapeHtml)
    .join('<br>');
}

let uidCounter = 0;
/**
 * 生成画布内唯一块 id：'b-' + 时间戳 + 随机串 + 自增计数器，三重来源避免同一毫秒内批量生成时碰撞。
 * @returns {string}
 */
export function makeUid() {
  uidCounter += 1;
  const rand = Math.random().toString(36).slice(2, 8);
  return `b-${Date.now().toString(36)}${rand}${uidCounter.toString(36)}`;
}

// 属性值转义（href/style 等）：与 escapeHtml 同构但独立维护，语义是"进 HTML 属性值"而不是"进标签间文本"，
// 两处转义目的不同故不合并成一个函数，避免调用方混淆使用场景
function escapeAttr(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ---------------------------------------------------------------------------
// img 标签级属性/style 操作：raw 块图片编辑（replaceRawImgSrc/applyRawImgStyle）与 docToHtmlRaw 的
// imageCard imgStyle 后处理共用同一套合并原语，不各自重复实现
// ---------------------------------------------------------------------------

// img 是空标签、无内容体，标签级正则天然安全，不需要完整 DOM 解析
const IMG_TAG_RE = /<img\b[^>]*>/gi;
const IMG_SRC_ATTR_RE = /\ssrc\s*=\s*("[^"]*"|'[^']*'|[^\s"'>]+)/i;
const IMG_STYLE_ATTR_RE = /\sstyle\s*=\s*("([^"]*)"|'([^']*)')/i;
const IMG_WIDTH_ATTR_RE = /\swidth\s*=\s*("[^"]*"|'[^']*'|[^\s"'>]+)/i;
const IMG_HEIGHT_ATTR_RE = /\sheight\s*=\s*("[^"]*"|'[^']*'|[^\s"'>]+)/i;

function removeTagAttr(tag, attrRe) {
  return tag.replace(attrRe, '');
}

function getImgTagStyle(tag) {
  const m = IMG_STYLE_ATTR_RE.exec(tag);
  if (!m) return '';
  return m[2] !== undefined ? m[2] : m[3];
}

// 合并结果为空串时整个 style 属性一起摘掉，不留 style="" 空壳（与 sanitizeParaHtml 里空 href 退化成
// 裸 <a> 而不是 href="" 的处理哲学一致）
function setImgTagStyle(tag, styleStr) {
  if (!styleStr) {
    return IMG_STYLE_ATTR_RE.test(tag) ? tag.replace(IMG_STYLE_ATTR_RE, '') : tag;
  }
  const attr = ` style="${escapeAttr(styleStr)}"`;
  if (IMG_STYLE_ATTR_RE.test(tag)) {
    return tag.replace(IMG_STYLE_ATTR_RE, attr);
  }
  return tag.replace(/^<img\b/i, `<img${attr}`);
}

// style 声明解析/拼接：prop 统一小写去空白、value 保留原样去首尾空白；缺 prop 或缺 value 的碎片丢弃
function parseStyleDecls(styleStr) {
  const decls = [];
  String(styleStr || '').split(';').forEach((part) => {
    const idx = part.indexOf(':');
    if (idx === -1) return;
    const prop = part.slice(0, idx).trim().toLowerCase();
    const value = part.slice(idx + 1).trim();
    if (prop && value) decls.push([prop, value]);
  });
  return decls;
}

function stringifyStyleDecls(decls) {
  return decls.length ? `${decls.map(([prop, value]) => `${prop}:${value}`).join(';')};` : '';
}

// updates: { prop: value } 覆盖/新增该声明，{ prop: null } 移除该声明；已有同名声明先整体摘除，
// 新声明按 updates 的 key 顺序追加在末尾，不影响其余未涉及声明的相对顺序
function mergeStyleDecls(styleStr, updates) {
  const keys = Object.keys(updates);
  if (!keys.length) return String(styleStr || '');
  const kept = parseStyleDecls(styleStr).filter(([prop]) => !keys.includes(prop));
  keys.forEach((prop) => {
    const value = updates[prop];
    if (value != null) kept.push([prop, value]);
  });
  return stringifyStyleDecls(kept);
}

// 给单个 <img ...> 标签字符串合并 style 声明：只做属性值级别的字符串手术，不重建整个标签，
// 天然保留标签其余部分（属性顺序、自闭合斜杠等）
function mergeImgTagStyle(tag, updates) {
  if (!updates || !Object.keys(updates).length) return tag;
  return setImgTagStyle(tag, mergeStyleDecls(getImgTagStyle(tag), updates));
}

// ---------------------------------------------------------------------------
// markdownToDoc：矩阵来稿 / 旧草稿 markdown → DocBlock[]
// ---------------------------------------------------------------------------

// 块类型缺省 blockId：blockConfig 未提供对应类型时的兜底，取值与 themes.js 的 FALLBACK_BLOCK_IDS 完全一致
// （minimal 系列必须始终存在），但不 import 该私有映射，独立维护同值常量
const DEFAULT_BLOCK_IDS = {
  h2: 'builtin-h2-minimal',
  h3: 'builtin-h3-minimal',
  quote: 'builtin-quote-minimal',
  divider: 'builtin-divider-double-line',
  imageCard: 'builtin-imageCard-minimal-underline',
  signoff: 'builtin-signoff-end-badge',
};

function resolveBlockId(blockConfig, type) {
  return (blockConfig && blockConfig[type]) || DEFAULT_BLOCK_IDS[type];
}

function makeStyledBlock(type, blockConfig, fields) {
  const f = fields || {};
  return {
    uid: makeUid(),
    kind: 'styled',
    type,
    blockId: resolveBlockId(blockConfig, type),
    content: f.content != null ? f.content : '',
    src: f.src != null ? f.src : '',
    caption: f.caption != null ? f.caption : '',
    accent: null,
  };
}

function makeParaBlock(html) {
  return { uid: makeUid(), kind: 'para', html };
}

// 行内格式：只认 **bold**、*em*、[text](url) 三种语法，按"链接 > 加粗 > 斜体"顺序在同一条正则里
// 交替匹配（bold 写在 em 前面，保证 **x** 优先命中 bold 而不是被 * 提前截断成两个 em），
// 命中片段之间的普通文本与命中片段内部文字统一转义，杜绝任何未转义字符流入输出 HTML
const INLINE_MARKDOWN_RE = /\[([^\]]*)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*|\*([^*]+)\*/g;

function formatInlineMarkdown(line) {
  const raw = String(line == null ? '' : line);
  let out = '';
  let last = 0;
  let m;
  INLINE_MARKDOWN_RE.lastIndex = 0;
  while ((m = INLINE_MARKDOWN_RE.exec(raw))) {
    out += escapeHtml(raw.slice(last, m.index));
    if (m[1] !== undefined) {
      out += `<a href="${escapeHtml(m[2])}">${escapeHtml(m[1])}</a>`;
    } else if (m[3] !== undefined) {
      out += `<strong>${escapeHtml(m[3])}</strong>`;
    } else {
      out += `<em>${escapeHtml(m[4])}</em>`;
    }
    last = INLINE_MARKDOWN_RE.lastIndex;
  }
  out += escapeHtml(raw.slice(last));
  return out;
}

const HEADING_RE = /^(#{1,3})\s+(.*)$/;
const QUOTE_RE = /^>\s?(.*)$/;
const DIVIDER_RE = /^-{3,}$/;
const IMAGE_RE = /^!\[([^\]]*)\]\(([^)]+)\)$/;
const PHOTO_ID_RE = /^PHOTO:(.+)$/;

/**
 * markdown → DocBlock[]。逐行扫描：# / ## / ### 开头→styled h2/h3，> 开头→styled quote（连续行合并，
 * 用 <br> 连接），--- 独占一行→styled divider，![alt](url|PHOTO:id) 独占一行→styled imageCard，
 * 其余非空行归入 para（连续行合并为一个 para block，同样用 <br> 连接，行内跑 **bold**、*em*、[a](url) 转换）。
 * PHOTO:id 在 photosMap 查不到时不生成 imageCard（避免画布出现死图），整行原文转义后降级为一个 para，
 * 保证来稿内容不会静默丢失、可被用户看到并手动修复。
 * @param {string} markdown
 * @param {{photosMap?: Object, blockConfig?: Object}} options
 * @returns {Array}
 */
export function markdownToDoc(markdown, options) {
  const opts = options || {};
  const photosMap = opts.photosMap || {};
  const blockConfig = opts.blockConfig || {};
  const lines = String(markdown == null ? '' : markdown).replace(/\r\n?/g, '\n').split('\n');

  const blocks = [];
  let paraBuf = [];
  let quoteBuf = [];

  function flushPara() {
    if (!paraBuf.length) return;
    blocks.push(makeParaBlock(paraBuf.map(formatInlineMarkdown).join('<br>')));
    paraBuf = [];
  }
  function flushQuote() {
    if (!quoteBuf.length) return;
    blocks.push(makeStyledBlock('quote', blockConfig, { content: quoteBuf.join('<br>') }));
    quoteBuf = [];
  }

  lines.forEach((rawLine) => {
    const trimmed = rawLine.trim();

    if (trimmed === '') {
      flushPara();
      flushQuote();
      return;
    }

    const headingMatch = HEADING_RE.exec(trimmed);
    if (headingMatch) {
      flushPara();
      flushQuote();
      const type = headingMatch[1].length >= 3 ? 'h3' : 'h2';
      blocks.push(makeStyledBlock(type, blockConfig, { content: headingMatch[2].trim() }));
      return;
    }

    const imageMatch = IMAGE_RE.exec(trimmed);
    if (imageMatch) {
      flushPara();
      flushQuote();
      const alt = imageMatch[1];
      const hrefRaw = imageMatch[2].trim();
      const photoMatch = PHOTO_ID_RE.exec(hrefRaw);
      if (photoMatch) {
        const url = photosMap[photoMatch[1]];
        if (url) {
          blocks.push(makeStyledBlock('imageCard', blockConfig, { src: url, caption: alt }));
        } else {
          // 查不到对应图片：保留占位符原文，降级为普通段落，不静默丢内容
          blocks.push(makeParaBlock(escapeHtml(trimmed)));
        }
      } else {
        blocks.push(makeStyledBlock('imageCard', blockConfig, { src: hrefRaw, caption: alt }));
      }
      return;
    }

    if (DIVIDER_RE.test(trimmed)) {
      flushPara();
      flushQuote();
      blocks.push(makeStyledBlock('divider', blockConfig, {}));
      return;
    }

    const quoteMatch = QUOTE_RE.exec(trimmed);
    if (quoteMatch) {
      flushPara();
      quoteBuf.push(quoteMatch[1]);
      return;
    }

    flushQuote();
    paraBuf.push(trimmed);
  });

  flushPara();
  flushQuote();

  return blocks;
}

// ---------------------------------------------------------------------------
// docToHtml：DocBlock[] → 全内联 HTML（复制导出用，与画布渲染同源）
// ---------------------------------------------------------------------------

const DEFAULT_BODY = { fontSize: 15, lineHeight: 1.75, textIndent: false, justify: true };
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const FONT_STACK = "-apple-system,BlinkMacSystemFont,'Helvetica Neue','PingFang SC','Microsoft YaHei',sans-serif";

// accent 只放行 #RRGGBB，非法值一律视为"未设置"而不是 throw——docToHtml 面向整篇文档批量渲染，
// 单个块的脏 accent 不应该打断整篇导出（styled 块自身的 accent 校验交给 applyBlock 内部的 sanitizeAccent）
function normalizeAccent(accent) {
  const s = accent == null ? '' : String(accent);
  return HEX_COLOR_RE.test(s) ? s : '';
}

// 与 themes.js computeBodyStyles 的 p/strong/em/a 输出格式保持一致（15px/1.75/两端对齐/首行缩进按
// body.textIndent），但不 import 该私有函数，在本文件内独立构造
function computeParaBodyStyles(bodyConfig, accent) {
  const body = { ...DEFAULT_BODY, ...(bodyConfig || {}) };
  const fontSize = Number(body.fontSize) || DEFAULT_BODY.fontSize;
  const lineHeight = body.lineHeight || DEFAULT_BODY.lineHeight;
  const justify = body.justify !== false;
  const textIndent = Boolean(body.textIndent);
  const align = justify ? 'justify' : 'left';
  const indent = textIndent ? 'text-indent:2em;' : '';
  // 全局属性可自定义：字间距 / 正文色 / 段间距（未设置时沿用原默认值，保持向后兼容）
  const letterSpacing = body.letterSpacing != null ? `${Number(body.letterSpacing)}px` : '0.03em';
  const color = HEX_COLOR_RE.test(String(body.color || '')) ? body.color : '#333333';
  const paraSpacing = body.paraSpacing != null ? Number(body.paraSpacing) : 20;
  return {
    p: `font-size:${fontSize}px;line-height:${lineHeight};color:${color};letter-spacing:${letterSpacing};text-align:${align};${indent}margin:0 0 ${paraSpacing}px;`,
    strong: `font-weight:700;color:${accent};`,
    em: 'color:#666666;font-style:italic;',
    a: `color:${accent};text-decoration:underline;`,
  };
}

// 页面级样式（背景色 / 左右留白）→ 外层 section 内联样式片段。默认无（不改变既有观感）。
export function computePageStyleString(page) {
  const p = page || {};
  let css = '';
  if (HEX_COLOR_RE.test(String(p.bg || ''))) css += `background-color:${p.bg};`;
  const padX = Number(p.paddingX);
  if (p.paddingX != null && Number.isFinite(padX) && padX > 0) css += `padding-left:${padX}px;padding-right:${padX}px;`;
  return css;
}

// 全文统计：字数（中文按字、英文按词）、字符、块/段、图片、预计阅读分钟。纯函数，UI 直接用。
export function computeDocStats(doc) {
  const text = docToPlainText(doc) || '';
  const cjk = (text.match(/[一-鿿㐀-䶿]/g) || []).length;
  const words = (text.match(/[A-Za-z0-9]+(?:['-][A-Za-z0-9]+)*/g) || []).length;
  const chars = text.replace(/\s/g, '').length; // 不含空白的字符数
  const blocks = Array.isArray(doc) ? doc.filter(Boolean) : [];
  const textBlocks = blocks.filter((b) => b.kind === 'para' || b.kind === 'raw' || (b.kind === 'styled' && (b.type === 'h2' || b.type === 'h3' || b.type === 'quote' || b.type === 'signoff')));
  let images = 0;
  blocks.forEach((b) => {
    if (b.kind === 'styled' && b.type === 'imageCard') images += 1;
    else if (b.kind === 'raw') images += (String(b.html || '').match(/<img\b/gi) || []).length;
  });
  const wordCount = cjk + words; // 中文字 + 英文词
  const readMinutes = Math.max(1, Math.round(wordCount / 350)); // 约 350 字/分钟
  return { wordCount, cjk, words, chars, blocks: blocks.length, paragraphs: textBlocks.length, images, readMinutes };
}

// 块级间距微调（行距 line-height + 四向边距，边距可负）。存于 block.spacing，画布与导出同源应用。
// 只保留已显式设置且有限的数值键——未设置的键不落样式，保持样式块/正文原有默认值。
export function spacingToStyleObject(spacing) {
  const s = spacing || {};
  const out = {};
  const lh = Number(s.lineHeight);
  if (s.lineHeight != null && Number.isFinite(lh)) out.lineHeight = String(lh);
  ['marginTop', 'marginBottom', 'marginLeft', 'marginRight'].forEach((k) => {
    const v = Number(s[k]);
    if (s[k] != null && Number.isFinite(v)) out[k] = `${v}px`;
  });
  return out;
}

// 同一份间距 → 内联 CSS 字符串（用于导出 HTML；追加在既有 style 之后，靠后声明覆盖 margin 简写/line-height）
export function spacingToStyleString(spacing) {
  const o = spacingToStyleObject(spacing);
  const kebab = { lineHeight: 'line-height', marginTop: 'margin-top', marginBottom: 'margin-bottom', marginLeft: 'margin-left', marginRight: 'margin-right' };
  return Object.keys(o).map((k) => `${kebab[k]}:${o[k]};`).join('');
}

// para.html 只可能含 markdownToDoc/sanitizeParaHtml 产出的裸标签（<strong>/<em>/<br>/<a href="...">，
// 不带任何 style 属性），这里按 bodyStyles 补内联样式，保证导出效果与画布/themes.js 正文视觉一致
function styleParaInlineHtml(html, bodyStyles) {
  return String(html || '')
    .replace(/<strong>/g, `<strong style="${bodyStyles.strong}">`)
    .replace(/<em>/g, `<em style="${bodyStyles.em}">`)
    .replace(/<a\s+href="([^"]*)"\s*>/g, (_m, href) => `<a href="${href}" style="${bodyStyles.a}">`);
}

// aspect 裁切用的 padding-bottom 百分比：P = 比例的高/宽*100，只收窄到这 4 个字面量枚举值，
// 不做通用比例解析，避免浮点误差（4:3 精确算出来是 133.33...3 的循环小数，这里锁定 133.33 两位小数）
const ASPECT_PADDING_PCT = { '1:1': 100, '4:3': 75, '16:9': 56.25, '3:4': 133.33 };

// imageCard 的 imgStyle 后处理：只处理 applyBlock 产出 HTML 里的第一个 <img>（imageCard 模板恒单图），
// style 合并复用 mergeImgTagStyle（与 applyRawImgStyle 同一份合并原语，不重复造）。无 imgStyle 或
// widthPct/radius/aspect 全是默认值时提前返回原样，保证不破坏既有 golden 输出
function applyImageCardImgStyle(blockHtml, imgStyle) {
  const style = imgStyle || {};
  const widthPct = Number(style.widthPct);
  const hasWidth = Number.isFinite(widthPct) && widthPct !== 100 && widthPct >= 25 && widthPct <= 100;
  const radius = Number(style.radius);
  const hasRadius = Number.isFinite(radius) && radius > 0;
  const aspectPct = style.aspect ? ASPECT_PADDING_PCT[style.aspect] : null;

  if (!hasWidth && !hasRadius && !aspectPct) return blockHtml;

  const imgMatches = blockHtml.match(IMG_TAG_RE);
  if (!imgMatches || !imgMatches.length) return blockHtml;
  const originalImgTag = imgMatches[0];

  let replacement;
  if (aspectPct != null) {
    // 裁切容器方案：overflow:hidden + height:0 + padding-bottom 撑比例（公众号存活规则内的写法）；
    // img 本身只补 width:100%;display:block 填满容器；radius 显式设置时才把 img 自带的 border-radius
    // 摘掉挪到容器上（否则模板自带的圆角会留在被方框裁切的 img 上，跟容器边界对不齐）
    const imgUpdates = { width: '100%', display: 'block' };
    if (hasRadius) imgUpdates['border-radius'] = null;
    const imgTag = mergeImgTagStyle(originalImgTag, imgUpdates);
    const containerDecls = [['overflow', 'hidden'], ['height', '0'], ['padding-bottom', `${aspectPct}%`]];
    if (hasRadius) containerDecls.push(['border-radius', `${radius}px`]);
    let wrapped = `<section style="${stringifyStyleDecls(containerDecls)}">${imgTag}</section>`;
    if (hasWidth) {
      // widthPct 与 aspect 同时存在：再包一层居中限宽容器控制整体宽度，裁切容器本身恒 100% 撑满它
      wrapped = `<section style="width:${widthPct}%;margin:0 auto;">${wrapped}</section>`;
    }
    replacement = wrapped;
  } else {
    const imgUpdates = {};
    if (hasWidth) {
      imgUpdates.width = `${widthPct}%`;
      // widthPct<100 时才需要居中（=100 时已被 hasWidth 的 !==100 判定排除，两者在合法值域内等价）
      imgUpdates.display = 'block';
      imgUpdates['margin-left'] = 'auto';
      imgUpdates['margin-right'] = 'auto';
    }
    if (hasRadius) imgUpdates['border-radius'] = `${radius}px`;
    replacement = mergeImgTagStyle(originalImgTag, imgUpdates);
  }

  // originalImgTag 里可能含 $ 字符（URL 常见），用函数式 replacer 避免被当成特殊替换模式解析
  return blockHtml.replace(originalImgTag, () => replacement);
}

// styled 块引用的 blockId 在 blocksById 里找不到（提取块被删/草稿引用失效 id）时，回退同类型 minimal
// 内置块，绝不让整篇导出因单个块失效而报错——与 themes.js lookupBlock 的兜底哲学一致，独立实现一份
function lookupStyleBlock(blocksById, type, blockId) {
  const block = blocksById[blockId];
  if (block) {
    if (block.type && block.type !== type) {
      throw new Error(`docToHtml: 样式块类型不匹配，期望 type=${type}，实际 type=${block.type}（id=${blockId}）`);
    }
    return block;
  }
  const fallbackId = DEFAULT_BLOCK_IDS[type];
  const fallback = fallbackId ? BUILTIN_BLOCKS_BY_ID[fallbackId] : null;
  if (fallback) {
    console.warn(`[docModel] 样式块缺失 type=${type} id=${blockId}，已回退 ${fallbackId}`);
    return fallback;
  }
  throw new Error(`docToHtml: 未找到样式块 type=${type} id=${blockId}`);
}

/**
 * 未清洗版本，仅供 Node 自测脚本使用（DOMPurify.sanitize 需要浏览器 window，纯 Node 环境无法调用）；
 * 正式对外路径请用 docToHtml。
 * @param {Array} doc
 * @param {{blocksById?: Object, globalAccent?: string, body?: Object}} options
 * @returns {{html: string, imageCount: number}}
 */
export function docToHtmlRaw(doc, options) {
  const opts = options || {};
  const blocksById = { ...BUILTIN_BLOCKS_BY_ID, ...(opts.blocksById || {}) };
  const globalAccent = normalizeAccent(opts.globalAccent) || '#1a1a1a';
  const bodyStyles = computeParaBodyStyles(opts.body, globalAccent);
  const themePalette = derivePalette(globalAccent); // 主题色联动：raw 块内 data-mm-theme 标注元素按此刷色
  let imageCount = 0;

  const parts = (Array.isArray(doc) ? doc : []).map((block) => {
    if (!block) return '';
    if (block.kind === 'para') {
      // 块级间距追加在正文样式之后，覆盖默认 line-height/margin（含负边距）
      return `<p style="${bodyStyles.p}${spacingToStyleString(block.spacing)}">${styleParaInlineHtml(block.html, bodyStyles)}</p>`;
    }
    if (block.kind === 'raw') {
      // 整文导入块：html 在导入与每次失焦提交时都已过 sanitizeRawHtml，这里原样拼接保排版，
      // 不套 para 正文样式（原文自带全套内联样式）；最终导出还会过 docToHtml 的 DOMPurify 兜底。
      // 主题色联动：把带 data-mm-theme 标注的元素按当前调色板刷色，让导出/复制/预览与画布一致。
      imageCount += (String(block.html || '').match(/<img\b/gi) || []).length;
      const rawOut = applyThemeMasksToHtml(block.html, themePalette);
      const spacingCss = spacingToStyleString(block.spacing);
      // 有块级间距时套一层 section 承载（margin 调块间距、line-height 级联子元素）；无则原样拼接
      return spacingCss ? `<section style="${spacingCss}">${rawOut}</section>` : rawOut;
    }
    const type = block.type;
    const styleBlock = lookupStyleBlock(blocksById, type, block.blockId);
    const accent = normalizeAccent(block.accent) || globalAccent;
    if (type === 'imageCard') {
      imageCount += 1;
      const rendered = applyBlock(styleBlock, {
        src: escapeHtml(block.src || ''),
        caption: escapeHtml(block.caption || ''),
        accent,
      });
      return applyImageCardImgStyle(rendered, block.imgStyle);
    }
    if (type === 'divider') {
      return applyBlock(styleBlock, { accent });
    }
    // h2/h3/quote/signoff
    return applyBlock(styleBlock, { content: escapeContentWithBreaks(block.content || ''), accent });
  });

  const html = `<section style="font-family:${FONT_STACK};color:#333333;${computePageStyleString(opts.page)}">${parts.join('\n')}</section>`;
  return { html, imageCount };
}

/**
 * DocBlock[] → 公众号可粘贴的全内联 HTML。与画布渲染同源（styled 块走 applyBlock，para 走本文件构造的
 * 正文样式），复制导出的最终边界，过一遍 DOMPurify（配置与 themes.js renderWechatHtml 一致）。
 * @param {Array} doc
 * @param {{blocksById?: Object, globalAccent?: string, body?: Object}} options
 * @returns {{html: string, imageCount: number}}
 */
export function docToHtml(doc, options) {
  const { html, imageCount } = docToHtmlRaw(doc, options);
  const safe = DOMPurify.sanitize(html, {
    FORBID_TAGS: ['style', 'script', 'iframe', 'object', 'embed', 'input', 'form'],
    // 放行 SVG SMIL 动画标签 + foreignObject，保住整文复现里可点击 SVG 的交互与彩色层（见各常量注释）
    ADD_TAGS: SVG_ALL_TAGS,
    // referrerpolicy 是整文导入的 mmbiz 图片防盗链通行证（no-referrer），导出时必须保留
    ADD_ATTR: ['style', 'referrerpolicy', ...SVG_SMIL_ATTRS],
  });
  return { html: safe, imageCount };
}

// 「复制到公众号」专用：把整文复现里 background-image / <img> 上的 /api/wx-img?url=<mmbiz> 外链代理
// 还原为原始 mmbiz 链接。代理链只在本站(非微信)预览时用来绕 mmbiz 防盗链水印；粘进公众号编辑器时
// 代理链是本站地址、微信里无效，必须还原成 mmbiz 原链(在微信 referer 下能正常显示，等同复制原文)。
// 只用于剪贴板导出这一条路——手机预览仍走代理链(非微信浏览器要靠它避免水印)，故不放进 docToHtml。
export function unproxyWeChatImages(html) {
  return String(html || '').replace(/\/api\/wx-img\?url=([^&"')\s]+)/g, (match, enc) => {
    try {
      const orig = decodeURIComponent(enc);
      if (!/^https?:\/\/[^/]*\b(qpic|qlogo)\.cn\//i.test(orig)) return match; // 仅还原微信图片 CDN
      return orig.replace(/&/g, '&amp;'); // 放回 HTML 属性/style，& 需转义
    } catch {
      return match;
    }
  });
}

// 「复制·SVG源码版」白名单硬化：公众号后台白名单对 background:url() 地址【加引号会整段过滤】。
// 把 url() 内的引号(普通引号或 &quot;/&#39; 实体)去掉。mmbiz 链接无空格/括号，去引号安全。
export function dequoteWeChatCssUrls(html) {
  return String(html || '').replace(/url\(([^)]*)\)/gi, (m, inner) => {
    const cleaned = inner
      .replace(/^\s*(?:&quot;|&#0*34;|&#0*39;|&apos;|['"])?\s*/, '')
      .replace(/\s*(?:&quot;|&#0*34;|&#0*39;|&apos;|['"])?\s*$/, '')
      .trim();
    return `url(${cleaned})`;
  });
}

// 「复制到公众号」专用：把无文字的"图片容器"上的 CSS background-image 就地展平成真 <img>。
// 原因(adb 实测)：微信编辑器粘贴时会强剥 CSS 背景图 + <svg> 占位 + SVG 动画，只保留 <img>
// 并自动转存到你自己的素材库。设计文(135/秀米)靠背景图铺版,直接粘过去图全没;转成 <img> 后
// 图至少能显示(代价:丢叠层版式和交互,退化成图片流)。只在导出这一路做,预览仍用背景图保真。
// 仅对无实义文字的容器展平(避免给文字块塞图),且只处理最外层背景图元素(避嵌套重复出图)。
export function flattenWeChatBgToImg(html) {
  if (typeof DOMParser === 'undefined') return html; // 非浏览器环境(Node 自测)跳过
  const doc = new DOMParser().parseFromString(`<div id="__mm_flat__">${String(html || '')}</div>`, 'text/html');
  const root = doc.getElementById('__mm_flat__');
  if (!root) return html;
  const candidates = Array.from(root.querySelectorAll('*')).filter((el) => /background-image\s*:\s*url\(/i.test(el.getAttribute('style') || ''));
  const seen = new Set(); // 同一张图只展平出一次(设计文常把同图铺在多层容器上,避免重复出图)
  candidates.forEach((el) => {
    const style = el.getAttribute('style') || '';
    const m = style.match(/background-image\s*:\s*url\(\s*["']?([^)"']+?)["']?\s*\)/i);
    if (!m) return;
    let url = m[1].trim();
    if (/\/api\/wx-img\?url=/.test(url)) { try { url = decodeURIComponent(url.split('url=')[1]); } catch { /* keep */ } }
    if (!/^https?:\/\/[^/]*\b(qpic|qlogo)\.cn\//i.test(url)) return; // 只处理微信图片 CDN
    if ((el.textContent || '').trim().length > 0) return;            // 有文字的块不塞图
    if (seen.has(url)) return;                                        // 同图去重(取首次出现位置)
    seen.add(url);
    const img = doc.createElement('img');
    img.setAttribute('src', url);
    img.setAttribute('referrerpolicy', 'no-referrer');
    img.setAttribute('style', 'display:block;width:100%;height:auto;');
    el.setAttribute('style', style.replace(/background-image\s*:\s*url\([^)]*\)\s*;?/ig, '').replace(/background-(size|position|repeat)\s*:[^;]*;?/ig, ''));
    el.insertBefore(img, el.firstChild);
  });
  return root.innerHTML;
}

// ---------------------------------------------------------------------------
// docToPlainText：纯文本导出（复制的 text/plain 分支）
// ---------------------------------------------------------------------------

function htmlToPlainText(html) {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?(strong|em|a)(?:\s[^>]*)?>/gi, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

// raw 块（整文导入）的富 HTML → 纯文本：块级闭合标签折行、其余标签剥除、常见实体还原
function rawHtmlToPlainText(html) {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|section|div|h[1-6]|li|blockquote|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * DocBlock[] → 纯文本（复制 text/plain 兜底用）。para 剥标签转义还原；styled 文本块取 content 并把
 * 字面量 <br> 还原成换行；imageCard 用图注占位，无图注用 "[图片]"；divider 用一行短横线占位；
 * raw 块剥全部标签取文字。
 * @param {Array} doc
 * @returns {string}
 */
export function docToPlainText(doc) {
  const parts = (Array.isArray(doc) ? doc : [])
    .map((block) => {
      if (!block) return '';
      if (block.kind === 'para') return htmlToPlainText(block.html);
      if (block.kind === 'raw') return rawHtmlToPlainText(block.html);
      if (block.type === 'divider') return '----';
      if (block.type === 'imageCard') return block.caption ? `[图片：${block.caption}]` : '[图片]';
      return String(block.content || '').split('<br>').join('\n');
    })
    .filter((s) => s !== '');
  return parts.join('\n\n');
}

// ---------------------------------------------------------------------------
// createHistory：结构操作历史栈（栈上限 50，深拷贝存储）
// ---------------------------------------------------------------------------

const HISTORY_LIMIT = 50;

// DocBlock 字段全是字符串/null 等 JSON 安全值，JSON 往返克隆足够且比 structuredClone 兼容性更好
function cloneDoc(doc) {
  return JSON.parse(JSON.stringify(doc == null ? [] : doc));
}

/**
 * 创建一个文档历史栈：push 写入新快照（会截断当前指针之后的 redo 分支），undo/redo 移动指针并返回
 * 深拷贝快照（栈空/已到边界返回 null，调用方不应据此清空画布）。超过 50 条时丢弃最旧快照。
 * @param {Array} initialDoc
 * @returns {{push: Function, undo: Function, redo: Function, canUndo: Function, canRedo: Function}}
 */
export function createHistory(initialDoc) {
  let stack = [cloneDoc(initialDoc)];
  let index = 0;

  function push(doc) {
    // 在历史中间发生新操作时丢弃当前指针之后的旧 redo 分支，这是标准撤销栈语义
    stack = stack.slice(0, index + 1);
    stack.push(cloneDoc(doc));
    if (stack.length > HISTORY_LIMIT) {
      stack.shift();
    }
    index = stack.length - 1;
  }

  function undo() {
    if (index <= 0) return null;
    index -= 1;
    return cloneDoc(stack[index]);
  }

  function redo() {
    if (index >= stack.length - 1) return null;
    index += 1;
    return cloneDoc(stack[index]);
  }

  function canUndo() {
    return index > 0;
  }

  function canRedo() {
    return index < stack.length - 1;
  }

  return { push, undo, redo, canUndo, canRedo };
}

// ---------------------------------------------------------------------------
// sanitizeRawHtml：raw 块（整文导入）富 HTML 清洗
// ---------------------------------------------------------------------------

// raw 块要保留原文全部内联样式与结构标签，不能走 sanitizeParaHtml 的四标签白名单（会剥掉排版），
// 只禁"可执行/可外联"类标签；on* 事件属性由 DOMPurify 默认剥除
const RAW_FORBID_TAGS = ['script', 'style', 'iframe', 'link', 'meta', 'base', 'form', 'input', 'button', 'object', 'embed', 'video', 'audio'];

/**
 * raw 块内容清洗：服务端导入接口已洗过一遍，这里是画布 contenteditable 编辑提交与草稿回读的
 * 客户端防线。浏览器环境走 DOMPurify；Node 自测环境（无 window，DOMPurify 不可用）退回正则
 * 剥 script/style/iframe 与 on* 属性——与 docToHtmlRaw/docToHtml 的双轨约定一致，
 * 正式对外路径永远在浏览器里执行。
 * @param {string} html
 * @returns {string}
 */
export function sanitizeRawHtml(html) {
  const input = String(html == null ? '' : html);
  if (typeof window !== 'undefined' && DOMPurify && DOMPurify.isSupported) {
    return DOMPurify.sanitize(input, {
      FORBID_TAGS: RAW_FORBID_TAGS,
      // 放行 SVG SMIL 动画标签/属性 + foreignObject，保住整文复现里可点击 SVG 的交互与彩色层（见各常量注释）
      ADD_TAGS: SVG_ALL_TAGS,
      ADD_ATTR: ['style', 'referrerpolicy', ...SVG_SMIL_ATTRS],
    });
  }
  let out = input;
  out = out.replace(/<(script|style|iframe)\b[\s\S]*?<\/\1\s*>/gi, '');
  out = out.replace(/<!--[\s\S]*?-->/g, '');
  out = out.replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, '');
  out = out.replace(/\son[a-z]+\s*=\s*'[^']*'/gi, '');
  out = out.replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, '');
  return out;
}

// ---------------------------------------------------------------------------
// splitRawHtml / replaceRawImgSrc / applyRawImgStyle：raw 块（整文导入）拆分与图片编辑
// ---------------------------------------------------------------------------

// 与后端 wechat_article_import 同规则：只有恰好 1 个有效子节点且是 SECTION/DIV 容器时才下钻取其子节点，
// 最多下钻 6 层，避免层层嵌套的空壳容器导致过度递归
const RAW_SPLIT_MAX_DRILL = 6;

function isBlankTextNode(node) {
  return node.nodeType === 3 && node.textContent.trim() === '';
}

// "有效子节点" = 元素节点，或非纯空白的文本节点（纯空白文本节点只是排版留白，不构成拆分单元）
function effectiveChildNodes(node) {
  return Array.from(node.childNodes).filter((n) => !isBlankTextNode(n));
}

/**
 * raw 块（整文导入的富 HTML 容器）拆分为顶层子元素序列，供画布把整文导入拆成多个可独立编辑的块。
 * 只在浏览器环境（DOMParser 可用）生效；Node 自测环境没有 DOMParser，直接整段原样回退返回，
 * 真正的拆分路径交给浏览器里的集成测试覆盖。元素子节点取 outerHTML，散落的非空白文本节点包一层
 * <p>（转义）避免丢内容；拆出结果 ≥2 个才算拆分成功，否则视为"本来就是单一顶层结构"，返回 [html] 原样。
 * @param {string} html
 * @returns {string[]}
 */
export function splitRawHtml(html) {
  const input = String(html == null ? '' : html);
  if (typeof DOMParser === 'undefined') {
    return [input];
  }
  const parsed = new DOMParser().parseFromString(input, 'text/html');
  let container = parsed.body;
  let children = effectiveChildNodes(container);
  let drill = 0;
  while (
    drill < RAW_SPLIT_MAX_DRILL &&
    children.length === 1 &&
    children[0].nodeType === 1 &&
    (children[0].tagName === 'SECTION' || children[0].tagName === 'DIV')
  ) {
    container = children[0];
    children = effectiveChildNodes(container);
    drill += 1;
  }
  // 负边距层叠组归并（与后端 wechat_article_import.groupOverlappingNodes 同规则）：
  // 秀米/135 的"大字底纹压标题"靠负外边距实现（margin-bottom:-28px 让下一节上移覆盖本节），
  // 层叠双方拆进不同块会断掉覆盖关系（画布逐块渲染），手动拆分也必须保持整组不拆。
  // 浏览器有 CSSOM，el.style.marginTop/Bottom 自动展开 margin 简写。
  const pxVal = (v) => {
    const m = String(v || '').trim().match(/^(-?\d+(?:\.\d+)?)px$/);
    return m ? parseFloat(m[1]) : 0;
  };
  const groups = [];
  let prevHadNegBottom = false;
  children.forEach((node) => {
    const isEl = node.nodeType === 1;
    const top = isEl ? pxVal(node.style && node.style.marginTop) : 0;
    const bottom = isEl ? pxVal(node.style && node.style.marginBottom) : 0;
    const html_ = isEl ? node.outerHTML : `<p>${escapeHtml(node.textContent)}</p>`;
    if (groups.length && (top < 0 || prevHadNegBottom)) {
      groups[groups.length - 1] += html_;
    } else {
      groups.push(html_);
    }
    prevHadNegBottom = bottom < 0;
  });
  return groups.length >= 2 ? groups : [input];
}

/**
 * 把 html 里第 imgIndex 个（0 基）<img> 标签的 src 替换为 newSrc；该标签本没有 src 属性时插入一个。
 * newSrc 转义复用 escapeAttr（引号/尖括号转义防属性逃逸，顺带正确转义 & 保证属性值本身合法）。
 * imgIndex 越界（含负数/非整数）原样返回 html。
 * @param {string} html
 * @param {number} imgIndex
 * @param {string} newSrc
 * @returns {string}
 */
export function replaceRawImgSrc(html, imgIndex, newSrc) {
  const input = String(html == null ? '' : html);
  if (!Number.isInteger(imgIndex) || imgIndex < 0) return input;
  const safeSrc = escapeAttr(newSrc);
  let count = -1;
  let matched = false;
  const out = input.replace(IMG_TAG_RE, (tag) => {
    count += 1;
    if (count !== imgIndex) return tag;
    matched = true;
    if (IMG_SRC_ATTR_RE.test(tag)) {
      return tag.replace(IMG_SRC_ATTR_RE, ` src="${safeSrc}"`);
    }
    return tag.replace(/^<img\b/i, `<img src="${safeSrc}"`);
  });
  return matched ? out : input;
}

// ---------------------------------------------------------------------------
// 通用「照片元素」——整文复现里照片有三种形态：<img>、svg <image>、带 background-image:url() 的元素
// （SVG 特效的彩色层/轮播幻灯/背景大图全是后两种）。点选→换图/编辑不能只认 <img>，要三种通吃。
// listRawPhotos/replaceRawPhotoSrc 与 CanvasEditor RawView 的实时 DOM 用「querySelectorAll('*') 过滤 +
// 文档序」同一口径，保证点击命中的下标与字符串替换的下标一致。
// ---------------------------------------------------------------------------
const BG_URL_RE = /background-image\s*:\s*[^;}"']*url\(\s*['"]?([^)'"]+)/i;
export function isRawPhotoEl(el) {
  if (!el || el.nodeType !== 1) return false;
  const tag = (el.tagName || '').toLowerCase();
  if (tag === 'img' || tag === 'image') return true;
  const st = (el.getAttribute && el.getAttribute('style')) || '';
  return BG_URL_RE.test(st);
}
function rawPhotoKind(el) {
  const tag = (el.tagName || '').toLowerCase();
  return tag === 'img' ? 'img' : (tag === 'image' ? 'image' : 'bg');
}
function rawPhotoUrlOf(el) {
  const tag = (el.tagName || '').toLowerCase();
  if (tag === 'img') return el.getAttribute('src') || '';
  if (tag === 'image') return el.getAttribute('href') || el.getAttribute('xlink:href') || '';
  const m = ((el.getAttribute('style') || '').match(BG_URL_RE));
  return m ? m[1] : '';
}
function setRawPhotoUrl(el, url) {
  const tag = (el.tagName || '').toLowerCase();
  if (tag === 'img') { el.setAttribute('src', url); return; }
  if (tag === 'image') { el.setAttribute('href', url); el.removeAttribute('xlink:href'); return; }
  const st = el.getAttribute('style') || '';
  const next = /background-image\s*:/i.test(st)
    ? st.replace(/background-image\s*:\s*[^;]*/i, `background-image: url(${url})`)
    : `${st}${st && !/;\s*$/.test(st) ? '; ' : ''}background-image: url(${url})`;
  el.setAttribute('style', next);
}
function collectRawPhotoEls(root) {
  return Array.from(root.querySelectorAll('*')).filter(isRawPhotoEl);
}
/** 列出一段 raw html 里全部照片（文档序）：[{kind:'img'|'image'|'bg', url}]。仅浏览器环境（DOMParser）。 */
export function listRawPhotos(html) {
  if (typeof DOMParser === 'undefined') return [];
  const doc = new DOMParser().parseFromString(String(html == null ? '' : html), 'text/html');
  return collectRawPhotoEls(doc.body).map((el) => ({ kind: rawPhotoKind(el), url: rawPhotoUrlOf(el) }));
}
/** 把第 index 个（文档序，0 基）照片元素的图源换成 newUrl（img→src / image→href / bg→background-image url）。 */
export function replaceRawPhotoSrc(html, index, newUrl) {
  const input = String(html == null ? '' : html);
  if (typeof DOMParser === 'undefined' || !Number.isInteger(index) || index < 0 || !newUrl) return input;
  const doc = new DOMParser().parseFromString(input, 'text/html');
  const photos = collectRawPhotoEls(doc.body);
  if (!photos[index]) return input;
  setRawPhotoUrl(photos[index], String(newUrl));
  return doc.body.innerHTML;
}

// 把从 Word/富文本编辑器粘贴的剪贴板内容切成「段落」数组（每段=转义后的纯文本）。解决用户诉求：
// Word 里分好段的文字，粘进块编辑器的一个 contenteditable 会被合并成一段。Word 复制的 text/html 带
// <p>/<div> 分段，据此逐段切；拿不到 html 就按纯文本换行切。沿用编辑器"粘贴降级为纯文本"的既有口径
// （不把 Word 的杂色/字号带进来），只恢复分段——每段会各自成为一个 para 块（Notion 式一段一块）。
export function splitPastedToParagraphs(html, text) {
  const BLOCK_SEL = 'p, div, li, h1, h2, h3, h4, h5, h6, blockquote, tr, pre, section';
  if (typeof DOMParser !== 'undefined' && html && /<\w/.test(String(html))) {
    const doc = new DOMParser().parseFromString(String(html), 'text/html');
    // 叶子块（不再包含更内层块元素的）作为分段单位，避免嵌套块重复计数
    const leaves = Array.from(doc.body.querySelectorAll(BLOCK_SEL)).filter((b) => !b.querySelector(BLOCK_SEL));
    let lines;
    if (leaves.length > 0) {
      lines = leaves.map((b) => String(b.textContent || '').replace(/\u00a0/g, ' ').trim());
    } else {
      // 无块级元素：把 <br> 当换行，再取纯文本按行切
      const holder = doc.createElement('div');
      holder.innerHTML = String(html).replace(/<br\s*\/?>/gi, '\n');
      lines = String(holder.textContent || '').split(/\n/).map((s) => s.replace(/\u00a0/g, ' ').trim());
    }
    const out = lines.filter((l) => l.length > 0).map((l) => escapeHtml(l));
    if (out.length) return out;
  }
  return String(text || '')
    .split(/\r\n|\r|\n/)
    .map((l) => l.replace(/\u00a0/g, ' ').trim())
    .filter((l) => l.length > 0)
    .map((l) => escapeHtml(l));
}

// 某元素所属的「最外层 svg」（含自身）。用于把叠层照片按 svg 单位分组。
function outermostSvgOf(el) {
  let top = null;
  let n = el;
  while (n && n.nodeType === 1) {
    const tag = ((n.tagName && (n.tagName.baseVal || n.tagName)) || '').toLowerCase();
    if (tag === 'svg') top = n;
    n = n.parentElement;
  }
  return top;
}
/**
 * 把一段 raw html 里的照片按「所属最外层 svg」分组——供「按 svg 列出可替换的图」逐图替换列表，
 * 解决 Color Walk 那类彩色层叠得太密、鼠标点不准的问题。返回 [{label, photos:[{index, kind, url}]}]，
 * 其中 index 与 listRawPhotos/replaceRawPhotoSrc 完全同口径（文档序），可直接拿去替换/编辑。
 */
export function listRawPhotoGroups(html) {
  if (typeof DOMParser === 'undefined') return [];
  const doc = new DOMParser().parseFromString(String(html == null ? '' : html), 'text/html');
  const photos = collectRawPhotoEls(doc.body);
  const topSvgs = Array.from(doc.body.querySelectorAll('svg')).filter((s) => outermostSvgOf(s) === s);
  const idxOf = new Map();
  topSvgs.forEach((s, i) => idxOf.set(s, i));
  const groups = new Map();
  photos.forEach((el, index) => {
    const top = outermostSvgOf(el);
    const key = top || '__loose__';
    if (!groups.has(key)) {
      groups.set(key, { label: top ? `SVG ${(idxOf.has(top) ? idxOf.get(top) : 0) + 1}` : '独立图片', photos: [] });
    }
    groups.get(key).photos.push({ index, kind: rawPhotoKind(el), url: rawPhotoUrlOf(el) });
  });
  return Array.from(groups.values());
}

/**
 * 给 html 里第 imgIndex 个（0 基）<img> 标签合并 style 声明：widthPct 写 width:XX%，并顺带移除该标签
 * 既有的 width style 声明与 HTML width/height 属性防冲突；radius 写 border-radius:XXpx，radius=0
 * 表示移除该声明。除此之外的既有 style 声明原样保留。imgIndex 越界原样返回 html。
 * @param {string} html
 * @param {number} imgIndex
 * @param {{widthPct?: number, radius?: number}} styleObj
 * @returns {string}
 */
// ---- 布局模式：raw 块内某个嵌套元素的相对定位/边距编辑（按 element children 索引路径寻址）----
function resolveElByPath(root, path) {
  let node = root;
  for (let i = 0; i < (path || []).length; i += 1) {
    if (!node || !node.children || !node.children[path[i]]) return null;
    node = node.children[path[i]];
  }
  return node === root ? null : node;
}

// 从一个元素读盒模型样式（live DOM 或 DOMParser 元素通用）：{marginTop,Right,Bottom,Left(px|null), alignH, alignV}
export function readElBoxFromEl(el) {
  if (!el || !el.style) return null;
  const s = el.style;
  const px = (v) => { const n = parseFloat(v); return (v && /px$/.test(v) && Number.isFinite(n)) ? n : null; };
  let alignH = null;
  if (s.marginLeft === 'auto' && s.marginRight === 'auto') alignH = 'center';
  else if (s.marginLeft === 'auto') alignH = 'right';
  else if (s.marginRight === 'auto') alignH = 'left';
  const alignV = { 'flex-start': 'top', center: 'middle', 'flex-end': 'bottom' }[s.alignSelf] || null;
  return {
    marginTop: px(s.marginTop),
    marginRight: s.marginRight === 'auto' ? null : px(s.marginRight),
    marginBottom: px(s.marginBottom),
    marginLeft: s.marginLeft === 'auto' ? null : px(s.marginLeft),
    alignH, alignV,
  };
}

// 把 patch 应用到一个元素的内联样式（live DOM 或 DOMParser 元素通用）。
// patch: marginTop/Right/Bottom/Left(px 数值,可负,null=清)、alignH('left'|'center'|'right'|null)、alignV('top'|'middle'|'bottom'|null)
export function applyElBoxToEl(el, patch) {
  if (!el || !el.style) return;
  const p = patch || {};
  const setPx = (k, v) => { el.style[k] = (v == null ? '' : `${Number(v)}px`); };
  if ('marginTop' in p) setPx('marginTop', p.marginTop);
  if ('marginBottom' in p) setPx('marginBottom', p.marginBottom);
  if ('alignH' in p) {
    if (p.alignH === 'center') { el.style.marginLeft = 'auto'; el.style.marginRight = 'auto'; }
    else if (p.alignH === 'right') { el.style.marginLeft = 'auto'; el.style.marginRight = '0'; }
    else if (p.alignH === 'left') { el.style.marginLeft = '0'; el.style.marginRight = 'auto'; }
    else { el.style.marginLeft = ''; el.style.marginRight = ''; }
    if (p.alignH && (el.tagName === 'IMG' || (el.tagName && el.tagName.toLowerCase() === 'img'))) el.style.display = 'block';
  }
  if ('marginLeft' in p) setPx('marginLeft', p.marginLeft); // 显式左右边距覆盖对齐 auto
  if ('marginRight' in p) setPx('marginRight', p.marginRight);
  if ('alignV' in p) { el.style.alignSelf = { top: 'flex-start', middle: 'center', bottom: 'flex-end' }[p.alignV] || ''; }
}

// 读回目标元素当前盒样式（供面板回显）
export function getElBoxStyle(html, path) {
  try {
    const doc = new DOMParser().parseFromString(`<div id="__r">${html || ''}</div>`, 'text/html');
    return readElBoxFromEl(resolveElByPath(doc.getElementById('__r'), path));
  } catch (e) { return null; }
}

// 写回目标元素样式，返回新 html（持久化用）
export function setElBoxStyle(html, path, patch) {
  try {
    const doc = new DOMParser().parseFromString(`<div id="__r">${html || ''}</div>`, 'text/html');
    const root = doc.getElementById('__r');
    const el = resolveElByPath(root, path);
    if (!el) return html;
    applyElBoxToEl(el, patch);
    return root.innerHTML;
  } catch (e) { return html; }
}

export function applyRawImgStyle(html, imgIndex, styleObj) {
  const input = String(html == null ? '' : html);
  if (!Number.isInteger(imgIndex) || imgIndex < 0) return input;
  const style = styleObj || {};
  const updates = {};
  if (style.widthPct != null) updates.width = `${style.widthPct}%`;
  if (style.radius != null) updates['border-radius'] = style.radius > 0 ? `${style.radius}px` : null;

  let count = -1;
  let matched = false;
  const out = input.replace(IMG_TAG_RE, (tag) => {
    count += 1;
    if (count !== imgIndex) return tag;
    matched = true;
    let nextTag = tag;
    if (style.widthPct != null) {
      nextTag = removeTagAttr(nextTag, IMG_WIDTH_ATTR_RE);
      nextTag = removeTagAttr(nextTag, IMG_HEIGHT_ATTR_RE);
    }
    return mergeImgTagStyle(nextTag, updates);
  });
  return matched ? out : input;
}

// ---------------------------------------------------------------------------
// sanitizeParaHtml：para 内容白名单清洗（contenteditable 粘贴脏 HTML 的防线）
// ---------------------------------------------------------------------------

// 白名单标签：strong/em/br/a/u/span，其余标签（含 script/style/div/img/iframe 等）整体剥掉但保留标签间的
// 文本节点；允许标签一律重新拼出干净版本（不透传原始属性字符串），天然滤掉 onclick/onmouseover 等事件属性
const SANITIZE_ALLOWED_TAGS = new Set(['strong', 'em', 'br', 'a', 'u', 'span']);
// 文字样式编辑产物里的 b/i 归一成语义等价的 strong/em（开闭标签都归一），不额外维持一套并行白名单
const SANITIZE_TAG_ALIASES = { b: 'strong', i: 'em' };
// 标签级正则扫描：不做完整 DOM 解析（Node 自测环境没有 DOMParser），只处理"属性值内不含尖括号"的
// 常规写法，属性值里塞 '>' 试图逃逸标签边界这种极端构造不在本函数的处理范围内，最终导出前还会再过
// 一次 docToHtml 的 DOMPurify.sanitize 兜底
const SANITIZE_TAG_RE = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:\s+[^<>]*)?)\/?>/g;
// href 只放行常见安全协议/相对路径/锚点，拦截 javascript:/data:/vbscript: 等可执行协议
const SAFE_HREF_RE = /^(https?:|mailto:|#|\/|\?)/i;
// span 只保留 style 属性，且 style 内只放行这 5 种文字样式声明，其余声明（含未知属性）整条剥除
const SANITIZE_SPAN_STYLE_PROPS = new Set(['color', 'font-size', 'font-weight', 'font-style', 'text-decoration']);

function extractSafeHref(attrs) {
  const m = /href\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/i.exec(attrs || '');
  if (!m) return null;
  const raw = m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4];
  const trimmed = String(raw || '').trim();
  if (!trimmed || !SAFE_HREF_RE.test(trimmed)) return null;
  return escapeAttr(trimmed);
}

// span style 声明白名单过滤：值里出现任何括号（覆盖 url()/expression() 等已知注入手法，一并连坐禁止
// calc()/rgba() 等本白名单用不到的合法函数，宁可少放行也不留后门）的整条声明剥除；放行的声明按白名单
// prop 重新拼接输出，不透传原始 style 字符串
function extractSafeSpanStyle(attrs) {
  const m = /style\s*=\s*("([^"]*)"|'([^']*)')/i.exec(attrs || '');
  if (!m) return '';
  const raw = m[2] !== undefined ? m[2] : m[3];
  const decls = parseStyleDecls(raw)
    .filter(([prop, value]) => SANITIZE_SPAN_STYLE_PROPS.has(prop) && !/[()]/.test(value));
  return decls.length ? escapeAttr(stringifyStyleDecls(decls)) : '';
}

/**
 * para 内容白名单清洗：只保留 strong/em/br/a[href]/u/span[style] 标签（a 只保留 href 一个属性且校验协议
 * 安全；span 只保留 style 属性且 style 只放行 color/font-size/font-weight/font-style/text-decoration
 * 五种声明；b/i 归一为 strong/em），其余任何标签（含 script/style 及其内部代码文本、事件属性 onX）整体
 * 剥离。contenteditable 粘贴脏 HTML 时作为第一道防线使用；docModel 内部落库前也建议过一遍本函数。
 * @param {string} html
 * @returns {string}
 */
export function sanitizeParaHtml(html) {
  let out = String(html == null ? '' : html);
  // script/style 标签必须连内部代码文本一起删，不能只删标签留代码明文
  out = out.replace(/<script\b[\s\S]*?<\/script\s*>/gi, '');
  out = out.replace(/<style\b[\s\S]*?<\/style\s*>/gi, '');
  // HTML 注释可能被用来拼接/隐藏 payload，统一清掉
  out = out.replace(/<!--[\s\S]*?-->/g, '');

  out = out.replace(SANITIZE_TAG_RE, (match, slash, rawName, attrs) => {
    const lower = rawName.toLowerCase();
    const name = SANITIZE_TAG_ALIASES[lower] || lower;
    if (!SANITIZE_ALLOWED_TAGS.has(name)) return '';
    if (name === 'br') return '<br>';
    if (name === 'a') {
      if (slash) return '</a>';
      const href = extractSafeHref(attrs);
      return href ? `<a href="${href}">` : '<a>';
    }
    if (name === 'span') {
      if (slash) return '</span>';
      const style = extractSafeSpanStyle(attrs);
      return style ? `<span style="${style}">` : '<span>';
    }
    return slash ? `</${name}>` : `<${name}>`;
  });

  return out;
}
