// 内置样式块库 · A 组：h2 x14、h3 x8、divider x4（共 26），本文件独占，不与其它组的
// builtinBlocksB/C 等文件产生 id 冲突（命名统一 builtin-<type>-<slug>）。
//
// 契约来源：/private/tmp/claude-501/-Users-liwenyu/f413e1a5-8f0f-436d-b775-8c9faffa99f1/scratchpad/styleblocks-contracts.md
// 存活硬规则（每个模板必须遵守，selfcheck 会断言）：只允许内联 style；只用 color/font-size/
// font-weight/letter-spacing/line-height/text-align/margin/padding/background(-color/线性渐变)/
// border(-top/-left/-right/-bottom)/border-radius/box-shadow/display:block|inline-block/width/
// height/max-width/opacity/vertical-align；禁止 class=/position:/display:flex|grid/transform:/
// <img/id=/<script>/<style>标签/外链图片。font-family 不在允许清单内，本文件所有模板一律不写。
//
// 未找到 PRESET_BLOCK_IDS.md（等待 60s 后仍不存在，按约定自行推断）：5 个"对应现有主题风"的
// h2/h3 块沿用 builtin-h2-<themeKey> / builtin-h3-<themeKey> 命名（minimal/academic/warm/formal/
// fresh），与 src/wechat/themes.js 里 THEME_SPECS 的 renderH2/renderH3 视觉规格一一对应，只是把
// 主题写死的 accent 十六进制色换成 {{accent}} 占位符，其余非主色（如白字、浅灰底）保持字面量，
// 因为模板只做 {{accent}} 原样替换，没有"由 accent 派生浅色"的能力。
//
// 渐变/阴影处理：需要"半透明叠加"效果的场景（如暖阳胶囊原本用 rgba(accent,0.25) 做阴影），一律改用
// 契约建议的"背景渐变叠白"（linear-gradient(...,{{accent}} ..,#ffffff ..)）或改用与主色无关的中性
// 阴影（box-shadow 用固定 rgba(0,0,0,x)），不做任何从 {{accent}} 派生透明度的运算。

// ---- 小工具：生成重复的装饰性 span（纯字符串拼接，不引入运行时依赖）----

// 底纹条使用的密集竖纹刻度：count 根竖条，交替用 accent 色，模拟条码/纹理质感
function tickRow(count, width, height, gap, colorToken) {
  const tick = `<span style="display:inline-block;width:${width};height:${height};background-color:${colorToken};margin-right:${gap};vertical-align:top;"></span>`;
  return tick.repeat(count);
}

// ==================== h2 x 14 ====================

// -- 5 个对应现有主题风（视觉规格照抄 themes.js 对应 renderH2，主色替换为 {{accent}}）--

const h2Minimal = {
  id: 'builtin-h2-minimal',
  type: 'h2',
  name: '极简黑标题',
  htmlTemplate:
    '<section style="margin:36px 0 18px;padding:2px 0 2px 14px;border-left:4px solid {{accent}};"><span style="font-size:18px;font-weight:700;color:{{accent}};line-height:1.5;">{{content}}</span></section>',
  accentEditable: true,
  source: 'builtin',
  sourceUrl: null,
};

const h2Academic = {
  id: 'builtin-h2-academic',
  type: 'h2',
  name: '学院蓝标题',
  htmlTemplate:
    '<section style="margin:36px 0 18px;padding:10px 16px;background-color:{{accent}};border-radius:3px;"><span style="font-size:17px;font-weight:700;color:#ffffff;letter-spacing:0.05em;line-height:1.6;">{{content}}</span></section>',
  accentEditable: true,
  source: 'builtin',
  sourceUrl: null,
};

