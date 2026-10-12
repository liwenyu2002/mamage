// 内置样式块库 · B 组：quote / divider / imageCard / signoff。
// 契约见 styleblocks-contracts.md（数据模型/槽位语法/HTML 存活硬规则）。
// 存活硬规则重申：只用内联 style；只许 color/font-size/font-weight/letter-spacing/line-height/
// text-align/margin/padding/background(-color/线性渐变)/border/border-radius/box-shadow/
// display:block|inline-block/width/height/max-width/opacity/vertical-align；
// 禁止 class=/position:/id=/onXX=/<style/<script/transform/flex/grid；复杂形状用多层 <section>/<span> 嵌套，
// 装饰图形用 border 或字符（●◆▪︎）手搓，不许外链图片（imageCard 的 {{src}} 是用户槽位，不算外链硬编码）。
//
// {{accent}} 是 accentEditable=true 块的主色占位；本文件里大量使用 `{{accent}}XX`（8 位十六进制色，
// 末两位是十六进制透明度，如 14≈8%、33≈20%）来做浅色底纹/描边，这是 CSS Color 4 的合法写法，
// 微信 webview（Chromium 内核）支持；若目标渲染环境更保守，把这类 8 位色值换成纯色/去掉透明度即可。
// 菱形分隔线用「上下两个 0 宽高、border 三角拼接」的经典技巧堆出菱形，不依赖 transform。

// ---- 小工具：只生成字符串，不在渲染期调用 ----

// 三角形拼菱形：wrapper 是 inline-block，两个子 span 各 display:block 自然纵向堆叠 → 菱形
function diamondUnit(sizePx, accentPh) {
  const top = `<span style="display:block;width:0;height:0;margin:0;padding:0;border-left:${sizePx}px solid transparent;border-right:${sizePx}px solid transparent;border-bottom:${sizePx}px solid ${accentPh};line-height:0;"></span>`;
  const bottom = `<span style="display:block;width:0;height:0;margin:0;padding:0;border-left:${sizePx}px solid transparent;border-right:${sizePx}px solid transparent;border-top:${sizePx}px solid ${accentPh};line-height:0;"></span>`;
  return `<span style="display:inline-block;vertical-align:middle;margin:0 7px;line-height:0;">${top}${bottom}</span>`;
}

function diamondChain(count, sizePx, accentPh) {
  let out = '';
  for (let i = 0; i < count; i += 1) out += diamondUnit(sizePx, accentPh);
  return out;
}

// ================= quote x 10 =================
// 其中 5 个（academic/warm/formal/fresh/minimal）逐字复刻 themes.js 五套旧主题的 renderBlockquote 规格，
// 供后续「旧主题 → 预设 blockConfig」迁移时直接引用，保证向后兼容不走样。

