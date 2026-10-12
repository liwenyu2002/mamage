# 5 主题预设引用的 20 个内置块 id 清单

本文件由 themes.js 的实施者产出，供 builtinBlocks.js 的生产 agent 对照补齐——**这 20 个 id 必须原样出现在
BUILTIN_BLOCKS 数组里**（52 个配额包含这 20 个），字段结构见 styleblocks-contracts.md 第 1 节
（id/type/name/htmlTemplate/accentEditable/source/sourceUrl）。`source` 一律 `'builtin'`，`sourceUrl` 一律 `null`。

## 设计说明（为何是 20 个而不是 5 主题 × 6 类型 = 30 个）

`blockConfig.accent` 是全局主色，所以"同形状、只是颜色不同"的旧主题样式被合并成同一个块 id，颜色差异完全靠
`{{accent}}` 槽位在渲染期注入解决。20 个 id 里**全部 accentEditable=true**。合并规则见下表"复用主题"列。

**渐变技巧**：模板要做双色渐变/投影，但槽位只有单一 `{{accent}}`（一个 hex），不能做颜色数学。约定用
"hex + 两位透明度后缀"拼出第二档颜色，例如 `background-image:linear-gradient(135deg,{{accent}},{{accent}}99)`——
`{{accent}}` 渲染时是形如 `#ff7a3d` 的 6 位 hex，拼上 `99` 变成合法的 8 位十六进制带 alpha 颜色（`#ff7a3d99`），
不需要引擎做任何颜色计算。52 个块里其余需要渐变/浅色调的块也可以复用这个技巧。

**accent 校验**：渲染引擎 `applyBlock` 会用 `/^#[0-9a-fA-F]{6}$/` 校验 accent，不合法直接 throw，所以模板里只管写
`{{accent}}` 和 `{{accent}}99` 这两种形式，不会收到别的怪值。

## 清单

### h2（标题，5 个）

| id | name | 复用主题 | accentEditable | htmlTemplate |
|---|---|---|---|---|
| `builtin-h2-left-bar` | 左侧竖条标题 | minimal | true | `<section style="margin:36px 0 18px;padding:2px 0 2px 14px;border-left:4px solid {{accent}};"><span style="font-size:18px;font-weight:700;color:{{accent}};line-height:1.5;">{{content}}</span></section>` |
| `builtin-h2-solid-block` | 色块底纹标题 | academic | true | `<section style="margin:36px 0 18px;padding:10px 16px;background-color:{{accent}};border-radius:3px;"><span style="font-size:17px;font-weight:700;color:#ffffff;letter-spacing:0.05em;line-height:1.6;">{{content}}</span></section>` |
| `builtin-h2-gradient-pill` | 渐变胶囊标题 | warm | true | `<section style="margin:36px 0 18px;text-align:left;"><section style="display:inline-block;padding:6px 20px;border-radius:20px;background-image:linear-gradient(135deg,{{accent}},{{accent}}99);box-shadow:0 4px 10px rgba(0,0,0,0.18);"><span style="font-size:16px;font-weight:700;color:#ffffff;letter-spacing:0.05em;">{{content}}</span></section></section>` |
| `builtin-h2-double-line-center` | 居中双线标题 | formal | true | `<section style="margin:36px 0 18px;text-align:center;"><section style="display:inline-block;border-top:1px solid {{accent}};border-bottom:1px solid {{accent}};padding:8px 4px;"><span style="font-size:17px;font-weight:700;color:#1a1a1a;letter-spacing:0.15em;">{{content}}</span></section></section>` |
| `builtin-h2-bottom-border` | 底部粗线标题 | fresh | true | `<section style="margin:36px 0 18px;"><span style="font-size:18px;font-weight:700;color:#16321d;line-height:1.6;padding-bottom:4px;border-bottom:4px solid {{accent}};display:inline-block;">{{content}}</span></section>` |

### h3（小标题，4 个）