const h2Warm = {
  id: 'builtin-h2-warm',
  type: 'h2',
  name: '暖阳胶囊标题',
  htmlTemplate:
    '<section style="margin:36px 0 18px;text-align:left;"><section style="display:inline-block;padding:6px 22px;border-radius:20px;background-image:linear-gradient(135deg,{{accent}} 0%,{{accent}} 60%,#ffffff 170%);box-shadow:0 4px 10px rgba(0,0,0,0.18);"><span style="font-size:16px;font-weight:700;color:#ffffff;letter-spacing:0.05em;">{{content}}</span></section></section>',
  accentEditable: true,
  source: 'builtin',
  sourceUrl: null,
};

const h2Formal = {
  id: 'builtin-h2-formal',
  type: 'h2',
  name: '庄重红标题',
  htmlTemplate:
    '<section style="margin:36px 0 18px;text-align:center;"><section style="display:inline-block;border-top:1px solid {{accent}};border-bottom:1px solid {{accent}};padding:8px 4px;"><span style="font-size:17px;font-weight:700;color:#1a1a1a;letter-spacing:0.15em;">{{content}}</span></section></section>',
  accentEditable: true,
  source: 'builtin',
  sourceUrl: null,
};

const h2Fresh = {
  id: 'builtin-h2-fresh',
  type: 'h2',
  name: '杂志绿标题',
  htmlTemplate:
    '<section style="margin:36px 0 18px;"><span style="font-size:18px;font-weight:700;color:{{accent}};line-height:1.6;padding-bottom:4px;border-bottom:4px solid {{accent}};display:inline-block;">{{content}}</span></section>',
  accentEditable: true,
  source: 'builtin',
  sourceUrl: null,
};

// -- 9 个新风格 --

const h2GradientPill = {
  id: 'builtin-h2-gradient-pill',
  type: 'h2',
  name: '渐变胶囊标题',
  htmlTemplate:
    '<section style="margin:34px 0 16px;text-align:center;"><section style="display:inline-block;padding:8px 26px;border-radius:999px;background-image:linear-gradient(120deg,{{accent}} 10%,#ffffff 220%);box-shadow:0 3px 8px rgba(0,0,0,0.15);"><span style="font-size:17px;font-weight:700;color:#ffffff;letter-spacing:0.08em;">{{content}}</span></section></section>',
  accentEditable: true,
  source: 'builtin',
  sourceUrl: null,
};

const h2DuotoneBlock = {
  id: 'builtin-h2-duotone-block',
  type: 'h2',
  name: '双色拼块标题',
  htmlTemplate:
    '<section style="margin:34px 0 16px;"><span style="display:inline-block;width:10px;height:26px;background-color:{{accent}};vertical-align:middle;"></span><span style="display:inline-block;padding:5px 16px;background-color:#f2f2f2;vertical-align:middle;"><span style="font-size:17px;font-weight:700;color:#1a1a1a;letter-spacing:0.03em;">{{content}}</span></span></section>',
  accentEditable: true,
  source: 'builtin',
  sourceUrl: null,
};

const h2RoundStamp = {
  id: 'builtin-h2-round-stamp',
  type: 'h2',
  name: '左圆章序号标题',
  htmlTemplate:
    '<section style="margin:34px 0 16px;"><span style="display:inline-block;width:30px;height:30px;line-height:28px;text-align:center;border:2px solid {{accent}};border-radius:50%;color:{{accent}};font-size:13px;font-weight:700;vertical-align:middle;margin-right:10px;">01</span><span style="font-size:17px;font-weight:700;color:#1a1a1a;vertical-align:middle;">{{content}}</span></section>',
  accentEditable: true,
  source: 'builtin',
  sourceUrl: null,
};

const h2BookTitleMark = {
  id: 'builtin-h2-booktitle-mark',
  type: 'h2',
  name: '书名号装饰标题',
  htmlTemplate:
    '<section style="margin:34px 0 16px;text-align:center;"><span style="font-size:19px;font-weight:700;color:{{accent}};">《</span><span style="font-size:18px;font-weight:700;color:#1a1a1a;letter-spacing:0.04em;padding:0 4px;">{{content}}</span><span style="font-size:19px;font-weight:700;color:{{accent}};">》</span></section>',
  accentEditable: true,
  source: 'builtin',
  sourceUrl: null,
};