const QUOTE_BLOCKS = [
  {
    id: 'builtin-quote-mark-card',
    type: 'quote',
    name: '大引号装饰卡',
    htmlTemplate: '<section style="margin:20px 0;padding:20px 18px 16px;background-color:#f9f6f2;border-radius:8px;"><span style="font-size:34px;font-weight:700;color:{{accent}};line-height:1;">“</span><section style="margin:4px 0 0;padding:0 4px;"><span style="font-size:14px;color:#5a5a5a;line-height:1.8;">{{content}}</span></section></section>',
    accentEditable: true,
    source: 'builtin',
    sourceUrl: null,
  },
  {
    id: 'builtin-quote-left-bar',
    type: 'quote',
    name: '左色条引用卡',
    htmlTemplate: '<section style="margin:18px 0;padding:12px 16px;border-left:4px solid {{accent}};"><span style="font-size:14px;color:#555555;line-height:1.8;">{{content}}</span></section>',
    accentEditable: true,
    source: 'builtin',
    sourceUrl: null,
  },
  {
    id: 'builtin-quote-double-border',
    type: 'quote',
    name: '双边框引用卡',
    htmlTemplate: '<section style="margin:18px 0;padding:6px;border:1px solid {{accent}}33;"><section style="padding:12px 14px;border:1px solid {{accent}};"><span style="font-size:14px;color:#555555;line-height:1.8;">{{content}}</span></section></section>',
    accentEditable: true,
    source: 'builtin',
    sourceUrl: null,
  },
  {
    id: 'builtin-quote-diagonal-stripe',
    type: 'quote',
    name: '斜纹底引用卡',
    htmlTemplate: '<section style="margin:18px 0;padding:14px 16px;background-image:repeating-linear-gradient(45deg,{{accent}}14,{{accent}}14 8px,transparent 8px,transparent 16px);border-left:3px solid {{accent}};"><span style="font-size:14px;color:#4a4a4a;line-height:1.8;">{{content}}</span></section>',
    accentEditable: true,
    source: 'builtin',
    sourceUrl: null,
  },
  {
    id: 'builtin-quote-bubble',
    type: 'quote',
    name: '对话气泡引用卡',
    htmlTemplate: '<section style="margin:18px 0;padding:14px 18px;background-color:{{accent}}14;border-radius:16px 16px 16px 4px;"><span style="font-size:14px;color:#4a4a4a;line-height:1.8;">{{content}}</span></section>',
    accentEditable: true,
    source: 'builtin',
    sourceUrl: null,
  },
  {
    id: 'builtin-quote-academic',
    type: 'quote',
    name: '学院蓝引用块',
    htmlTemplate: '<section style="margin:18px 0;padding:14px 16px;background-color:#eef3fa;border-left:3px solid {{accent}};"><span style="font-size:14px;color:#4a5b73;line-height:1.75;">{{content}}</span></section>',
    accentEditable: true,
    source: 'builtin',
    sourceUrl: null,
  },
  {
    id: 'builtin-quote-warm',
    type: 'quote',
    name: '暖阳橙引用卡',
    htmlTemplate: '<section style="margin:18px 0;padding:14px 16px;background-color:#fff4ea;border-left:3px solid {{accent}};border-radius:0 8px 8px 0;"><span style="font-size:14px;color:#8a6a4c;line-height:1.75;">{{content}}</span></section>',
    accentEditable: true,
    source: 'builtin',
    sourceUrl: null,
  },
  {
    id: 'builtin-quote-formal',
    type: 'quote',
    name: '庄重红引用卡',
    htmlTemplate: '<section style="margin:18px 0;padding:14px 16px;background-color:#fbeceb;border-left:3px solid {{accent}};"><span style="font-size:14px;color:#6b4a4a;line-height:1.75;letter-spacing:0.02em;">{{content}}</span></section>',
    accentEditable: true,
    source: 'builtin',
    sourceUrl: null,
  },
  {
    id: 'builtin-quote-fresh',
    type: 'quote',
    name: '杂志绿引用卡',
    htmlTemplate: '<section style="margin:18px 0;padding:14px 16px;background-color:#eef8ef;border-left:3px solid {{accent}};"><span style="font-size:14px;color:#4c6b52;line-height:1.75;">{{content}}</span></section>',
    accentEditable: true,
    source: 'builtin',
    sourceUrl: null,
  },
  {
    id: 'builtin-quote-minimal',
    type: 'quote',
    name: '极简灰引用卡',
    htmlTemplate: '<section style="margin:18px 0;padding:14px 16px;background-color:#f7f7f7;border-left:3px solid {{accent}};"><span style="font-size:14px;color:#666666;line-height:1.75;">{{content}}</span></section>',
    accentEditable: true,
    source: 'builtin',
    sourceUrl: null,
  },
];

// ================= divider x 6 =================
// divider 无槽位（纯装饰），"精彩继续" 等文案是块内固定装饰文字，不是槽位内容。

