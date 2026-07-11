// 公众号排版主题渲染引擎。
// 约束来源：公众号编辑器粘贴后只有"内联 style 属性"能存活，class/position/flex/grid/transform/id/<style>/<script>
// 一律被吞掉——所以本文件里所有视觉效果（竖条、胶囊、双线、圆点分隔线……）都用多层 <section> 嵌套 +
// 内联 background/border/border-radius/display:inline-block 手搓出来，这是 135/秀米编辑器的通用原理，
// 不是本文件独创。renderWechatHtml 是预览与"复制富文本"共用的唯一渲染入口，保证所见即所得。
import { marked } from 'marked';
import DOMPurify from 'dompurify';

// 找不到图片时的兜底占位图：内联 SVG，避免因单张图缺失导致整篇渲染报错或产生额外外链请求
const FALLBACK_IMG = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="#eee"/><text x="60" y="44" font-size="12" fill="#999" text-anchor="middle">图片缺失</text></svg>',
);

const FONT_STACK = "-apple-system,BlinkMacSystemFont,'Helvetica Neue','PingFang SC','Microsoft YaHei',sans-serif";

// title/digest 来自外部 props，是未经 marked 处理的原始字符串，必须手动转义再拼进模板字符串
function escapeHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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

// ---- 手搓形状的小工具：全部只用 background/border/border-radius/display/width/height/margin ----

// 居中的水平细线，用于克制风格的分隔线
function centerLine(width, height, color, margin) {
  return `<section style="text-align:center;margin:${margin};padding:0;"><span style="display:inline-block;width:${width};height:${height};background-color:${color};"></span></section>`;
}

// 居中的圆点排（用等宽 span + margin 模拟间距，圆点分隔线常见于杂志/学院风）
function centerDots(count, size, gap, color, margin) {
  const dot = `<span style="display:inline-block;width:${size};height:${size};border-radius:50%;background-color:${color};margin:0 ${gap};"></span>`;
  return `<section style="text-align:center;margin:${margin};padding:0;">${dot.repeat(count)}</section>`;
}

// 居中的小方块排（学院风分隔线）
function centerSquares(count, size, gap, color, margin) {
  const sq = `<span style="display:inline-block;width:${size};height:${size};background-color:${color};margin:0 ${gap};"></span>`;
  return `<section style="text-align:center;margin:${margin};padding:0;">${sq.repeat(count)}</section>`;
}

// ---- 每套主题一个"样式规格对象"：h1~a 的内联样式字符串 + 标题块/引用卡/分隔线/落款卡四个特殊包装器 ----