| id | name | 复用主题 | accentEditable | htmlTemplate |
|---|---|---|---|---|
| `builtin-h3-dot-marker` | 圆点小标题 | minimal + fresh | true | `<section style="margin:26px 0 14px;"><span style="display:inline-block;width:6px;height:6px;background-color:{{accent}};margin-right:8px;vertical-align:middle;"></span><span style="font-size:16px;font-weight:700;color:#1a1a1a;vertical-align:middle;">{{content}}</span></section>` |
| `builtin-h3-left-border-thin` | 细左边线小标题 | academic | true | `<section style="margin:26px 0 14px;padding:2px 0 2px 12px;border-left:2px solid {{accent}};"><span style="font-size:16px;font-weight:700;color:{{accent}};">{{content}}</span></section>` |
| `builtin-h3-outline-pill` | 描边胶囊小标题 | warm | true | `<section style="margin:26px 0 14px;"><section style="display:inline-block;padding:3px 14px;border-radius:14px;border:1.5px solid {{accent}};"><span style="font-size:15px;font-weight:700;color:{{accent}};">{{content}}</span></section></section>` |
| `builtin-h3-diamond-flank` | 菱形夹字小标题 | formal | true | `<section style="margin:26px 0 14px;text-align:center;"><span style="font-size:16px;font-weight:700;color:{{accent}};letter-spacing:0.1em;">◆ {{content}} ◆</span></section>` |

> 说明：minimal 与 fresh 的小标题原本一个是纯圆点、一个是圆点+底部下划线，合并成同一个 id 后只保留圆点，两者仅靠
> accent 颜色区分（fresh 是绿色 `#2f9e44`，minimal 是深灰 `#1a1a1a`）。这是本次合并 20 个 id 时唯一有可见观感损失
> 的一处简化，已在实现摘要里报备。

### quote（引用，2 个）

| id | name | 复用主题 | accentEditable | htmlTemplate |
|---|---|---|---|---|
| `builtin-quote-tint-bar` | 浅底左边线引用卡 | minimal + academic + formal + fresh | true | `<section style="margin:18px 0;padding:14px 16px;background-color:#f7f7f7;border-left:3px solid {{accent}};color:#666666;font-size:14px;line-height:1.75;">{{content}}</section>` |
| `builtin-quote-tint-bar-rounded` | 浅底左边线圆角引用卡 | warm | true | `<section style="margin:18px 0;padding:14px 16px;background-color:#f7f7f7;border-left:3px solid {{accent}};color:#666666;font-size:14px;line-height:1.75;border-radius:0 8px 8px 0;">{{content}}</section>` |

### divider（分隔线，5 个，无槽位/纯装饰，模板不含 `{{content}}`）

| id | name | 复用主题 | accentEditable | htmlTemplate |
|---|---|---|---|---|
| `builtin-divider-center-line` | 居中细线分隔 | minimal | true | `<section style="text-align:center;margin:32px 0;padding:0;"><span style="display:inline-block;width:40px;height:1px;background-color:{{accent}};"></span></section>` |
| `builtin-divider-squares` | 居中方块分隔 | academic | true | `<section style="text-align:center;margin:32px 0;padding:0;"><span style="display:inline-block;width:4px;height:4px;background-color:{{accent}};margin:0 8px;"></span><span style="display:inline-block;width:4px;height:4px;background-color:{{accent}};margin:0 8px;"></span><span style="display:inline-block;width:4px;height:4px;background-color:{{accent}};margin:0 8px;"></span></section>` |
| `builtin-divider-gradient-bar` | 渐变短条分隔 | warm | true | `<section style="text-align:center;margin:32px 0;padding:0;"><span style="display:inline-block;width:60px;height:4px;border-radius:2px;background-image:linear-gradient(90deg,{{accent}},{{accent}}99);"></span></section>` |
| `builtin-divider-double-line` | 居中双线分隔 | formal | true | `<section style="margin:32px 0;padding:0;"><section style="border-top:1px solid {{accent}};margin:0 60px 3px;"></section><section style="border-top:1px solid {{accent}};margin:0 60px;"></section></section>` |
| `builtin-divider-dots` | 居中圆点分隔 | fresh | true | `<section style="text-align:center;margin:32px 0;padding:0;"><span style="display:inline-block;width:5px;height:5px;border-radius:50%;background-color:{{accent}};margin:0 6px;"></span><span style="display:inline-block;width:5px;height:5px;border-radius:50%;background-color:{{accent}};margin:0 6px;"></span><span style="display:inline-block;width:5px;height:5px;border-radius:50%;background-color:{{accent}};margin:0 6px;"></span></section>` |

### imageCard（图片卡，2 个，槽位 `{{src}}` / `{{#caption}}...{{/caption}}` 包裹的 `{{caption}}`）