const h2TextureBar = {
  id: 'builtin-h2-texture-bar',
  type: 'h2',
  name: '底纹条标题',
  htmlTemplate:
    `<section style="margin:34px 0 6px;padding:10px 14px;background-color:#f7f7f7;"><span style="font-size:17px;font-weight:700;color:#1a1a1a;">{{content}}</span></section><section style="margin:0 0 16px;padding:0 14px;">${tickRow(16, '3px', '7px', '3px', '{{accent}}')}</section>`,
  accentEditable: true,
  source: 'builtin',
  sourceUrl: null,
};

const h2BoldUnderlineEn = {
  id: 'builtin-h2-bold-underline-en',
  type: 'h2',
  name: '粗底线+英文小字标题',
  htmlTemplate:
    '<section style="margin:34px 0 16px;"><span style="display:block;font-size:11px;font-weight:700;color:{{accent}};letter-spacing:0.35em;margin:0 0 4px;">TITLE</span><span style="font-size:18px;font-weight:700;color:#1a1a1a;padding-bottom:6px;border-bottom:5px solid {{accent}};display:inline-block;">{{content}}</span></section>',
  accentEditable: true,
  source: 'builtin',
  sourceUrl: null,
};

const h2BracketLine = {
  id: 'builtin-h2-bracket-line',
  type: 'h2',
  name: '括号线标题',
  htmlTemplate:
    '<section style="margin:34px 0 16px;"><span style="display:inline-block;width:14px;height:20px;border-top:3px solid {{accent}};border-left:3px solid {{accent}};vertical-align:middle;margin-right:8px;"></span><span style="font-size:18px;font-weight:700;color:#1a1a1a;vertical-align:middle;">{{content}}</span><span style="display:inline-block;width:14px;height:20px;border-bottom:3px solid {{accent}};border-right:3px solid {{accent}};vertical-align:middle;margin-left:8px;"></span></section>',
  accentEditable: true,
  source: 'builtin',
  sourceUrl: null,
};

const h2OffsetBlock = {
  id: 'builtin-h2-offset-block',
  type: 'h2',
  name: '色块错位标题',
  htmlTemplate:
    '<section style="margin:34px 0 18px;"><span style="display:inline-block;width:8px;height:8px;background-color:{{accent}};vertical-align:top;margin:6px 6px 0 0;"></span><span style="display:inline-block;padding:8px 16px;background-color:#f2f2f2;border-left:4px solid {{accent}};vertical-align:top;"><span style="font-size:17px;font-weight:700;color:#1a1a1a;">{{content}}</span></span></section>',
  accentEditable: true,
  source: 'builtin',
  sourceUrl: null,
};

const h2MinimalLarge = {
  id: 'builtin-h2-minimal-large',
  type: 'h2',
  name: '极简大字标题',
  htmlTemplate:
    '<section style="margin:36px 0 20px;"><span style="font-size:24px;font-weight:800;color:{{accent}};letter-spacing:0.02em;line-height:1.4;">{{content}}</span></section>',
  accentEditable: true,
  source: 'builtin',
  sourceUrl: null,
};

// ==================== h3 x 8 ====================

// -- 5 个对应现有主题风 --

const h3Minimal = {
  id: 'builtin-h3-minimal',
  type: 'h3',
  name: '极简黑小标题',
  htmlTemplate:
    '<section style="margin:26px 0 14px;"><span style="display:inline-block;width:6px;height:6px;background-color:{{accent}};margin-right:8px;vertical-align:middle;"></span><span style="font-size:16px;font-weight:700;color:{{accent}};vertical-align:middle;">{{content}}</span></section>',
  accentEditable: true,
  source: 'builtin',
  sourceUrl: null,
};