const minimal = {
  key: 'minimal',
  name: '极简黑',
  desc: '黑白灰阶，克制留白，观点/评论类文章通用款',
  accent: '#1a1a1a',
  rootStyle: `font-family:${FONT_STACK};color:#3f3f3f;`,
  styles: {
    h1: 'font-size:22px;font-weight:700;color:#1a1a1a;line-height:1.5;text-align:center;margin:0 0 20px;',
    p: 'font-size:15px;line-height:1.75;color:#3f3f3f;letter-spacing:0.05em;text-align:justify;margin:0 0 20px;',
    strong: 'font-weight:700;color:#1a1a1a;',
    em: 'color:#666666;font-style:italic;',
    ul: 'margin:0 0 20px;padding-left:24px;font-size:15px;line-height:1.75;color:#3f3f3f;',
    ol: 'margin:0 0 20px;padding-left:24px;font-size:15px;line-height:1.75;color:#3f3f3f;',
    li: 'margin-bottom:8px;',
    a: 'color:#1a1a1a;text-decoration:underline;',
    figcaption: 'display:block;font-size:12px;color:#999999;text-align:center;line-height:1.6;margin:8px 0 0;padding:0;',
    hr: 'border:none;border-top:1px solid #dddddd;margin:32px 0;',
  },
  renderH2(inner) {
    return `<section style="margin:36px 0 18px;padding:2px 0 2px 14px;border-left:4px solid #1a1a1a;"><span style="font-size:18px;font-weight:700;color:#1a1a1a;line-height:1.5;">${inner}</span></section>`;
  },
  renderH3(inner) {
    return `<section style="margin:26px 0 14px;"><span style="display:inline-block;width:6px;height:6px;background-color:#1a1a1a;margin-right:8px;vertical-align:middle;"></span><span style="font-size:16px;font-weight:700;color:#1a1a1a;vertical-align:middle;">${inner}</span></section>`;
  },
  renderBlockquote(inner) {
    return `<section style="margin:18px 0;padding:14px 16px;background-color:#f7f7f7;border-left:3px solid #1a1a1a;color:#666666;font-size:14px;line-height:1.75;">${inner}</section>`;
  },
  renderHr() {
    return centerLine('40px', '1px', '#cccccc', '32px 0');
  },
  renderImage(src, altEscaped) {
    const cap = altEscaped ? `<figcaption style="${minimal.styles.figcaption}">${altEscaped}</figcaption>` : '';
    return `<section style="margin:20px 0;padding:0;"><img src="${src}" alt="${altEscaped}" style="width:100%;height:auto;display:block;border-radius:6px;margin:0;"/>${cap}</section>`;
  },
  renderTitleBlock(titleEscaped, digestEscaped) {
    if (!titleEscaped && !digestEscaped) return '';
    const titleHtml = titleEscaped
      ? `<section style="text-align:center;margin:0 0 12px;"><span style="font-size:22px;font-weight:700;color:#1a1a1a;line-height:1.4;">${titleEscaped}</span></section>${centerLine('48px', '2px', '#1a1a1a', '0 0 16px')}`
      : '';
    const digestHtml = digestEscaped
      ? `<section style="margin:0 0 28px;padding:0 4px;"><span style="font-size:14px;color:#888888;line-height:1.8;">${digestEscaped}</span></section>`
      : '';
    return titleHtml + digestHtml;
  },
  renderSignOff() {
    return `${centerLine('24px', '1px', '#cccccc', '40px 0 10px')}<section style="text-align:center;margin:0 0 4px;"><span style="font-size:12px;color:#aaaaaa;letter-spacing:0.2em;">E N D</span></section>`;
  },
};

const academic = {
  key: 'academic',
  name: '学院蓝',
  desc: '深蓝色块标题，严谨稳重，适合报告/通稿/研究类内容',
  accent: '#1d3557',
  rootStyle: `font-family:${FONT_STACK};color:#333333;`,
  styles: {
    h1: 'font-size:22px;font-weight:700;color:#16233d;line-height:1.5;text-align:center;margin:0 0 20px;',
    p: 'font-size:15px;line-height:1.75;color:#333333;letter-spacing:0.03em;text-align:justify;margin:0 0 20px;',
    strong: 'font-weight:700;color:#1d3557;',
    em: 'color:#5a6b85;font-style:italic;',
    ul: 'margin:0 0 20px;padding-left:24px;font-size:15px;line-height:1.75;color:#333333;',
    ol: 'margin:0 0 20px;padding-left:24px;font-size:15px;line-height:1.75;color:#333333;',
    li: 'margin-bottom:8px;',
    a: 'color:#1d3557;text-decoration:underline;',
    figcaption: 'display:block;font-size:12px;color:#999999;text-align:center;line-height:1.6;margin:8px 0 0;padding:0;',
    hr: 'border:none;border-top:1px solid #dbe2ec;margin:32px 0;',
  },
  renderH2(inner) {
    return `<section style="margin:36px 0 18px;padding:10px 16px;background-color:#1d3557;border-radius:3px;"><span style="font-size:17px;font-weight:700;color:#ffffff;letter-spacing:0.05em;line-height:1.6;">${inner}</span></section>`;
  },
  renderH3(inner) {
    return `<section style="margin:26px 0 14px;padding:2px 0 2px 12px;border-left:2px solid #1d3557;"><span style="font-size:16px;font-weight:700;color:#1d3557;">${inner}</span></section>`;
  },
  renderBlockquote(inner) {
    return `<section style="margin:18px 0;padding:14px 16px;background-color:#eef3fa;border-left:3px solid #1d3557;color:#4a5b73;font-size:14px;line-height:1.75;">${inner}</section>`;
  },
  renderHr() {
    return centerSquares(3, '4px', '8px', '#1d3557', '32px 0');
  },
  renderImage(src, altEscaped) {
    const cap = altEscaped ? `<figcaption style="${academic.styles.figcaption}">${altEscaped}</figcaption>` : '';
    return `<section style="margin:20px 0;padding:0;"><img src="${src}" alt="${altEscaped}" style="width:100%;height:auto;display:block;border-radius:4px;margin:0;"/>${cap}</section>`;
  },
  renderTitleBlock(titleEscaped, digestEscaped) {
    if (!titleEscaped && !digestEscaped) return '';
    const titleHtml = titleEscaped
      ? `<section style="margin:0 0 16px;padding:16px 18px;background-color:#1d3557;border-radius:3px;text-align:center;"><span style="font-size:21px;font-weight:700;color:#ffffff;line-height:1.5;letter-spacing:0.02em;">${titleEscaped}</span></section>`
      : '';
    const digestHtml = digestEscaped
      ? `<section style="margin:0 0 28px;padding:10px 14px;background-color:#eef3fa;border-left:3px solid #1d3557;"><span style="font-size:14px;color:#4a5b73;line-height:1.8;">${digestEscaped}</span></section>`
      : '';
    return titleHtml + digestHtml;
  },
  renderSignOff() {
    return `${centerSquares(3, '4px', '8px', '#1d3557', '40px 0 10px')}<section style="text-align:center;margin:0 0 4px;"><span style="font-size:12px;color:#8a97ab;letter-spacing:0.2em;">E N D</span></section>`;
  },
};

