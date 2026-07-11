import React from 'react';
import { Layout, Card, Input, TextArea, Modal, Select, DatePicker, Button, Tag, Tabs, List, Toast } from './ui';
import { getAll as getTransferAll } from './services/transferStore';
import { request, resolveAssetUrl } from './services/request';
import { getToken } from './services/authService';
import { CHANNELS, DEFAULT_CHANNEL_KEYS, startBatch, getBatch, retryJob } from './services/newsMatrixService';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { toPng } from 'html-to-image';
import WechatPreviewEditor from './wechat/WechatPreviewEditor';
import { copyWechatRichTextLegacy, downloadImagePack } from './wechat/wechatExport';
import { exportNewsDocx } from './utils/newsWordExport';

// 渠道状态中文标签（ai_jobs.status 取值集：pending/running/succeeded/failed/cancelled）
const CHANNEL_STATUS_LABEL = {
  pending: '排队中',
  running: '生成中',
  succeeded: '已完成',
  failed: '失败',
  cancelled: '已取消',
};

// 事实校验 issue.type 中文化（后端 lib/news_fact_check.js 的四类可比对项）
const FACT_ISSUE_TYPE_LABEL = {
  name: '人名',
  date: '日期',
  location: '地点',
  number: '数字',
};

function emptyChannelContent() {
  // factCheck 形状约定为 { issues: [{type,expect,found,snippet}], forbiddenHits: [{word,snippet}] }（后端未挂载前为 null）
  return { title: '', subtitle: '', markdownText: '', generatedHtml: '', extra: {}, photos: [], factCheck: null };
}

// 该渠道结果是否存在需要人工核对的事实/禁用词命中
function hasFactIssues(content) {
  const fc = content && content.factCheck;
  if (!fc) return false;
  const issues = Array.isArray(fc.issues) ? fc.issues : [];
  const hits = Array.isArray(fc.forbiddenHits) ? fc.forbiddenHits : (Array.isArray(fc.hits) ? fc.hits : []);
  return issues.length > 0 || hits.length > 0;
}

