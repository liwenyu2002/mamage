// 纯 Node 自测：`node src/wechat/docModel.selfcheck.js` 直接跑，不依赖构建链。
// docToHtml 正式导出会过 DOMPurify.sanitize，而 dompurify 在无 window 的纯 Node 环境下只是一个待注入
// window 的工厂函数，直接调用会抛错——本文件统一测 docToHtmlRaw（跳过清洗那一步），真正的清洗路径
// 交给浏览器里的人工/E2E 验证，这与 themes.selfcheck.js 对 renderWechatHtmlRaw 的处理方式一致。
//
// blocksById 全程用内联 mock 块，不依赖 builtinBlocks.js 的具体样式细节，只验证
// "markdownToDoc → docToHtml 这条链路本身是通的"，不测 builtinBlocks 的视觉规格（那是另一份自测的职责）。
import {
  makeUid,
  markdownToDoc,
  docToHtml,
  docToHtmlRaw,
  docToPlainText,
  createHistory,
  sanitizeParaHtml,
} from './docModel.js';

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

// ===========================================================================
// 0. makeUid
// ===========================================================================
console.log('\n== makeUid ==');
{
  const ids = new Set();
  for (let i = 0; i < 2000; i += 1) ids.add(makeUid());
  check('批量生成 2000 个 uid 无碰撞', ids.size === 2000);
  check('uid 格式以 b- 开头', makeUid().startsWith('b-'));
}

// ===========================================================================
// 1. markdownToDoc：块级映射
// ===========================================================================
console.log('\n== markdownToDoc 块级映射 ==');

const BLOCK_CONFIG = {
  h2: 'cfg-h2',
  h3: 'cfg-h3',
  quote: 'cfg-quote',
  divider: 'cfg-divider',
  imageCard: 'cfg-image',
  signoff: 'cfg-signoff',
};

{
  const doc = markdownToDoc('# 一级标题当 h2', { blockConfig: BLOCK_CONFIG });
  check('# 映射为 styled h2', doc.length === 1 && doc[0].kind === 'styled' && doc[0].type === 'h2');
  check('# 的文本进入 content', doc[0].content === '一级标题当 h2');
  check('blockConfig.h2 生效', doc[0].blockId === 'cfg-h2');
}

{
  const doc = markdownToDoc('## 二级标题', { blockConfig: BLOCK_CONFIG });
  check('## 映射为 styled h2', doc.length === 1 && doc[0].type === 'h2' && doc[0].content === '二级标题');
}

{
  const doc = markdownToDoc('### 三级标题', { blockConfig: BLOCK_CONFIG });
  check('### 映射为 styled h3', doc.length === 1 && doc[0].type === 'h3' && doc[0].content === '三级标题');
  check('blockConfig.h3 生效', doc[0].blockId === 'cfg-h3');
}

{
  const doc = markdownToDoc('未传 blockConfig 时用默认 id\n\n## 标题', {});
  check('未传 blockConfig 时 h2 用内置默认 id 兜底', doc[1].blockId === 'builtin-h2-minimal');
}

{
  const doc = markdownToDoc('> 第一行引用\n> 第二行引用', { blockConfig: BLOCK_CONFIG });
  check('连续 > 行合并为一个 quote block', doc.length === 1 && doc[0].type === 'quote');
  check('多行引用用 <br> 连接', doc[0].content === '第一行引用<br>第二行引用');
  check('blockConfig.quote 生效', doc[0].blockId === 'cfg-quote');
}

{
  const doc = markdownToDoc('---', { blockConfig: BLOCK_CONFIG });
  check('--- 映射为 styled divider', doc.length === 1 && doc[0].type === 'divider');
  check('blockConfig.divider 生效', doc[0].blockId === 'cfg-divider');
}

{
  const doc = markdownToDoc('--', { blockConfig: BLOCK_CONFIG });
  check('两个连字符不构成 divider（当作普通段落）', doc.length === 1 && doc[0].kind === 'para');
}

