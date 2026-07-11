import { marked } from 'marked';
import DOMPurify from 'dompurify';

// 找不到对应图片 id 时的占位图：与 WechatPreviewEditor 保持同一套（各自内联，两个文件不互相依赖）
const FALLBACK_IMG = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="#eee"/><text x="60" y="44" font-size="12" fill="#999" text-anchor="middle">图片缺失</text></svg>'
);

function resolvePhotoPlaceholders(markdown, photosMap) {
  const map = photosMap || {};
  return String(markdown || '').replace(/\(PHOTO:([^)\s]+)\)/g, (m, id) => {
    const url = map[String(id)];
    return `(${url || FALLBACK_IMG})`;
  });
}

function renderMarkdownToHtml(markdown) {
  marked.setOptions({ mangle: false, headerIds: false, gfm: true });
  return marked.parse(String(markdown || ''));
}

// 公众号编辑器粘贴富文本时会整体丢弃 <style> 标签，唯一可靠的方式是把样式全部内联到每个元素的 style 属性上
const INLINE_STYLE_MAP = {
  h1: 'font-size:22px;font-weight:700;color:#1a1a1a;line-height:1.5;margin:0 0 20px;text-align:center;',
  h2: 'font-size:19px;font-weight:700;color:#1a1a1a;line-height:1.5;margin:30px 0 16px;',
  h3: 'font-size:17px;font-weight:700;color:#1a1a1a;line-height:1.5;margin:24px 0 12px;',
  p: 'font-size:15px;line-height:1.75;color:#3f3f3f;letter-spacing:0.05em;margin:0 0 20px;',
  img: 'display:block;max-width:100%;height:auto;margin:16px auto;border-radius:4px;',
  blockquote: 'margin:16px 0;padding:8px 16px;background:#f7f7f7;border-left:3px solid #ccc;color:#666;',
  strong: 'font-weight:700;color:#1a1a1a;',
  ul: 'margin:0 0 20px;padding-left:24px;font-size:15px;line-height:1.75;color:#3f3f3f;',
  ol: 'margin:0 0 20px;padding-left:24px;font-size:15px;line-height:1.75;color:#3f3f3f;',
  li: 'margin-bottom:6px;',
  a: 'color:#576b95;text-decoration:none;',
};

// 给每张图片后面追加可见的〔图N〕序号——公众号编辑器不会自动抓取外链图片，
// 用户需要用 downloadImagePack 另存图片后按序号手动重新上传，这个标记是唯一的对应关系
function annotateImages(root) {
  const imgs = Array.from(root.querySelectorAll('img'));
  imgs.forEach((img, idx) => {
    const marker = root.ownerDocument.createElement('span');
    marker.textContent = `〔图${idx + 1}〕`;
    marker.setAttribute(
      'style',
      'font-size:12px;color:#999;margin-left:4px;vertical-align:middle;',
    );
    img.insertAdjacentElement('afterend', marker);
  });
  return imgs.length;
}

function applyInlineStyles(root) {
  Object.keys(INLINE_STYLE_MAP).forEach((tag) => {
    root.querySelectorAll(tag).forEach((el) => {
      // 直接覆盖 style：这些元素都是 marked 刚渲染出来的，不存在需要合并的既有样式
      el.setAttribute('style', INLINE_STYLE_MAP[tag]);
    });
  });
}

/**
 * 把 {title, markdown, photosMap} 渲染为公众号可粘贴的富文本，写入系统剪贴板
 * （同时写 text/html 与 text/plain，兼容"粘贴为纯文本"场景）。
 * 返回 {ok, imageCount}；调用方应提示用户"图片需在公众号后台重新上传，已在文中标注序号"。
 * 失败（浏览器不支持 Clipboard API / 权限被拒）一律 throw，不做静默降级。
 */
export async function copyWechatRichText({ title, markdown, photosMap }) {
  if (typeof window === 'undefined' || !window.navigator || !window.navigator.clipboard || typeof window.ClipboardItem !== 'function') {
    throw new Error('当前浏览器不支持富文本剪贴板写入（需要 Clipboard API + ClipboardItem），请更换浏览器或使用「复制 Markdown」代替');
  }

  const withRealImages = resolvePhotoPlaceholders(markdown, photosMap);
  const bodyHtml = renderMarkdownToHtml(withRealImages);
  const safeHtml = DOMPurify.sanitize(bodyHtml, {
    FORBID_TAGS: ['script', 'style', 'form', 'input', 'iframe', 'object', 'embed'],
  });

  const container = document.createElement('div');
  container.innerHTML = safeHtml;

  const imageCount = annotateImages(container);
  applyInlineStyles(container);

  // 标题单独作为一个内联样式的 h1 放在正文最前面：公众号标题栏是独立输入框、无法承接富文本粘贴，
  // 这里让用户复制后自行剪切标题行，而不是要求二次单独复制
  const titleEl = document.createElement('h1');
  titleEl.setAttribute('style', INLINE_STYLE_MAP.h1);
  titleEl.textContent = String(title || '');
  container.insertBefore(titleEl, container.firstChild);

  const finalHtml = container.innerHTML;
  const plainText = `${title || ''}\n\n${container.textContent || ''}`.trim();

  try {
    const item = new window.ClipboardItem({
      'text/html': new Blob([finalHtml], { type: 'text/html' }),
      'text/plain': new Blob([plainText], { type: 'text/plain' }),
    });
    await window.navigator.clipboard.write([item]);
  } catch (e) {
    throw new Error(`写入剪贴板失败：${e && e.message ? e.message : e}`);
  }

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
