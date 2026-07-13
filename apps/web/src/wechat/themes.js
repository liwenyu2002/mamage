// 公众号排版渲染引擎（样式块自选模型）。
// 约束来源：公众号编辑器粘贴后只有"内联 style 属性"能存活，class/position/flex/grid/transform/id/<style>/<script>
// 一律被吞掉——所有视觉效果都靠多层 <section> 嵌套 + 内联 background/border/border-radius/display 手搓，
// 这是 135/秀米编辑器的通用原理。renderWechatHtml 是预览与"复制富文本"共用的唯一渲染入口，保证所见即所得。
//
// 本文件实现两条渲染路径，最终收敛到同一套逻辑：
//   1. 新路径：blockConfig（每个 type 指向一个 StyleBlock id）+ blocksById（id→StyleBlock 映射，由调用方传入，
//      通常是"内置块 + 组织提取块"合并后的结果）。
//   2. 旧路径：themeKey（5 选 1 的旧主题名），内部通过 THEME_PRESETS 映射成等价的 blockConfig 后走同一套渲染，
//      不再维护第二套独立的渲染逻辑。
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { BUILTIN_BLOCKS } from './builtinBlocks.js';
import { derivePalette } from './themeColor.js';

// 找不到图片时的兜底占位图：内联 SVG，避免因单张图缺失导致整篇渲染报错或产生额外外链请求
const FALLBACK_IMG = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="#eee"/><text x="60" y="44" font-size="12" fill="#999" text-anchor="middle">图片缺失</text></svg>',
);

const FONT_STACK = "-apple-system,BlinkMacSystemFont,'Helvetica Neue','PingFang SC','Microsoft YaHei',sans-serif";

// title/digest/alt/href 来自外部输入（markdown 原文或调用方 props），是未经 marked 处理的原始字符串，
// 拼进模板字符串前必须手动转义
function escapeHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// accent 只允许 #RRGGBB 六位十六进制——一是防止把非法值拼进 style 属性造成属性逃逸，
// 二是保证"accent + 两位十六进制透明度后缀"这种渐变技巧（见 PRESET_BLOCK_IDS.md）拼出来的颜色始终合法。
// 空字符串放行（非 accentEditable 的块调用 applyBlock 时可能压根不传 accent）。
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
function sanitizeAccent(accent) {
  if (accent === '' || accent == null) return '';
  const s = String(accent);
  if (!HEX_COLOR_RE.test(s)) {
    throw new Error(`非法的 accent 颜色值：${s}（必须是 #RRGGBB 六位十六进制格式）`);
  }
  return s;
}

// ⌈PHOTO:id⌋ 是后端协议约定的占位符，需要在渲染期换成 photosMap 里的真实地址；
// http(s) 外链图片原样透传。两种形态都可能出现在同一篇文章里。
function resolveImageSrc(href, photosMap) {
  const raw = String(href || '').trim();
  const m = /^PHOTO:(.+)$/.exec(raw);
  if (m) {
    const url = (photosMap || {})[m[1]];
    return url || FALLBACK_IMG;
  }
  return raw || FALLBACK_IMG;
}

// ---------------------------------------------------------------------------
// StyleBlock 渲染核心
// ---------------------------------------------------------------------------

// {{#name}}...{{/name}} 条件段：keep=false 时整段（含内部文本）剔除，keep=true 时只剥掉包裹标记，
// 内部文本原样保留（其中可能还带有待替换的 {{name}} 占位符，交给后续的逐槽位替换处理）。
function stripOrKeepConditional(template, name, keep) {
  const re = new RegExp(`\\{\\{#${name}\\}\\}([\\s\\S]*?)\\{\\{/${name}\\}\\}`, 'g');
  return template.replace(re, (_m, inner) => (keep ? inner : ''));
}

/**
 * StyleBlock 槽位替换核心：{{content}}/{{src}}/{{caption}}/{{accent}} 直接替换，
 * {{#caption}}...{{/caption}} 条件段在 caption 为空（trim 后为空串）时整段剔除，非空时保留内部并展开。
 * 用 split/join 而非正则 replace 做逐槽位替换，避免 content/caption 里出现 "$&"/"$1" 等序列被
 * String.prototype.replace 误当成特殊替换模式解析。
 * @param {{htmlTemplate:string}} block
 * @param {{content?:string, src?:string, caption?:string, accent?:string}} slots
 * @returns {string}
 */
