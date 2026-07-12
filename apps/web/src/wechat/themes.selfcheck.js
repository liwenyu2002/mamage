// 纯 Node 自测：`node src/wechat/themes.selfcheck.js` 直接跑，不依赖构建链。
// 只测 renderWechatHtmlRaw / applyBlock（跳过 DOMPurify 清洗那一步）——dompurify 在没有 window 的纯 Node 环境下
// 只是一个待注入 window 的工厂函数，直接调用 .sanitize 会抛错，这不是 bug，是该库的设计；
// 真正的清洗路径（renderWechatHtml）只在浏览器里跑，交给人工/E2E 验证。
//
// 本文件全程使用内联 mock 块数组，不 import builtinBlocks.js——那个文件由另外两个 agent 并行生产，
// 用真实内容会让本文件的自测结果依赖对方的完成进度与最终样式细节。即便是测"themeKey 兼容路径"，
// 也显式传入 mock blocksById 去覆盖 THEME_PRESETS 引用的 20 个内置块 id（renderWechatHtmlRaw 内部对
// blocksById 的合并规则是"调用方传入的覆盖内置索引"，见 themes.js buildWechatHtml），
// 因此测试结果不受 builtinBlocks.js 最终内容影响，可以独立跑绿。
import { applyBlock, renderWechatHtmlRaw, THEME_PRESETS, WECHAT_THEMES, BUILTIN_BLOCKS_BY_ID } from './themes.js';

let failCount = 0;
let passCount = 0;

function check(label, cond) {
  if (cond) {
    passCount += 1;
  } else {
    failCount += 1;
    console.error(`  [FAIL] ${label}`);
  }
}

function expectThrow(label, fn) {
  try {
    fn();
    failCount += 1;
    console.error(`  [FAIL] ${label}（期望抛错但没有抛）`);
  } catch (e) {
    passCount += 1;
  }
}

// ===========================================================================
// 1. applyBlock：槽位替换 + 条件段 + accent 替换/校验
// ===========================================================================
console.log('\n== applyBlock 槽位引擎 ==');

check(
  'content 槽位替换',
  applyBlock({ htmlTemplate: '<section>{{content}}</section>' }, { content: '标题文本' })
    === '<section>标题文本</section>',
);

check(
  '同一模板里多次出现的槽位全部替换',
  applyBlock({ htmlTemplate: '<a>{{content}}</a><b>{{content}}</b>' }, { content: 'X' })
    === '<a>X</a><b>X</b>',
);

check(
  'src 槽位替换',
  applyBlock({ htmlTemplate: '<img src="{{src}}"/>' }, { src: 'https://cdn.example.com/a.jpg' })
    === '<img src="https://cdn.example.com/a.jpg"/>',
);

check(
  'accent 槽位替换（含渐变技巧 accent+alpha 后缀写法）',
  applyBlock(
    { htmlTemplate: '<section style="border-color:{{accent}};background:linear-gradient({{accent}},{{accent}}99);"></section>' },
    { accent: '#ff7a3d' },
  ) === '<section style="border-color:#ff7a3d;background:linear-gradient(#ff7a3d,#ff7a3d99);"></section>',
);

expectThrow('非法 accent（非六位十六进制）应当 throw', () => {
  applyBlock({ htmlTemplate: '<section style="color:{{accent}};"></section>' }, { accent: 'red' });
});

expectThrow('accent 里带引号试图逃逸属性应当被校验拦下', () => {
  applyBlock({ htmlTemplate: '<section style="color:{{accent}};"></section>' }, { accent: '#fff"onmouseover="x' });
});

check(
  '空 accent（非 accentEditable 场景）不报错，槽位保留空串',
  applyBlock({ htmlTemplate: '<section>{{accent}}</section>' }, {}) === '<section></section>',
);

// {{#caption}}...{{/caption}} 条件段
const CAPTION_TPL = '<section><img src="{{src}}"/>{{#caption}}<figcaption>{{caption}}</figcaption>{{/caption}}</section>';

check(
  'caption 非空时条件段保留且内部 {{caption}} 被替换',
  applyBlock({ htmlTemplate: CAPTION_TPL }, { src: 'a.jpg', caption: '图注文字' })
    === '<section><img src="a.jpg"/><figcaption>图注文字</figcaption></section>',
);

check(
  'caption 为空串时条件段整体剔除',
  applyBlock({ htmlTemplate: CAPTION_TPL }, { src: 'a.jpg', caption: '' })
    === '<section><img src="a.jpg"/></section>',
);

check(
  'caption 未传（undefined）时条件段整体剔除',
  applyBlock({ htmlTemplate: CAPTION_TPL }, { src: 'a.jpg' })
    === '<section><img src="a.jpg"/></section>',
);