const DIVIDER_BLOCKS = [
  {
    id: 'builtin-divider-ellipsis-dots',
    type: 'divider',
    name: '省略号点阵分隔线',
    htmlTemplate: '<section style="text-align:center;margin:32px 0;padding:0;">'
      + '<span style="display:inline-block;width:4px;height:4px;border-radius:50%;background-color:{{accent}};margin:0 5px;vertical-align:middle;"></span>'
      + '<span style="display:inline-block;width:6px;height:6px;border-radius:50%;background-color:{{accent}};margin:0 5px;vertical-align:middle;"></span>'
      + '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background-color:{{accent}};margin:0 5px;vertical-align:middle;"></span>'
      + '<span style="display:inline-block;width:6px;height:6px;border-radius:50%;background-color:{{accent}};margin:0 5px;vertical-align:middle;"></span>'
      + '<span style="display:inline-block;width:4px;height:4px;border-radius:50%;background-color:{{accent}};margin:0 5px;vertical-align:middle;"></span>'
      + '</section>',
    accentEditable: true,
    source: 'builtin',
    sourceUrl: null,
  },
  {
    id: 'builtin-divider-diamond-chain',
    type: 'divider',
    name: '菱形链分隔线',
    htmlTemplate: `<section style="text-align:center;margin:32px 0;padding:0;line-height:0;">${diamondChain(3, 4, '{{accent}}')}</section>`,
    accentEditable: true,
    source: 'builtin',
    sourceUrl: null,
  },
  {
    id: 'builtin-divider-gradient-bar',
    type: 'divider',
    name: '渐变宽条分隔线',
    htmlTemplate: '<section style="text-align:center;margin:32px 0;padding:0;"><span style="display:inline-block;width:120px;height:3px;border-radius:2px;background-image:linear-gradient(90deg,{{accent}}00,{{accent}},{{accent}}00);"></span></section>',
    accentEditable: true,
    source: 'builtin',
    sourceUrl: null,
  },
  {
    id: 'builtin-divider-text-inline',
    type: 'divider',
    name: '中缀文字分隔线',
    htmlTemplate: '<section style="text-align:center;margin:32px 0;padding:0;">'
      + '<span style="display:inline-block;width:52px;height:1px;background-color:{{accent}};vertical-align:middle;margin:0 12px 0 0;"></span>'
      + '<span style="font-size:13px;color:{{accent}};letter-spacing:0.15em;vertical-align:middle;">· 精彩继续 ·</span>'
      + '<span style="display:inline-block;width:52px;height:1px;background-color:{{accent}};vertical-align:middle;margin:0 0 0 12px;"></span>'
      + '</section>',
    accentEditable: true,
    source: 'builtin',
    sourceUrl: null,
  },
  {
    id: 'builtin-divider-double-line',
    type: 'divider',
    name: '粗细双线分隔线',
    htmlTemplate: '<section style="text-align:center;margin:32px 0 4px;padding:0;"><span style="display:inline-block;width:32px;height:3px;background-color:{{accent}};margin:0;"></span></section>'
      + '<section style="text-align:center;margin:0 0 32px;padding:0;"><span style="display:inline-block;width:60px;height:1px;background-color:{{accent}};margin:0;"></span></section>',
    accentEditable: true,
    source: 'builtin',
    sourceUrl: null,
  },
  {
    // 注：与 A 组的 builtin-divider-wave-dots（同名同构思）撞 id，改名避让，保留为「错位版」区分
    id: 'builtin-divider-offset-dots',
    type: 'divider',
    name: '错位点阵分隔线',
    htmlTemplate: '<section style="text-align:center;margin:32px 0;padding:0;line-height:1;">'
      + '<span style="display:inline-block;width:5px;height:5px;border-radius:50%;background-color:{{accent}};margin:0 4px;vertical-align:top;"></span>'
      + '<span style="display:inline-block;width:5px;height:5px;border-radius:50%;background-color:{{accent}};margin:0 4px;vertical-align:bottom;"></span>'
      + '<span style="display:inline-block;width:5px;height:5px;border-radius:50%;background-color:{{accent}};margin:0 4px;vertical-align:top;"></span>'
      + '<span style="display:inline-block;width:5px;height:5px;border-radius:50%;background-color:{{accent}};margin:0 4px;vertical-align:bottom;"></span>'
      + '<span style="display:inline-block;width:5px;height:5px;border-radius:50%;background-color:{{accent}};margin:0 4px;vertical-align:top;"></span>'
      + '</section>',
    accentEditable: true,
    source: 'builtin',
    sourceUrl: null,
  },
];