export function applyBlock(block, slots) {
  if (!block || typeof block.htmlTemplate !== 'string') {
    throw new Error('applyBlock: 缺少合法的 block.htmlTemplate');
  }
  const s = slots || {};
  const content = s.content == null ? '' : String(s.content);
  const src = s.src == null ? '' : String(s.src);
  const caption = s.caption == null ? '' : String(s.caption);
  const accent = sanitizeAccent(s.accent);

  let out = block.htmlTemplate;

  const hasCaption = Boolean(caption.trim());
  out = stripOrKeepConditional(out, 'caption', hasCaption);

  out = out.split('{{content}}').join(content);
  out = out.split('{{src}}').join(src);
  out = out.split('{{caption}}').join(caption);
  out = out.split('{{accent}}').join(accent);

  // 主题色调色板令牌：{{primary}}=主色、{{tint}}/{{softTint}}=浅色底、{{shade}}=压暗深字、{{accent2}}=辅助色，
  // 由 accent 派生（与 raw 块 data-mm-theme 同一套 derivePalette），让精品块能用"随主题联动"的
  // 浅底/深字/辅助色而不止单一主色。只有含这些令牌的块才派生（省开销），老块不含、零影响。
  if (out.indexOf('{{tint}}') >= 0 || out.indexOf('{{shade}}') >= 0 || out.indexOf('{{primary}}') >= 0
    || out.indexOf('{{softTint}}') >= 0 || out.indexOf('{{accent2}}') >= 0) {
    const pal = derivePalette(accent || '#1a1a1a');
    out = out.split('{{primary}}').join(pal.primary);
    out = out.split('{{tint}}').join(pal.tint);
    out = out.split('{{softTint}}').join(pal.softTint);
    out = out.split('{{shade}}').join(pal.shade);
    out = out.split('{{accent2}}').join(pal.accent);
  }

  return out;
}

// 按 id 建索引，重复 id 后写覆盖先写（调用方传入的 blocksById 里如果和内置块同 id，视为有意覆盖）
function indexBlocksById(blocks) {
  const map = {};
  (blocks || []).forEach((b) => {
    if (b && b.id) map[b.id] = b;
  });
  return map;
}

// 内置块索引：供"新路径缺项兜底"和"旧路径 themeKey 兼容"共用。
export const BUILTIN_BLOCKS_BY_ID = indexBlocksById(BUILTIN_BLOCKS);

// 缺块兜底映射（minimal 系列必须始终存在于 builtinBlocks 中）
const FALLBACK_BLOCK_IDS = {
  h2: 'builtin-h2-minimal',
  h3: 'builtin-h3-minimal',
  quote: 'builtin-quote-minimal',
  divider: 'builtin-divider-double-line',
  imageCard: 'builtin-imageCard-minimal-underline',
  signoff: 'builtin-signoff-end-badge',
};

function lookupBlock(blocksById, type, id) {
  const block = blocksById[id];
  if (!block) {
    // 缺块（提取块被删除/草稿引用了失效 id）回退到 minimal 预设的同类型块，绝不让整页预览挂掉
    const fallbackId = FALLBACK_BLOCK_IDS[type];
    const fallback = fallbackId ? BUILTIN_BLOCKS_BY_ID[fallbackId] : null;
    if (fallback) {
      console.warn(`[themes] 样式块缺失 type=${type} id=${id}，已回退 ${fallbackId}`);
      return fallback;
    }
    throw new Error(`未找到样式块：type=${type} id=${id}，请检查 blockConfig 与 blocksById 是否匹配`);
  }
  if (block.type && block.type !== type) {
    throw new Error(`样式块类型不匹配：期望 type=${type}，实际 type=${block.type}（id=${id}）`);
  }
  return block;
}

// ---------------------------------------------------------------------------
// 5 主题预设 → blockConfig（THEME_PRESETS）。20 个内置块 id 的选取与样式规格见 PRESET_BLOCK_IDS.md，
// 由 builtinBlocks.js 的生产 agent 按该清单补齐；这里只做"主题名 → 引用哪些块 id"的映射。
// ---------------------------------------------------------------------------

const DEFAULT_BODY = { fontSize: 15, lineHeight: 1.75, textIndent: false, justify: true };

