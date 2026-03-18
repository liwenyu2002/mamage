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
import { getToken } from './services/authService';
import { marked } from 'marked';
import { toPng } from 'html-to-image';

const { Header, Content } = Layout;

// Mock photos
const mockPhotos = [
  { id: 1, url: 'https://via.placeholder.com/320x180?text=图1', description: '大会开幕式', tags: ['开幕', '大合照'] },
  { id: 2, url: 'https://via.placeholder.com/320x180?text=图2', description: '领导致辞', tags: ['致辞'] },
  { id: 3, url: 'https://via.placeholder.com/320x180?text=图3', description: '展台现场', tags: ['展台', '互动'] },
];

function toNameList(input) {
  if (!input) return [];
  const arr = Array.isArray(input) ? input : String(input).split(/[;,，、|]/);
  const out = [];
  arr.forEach((v) => {
    const s = String(v || '').trim();
    if (!s) return;
    if (out.includes(s)) return;
    out.push(s);
  });
  return out;
}

function extractFaceNames(photo) {
  const direct = toNameList(
    photo?.faceNames
    || photo?.personNames
    || photo?.personNameList
    || photo?.face_name_list
    || photo?.person_name_list
    || photo?.people
  );
  if (direct.length) return direct;
  const faces = Array.isArray(photo?.faces) ? photo.faces : [];
  const names = [];
  faces.forEach((f) => {
    const n = String((f && (f.personName || f.person_name || f.name || f.label)) || '').trim();
    if (!n) return;
    if (/^人脸#?\d+$/i.test(n) || /^face#?\d+$/i.test(n)) return;
    if (!names.includes(n)) names.push(n);
  });
  return names;
}

const AiNewsWriter = () => {
  const DRAFT_STORAGE_KEY = 'mamage.aiNewsWriter.draft.v1';
  const INITIAL_FORM_VALUES = {
    eventName: '',
    eventDate: null,
    location: '',
    organizer: '',
    participants: '',
    highlights: '',
    usage: '官网新闻',
    tone: '正式',
    targetWords: '500-800',
  };
  const skipNextAutoSaveRef = React.useRef(false);

  // state
  // 不要默认预填已选照片，用户从中转站或手动选择后再加入
  const [selectedPhotos, setSelectedPhotos] = React.useState([]);
  const [formValues, setFormValues] = React.useState(INITIAL_FORM_VALUES);
  const [referenceArticle, setReferenceArticle] = React.useState('');
  const [stylePreset, setStylePreset] = React.useState('默认风格');
  const [interviewText, setInterviewText] = React.useState('');

  const [title, setTitle] = React.useState('');
  const [subtitle, setSubtitle] = React.useState('');
  const [markdownText, setMarkdownText] = React.useState('');
  const [generatedHtml, setGeneratedHtml] = React.useState('');
  const [isGenerating, setIsGenerating] = React.useState(false);
  const [generationProgress, setGenerationProgress] = React.useState(0);
  const generationProgressTimerRef = React.useRef(null);
  const generationRunIdRef = React.useRef(0);
  const generationRunningRef = React.useRef(false);
  const REFERENCE_MAX = 20000;
  const [showAdvancedEditor, setShowAdvancedEditor] = React.useState(false);
  const [advancedPrompt, setAdvancedPrompt] = React.useState('');
  const [isMobile, setIsMobile] = React.useState(() => (typeof window !== 'undefined' ? window.innerWidth <= 768 : false));
  const previewContentRef = React.useRef(null);
  const [previewImageUrl, setPreviewImageUrl] = React.useState('');
  const [showPreviewImage, setShowPreviewImage] = React.useState(false);
  const [isGeneratingPreviewImage, setIsGeneratingPreviewImage] = React.useState(false);

  const updatePreviewImageUrl = React.useCallback((nextUrl) => {
    setPreviewImageUrl((prev) => {
      if (prev && prev !== nextUrl && /^blob:/i.test(String(prev))) {
        try { URL.revokeObjectURL(prev); } catch (e) { /* ignore */ }
      }
      return nextUrl;
    });
  }, []);

  React.useEffect(() => () => {
    if (previewImageUrl && /^blob:/i.test(String(previewImageUrl))) {
      try { URL.revokeObjectURL(previewImageUrl); } catch (e) { /* ignore */ }
    }
  }, [previewImageUrl]);

  const clearAllDraft = React.useCallback(() => {
    try {
      skipNextAutoSaveRef.current = true;
      window.localStorage.removeItem(DRAFT_STORAGE_KEY);
    } catch (e) {
      // ignore
    }

    setSelectedPhotos([]);
    setFormValues(INITIAL_FORM_VALUES);
    setReferenceArticle('');
    setInterviewText('');
    setStylePreset('默认风格');
    setTitle('');
    setSubtitle('');
    setMarkdownText('');
    setGeneratedHtml('');
    setAdvancedPrompt('');
    setShowAdvancedEditor(false);
    Toast.success('已清空本页缓存');
  }, [DRAFT_STORAGE_KEY, INITIAL_FORM_VALUES]);

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
    if (skipNextAutoSaveRef.current) {
      skipNextAutoSaveRef.current = false;
      try { window.localStorage.removeItem(DRAFT_STORAGE_KEY); } catch (e) { }
      return;
    }
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

  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onResize = () => setIsMobile(window.innerWidth <= 768);
    onResize();
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, []);

  React.useEffect(() => () => {
    if (generationProgressTimerRef.current) {
      cancelAnimationFrame(generationProgressTimerRef.current);
      generationProgressTimerRef.current = null;
    }
  }, []);

  const startPseudoProgress = React.useCallback(() => {
    generationRunIdRef.current += 1;
    const runId = generationRunIdRef.current;
    if (generationProgressTimerRef.current) {
      cancelAnimationFrame(generationProgressTimerRef.current);
      generationProgressTimerRef.current = null;
    }
    const startedAt = performance.now();
    const durationMs = 25000; // 25s 到 99%
    const phaseA = Math.random() * Math.PI * 2;
    const phaseB = Math.random() * Math.PI * 2;
    setGenerationProgress(2);

    const tick = (now) => {
      if (runId !== generationRunIdRef.current) return;
      const elapsed = now - startedAt;
      const t = Math.min(elapsed / durationMs, 1);
      // 基础曲线：非线性平滑推进
      const eased = 1 - Math.pow(1 - t, 2.25);
      // 轻微“随机”速度变化：两段不同频率正弦扰动（连续，不跳变）
      const wiggle = (
        0.015 * Math.sin((elapsed / 1000) * 1.25 + phaseA) +
        0.010 * Math.sin((elapsed / 1000) * 2.35 + phaseB)
      ) * (1 - t);
      const ratio = Math.max(0, Math.min(1, eased + wiggle));
      const target = 2 + ratio * 97; // 2 -> 99

      setGenerationProgress((prev) => Math.min(99, Math.max(prev, target)));
      if (t >= 1) {
        generationProgressTimerRef.current = null;
        return;
      }
      generationProgressTimerRef.current = requestAnimationFrame(tick);
    };

    generationProgressTimerRef.current = requestAnimationFrame(tick);
    return runId;
  }, []);

  const stopPseudoProgress = React.useCallback((done, runId) => {
    if (runId !== generationRunIdRef.current) return;
    if (generationProgressTimerRef.current) {
      cancelAnimationFrame(generationProgressTimerRef.current);
      generationProgressTimerRef.current = null;
    }
    if (done) {
      setGenerationProgress(100);
      setTimeout(() => {
        setGenerationProgress(0);
        setIsGenerating(false);
      }, 280);
      return;
    }
    setGenerationProgress(0);
    setIsGenerating(false);
  }, []);


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
        const faceNames = extractFaceNames(p);
        const facePart = faceNames.length ? ` 人物：${faceNames.join('、')}` : '';
        parts.push(`  图${i + 1}：${p.description || ''} ${(p.tags || []).join(', ')}${facePart}`);
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
        img.style.maxWidth = isMobile ? '92%' : '70%';
        img.style.width = 'auto';
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
        if (!p.style.fontSize) p.style.fontSize = isMobile ? '17px' : '19px';
        if (!p.style.lineHeight) p.style.lineHeight = '1.9';
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
      const fallbackMap = Object.fromEntries((selectedPhotos || []).map((p) => [String(p.id), p]));
      const placeholder = (typeof resolveAssetUrl === 'function') ? resolveAssetUrl('/static/img/placeholder.png') : '/static/img/placeholder.png';
      return String(markdown).replace(/!\[([^\]]*?)\]\(PHOTO:([^\)]+)\)/g, (m, alt, id) => {
        const pid = String(id);
        const ph = {
          ...(fallbackMap[pid] || {}),
          ...(map[pid] || {}),
        };
        const cand = ph && (ph.url || ph.thumbUrl || ph.thumbSrc || ph.thumb || ph.src);
        let finalAlt = String(alt || '').trim();
        const names = extractFaceNames(ph);
        if (names.length) {
          const joined = names.slice(0, 2).join('、');
          if (!finalAlt) finalAlt = `${joined}在活动现场`;
          else if (!names.some((n) => finalAlt.includes(String(n)))) finalAlt = `${joined}：${finalAlt}`;
        }
        // Prefer backend-provided photographerName. If missing, fall back to photographerId.
        const name = ph && (ph.photographerName || ph.photographer_name || null);
        const fallbackId = ph && (ph.photographerId || ph.photographer_id || ph.photographer || null);
        const displayName = name ? name : (fallbackId ? `摄影师 #${fallbackId}` : '未知摄影师');
        const imgMd = (cand && cand.length) ? `![${finalAlt}](${cand})` : `![${finalAlt || '图片'}](${placeholder})`;
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
    if (generationRunningRef.current) return;
    generationRunningRef.current = true;
    setIsGenerating(true);
    const runId = startPseudoProgress();
    let succeed = false;
    try {
      const payload = {};
      if (prompt) payload.fullPrompt = prompt;
      else payload.form = formValues;
      if (referenceArticle) payload.referenceArticle = referenceArticle;
      if (interviewText) payload.interviewText = interviewText;
      if (selectedPhotos && selectedPhotos.length) {
        // Per backend request: only send a single thumbnail field (thumbUrl) and projectTitle
        payload.selectedPhotos = selectedPhotos.map((p, idx) => ({
          // core id/url
          id: p.id || p.url || `transfer-${idx}`,
          // use a single canonical thumbnail field
          thumbUrl: p.thumbUrl || p.thumbSrc || p.thumb || (p.url || null),
          // metadata
          description: p.description || '',
          tags: Array.isArray(p.tags) ? p.tags : (p.tagList || []),
          projectTitle: p.projectTitle || '',
          faceNames: extractFaceNames(p),
          personNames: extractFaceNames(p),
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
            succeed = true;
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
        succeed = true;
        Toast.success('生成完成（同步返回）');
      } else {
        // unexpected shape
        Toast.error('生成接口返回格式异常');
      }
    } catch (e) {
      console.error('[AiNewsWriter] generate failed', e);
      Toast.error('生成请求失败');
    } finally {
      stopPseudoProgress(succeed, runId);
      generationRunningRef.current = false;
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

  const getFinalPreviewHtml = () => {
    if (markdownText) {
      return sanitizeHtml(
        normalizePreviewHtml(
          fixImgSrcMarkdownInAttributes(
            renderMarkdownToHtml(
              injectPhotoUrls(
                fixNestedMarkdownImages(normalizeMarkdownForRendering(markdownText)),
                selectedPhotos
              )
            )
          )
        )
      );
    }
    if (generatedHtml) return sanitizeHtml(normalizePreviewHtml(fixImgSrcMarkdownInAttributes(generatedHtml)));
    return '';
  };

  const escapeSvgText = (input) => String(input || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  const blobToDataUrl = (blob) => new Promise((resolve, reject) => {
    try {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    } catch (e) {
      reject(e);
    }
  });

  const buildExportPlaceholder = (altText) => (
    `data:image/svg+xml;utf8,${encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360">
        <rect width="100%" height="100%" fill="#f1f5f9"/>
        <text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="#64748b" font-size="20">
          ${escapeSvgText(altText || '图片')}
        </text>
      </svg>`
    )}`
  );

  const inlineCrossOriginImagesForExport = async (root) => {
    const imgs = Array.from((root && root.querySelectorAll) ? root.querySelectorAll('img') : []);
    let inlinedCount = 0;
    let unresolvedCount = 0;
    for (const img of imgs) {
      const rawSrc = String(img.getAttribute('src') || '').trim();
      if (!rawSrc) continue;
      if (/^data:/i.test(rawSrc)) continue;
      if (/^blob:/i.test(rawSrc)) {
        img.removeAttribute('srcset');
        img.removeAttribute('data-export-unresolved');
        inlinedCount += 1;
        continue;
      }

      let targetUrl = null;
      try {
        targetUrl = new URL(rawSrc, window.location.href);
      } catch (e) {
        continue;
      }
      if (!targetUrl) continue;
      if (targetUrl.origin === window.location.origin) {
        img.removeAttribute('srcset');
        img.removeAttribute('data-export-unresolved');
        inlinedCount += 1;
        continue;
      }

      try {
        let resp = await fetch(targetUrl.toString(), { method: 'GET', mode: 'cors', credentials: 'include' });
        if (!resp.ok) {
          resp = await fetch(targetUrl.toString(), { method: 'GET', mode: 'cors', credentials: 'omit' });
        }
        if (!resp.ok) throw new Error(`fetch ${resp.status}`);
        const blob = await resp.blob();
        const dataUrl = await blobToDataUrl(blob);
        if (!dataUrl) throw new Error('empty dataUrl');
        img.setAttribute('src', dataUrl);
        img.removeAttribute('srcset');
        img.removeAttribute('data-export-unresolved');
        inlinedCount += 1;
      } catch (e) {
        unresolvedCount += 1;
        img.setAttribute('data-export-unresolved', '1');
        img.removeAttribute('srcset');
      }
    }
    return { inlinedCount, unresolvedCount };
  };

  const replaceUnresolvedImagesWithPlaceholdersForExport = (root) => {
    const imgs = Array.from((root && root.querySelectorAll) ? root.querySelectorAll('img[data-export-unresolved="1"]') : []);
    imgs.forEach((img) => {
      img.setAttribute('src', buildExportPlaceholder(img.getAttribute('alt') || '图片'));
      img.removeAttribute('srcset');
      img.removeAttribute('data-export-unresolved');
    });
    return imgs.length;
  };

  const replaceAllImagesWithPlaceholdersForExport = (root) => {
    const imgs = Array.from((root && root.querySelectorAll) ? root.querySelectorAll('img') : []);
    imgs.forEach((img) => {
      img.setAttribute('src', buildExportPlaceholder(img.getAttribute('alt') || '图片'));
      img.removeAttribute('srcset');
    });
    return imgs.length;
  };

  const exportWrapperToDataUrl = async (wrapper, width, height) => {
    const scale = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
    return toPng(wrapper, {
      cacheBust: true,
      pixelRatio: scale,
      backgroundColor: '#ffffff',
      width,
      height,
      imagePlaceholder: buildExportPlaceholder('图片'),
      fetchRequestInit: {
        method: 'GET',
        mode: 'cors',
        credentials: 'include',
      },
    });
  };

  const renderPreviewImageByServer = async ({ html, width, height }) => {
    const token = typeof getToken === 'function' ? getToken() : '';
    const resp = await fetch('/api/ai/news/render-preview', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        html: String(html || ''),
        width,
        height,
        baseHref: (typeof window !== 'undefined' && window.location && window.location.origin)
          ? `${window.location.origin}/`
          : '',
      }),
    });

    if (!resp.ok) {
      const contentType = String(resp.headers.get('content-type') || '');
      let msg = `server render failed (${resp.status})`;
      try {
        if (contentType.includes('application/json')) {
          const data = await resp.json();
          msg = String(data?.message || data?.error || msg);
        } else {
          const text = await resp.text();
          if (text) msg = text.slice(0, 300);
        }
      } catch (e) {
        // ignore parse error
      }
      throw new Error(msg);
    }

    const blob = await resp.blob();
    if (!blob || !blob.size) {
      throw new Error('server render empty image');
    }
    return URL.createObjectURL(blob);
  };

  const generatePreviewImage = async () => {
    const node = previewContentRef.current;
    if (!node) {
      Toast.warning('暂无可导出的预览内容');
      return;
    }

    setIsGeneratingPreviewImage(true);
    try {
      const width = Math.max(720, Math.ceil(node.scrollWidth));
      const height = Math.max(420, Math.ceil(node.scrollHeight));
      const serverHtml = finalPreviewHtml || node.innerHTML || '';
      if (serverHtml) {
        try {
          const serverBlobUrl = await renderPreviewImageByServer({ html: serverHtml, width, height });
          updatePreviewImageUrl(serverBlobUrl);
          setShowPreviewImage(true);
          Toast.success('预览图已生成');
          return;
        } catch (serverErr) {
          console.warn('[AiNewsWriter] server preview render failed, fallback to client', serverErr);
          Toast.warning('后端截图不可用，已回退浏览器导出');
        }
      }

      const clone = node.cloneNode(true);
      const wrapper = document.createElement('div');
      wrapper.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
      wrapper.style.width = `${width}px`;
      wrapper.style.minHeight = `${height}px`;
      wrapper.style.padding = '20px 24px';
      wrapper.style.boxSizing = 'border-box';
      wrapper.style.background = '#fff';
      wrapper.style.color = '#111827';
      wrapper.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft Yahei", sans-serif';
      wrapper.appendChild(clone);
      const mount = document.createElement('div');
      mount.style.position = 'fixed';
      mount.style.left = '-99999px';
      mount.style.top = '0';
      mount.style.width = `${width}px`;
      mount.style.height = `${height}px`;
      mount.style.overflow = 'hidden';
      mount.style.opacity = '0';
      mount.style.pointerEvents = 'none';
      mount.style.zIndex = '-1';
      mount.appendChild(wrapper);
      document.body.appendChild(mount);
      const imgFixResult = await inlineCrossOriginImagesForExport(wrapper);
      let fallbackPlaceholderCount = 0;
      let fullFallbackPlaceholderCount = 0;
      let dataUrl = '';
      try {
        dataUrl = await exportWrapperToDataUrl(wrapper, width, height);
      } catch (firstErr) {
        let nextErr = firstErr;
        fallbackPlaceholderCount = replaceUnresolvedImagesWithPlaceholdersForExport(wrapper);
        if (fallbackPlaceholderCount > 0) {
          try {
            dataUrl = await exportWrapperToDataUrl(wrapper, width, height);
          } catch (secondErr) {
            nextErr = secondErr;
          }
        }
        if (!dataUrl) {
          const msg = String((nextErr && (nextErr.message || nextErr.name)) || '');
          const isSecurityError = (nextErr && nextErr.name === 'SecurityError') || /tainted canvas/i.test(msg);
          if (!isSecurityError && fallbackPlaceholderCount <= 0) throw nextErr;
          fullFallbackPlaceholderCount = replaceAllImagesWithPlaceholdersForExport(wrapper);
          dataUrl = await exportWrapperToDataUrl(wrapper, width, height);
        }
      } finally {
        if (mount && mount.parentNode) {
          mount.parentNode.removeChild(mount);
        }
      }

      updatePreviewImageUrl(dataUrl);
      setShowPreviewImage(true);
      if (imgFixResult && imgFixResult.unresolvedCount > 0 && fallbackPlaceholderCount > 0) {
        Toast.warning(`已替换 ${fallbackPlaceholderCount} 张跨域图片占位后导出`);
      }
      if (fullFallbackPlaceholderCount > 0) {
        Toast.warning(`浏览器限制已触发，已用 ${fullFallbackPlaceholderCount} 张占位图重试导出`);
      }
      Toast.success('预览图已生成');
    } catch (e) {
      console.error('[AiNewsWriter] generate preview image failed', e);
      Toast.error('生成预览图失败，请稍后重试');
    } finally {
      setIsGeneratingPreviewImage(false);
    }
  };

  const downloadPreviewImage = () => {
    if (!previewImageUrl) return;
    const link = document.createElement('a');
    link.href = previewImageUrl;
    link.download = `ai-news-preview-${Date.now()}.png`;
    link.click();
  };

  const finalPreviewHtml = getFinalPreviewHtml();

  return (
    <Layout style={{ padding: isMobile ? 10 : 16, overflowX: 'hidden' }}>
      <Header style={{ background: 'transparent', padding: 0, marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: isMobile ? 'flex-start' : 'center', justifyContent: 'space-between', gap: 12, flexWrap: isMobile ? 'wrap' : 'nowrap' }}>
          <h2 style={{ margin: 0 }}>AI 写稿助手</h2>
          <Button type="danger" theme="borderless" size="small" onClick={clearAllDraft}>
            清空缓存
          </Button>
        </div>
      </Header>

      <Content>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Selected photos panel */}
          <Card
            title={(
              <div style={{ display: 'flex', alignItems: isMobile ? 'flex-start' : 'center', justifyContent: 'space-between', gap: 12, flexWrap: isMobile ? 'wrap' : 'nowrap' }}>
                <div>已选照片（来自中转站）</div>
                <div>
                  <Button size="small" onClick={() => {
                    try {
                      const items = getTransferAll() || [];
                      if (!items.length) { Toast.info('中转站为空或无可用照片'); return; }
                      const mapped = items.map((p, idx) => {
                        const faceNames = extractFaceNames(p);
                        return {
                          id: p.id || p.url || `transfer-${idx}`,
                          thumbUrl: p.thumbUrl || p.thumbSrc || p.thumb || p.url || '',
                          url: p.thumbUrl || p.thumbSrc || p.url || '',
                          description: p.description || p.caption || '',
                          tags: p.tags || p.tagList || [],
                          projectTitle: p.projectTitle || p.source || '',
                          photographerId: p.photographerId || p.photographer_id || p.photographer || null,
                          faceNames,
                          personNames: faceNames,
                        };
                      });
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
            <div
              style={isMobile
                ? {
                  display: 'flex',
                  gap: 10,
                  flexWrap: 'nowrap',
                  overflowX: 'auto',
                  overflowY: 'hidden',
                  WebkitOverflowScrolling: 'touch',
                  paddingBottom: 4,
                }
                : {
                  display: 'flex',
                  gap: 12,
                  flexWrap: 'wrap',
                }}
            >
              {selectedPhotos.map((p) => (
                <div
                  key={p.id}
                  style={isMobile
                    ? {
                      width: 'calc(50vw - 20px)',
                      minWidth: 130,
                      maxWidth: 200,
                      flex: '0 0 auto',
                      borderRadius: 6,
                      overflow: 'hidden',
                      position: 'relative',
                      background: '#fafafa',
                    }
                    : {
                      width: 160,
                      borderRadius: 6,
                      overflow: 'hidden',
                      position: 'relative',
                      background: '#fafafa',
                    }}
                >
                  <img src={p.url} alt={p.description} style={{ width: '100%', height: 90, objectFit: 'cover', display: 'block' }} />
                  <div style={{ padding: 8 }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{p.description}</div>
                    <div style={{ marginTop: 6, fontSize: 12, color: '#666' }}>
                      {p.photographerName ? `摄影：${p.photographerName}` : (p.photographerId ? `摄影师 #${p.photographerId}` : null)}
                    </div>
                    {extractFaceNames(p).length > 0 ? (
                      <div style={{ marginTop: 6, fontSize: 12, color: '#334155' }}>
                        人物：{extractFaceNames(p).join('、')}
                      </div>
                    ) : null}
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

          <div style={{ display: 'flex', gap: isMobile ? 10 : 12, alignItems: 'flex-start', flexWrap: 'wrap', flexDirection: isMobile ? 'column' : 'row' }}>
            {/* Left: form + reference */}
            <div style={{ flex: isMobile ? '1 1 auto' : '1 1 420px', minWidth: isMobile ? 0 : 320, width: '100%' }}>
              <Card title="活动信息 & 参考素材" bordered>
                <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div>
                    <div style={{ marginBottom: 6, fontSize: 12, color: '#444' }}>活动名称</div>
                    <Input value={formValues.eventName} onChange={(v) => setFormValues((s) => ({ ...s, eventName: v }))} placeholder="请输入活动名称" />
                  </div>

                  <div style={{ display: 'flex', gap: 12, flexDirection: isMobile ? 'column' : 'row' }}>
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
                      style={{ width: isMobile ? '100%' : 200 }}
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

                <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'flex-start', gap: 8, flexWrap: isMobile ? 'wrap' : 'nowrap' }}>
                    <Button onClick={async () => {
                      // ask backend for assembled prompt preview, fallback to local assemble
                      try {
                        const payload = {
                          form: formValues,
                          referenceArticle,
                          interviewText,
                          selectedPhotos: (selectedPhotos || []).map((p) => ({
                            id: p.id,
                            description: p.description,
                            tags: p.tags,
                            faceNames: extractFaceNames(p),
                            personNames: extractFaceNames(p),
                          })),
                        };
                        const resp = await request('/api/ai/news/preview', { method: 'POST', data: payload });
                        if (resp && resp.assembledPrompt) setAdvancedPrompt(resp.assembledPrompt);
                        else setAdvancedPrompt(assemblePrompt());
                      } catch (e) {
                        // fallback to local assembly
                        setAdvancedPrompt(assemblePrompt());
                      }
                      setShowAdvancedEditor(true);
                    }}>高级编辑</Button>
                    <Button type="primary" onClick={() => handleGenerate()} disabled={isGenerating}>
                      {isGenerating ? `生成中 ${Math.max(1, Math.min(99, Math.round(generationProgress)))}%` : '生成初稿'}
                    </Button>
                  </div>
                  {isGenerating && (
                    <div style={{ width: isMobile ? '100%' : 320, maxWidth: '100%', height: 8, overflow: 'hidden' }}>
                      <div style={{ width: '100%', height: 8, borderRadius: 999, background: '#e5e7eb', overflow: 'hidden' }}>
                        <div
                          style={{
                              width: '100%',
                            height: '100%',
                            borderRadius: 999,
                            background: 'linear-gradient(90deg, #2563eb, #3b82f6)',
                            transformOrigin: 'left center',
                            transform: `scaleX(${Math.max(0.02, Math.min(0.99, generationProgress / 100))})`,
                            transition: 'transform 180ms linear',
                            willChange: 'transform',
                          }}
                        />
                      </div>
                        <div style={{ marginTop: 6, fontSize: 12, color: '#64748b' }}>约 25 秒到 99%，随后等待完成</div>
                    </div>
                  )}
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

            <Modal
              title="预览图"
              visible={showPreviewImage}
              footer={null}
              width={isMobile ? '96vw' : 920}
              onCancel={() => setShowPreviewImage(false)}
            >
              <div style={{ maxHeight: isMobile ? '68vh' : '72vh', overflow: 'auto', background: '#f8fafc', borderRadius: 8, padding: 10 }}>
                {previewImageUrl ? (
                  <img
                    src={previewImageUrl}
                    alt="preview"
                    style={{ width: '100%', height: 'auto', display: 'block', borderRadius: 6, background: '#fff' }}
                  />
                ) : (
                  <div style={{ color: '#64748b' }}>No preview image</div>
                )}
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
                <Button onClick={downloadPreviewImage} disabled={!previewImageUrl}>下载图片</Button>
              </div>
            </Modal>

            {/* Right: editor */}
            <div style={{ flex: isMobile ? '1 1 auto' : '1 1 600px', minWidth: isMobile ? 0 : 360, width: '100%' }}>
              <Card title="AI 生成结果编辑区" bordered>
                {/* 标题、副标题改为不在编辑区单独输入，保持单一 Markdown 编辑区 */}

                {/* 说明文本已移除：后端插入图片占位符的说明不再显示 */}

                <Tabs defaultActiveKey="editor">
                  <Tabs.TabPane itemKey="editor" tab="Markdown 编辑">
                    <TextArea value={markdownText} onChange={(v) => setMarkdownText(v)} rows={14} placeholder="生成内容将在这里显示" />
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
                      <div>当前字数：{countVisibleChars(markdownText)}</div>
                      <div style={{ display: 'flex', gap: 8, flexWrap: isMobile ? 'wrap' : 'nowrap', justifyContent: isMobile ? 'flex-end' : 'flex-start' }}>
                        <Button onClick={copyMarkdown}>复制为 Markdown</Button>
                        <Button onClick={copyHtml}>复制为 HTML</Button>
                      </div>
                    </div>
                  </Tabs.TabPane>
                  <Tabs.TabPane itemKey="preview" tab="预览">
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
                      <Button
                        onClick={generatePreviewImage}
                        loading={isGeneratingPreviewImage}
                        disabled={!finalPreviewHtml}
                      >
                        生成预览图
                      </Button>
                    </div>
                    <div
                      ref={previewContentRef}
                      style={{
                        border: '1px solid #eee',
                        padding: isMobile ? 14 : 18,
                        borderRadius: 4,
                        minHeight: 240,
                        fontSize: isMobile ? 17 : 19,
                        lineHeight: 1.9,
                      }}
                    >
                      {finalPreviewHtml ? (
                        <div dangerouslySetInnerHTML={{ __html: finalPreviewHtml }} />
                      ) : (
                        <div style={{ color: '#999' }}>暂无内容</div>
                      )}
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