const warm = {
  key: 'warm',
  name: '暖阳橙',
  desc: '橙色渐变胶囊标题，活泼亲和，适合活动/生活/情感类内容',
  accent: '#ff7a3d',
  rootStyle: `font-family:${FONT_STACK};color:#4a3826;`,
  styles: {
    h1: 'font-size:22px;font-weight:700;color:#4a2c12;line-height:1.5;text-align:center;margin:0 0 20px;',
    p: 'font-size:15px;line-height:1.75;color:#4a3826;letter-spacing:0.03em;text-align:justify;margin:0 0 20px;',
    strong: 'font-weight:700;color:#ff7a3d;',
    em: 'color:#b98657;font-style:italic;',
    ul: 'margin:0 0 20px;padding-left:24px;font-size:15px;line-height:1.75;color:#4a3826;',
    ol: 'margin:0 0 20px;padding-left:24px;font-size:15px;line-height:1.75;color:#4a3826;',
    li: 'margin-bottom:8px;',
    a: 'color:#ff7a3d;text-decoration:underline;',
    figcaption: 'display:block;font-size:12px;color:#999999;text-align:center;line-height:1.6;margin:8px 0 0;padding:0;',
    hr: 'border:none;border-top:1px solid #ffe0c7;margin:32px 0;',
  },
  renderH2(inner) {
    return `<section style="margin:36px 0 18px;text-align:left;"><section style="display:inline-block;padding:6px 20px;border-radius:20px;background-image:linear-gradient(135deg,#ff9a44,#ff6a3d);box-shadow:0 4px 10px rgba(255,122,61,0.25);"><span style="font-size:16px;font-weight:700;color:#ffffff;letter-spacing:0.05em;">${inner}</span></section></section>`;
  },
  renderH3(inner) {
    return `<section style="margin:26px 0 14px;"><section style="display:inline-block;padding:3px 14px;border-radius:14px;border:1.5px solid #ff9a44;"><span style="font-size:15px;font-weight:700;color:#ff7a3d;">${inner}</span></section></section>`;
  },
  renderBlockquote(inner) {
    return `<section style="margin:18px 0;padding:14px 16px;background-color:#fff4ea;border-left:3px solid #ff9a44;color:#8a6a4c;font-size:14px;line-height:1.75;border-radius:0 8px 8px 0;">${inner}</section>`;
  },
  renderHr() {
    return `<section style="text-align:center;margin:32px 0;padding:0;"><span style="display:inline-block;width:60px;height:4px;border-radius:2px;background-image:linear-gradient(90deg,#ff9a44,#ff6a3d);"></span></section>`;
  },
  renderImage(src, altEscaped) {
    const cap = altEscaped ? `<figcaption style="${warm.styles.figcaption}">${altEscaped}</figcaption>` : '';
    return `<section style="margin:20px 0;padding:0;"><img src="${src}" alt="${altEscaped}" style="width:100%;height:auto;display:block;border-radius:12px;margin:0;"/>${cap}</section>`;
  },
  renderTitleBlock(titleEscaped, digestEscaped) {
    if (!titleEscaped && !digestEscaped) return '';
    const titleHtml = titleEscaped
      ? `<section style="text-align:center;margin:0 0 14px;"><span style="font-size:22px;font-weight:700;color:#4a2c12;line-height:1.4;">${titleEscaped}</span></section><section style="text-align:center;margin:0 0 18px;"><span style="display:inline-block;width:60px;height:4px;border-radius:2px;background-image:linear-gradient(90deg,#ff9a44,#ff6a3d);"></span></section>`
      : '';
    const digestHtml = digestEscaped
      ? `<section style="margin:0 0 28px;padding:12px 16px;background-color:#fff4ea;border-radius:12px;"><span style="font-size:14px;color:#8a6a4c;line-height:1.8;">${digestEscaped}</span></section>`
      : '';
    return titleHtml + digestHtml;
  },
  renderSignOff() {
    return `<section style="text-align:center;margin:40px 0 10px;padding:0;"><span style="display:inline-block;width:60px;height:4px;border-radius:2px;background-image:linear-gradient(90deg,#ff9a44,#ff6a3d);"></span></section><section style="text-align:center;margin:0 0 4px;"><span style="font-size:12px;color:#c99a72;letter-spacing:0.2em;">E N D</span></section>`;
  },
};