const THEME_DEFS = [
  {
    key: 'minimal',
    name: '极简黑',
    desc: '黑白灰阶，克制留白，观点/评论类文章通用款',
    blockConfig: {
      h2: 'builtin-h2-minimal',
      h3: 'builtin-h3-minimal',
      quote: 'builtin-quote-minimal',
      divider: 'builtin-divider-double-line',
      imageCard: 'builtin-imageCard-minimal-underline',
      signoff: 'builtin-signoff-end-badge',
      accent: '#1a1a1a',
      body: { ...DEFAULT_BODY },
    },
  },
  {
    key: 'academic',
    name: '学院蓝',
    desc: '深蓝色块标题，严谨稳重，适合报告/通稿/研究类内容',
    blockConfig: {
      h2: 'builtin-h2-academic',
      h3: 'builtin-h3-academic',
      quote: 'builtin-quote-academic',
      divider: 'builtin-divider-double-line-diamond',
      imageCard: 'builtin-imageCard-color-bar-caption',
      signoff: 'builtin-signoff-divider-sign',
      accent: '#1d3557',
      body: { ...DEFAULT_BODY },
    },
  },
  {
    key: 'warm',
    name: '暖阳橙',
    desc: '橙色渐变胶囊标题，活泼亲和，适合活动/生活/情感类内容',
    blockConfig: {
      h2: 'builtin-h2-warm',
      h3: 'builtin-h3-warm',
      quote: 'builtin-quote-warm',
      divider: 'builtin-divider-gradient-thin',
      imageCard: 'builtin-imageCard-round-shadow',
      signoff: 'builtin-signoff-end-badge',
      accent: '#ff7a3d',
      body: { ...DEFAULT_BODY },
    },
  },
  {
    key: 'formal',
    name: '庄重红',
    desc: '校务党政风，标题居中双线，正文首行缩进',
    blockConfig: {
      h2: 'builtin-h2-formal',
      h3: 'builtin-h3-formal',
      quote: 'builtin-quote-formal',
      divider: 'builtin-divider-double-line',
      imageCard: 'builtin-imageCard-thick-border',
      signoff: 'builtin-signoff-divider-sign',
      accent: '#9b1c20',
      // formal 主题唯一要求首行缩进 2em，与其余主题的两端对齐区分
      body: { ...DEFAULT_BODY, textIndent: true },
    },
  },
  {
    key: 'fresh',
    name: '杂志绿',
    desc: '绿色下划线粗条，清新版式，适合校园/杂志/生活方式类内容',
    blockConfig: {
      h2: 'builtin-h2-fresh',
      h3: 'builtin-h3-fresh',
      quote: 'builtin-quote-fresh',
      divider: 'builtin-divider-wave-dots',
      imageCard: 'builtin-imageCard-round-shadow',
      signoff: 'builtin-signoff-end-badge',
      accent: '#2f9e44',
      body: { ...DEFAULT_BODY },
    },
  },
];

// key → blockConfig，供 renderWechatHtml 的 themeKey 兼容路径使用，也供前端"主题=预设组合"一键套用
export const THEME_PRESETS = THEME_DEFS.reduce((acc, t) => {
  acc[t.key] = t.blockConfig;
  return acc;
}, {});

// 供主题选择 UI 使用的元数据列表（渲染契约的一部分，前端依赖此结构渲染 5 张主题卡）
export const WECHAT_THEMES = THEME_DEFS.map((t) => ({
  key: t.key,
  name: t.name,
  desc: t.desc,
  accent: t.blockConfig.accent,
}));

// ---------------------------------------------------------------------------
// blockConfig 归一化：新路径直接用调用方传入的 blockConfig（缺项用 minimal 预设兜底，
// signoff 允许显式 null 表示"不渲染落款"，用 in 判断而非 || 短路，避免把合法的 null 当成缺省值覆盖掉）；
// 旧路径把 themeKey 翻译成对应预设，找不到就退化到 minimal。
// ---------------------------------------------------------------------------
function normalizeBlockConfig(blockConfigInput, themeKey) {
  if (blockConfigInput) {
    const base = THEME_PRESETS.minimal;
    const cfg = blockConfigInput;
    return {
      h2: cfg.h2 || base.h2,
      h3: cfg.h3 || base.h3,
      quote: cfg.quote || base.quote,
      divider: cfg.divider || base.divider,
      imageCard: cfg.imageCard || base.imageCard,
      signoff: 'signoff' in cfg ? cfg.signoff : base.signoff,
      accent: cfg.accent || base.accent,
      body: { ...base.body, ...(cfg.body || {}) },
    };
  }
  return THEME_PRESETS[themeKey] || THEME_PRESETS.minimal;
}

