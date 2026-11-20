export function personalPdfLayout(width, height, { paper = 'a4', orientation = 'auto', margin = 10 } = {}) {
  const papers = { a4: [595.276, 841.89], a5: [419.528, 595.276], letter: [612, 792] };
  margin = Number(margin);
  if (!(width > 0 && height > 0) || !Number.isFinite(margin) || margin < 0 || margin > 30
    || !['auto', 'portrait', 'landscape'].includes(orientation) || (!papers[paper] && paper !== 'image')) throw new Error('PDF 页面参数无效');
  const inset = margin / 25.4 * 72;
  let pageWidth, pageHeight;
  if (paper === 'image') {
    const scale = Math.min(1, 14400 / Math.max(width, height)) * 0.75;
    pageWidth = width * scale + inset * 2; pageHeight = height * scale + inset * 2;
  } else {
    [pageWidth, pageHeight] = papers[paper];
    if (orientation === 'landscape' || (orientation === 'auto' && width > height)) [pageWidth, pageHeight] = [pageHeight, pageWidth];
  }
  const scale = Math.min((pageWidth - inset * 2) / width, (pageHeight - inset * 2) / height);
  const imageWidth = width * scale, imageHeight = height * scale;
  return { pageWidth, pageHeight, imageWidth, imageHeight, x: (pageWidth - imageWidth) / 2, y: (pageHeight - imageHeight) / 2 };
}
