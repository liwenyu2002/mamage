// 纯 Node 自测：`node src/wechat/builtinBlocks.selfcheckA.js` 直接跑，不依赖构建链。
// 只校验 A 组（builtinBlocksA.js）自己产出的 26 个块，不依赖 B/C 组文件是否存在。
import { BUILTIN_BLOCKS_A } from './builtinBlocksA.js';

// 契约规定的违禁模式：class 依赖 / position 定位 / flex 布局 / transform / <img 标签（外链图片）
const FORBIDDEN_PATTERN = /class=|position:|display:\s*flex|transform:|<img/;

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

console.log(`共 ${BUILTIN_BLOCKS_A.length} 个块`);
check('总数为 26（h2x14 + h3x8 + divider x4）', BUILTIN_BLOCKS_A.length === 26);

const seenIds = new Set();
const typeCount = { h2: 0, h3: 0, divider: 0 };

BUILTIN_BLOCKS_A.forEach((block) => {
  const label = `${block.id || '(无id)'}`;
  console.log(`-- ${label} --`);

  // 1. 基础字段完整性
  check(`${label} 有 type`, typeof block.type === 'string' && block.type.length > 0);
  check(`${label} 有 name`, typeof block.name === 'string' && block.name.length > 0);
  check(`${label} 有 htmlTemplate`, typeof block.htmlTemplate === 'string' && block.htmlTemplate.length > 0);
  check(`${label} 有 accentEditable 布尔值`, typeof block.accentEditable === 'boolean');
  check(`${label} source 为 builtin`, block.source === 'builtin');
  check(`${label} sourceUrl 为 null`, block.sourceUrl === null);
  check(`${label} type 在 A 组枚举内`, ['h2', 'h3', 'divider'].includes(block.type));

  // 2. id 唯一 + 命名规律（builtin-<type>-<slug>）
  check(`${label} id 唯一`, !seenIds.has(block.id));
  seenIds.add(block.id);
  check(`${label} id 命名前缀匹配 type`, block.id.startsWith(`builtin-${block.type}-`));

  if (block.type in typeCount) typeCount[block.type] += 1;

  const html = block.htmlTemplate;

  // 3. 槽位规则：h2/h3 必须含 {{content}}；divider 禁止任何槽位（无 {{content}}/{{src}}/{{caption}}）
  if (block.type === 'h2' || block.type === 'h3') {
    check(`${label} 含 {{content}} 槽位`, html.includes('{{content}}'));
  } else if (block.type === 'divider') {
    check(`${label} 不含 {{content}} 槽位`, !html.includes('{{content}}'));
    check(`${label} 不含 {{src}}/{{caption}} 槽位`, !html.includes('{{src}}') && !html.includes('{{caption}}'));
  }

  // 4. accentEditable=true 的块，模板里必须真的用了 {{accent}}；false 则不应出现
  if (block.accentEditable) {
    check(`${label} accentEditable=true 且模板含 {{accent}}`, html.includes('{{accent}}'));
  } else {
    check(`${label} accentEditable=false 且模板不含 {{accent}}`, !html.includes('{{accent}}'));
  }

  // 5. 违禁模式零命中
  check(`${label} 无违禁模式(class=/position:/display:flex/transform:/<img)`, !FORBIDDEN_PATTERN.test(html));

  // 6. 不允许 font-family（不在契约允许的内联属性清单内）
  check(`${label} 不含 font-family`, !/font-family/.test(html));

  // 7. 不允许 <style>/<script> 标签、id=、外链 <a href
  check(`${label} 无 <style/<script 标签`, !/<style[\s>]|<script[\s>]/i.test(html));
  check(`${label} 无 id= 依赖`, !/\bid\s*=/.test(html));

  // 8. 简单渲染冒烟：把 {{content}}/{{accent}} 替换后应产出闭合的 <section>...</section>
  const rendered = html.replace(/\{\{content\}\}/g, '示例文本').replace(/\{\{accent\}\}/g, '#c0392b');
  check(`${label} 渲染后不再残留花括号槽位`, !/\{\{[a-zA-Z]+\}\}/.test(rendered));
  check(`${label} 渲染后是合法的 section 包装（首尾标签配对）`, /^<section[\s>]/.test(rendered) && rendered.trim().endsWith('</section>'));
});

check('h2 数量为 14', typeCount.h2 === 14);
check('h3 数量为 8', typeCount.h3 === 8);
check('divider 数量为 4', typeCount.divider === 4);

const accentTrueCount = BUILTIN_BLOCKS_A.filter((b) => b.accentEditable).length;
console.log(`accentEditable=true 占比：${accentTrueCount}/${BUILTIN_BLOCKS_A.length}`);
check('accentEditable=true 占比 >= 60%', accentTrueCount / BUILTIN_BLOCKS_A.length >= 0.6);

console.log('\n===================================');
console.log(`A 组块自测：通过 ${passCount}，失败 ${failCount}`);
if (failCount > 0) {
  console.log('自测未全绿');
  process.exit(1);
} else {
  console.log('自测全绿');
  process.exit(0);
}