{
  const photosMap = { demo1: 'https://cdn.example.com/demo1.jpg' };
  const doc = markdownToDoc('![图注文字](PHOTO:demo1)', { photosMap, blockConfig: BLOCK_CONFIG });
  check('PHOTO:id 命中 photosMap 生成 imageCard', doc.length === 1 && doc[0].kind === 'styled' && doc[0].type === 'imageCard');
  check('src 解析为真实地址', doc[0].src === 'https://cdn.example.com/demo1.jpg');
  check('caption 取 alt 文本', doc[0].caption === '图注文字');
  check('blockConfig.imageCard 生效', doc[0].blockId === 'cfg-image');
}

{
  const doc = markdownToDoc('![外链图](https://example.com/pic.jpg)', { blockConfig: BLOCK_CONFIG });
  check('http 外链图片直接作为 src', doc.length === 1 && doc[0].src === 'https://example.com/pic.jpg');
}

{
  const doc = markdownToDoc('![丢失的图](PHOTO:not-exist)', { photosMap: {}, blockConfig: BLOCK_CONFIG });
  check('PHOTO:id 查不到时不生成 imageCard 而是降级为 para', doc.length === 1 && doc[0].kind === 'para');
  check('降级 para 保留占位符原文（转义后）', doc[0].html === '![丢失的图](PHOTO:not-exist)');
}

{
  const doc = markdownToDoc('第一行正文\n第二行正文\n\n第二段', { blockConfig: BLOCK_CONFIG });
  check('空行分隔出两个 para block', doc.length === 2 && doc.every((b) => b.kind === 'para'));
  check('段内多行用 <br> 连接', doc[0].html === '第一行正文<br>第二行正文');
  check('第二段独立', doc[1].html === '第二段');
}

{
  // 类型切换无空行分隔时也要正确 flush（quote → para → heading 连续出现）
  const doc = markdownToDoc('> 引用行\n紧跟的正文\n## 紧跟的标题', { blockConfig: BLOCK_CONFIG });
  check('无空行的 quote→para→heading 切换正确拆成 3 块', doc.length === 3);
  check('第 1 块是 quote', doc[0].type === 'quote' && doc[0].content === '引用行');
  check('第 2 块是 para', doc[1].kind === 'para' && doc[1].html === '紧跟的正文');
  check('第 3 块是 h2', doc[2].type === 'h2' && doc[2].content === '紧跟的标题');
}

// ===========================================================================
// 2. markdownToDoc：行内格式（仅 para 生效）与转义
// ===========================================================================
console.log('\n== markdownToDoc 行内格式与转义 ==');

{
  const doc = markdownToDoc('这是**加粗**与*斜体*，还有[链接](https://a.com)。');
  check(
    '加粗/斜体/链接转成对应裸标签',
    doc[0].html === '这是<strong>加粗</strong>与<em>斜体</em>，还有<a href="https://a.com">链接</a>。',
  );
}

{
  const doc = markdownToDoc('危险字符 <script>alert(1)</script> & "引号"');
  check(
    'para 中的原始尖括号/引号/& 全部转义，不出现可执行标签',
    doc[0].html === '危险字符 &lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;引号&quot;',
  );
}

{
  const doc = markdownToDoc('## 标题里的 <b>危险标签</b>', { blockConfig: BLOCK_CONFIG });
  check('heading content 是纯文本字段，原样保留（渲染期再转义），不在此处处理', doc[0].content === '标题里的 <b>危险标签</b>');
}

// ===========================================================================
// 3. docToHtmlRaw：槽位内容 + para 内联样式
// ===========================================================================
console.log('\n== docToHtmlRaw 渲染 ==');

const MOCK_BLOCKS_BY_ID = {
  'mock-h2': { id: 'mock-h2', type: 'h2', htmlTemplate: '<section style="border-left:4px solid {{accent}};">{{content}}</section>' },
  'mock-quote': { id: 'mock-quote', type: 'quote', htmlTemplate: '<section style="color:{{accent}};">{{content}}</section>' },
  'mock-divider': { id: 'mock-divider', type: 'divider', htmlTemplate: '<section data-divider style="border-color:{{accent}};"></section>' },
  'mock-image': {
    id: 'mock-image',
    type: 'imageCard',
    htmlTemplate: '<section><img src="{{src}}"/>{{#caption}}<figcaption>{{caption}}</figcaption>{{/caption}}</section>',
  },
  'mock-signoff': { id: 'mock-signoff', type: 'signoff', htmlTemplate: '<section style="color:{{accent}};">{{content}}</section>' },
};

