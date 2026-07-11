// 纯 Node 自测：`node src/wechat/themes.selfcheck.js` 直接跑，不依赖构建链。
// 只测 renderWechatHtmlRaw（跳过 DOMPurify 清洗那一步）——dompurify 在没有 window 的纯 Node 环境下
// 只是一个待注入 window 的工厂函数，直接调用 .sanitize 会抛错，这不是 bug，是该库的设计；
// 真正的清洗路径（renderWechatHtml）只在浏览器里跑，交给人工/E2E 验证。
import { WECHAT_THEMES, renderWechatHtmlRaw } from './themes.js';

const SAMPLE_MD = `## 小标题一

正文第一段，包含**加粗强调**与*斜体*文字，用来检查行内样式是否套用正确。

> 这是一段引用，检查引用卡的背景色与左边框。

### 三级小标题

- 列表项一
- 列表项二

![这是图注](PHOTO:demo1)

![](https://example.com/pic.jpg)

---

正文最后一段。
`;

const PHOTOS_MAP = { demo1: 'https://cdn.example.com/demo1.jpg' };

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

WECHAT_THEMES.forEach((meta) => {
  console.log(`\n== 主题 ${meta.key}（${meta.name}） ==`);

  const { html, imageCount } = renderWechatHtmlRaw(SAMPLE_MD, {
    themeKey: meta.key,
    photosMap: PHOTOS_MAP,
    title: '示例标题：公众号排版器自测',
    digest: '这是一段摘要引导语，用来检查标题块的摘要渲染。',
  });

  // 1. 结构硬约束：不允许 class=、不允许 <style 标签、不允许 position/flex/grid/transform 内联属性
  check('无 class= 依赖', !/class\s*=/.test(html));
  check('无 <style 标签', !/<style[\s>]/i.test(html));
  check('无 <script 标签', !/<script[\s>]/i.test(html));
  check('无 id= 依赖', !/\bid\s*=/.test(html));
  check('无 position 样式', !/position\s*:/.test(html));
  check('无 flex 样式', !/flex/.test(html));
  check('无 grid 样式', !/grid/.test(html));
  check('无 transform 样式', !/transform\s*:/.test(html));

  // 2. 内容正确性：标题/摘要/正文/图片都要出现
  check('包含标题文本', html.includes('示例标题：公众号排版器自测'));
  check('包含摘要文本', html.includes('这是一段摘要引导语'));
  check('包含小标题文本', html.includes('小标题一'));
  check('包含三级小标题文本', html.includes('三级小标题'));
  check('包含引用文本', html.includes('这是一段引用'));
  check('包含列表项文本', html.includes('列表项一') && html.includes('列表项二'));
  check('PHOTO 占位符被替换为真实地址', html.includes('https://cdn.example.com/demo1.jpg') && !html.includes('PHOTO:demo1'));
  check('http 外链图片原样透传', html.includes('https://example.com/pic.jpg'));
  check('图注文本被渲染', html.includes('这是图注'));
  check('imageCount 计数正确（2 张图）', imageCount === 2);

  // 3. 每个主题必须自带内联样式片段（对应各自 h2/blockquote/图片圆角/strong 等特征）
  check('h2 使用了 section 包装', /<section[^>]*>[\s\S]*?小标题一/.test(html));
  check('strong 有内联样式', /<strong style="[^"]*font-weight:700[^"]*">加粗强调<\/strong>/.test(html));
  check('em 有内联样式', /<em style="[^"]*font-style:italic[^"]*">斜体<\/em>/.test(html));
  check('blockquote 卡片有背景色', /background-color:#[0-9a-f]{6};[^"]*border-left/i.test(html) || /border-left:[^"]*"[^>]*>[\s\S]*这是一段引用/.test(html));
  check('图片 style 含 width:100%', /<img[^>]*style="[^"]*width:100%[^"]*"/.test(html));
  check('图片圆角规则：formal 为直角，其余主题有圆角', meta.key === 'formal'
    ? /<img[^>]*style="[^"]*border-radius:0[^"]*"/.test(html)
    : /<img[^>]*style="[^"]*border-radius:[1-9][0-9]*px[^"]*"/.test(html));
  check('正文段落 15px/1.75 行高', /<p style="[^"]*font-size:15px;line-height:1\.75[^"]*">/.test(html));
  check('正文段落两端对齐', /<p style="[^"]*text-align:justify[^"]*">/.test(html));
  if (meta.key === 'formal') {
    check('formal 主题正文首行缩进 2em', /<p style="[^"]*text-indent:2em[^"]*">/.test(html));
  } else {
    check('非 formal 主题正文不缩进', !/<p style="[^"]*text-indent:2em[^"]*">/.test(html));
  }
});

console.log(`\n===================================`);
console.log(`5 主题 x 断言：通过 ${passCount}，失败 ${failCount}`);
if (failCount > 0) {
  console.log('自测未全绿');
  process.exit(1);
} else {
  console.log('自测全绿');
  process.exit(0);
}
