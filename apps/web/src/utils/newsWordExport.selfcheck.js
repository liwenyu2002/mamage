// src/utils/newsWordExport.selfcheck.js
// newsWordExport.js 的最小自测：只跑纯逻辑（parseMarkdownBlocks + 模块可 import），
// 不碰 exportNewsDocx 里依赖 document/Image/fetch 的下载路径——那部分只能在真实浏览器里验证。
//
// 用 @babel/core（仓库已有的 devDependency）把 ESM 源码转成 CJS 后在当前 Node 进程内求值，
// 免去给 webpack-only 的 src 目录额外引入 Node 专属的 .mjs/包类型配置。
//
// 运行方式：node src/utils/newsWordExport.selfcheck.js

const path = require('path');
const fs = require('fs');
const babel = require('@babel/core');
const Module = require('module');

function loadEsmAsCjs(absPath) {
  const source = fs.readFileSync(absPath, 'utf8');
  const { code } = babel.transform(source, {
    filename: absPath,
    presets: [require.resolve('@babel/preset-env')],
    babelrc: false,
    configFile: false,
  });
  const mod = new Module(absPath, module);
  mod.filename = absPath;
  mod.paths = Module._nodeModulePaths(path.dirname(absPath));
  mod._compile(code, absPath);
  return mod.exports;
}

function assertEqual(actual, expected, label) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`[FAIL] ${label}\n  期望: ${e}\n  实际: ${a}`);
  }
  console.log(`[PASS] ${label}`);
}

function main() {
  const targetPath = path.join(__dirname, 'newsWordExport.js');
  const mod = loadEsmAsCjs(targetPath);

  if (typeof mod.exportNewsDocx !== 'function' || typeof mod.parseMarkdownBlocks !== 'function') {
    throw new Error('[FAIL] 模块导出不完整，缺少 exportNewsDocx 或 parseMarkdownBlocks');
  }
  console.log('[PASS] 模块可 import，exportNewsDocx / parseMarkdownBlocks 均已导出');

  const { parseMarkdownBlocks } = mod;

  // 样例 1：标题 + 未注入态图片占位符 + 段落 + 列表，覆盖四种 block 类型
  const sample1 = [
    '# 主标题',
    '## 二级小标题',
    '这是第一段正文，介绍活动概况。',
    '![张三在活动现场](PHOTO:123)',
    '- 参与人数：120 人',
    '- 活动地点：主报告厅',
    '这是结尾段落。',
  ].join('\n');

  const blocks1 = parseMarkdownBlocks(sample1);
  assertEqual(blocks1.length, 7, 'sample1: block 总数应为 7');
  assertEqual(blocks1[0], { type: 'heading', level: 1, text: '主标题' }, 'sample1: 一级标题解析');
  assertEqual(blocks1[1], { type: 'heading', level: 2, text: '二级小标题' }, 'sample1: 二级标题解析');
  assertEqual(blocks1[2], { type: 'paragraph', text: '这是第一段正文，介绍活动概况。' }, 'sample1: 普通段落解析');
  assertEqual(
    blocks1[3],
    { type: 'image', alt: '张三在活动现场', photoId: '123', url: null },
    'sample1: 未注入态 PHOTO:id 占位符解析',
  );
  assertEqual(blocks1[4], { type: 'listItem', text: '参与人数：120 人' }, 'sample1: 列表项解析 1');
  assertEqual(blocks1[5], { type: 'listItem', text: '活动地点：主报告厅' }, 'sample1: 列表项解析 2');
  assertEqual(blocks1[6], { type: 'paragraph', text: '这是结尾段落。' }, 'sample1: 结尾段落解析');

  // 样例 2：已注入真实 URL 的图片 + 三级标题 + 空行折叠 + 整行强调文本去星号
  const sample2 = [
    '### 花絮',
    '',
    '',
    '![现场合影](https://cdn.example.com/photo/9.jpg)',
    '',
    '*摄影：李四*',
  ].join('\n');

  const blocks2 = parseMarkdownBlocks(sample2);
  assertEqual(blocks2.length, 3, 'sample2: 连续空行应被折叠，block 总数应为 3');
  assertEqual(blocks2[0], { type: 'heading', level: 3, text: '花絮' }, 'sample2: 三级标题解析');
  assertEqual(
    blocks2[1],
    { type: 'image', alt: '现场合影', photoId: null, url: 'https://cdn.example.com/photo/9.jpg' },
    'sample2: 已注入真实 URL 的图片解析',
  );
  assertEqual(blocks2[2], { type: 'paragraph', text: '摄影：李四' }, 'sample2: 整行强调文本应去除星号包裹');

  // 样例 3：空 markdown 应返回空数组，不抛异常
  assertEqual(parseMarkdownBlocks(''), [], 'sample3: 空字符串应返回空数组');
  assertEqual(parseMarkdownBlocks(null), [], 'sample3: null 应视为空字符串返回空数组');

  console.log('\n全部自测通过（仅覆盖 parseMarkdownBlocks 纯逻辑；exportNewsDocx 的抓图/下载路径依赖浏览器 DOM，需要在真实页面里验证）。');
}

try {
  main();
  process.exit(0);
} catch (e) {
  console.error(e.message || e);
  process.exit(1);
}