{
  const doc = [
    { uid: 'b1', kind: 'styled', type: 'h2', blockId: 'mock-h2', content: '标题文字', src: '', caption: '', accent: null },
    { uid: 'b2', kind: 'para', html: '这是<strong>加粗</strong>正文' },
    { uid: 'b3', kind: 'styled', type: 'quote', blockId: 'mock-quote', content: '块级换色引用', src: '', caption: '', accent: '#ff0000' },
    { uid: 'b4', kind: 'styled', type: 'divider', blockId: 'mock-divider', content: '', src: '', caption: '', accent: null },
    { uid: 'b5', kind: 'styled', type: 'imageCard', blockId: 'mock-image', content: '', src: 'https://x.com/a.jpg', caption: '图注', accent: null },
  ];
  const { html, imageCount } = docToHtmlRaw(doc, {
    blocksById: MOCK_BLOCKS_BY_ID,
    globalAccent: '#3366ff',
    body: { fontSize: 16, lineHeight: 1.8, textIndent: false, justify: true },
  });

  check('h2 槽位内容 + 全局 accent 生效', html.includes('<section style="border-left:4px solid #3366ff;">标题文字</section>'));
  check('para 用 body 配置生成 <p> 样式（16px/1.8/两端对齐）', /<p style="font-size:16px;line-height:1\.8[^"]*text-align:justify[^"]*">/.test(html));
  check('para 内 <strong> 补上 accent 着色内联样式', html.includes(`<strong style="font-weight:700;color:#3366ff;">加粗</strong>`));
  check('块级 accent 覆盖全局 accent', html.includes('<section style="color:#ff0000;">块级换色引用</section>'));
  check('divider 未设 accent 时跟随全局 accent', html.includes('<section data-divider style="border-color:#3366ff;"></section>'));
  check('imageCard 有图注时渲染 figcaption', html.includes('<img src="https://x.com/a.jpg"/><figcaption>图注</figcaption>'));
  check('imageCount 计数正确', imageCount === 1);
}

{
  // body.textIndent=true / justify=false 组合
  const doc = [{ uid: 'p1', kind: 'para', html: '正文' }];
  const { html } = docToHtmlRaw(doc, {
    blocksById: MOCK_BLOCKS_BY_ID,
    body: { fontSize: 15, lineHeight: 1.75, textIndent: true, justify: false },
  });
  check('body.textIndent=true 生效', /<p style="[^"]*text-indent:2em[^"]*">/.test(html));
  check('body.justify=false 时 text-align:left', /<p style="[^"]*text-align:left[^"]*">/.test(html));
}

{
  // 缺块回退：blockId 引用不存在的 id 时回退 minimal 内置块，不 throw
  const doc = [{ uid: 'b1', kind: 'styled', type: 'h2', blockId: 'not-exist-id', content: '标题', src: '', caption: '', accent: null }];
  let threw = false;
  let html = '';
  try {
    html = docToHtmlRaw(doc, { blocksById: MOCK_BLOCKS_BY_ID }).html;
  } catch (e) {
    threw = true;
  }
  check('blockId 缺失时回退内置块，不抛错', !threw && html.includes('标题'));
}

{
  // caption/src 里的特殊字符要转义，防止属性逃逸
  const doc = [{ uid: 'b1', kind: 'styled', type: 'imageCard', blockId: 'mock-image', content: '', src: 'a.jpg" onerror="alert(1)', caption: '<b>x</b>', accent: null }];
  const { html } = docToHtmlRaw(doc, { blocksById: MOCK_BLOCKS_BY_ID });
  check('imageCard 的 src 特殊字符被转义', !html.includes('onerror="alert(1)"'));
  check('imageCard 的 caption 被转义', html.includes('&lt;b&gt;x&lt;/b&gt;'));
}