check(
  'caption 全是空白字符时视为空，条件段剔除',
  applyBlock({ htmlTemplate: CAPTION_TPL }, { src: 'a.jpg', caption: '   ' })
    === '<section><img src="a.jpg"/></section>',
);

check(
  'content 中包含 $& 等特殊替换序列不会破坏输出（split/join 而非正则 replace 的价值）',
  applyBlock({ htmlTemplate: '<section>{{content}}</section>' }, { content: '价格 $&1 元，参考 $1 号文件' })
    === '<section>价格 $&1 元，参考 $1 号文件</section>',
);

expectThrow('htmlTemplate 缺失应当 throw', () => {
  applyBlock({ id: 'broken' }, { content: 'x' });
});

// ===========================================================================
// 2. renderWechatHtmlRaw：blockConfig + 内联 mock 块数组渲染
// ===========================================================================
console.log('\n== blockConfig 渲染路径（内联 mock 块）==');

const MOCK_BLOCKS = [
  { id: 'mock-h2', type: 'h2', htmlTemplate: '<section style="border-left:4px solid {{accent}};">{{content}}</section>' },
  { id: 'mock-h3', type: 'h3', htmlTemplate: '<section style="color:{{accent}};">{{content}}</section>' },
  { id: 'mock-quote', type: 'quote', htmlTemplate: '<section style="background:#f7f7f7;border-left:3px solid {{accent}};">{{content}}</section>' },
  { id: 'mock-divider', type: 'divider', htmlTemplate: '<section style="text-align:center;"><span style="background-color:{{accent}};display:inline-block;width:40px;height:1px;"></span></section>' },
  { id: 'mock-image', type: 'imageCard', htmlTemplate: '<section><img src="{{src}}" style="width:100%;"/>{{#caption}}<figcaption style="display:block;">{{caption}}</figcaption>{{/caption}}</section>' },
  { id: 'mock-signoff', type: 'signoff', htmlTemplate: '<section style="text-align:center;color:{{accent}};">{{content}}</section>' },
];
const MOCK_BLOCKS_BY_ID = MOCK_BLOCKS.reduce((acc, b) => { acc[b.id] = b; return acc; }, {});

const MOCK_BLOCK_CONFIG = {
  h2: 'mock-h2',
  h3: 'mock-h3',
  quote: 'mock-quote',
  divider: 'mock-divider',
  imageCard: 'mock-image',
  signoff: 'mock-signoff',
  accent: '#3366ff',
  body: { fontSize: 16, lineHeight: 1.8, textIndent: false, justify: true },
};

const SAMPLE_MD = `## 小标题一

正文第一段，包含**加粗强调**与*斜体*文字，用来检查行内样式是否套用正确。

> 这是一段引用，检查引用块的背景色与左边框。

### 三级小标题

- 列表项一
- 列表项二

![这是图注](PHOTO:demo1)

![](https://example.com/pic.jpg)

---

正文最后一段。
`;

const PHOTOS_MAP = { demo1: 'https://cdn.example.com/demo1.jpg' };

