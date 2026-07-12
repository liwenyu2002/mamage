// 纯 Node 自测：`node src/wechat/builtinBlocks.selfcheckB.js` 直接跑，不依赖构建链。
// 只校验 B 组（quote/divider/imageCard/signoff）自己产出的块，不依赖 A 组文件是否已落地。
import { BUILTIN_BLOCKS_B } from './builtinBlocksB.js';

const TYPE_ENUM = ['quote', 'divider', 'imageCard', 'signoff'];
const EXPECTED_COUNT = { quote: 10, divider: 6, imageCard: 6, signoff: 4 };

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

// {{#caption}}...{{/caption}} 是否成对出现（简易条件段语法）
function hasBalancedCaptionTag(html) {
  const opens = (html.match(/\{\{#caption\}\}/g) || []).length;
  const closes = (html.match(/\{\{\/caption\}\}/g) || []).length;
  return opens === closes && opens > 0;
}

console.log(`\n== B 组块总数：${BUILTIN_BLOCKS_B.length}（预期 26） ==`);
check('总数为 26', BUILTIN_BLOCKS_B.length === 26);

const countByType = {};
const seenIds = new Set();

BUILTIN_BLOCKS_B.forEach((block) => {
  const label = `${block.id}（${block.name}）`;
  countByType[block.type] = (countByType[block.type] || 0) + 1;

  // 1. 数据模型字段完整性
  check(`${label} 有 id`, typeof block.id === 'string' && block.id.length > 0);
  check(`${label} id 唯一`, !seenIds.has(block.id));
  seenIds.add(block.id);
  check(`${label} type 合法`, TYPE_ENUM.includes(block.type));
  check(`${label} 有 name`, typeof block.name === 'string' && block.name.length > 0);
  check(`${label} 有 htmlTemplate`, typeof block.htmlTemplate === 'string' && block.htmlTemplate.length > 0);
  check(`${label} accentEditable 是布尔值`, typeof block.accentEditable === 'boolean');
  check(`${label} source 为 builtin`, block.source === 'builtin');
  check(`${label} sourceUrl 为 null`, block.sourceUrl === null);

  const html = block.htmlTemplate;

  // 2. 公众号 HTML 存活硬规则：不允许 class=/position:/id=/onXX=/<style/<script/transform/flex/grid
  check(`${label} 无 class=`, !/class\s*=/.test(html));
  check(`${label} 无 id=`, !/\bid\s*=/.test(html));
  check(`${label} 无 position:`, !/position\s*:/.test(html));
  check(`${label} 无事件属性 onXX=`, !/\bon[a-z]+\s*=/i.test(html));
  check(`${label} 无 <style 标签`, !/<style[\s>]/i.test(html));
  check(`${label} 无 <script 标签`, !/<script[\s>]/i.test(html));
  check(`${label} 无 transform`, !/transform/i.test(html));
  check(`${label} 无 flex`, !/flex/i.test(html));
  check(`${label} 无 grid`, !/grid/i.test(html));

  // 3. 槽位规则：quote/signoff 必须有 {{content}}；divider 无任何槽位；imageCard 必须有 {{src}} 与条件段
  if (block.type === 'quote' || block.type === 'signoff') {
    check(`${label} 含 {{content}}`, html.includes('{{content}}'));
    check(`${label} 不含 {{src}}`, !html.includes('{{src}}'));
  }
  if (block.type === 'divider') {
    check(`${label} 无槽位（纯装饰）`, !html.includes('{{content}}') && !html.includes('{{src}}') && !html.includes('{{caption}}'));
  }
  if (block.type === 'imageCard') {
    check(`${label} 含 {{src}}`, html.includes('{{src}}'));
    check(`${label} img src 用槽位而非写死`, /<img[^>]*src="\{\{src\}\}"/.test(html));
    check(`${label} 未写死 http 外链 src`, !/src\s*=\s*["'](?:https?:)?\/\//i.test(html));
    check(`${label} {{#caption}}/{{/caption}} 成对`, hasBalancedCaptionTag(html));
    check(`${label} 条件段内含 {{caption}}`, html.includes('{{caption}}'));
    check(`${label} 不含 {{content}}`, !html.includes('{{content}}'));
  }

  // 4. accentEditable 与 {{accent}} 占位一致性
  if (block.accentEditable) {
    check(`${label} accentEditable=true 含 {{accent}}`, html.includes('{{accent}}'));
  } else {
    check(`${label} accentEditable=false 不含 {{accent}}`, !html.includes('{{accent}}'));
  }
});

console.log('\n各类型数量：', countByType);
Object.entries(EXPECTED_COUNT).forEach(([type, expected]) => {
  check(`${type} 数量为 ${expected}`, countByType[type] === expected);
});

// 60% 以上 accentEditable=true（契约对全库 52 块的要求，这里对 B 组子集同口径自查）
const trueCount = BUILTIN_BLOCKS_B.filter((b) => b.accentEditable).length;
console.log(`accentEditable=true 占比：${trueCount}/${BUILTIN_BLOCKS_B.length}`);
check('accentEditable=true 占比 >= 60%', trueCount / BUILTIN_BLOCKS_B.length >= 0.6);

console.log('\n===================================');
console.log(`B 组自测：通过 ${passCount}，失败 ${failCount}`);
if (failCount > 0) {
  console.log('自测未全绿');
  process.exit(1);
} else {
  console.log('自测全绿');
  process.exit(0);
}
