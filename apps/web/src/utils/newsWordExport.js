// src/utils/newsWordExport.js
// 「AI 创作矩阵」把渠道生成结果（title/subtitle/markdown）导出为 Word (.docx) 的独立工具模块。
//
// 约束与设计取舍：
// - 只依赖已安装的 docx 包 + 浏览器原生 fetch/Image/Blob/URL API，不引入重型 markdown 解析器
//   （markdown 解析只覆盖契约要求的 #/##/### 标题、![alt](PHOTO:id|url) 图片、- 列表、普通段落）。
// - 纯解析逻辑 parseMarkdownBlocks 与浏览器专属逻辑（抓图/量尺寸/触发下载）拆开：前者不碰
//   document/Image/fetch，可以在 Node 里直接 import 验证；后者依赖 DOM，只能在浏览器里跑，
//   由 newsWordExport.selfcheck.js 明确跳过。
// - 图片抓取失败或格式不受支持（docx 只认 jpg/png/gif/bmp）会被 catch 并降级为
//   “【图：alt】”文字占位，不让单张图拖垮整篇导出；降级前用 console.warn 把原因打出来，
//   不是静默吞掉——静默失败只允许发生在“找不到该图=可预期场景”，其余异常必须可追查。

import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  ImageRun,
  HeadingLevel,
  AlignmentType,
  LineRuleType,
} from 'docx';

// ---------- 中文印刷字号 → docx half-point 换算（docx size 单位是半磅） ----------
const pt = (p) => Math.round(p * 2);

const FONT_HEI = '黑体'; // 标题
const FONT_SONG = '宋体'; // 正文 / 图说 / 署名

const SIZE_TITLE = pt(22); // 二号
const SIZE_SUBTITLE = pt(15); // 小三——契约未指定副标题字号，取标题与正文之间的层级
const SIZE_BODY = pt(12); // 小四
const SIZE_CAPTION = pt(9); // 小五

const GRAY = '808080';

// docx ImageRun 的 transformation.width/height 单位是像素（内部按 9525 EMU/px 换算，对应
// 96dpi），所以把契约里的“宽度 ≤550pt”换算成像素上限再传给 docx。
const PX_PER_PT = 96 / 72;
const MAX_IMAGE_WIDTH_PX = Math.round(550 * PX_PER_PT);

// ============================================================
// 1. 纯解析逻辑：markdown → blocks（DOM 无关，selfcheck 直接验证）
// ============================================================

/**
 * 把 AI 生成的 markdown 逐行解析成结构化 block 数组。只覆盖契约要求的四种形态，
 * 不支持内联加粗/链接等语法（避免引入重型解析器）；整行被 * 或 ** 包裹的强调文本
 * （常见于历史逻辑追加的 *摄影：xxx* 行）会被去除包裹符号后当普通段落处理，
 * 避免星号原样出现在 Word 正文里。
 * @param {string} markdown
 * @returns {Array<
 *   {type:'heading', level:number, text:string} |
 *   {type:'image', alt:string, photoId:string|null, url:string|null} |
 *   {type:'listItem', text:string} |
 *   {type:'paragraph', text:string}
 * >}
 */
function parseMarkdownBlocks(markdown) {
  const text = String(markdown == null ? '' : markdown);
  const lines = text.split(/\r\n|\r|\n/);
  const blocks = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue; // 空行只作分隔，不产生独立 block

    const headingMatch = line.match(/^(#{1,3})\s+(.*)$/);
    if (headingMatch) {
      blocks.push({ type: 'heading', level: headingMatch[1].length, text: headingMatch[2].trim() });
      continue;
    }

    // 图片占位符协议：![alt](PHOTO:id) 未注入态 / ![alt](http...) 已被前端注入真实 URL 的形态都要兼容
    const imageMatch = line.match(/^!\[([^\]]*)\]\(([^)]+)\)(.*)$/);
    if (imageMatch) {
      const alt = imageMatch[1].trim();
      const src = imageMatch[2].trim();
      const trailing = imageMatch[3].trim();
      if (src.startsWith('PHOTO:')) {
        blocks.push({ type: 'image', alt, photoId: src.slice('PHOTO:'.length).trim(), url: null });
      } else {
        blocks.push({ type: 'image', alt, photoId: null, url: src });
      }
      if (trailing) blocks.push({ type: 'paragraph', text: trailing });
      continue;
    }

    const listMatch = line.match(/^-\s+(.*)$/);
    if (listMatch) {
      blocks.push({ type: 'listItem', text: listMatch[1].trim() });
      continue;
    }

    const emphasisMatch = line.match(/^\*{1,2}(.+?)\*{1,2}$/);
    blocks.push({ type: 'paragraph', text: emphasisMatch ? emphasisMatch[1].trim() : line });
  }

  return blocks;
}