const h3Academic = {
  id: 'builtin-h3-academic',
  type: 'h3',
  name: '学院蓝小标题',
  htmlTemplate:
    '<section style="margin:26px 0 14px;padding:2px 0 2px 12px;border-left:2px solid {{accent}};"><span style="font-size:16px;font-weight:700;color:{{accent}};">{{content}}</span></section>',
  accentEditable: true,
  source: 'builtin',
  sourceUrl: null,
};

const h3Warm = {
  id: 'builtin-h3-warm',
  type: 'h3',
  name: '暖阳胶囊小标题',
  htmlTemplate:
    '<section style="margin:26px 0 14px;"><section style="display:inline-block;padding:3px 14px;border-radius:14px;border:1.5px solid {{accent}};"><span style="font-size:15px;font-weight:700;color:{{accent}};">{{content}}</span></section></section>',
  accentEditable: true,
  source: 'builtin',
  sourceUrl: null,
};

const h3Formal = {
  id: 'builtin-h3-formal',
  type: 'h3',
  name: '庄重红小标题',
  htmlTemplate:
    '<section style="margin:26px 0 14px;text-align:center;"><span style="font-size:16px;font-weight:700;color:{{accent}};letter-spacing:0.1em;">◆ {{content}} ◆</span></section>',
  accentEditable: true,
  source: 'builtin',
  sourceUrl: null,
};

const h3Fresh = {
  id: 'builtin-h3-fresh',
  type: 'h3',
  name: '杂志绿小标题',
  htmlTemplate:
    '<section style="margin:26px 0 14px;"><span style="display:inline-block;width:6px;height:6px;border-radius:50%;background-color:{{accent}};margin-right:8px;vertical-align:middle;"></span><span style="font-size:16px;font-weight:700;color:#16321d;vertical-align:middle;border-bottom:1px solid {{accent}};padding-bottom:2px;">{{content}}</span></section>',
  accentEditable: true,
  source: 'builtin',
  sourceUrl: null,
};

// -- 3 个新风格（h2 新风格的轻量版：更小字号/更少装饰）--

const h3GradientPill = {
  id: 'builtin-h3-gradient-pill',
  type: 'h3',
  name: '渐变胶囊小标题',
  htmlTemplate:
    '<section style="margin:24px 0 12px;text-align:left;"><section style="display:inline-block;padding:4px 14px;border-radius:999px;background-image:linear-gradient(120deg,{{accent}} 20%,#ffffff 220%);"><span style="font-size:13px;font-weight:700;color:#ffffff;letter-spacing:0.05em;">{{content}}</span></section></section>',
  accentEditable: true,
  source: 'builtin',
  sourceUrl: null,
};

const h3RoundDot = {
  id: 'builtin-h3-round-dot',
  type: 'h3',
  name: '左圆点序号小标题',
  htmlTemplate:
    '<section style="margin:24px 0 12px;"><span style="display:inline-block;width:16px;height:16px;line-height:16px;text-align:center;border-radius:50%;background-color:{{accent}};color:#ffffff;font-size:10px;font-weight:700;vertical-align:middle;margin-right:8px;">•</span><span style="font-size:15px;font-weight:700;color:#1a1a1a;vertical-align:middle;">{{content}}</span></section>',
  accentEditable: true,
  source: 'builtin',
  sourceUrl: null,
};

const h3BracketLine = {
  id: 'builtin-h3-bracket-line',
  type: 'h3',
  name: '括号线小标题',
  htmlTemplate:
    '<section style="margin:24px 0 12px;"><span style="display:inline-block;width:10px;height:14px;border-top:2px solid {{accent}};border-left:2px solid {{accent}};vertical-align:middle;margin-right:6px;"></span><span style="font-size:15px;font-weight:700;color:#1a1a1a;vertical-align:middle;">{{content}}</span><span style="display:inline-block;width:10px;height:14px;border-bottom:2px solid {{accent}};border-right:2px solid {{accent}};vertical-align:middle;margin-left:6px;"></span></section>',
  accentEditable: true,
  source: 'builtin',
  sourceUrl: null,
};

