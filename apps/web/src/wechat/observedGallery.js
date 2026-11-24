import { MAX_WECHAT_GROUP_PHOTOS } from '../utils/newsImageGroups';

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

function staticPhotos(batch, start) {
  return batch.map((photo, index) => `<p style="margin:10px 0;line-height:0"><img data-gallery-slot="${start + index}" src="${imageUrl(photo.src)}" style="display:block;width:100%;height:auto" /></p>`).join('');
}

function adaptiveCarousel(batch, style, start) {
  const viewBox = /<svg\b[^>]*\bviewbox=["']([^"']+)["']/i.exec(style.htmlTemplate)?.[1];
  const [, , measuredWidth, measuredHeight] = (viewBox || '').trim().split(/[\s,]+/).map(Number);
  const valid = [measuredWidth, measuredHeight].every(value => value >= 1 && value <= 10000);
  const width = valid ? measuredWidth : 1200, height = valid ? measuredHeight : 800;
  const originalDuration = Number(/\bdur=["']([\d.]+)s["']/i.exec(style.htmlTemplate)?.[1]);
  const seconds = Math.max(1.5, Math.min(6, originalDuration / style.slots || 3));
  const count = batch.length, values = [], times = [];
  for (let i = 0; i < count; i++) {
    values.push(`${-i * width} 0`, `${-i * width} 0`);
    times.push((i / count).toFixed(5), ((i + 0.84) / count).toFixed(5));
  }
  values.push(`${-count * width} 0`); times.push('1');
  // Match the observed carousel's clipping and horizontal translation. The last frame loops back to the first.
  const frames = [...batch, batch[0]].map((photo, i) => `<image data-gallery-slot="${start + (i % count)}"
    href="${imageUrl(photo.src)}" x="${i * width}" y="0" width="${width}" height="${height}" preserveAspectRatio="xMidYMid slice"></image>`).join('');
  return `<section style="margin:12px 0;overflow:hidden"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}"
    style="display:block;width:100%;height:auto;overflow:hidden"><g><animateTransform attributeName="transform" type="translate"
    begin="0s" values="${values.join(';')}" keyTimes="${times.join(';')}" dur="${(seconds * count).toFixed(2)}s"
    repeatCount="indefinite"></animateTransform>${frames}</g></svg></section>`;
}

export function observedGalleryHtml(images, style, { compatible = false } = {}) {
  if (!isObservedGallery(style)) return '';
  const frames = [];
  const carousel = style.galleryKind === 'carousel';
  const perGroup = carousel ? MAX_WECHAT_GROUP_PHOTOS : style.slots;
  for (let start = 0; start < images.length; start += perGroup) {
    const batch = images.slice(start, start + perGroup);
    if (carousel && (compatible || batch.length === 1)) frames.push(staticPhotos(batch, start));
    else if (batch.length === style.slots) {
      frames.push(style.htmlTemplate.replace(/\{\{photo_(\d+)\}\}/g, (_, index) => imageUrl(batch[Number(index)]?.src))
        .replace(/data-gallery-slot="(\d+)"/g, (_, index) => `data-gallery-slot="${start + Number(index)}"`));
    } else if (carousel) frames.push(adaptiveCarousel(batch, style, start));
    else frames.push(staticPhotos(batch, start));
    const captions = batch.map((photo, i) => photo.caption ? `${start + i + 1}. ${escape(photo.caption)}` : '').filter(Boolean);
    if (captions.length) frames.push(`<p style="font-size:13px;color:#777;line-height:1.6;margin:8px 0">${captions.join('<br>')}</p>`);
  }
  return frames.join('\n');
}