const formal = {
  key: 'formal',
  name: '庄重红',
  desc: '校务党政风，标题居中双线，正文首行缩进',
  accent: '#9b1c20',
  rootStyle: `font-family:${FONT_STACK};color:#333333;`,
  styles: {
    h1: 'font-size:22px;font-weight:700;color:#1a1a1a;line-height:1.5;text-align:center;letter-spacing:0.1em;margin:0 0 20px;',
    // formal 主题唯一要求首行缩进 2em，与其余主题的两端对齐区分
    p: 'font-size:15px;line-height:1.75;color:#333333;letter-spacing:0.03em;text-align:justify;text-indent:2em;margin:0 0 20px;',
    strong: 'font-weight:700;color:#9b1c20;',
    em: 'color:#7a5252;font-style:italic;',
    ul: 'margin:0 0 20px;padding-left:24px;font-size:15px;line-height:1.75;color:#333333;',
    ol: 'margin:0 0 20px;padding-left:24px;font-size:15px;line-height:1.75;color:#333333;',
    li: 'margin-bottom:8px;',
    a: 'color:#9b1c20;text-decoration:underline;',
    figcaption: 'display:block;font-size:12px;color:#999999;text-align:center;line-height:1.6;margin:8px 0 0;padding:0;',
    hr: 'border:none;border-top:1px solid #e6cfcf;margin:32px 0;',
  },
  renderH2(inner) {
    return `<section style="margin:36px 0 18px;text-align:center;"><section style="display:inline-block;border-top:1px solid #9b1c20;border-bottom:1px solid #9b1c20;padding:8px 4px;"><span style="font-size:17px;font-weight:700;color:#1a1a1a;letter-spacing:0.15em;">${inner}</span></section></section>`;
  },
  renderH3(inner) {
    return `<section style="margin:26px 0 14px;text-align:center;"><span style="font-size:16px;font-weight:700;color:#9b1c20;letter-spacing:0.1em;">◆ ${inner} ◆</span></section>`;
  },
  renderBlockquote(inner) {
    return `<section style="margin:18px 0;padding:14px 16px;background-color:#fbeceb;border-left:3px solid #9b1c20;color:#6b4a4a;font-size:14px;line-height:1.75;">${inner}</section>`;
  },
  renderHr() {
    // 上下双细线，公文/校务通稿常见的正式分隔样式
    return `<section style="margin:32px 0;padding:0;"><section style="border-top:1px solid #9b1c20;margin:0 60px 3px;"></section><section style="border-top:1px solid #9b1c20;margin:0 60px;"></section></section>`;
  },
  renderImage(src, altEscaped) {
    // formal 主题要求直角，不加圆角
    const cap = altEscaped ? `<figcaption style="${formal.styles.figcaption}">${altEscaped}</figcaption>` : '';
    return `<section style="margin:20px 0;padding:0;"><img src="${src}" alt="${altEscaped}" style="width:100%;height:auto;display:block;border-radius:0;margin:0;"/>${cap}</section>`;
  },
  renderTitleBlock(titleEscaped, digestEscaped) {
    if (!titleEscaped && !digestEscaped) return '';
    const titleHtml = titleEscaped
      ? `<section style="border-top:1px solid #9b1c20;margin:0 40px 4px;padding:0;"></section><section style="text-align:center;margin:0 0 4px;padding:10px 0;"><span style="font-size:21px;font-weight:700;color:#1a1a1a;letter-spacing:0.15em;line-height:1.5;">${titleEscaped}</span></section><section style="border-top:1px solid #9b1c20;margin:4px 40px 18px;padding:0;"></section>`
      : '';
    const digestHtml = digestEscaped
      ? `<section style="text-align:center;margin:0 0 28px;padding:0 8px;"><span style="font-size:14px;color:#7a5252;line-height:1.8;">${digestEscaped}</span></section>`
      : '';
    return titleHtml + digestHtml;
  },
  renderSignOff() {
    return `<section style="margin:40px 0 10px;padding:0;"><section style="border-top:1px solid #9b1c20;margin:0 60px 3px;"></section><section style="border-top:1px solid #9b1c20;margin:0 60px;"></section></section><section style="text-align:center;margin:0 0 4px;"><span style="font-size:12px;color:#9b1c20;letter-spacing:0.2em;">E N D</span></section>`;
  },
};