// 正文 p/ul/ol/li/strong/a（以及少见的 markdown 内嵌 h1）的基础内联样式，由 blockConfig.body + accent 生成，
// 不属于"块"——contracts.md 明确正文段落样式走 body 配置而非块引用
function computeBodyStyles(blockConfig) {
  const body = blockConfig.body || DEFAULT_BODY;
  const fontSize = Number(body.fontSize) || DEFAULT_BODY.fontSize;
  const lineHeight = body.lineHeight || DEFAULT_BODY.lineHeight;
  const justify = body.justify !== false;
  const textIndent = Boolean(body.textIndent);
  const accent = sanitizeAccent(blockConfig.accent) || '#1a1a1a';
  const align = justify ? 'justify' : 'left';
  const indent = textIndent ? 'text-indent:2em;' : '';
  return {
    h1: `font-size:22px;font-weight:700;color:${accent};line-height:1.5;text-align:center;margin:0 0 20px;`,
    p: `font-size:${fontSize}px;line-height:${lineHeight};color:#333333;letter-spacing:0.03em;text-align:${align};${indent}margin:0 0 20px;`,
    strong: `font-weight:700;color:${accent};`,
    em: 'color:#666666;font-style:italic;',
    ul: `margin:0 0 20px;padding-left:24px;font-size:${fontSize}px;line-height:${lineHeight};color:#333333;`,
    ol: `margin:0 0 20px;padding-left:24px;font-size:${fontSize}px;line-height:${lineHeight};color:#333333;`,
    li: 'margin-bottom:8px;',
    a: `color:${accent};text-decoration:underline;`,
  };
}

// 文章标题/摘要不是"块"（StyleBlock 的 type 枚举里没有 title），是引擎级别的固定编排，
// 用 blockConfig.accent 上色以保持与所选预设/自定义主色协调
function renderTitleBlock(titleEscaped, digestEscaped, blockConfig) {
  if (!titleEscaped && !digestEscaped) return '';
  const accent = sanitizeAccent(blockConfig.accent) || '#1a1a1a';
  const titleHtml = titleEscaped
    ? `<section style="text-align:center;margin:0 0 12px;"><span style="font-size:22px;font-weight:700;color:${accent};line-height:1.4;">${titleEscaped}</span></section><section style="text-align:center;margin:0 0 16px;padding:0;"><span style="display:inline-block;width:48px;height:2px;background-color:${accent};"></span></section>`
    : '';
  const digestHtml = digestEscaped
    ? `<section style="margin:0 0 28px;padding:0 4px;"><span style="font-size:14px;color:#888888;line-height:1.8;">${digestEscaped}</span></section>`
    : '';
  return titleHtml + digestHtml;
}

// 为一次渲染创建独立的 marked Renderer 实例：闭包捕获 blockConfig/blocksById/photosMap/图片计数器，
// 避免多次渲染或并发调用之间共享可变状态
function createRenderer(ctx) {
  const { blockConfig, blocksById, bodyStyles, photosMap, counter } = ctx;
  const renderer = new marked.Renderer();

  renderer.heading = (text, level) => {
    if (level === 1) return `<h1 style="${bodyStyles.h1}">${text}</h1>\n`;
    // h4~h6 退化为 h3 视觉规格，块类型本身只区分到 h3
    const type = level === 2 ? 'h2' : 'h3';
    const blockId = level === 2 ? blockConfig.h2 : blockConfig.h3;
    const block = lookupBlock(blocksById, type, blockId);
    return `${applyBlock(block, { content: text, accent: blockConfig.accent })}\n`;
  };

  renderer.paragraph = (text) => `<p style="${bodyStyles.p}">${text}</p>\n`;

  renderer.strong = (text) => `<strong style="${bodyStyles.strong}">${text}</strong>`;

  renderer.em = (text) => `<em style="${bodyStyles.em}">${text}</em>`;

  renderer.list = (body, ordered, start) => {
    const tag = ordered ? 'ol' : 'ul';
    const style = ordered ? bodyStyles.ol : bodyStyles.ul;
    const startAttr = ordered && start !== 1 ? ` start="${start}"` : '';
    return `<${tag} style="${style}"${startAttr}>\n${body}</${tag}>\n`;
  };

  renderer.listitem = (text) => `<li style="${bodyStyles.li}">${text}</li>\n`;

  renderer.blockquote = (quote) => {
    const block = lookupBlock(blocksById, 'quote', blockConfig.quote);
    return `${applyBlock(block, { content: quote, accent: blockConfig.accent })}\n`;
  };

  renderer.hr = () => {
    const block = lookupBlock(blocksById, 'divider', blockConfig.divider);
    return `${applyBlock(block, { accent: blockConfig.accent })}\n`;
  };

  renderer.image = (href, title, text) => {
    const src = resolveImageSrc(href, photosMap);
    counter.count += 1;
    const block = lookupBlock(blocksById, 'imageCard', blockConfig.imageCard);
    // src 转义防止图片地址里带 " 造成 <img src="..."> 属性逃逸；alt 转义防止图注文本注入
    return applyBlock(block, { src: escapeHtml(src), caption: escapeHtml(text), accent: blockConfig.accent });
  };

  renderer.link = (href, title, text) => {
    const safeHref = escapeHtml(href || '');
    return `<a href="${safeHref}" style="${bodyStyles.a}">${text}</a>`;
  };

  return renderer;
}