| id | name | 复用主题 | accentEditable | htmlTemplate |
|---|---|---|---|---|
| `builtin-imageCard-rounded` | 圆角图卡 | minimal + academic + warm + fresh | true（仅装饰不涉及 accent 也可，但为满足清单一致性仍标 true——模板本身不含 `{{accent}}`，accentEditable=true 时引擎只是多算一次不影响输出，生产 agent 可自行改成 false 若模板确无主色可换点） | `<section style="margin:20px 0;padding:0;"><img src="{{src}}" style="width:100%;height:auto;display:block;border-radius:10px;margin:0;"/>{{#caption}}<figcaption style="display:block;font-size:12px;color:#999999;text-align:center;line-height:1.6;margin:8px 0 0;padding:0;">{{caption}}</figcaption>{{/caption}}</section>` |
| `builtin-imageCard-square` | 直角图卡 | formal | 同上 | `<section style="margin:20px 0;padding:0;"><img src="{{src}}" style="width:100%;height:auto;display:block;border-radius:0;margin:0;"/>{{#caption}}<figcaption style="display:block;font-size:12px;color:#999999;text-align:center;line-height:1.6;margin:8px 0 0;padding:0;">{{caption}}</figcaption>{{/caption}}</section>` |

> 备注：这两个图卡实际不含 `{{accent}}`，是纯形状块。生产 agent 若发现模板不含 accent 占位符，可以按 contracts.md
> 的字段定义把 accentEditable 直接写 false（更准确）；渲染引擎两种取值都能正确处理（没有 `{{accent}}` 占位符时替换是空操作）。

### signoff（落款，2 个，槽位 `{{content}}` 是落款文案，渲染时默认传入 `'E N D'`）

| id | name | 复用主题 | accentEditable | htmlTemplate |
|---|---|---|---|---|
| `builtin-signoff-line-end` | 细线落款 | minimal + academic + formal + fresh | true | `<section style="text-align:center;margin:40px 0 10px;padding:0;"><span style="display:inline-block;width:24px;height:1px;background-color:{{accent}};"></span></section><section style="text-align:center;margin:0 0 4px;"><span style="font-size:12px;color:#aaaaaa;letter-spacing:0.2em;">{{content}}</span></section>` |
| `builtin-signoff-gradient-end` | 渐变短条落款 | warm | true | `<section style="text-align:center;margin:40px 0 10px;padding:0;"><span style="display:inline-block;width:60px;height:4px;border-radius:2px;background-image:linear-gradient(90deg,{{accent}},{{accent}}99);"></span></section><section style="text-align:center;margin:0 0 4px;"><span style="font-size:12px;color:#aaaaaa;letter-spacing:0.2em;">{{content}}</span></section>` |

## 5 主题 → blockConfig 映射（THEME_PRESETS，已在 themes.js 里实现，供对照）

```js
minimal:  { h2:'builtin-h2-left-bar',          h3:'builtin-h3-dot-marker',       quote:'builtin-quote-tint-bar',         divider:'builtin-divider-center-line',  imageCard:'builtin-imageCard-rounded', signoff:'builtin-signoff-line-end',     accent:'#1a1a1a' }
academic: { h2:'builtin-h2-solid-block',       h3:'builtin-h3-left-border-thin', quote:'builtin-quote-tint-bar',         divider:'builtin-divider-squares',      imageCard:'builtin-imageCard-rounded', signoff:'builtin-signoff-line-end',     accent:'#1d3557' }
warm:     { h2:'builtin-h2-gradient-pill',     h3:'builtin-h3-outline-pill',     quote:'builtin-quote-tint-bar-rounded', divider:'builtin-divider-gradient-bar', imageCard:'builtin-imageCard-rounded', signoff:'builtin-signoff-gradient-end', accent:'#ff7a3d' }
formal:   { h2:'builtin-h2-double-line-center',h3:'builtin-h3-diamond-flank',    quote:'builtin-quote-tint-bar',         divider:'builtin-divider-double-line',  imageCard:'builtin-imageCard-square',  signoff:'builtin-signoff-line-end',     accent:'#9b1c20' }
fresh:    { h2:'builtin-h2-bottom-border',     h3:'builtin-h3-dot-marker',       quote:'builtin-quote-tint-bar',         divider:'builtin-divider-dots',         imageCard:'builtin-imageCard-rounded', signoff:'builtin-signoff-line-end',     accent:'#2f9e44' }
```

其余 32 个块名额（h2 剩 9、h3 剩 4、quote 剩 8、divider 剩 5、imageCard 剩 4、signoff 剩 2）按 contracts.md 第 3 节的
风格覆盖要求自由发挥，id 命名延续 `builtin-<type>-<slug>` 规范，注意与以上 20 个 slug 不要撞名。
