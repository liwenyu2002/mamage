// 二维码生成（手机预览）：vendor 了 qrcode-generator（MIT, Kazuhiko Arase, src/wechat/vendor/），
// 零 npm 依赖——避免 Mini 部署流程（git pull && npm run build，不跑 npm install）漏装依赖。
// 只用它的 SVG 输出，不碰内置 GIF 编码路径。
import qrcode from './vendor/qrcode-generator';

/**
 * 把文本编码为二维码 SVG 字符串。
 * @param {string} text 通常是绝对 URL
 * @param {{cellSize?: number, margin?: number}} [opts]
 * @returns {string} 一段 <svg>…</svg>
 */
export function makeQrSvg(text, opts = {}) {
  const cellSize = opts.cellSize || 5;
  const margin = opts.margin != null ? opts.margin : 12;
  // typeNumber=0 让库按数据量自动选版本；纠错级 'M'（15% 冗余，链接足够且更密）
  const qr = qrcode(0, 'M');
  qr.addData(String(text || ''));
  qr.make();
  return qr.createSvgTag({ cellSize, margin, scalable: true });
}
