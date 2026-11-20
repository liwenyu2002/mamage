export function fitImageSize(width, height, maxEdge) {
  if (!(width > 0 && height > 0)) throw new Error('图片尺寸无效');
  const edge = Number(maxEdge);
  if (!(edge >= 1 && edge <= 16384)) throw new Error('最长边应在 1–16384 像素之间');
  const scale = Math.min(1, edge / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export function printDimensions(width, height, dpi) {
  if (!(Number(dpi) >= 1 && Number(dpi) <= 2400)) throw new Error('DPI 应在 1–2400 之间');
  return { widthMm: width / dpi * 25.4, heightMm: height / dpi * 25.4 };
}

export function collageLayout(count, { width = 2400, columns = 2, gap = 24, labels = true } = {}) {
  width = Number(width); columns = Number(columns); gap = Number(gap);
  if (!Number.isInteger(count) || count < 1 || count > 20 || !Number.isInteger(width) || width < 320 || width > 8192
    || !Number.isInteger(columns) || columns < 1 || columns > 4 || !Number.isFinite(gap) || gap < 0 || gap > 200) throw new Error('拼版参数无效');
  const cols = Math.min(count, columns), rows = Math.ceil(count / cols);
  const cellWidth = Math.floor((width - gap * (cols + 1)) / cols);
  const labelHeight = labels ? Math.max(24, Math.round(width / 65)) : 0;
  const imageHeight = Math.round(cellWidth * 3 / 4);
  const height = gap * (rows + 1) + rows * (imageHeight + labelHeight);
  if (cellWidth < 32 || width * height > 24000000 || height > 16384) throw new Error('拼版尺寸过大，请减小宽度或增加列数');
  return { width, height, cells: Array.from({ length: count }, (_, i) => ({
    x: gap + (i % cols) * (cellWidth + gap), y: gap + Math.floor(i / cols) * (imageHeight + labelHeight + gap),
    width: cellWidth, height: imageHeight, labelHeight, label: String.fromCharCode(65 + i),
  })) };
}

export function imageExportName(name, format, index) {
  const stem = String(name || 'image').replace(/\.[^.]+$/, '').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 90).trim() || 'image';
  const extension = format === 'jpeg' ? 'jpg' : format;
  if (!['jpg', 'png', 'webp'].includes(extension)) throw new Error('不支持的导出格式');
  return `${index == null ? '' : String(index + 1).padStart(2, '0') + '-'}${stem}-mamage.${extension}`;
}
