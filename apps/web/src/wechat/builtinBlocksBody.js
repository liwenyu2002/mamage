// 内置样式块库 · 正文组（type: 'body'）：给「正文」分类补一批段落卡片。
// 存活硬规则同 A/B 组：只内联 style、只用允许的属性（含 WeChat 安全的 text-indent）、无 class/flex/position/
// transform/float/font-family/外链图。{{content}}=正文文字；{{accent}}=主题色，{{tint}}/{{softTint}}=浅色底、
// {{shade}}=压暗深字（由 accent 派生，随主题联动，见 themes.js applyBlock）。id 统一 builtin-body-<slug>。

const B = (id, name, htmlTemplate, accentEditable) => ({
  id: `builtin-body-${id}`, type: 'body', name, htmlTemplate, accentEditable, source: 'builtin', sourceUrl: null,
});

export const BUILTIN_BLOCKS_BODY = [
  // 1. 舒朗正文：干净、行距舒适、两端对齐（无主色）
  B('plain', '舒朗正文',
    '<section style="margin:20px 0;"><p style="margin:0;font-size:15px;line-height:1.9;letter-spacing:0.6px;color:#3f3f3f;text-align:justify;">{{content}}</p></section>',
    false),
  // 2. 首行缩进：中文正文经典排版
  B('indent', '首行缩进',
    '<section style="margin:20px 0;"><p style="margin:0;font-size:15px;line-height:1.9;letter-spacing:0.6px;color:#3f3f3f;text-align:justify;text-indent:2em;">{{content}}</p></section>',
    false),
  // 3. 左色条：竖条引导的一段（callout 感）
  B('leftbar', '左色条正文',
    '<section style="margin:20px 0;padding:6px 0 6px 16px;border-left:3px solid {{accent}};"><p style="margin:0;font-size:15px;line-height:1.85;letter-spacing:0.5px;color:#3f3f3f;text-align:justify;">{{content}}</p></section>',
    true),
  // 4. 浅底卡片：主题浅底 + 深字，成块
  B('tint', '浅底卡片',
    '<section style="margin:20px 0;padding:16px 18px;background:{{tint}};border-radius:10px;"><p style="margin:0;font-size:15px;line-height:1.85;letter-spacing:0.5px;color:{{shade}};text-align:justify;">{{content}}</p></section>',
    true),
  // 5. 描边框：主色细边框
  B('bordered', '描边正文',
    '<section style="margin:20px 0;padding:15px 16px;border:1px solid {{accent}};border-radius:8px;"><p style="margin:0;font-size:15px;line-height:1.85;letter-spacing:0.5px;color:#3f3f3f;text-align:justify;">{{content}}</p></section>',
    true),
  // 6. 导语居中：大一号、主色、居中加粗——用作段首导语
  B('lead', '居中导语',
    '<section style="margin:22px 0;"><p style="margin:0;font-size:16px;line-height:1.9;letter-spacing:1px;color:{{accent}};text-align:center;font-weight:600;">{{content}}</p></section>',
    true),
  // 7. 强调条：浅底 + 左粗条 + 圆角，重点段
  B('emphasis', '强调段',
    '<section style="margin:20px 0;padding:14px 16px;background:{{softTint}};border-left:4px solid {{accent}};border-radius:0 8px 8px 0;"><p style="margin:0;font-size:15px;line-height:1.85;letter-spacing:0.5px;color:{{shade}};text-align:justify;">{{content}}</p></section>',
    true),
  // 8. 上下细线：一段被上下细线框住
  B('rules', '上下线正文',
    '<section style="margin:22px 0;padding:14px 0;border-top:1px solid {{accent}};border-bottom:1px solid {{accent}};"><p style="margin:0;font-size:15px;line-height:1.85;letter-spacing:0.5px;color:#3f3f3f;text-align:justify;">{{content}}</p></section>',
    true),
  // 9. 便签卡：白底柔和阴影（无主色）
  B('note', '便签卡',
    '<section style="margin:20px 0;padding:16px 18px;background:#ffffff;border-radius:12px;box-shadow:0 2px 12px rgba(0,0,0,0.08);"><p style="margin:0;font-size:15px;line-height:1.85;letter-spacing:0.5px;color:#3a3a3a;text-align:justify;">{{content}}</p></section>',
    false),
  // 10. 双层描边：内外两层主色边框
  B('double', '双层描边',
    '<section style="margin:20px auto;padding:6px;border:1px solid {{accent}};border-radius:10px;"><section style="padding:14px 16px;border:1px solid {{accent}};border-radius:6px;"><p style="margin:0;font-size:15px;line-height:1.85;letter-spacing:0.5px;color:#3f3f3f;text-align:justify;">{{content}}</p></section></section>',
    true),
  // 11. 圆点要点：段首一个主色圆点
  B('dot', '圆点要点',
    '<section style="margin:16px 0;padding-left:18px;"><span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:{{accent}};vertical-align:middle;margin-left:-18px;margin-right:9px;"></span><span style="font-size:15px;line-height:1.85;letter-spacing:0.5px;color:#3f3f3f;">{{content}}</span></section>',
    true),
  // 12. 短线居中：主色短横线 + 居中一段
  B('centered', '短线居中',
    '<section style="margin:22px 0;text-align:center;"><span style="display:inline-block;width:36px;height:3px;background:{{accent}};border-radius:2px;margin-bottom:12px;"></span><p style="margin:0;font-size:15px;line-height:1.9;letter-spacing:0.6px;color:#3f3f3f;text-align:center;">{{content}}</p></section>',
    true),
];