{
  // heading content 里字面量 <br> 要保留为真实换行标签，其余字符转义
  const doc = [{ uid: 'b1', kind: 'styled', type: 'h2', blockId: 'mock-h2', content: '第一行<br>第二行 & <危险>', src: '', caption: '', accent: null }];
  const { html } = docToHtmlRaw(doc, { blocksById: MOCK_BLOCKS_BY_ID });
  check('content 中字面量 <br> 渲染为真实换行标签', html.includes('第一行<br>第二行'));
  check('content 中其余尖括号/&被转义', html.includes('&amp; &lt;危险&gt;'));
}

// ===========================================================================
// 4. docToHtml：DOMPurify 清洗路径（浏览器 API，Node 下确认会抛错而不是静默通过）
// ===========================================================================
console.log('\n== docToHtml 清洗路径边界 ==');
{
  let threw = false;
  try {
    docToHtml([{ uid: 'p1', kind: 'para', html: '正文' }], { blocksById: MOCK_BLOCKS_BY_ID });
  } catch (e) {
    threw = true;
  }
  check('docToHtml 在无 window 的 Node 环境下会抛错（说明确实调用了 DOMPurify.sanitize，而非被跳过）', threw);
}

// ===========================================================================
// 5. docToPlainText
// ===========================================================================
console.log('\n== docToPlainText ==');
{
  const doc = [
    { uid: 'b1', kind: 'styled', type: 'h2', blockId: 'x', content: '标题', src: '', caption: '', accent: null },
    { uid: 'b2', kind: 'para', html: '这是<strong>加粗</strong>与<em>斜体</em>正文<br>第二行' },
    { uid: 'b3', kind: 'styled', type: 'imageCard', blockId: 'x', content: '', src: 'a.jpg', caption: '图注', accent: null },
    { uid: 'b4', kind: 'styled', type: 'imageCard', blockId: 'x', content: '', src: 'a.jpg', caption: '', accent: null },
    { uid: 'b5', kind: 'styled', type: 'divider', blockId: 'x', content: '', src: '', caption: '', accent: null },
  ];
  const text = docToPlainText(doc);
  check('标题文本原样输出', text.includes('标题'));
  check('para 标签剥离、<br> 还原为换行', text.includes('这是加粗与斜体正文\n第二行'));
  check('有图注的 imageCard 用图注占位', text.includes('[图片：图注]'));
  check('无图注的 imageCard 用默认占位', text.includes('[图片]'));
  check('divider 用短横线占位', text.includes('----'));
  check('各块之间用空行分隔', text.split('\n\n').length === 5);
}

// ===========================================================================
// 6. createHistory：push/undo/redo/上限
// ===========================================================================
console.log('\n== createHistory ==');
{
  const h = createHistory([{ uid: 'a', kind: 'para', html: '初始' }]);
  check('初始状态不可 undo', h.canUndo() === false);
  check('初始状态不可 redo', h.canRedo() === false);

  h.push([{ uid: 'a', kind: 'para', html: '第一次修改' }]);
  check('push 后可以 undo', h.canUndo() === true);

  const undone = h.undo();
  check('undo 返回上一版内容', undone[0].html === '初始');
  check('undo 到底后不可再 undo', h.canUndo() === false);
  check('undo 后可以 redo', h.canRedo() === true);

  const redone = h.redo();
  check('redo 恢复被撤销的内容', redone[0].html === '第一次修改');
  check('redo 到顶后不可再 redo', h.canRedo() === false);
}

{
  // undo 后在中间发生新 push，应当截断旧的 redo 分支
  const h = createHistory([{ uid: 'a', kind: 'para', html: 'v0' }]);
  h.push([{ uid: 'a', kind: 'para', html: 'v1' }]);
  h.push([{ uid: 'a', kind: 'para', html: 'v2' }]);
  h.undo(); // 回到 v1
  h.push([{ uid: 'a', kind: 'para', html: 'v1-branch' }]); // 截断 v2 分支
  check('中途 push 截断旧 redo 分支后不可 redo', h.canRedo() === false);
  const back = h.undo();
  check('截断后 undo 回到分叉前的版本', back[0].html === 'v1');
}