// ================= imageCard x 6 =================
// {{src}} 是图片地址槽位（唯一允许出现在 <img src> 上的值，不得写死 http 外链）；
// {{#caption}}...{{/caption}} 是简易条件段：caption 为空时渲染器整段剔除，非空时替换其中的 {{caption}}。

const IMAGE_CARD_BLOCKS = [
  {
    id: 'builtin-imageCard-round-shadow',
    type: 'imageCard',
    name: '圆角阴影图卡',
    htmlTemplate: '<section style="margin:20px 0;padding:0;"><section style="border-radius:14px;box-shadow:0 6px 18px rgba(0,0,0,0.12);padding:3px;background-color:{{accent}};"><img src="{{src}}" style="width:100%;height:auto;display:block;border-radius:11px;margin:0;"/></section>{{#caption}}<section style="margin:8px 0 0;padding:0;text-align:center;"><span style="font-size:12px;color:#999999;line-height:1.6;">{{caption}}</span></section>{{/caption}}</section>',
    accentEditable: true,
    source: 'builtin',
    sourceUrl: null,
  },
  {
    id: 'builtin-imageCard-film-frame',
    type: 'imageCard',
    name: '白边胶片框图卡',
    htmlTemplate: '<section style="margin:20px 0;padding:0;text-align:center;"><section style="display:inline-block;background-color:#ffffff;padding:10px 10px 30px;border:1px solid #eeeeee;box-shadow:0 4px 14px rgba(0,0,0,0.10);max-width:100%;"><img src="{{src}}" style="width:100%;max-width:100%;height:auto;display:block;margin:0;"/>{{#caption}}<section style="margin:10px 0 0;padding:0;"><span style="font-size:12px;color:#999999;line-height:1.5;">{{caption}}</span></section>{{/caption}}</section></section>',
    accentEditable: false,
    source: 'builtin',
    sourceUrl: null,
  },
  {
    id: 'builtin-imageCard-color-bar-caption',
    type: 'imageCard',
    name: '色条底图注图卡',
    htmlTemplate: '<section style="margin:20px 0;padding:0;"><img src="{{src}}" style="width:100%;height:auto;display:block;margin:0;"/>{{#caption}}<section style="background-color:{{accent}};margin:0;padding:8px 14px;"><span style="font-size:12px;color:#ffffff;line-height:1.6;letter-spacing:0.05em;">{{caption}}</span></section>{{/caption}}</section>',
    accentEditable: true,
    source: 'builtin',
    sourceUrl: null,
  },
  {
    id: 'builtin-imageCard-thick-border',
    type: 'imageCard',
    name: '宽线框图卡',
    htmlTemplate: '<section style="margin:20px 0;padding:0;"><section style="border:6px solid {{accent}};padding:4px;background-color:#ffffff;"><img src="{{src}}" style="width:100%;height:auto;display:block;margin:0;"/></section>{{#caption}}<section style="margin:8px 0 0;padding:0;text-align:center;"><span style="font-size:12px;color:#999999;line-height:1.6;">{{caption}}</span></section>{{/caption}}</section>',
    accentEditable: true,
    source: 'builtin',
    sourceUrl: null,
  },
  {
    id: 'builtin-imageCard-double-layer',
    type: 'imageCard',
    name: '双层卡图卡',
    htmlTemplate: '<section style="margin:20px 0;padding:0 10px 10px 0;background-color:{{accent}};"><section style="background-color:#ffffff;margin:0;padding:0;box-shadow:0 4px 12px rgba(0,0,0,0.15);">'
      + '<img src="{{src}}" style="width:100%;height:auto;display:block;margin:0;"/>{{#caption}}<section style="padding:8px 12px;margin:0;"><span style="font-size:12px;color:#666666;line-height:1.6;">{{caption}}</span></section>{{/caption}}'
      + '</section></section>',
    accentEditable: true,
    source: 'builtin',
    sourceUrl: null,
  },
  {
    id: 'builtin-imageCard-minimal-underline',
    type: 'imageCard',
    name: '极简底线图注图卡',
    htmlTemplate: '<section style="margin:20px 0;padding:0;"><img src="{{src}}" style="width:100%;height:auto;display:block;margin:0;border-radius:4px;"/>{{#caption}}<section style="margin:10px 0 0;padding:6px 0 0;border-top:1px solid #e5e5e5;"><span style="font-size:12px;color:#999999;line-height:1.6;">{{caption}}</span></section>{{/caption}}</section>',
    accentEditable: false,
    source: 'builtin',
    sourceUrl: null,
  },
];