// ============================================================
// 2. 浏览器专属：图片抓取 / 尺寸测量 / 触发下载（依赖 fetch/Image/document）
// ============================================================

function mapMimeToDocxType(contentType, url) {
  const ct = String(contentType || '').toLowerCase();
  if (ct.includes('jpeg') || ct.includes('jpg')) return 'jpg';
  if (ct.includes('png')) return 'png';
  if (ct.includes('gif')) return 'gif';
  if (ct.includes('bmp')) return 'bmp';
  // Content-Type 缺失（部分对象存储/代理会丢头）时按 URL 后缀兜底猜测；
  // docx 的 ImageRun 只认 jpg/png/gif/bmp 四种，猜不出来就放弃，交给上层降级。
  const ext = String(url).split('?')[0].split('.').pop().toLowerCase();
  if (ext === 'jpg' || ext === 'jpeg') return 'jpg';
  if (ext === 'png' || ext === 'gif' || ext === 'bmp') return ext;
  return null;
}

function loadImagePixelSize(objectUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth || img.width, height: img.naturalHeight || img.height });
    img.onerror = () => reject(new Error('图片解码失败'));
    img.src = objectUrl;
  });
}

/**
 * 抓取图片并返回 docx ImageRun 所需数据；任何一步失败都 throw，交调用方决定是否降级。
 */
async function fetchDocxImage(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`图片请求失败 HTTP ${resp.status}`);
  const contentType = resp.headers.get('content-type') || '';
  const type = mapMimeToDocxType(contentType, url);
  if (!type) throw new Error(`不支持的图片格式：${contentType || url}`);
  const buffer = await resp.arrayBuffer();
  const blob = new Blob([buffer], { type: contentType || `image/${type}` });
  const objectUrl = URL.createObjectURL(blob);
  try {
    const { width, height } = await loadImagePixelSize(objectUrl);
    return { type, data: buffer, width, height };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function scaleToMaxWidth(width, height) {
  if (!width || !height) return { width: MAX_IMAGE_WIDTH_PX, height: Math.round(MAX_IMAGE_WIDTH_PX * 0.6) };
  if (width <= MAX_IMAGE_WIDTH_PX) return { width, height };
  const ratio = MAX_IMAGE_WIDTH_PX / width;
  return { width: MAX_IMAGE_WIDTH_PX, height: Math.round(height * ratio) };
}

function resolveImageSource(block, photosMap) {
  if (block.url) return block.url; // 前端已注入真实 URL 的形态优先
  if (block.photoId != null && photosMap && Object.prototype.hasOwnProperty.call(photosMap, block.photoId)) {
    return photosMap[block.photoId];
  }
  return null;
}

function triggerDocxDownload(blob, filename) {
  if (typeof document === 'undefined') {
    throw new Error('exportNewsDocx 只能在浏览器环境中触发下载');
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // 部分浏览器下载是异步发起的，稍作延迟再吊销 objectURL，避免下载被打断
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function sanitizeFileName(name) {
  const cleaned = String(name || '未命名文档')
    .replace(/[\\/:*?"<>|\r\n]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return (cleaned || '未命名文档').slice(0, 80);
}

// ============================================================
// 3. docx 段落构建
// ============================================================

function headingParagraph(block) {
  const levelMap = { 1: HeadingLevel.HEADING_1, 2: HeadingLevel.HEADING_2, 3: HeadingLevel.HEADING_3 };
  const sizeMap = { 1: pt(18), 2: pt(16), 3: pt(14) };
  return new Paragraph({
    heading: levelMap[block.level] || HeadingLevel.HEADING_3,
    spacing: { before: 240, after: 120 },
    children: [
      new TextRun({ text: block.text, bold: true, font: FONT_HEI, size: sizeMap[block.level] || pt(14) }),
    ],
  });
}

function bodyParagraph(text) {
  return new Paragraph({
    spacing: { line: 360, lineRule: LineRuleType.AUTO, after: 120 },
    children: [new TextRun({ text, font: FONT_SONG, size: SIZE_BODY })],
  });
}

function listItemParagraph(text) {
  return new Paragraph({
    spacing: { line: 360, lineRule: LineRuleType.AUTO, after: 60 },
    indent: { left: 480 },
    children: [new TextRun({ text: `• ${text}`, font: FONT_SONG, size: SIZE_BODY })],
  });
}

function captionParagraph(text) {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 200 },
    children: [new TextRun({ text, font: FONT_SONG, size: SIZE_CAPTION, color: GRAY })],
  });
}

async function buildImageParagraphs(block, photosMap, captions) {
  const src = resolveImageSource(block, photosMap);
  const captionText = (block.photoId != null && captions && captions[block.photoId]) || block.alt || '';

  if (!src) {
    console.warn('[newsWordExport] 图片占位符找不到对应 URL，降级为文字占位', block);
    return [bodyParagraph(`【图：${block.alt || block.photoId || '未命名'}】`)];
  }

  try {
    const img = await fetchDocxImage(src);
    const { width, height } = scaleToMaxWidth(img.width, img.height);
    const imageParagraph = new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 120, after: 60 },
      children: [new ImageRun({ type: img.type, data: img.data, transformation: { width, height } })],
    });
    const paragraphs = [imageParagraph];
    if (captionText) paragraphs.push(captionParagraph(captionText));
    return paragraphs;
  } catch (e) {
    // 降级是产品要求的正常路径（不能让一张图拖垮整篇导出），但原因必须打出来，不能静默吞掉
    console.warn('[newsWordExport] 图片抓取失败，降级为文字占位:', src, e && e.message);
    return [bodyParagraph(`【图：${captionText || '图片加载失败'}】`)];
  }
}