const fresh = {
  key: 'fresh',
  name: '杂志绿',
  desc: '绿色下划线粗条，清新版式，适合校园/杂志/生活方式类内容',
  accent: '#2f9e44',
  rootStyle: `font-family:${FONT_STACK};color:#333333;`,
  styles: {
    h1: 'font-size:22px;font-weight:700;color:#16321d;line-height:1.5;text-align:center;margin:0 0 20px;',
    p: 'font-size:15px;line-height:1.75;color:#333333;letter-spacing:0.03em;text-align:justify;margin:0 0 20px;',
    strong: 'font-weight:700;color:#2f9e44;',
    em: 'color:#5f8f6a;font-style:italic;',
    ul: 'margin:0 0 20px;padding-left:24px;font-size:15px;line-height:1.75;color:#333333;',
    ol: 'margin:0 0 20px;padding-left:24px;font-size:15px;line-height:1.75;color:#333333;',
    li: 'margin-bottom:8px;',
    a: 'color:#2f9e44;text-decoration:underline;',
    figcaption: 'display:block;font-size:12px;color:#999999;text-align:center;line-height:1.6;margin:8px 0 0;padding:0;',
    hr: 'border:none;border-top:1px solid #d8f0dc;margin:32px 0;',
  },
  renderH2(inner) {
    return `<section style="margin:36px 0 18px;"><span style="font-size:18px;font-weight:700;color:#16321d;line-height:1.6;padding-bottom:4px;border-bottom:4px solid #2f9e44;display:inline-block;">${inner}</span></section>`;
  },
  renderH3(inner) {
    return `<section style="margin:26px 0 14px;"><span style="display:inline-block;width:6px;height:6px;border-radius:50%;background-color:#2f9e44;margin-right:8px;vertical-align:middle;"></span><span style="font-size:16px;font-weight:700;color:#16321d;vertical-align:middle;border-bottom:1px solid #a8dab0;padding-bottom:2px;">${inner}</span></section>`;
  },
  renderBlockquote(inner) {
    return `<section style="margin:18px 0;padding:14px 16px;background-color:#eef8ef;border-left:3px solid #2f9e44;color:#4c6b52;font-size:14px;line-height:1.75;">${inner}</section>`;
  },
  renderHr() {
    return centerDots(3, '5px', '6px', '#2f9e44', '32px 0');
  },
  renderImage(src, altEscaped) {
    const cap = altEscaped ? `<figcaption style="${fresh.styles.figcaption}">${altEscaped}</figcaption>` : '';
    return `<section style="margin:20px 0;padding:0;"><img src="${src}" alt="${altEscaped}" style="width:100%;height:auto;display:block;border-radius:8px;margin:0;"/>${cap}</section>`;
  },
  renderTitleBlock(titleEscaped, digestEscaped) {
    if (!titleEscaped && !digestEscaped) return '';
    const titleHtml = titleEscaped
      ? `<section style="margin:0 0 18px;"><span style="font-size:22px;font-weight:700;color:#16321d;line-height:1.4;padding-bottom:6px;border-bottom:4px solid #2f9e44;display:inline-block;">${titleEscaped}</span></section>`
      : '';
    const digestHtml = digestEscaped
      ? `<section style="margin:0 0 28px;padding:10px 14px;background-color:#eef8ef;border-left:3px solid #2f9e44;"><span style="font-size:14px;color:#4c6b52;line-height:1.8;">${digestEscaped}</span></section>`
      : '';
    return titleHtml + digestHtml;
  },
  renderSignOff() {
    return `${centerDots(3, '5px', '6px', '#2f9e44', '40px 0 10px')}<section style="text-align:center;margin:0 0 4px;"><span style="font-size:12px;color:#7fb589;letter-spacing:0.2em;">E N D</span></section>`;
  },
};

