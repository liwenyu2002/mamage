// 画布编辑器文档模型：DocBlock[] 与 markdown/HTML/纯文本之间的互转 + 历史栈 + para 内容清洗。
// 契约：/private/tmp/claude-501/-Users-liwenyu/f413e1a5-8f0f-436d-b775-8c9faffa99f1/scratchpad/canvas-editor-contracts.md 第 1 节。
// 约束：只 import themes.js 的公开导出（applyBlock/BUILTIN_BLOCKS_BY_ID），不碰其私有函数；
// para 正文样式在本文件内按 body 配置独立构造，刻意与 themes.js computeBodyStyles 的 p/strong/em/a 输出格式保持一致。
import { applyBlock, BUILTIN_BLOCKS_BY_ID } from './themes.js';
import DOMPurify from 'dompurify';

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
  return {
    p: `font-size:${fontSize}px;line-height:${lineHeight};color:#333333;letter-spacing:0.03em;text-align:${align};${indent}margin:0 0 20px;`,
    strong: `font-weight:700;color:${accent};`,
    em: 'color:#666666;font-style:italic;',
    a: `color:${accent};text-decoration:underline;`,
  };
}

// para.html 只可能含 markdownToDoc/sanitizeParaHtml 产出的裸标签（<strong>/<em>/<br>/<a href="...">，
// 不带任何 style 属性），这里按 bodyStyles 补内联样式，保证导出效果与画布/themes.js 正文视觉一致
function styleParaInlineHtml(html, bodyStyles) {
  return String(html || '')
    .replace(/<strong>/g, `<strong style="${bodyStyles.strong}">`)
    .replace(/<em>/g, `<em style="${bodyStyles.em}">`)
    .replace(/<a\s+href="([^"]*)"\s*>/g, (_m, href) => `<a href="${href}" style="${bodyStyles.a}">`);
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
  let imageCount = 0;

  const parts = (Array.isArray(doc) ? doc : []).map((block) => {
    if (!block) return '';
    if (block.kind === 'para') {
      return `<p style="${bodyStyles.p}">${styleParaInlineHtml(block.html, bodyStyles)}</p>`;
    }
    if (block.kind === 'raw') {
      // 整文导入块：html 在导入与每次失焦提交时都已过 sanitizeRawHtml，这里原样拼接保排版，
      // 不套 para 正文样式（原文自带全套内联样式）；最终导出还会过 docToHtml 的 DOMPurify 兜底
      imageCount += (String(block.html || '').match(/<img\b/gi) || []).length;
      return String(block.html || '');
    }
    const type = block.type;
    const styleBlock = lookupStyleBlock(blocksById, type, block.blockId);
    const accent = normalizeAccent(block.accent) || globalAccent;
    if (type === 'imageCard') {
      imageCount += 1;
      return applyBlock(styleBlock, {
        src: escapeHtml(block.src || ''),
        caption: escapeHtml(block.caption || ''),
        accent,
      });
    }
    if (type === 'divider') {
      return applyBlock(styleBlock, { accent });
    }
    // h2/h3/quote/signoff
    return applyBlock(styleBlock, { content: escapeContentWithBreaks(block.content || ''), accent });
  });

  const html = `<section style="font-family:${FONT_STACK};color:#333333;">${parts.join('\n')}</section>`;
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
    // referrerpolicy 是整文导入的 mmbiz 图片防盗链通行证（no-referrer），导出时必须保留
    ADD_ATTR: ['style', 'referrerpolicy'],
  });
  return { html: safe, imageCount };
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
      ADD_ATTR: ['style', 'referrerpolicy'],
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
// sanitizeParaHtml：para 内容白名单清洗（contenteditable 粘贴脏 HTML 的防线）
// ---------------------------------------------------------------------------

// 白名单标签：strong/em/br/a，其余标签（含 script/style/div/img/iframe 等）整体剥掉但保留标签间的文本节点；
// 允许标签一律重新拼出干净版本（不透传原始属性字符串），天然滤掉 onclick/onmouseover 等事件属性
const SANITIZE_ALLOWED_TAGS = new Set(['strong', 'em', 'br', 'a']);
// 标签级正则扫描：不做完整 DOM 解析（Node 自测环境没有 DOMParser），只处理"属性值内不含尖括号"的
// 常规写法，属性值里塞 '>' 试图逃逸标签边界这种极端构造不在本函数的处理范围内，最终导出前还会再过
// 一次 docToHtml 的 DOMPurify.sanitize 兜底
const SANITIZE_TAG_RE = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:\s+[^<>]*)?)\/?>/g;
// href 只放行常见安全协议/相对路径/锚点，拦截 javascript:/data:/vbscript: 等可执行协议
const SAFE_HREF_RE = /^(https?:|mailto:|#|\/|\?)/i;

function escapeAttr(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function extractSafeHref(attrs) {
  const m = /href\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/i.exec(attrs || '');
  if (!m) return null;
  const raw = m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4];
  const trimmed = String(raw || '').trim();
  if (!trimmed || !SAFE_HREF_RE.test(trimmed)) return null;
  return escapeAttr(trimmed);
}

/**
 * para 内容白名单清洗：只保留 strong/em/br/a[href] 四种标签（a 只保留 href 一个属性，且校验协议安全），
 * 其余任何标签（含 script/style 及其内部代码文本、事件属性 onX）整体剥离。contenteditable 粘贴脏 HTML
 * 时作为第一道防线使用；docModel 内部落库前也建议过一遍本函数。
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
    const name = rawName.toLowerCase();
    if (!SANITIZE_ALLOWED_TAGS.has(name)) return '';
    if (name === 'br') return '<br>';
    if (name === 'a') {
      if (slash) return '</a>';
      const href = extractSafeHref(attrs);
      return href ? `<a href="${href}">` : '<a>';
    }
    return slash ? `</${name}>` : `<${name}>`;
  });

  return out;
}