// 内部渲染主体：产出未经 DOMPurify 清洗的 HTML，供 renderWechatHtml 清洗后对外，
// 也单独导出为 renderWechatHtmlRaw 供 Node 自测脚本使用（DOMPurify 在纯 Node 环境下没有 window，无法调用 sanitize）
function buildWechatHtml(markdown, options) {
  const opts = options || {};
  const blockConfig = normalizeBlockConfig(opts.blockConfig, opts.themeKey);
  // 调用方传入的 blocksById（内置块 + 组织提取块合并后的结果）优先；缺项用引擎自带的内置块索引兜底——
  // 这条兜底路径正是 themeKey 兼容模式能工作的原因：那条路径根本不会传 blocksById
  const blocksById = { ...BUILTIN_BLOCKS_BY_ID, ...(opts.blocksById || {}) };
  const bodyStyles = computeBodyStyles(blockConfig);
  const counter = { count: 0 };
  const renderer = createRenderer({
    blockConfig,
    blocksById,
    bodyStyles,
    photosMap: opts.photosMap || {},
    counter,
  });

  marked.setOptions({ mangle: false, headerIds: false, gfm: true });
  const bodyHtml = marked.parse(String(markdown || ''), { renderer });

  const titleEscaped = opts.title ? escapeHtml(opts.title) : '';
  const digestEscaped = opts.digest ? escapeHtml(opts.digest) : '';
  const titleHtml = renderTitleBlock(titleEscaped, digestEscaped, blockConfig);

  let signOffHtml = '';
  if (blockConfig.signoff) {
    const block = lookupBlock(blocksById, 'signoff', blockConfig.signoff);
    // signoffText 是预留的落款文案扩展位（不在 contracts.md 的 options 签名里，纯加法、不传时保持旧行为）：
    // 目前 UI 还没有落款文案输入框，默认沿用旧版本固定的 "E N D"
    signOffHtml = applyBlock(block, { content: opts.signoffText || 'E N D', accent: blockConfig.accent });
  }

  const html = `<section style="font-family:${FONT_STACK};color:#333333;">${titleHtml}${bodyHtml}${signOffHtml}</section>`;
  return { html, imageCount: counter.count };
}

/**
 * 未清洗版本，仅供 Node 自测脚本（themes.selfcheck.js）使用，请勿在浏览器运行时路径中使用——
 * 正式渲染必须经过 renderWechatHtml 的 DOMPurify 清洗。
 */
export function renderWechatHtmlRaw(markdown, options) {
  return buildWechatHtml(markdown, options);
}

/**
 * markdown → 公众号可粘贴的全内联 section HTML。预览与"复制富文本"共用同一份，所见即所得。
 * @param {string} markdown 正文 markdown，图片用 ![alt](PHOTO:id) 或 ![alt](http...)
 * @param {{
 *   blockConfig?: {h2:string,h3:string,quote:string,divider:string,imageCard:string,signoff:string|null,accent:string,body:object},
 *   blocksById?: Object.<string, {id:string,type:string,htmlTemplate:string,accentEditable?:boolean}>,
 *   themeKey?: string,
 *   photosMap?: Object,
 *   title?: string,
 *   digest?: string,
 * }} options 新路径传 blockConfig(+blocksById)；旧路径只传 themeKey（无 blockConfig 时内部把 5 主题映射为预设 blockConfig）
 * @returns {{html:string, imageCount:number}}
 */
export function renderWechatHtml(markdown, options) {
  const { html, imageCount } = buildWechatHtml(markdown, options);
  // ADD_ATTR: ['style'] 是显式声明而非必需（DOMPurify 默认已允许 style 属性），保留是为了不受未来配置漂移影响；
  // FORBID_TAGS 显式拦掉 <style>/<script> 等标签——公众号编辑器规则要求正文自包含、不依赖标签级样式
  const safe = DOMPurify.sanitize(html, {
    FORBID_TAGS: ['style', 'script', 'iframe', 'object', 'embed', 'input', 'form'],
    ADD_ATTR: ['style'],
  });
  return { html: safe, imageCount };
}
