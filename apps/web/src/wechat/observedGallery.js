const escape = value => String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function isObservedGallery(style) {
  return style?.type === 'imageGroup' && style.source === 'observed' && typeof style.htmlTemplate === 'string'
    && style.htmlTemplate.length < 50000 && Number.isInteger(style.slots) && style.slots >= 2 && style.slots <= 20
    && Array.from({ length: style.slots }, (_, i) => `{{photo_${i}}}`).every(token => style.htmlTemplate.includes(token));
}

export function snapshotGallery(style) {
  if (!isObservedGallery(style)) return null;
  const { id, type, source, htmlTemplate, slots, name, galleryKind, occurrenceSlots, sourceTitle, sourceUrl, sourceAccount, articleId, revisionId } = style;
  return { id, type, source, htmlTemplate, slots, name, galleryKind, occurrenceSlots, sourceTitle, sourceUrl, sourceAccount, articleId, revisionId };
}

function imageUrl(value) {
  const src = String(value || '');
  if (!/^(https?:\/\/|\/(?!\/)|data:image\/(png|jpeg|webp|gif);base64,)/i.test(src)) return '';
  // A slot can occur inside a quoted CSS URL as well as an HTML src attribute.
  return escape(src.replace(/["'()<>\\\s]/g, char => encodeURIComponent(char).replace(/'/g, '%27')));
}

export function observedGalleryHtml(images, style) {
  if (!isObservedGallery(style)) return '';
  const frames = [];
  for (let start = 0; start < images.length; start += style.slots) {
    const batch = images.slice(start, start + style.slots);
    if (batch.length === style.slots) {
      frames.push(style.htmlTemplate.replace(/\{\{photo_(\d+)\}\}/g, (_, index) => imageUrl(batch[Number(index)]?.src))
        .replace(/data-gallery-slot="(\d+)"/g, (_, index) => `data-gallery-slot="${start + Number(index)}"`));
    } else {
      // Do not invent a different layout or duplicate photos to fill the original slots.
      frames.push(batch.map((photo, index) => `<p style="margin:10px 0;line-height:0"><img data-gallery-slot="${start + index}" src="${imageUrl(photo.src)}" style="width:100%;height:auto" /></p>`).join(''));
    }
    const captions = batch.map((photo, i) => photo.caption ? `${start + i + 1}. ${escape(photo.caption)}` : '').filter(Boolean);
    if (captions.length) frames.push(`<p style="font-size:13px;color:#777;line-height:1.6;margin:8px 0">${captions.join('<br>')}</p>`);
  }
  return frames.join('\n');
}