const THEME_SPECS = { minimal, academic, warm, formal, fresh };

// 供主题选择 UI 使用的元数据列表（渲染契约的一部分，另一个 agent 依赖此结构渲染选择卡片）
export const WECHAT_THEMES = [
  { key: 'minimal', name: minimal.name, desc: minimal.desc, accent: minimal.accent },
  { key: 'academic', name: academic.name, desc: academic.desc, accent: academic.accent },
  { key: 'warm', name: warm.name, desc: warm.desc, accent: warm.accent },
  { key: 'formal', name: formal.name, desc: formal.desc, accent: formal.accent },
  { key: 'fresh', name: fresh.name, desc: fresh.desc, accent: fresh.accent },
];

// 为一次渲染创建独立的 marked Renderer 实例：闭包捕获 theme/photosMap/图片计数器，
// 避免多次渲染或并发调用之间共享可变状态
function createRenderer(theme, photosMap, counter) {
  const renderer = new marked.Renderer();

  renderer.heading = (text, level) => {
    if (level === 1) return `<h1 style="${theme.styles.h1}">${text}</h1>\n`;
    if (level === 2) return `${theme.renderH2(text)}\n`;
    // h4~h6 退化为 h3 视觉规格，主题规格本身只区分到 h3
    return `${theme.renderH3(text)}\n`;
  };

  renderer.paragraph = (text) => `<p style="${theme.styles.p}">${text}</p>\n`;

  renderer.strong = (text) => `<strong style="${theme.styles.strong}">${text}</strong>`;

  renderer.em = (text) => `<em style="${theme.styles.em}">${text}</em>`;

  renderer.list = (body, ordered, start) => {
    const tag = ordered ? 'ol' : 'ul';
    const style = ordered ? theme.styles.ol : theme.styles.ul;
    const startAttr = ordered && start !== 1 ? ` start="${start}"` : '';
    return `<${tag} style="${style}"${startAttr}>\n${body}</${tag}>\n`;
  };

  renderer.listitem = (text) => `<li style="${theme.styles.li}">${text}</li>\n`;

  renderer.blockquote = (quote) => `${theme.renderBlockquote(quote)}\n`;

  renderer.hr = () => `${theme.renderHr()}\n`;

  renderer.image = (href, title, text) => {
    const src = resolveImageSrc(href, photosMap);
    counter.count += 1;
    return theme.renderImage(src, escapeHtml(text));
  };

  renderer.link = (href, title, text) => {
    const safeHref = escapeHtml(href || '');
    return `<a href="${safeHref}" style="${theme.styles.a}">${text}</a>`;
  };

  return renderer;
}

// 内部渲染主体：产出未经 DOMPurify 清洗的 HTML，供 renderWechatHtml 清洗后对外，
// 也单独导出为 renderWechatHtmlRaw 供 Node 自测脚本使用（DOMPurify 在纯 Node 环境下没有 window，无法调用 sanitize）
function buildWechatHtml(markdown, options) {
  const opts = options || {};
  const theme = THEME_SPECS[opts.themeKey] || minimal;
  const counter = { count: 0 };
  const renderer = createRenderer(theme, opts.photosMap || {}, counter);

  marked.setOptions({ mangle: false, headerIds: false, gfm: true });
  const bodyHtml = marked.parse(String(markdown || ''), { renderer });

  const hasTitleBlock = Boolean(opts.title) || Boolean(opts.digest);
  const titleHtml = hasTitleBlock
    ? theme.renderTitleBlock(opts.title ? escapeHtml(opts.title) : '', opts.digest ? escapeHtml(opts.digest) : '')
    : '';
  const signOffHtml = theme.renderSignOff();

  const html = `<section style="${theme.rootStyle}">${titleHtml}${bodyHtml}${signOffHtml}</section>`;
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
 * @param {{themeKey:string, photosMap:Object, title?:string, digest?:string}} options
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
