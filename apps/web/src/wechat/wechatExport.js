// 公众号导出：剪贴板写入 + 图片包下载。
// 渲染逻辑已收敛到 themes.js 的 renderWechatHtml——本文件不再自己跑 marked/DOMPurify，
// 避免预览和"复制富文本"两条路径各自渲染出不一致的 HTML。
import { renderWechatHtml } from './themes.js';

/**
 * 把 { html, plainText } 写入系统剪贴板（text/html + text/plain，兼容"粘贴为纯文本"场景）。
 * 纯负责剪贴板 I/O，不做任何 markdown/主题渲染——html 必须是调用方（renderWechatHtml）已经产出并清洗过的最终结果。
 * 失败（浏览器不支持 Clipboard API / 权限被拒）一律 throw，不做静默降级。
 */
export async function copyWechatRichText({ html, plainText }) {
  if (typeof window === 'undefined' || !window.navigator || !window.navigator.clipboard || typeof window.ClipboardItem !== 'function') {
    throw new Error('当前浏览器不支持富文本剪贴板写入（需要 Clipboard API + ClipboardItem），请更换浏览器或使用「复制 Markdown」代替');
  }

  try {
    const item = new window.ClipboardItem({
      'text/html': new Blob([String(html || '')], { type: 'text/html' }),
      'text/plain': new Blob([String(plainText || '')], { type: 'text/plain' }),
    });
    await window.navigator.clipboard.write([item]);
  } catch (e) {
    throw new Error(`写入剪贴板失败：${e && e.message ? e.message : e}`);
  }

  return { ok: true };
}

// 给每张图片后面追加可见的〔图N〕序号——公众号编辑器不会自动抓取外链图片，
// 用户需要用 downloadImagePack 另存图片后按序号手动重新上传，这个标记是唯一的对应关系。
// 只有 legacy 包装（旧矩阵 Tab 场景）需要这个行为，新主题化编辑器由用户在编辑器内直接操作图片，不再需要它。
function annotateImages(root) {
  const imgs = Array.from(root.querySelectorAll('img'));
  imgs.forEach((img, idx) => {
    const marker = root.ownerDocument.createElement('span');
    marker.textContent = `〔图${idx + 1}〕`;
    marker.setAttribute(
      'style',
      'font-size:12px;color:#999999;margin-left:4px;vertical-align:middle;',
    );
    img.insertAdjacentElement('afterend', marker);
  });
  return imgs.length;
}

// 极简版 markdown 转纯文本：去图片行/标题符号/加粗斜体星号/引用符号/列表短横，
// 仅供 legacy 包装拼装 text/plain 兜底内容使用，不追求还原排版
function markdownToPlainTextLegacy(markdown) {
  return String(markdown || '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/^>\s?/gm, '')
    .replace(/^[-*]\s+/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * 旧签名兼容层：维持 AiNewsWriter 矩阵 Tab 现有调用方式 copyWechatRichText({ title, markdown, photosMap })。
 * 内部固定用 'minimal' 主题跑 renderWechatHtml，再补回旧版本"图片后追加〔图N〕标记"的行为后写入剪贴板。
 * 注意：这是过渡兼容函数，新的主题化编辑器应直接调用 renderWechatHtml + copyWechatRichText({html, plainText})。
 * 调用方接入时需把 import 里的 copyWechatRichText 换成 copyWechatRichTextLegacy（详见本次改动说明）。
 */
export async function copyWechatRichTextLegacy({ title, markdown, photosMap }) {
  const { html, imageCount } = renderWechatHtml(markdown, {
    themeKey: 'minimal',
    photosMap,
    title,
  });

  if (typeof document === 'undefined') {
    throw new Error('当前环境不支持 DOM 操作，无法生成图片标记');
  }
  const container = document.createElement('div');
  container.innerHTML = html;
  annotateImages(container);

  const plainText = `${title || ''}\n\n${markdownToPlainTextLegacy(markdown)}`.trim();

  await copyWechatRichText({ html: container.innerHTML, plainText });

  return { ok: true, imageCount };
}

/**
 * 逐张下载已选图片，文件名 `${baseName}_图N.jpg`，下载间隔 300ms 防止浏览器批量拦截。
 * photos: [{id, url}]。任意一张 fetch/下载失败立即 throw（禁止静默跳过导致用户以为下载齐了）。
 * 返回成功下载的张数。
 */
export async function downloadImagePack({ photos, baseName }) {
  const list = Array.isArray(photos) ? photos : [];
  if (!list.length) throw new Error('没有可下载的图片');

  const safeBase = String(baseName || 'wechat').replace(/[\\/:*?"<>|]/g, '_');
  let done = 0;

  for (let i = 0; i < list.length; i += 1) {
    const photo = list[i] || {};
    if (!photo.url) throw new Error(`第 ${i + 1} 张图片（id=${photo.id}）缺少 url，无法下载`);

    let blob;
    try {
      // 图片可能与前端不同源，若源站未开放 CORS 这里会失败——属于基础设施限制，直接抛出让用户知悉
      const resp = await fetch(photo.url);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      blob = await resp.blob();
    } catch (e) {
      throw new Error(`第 ${i + 1} 张图片（id=${photo.id}）下载失败：${e && e.message ? e.message : e}`);
    }

    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = `${safeBase}_图${i + 1}.jpg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // 延迟释放，太早 revoke 在部分浏览器上会中断尚未完成的下载
    setTimeout(() => URL.revokeObjectURL(objectUrl), 5000);

    done += 1;
    if (i < list.length - 1) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }

  return done;
}
