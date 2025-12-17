import React from 'react';
import {
  Layout,
  Card,
  Input,
  TextArea,
  Modal,
  Select,
  DatePicker,
  Button,
  Tag,
  Tabs,
  List,
  Toast,
} from '@douyinfe/semi-ui';
import { getAll as getTransferAll } from './services/transferStore';
import { request, resolveAssetUrl } from './services/request';
import { marked } from 'marked';

const { Header, Content } = Layout;

// Mock photos
const mockPhotos = [
  { id: 1, url: 'https://via.placeholder.com/320x180?text=图1', description: '大会开幕式', tags: ['开幕','大合照'] },
  { id: 2, url: 'https://via.placeholder.com/320x180?text=图2', description: '领导致辞', tags: ['致辞'] },
  { id: 3, url: 'https://via.placeholder.com/320x180?text=图3', description: '展台现场', tags: ['展台','互动'] },
];

const AiNewsWriter = () => {
  const DRAFT_STORAGE_KEY = 'mamage.aiNewsWriter.draft.v1';

  // state
  // 不要默认预填已选照片，用户从中转站或手动选择后再加入
  const [selectedPhotos, setSelectedPhotos] = React.useState([]);
  const [formValues, setFormValues] = React.useState({
    eventName: '',
    eventDate: null,
    location: '',
    organizer: '',
    participants: '',
    highlights: '',
    usage: '官网新闻',
    tone: '正式',
    targetWords: '500-800',
  });
  const [referenceArticle, setReferenceArticle] = React.useState('');
  const [stylePreset, setStylePreset] = React.useState('默认风格');
  const [interviewText, setInterviewText] = React.useState('');

  const [title, setTitle] = React.useState('');
  const [subtitle, setSubtitle] = React.useState('');
  const [markdownText, setMarkdownText] = React.useState('');
  const [generatedHtml, setGeneratedHtml] = React.useState('');
  const [isGenerating, setIsGenerating] = React.useState(false);
  const REFERENCE_MAX = 20000;
  const [showAdvancedEditor, setShowAdvancedEditor] = React.useState(false);
  const [advancedPrompt, setAdvancedPrompt] = React.useState('');

  const removePhoto = React.useCallback((photoId) => {
    setSelectedPhotos((prev) => (prev || []).filter((p) => String(p.id) !== String(photoId)));
  }, []);

  // Restore draft on mount so page switching won't reset inputs.
  React.useEffect(() => {
    try {
      const raw = window.localStorage.getItem(DRAFT_STORAGE_KEY);
      if (!raw) return;
      const draft = JSON.parse(raw);
      if (!draft || typeof draft !== 'object') return;

      if (draft.formValues && typeof draft.formValues === 'object') {
        const ev = draft.formValues.eventDate;
        let parsedEventDate = null;
        if (ev) {
          const d = new Date(ev);
          if (!Number.isNaN(d.getTime())) parsedEventDate = d;
        }
        setFormValues((s) => ({
          ...s,
          ...draft.formValues,
          eventDate: parsedEventDate,
        }));
      }

      if (typeof draft.referenceArticle === 'string') setReferenceArticle(draft.referenceArticle);
      if (typeof draft.interviewText === 'string') setInterviewText(draft.interviewText);
      if (typeof draft.advancedPrompt === 'string') setAdvancedPrompt(draft.advancedPrompt);
      if (typeof draft.title === 'string') setTitle(draft.title);
      if (typeof draft.subtitle === 'string') setSubtitle(draft.subtitle);
      if (typeof draft.markdownText === 'string') setMarkdownText(draft.markdownText);
      if (typeof draft.generatedHtml === 'string') setGeneratedHtml(draft.generatedHtml);

      if (Array.isArray(draft.selectedPhotos)) {
        setSelectedPhotos(draft.selectedPhotos);
      }
    } catch (e) {
      // ignore storage/parse errors
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-save draft (debounced) whenever key fields change.
  React.useEffect(() => {
    const t = setTimeout(() => {
      try {
        const payload = {
          formValues: {
            ...formValues,
            eventDate: formValues?.eventDate ? new Date(formValues.eventDate).toISOString() : null,
          },
          referenceArticle,
          interviewText,
          selectedPhotos,
          title,
          subtitle,
          markdownText,
          generatedHtml,
          advancedPrompt,
          savedAt: Date.now(),
        };
        window.localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(payload));
      } catch (e) {
        // ignore storage quota / disabled storage
      }
    }, 350);
    return () => clearTimeout(t);
  }, [
    formValues,
    referenceArticle,
    interviewText,
    selectedPhotos,
    title,
    subtitle,
    markdownText,
    generatedHtml,
    advancedPrompt,
  ]);
  

  // 参考素材改为粘贴文章内容（referenceArticle）

  // generate mock
  const assemblePrompt = () => {
    const parts = [];
    parts.push(`活动名称：${formValues.eventName || ''}`);
    parts.push(`活动日期：${formValues.eventDate ? String(formValues.eventDate) : ''}`);
    parts.push(`活动地点：${formValues.location || ''}`);
    parts.push(`主办/承办：${formValues.organizer || ''}`);
    parts.push(`出席/参与：${formValues.participants || ''}`);
    parts.push(`活动亮点：${formValues.highlights || ''}`);
    parts.push(`稿件用途：${formValues.usage || ''}`);
    parts.push(`文风偏好：${formValues.tone || ''}`);
    parts.push(`目标字数：${formValues.targetWords || ''}`);
    parts.push(`组织风格预设：${stylePreset || ''}`);
    if ((selectedPhotos || []).length) {
      parts.push('已选照片：');
      (selectedPhotos || []).forEach((p, i) => {
        parts.push(`  图${i + 1}：${p.description || ''} ${((p.tags || []) .join(', '))}`);
      });
    }
    if (referenceArticle) parts.push(`参考文章内容：\n${referenceArticle}`);
    if (interviewText) parts.push(`采访原文：\n${interviewText}`);
    parts.push('\n请根据以上信息生成一篇新闻稿，保持所选文风与目标字数范围，并在需要处插入图片占位符，例如：![图注](PHOTO:123)。');
    return parts.join('\n\n');
  };

  
    // Helper: check absolute URL
    const isAbsoluteUrl = (u) => /^https?:\/\//i.test(String(u || ''));

    const sanitizeHtml = (dirty) => {
      try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(dirty || '', 'text/html');
        // remove script/style
        doc.querySelectorAll('script,style').forEach(n => n.remove());
        // remove event handlers and javascript: href/src
        doc.querySelectorAll('*').forEach((el) => {
          for (const attr of Array.from(el.attributes)) {
            if (/^on/i.test(attr.name)) el.removeAttribute(attr.name);
            if ((attr.name === 'href' || attr.name === 'src') && String(attr.value).trim().toLowerCase().startsWith('javascript:')) el.removeAttribute(attr.name);
          }
        });
        return doc.body.innerHTML;
      } catch (e) {
        console.error('sanitizeHtml error', e);
        return '';
      }
    };

      // small helper to escape HTML in inserted captions
      const escapeHtml = (str) => {
        if (!str) return '';
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
      };

    // Use marked for robust markdown -> HTML rendering
    const renderMarkdownToHtml = (md) => {
      if (!md) return '';
      try {
        // configure marked for safer output
        marked.setOptions({
          mangle: false,
          headerIds: false,
          // disable raw HTML to avoid server-provided malicious html; we will sanitize later
          gfm: true,
        });
        return marked.parse(String(md || ''));
      } catch (e) {
        console.error('[AiNewsWriter] renderMarkdownToHtml error', e);
        return '';
      }
    };

    // Count visible characters in markdown while excluding image URLs
    // Keep image alt text (if present) but do not count the image src URLs.
    const countVisibleChars = (md) => {
      try {
        if (!md) return 0;
        let s = String(md);
        // Replace markdown image syntax ![alt](url) with the alt text only
        s = s.replace(/!\[([^\]]*?)\]\([^\)]*?\)/g, (m, alt) => (alt || ''));
        // Replace HTML <img ... alt="..." ...> with its alt text when available
        s = s.replace(/<img\b[^>]*alt=(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>/gi, (m, a, b, c) => (a || b || c || ''));
        // Remove any remaining http(s) URLs
        s = s.replace(/https?:\/\/[^\s)"']+/g, '');
        // Collapse whitespace and return length
        return s.replace(/\r\n/g, '\n').length;
      } catch (e) {
        return String(md || '').length;
      }
    };

    // Normalize markdown for rendering: remove BOM, convert fullwidth '#' to '#',
    // ensure headings like '#标题' become '# 标题' so the markdown parser recognizes them.
    const normalizeMarkdownForRendering = (md) => {
      try {
        if (!md) return md;
        let s = String(md || '');
        // remove BOM and common zero-width / directionality chars at start
        s = s.replace(/^[\uFEFF\u200B\u200C\u200D\u200E\u200F]+/, '');
        // normalize non-breaking / fullwidth spaces
        s = s.replace(/\u00A0/g, ' ').replace(/\u3000/g, ' ');
        // replace fullwidth hash with ascii hash
        s = s.replace(/＃/g, '#');
        // remove leading invisible chars on each line (helps when copy-paste introduces ZWSP)
        s = s.split('\n').map(line => line.replace(/^[\uFEFF\u200B\u200C\u200D\u200E\u200F\s]+/, '')).join('\n');
        // ensure headings have a space after the hashes (e.g. '#标题' -> '# 标题')
        s = s.replace(/^(#{1,6})([^\s#])/gm, (m, hashes, rest) => `${hashes} ${rest}`);
        return s;
      } catch (e) {
        return md;
      }
    };

    // Remove consecutive duplicate <img> tags with the same src to avoid double-inserted images
    const dedupeConsecutiveImages = (htmlStr) => {
      try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(htmlStr || '', 'text/html');
        const imgs = Array.from(doc.querySelectorAll('img'));
        imgs.forEach((img) => {
          const prev = img.previousElementSibling;
          if (prev && prev.tagName && prev.tagName.toLowerCase() === 'img') {
            try {
              const prevSrc = prev.getAttribute('src') || '';
              const curSrc = img.getAttribute('src') || '';
              if (prevSrc && curSrc && prevSrc === curSrc) {
                img.remove();
              }
            } catch (e) {
              // ignore
            }
          }
        });
        return doc.body.innerHTML;
      } catch (e) {
        return htmlStr;
      }
    };

      // Clean stray markdown fragments that may surround <img> tags in server HTML
      const cleanImageSurroundingText = (htmlStr) => {
        try {
          const parser = new DOMParser();
          const doc = parser.parseFromString(htmlStr || '', 'text/html');
          const imgs = Array.from(doc.querySelectorAll('img'));
          imgs.forEach((img) => {
            // previous sibling text cleanup (remove trailing '![' or similar)
            const prev = img.previousSibling;
            if (prev && prev.nodeType === Node.TEXT_NODE) {
              prev.nodeValue = prev.nodeValue.replace(/!\[\s*$/g, '').replace(/\s+$/g, '');
              if (!prev.nodeValue.trim()) prev.remove();
            }
            // next sibling text cleanup (remove leading ')', numbering, or ')(...' fragments)
            const next = img.nextSibling;
            if (next && next.nodeType === Node.TEXT_NODE) {
              next.nodeValue = next.nodeValue.replace(/^\s*\)\s*\d*/g, '').replace(/^\s*\)\s*/g, '');
              if (!next.nodeValue.trim()) next.remove();
            }
          });
          return doc.body.innerHTML;
        } catch (e) {
          return htmlStr;
        }
      };

      // Fix cases where an <img> tag's src attribute accidentally contains markdown
      // like "![alt](https://...)" or a URL-encoded version of that. Decode and
      // extract the real URL and alt text when found.
      const fixImgSrcMarkdownInAttributes = (htmlStr) => {
        try {
          // First pass: direct string-level replacement to catch encoded markdown inside src
          try {
            htmlStr = htmlStr.replace(/(<img\b[^>]*\bsrc=)(["'])(.*?)\2/gi, (full, prefix, quote, val) => {
              let decoded = val;
              try { decoded = decodeURIComponent(val); } catch (e) { /* ignore */ }
              // if decoded contains markdown like [alt](http...)
              const urlMatch = decoded.match(/https?:\/\/(?:[\w\-@:%._\+~#=]{1,256})(?:\/[\w\-@:%_+.~#?&//=]*)?/i);
              if (urlMatch && urlMatch[0]) {
                const url = urlMatch[0];
                return `${prefix}${quote}${url}${quote}`;
              }
              return full;
            });
          } catch (e) {
            // ignore string-level failures
          }

          // Second pass: DOM-level robust cleanup
          const parser = new DOMParser();
          const doc = parser.parseFromString(htmlStr || '', 'text/html');
          const imgs = Array.from(doc.querySelectorAll('img'));
          imgs.forEach((img) => {
            let raw = img.getAttribute('src') || '';
            try {
              const dec = decodeURIComponent(raw);
              if (dec && dec !== raw) raw = dec;
            } catch (e) {
              // ignore decode errors
            }

            const urlMatch = raw.match(/https?:\/\/(?:[\w\-@:%._\+~#=]{1,256})(?:\/[\w\-@:%_+.~#?&//=]*)?/i);
            if (urlMatch && urlMatch[0]) {
              const url = urlMatch[0];
              let alt = img.getAttribute('alt') || '';
              const altMatch = raw.match(/\[([^\]]+)\]\s*\(/);
              if (altMatch && altMatch[1]) alt = altMatch[1];
              img.setAttribute('src', url);
              if (alt && (!img.getAttribute('alt') || img.getAttribute('alt') === '')) img.setAttribute('alt', alt);
            }
          });
          return doc.body.innerHTML;
        } catch (e) {
          return htmlStr;
        }
      };

    // Replace PHOTO:<id> placeholders using provided photoMap (id -> fullUrl) or by fetching
    const replacePhotoPlaceholders = async (result) => {
      // result may contain markdown and/or html plus optionally photos info
      const photoMap = {};
      if (result.photos && Array.isArray(result.photos)) {
        result.photos.forEach(p => {
          if (p.id && p.url) photoMap[String(p.id)] = p.url;
        });
      }
      // fallback: use selectedPhotos currently in client state as an id->url map
      try {
        if ((selectedPhotos || []).length) {
          (selectedPhotos || []).forEach((p) => {
            const sid = String(p.id || p.url || '');
            if (sid && !photoMap[sid]) {
              // prefer the canonical thumbUrl we now send from client
              const cand = p.thumbUrl || p.thumbSrc || p.thumb || p.url || null;
              if (cand) photoMap[sid] = cand;
            }
          });
        }
      } catch (e) {
        // ignore
      }

      // helper to resolve a photo id to a usable URL (absolute COS url)
      const resolvePhotoUrl = async (photoId) => {
        const sid = String(photoId);
        if (photoMap[sid]) {
          return isAbsoluteUrl(photoMap[sid]) ? photoMap[sid] : null;
        }
        // attempt to fetch from /api/photos/:id
        try {
          const resp = await request(`/api/photos/${encodeURIComponent(sid)}`, { method: 'GET' });
          // look for common fields
          const cand = resp.url || resp.fullUrl || resp.cosUrl || resp.src || resp.thumbSrc;
          if (cand && isAbsoluteUrl(cand)) return cand;
          // if resp contains nested object
          if (resp.data) {
            const cand2 = resp.data.url || resp.data.fullUrl || resp.data.cosUrl || resp.data.src;
            if (cand2 && isAbsoluteUrl(cand2)) return cand2;
          }
          return null;
        } catch (e) {
          console.error('[AiNewsWriter] fetch photo failed for', photoId, e);
          return null;
        }
      };

      const missingIds = new Set();

      // process markdown
      let md = result.markdown || '';
      if (md) {
        // find PHOTO:xxxx tokens
        const mdReplaced = md.replace(/PHOTO:([\w-]+)/g, (match, id) => {
          missingIds.add(id);
          return `__MAMAGE_PHOTO_PLACEHOLDER_${id}__`;
        });
        md = mdReplaced;
        // Now iterate missingIds to resolve urls
        for (const id of Array.from(missingIds)) {
          const url = await resolvePhotoUrl(id);
          const alt = `图${id}`;
          const insert = url ? `![${alt}](${url})` : `![图片缺失](data:image/svg+xml;utf8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="100%" height="100%" fill="#eee"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="#888">图片缺失</text></svg>')})`;
          md = md.replace(new RegExp(`__MAMAGE_PHOTO_PLACEHOLDER_${id}__`, 'g'), insert);
          if (!url) console.error('[AiNewsWriter] photo missing for id', id);
        }
        result.markdown = md;
      }

      // process html (if provided)
      let html = result.html || '';
      if (html) {
        // replace PHOTO:id occurrences similarly
        const ids = [];
        html = html.replace(/PHOTO:([\w-]+)/g, (match, id) => {
          ids.push(id);
          return `__MAMAGE_PHOTO_PLACEHOLDER_${id}__`;
        });
        for (const id of ids) {
          const url = await resolvePhotoUrl(id);
          const ph = photoMap[String(id)];
          const name = ph && (ph.photographerName || ph.photographer_name || null);
          if (url) {
            if (name) {
              const fig = `<figure><img src="${url}" alt="图${id}" loading="lazy"/><figcaption>摄影：${escapeHtml(String(name))}</figcaption></figure>`;
              html = html.replace(new RegExp(`__MAMAGE_PHOTO_PLACEHOLDER_${id}__`, 'g'), fig);
            } else {
              const insert = `<img src="${url}" alt="图${id}" loading="lazy"/>`;
              html = html.replace(new RegExp(`__MAMAGE_PHOTO_PLACEHOLDER_${id}__`, 'g'), insert);
            }
          } else {
            const missing = `<img src="data:image/svg+xml;utf8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="100%" height="100%" fill="#eee"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="#888">图片缺失</text></svg>')}" alt="图片缺失"/>`;
            html = html.replace(new RegExp(`__MAMAGE_PHOTO_PLACEHOLDER_${id}__`, 'g'), missing);
            console.error('[AiNewsWriter] photo missing for id', id);
          }
        }
        // attempt to fix img[src] that accidentally contain markdown or encoded markdown
        html = fixImgSrcMarkdownInAttributes(html);
        // clean stray surrounding markdown fragments
        html = cleanImageSurroundingText(html);
        // dedupe consecutive identical images that may have been inserted twice
        result.html = dedupeConsecutiveImages(html);
      }

      return result;
    };

  // Normalize preview HTML: make images responsive and fix heading spacing
  const normalizePreviewHtml = (htmlStr) => {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(htmlStr || '', 'text/html');

      // Images: responsive, block, centered, limit width
      Array.from(doc.querySelectorAll('img')).forEach((img) => {
        // preserve existing width/height if explicitly set to numeric values
        img.style.maxWidth = '100%';
        img.style.height = 'auto';
        img.style.display = 'block';
        if (!img.style.margin) img.style.margin = '12px auto';
      });

      // Wrap images in <figure> and add <figcaption> from alt or adjacent text when present
      Array.from(doc.querySelectorAll('img')).forEach((img) => {
        try {
          if (img.closest('figure')) return; // already wrapped
          const figure = doc.createElement('figure');
          figure.style.margin = '12px auto';
          figure.style.maxWidth = '100%';
          figure.style.textAlign = 'center';

          // move img into figure
          const parent = img.parentNode;
          parent.replaceChild(figure, img);
          figure.appendChild(img);

          // determine caption: prefer data-caption, then alt, then immediate following text node or small element
          let captionText = img.getAttribute('data-caption') || img.getAttribute('alt') || '';
          // if next sibling is a text node with short text, take it as caption and remove it
          const next = figure.nextSibling;
          if ((!captionText || captionText.trim() === '') && next && next.nodeType === Node.TEXT_NODE) {
            const t = String(next.nodeValue || '').trim();
            if (t && t.length < 200) {
              captionText = t;
              // remove that text node
              next.parentNode && next.parentNode.removeChild(next);
            }
          }
          // if next element sibling is <em> or <small> or has class 'caption', use it
          const nextEl = figure.nextElementSibling;
          if ((!captionText || captionText.trim() === '') && nextEl) {
            const tag = (nextEl.tagName || '').toLowerCase();
            if (tag === 'em' || tag === 'small' || (nextEl.className && /caption/i.test(nextEl.className))) {
              captionText = nextEl.textContent.trim();
              nextEl.parentNode && nextEl.parentNode.removeChild(nextEl);
            }
          }

          if (captionText && captionText.trim()) {
            const figcap = doc.createElement('figcaption');
            figcap.textContent = captionText.trim();
            figcap.style.fontSize = '13px';
            figcap.style.color = '#666';
            figcap.style.marginTop = '6px';
            figcap.style.textAlign = 'center';
            figure.appendChild(figcap);
          }
        } catch (e) {
          // ignore per-image errors
        }
      });

      // Wrap images in <figure> and add <figcaption> from alt or adjacent text when present
      Array.from(doc.querySelectorAll('img')).forEach((img) => {
        try {
          if (img.closest('figure')) return; // already wrapped
          const figure = doc.createElement('figure');
          figure.style.margin = '12px auto';
          figure.style.maxWidth = '100%';
          figure.style.textAlign = 'center';

          // move img into figure
          const parent = img.parentNode;
          parent.replaceChild(figure, img);
          figure.appendChild(img);

          // determine caption: prefer data-caption, then alt, then immediate following text node or small element
          let captionText = img.getAttribute('data-caption') || img.getAttribute('alt') || '';
          // if next sibling is a text node with short text, take it as caption and remove it
          const next = figure.nextSibling;
          if ((!captionText || captionText.trim() === '') && next && next.nodeType === Node.TEXT_NODE) {
            const t = String(next.nodeValue || '').trim();
            if (t && t.length < 200) {
              captionText = t;
              // remove that text node
              next.parentNode && next.parentNode.removeChild(next);
            }
          }
          // if next element sibling is <em> or <small> or has class 'caption', use it
          const nextEl = figure.nextElementSibling;
          if ((!captionText || captionText.trim() === '') && nextEl) {
            const tag = (nextEl.tagName || '').toLowerCase();
            if (tag === 'em' || tag === 'small' || (nextEl.className && /caption/i.test(nextEl.className))) {
              captionText = nextEl.textContent.trim();
              nextEl.parentNode && nextEl.parentNode.removeChild(nextEl);
            }
          }

          if (captionText && captionText.trim()) {
            const figcap = doc.createElement('figcaption');
            figcap.textContent = captionText.trim();
            figcap.style.fontSize = '13px';
            figcap.style.color = '#666';
            figcap.style.marginTop = '6px';
            figcap.style.textAlign = 'center';
            figure.appendChild(figcap);
          }
        } catch (e) {
          // ignore per-image errors
        }
      });

      // Headings: use conservative spacing and allow normal wrapping/word-break
      Array.from(doc.querySelectorAll('h1, h2, h3')).forEach((hd) => {
        // don't force font-size; only tweak spacing and wrapping
        hd.style.lineHeight = '1.35';
        hd.style.marginTop = '6px';
        hd.style.marginBottom = '12px';
        hd.style.whiteSpace = 'normal';
        hd.style.wordBreak = 'break-word';
        hd.style.display = 'block';
      });

      // Paragraphs: comfortable spacing
      Array.from(doc.querySelectorAll('p')).forEach((p) => {
        if (!p.style.marginTop) p.style.marginTop = '6px';
        if (!p.style.marginBottom) p.style.marginBottom = '10px';
      });

      return doc.body.innerHTML;
    } catch (e) {
      return htmlStr;
    }
  };

  // Fix nested markdown image syntax in markdown text like:
  // ![outer alt](![inner alt](https://...jpg))
  // We want to convert it to: ![outer alt](https://...jpg) (prefer outer alt)
  const fixNestedMarkdownImages = (md) => {
    try {
      if (!md) return md;
      return md.replace(/!\[([^\]]*?)\]\(\s*([^\)]*?)\s*\)/g, (full, outerAlt, inner) => {
        // inner may already be a nested markdown image or an encoded version
        let innerRaw = inner || '';
        let innerDecoded = innerRaw;
        try { innerDecoded = decodeURIComponent(innerRaw); } catch (e) { /* ignore decode errors */ }

        // prefer decoded inner if it contains nested markdown
        const candidate = innerDecoded.includes('![') ? innerDecoded : innerRaw;
        const nested = candidate.match(/!\[([^\]]*?)\]\(\s*(https?:\/\/[^\s)]+)\s*\)/);
        if (nested) {
          const innerAlt = nested[1] || '';
          const url = nested[2] || '';
          const alt = (outerAlt && outerAlt.trim()) ? outerAlt.trim() : (innerAlt && innerAlt.trim() ? innerAlt.trim() : '');
          return `![${alt}](${url})`;
        }
        return full;
      });
    } catch (e) {
      return md;
    }
  };

    // Injector: replace markdown placeholders of form ![alt](PHOTO:id)
    // using the provided photos array (selectedPhotosArg). This follows the
    // backend contract: markdown uses PHOTO:id placeholders and real URLs are
    // provided by `photos` (or selectedPhotos). If no usable url is found,
    // fallback to a placeholder image.
    const injectPhotoUrls = (markdown, selectedPhotosArg) => {
      try {
        if (!markdown) return markdown;
        const photos = Array.isArray(selectedPhotosArg) ? selectedPhotosArg : [];
        const map = Object.fromEntries(photos.map(p => [String(p.id), p]));
        const placeholder = (typeof resolveAssetUrl === 'function') ? resolveAssetUrl('/static/img/placeholder.png') : '/static/img/placeholder.png';
        return String(markdown).replace(/!\[([^\]]*?)\]\(PHOTO:([^\)]+)\)/g, (m, alt, id) => {
          const ph = map[String(id)];
          const cand = ph && (ph.url || ph.thumbUrl || ph.thumbSrc || ph.thumb || ph.src);
          // Prefer backend-provided photographerName. If missing, fall back to photographerId.
          const name = ph && (ph.photographerName || ph.photographer_name || null);
          const fallbackId = ph && (ph.photographerId || ph.photographer_id || ph.photographer || null);
          const displayName = name ? name : (fallbackId ? `摄影师 #${fallbackId}` : '未知摄影师');
          const imgMd = (cand && cand.length) ? `![${alt}](${cand})` : `![${alt}](${placeholder})`;
          if (displayName) return `${imgMd}\n\n*摄影：${displayName}*`;
          return imgMd;
        });
      } catch (e) {
        console.error('[AiNewsWriter] injectPhotoUrls error', e);
        return markdown;
      }
    };

    // Note: photographer names are expected to be returned by backend in
    // result.photos[].photographerName. Do not fetch from /api/users here; we
    // instead prefer showing photographerName when present.

    const pollJob = (jobId, onUpdate) => {
      let stopped = false;
      const poll = async () => {
        try {
          const resp = await request(`/api/ai/news/jobs/${encodeURIComponent(jobId)}`, { method: 'GET' });
          if (onUpdate) onUpdate(resp);
          if (resp.status === 'succeeded' || resp.status === 'failed' || resp.status === 'cancelled') {
            stopped = true;
            return resp;
          }
        } catch (e) {
          console.error('[AiNewsWriter] poll job failed', e);
        }
        if (!stopped) setTimeout(poll, 2500);
      };
      // start
      poll();
      return () => { stopped = true; };
    };

    const handleGenerate = async (prompt) => {
      setIsGenerating(true);
      try {
        const payload = {};
        if (prompt) payload.fullPrompt = prompt;
        else payload.form = formValues;
        if (referenceArticle) payload.referenceArticle = referenceArticle;
        if (interviewText) payload.interviewText = interviewText;
        if (selectedPhotos && selectedPhotos.length) {
          // Per backend request: only send a single thumbnail field (thumbUrl) and projectTitle
          payload.selectedPhotos = selectedPhotos.map((p, idx) => ({
            id: p.id || p.url || `transfer-${idx}`,
            // use a single canonical thumbnail field
            thumbUrl: p.thumbUrl || p.thumbSrc || p.thumb || (p.url || null),
            // metadata
            description: p.description || '',
            tags: Array.isArray(p.tags) ? p.tags : (p.tagList || []),
            projectTitle: p.projectTitle || '',
            // photographer id required by backend
            photographerId: p.photographerId || p.photographer_id || p.photographer || null,
          }));
          // clientPhotoMap should map id -> thumbnail url
          payload.clientPhotoMap = (selectedPhotos || []).reduce((acc, p, idx) => {
            const id = String(p.id || p.url || `transfer-${idx}`);
            const thumb = p.thumbUrl || p.thumbSrc || p.thumb || p.url || null;
            if (thumb) acc[id] = thumb;
            return acc;
          }, {});
        }
        // default async
        const resp = await request('/api/ai/news/generate', { method: 'POST', data: payload });
        // resp may be { jobId } or { status, result }
        if (resp.jobId && resp.status !== 'succeeded') {
          const jobId = resp.jobId;
          Toast.info('生成已提交，正在处理中');
          // poll until succeeded
          await new Promise((resolve) => {
            const stop = pollJob(jobId, async (update) => {
              if (update.status === 'succeeded') {
                stop();
                resolve(update);
              }
              if (update.status === 'failed') {
                stop();
                resolve(update);
              }
            });
          }).then(async (final) => {
            if (!final) return;
              if (final.status === 'succeeded' && final.result) {
              let processed = await replacePhotoPlaceholders(final.result);
              if (processed.markdown) {
                const injected = injectPhotoUrls(processed.markdown, processed.photos || selectedPhotos);
                // Cleanup AI output to remove BOM/ZWSP and normalize headings before putting into textarea
                const cleaned = normalizeMarkdownForRendering(fixNestedMarkdownImages(injected));
                setMarkdownText(cleaned);
              }
              if (processed.html) setGeneratedHtml(processed.html);
              setTitle(processed.title || formValues.eventName || '');
              setSubtitle(processed.subtitle || '');
              Toast.success('生成完成');
            } else {
              Toast.error('生成失败，请重试');
            }
          });
        } else if (resp.status === 'succeeded' && resp.result) {
          let processed = await replacePhotoPlaceholders(resp.result);
          if (processed.markdown) {
            const injected = injectPhotoUrls(processed.markdown, processed.photos || selectedPhotos);
            const cleaned = normalizeMarkdownForRendering(fixNestedMarkdownImages(injected));
            setMarkdownText(cleaned);
          }
          if (processed.html) setGeneratedHtml(processed.html);
          setTitle(processed.title || formValues.eventName || '');
          setSubtitle(processed.subtitle || '');
          Toast.success('生成完成（同步返回）');
        } else {
          // unexpected shape
          Toast.error('生成接口返回格式异常');
        }
      } catch (e) {
        console.error('[AiNewsWriter] generate failed', e);
        Toast.error('生成请求失败');
      } finally {
        setIsGenerating(false);
      }
    };

  const copyMarkdown = async () => {
    try {
      await navigator.clipboard.writeText(markdownText);
      Toast.success('已复制为 Markdown');
    } catch (e) {
      Toast.error('复制失败');
    }
  };

  const copyHtml = async () => {
    try {
      // prefer server-provided html when available
      const htmlToCopy = generatedHtml && generatedHtml.length ? generatedHtml : (markdownText.split('\n\n').map(p => `<p>${p.replace(/\n/g, '<br/>')}</p>`).join(''));
      await navigator.clipboard.writeText(htmlToCopy);
      Toast.success('已复制为 HTML');
    } catch (e) {
      Toast.error('复制失败');
    }
  };

  return (
    <Layout style={{ padding: 16 }}>
      <Header style={{ background: 'transparent', padding: 0, marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>AI 写稿助手</h2>
      </Header>

      <Content>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Selected photos panel */}
          <Card
            title={(
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <div>已选照片（来自中转站）</div>
                <div>
                  <Button size="small" onClick={() => {
                    try {
                      const items = getTransferAll() || [];
                      if (!items.length) { Toast.info('中转站为空或无可用照片'); return; }
                      const mapped = items.map((p, idx) => ({
                        id: p.id || p.url || `transfer-${idx}`,
                        thumbUrl: p.thumbUrl || p.thumbSrc || p.thumb || p.url || '',
                        url: p.thumbUrl || p.thumbSrc || p.url || '',
                        description: p.description || p.caption || '',
                        tags: p.tags || p.tagList || [],
                        projectTitle: p.projectTitle || p.source || '',
                        photographerId: p.photographerId || p.photographer_id || p.photographer || null,
                      }));
                      setSelectedPhotos(mapped);
                      Toast.success(`已从中转站填充 ${mapped.length} 张到已选照片`);
                    } catch (e) {
                      console.error('fill from transfer failed', e);
                      Toast.error('从中转站读取失败');
                    }
                  }}>从中转站填充</Button>
                </div>
              </div>
            )}
            bordered
          >
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              {selectedPhotos.map((p) => (
                <div key={p.id} style={{ width: 160, borderRadius: 6, overflow: 'hidden', position: 'relative', background: '#fafafa' }}>
                  <img src={p.url} alt={p.description} style={{ width: '100%', height: 90, objectFit: 'cover', display: 'block' }} />
                  <div style={{ padding: 8 }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{p.description}</div>
                    <div style={{ marginTop: 6, fontSize: 12, color: '#666' }}>
                      {p.photographerName ? `摄影：${p.photographerName}` : (p.photographerId ? `摄影师 #${p.photographerId}` : null)}
                    </div>
                    <div style={{ marginTop: 6, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {(p.tags || []).map((t) => <Tag key={t} size="small" type="light">{t}</Tag>)}
                    </div>
                  </div>
                  <button
                    onClick={() => removePhoto(p.id)}
                    aria-label="移除照片"
                    style={{ position: 'absolute', right: 6, top: 6, width: 22, height: 22, borderRadius: 11, background: 'rgba(0,0,0,0.6)', color: '#fff', border: 'none', cursor: 'pointer' }}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </Card>

          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            {/* Left: form + reference */}
            <div style={{ flex: '1 1 420px', minWidth: 320 }}>
              <Card title="活动信息 & 参考素材" bordered>
                <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div>
                    <div style={{ marginBottom: 6, fontSize: 12, color: '#444' }}>活动名称</div>
                    <Input value={formValues.eventName} onChange={(v) => setFormValues((s) => ({ ...s, eventName: v }))} placeholder="请输入活动名称" />
                  </div>

                  <div style={{ display: 'flex', gap: 12 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ marginBottom: 6, fontSize: 12, color: '#444' }}>活动日期</div>
                      <DatePicker value={formValues.eventDate} onChange={(v) => setFormValues((s) => ({ ...s, eventDate: v }))} style={{ width: '100%' }} placeholder="活动日期（必填）" />
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ marginBottom: 6, fontSize: 12, color: '#444' }}>活动地点</div>
                      <Input value={formValues.location} onChange={(v) => setFormValues((s) => ({ ...s, location: v }))} placeholder="活动地点（可选）" />
                    </div>
                  </div>

                  <div>
                    <div style={{ marginBottom: 6, fontSize: 12, color: '#444' }}>主办/承办单位</div>
                    <Input value={formValues.organizer} onChange={(v) => setFormValues((s) => ({ ...s, organizer: v }))} placeholder="主办/承办单位（可选）" />
                  </div>

                  <div>
                    <div style={{ marginBottom: 6, fontSize: 12, color: '#444' }}>出席嘉宾 / 参与对象</div>
                    <TextArea value={formValues.participants} onChange={(v) => setFormValues((s) => ({ ...s, participants: v }))} rows={3} placeholder="出席嘉宾 / 参与对象（可选）" />
                  </div>

                  <div>
                    <div style={{ marginBottom: 6, fontSize: 12, color: '#444' }}>活动亮点</div>
                    <TextArea value={formValues.highlights} onChange={(v) => setFormValues((s) => ({ ...s, highlights: v }))} rows={4} placeholder="活动亮点 / 希望重点表达的内容（必填）" />
                  </div>

                  {/* 稿件用途和文风偏好已隐藏，后端未就绪 */}

                  <div style={{ marginTop: 8 }}>
                    <Input
                      value={formValues.targetWords}
                      onChange={(v) => setFormValues((s) => ({ ...s, targetWords: v }))}
                      placeholder="目标字数（例如：500-800）"
                      style={{ width: 200 }}
                    />
                    <div style={{ fontSize: 12, color: '#666', marginTop: 6 }}>目标字数说明：AI 会尽量控制生成字数范围以满足你的发布需求。</div>
                  </div>
                </div>

                <div style={{ marginTop: 16 }}>
                  <h4 style={{ margin: '0 0 8px 0' }}>参考素材 - 文章内容（可粘贴整篇文章或要点）</h4>
                  <TextArea
                    value={referenceArticle}
                    onChange={(v) => setReferenceArticle((v || '').slice(0, REFERENCE_MAX))}
                    rows={8}
                    placeholder="在此粘贴参考文章的全文或要点，AI 会在生成时适当引用"
                  />
                  <div style={{ fontSize: 12, color: '#666', marginTop: 6 }}>{referenceArticle.length}/{REFERENCE_MAX} 字（上限 20000 字）</div>
                </div>

                  {/* 组织已有风格预设已隐藏，后端未就绪 */}

                  <div style={{ marginTop: 12 }}>
                    <h4 style={{ margin: '0 0 8px 0' }}>采访内容/原话（可选）</h4>
                    <TextArea value={interviewText} onChange={(v) => setInterviewText(v)} rows={4} placeholder="可以粘贴采访录音转写稿的文本，AI 会适当引用其中的内容" />
                  </div>

                  <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-start', gap: 8 }}>
                    <Button onClick={async () => {
                      // ask backend for assembled prompt preview, fallback to local assemble
                      try {
                        const payload = { form: formValues, referenceArticle, interviewText, selectedPhotos: (selectedPhotos||[]).map(p=>({id:p.id,description:p.description,tags:p.tags})) };
                        const resp = await request('/api/ai/news/preview', { method: 'POST', data: payload });
                        if (resp && resp.assembledPrompt) setAdvancedPrompt(resp.assembledPrompt);
                        else setAdvancedPrompt(assemblePrompt());
                      } catch (e) {
                        // fallback to local assembly
                        setAdvancedPrompt(assemblePrompt());
                      }
                      setShowAdvancedEditor(true);
                    }}>高级编辑</Button>
                    <Button type="primary" onClick={() => handleGenerate()} loading={isGenerating}>生成初稿</Button>
                  </div>
              </Card>
            </div>

            <Modal
              title="高级编辑 Prompt"
              visible={showAdvancedEditor}
              onCancel={() => setShowAdvancedEditor(false)}
              onOk={() => {
                // 在弹窗中应用当前 advancedPrompt 并生成
                setShowAdvancedEditor(false);
                handleGenerate(advancedPrompt);
              }}
              okText="应用并生成"
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ fontSize: 12, color: '#666' }}>下面是基于当前表单自动拼出的 prompt，你可以自由编辑，然后点击「应用并生成」。</div>
                <TextArea value={advancedPrompt} onChange={(v) => setAdvancedPrompt((v || '').slice(0, REFERENCE_MAX))} rows={14} />
                <div style={{ fontSize: 12, color: '#666' }}>{advancedPrompt.length}/{REFERENCE_MAX} 字</div>
              </div>
            </Modal>

            {/* Right: editor */}
            <div style={{ flex: '1 1 600px', minWidth: 360 }}>
              <Card title="AI 生成结果编辑区" bordered>
                {/* 标题、副标题改为不在编辑区单独输入，保持单一 Markdown 编辑区 */}

                {/* 说明文本已移除：后端插入图片占位符的说明不再显示 */}

                <Tabs defaultActiveKey="editor">
                  <Tabs.TabPane itemKey="editor" tab="Markdown 编辑">
                    <TextArea value={markdownText} onChange={(v) => setMarkdownText(v)} rows={14} placeholder="生成内容将在这里显示" />
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
                      <div>当前字数：{countVisibleChars(markdownText)}</div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <Button onClick={copyMarkdown}>复制为 Markdown</Button>
                        <Button onClick={copyHtml}>复制为 HTML</Button>
                      </div>
                    </div>
                  </Tabs.TabPane>
                  <Tabs.TabPane itemKey="preview" tab="预览">
                    <div style={{ border: '1px solid #eee', padding: 12, borderRadius: 4, minHeight: 240 }}>
                      {markdownText ? (
                        // Prefer client-side Markdown in preview. Server-provided HTML can
                        // contain oddities that break the preview; use it only as fallback.
                        <div dangerouslySetInnerHTML={{ __html: sanitizeHtml(normalizePreviewHtml(fixImgSrcMarkdownInAttributes(renderMarkdownToHtml(injectPhotoUrls(fixNestedMarkdownImages(normalizeMarkdownForRendering(markdownText)), selectedPhotos)))) ) }} />
                      ) : (generatedHtml ? (
                        <div dangerouslySetInnerHTML={{ __html: sanitizeHtml(normalizePreviewHtml(fixImgSrcMarkdownInAttributes(generatedHtml))) }} />
                      ) : <div style={{ color: '#999' }}>暂无内容</div>)}
                    </div>
                  </Tabs.TabPane>
                </Tabs>

                {/* 编辑区底部的实验性功能按钮已移除 */}
              </Card>
            </div>
          </div>
        </div>
      </Content>
    </Layout>
  );
};

export default AiNewsWriter;