// ============================================================
// 4. 对外主入口
// ============================================================

/**
 * 把渠道生成结果导出为 .docx 并触发浏览器下载。
 * @param {object} params
 * @param {string} params.title 标题（黑体加粗二号居中）
 * @param {string} [params.subtitle] 副标题（居中灰）
 * @param {string} params.markdown 正文 markdown
 * @param {Record<string,string>} [params.photosMap] 图片 id → 可访问 URL，用于解析未被前端预先注入的 PHOTO:id 占位符
 * @param {Record<string,string>} [params.captions] 图片 id → 图说文案，缺省则用 markdown 里的 alt
 * @param {string} [params.photographerLine] 文末摄影师署名整行文案（右对齐）
 * @returns {Promise<Blob>} 生成的 docx Blob（下载已同步触发，返回值便于调用方做进一步处理或测试桩替换 triggerDocxDownload）
 */
async function exportNewsDocx({ title, subtitle, markdown, photosMap = {}, captions = {}, photographerLine } = {}) {
  if (typeof markdown !== 'string') {
    throw new Error('exportNewsDocx 需要 markdown 字符串');
  }

  const blocks = parseMarkdownBlocks(markdown);
  const children = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 120 },
      children: [new TextRun({ text: title || '未命名文档', bold: true, font: FONT_HEI, size: SIZE_TITLE })],
    }),
  ];

  if (subtitle) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 240 },
        children: [new TextRun({ text: subtitle, font: FONT_SONG, size: SIZE_SUBTITLE, color: GRAY })],
      }),
    );
  }

  for (const block of blocks) {
    if (block.type === 'heading') {
      children.push(headingParagraph(block));
    } else if (block.type === 'image') {
      // eslint-disable-next-line no-await-in-loop -- 图片需按 markdown 出现顺序依次嵌入，无法并行
      children.push(...(await buildImageParagraphs(block, photosMap, captions)));
    } else if (block.type === 'listItem') {
      children.push(listItemParagraph(block.text));
    } else {
      children.push(bodyParagraph(block.text));
    }
  }

  if (photographerLine) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.RIGHT,
        spacing: { before: 240 },
        children: [new TextRun({ text: photographerLine, font: FONT_SONG, size: SIZE_BODY })],
      }),
    );
  }

  const doc = new Document({ sections: [{ children }] });
  const blob = await Packer.toBlob(doc);
  triggerDocxDownload(blob, `${sanitizeFileName(title)}.docx`);
  return blob;
}

export { exportNewsDocx, parseMarkdownBlocks };