{
  // push 深拷贝：外部再修改传入对象不应影响历史栈内部快照
  const original = [{ uid: 'a', kind: 'para', html: 'original' }];
  const h = createHistory(original);
  h.push(original.map((b) => ({ ...b, html: 'changed' })));
  original[0].html = '外部污染';
  const undone = h.undo();
  check('push/undo 存取的是深拷贝，不受外部对象后续修改影响', undone[0].html === 'original');
}

{
  // 栈上限 50：连续 push 60 次，只应保留最近 50 个快照
  const h = createHistory([{ uid: 'a', kind: 'para', html: 'v0' }]);
  for (let i = 1; i <= 60; i += 1) {
    h.push([{ uid: 'a', kind: 'para', html: `v${i}` }]);
  }
  let undoCount = 0;
  while (h.canUndo()) {
    h.undo();
    undoCount += 1;
  }
  check('超过上限后可 undo 的步数被截断在 49 步以内（栈上限 50 条快照）', undoCount === 49);
}

// ===========================================================================
// 7. sanitizeParaHtml：白名单清洗
// ===========================================================================
console.log('\n== sanitizeParaHtml ==');

check('保留 strong/em/br', sanitizeParaHtml('<strong>粗</strong><em>斜</em><br>换行') === '<strong>粗</strong><em>斜</em><br>换行');

check(
  'script 标签连内部代码一起剥离',
  sanitizeParaHtml('前<script>alert(1)</script>后') === '前后',
);

check(
  'style 标签连内部 CSS 一起剥离',
  sanitizeParaHtml('前<style>body{color:red}</style>后') === '前后',
);

check(
  '陌生标签（div）剥离但保留内部文本',
  sanitizeParaHtml('<div class="x">纯文本<em>斜体</em></div>') === '纯文本<em>斜体</em>',
);

check(
  'img 标签整体剥离（无内部文本可保留）',
  sanitizeParaHtml('前<img src=x onerror=alert(1)>后') === '前后',
);

check(
  'strong 上的 onclick 事件属性被丢弃，只留裸标签',
  sanitizeParaHtml('<strong onclick="alert(1)">粗体</strong>') === '<strong>粗体</strong>',
);

check(
  'a 标签只保留合法 href，onmouseover 等其余属性丢弃',
  sanitizeParaHtml('<a href="https://a.com" onmouseover="evil()">链接</a>') === '<a href="https://a.com">链接</a>',
);

check(
  'javascript: 协议的 href 被拦截，退化为无 href 的 a',
  sanitizeParaHtml('<a href="javascript:alert(1)">危险链接</a>') === '<a>危险链接</a>',
);

check(
  'mailto: 协议放行',
  sanitizeParaHtml('<a href="mailto:a@b.com">邮件</a>') === '<a href="mailto:a@b.com">邮件</a>',
);

check(
  'HTML 注释被清除',
  sanitizeParaHtml('前<!-- 隐藏payload --><script>x</script>后') === '前后',
);

check(
  '大小写不敏感（STRONG/DIV 等）',
  sanitizeParaHtml('<STRONG>粗</STRONG><DIV>脏</DIV>') === '<strong>粗</strong>脏',
);

check(
  '无标签的纯文本原样返回',
  sanitizeParaHtml('普通文本，没有任何标签') === '普通文本，没有任何标签',
);

check('空输入返回空串', sanitizeParaHtml('') === '' && sanitizeParaHtml(null) === '' && sanitizeParaHtml(undefined) === '');

console.log('\n===================================');
console.log(`docModel 自测：通过 ${passCount}，失败 ${failCount}`);
if (failCount > 0) {
  console.log('自测未全绿');
  process.exit(1);
} else {
  console.log('自测全绿');
  process.exit(0);
}