// ================= signoff x 4 =================

const SIGNOFF_BLOCKS = [
  {
    id: 'builtin-signoff-follow-card',
    type: 'signoff',
    name: '关注引导卡',
    htmlTemplate: '<section style="margin:40px 0 10px;padding:0;"><section style="text-align:center;margin:0 0 14px;"><span style="font-size:13px;color:#666666;line-height:1.8;">{{content}}</span></section><section style="text-align:center;margin:0;padding:0;"><section style="display:inline-block;padding:8px 22px;border-radius:20px;background-color:{{accent}};"><span style="font-size:13px;font-weight:700;color:#ffffff;letter-spacing:0.1em;">长按关注我们</span></section></section></section>',
    accentEditable: true,
    source: 'builtin',
    sourceUrl: null,
  },
  {
    id: 'builtin-signoff-end-badge',
    type: 'signoff',
    name: 'END 徽章落款',
    htmlTemplate: '<section style="margin:40px 0 10px;padding:0;"><section style="text-align:center;margin:0 0 12px;"><span style="font-size:13px;color:#888888;line-height:1.8;">{{content}}</span></section><section style="text-align:center;margin:0;"><section style="display:inline-block;padding:4px 16px;border:1.5px solid {{accent}};border-radius:2px;"><span style="font-size:12px;font-weight:700;color:{{accent}};letter-spacing:0.3em;">END</span></section></section></section>',
    accentEditable: true,
    source: 'builtin',
    sourceUrl: null,
  },
  {
    id: 'builtin-signoff-divider-sign',
    type: 'signoff',
    name: '分割落款',
    htmlTemplate: '<section style="margin:40px 0 10px;padding:0;"><section style="text-align:center;margin:0 0 14px;padding:0;"><span style="display:inline-block;width:36px;height:2px;background-color:{{accent}};"></span></section><section style="text-align:center;margin:0;padding:0 10px;"><span style="font-size:13px;color:#888888;line-height:1.8;">{{content}}</span></section></section>',
    accentEditable: true,
    source: 'builtin',
    sourceUrl: null,
  },
  {
    id: 'builtin-signoff-qr-placeholder',
    type: 'signoff',
    name: '二维码位提示卡',
    htmlTemplate: '<section style="margin:40px 0 10px;padding:0;"><section style="text-align:center;margin:0 0 14px;"><span style="font-size:13px;color:#888888;line-height:1.8;">{{content}}</span></section><section style="text-align:center;margin:0;"><section style="display:inline-block;width:96px;height:96px;border:1.5px dashed {{accent}};border-radius:4px;background-color:#fafafa;"><span style="display:inline-block;margin-top:38px;font-size:11px;color:#bbbbbb;line-height:1.4;">二维码位</span></section></section></section>',
    accentEditable: true,
    source: 'builtin',
    sourceUrl: null,
  },
];

// 数量契约：quote x10 / divider x6 / imageCard x6 / signoff x4 = 26
export const BUILTIN_BLOCKS_B = [
  ...QUOTE_BLOCKS,
  ...DIVIDER_BLOCKS,
  ...IMAGE_CARD_BLOCKS,
  ...SIGNOFF_BLOCKS,
];