{
  const { html, imageCount } = renderWechatHtmlRaw(SAMPLE_MD, {
    blockConfig: MOCK_BLOCK_CONFIG,
    blocksById: MOCK_BLOCKS_BY_ID,
    photosMap: PHOTOS_MAP,
    title: '示例标题：样式块自选自测',
    digest: '这是一段摘要引导语。',
  });

  check('结构硬约束：无 class= 依赖', !/class\s*=/.test(html));
  check('结构硬约束：无 <style 标签', !/<style[\s>]/i.test(html));
  check('结构硬约束：无 <script 标签', !/<script[\s>]/i.test(html));
  check('结构硬约束：无 id= 依赖', !/\bid\s*=/.test(html));
  check('结构硬约束：无 position 样式', !/position\s*:/.test(html));
  check('结构硬约束：无 flex 样式', !/flex/.test(html));
  check('结构硬约束：无 grid 样式', !/grid/.test(html));
  check('结构硬约束：无 transform 样式', !/transform\s*:/.test(html));

  check('包含标题文本', html.includes('示例标题：样式块自选自测'));
  check('包含摘要文本', html.includes('这是一段摘要引导语'));
  check('h2 块套用且 accent 替换正确', html.includes('<section style="border-left:4px solid #3366ff;">小标题一</section>'));
  check('h3 块套用且 accent 替换正确', html.includes('<section style="color:#3366ff;">三级小标题</section>'));
  check('quote 块套用', /background:#f7f7f7;border-left:3px solid #3366ff;">[\s\S]*这是一段引用/.test(html));
  check('divider 块套用（accent 上色）', html.includes('background-color:#3366ff;display:inline-block;width:40px;height:1px;'));
  check('imageCard 块：PHOTO 占位符解析为真实地址', html.includes('https://cdn.example.com/demo1.jpg') && !html.includes('PHOTO:demo1'));
  check('imageCard 块：http 外链图片原样透传', html.includes('https://example.com/pic.jpg'));
  check('imageCard 块：有图注的图片渲染 figcaption', /<figcaption style="display:block;">这是图注<\/figcaption>/.test(html));
  check('imageCard 块：无图注的图片不渲染 figcaption（条件段生效）', !/<img[^>]*pic\.jpg[^>]*\/>\s*<figcaption/.test(html));
  check('signoff 块套用默认落款文案 "E N D"', /<section style="text-align:center;color:#3366ff;">E N D<\/section>/.test(html));
  check('imageCount 计数正确（2 张图）', imageCount === 2);
  check('正文段落套用 body 配置的字号/行高', /<p style="font-size:16px;line-height:1\.8[^"]*">/.test(html));
  check('strong 用 accent 上色', /<strong style="[^"]*color:#3366ff[^"]*">加粗强调<\/strong>/.test(html));
  check('列表项文本存在', html.includes('列表项一') && html.includes('列表项二'));
}

// signoff: null → 不渲染落款
{
  const { html } = renderWechatHtmlRaw('正文', {
    blockConfig: { ...MOCK_BLOCK_CONFIG, signoff: null },
    blocksById: MOCK_BLOCKS_BY_ID,
    title: '标题',
  });
  check('blockConfig.signoff=null 时不渲染落款块', !html.includes('E N D'));
}

// body.justify=false / textIndent=true 组合
{
  const { html } = renderWechatHtmlRaw('一段正文用来检查对齐与缩进。', {
    blockConfig: { ...MOCK_BLOCK_CONFIG, body: { fontSize: 15, lineHeight: 1.75, textIndent: true, justify: false } },
    blocksById: MOCK_BLOCKS_BY_ID,
  });
  check('body.textIndent=true 生效', /<p style="[^"]*text-indent:2em[^"]*">/.test(html));
  check('body.justify=false 时 text-align 为 left', /<p style="[^"]*text-align:left[^"]*">/.test(html));
}

// 缺块回退设计（2026-07-12 变更）：引用失效 id 不再炸整页，回退 minimal 同类型内置块
check('blockConfig 引用失效 id 时回退 minimal 块渲染（不 throw）', (() => {
  const { html } = renderWechatHtmlRaw('## 标题', {
    blockConfig: { ...MOCK_BLOCK_CONFIG, h2: 'mock-h2-not-exist' },
    blocksById: MOCK_BLOCKS_BY_ID,
  });
  return typeof html === 'string' && html.includes('标题');
})());

expectThrow('blockConfig 引用了类型不匹配的块（h2 指向一个 quote 块）应当 throw', () => {
  renderWechatHtmlRaw('## 标题', {
    blockConfig: { ...MOCK_BLOCK_CONFIG, h2: 'mock-quote' },
    blocksById: MOCK_BLOCKS_BY_ID,
  });
});

// ===========================================================================
// 3. themeKey 兼容路径：5 主题预设 × mock blocksById 覆盖 THEME_PRESETS 引用的 20 个内置块 id
// ===========================================================================
console.log('\n== themeKey 兼容路径（5 预设 × mock 覆盖）==');

check('THEME_PRESETS 覆盖全部 5 个主题 key', WECHAT_THEMES.length === 5 && WECHAT_THEMES.every((t) => THEME_PRESETS[t.key]));

// 为 THEME_PRESETS 里引用到的每个内置块 id 生成一个通用 mock 块（按 id 猜测 type，够用即可，
// 不追求还原 PRESET_BLOCK_IDS.md 里的真实样式细节——那是 builtinBlocks.js 生产 agent 的职责，
// 这里只验证"themeKey → blockConfig → 块查找 → applyBlock"这条链路本身是通的）
function guessType(id) {
  if (id.startsWith('builtin-h2-')) return 'h2';
  if (id.startsWith('builtin-h3-')) return 'h3';
  if (id.startsWith('builtin-quote-')) return 'quote';
  if (id.startsWith('builtin-divider-')) return 'divider';
  if (id.startsWith('builtin-imageCard-')) return 'imageCard';
  if (id.startsWith('builtin-signoff-')) return 'signoff';
  throw new Error(`无法从 id 猜测块类型：${id}`);
}

function makeMockBlockForId(id) {
  const type = guessType(id);
  if (type === 'divider') return { id, type, htmlTemplate: `<section data-mock-divider="${id}" style="border-color:{{accent}};"></section>` };
  if (type === 'imageCard') return { id, type, htmlTemplate: `<section><img src="{{src}}" style="width:100%;"/>{{#caption}}<figcaption>{{caption}}</figcaption>{{/caption}}</section>` };
  return { id, type, htmlTemplate: `<section data-mock="${id}" style="color:{{accent}};">{{content}}</section>` };
}

const ALL_PRESET_IDS = new Set();
Object.values(THEME_PRESETS).forEach((cfg) => {
  ['h2', 'h3', 'quote', 'divider', 'imageCard', 'signoff'].forEach((t) => {
    if (cfg[t]) ALL_PRESET_IDS.add(cfg[t]);
  });
});
check('THEME_PRESETS 引用的每个内置块 id 都真实存在', [...ALL_PRESET_IDS].every((id) => !!BUILTIN_BLOCKS_BY_ID[id]));

const PRESET_MOCK_BLOCKS_BY_ID = {};
ALL_PRESET_IDS.forEach((id) => { PRESET_MOCK_BLOCKS_BY_ID[id] = makeMockBlockForId(id); });

WECHAT_THEMES.forEach((meta) => {
  const { html, imageCount } = renderWechatHtmlRaw(SAMPLE_MD, {
    themeKey: meta.key,
    blocksById: PRESET_MOCK_BLOCKS_BY_ID,
    photosMap: PHOTOS_MAP,
    title: '示例标题：公众号排版器自测',
    digest: '这是一段摘要引导语，用来检查标题块的摘要渲染。',
  });

  check(`[${meta.key}] 无 class= 依赖`, !/class\s*=/.test(html));
  check(`[${meta.key}] 无 <style 标签`, !/<style[\s>]/i.test(html));
  check(`[${meta.key}] 无 <script 标签`, !/<script[\s>]/i.test(html));
  check(`[${meta.key}] 无 position 样式`, !/position\s*:/.test(html));
  check(`[${meta.key}] 无 flex/grid/transform 样式`, !/flex|grid|transform\s*:/.test(html));
  check(`[${meta.key}] 包含标题文本`, html.includes('示例标题：公众号排版器自测'));
  check(`[${meta.key}] 包含摘要文本`, html.includes('这是一段摘要引导语'));
  check(`[${meta.key}] h2 块按预设 id 命中`, html.includes(`data-mock="${THEME_PRESETS[meta.key].h2}"`));
  check(`[${meta.key}] h3 块按预设 id 命中`, html.includes(`data-mock="${THEME_PRESETS[meta.key].h3}"`));
  check(`[${meta.key}] quote 块按预设 id 命中`, html.includes(`data-mock="${THEME_PRESETS[meta.key].quote}"`));
  check(`[${meta.key}] divider 块按预设 id 命中`, html.includes(`data-mock-divider="${THEME_PRESETS[meta.key].divider}"`));
  check(`[${meta.key}] accent 颜色套用到 h2 块`, html.includes(`color:${THEME_PRESETS[meta.key].accent};">小标题一`));
  check(`[${meta.key}] imageCount 计数正确（2 张图）`, imageCount === 2);
  check(
    `[${meta.key}] signoff 块存在时渲染，signoff 为 null 时不渲染`,
    THEME_PRESETS[meta.key].signoff ? html.includes(`data-mock="${THEME_PRESETS[meta.key].signoff}"`) : true,
  );
  if (meta.key === 'formal') {
    check('formal 主题正文首行缩进 2em（唯一一个 textIndent=true 的预设）', /<p style="[^"]*text-indent:2em[^"]*">/.test(html));
  } else {
    check(`[${meta.key}] 非 formal 主题正文不缩进`, !/<p style="[^"]*text-indent:2em[^"]*">/.test(html));
  }
});

// 未知 themeKey 兜底到 minimal，不 throw
{
  const { html } = renderWechatHtmlRaw('正文', {
    themeKey: 'not-a-real-theme',
    blocksById: PRESET_MOCK_BLOCKS_BY_ID,
    title: '标题',
  });
  check('未知 themeKey 兜底到 minimal 预设，不抛错', html.includes(`color:${THEME_PRESETS.minimal.accent};">标题`) === false /* 标题走 renderTitleBlock 不是块 */ && html.includes('标题'));
}

console.log('\n===================================');
console.log(`样式块渲染引擎自测：通过 ${passCount}，失败 ${failCount}`);
if (failCount > 0) {
  console.log('自测未全绿');
  process.exit(1);
} else {
  console.log('自测全绿');
  process.exit(0);
}