const { Header, Content } = Layout;

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

  // 矩阵生成：渠道多选 + 批次状态 + 逐渠道内容（原单份 title/subtitle/markdownText/generatedHtml
  // 拆成 keyed map，key 为 channel_key；下方所有引用点同步改为读写 channelContent[activeChannelKey]）
  const [selectedChannels, setSelectedChannels] = React.useState(DEFAULT_CHANNEL_KEYS);
  const [batchId, setBatchId] = React.useState(null);
  const [batchStatus, setBatchStatus] = React.useState('');
  const [channelJobs, setChannelJobs] = React.useState({}); // channelKey -> { jobId, status, error }
  const [channelContent, setChannelContent] = React.useState({}); // channelKey -> emptyChannelContent() 形状
  const [activeChannelKey, setActiveChannelKey] = React.useState(null);
  // 轮询期间避免同一 job 的成功结果被重复处理（占位符替换是异步的，重复跑会闪烁/重复请求）
  const processedJobIdsRef = React.useRef(new Set());

  const updateChannelContent = React.useCallback((channelKey, patch) => {
    if (!channelKey) return;
    setChannelContent((prev) => {
      const base = prev[channelKey] || emptyChannelContent();
      const next = typeof patch === 'function' ? patch(base) : { ...base, ...patch };
      return { ...prev, [channelKey]: next };
    });
  }, []);

  const activeContent = channelContent[activeChannelKey] || emptyChannelContent();
  const setActiveMarkdownText = React.useCallback((v) => {
    if (activeChannelKey) updateChannelContent(activeChannelKey, { markdownText: v });
  }, [activeChannelKey, updateChannelContent]);
  // 小红书 Tab 话题标签的输入框草稿（回车确认后写入 activeContent.extra.hashtags）
  const [hashtagDraft, setHashtagDraft] = React.useState('');

  // 智能预填：出席人物 chips（来自已选照片 faceNames 汇总去重 + 手输追加），提交时并入 form.participants
  const [participantChips, setParticipantChips] = React.useState([]);
  const [participantDraft, setParticipantDraft] = React.useState('');
  // 校验标红：某渠道被用户点「忽略」后折叠警示条，channelKey -> true
  const [collapsedWarnings, setCollapsedWarnings] = React.useState({});

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
    setSelectedChannels(DEFAULT_CHANNEL_KEYS);
    setBatchId(null);
    setBatchStatus('');
    setChannelJobs({});
    setChannelContent({});
    setActiveChannelKey(null);
    processedJobIdsRef.current = new Set();
    setAdvancedPrompt('');
    setShowAdvancedEditor(false);
    setParticipantChips([]);
    setParticipantDraft('');
    setCollapsedWarnings({});
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

      if (Array.isArray(draft.selectedChannels) && draft.selectedChannels.length) {
        setSelectedChannels(draft.selectedChannels);
      }
      if (draft.channelContent && typeof draft.channelContent === 'object') {
        setChannelContent(draft.channelContent);
        const keys = Object.keys(draft.channelContent);
        if (keys.length) setActiveChannelKey(draft.activeChannelKey && keys.includes(draft.activeChannelKey) ? draft.activeChannelKey : keys[0]);
      }

      if (Array.isArray(draft.selectedPhotos)) {
        setSelectedPhotos(draft.selectedPhotos);
      }
      if (Array.isArray(draft.participantChips)) {
        setParticipantChips(draft.participantChips);
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
          selectedChannels,
          channelContent,
          activeChannelKey,
          advancedPrompt,
          participantChips,
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
    selectedChannels,
    channelContent,
    activeChannelKey,
    advancedPrompt,
    participantChips,
  ]);

  // 已选照片的稳定签名：id 列表拼接，用于下面几个「智能预填」effect 的依赖项
  // （避免 selectedPhotos 数组引用变化但内容未变时反复重算/重设 state）
  const selectedPhotosSignature = React.useMemo(
    () => (selectedPhotos || []).map((p) => p.id).join(','),
    [selectedPhotos],
  );

  // 智能预填 1/3：已选照片 faceNames 汇总去重，合并进 participantChips（只增不减，
  // 用户手动删除的 chip 不会因为照片列表引用变化而复活，除非新照片带来同名人物）
  React.useEffect(() => {
    const names = [];
    (selectedPhotos || []).forEach((p) => {
      extractFaceNames(p).forEach((n) => { if (!names.includes(n)) names.push(n); });
    });
    if (!names.length) return;
    setParticipantChips((prev) => {
      const merged = [...prev];
      let changed = false;
      names.forEach((n) => { if (!merged.includes(n)) { merged.push(n); changed = true; } });
      return changed ? merged : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPhotosSignature]);

  // 智能预填 2/3：活动名称为空时，用已选照片里出现次数最多的 projectTitle 预填一次；
  // 用户已手输过就不再覆盖（setFormValues 内部读当次最新值判断，不用把 formValues 加进依赖）
  React.useEffect(() => {
    const photos = selectedPhotos || [];
    if (!photos.length) return;
    const counts = new Map();
    photos.forEach((p) => {
      const t = String(p.projectTitle || '').trim();
      if (!t) return;
      counts.set(t, (counts.get(t) || 0) + 1);
    });
    if (!counts.size) return;
    let best = '';
    let bestCount = 0;
    counts.forEach((c, t) => { if (c > bestCount) { bestCount = c; best = t; } });
    if (!best) return;
    setFormValues((s) => (s.eventName ? s : { ...s, eventName: best }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPhotosSignature]);

  // 智能预填 3/3：活动亮点为空时给出的建议文案 —— 取标签命中频次最高的 3 张照片的
  // description 拼接（纯前端字符串拼装，不调用任何模型），供用户点「采纳」一键填入
  const highlightSuggestion = React.useMemo(() => {
    const photos = selectedPhotos || [];
    if (!photos.length) return '';
    const tagFreq = new Map();
    photos.forEach((p) => {
      (Array.isArray(p.tags) ? p.tags : []).forEach((t) => {
        const k = String(t || '').trim();
        if (k) tagFreq.set(k, (tagFreq.get(k) || 0) + 1);
      });
    });
    if (!tagFreq.size) return '';
    const scored = photos
      .map((p) => {
        const score = (Array.isArray(p.tags) ? p.tags : [])
          .reduce((sum, t) => sum + (tagFreq.get(String(t || '').trim()) || 0), 0);
        return { p, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score);
    const descs = scored.slice(0, 3).map((x) => String(x.p.description || '').trim()).filter(Boolean);
    if (!descs.length) return '';
    return `现场亮点：${descs.join('；')}。`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPhotosSignature]);

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

  // 统一走 DOMPurify：手写清洗器曾被 iframe srcdoc / xlink:href 等向量旁路（审查实证复现过 XSS）
  const sanitizeHtml = (dirty) => {
    try {
      return DOMPurify.sanitize(String(dirty || ''), {
        FORBID_TAGS: ['style', 'form', 'input', 'iframe', 'object', 'embed'],
        FORBID_ATTR: ['style'],
      });
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

  // 组件卸载后停止一切轮询（否则任务不结束就永远轮询 + 卸载后 setState）
  const pollAliveRef = React.useRef(true);
  React.useEffect(() => () => { pollAliveRef.current = false; }, []);

  // 把单个渠道的生成结果（PHOTO:id 占位符）处理成可编辑 markdown，写入该渠道的 keyed state。
  // 每个渠道各跑一遍 replacePhotoPlaceholders/injectPhotoUrls/normalizeMarkdownForRendering，互不干扰。
  const applyChannelResult = React.useCallback(async (channelKey, result) => {
    try {
      const processed = await replacePhotoPlaceholders({ ...result });
      let cleaned = '';
      if (processed.markdown) {
        const injected = injectPhotoUrls(processed.markdown, processed.photos || selectedPhotos);
        cleaned = normalizeMarkdownForRendering(fixNestedMarkdownImages(injected));
      }
      updateChannelContent(channelKey, {
        title: processed.title || formValues.eventName || '',
        subtitle: processed.subtitle || '',
        markdownText: cleaned,
        generatedHtml: processed.html || '',
        extra: processed.extra || {},
        photos: processed.photos || [],
        factCheck: processed.factCheck || null,
      });
      setActiveChannelKey((prev) => prev || channelKey);
      // 新结果落地：展开该渠道的校验警示条（若旧一轮曾被用户「忽略」过）
      setCollapsedWarnings((prev) => (prev[channelKey] ? { ...prev, [channelKey]: false } : prev));
    } catch (e) {
      console.error('[AiNewsWriter] apply channel result failed', channelKey, e);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPhotos, formValues.eventName, updateChannelContent]);

  // 汇总一次 batch 轮询响应：更新每渠道 job 状态，并对新完成的渠道跑一遍占位符处理。
  const applyBatchResponse = React.useCallback(async (resp) => {
    if (!resp) return;
    setBatchStatus(resp.status || '');
    const jobs = Array.isArray(resp.jobs) ? resp.jobs : [];
    setChannelJobs((prev) => {
      const next = { ...prev };
      jobs.forEach((job) => {
        next[job.channelKey] = { jobId: job.jobId, status: job.status, error: job.error || null };
      });
      return next;
    });
    for (const job of jobs) {
      if (job.status === 'succeeded' && job.result && !processedJobIdsRef.current.has(job.jobId)) {
        processedJobIdsRef.current.add(job.jobId);
        // eslint-disable-next-line no-await-in-loop
        await applyChannelResult(job.channelKey, job.result);
      }
    }
  }, [applyChannelResult]);

  // 轮询一个 batch 直到整体状态落定（succeeded/failed/partial 三种终态之一），2.5s 一次；
  // 组件卸载后 pollAliveRef 变 false 即停止，不再 setState。
  const pollBatchUntilDone = React.useCallback((id) => new Promise((resolve) => {
    let stopped = false;
    const tick = async () => {
      if (stopped || !pollAliveRef.current) { resolve(null); return; }
      try {
        const resp = await getBatch(id);
        await applyBatchResponse(resp);
        if (resp.status === 'succeeded' || resp.status === 'failed' || resp.status === 'partial') {
          stopped = true;
          resolve(resp);
          return;
        }
      } catch (e) {
        console.error('[AiNewsWriter] poll batch failed', e);
      }
      if (!stopped && pollAliveRef.current) setTimeout(tick, 2500);
    };
    tick();
  }), [applyBatchResponse]);

  const toggleChannel = React.useCallback((key) => {
    setSelectedChannels((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }, []);

  const handleGenerate = async () => {
    if (generationRunningRef.current) return;
    if (!selectedChannels.length) {
      Toast.warning('请至少选择一个生成渠道');
      return;
    }
    generationRunningRef.current = true;
    setIsGenerating(true);
    const runId = startPseudoProgress();
    let succeed = false;
    try {
      // 智能预填：出席人物 chips 只在提交时并入 form.participants，不回写到可见输入框，
      // 避免用户还在编辑时输入框被静默改写
      const mergedParticipantNames = toNameList(formValues.participants);
      participantChips.forEach((n) => { if (!mergedParticipantNames.includes(n)) mergedParticipantNames.push(n); });
      const payload = {
        form: { ...formValues, participants: mergedParticipantNames.join('、') },
        referenceArticle: referenceArticle || '',
        interviewText: interviewText || '',
        channels: selectedChannels,
      };
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
          // 摄影师署名：名字直接进 prompt，id 留作占位符元数据
          photographerId: p.photographerId || p.photographer_id || null,
          photographerName: p.photographerName || p.photographer_name || '',
        }));
      }

      const resp = await startBatch(payload);
      if (!resp || !resp.batchId) throw new Error('批次创建失败：响应缺少 batchId');

      // 新一轮生成：清空上一轮的渠道内容/状态，避免旧结果与新 Tab 混在一起
      processedJobIdsRef.current = new Set();
      setChannelContent({});
      setActiveChannelKey(null);
      setBatchId(resp.batchId);
      const initialJobs = {};
      (resp.jobs || []).forEach((j) => { initialJobs[j.channelKey] = { jobId: j.jobId, status: 'pending', error: null }; });
      setChannelJobs(initialJobs);
      setBatchStatus('pending');
      Toast.info('生成已提交，正在处理中');

      const final = await pollBatchUntilDone(resp.batchId);
      if (final && (final.status === 'succeeded' || final.status === 'partial')) {
        succeed = true;
        Toast.success(final.status === 'succeeded' ? '全部渠道生成完成' : '部分渠道生成完成，失败的可点击重试');
      } else if (final && final.status === 'failed') {
        Toast.error('生成失败，请检查各渠道状态或重试');
      }
    } catch (e) {
      console.error('[AiNewsWriter] generate failed', e);
      const reason = e && (e.message || (e.data && e.data.message)) ? String(e.message || e.data.message).slice(0, 140) : '';
      Toast.error(reason ? `生成请求失败：${reason}` : '生成请求失败');
    } finally {
      stopPseudoProgress(succeed, runId);
      generationRunningRef.current = false;
    }
  };

  // 单渠道失败重试：复用原 prompt 重新入队，然后恢复轮询直到该 batch 再次落定终态。
  const handleRetryChannel = React.useCallback(async (channelKey) => {
    const job = channelJobs[channelKey];
    if (!job || !job.jobId || !batchId) return;
    try {
      const resp = await retryJob(job.jobId);
      setChannelJobs((prev) => ({ ...prev, [channelKey]: { ...prev[channelKey], status: resp.status || 'pending', error: null } }));
      Toast.info('已重新提交，正在处理中');
      pollBatchUntilDone(batchId);
    } catch (e) {
      console.error('[AiNewsWriter] retry job failed', channelKey, e);
      const reason = e && (e.message || (e.data && e.data.message)) ? String(e.message || e.data.message).slice(0, 140) : '';
      Toast.error(reason ? `重试失败：${reason}` : '重试失败');
    }
  }, [channelJobs, batchId, pollBatchUntilDone]);

  // 以下导出/预览函数均只作用于当前激活的渠道 Tab（activeContent），下一位 agent 会在此基础上做渠道特定导出
  const copyMarkdown = async () => {
    try {
      await navigator.clipboard.writeText(activeContent.markdownText);
      Toast.success('已复制为 Markdown');
    } catch (e) {
      Toast.error('复制失败');
    }
  };

  const copyHtml = async () => {
    try {
      // prefer server-provided html when available
      const { markdownText, generatedHtml } = activeContent;
      const htmlToCopy = generatedHtml && generatedHtml.length ? generatedHtml : (markdownText.split('\n\n').map(p => `<p>${p.replace(/\n/g, '<br/>')}</p>`).join(''));
      await navigator.clipboard.writeText(htmlToCopy);
      Toast.success('已复制为 HTML');
    } catch (e) {
      Toast.error('复制失败');
    }
  };

  // ---- 渠道导出接线：以下均只作用于当前激活渠道（activeContent），公用工具函数放这里 ----

  // 摄影师署名整行：selectedPhotos 里 photographerName 去重拼接，press_release/report_brief 的 Word 导出用
  const photographerLine = React.useMemo(() => {
    const names = [];
    (selectedPhotos || []).forEach((p) => {
      const n = String(p.photographerName || p.photographer_name || '').trim();
      if (n && !names.includes(n)) names.push(n);
    });
    return names.length ? `摄影：${names.join('、')}` : '';
  }, [selectedPhotos]);

  // 图片 id -> 可访问 URL 映射：优先用 activeContent.photos（后端结果自带），
  // 兜底用 selectedPhotos 的缩略图（覆盖 markdown 里已被 injectPhotoUrls 替换、不再含 PHOTO:id 的常见情况）
  const buildPhotosMapForContent = React.useCallback((content) => {
    const map = {};
    (selectedPhotos || []).forEach((p) => {
      const cand = p.thumbUrl || p.thumbSrc || p.thumb || p.url;
      if (p.id != null && cand) map[String(p.id)] = cand;
    });
    (content?.photos || []).forEach((p) => {
      if (p && p.id != null && p.url) map[String(p.id)] = p.url;
    });
    return map;
  }, [selectedPhotos]);

  // 导出用图片列表 [{id,url}]：优先用后端结果里的 photos，没有则退回已选照片
  const getPhotosForExport = React.useCallback((content) => {
    const list = (content?.photos && content.photos.length) ? content.photos : (selectedPhotos || []);
    return list
      .map((p) => ({ id: p.id, url: p.url || p.thumbUrl || p.thumbSrc || p.thumb }))
      .filter((p) => p.url);
  }, [selectedPhotos]);

  // markdown 纯文本化：去图片行/标题符号/加粗星号/列表短横，供小红书、微博的「复制正文」使用
  const markdownToPlainText = (md) => String(md || '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/^-\s+/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const hashtagsToText = (content) => (Array.isArray(content?.extra?.hashtags) ? content.extra.hashtags : [])
    .map((t) => `#${t}#`)
    .join(' ');

  const handleCopyWechatRich = async () => {
    try {
      const { imageCount } = await copyWechatRichTextLegacy({
        title: activeContent.title,
        markdown: activeContent.markdownText,
        photosMap: buildPhotosMapForContent(activeContent),
      });
      Toast.success(`已复制公众号格式（含 ${imageCount} 张图片），粘贴后公众号会自动转存图片；要更多排版样式请用「去排版器精修」`);
    } catch (e) {
      Toast.error(e && e.message ? e.message : '复制失败');
    }
  };

  const handleDownloadWechatImages = async () => {
    try {
      const n = await downloadImagePack({ photos: getPhotosForExport(activeContent), baseName: activeContent.title || '公众号图片' });
      Toast.success(`已下载 ${n} 张图片`);
    } catch (e) {
      Toast.error(e && e.message ? e.message : '下载失败');
    }
  };

  const handleExportWord = async () => {
    try {
      await exportNewsDocx({
        title: activeContent.title,
        subtitle: activeContent.subtitle,
        markdown: activeContent.markdownText,
        photosMap: buildPhotosMapForContent(activeContent),
        captions: {},
        photographerLine,
      });
      Toast.success('已导出 Word 文档');
    } catch (e) {
      Toast.error(e && e.message ? e.message : '导出 Word 失败');
    }
  };

  const handleCopyXhsTitle = async () => {
    try {
      await navigator.clipboard.writeText(activeContent.title || '');
      Toast.success('已复制标题');
    } catch (e) {
      Toast.error('复制失败');
    }
  };

  const handleCopyBodyWithHashtags = async () => {
    try {
      const body = markdownToPlainText(activeContent.markdownText);
      const tags = hashtagsToText(activeContent);
      await navigator.clipboard.writeText(tags ? `${body}\n\n${tags}` : body);
      Toast.success('已复制正文+话题');
    } catch (e) {
      Toast.error('复制失败');
    }
  };

  const handleSaveActiveImages = async () => {
    try {
      const n = await downloadImagePack({ photos: getPhotosForExport(activeContent), baseName: activeContent.title || '图片' });
      Toast.success(`已保存 ${n} 张图片`);
    } catch (e) {
      Toast.error(e && e.message ? e.message : '保存失败');
    }
  };

  const getFinalPreviewHtml = () => {
    const { markdownText, generatedHtml } = activeContent;
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
                          photographerId: p.photographerId || p.photographer_id || null,
                          photographerName: p.photographerName || p.photographer_name || '',
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
                    {/* 智能预填：已选照片人脸姓名汇总去重生成的可删除 chips，提交时并入 participants，不回写到上面的输入框 */}
                    <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                      {participantChips.length ? (
                        <span style={{ fontSize: 11, color: '#888' }}>识别自照片：</span>
                      ) : null}
                      {participantChips.map((name) => (
                        <Tag
                          key={name}
                          size="small"
                          type="light"
                          onClick={() => setParticipantChips((prev) => prev.filter((n) => n !== name))}
                        >
                          {name} ×
                        </Tag>
                      ))}
                      <Input
                        placeholder="手动添加出席人物，回车确认"
                        style={{ width: 160 }}
                        value={participantDraft}
                        onChange={setParticipantDraft}
                        onEnterPress={() => {
                          const n = participantDraft.trim();
                          if (!n) return;
                          setParticipantChips((prev) => (prev.includes(n) ? prev : [...prev, n]));
                          setParticipantDraft('');
                        }}
                      />
                    </div>
                  </div>

                  <div>
                    <div style={{ marginBottom: 6, fontSize: 12, color: '#444' }}>活动亮点</div>
                    <TextArea value={formValues.highlights} onChange={(v) => setFormValues((s) => ({ ...s, highlights: v }))} rows={4} placeholder="活动亮点 / 希望重点表达的内容（必填）" />
                    {/* 智能预填：亮点为空且能从照片标签拼出建议时才展示，纯前端字符串拼接，不调用模型 */}
                    {!formValues.highlights && highlightSuggestion ? (
                      <div style={{ marginTop: 6, display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12, color: '#666', background: 'rgba(0,0,0,0.03)', borderRadius: 6, padding: '6px 8px' }}>
                        <span style={{ flex: 1 }}>AI 建议：{highlightSuggestion}</span>
                        <Button size="small" onClick={() => setFormValues((s) => ({ ...s, highlights: highlightSuggestion }))}>采纳</Button>
                      </div>
                    ) : null}
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
                    rows={isMobile ? 5 : 8}
                    placeholder="在此粘贴参考文章的全文或要点，AI 会在生成时适当引用"
                  />
                  <div style={{ fontSize: 12, color: '#666', marginTop: 6 }}>{referenceArticle.length}/{REFERENCE_MAX} 字（上限 20000 字）</div>
                </div>

                {/* 组织已有风格预设已隐藏，后端未就绪 */}

                <div style={{ marginTop: 12 }}>
                  <h4 style={{ margin: '0 0 8px 0' }}>采访内容/原话（可选）</h4>
                  <TextArea value={interviewText} onChange={(v) => setInterviewText(v)} rows={4} placeholder="可以粘贴采访录音转写稿的文本，AI 会适当引用其中的内容" />
                </div>

                {/* 生成渠道多选：勾选态黑边+右上角勾角标，视觉语言参照 rescue-pick-thumb 但做成更小的胶囊卡片 */}
                <div style={{ marginTop: 16 }}>
                  <h4 style={{ margin: '0 0 8px 0' }}>生成渠道（可多选）</h4>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {CHANNELS.map((ch) => {
                      const picked = selectedChannels.includes(ch.key);
                      return (
                        <button
                          key={ch.key}
                          type="button"
                          title={ch.desc}
                          onClick={() => toggleChannel(ch.key)}
                          style={{
                            position: 'relative',
                            padding: '7px 14px',
                            borderRadius: 999,
                            border: `1.5px solid ${picked ? '#111' : 'rgba(0,0,0,0.16)'}`,
                            background: picked ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.5)',
                            color: picked ? '#111' : '#555',
                            fontSize: 12.5,
                            fontWeight: picked ? 700 : 500,
                            cursor: 'pointer',
                            lineHeight: 1.4,
                          }}
                        >
                          {ch.name}
                          {picked ? (
                            <span
                              aria-hidden
                              style={{
                                position: 'absolute',
                                top: -6,
                                right: -6,
                                width: 15,
                                height: 15,
                                borderRadius: '50%',
                                background: '#111',
                                color: '#fff',
                                fontSize: 9,
                                lineHeight: '15px',
                                textAlign: 'center',
                                border: '1px solid #fff',
                              }}
                            >
                              ✓
                            </span>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                  <div style={{ fontSize: 12, color: selectedChannels.length ? '#666' : '#dc2626', marginTop: 6 }}>
                    {selectedChannels.length ? `已选 ${selectedChannels.length} 个渠道，将并行生成` : '至少选择 1 个渠道才能生成'}
                  </div>
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
                    <Button type="primary" onClick={() => handleGenerate()} disabled={isGenerating || !selectedChannels.length}>
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
                  {Object.keys(channelJobs).length > 0 && (
                    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {CHANNELS.filter((ch) => channelJobs[ch.key]).map((ch) => {
                        const job = channelJobs[ch.key];
                        const label = CHANNEL_STATUS_LABEL[job.status] || job.status || '未知';
                        const isFailed = job.status === 'failed';
                        const isDone = job.status === 'succeeded';
                        return (
                          <div
                            key={ch.key}
                            style={{
                              display: 'flex',
                              flexDirection: 'column',
                              gap: 2,
                              padding: '7px 10px',
                              borderRadius: 8,
                              background: 'rgba(0,0,0,0.03)',
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <span style={{ fontSize: 13, fontWeight: 600 }}>{ch.name}</span>
                                <span
                                  style={{
                                    fontSize: 11.5,
                                    padding: '2px 8px',
                                    borderRadius: 999,
                                    background: isDone ? '#111' : isFailed ? 'rgba(220,38,38,0.12)' : 'rgba(0,0,0,0.08)',
                                    color: isDone ? '#fff' : isFailed ? '#b91c1c' : '#444',
                                    fontWeight: 700,
                                  }}
                                >
                                  {label}
                                </span>
                              </div>
                              {isFailed ? (
                                <Button size="small" type="danger" theme="borderless" onClick={() => handleRetryChannel(ch.key)}>重试</Button>
                              ) : null}
                            </div>
                            {isFailed && job.error ? (
                              <div style={{ fontSize: 11, color: '#b91c1c' }}>{String(job.error).slice(0, 140)}</div>
                            ) : null}
                          </div>
                        );
                      })}
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
                // 矩阵批次接口只吃结构化 form/channels，不支持直接注入整段 prompt；
                // 这里的编辑内容仅供预览核对，「应用并生成」等价于走一次正常的批次生成。
                setShowAdvancedEditor(false);
                handleGenerate();
              }}
              okText="应用并生成"
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ fontSize: 12, color: '#666' }}>下面是基于当前表单自动拼出的 prompt，你可以自由编辑，然后点击「应用并生成」。</div>
                <TextArea value={advancedPrompt} onChange={(v) => setAdvancedPrompt((v || '').slice(0, REFERENCE_MAX))} rows={isMobile ? 8 : 14} />
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

                {Object.keys(channelContent).length ? (
                  <>
                    {/* 渠道 Tab：胶囊按钮组，选中黑底白字，切换后下方编辑器/预览随之切到该渠道的 keyed state；
                        存在待核对的事实/禁用词命中时右上角加红点 */}
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
                      {CHANNELS.filter((ch) => channelContent[ch.key]).map((ch) => {
                        const isActive = ch.key === activeChannelKey;
                        const flagged = hasFactIssues(channelContent[ch.key]);
                        return (
                          <button
                            key={ch.key}
                            type="button"
                            onClick={() => setActiveChannelKey(ch.key)}
                            style={{
                              position: 'relative',
                              padding: '8px 16px',
                              borderRadius: 999,
                              border: `1px solid ${isActive ? '#111' : 'rgba(0,0,0,0.16)'}`,
                              background: isActive ? 'linear-gradient(135deg, #2f2f2f, #101010)' : 'rgba(255,255,255,0.5)',
                              color: isActive ? '#fff' : '#111',
                              fontSize: 13,
                              fontWeight: 800,
                              cursor: 'pointer',
                            }}
                          >
                            {ch.name}
                            {flagged ? (
                              <span
                                aria-hidden
                                title="存在待核对信息"
                                style={{
                                  position: 'absolute',
                                  top: -3,
                                  right: -3,
                                  width: 9,
                                  height: 9,
                                  borderRadius: '50%',
                                  background: '#dc2626',
                                  border: '1px solid #fff',
                                }}
                              />
                            ) : null}
                          </button>
                        );
                      })}
                    </div>

                    {/* 校验标红：事实核对/禁用词命中列表，可点「忽略」折叠（不删除数据，仅隐藏本渠道的提示条） */}
                    {hasFactIssues(activeContent) && !collapsedWarnings[activeChannelKey] ? (
                      <div style={{ marginBottom: 14, padding: '10px 12px', borderRadius: 8, border: '1px solid rgba(220,38,38,0.35)', background: 'rgba(220,38,38,0.06)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                          <strong style={{ fontSize: 13, color: '#b91c1c' }}>校验提醒：以下内容可能与表单信息不符，请人工核对</strong>
                          <Button size="small" theme="borderless" onClick={() => setCollapsedWarnings((prev) => ({ ...prev, [activeChannelKey]: true }))}>忽略</Button>
                        </div>
                        <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 12.5, color: '#7f1d1d', lineHeight: 1.7 }}>
                          {(activeContent.factCheck?.issues || []).map((iss, idx) => (
                            <li key={`issue-${idx}`}>
                              {FACT_ISSUE_TYPE_LABEL[iss.type] || iss.type}：表单为「{iss.expect}」，正文出现「{iss.found}」
                              {iss.snippet ? <span style={{ color: '#991b1b' }}>（原文：…{iss.snippet}…）</span> : null}
                            </li>
                          ))}
                          {(activeContent.factCheck?.forbiddenHits || activeContent.factCheck?.hits || []).map((hit, idx) => (
                            <li key={`forbidden-${idx}`}>
                              禁用词：命中「{hit.word}」
                              {hit.snippet ? <span style={{ color: '#991b1b' }}>（原文：…{hit.snippet}…）</span> : null}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}

                    {activeChannelKey === 'wechat_article' ? (
                      /* 公众号 Tab：整块换成排版预览编辑器 + 复制富文本/下载图片包，不复用通用 Markdown/预览 Tabs */
                      <>
                        <WechatPreviewEditor
                          title={activeContent.title}
                          markdown={activeContent.markdownText}
                          photosMap={buildPhotosMapForContent(activeContent)}
                          onChangeMarkdown={setActiveMarkdownText}
                          onChangeTitle={(v) => updateChannelContent(activeChannelKey, { title: v })}
                        />
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                          <Button onClick={handleCopyWechatRich}>复制公众号格式</Button>
                          <Button onClick={handleDownloadWechatImages}>下载图片包</Button>
                          <Button
                            type="primary"
                            onClick={() => {
                              try {
                                localStorage.setItem('wechat-composer-import', JSON.stringify({
                                  title: activeContent.title || '',
                                  markdown: activeContent.markdownText || '',
                                }));
                                window.history.pushState({}, '', '/function/wechat-composer');
                                window.dispatchEvent(new PopStateEvent('popstate'));
                              } catch (e) { Toast.error('跳转失败，请从功能页进入排版器'); }
                            }}
                          >
                            去排版器精修 →
                          </Button>
                        </div>
                      </>
                    ) : (
                      <Tabs defaultActiveKey="editor" key={activeChannelKey}>
                        <Tabs.TabPane itemKey="editor" tab="Markdown 编辑">
                          <TextArea value={activeContent.markdownText} onChange={setActiveMarkdownText} rows={isMobile ? 8 : 14} placeholder="生成内容将在这里显示" />
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, flexWrap: 'wrap', gap: 8 }}>
                            <div>当前字数：{countVisibleChars(activeContent.markdownText)}</div>
                            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: isMobile ? 'flex-end' : 'flex-start' }}>
                              <Button onClick={copyMarkdown}>复制为 Markdown</Button>
                              <Button onClick={copyHtml}>复制为 HTML</Button>
                              {/* 渠道专属导出：新闻稿/通讯稿导出 Word；小红书复制标题/正文+话题/保存图片；微博复制全文 */}
                              {(activeChannelKey === 'press_release' || activeChannelKey === 'report_brief') ? (
                                <Button onClick={handleExportWord}>导出 Word</Button>
                              ) : null}
                              {activeChannelKey === 'xiaohongshu' ? (
                                <>
                                  <Button onClick={handleCopyXhsTitle}>复制标题</Button>
                                  <Button onClick={handleCopyBodyWithHashtags}>复制正文+话题</Button>
                                  <Button onClick={handleSaveActiveImages}>保存图片</Button>
                                </>
                              ) : null}
                              {activeChannelKey === 'weibo' ? (
                                <Button onClick={handleCopyBodyWithHashtags}>复制全文</Button>
                              ) : null}
                            </div>
                          </div>

                          {/* 小红书专属：extra.hashtags 话题胶囊，可删、可输入添加，不写进 markdown 正文 */}
                          {activeChannelKey === 'xiaohongshu' ? (
                            <div style={{ marginTop: 14 }}>
                              <div style={{ fontSize: 12, color: '#444', marginBottom: 6 }}>话题标签</div>
                              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                                {(Array.isArray(activeContent.extra?.hashtags) ? activeContent.extra.hashtags : []).map((tagText, idx) => (
                                  <Tag
                                    key={`${tagText}-${idx}`}
                                    size="small"
                                    type="light"
                                    onClick={() => {
                                      updateChannelContent(activeChannelKey, (base) => ({
                                        ...base,
                                        extra: { ...base.extra, hashtags: (base.extra?.hashtags || []).filter((_, i) => i !== idx) },
                                      }));
                                    }}
                                  >
                                    #{tagText} ×
                                  </Tag>
                                ))}
                                <Input
                                  placeholder="添加话题，回车确认"
                                  style={{ width: 140 }}
                                  value={hashtagDraft}
                                  onChange={setHashtagDraft}
                                  onEnterPress={() => {
                                    const t = hashtagDraft.trim().replace(/^#/, '');
                                    if (!t) return;
                                    updateChannelContent(activeChannelKey, (base) => ({
                                      ...base,
                                      extra: { ...base.extra, hashtags: [...(base.extra?.hashtags || []), t] },
                                    }));
                                    setHashtagDraft('');
                                  }}
                                />
                              </div>
                            </div>
                          ) : null}
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
                    )}
                  </>
                ) : (
                  <div style={{ color: '#999', padding: '32px 0', textAlign: 'center' }}>
                    选择生成渠道后点击「生成初稿」，各渠道结果会在这里以 Tab 形式分开展示
                  </div>
                )}

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