// ==================== divider x 4 ====================

const dividerWaveDots = {
  id: 'builtin-divider-wave-dots',
  type: 'divider',
  name: '波浪点分隔线',
  // 用 vertical-align 在 top/bottom 间交替制造锯齿波浪视觉（transform/position 不可用）
  htmlTemplate:
    '<section style="text-align:center;margin:32px 0;padding:0;"><span style="display:inline-block;width:5px;height:5px;border-radius:50%;background-color:{{accent}};margin:0 4px;vertical-align:top;"></span><span style="display:inline-block;width:5px;height:5px;border-radius:50%;background-color:{{accent}};margin:0 4px;vertical-align:bottom;"></span><span style="display:inline-block;width:5px;height:5px;border-radius:50%;background-color:{{accent}};margin:0 4px;vertical-align:top;"></span><span style="display:inline-block;width:5px;height:5px;border-radius:50%;background-color:{{accent}};margin:0 4px;vertical-align:bottom;"></span><span style="display:inline-block;width:5px;height:5px;border-radius:50%;background-color:{{accent}};margin:0 4px;vertical-align:top;"></span></section>',
  accentEditable: true,
  source: 'builtin',
  sourceUrl: null,
};

const dividerDoubleLineDiamond = {
  id: 'builtin-divider-double-line-diamond',
  type: 'divider',
  name: '双线夹钻分隔线',
  htmlTemplate:
    '<section style="text-align:center;margin:32px 0;padding:0;"><span style="display:inline-block;width:50px;height:1px;background-color:{{accent}};vertical-align:middle;margin:0 10px 3px 0;"></span><span style="font-size:12px;color:{{accent}};vertical-align:middle;">◆</span><span style="display:inline-block;width:50px;height:1px;background-color:{{accent}};vertical-align:middle;margin:0 0 3px 10px;"></span></section>',
  accentEditable: true,
  source: 'builtin',
  sourceUrl: null,
};

const dividerGradientThin = {
  id: 'builtin-divider-gradient-thin',
  type: 'divider',
  name: '渐变细条分隔线',
  htmlTemplate:
    '<section style="text-align:center;margin:32px 0;padding:0;"><span style="display:inline-block;width:120px;height:2px;background-image:linear-gradient(90deg,#ffffff 0%,{{accent}} 50%,#ffffff 100%);vertical-align:middle;"></span></section>',
  accentEditable: true,
  source: 'builtin',
  sourceUrl: null,
};

const dividerThreeStars = {
  id: 'builtin-divider-three-stars',
  type: 'divider',
  name: '三星分隔线',
  htmlTemplate:
    '<section style="text-align:center;margin:32px 0;padding:0;"><span style="font-size:14px;color:{{accent}};letter-spacing:14px;">★★★</span></section>',
  accentEditable: true,
  source: 'builtin',
  sourceUrl: null,
};

// ==================== 导出 ====================

export const BUILTIN_BLOCKS_A = [
  // h2 x14
  h2Minimal, h2Academic, h2Warm, h2Formal, h2Fresh,
  h2GradientPill, h2DuotoneBlock, h2RoundStamp, h2BookTitleMark, h2TextureBar,
  h2BoldUnderlineEn, h2BracketLine, h2OffsetBlock, h2MinimalLarge,
  // h3 x8
  h3Minimal, h3Academic, h3Warm, h3Formal, h3Fresh,
  h3GradientPill, h3RoundDot, h3BracketLine,
  // divider x4
  dividerWaveDots, dividerDoubleLineDiamond, dividerGradientThin, dividerThreeStars,
];
