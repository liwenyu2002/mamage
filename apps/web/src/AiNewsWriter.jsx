import React from 'react';
import { Layout, Input, TextArea, Modal, GlassSelect, SegmentedControl, DatePicker, Button, Tag, Toast } from './ui';
import { getAll as getTransferAll } from './services/transferStore';
import { request, resolveAssetUrl } from './services/request';
import { getToken } from './services/authService';
import { CHANNELS, startBatch, getBatch, retryJob } from './services/newsMatrixService';
import { pollNewsBatch } from './services/newsBatchPolling';
import { newsDraftKey, importLegacyNewsDraft, formatNewsDate, archiveNewsContent, isNewsBatchDone, resolveNewsPhotos,
  restoreNewsForm, hasNewsSource } from './utils/newsWriterState';
import './newsWriter.css';
import { IconClose, IconPlus, IconSparkleAI, IconDownload, IconTrash, IconChevronRight } from './ui/icons';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { toPng } from 'html-to-image';
import WechatPreviewEditor from './wechat/WechatPreviewEditor';
import NewsParagraphTools from './NewsParagraphTools';
import { copyWechatRichTextLegacy, downloadImagePack } from './wechat/wechatExport';

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

const CHANNEL_USAGE = {
  xiaohongshu: '小红书',
  press_release: '官网新闻',
  report_brief: '工作简报',
  weibo: '微博',
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

function NewsGenerationStatus({ startedAt, jobs, submitting, error }) {
  const [now, setNow] = React.useState(Date.now);
  React.useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const list = Object.values(jobs);
  const complete = list.filter(job => isNewsBatchDone(job.status)).length;
  const running = list.some(job => job.status === 'running');
  const elapsed = Math.max(0, Math.floor((now - (startedAt || now)) / 1000));
  return <div className="news-generation-status" role="status" aria-live="polite">
    <div><span className="news-status-dot" aria-hidden="true" />
      <strong>{submitting ? '正在提交' : error ? '正在重新连接' : running ? '正在生成初稿' : '等待生成'}</strong>
      <span>{Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')}</span>
    </div>
    <span>{error ? '连接暂时中断，后台任务继续处理' : list.length ? `${complete} / ${list.length} 个渠道完成` : '正在创建任务'}</span>
  </div>;
}

const AiNewsWriter = ({ initialChannelKey = null, currentUser, workspaceId }) => {
  const DRAFT_STORAGE_KEY = newsDraftKey(currentUser?.id, workspaceId);
  const preferredChannelKey = CHANNELS.some((item) => item.key === initialChannelKey) ? initialChannelKey : null;
  const preferredChannel = CHANNELS.find((item) => item.key === preferredChannelKey) || null;
  const INITIAL_FORM_VALUES = {
    sourceMaterial: '',
    writingMode: 'draft',
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
  const [hasLegacyDraft, setHasLegacyDraft] = React.useState(false);

  // state
  // 不要默认预填已选照片，用户从中转站或手动选择后再加入
  const [selectedPhotos, setSelectedPhotos] = React.useState([]);
  const [formValues, setFormValues] = React.useState(INITIAL_FORM_VALUES);
  const [referenceArticle, setReferenceArticle] = React.useState('');
  const [interviewText, setInterviewText] = React.useState('');

  // 矩阵生成：渠道多选 + 批次状态 + 逐渠道内容（原单份 title/subtitle/markdownText/generatedHtml
  // 拆成 keyed map，key 为 channel_key；下方所有引用点同步改为读写 channelContent[activeChannelKey]）
  const [selectedChannels, setSelectedChannels] = React.useState(() => [preferredChannelKey || 'press_release']);
  const [batchId, setBatchId] = React.useState(null);
  const [batchStatus, setBatchStatus] = React.useState('');
  const [channelJobs, setChannelJobs] = React.useState({}); // channelKey -> { jobId, status, error }
  const [channelContent, setChannelContent] = React.useState({}); // channelKey -> emptyChannelContent() 形状
  const [activeChannelKey, setActiveChannelKey] = React.useState(preferredChannelKey);
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
    if (activeChannelKey) updateChannelContent(activeChannelKey, base => ({ ...base,
      markdownText: v, generatedHtml: '', factCheck: null,
      title: String(v || '').match(/^#\s+(.+)$/m)?.[1]?.trim() || base.title }));
  }, [activeChannelKey, updateChannelContent]);
  // 小红书 Tab 话题标签的输入框草稿（回车确认后写入 activeContent.extra.hashtags）
  const [hashtagDraft, setHashtagDraft] = React.useState('');

  // 智能预填：出席人物 chips（来自已选照片 faceNames 汇总去重 + 手输追加），提交时并入 form.participants
  const [participantChips, setParticipantChips] = React.useState([]);
  const [participantDraft, setParticipantDraft] = React.useState('');
  // 校验标红：某渠道被用户点「忽略」后折叠警示条，channelKey -> true
  const [collapsedWarnings, setCollapsedWarnings] = React.useState({});

  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [generationStartedAt, setGenerationStartedAt] = React.useState(null);
  const [trackingError, setTrackingError] = React.useState('');
  const [trackingEpoch, setTrackingEpoch] = React.useState(0);
  const isGenerating = isSubmitting || ['pending', 'running'].includes(batchStatus);
  const generationRunningRef = React.useRef(false);
  const mountedRef = React.useRef(true);
  const REFERENCE_MAX = 20000;
  const [showAdvancedEditor, setShowAdvancedEditor] = React.useState(false);
  const [advancedPrompt, setAdvancedPrompt] = React.useState('');
  const [documentView, setDocumentView] = React.useState('preview');
  React.useEffect(() => setDocumentView('preview'), [activeChannelKey]);
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
    if (isGenerating) { Toast.info('生成任务仍在后台处理，请完成后再清空'); return; }
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
    setSelectedChannels([preferredChannelKey || 'press_release']);
    setBatchId(null);
    setBatchStatus('');
    setTrackingError('');
    setGenerationStartedAt(null);
    setHasLegacyDraft(false);
    setChannelJobs({});
    setChannelContent({});
    setActiveChannelKey(preferredChannelKey);
    processedJobIdsRef.current = new Set();
    setAdvancedPrompt('');
    setShowAdvancedEditor(false);
    setParticipantChips([]);
    setParticipantDraft('');
    setCollapsedWarnings({});
    Toast.success('已清空本页缓存');
  }, [DRAFT_STORAGE_KEY, INITIAL_FORM_VALUES, preferredChannelKey, isGenerating]);

  const removePhoto = React.useCallback((photoId) => {
    setSelectedPhotos((prev) => (prev || []).filter((p) => String(p.id) !== String(photoId)));
  }, []);

  // Restore draft on mount so page switching won't reset inputs.
  React.useEffect(() => {
    try {
      if (!DRAFT_STORAGE_KEY) return;
      const raw = window.localStorage.getItem(DRAFT_STORAGE_KEY);
      if (!raw) {
        setHasLegacyDraft(Boolean(localStorage.getItem('mamage.aiNewsWriter.draft.v1')));
        return;
      }
      const draft = JSON.parse(raw);
      if (!draft || typeof draft !== 'object') return;
      if (!draft.batchId && !Object.values(draft.channelContent || {}).some(content => content?.markdownText)) {
        setHasLegacyDraft(Boolean(localStorage.getItem('mamage.aiNewsWriter.draft.v1')));
      }

      if (draft.formValues && typeof draft.formValues === 'object') {
        setFormValues((s) => ({ ...s, ...restoreNewsForm(draft.formValues) }));
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
      if (draft.batchId) {
        processedJobIdsRef.current = new Set(draft.processedJobIds || []);
        setChannelJobs(draft.channelJobs || {});
        setBatchStatus(draft.batchStatus || 'pending');
        setGenerationStartedAt(draft.generationStartedAt || Date.now());
        setBatchId(draft.batchId);
      }
    } catch (e) {
      // ignore storage/parse errors
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 从全媒体编辑台切换平台时，默认只生成当前平台；用户仍可在页面里继续勾选其他渠道。
  React.useEffect(() => {
    if (!preferredChannelKey) return;
    setSelectedChannels([preferredChannelKey]);
    setActiveChannelKey(preferredChannelKey);
    const usage = CHANNEL_USAGE[preferredChannelKey];
    if (usage) setFormValues((prev) => (prev.usage === usage ? prev : { ...prev, usage }));
  }, [preferredChannelKey]);

  // Auto-save draft (debounced) whenever key fields change.
  React.useEffect(() => {
    if (skipNextAutoSaveRef.current) {
      skipNextAutoSaveRef.current = false;
      try { window.localStorage.removeItem(DRAFT_STORAGE_KEY); } catch (e) { }
      return;
    }
    const t = setTimeout(() => {
      try {
        if (!DRAFT_STORAGE_KEY) return;
        const payload = {
          formValues: {
            ...formValues,
            eventDate: formatNewsDate(formValues?.eventDate) || null,
          },
          referenceArticle,
          interviewText,
          selectedPhotos,
          selectedChannels,
          channelContent,
          activeChannelKey,
          advancedPrompt,
          participantChips,
          batchId, batchStatus, channelJobs, generationStartedAt,
          processedJobIds: [...processedJobIdsRef.current],
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
    batchId, batchStatus, channelJobs, generationStartedAt, DRAFT_STORAGE_KEY,
  ]);

  const participantCandidates = React.useMemo(() => {
    const names = [];
    (selectedPhotos || []).forEach((p) => {
      extractFaceNames(p).forEach((n) => { if (!names.includes(n)) names.push(n); });
    });
    return names.filter(name => !participantChips.includes(name));
  }, [selectedPhotos, participantChips]);

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
  }, [selectedPhotos]);

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

  // Keep captions in the document; all preview typography is owned by newsWriter.css.
  const normalizePreviewHtml = (htmlStr) => {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(htmlStr || '', 'text/html');

      // Wrap images in <figure> and add <figcaption> from alt or adjacent text when present
      Array.from(doc.querySelectorAll('img')).forEach((img) => {
        try {
          if (img.closest('figure')) return; // already wrapped
          const figure = doc.createElement('figure');

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
            figure.appendChild(figcap);
          }
        } catch (e) {
          // ignore per-image errors
        }
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
  React.useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // 把单个渠道的生成结果（PHOTO:id 占位符）处理成可编辑 markdown，写入该渠道的 keyed state。
  // Results use the existing photo map; no serial per-photo network requests.
  const applyChannelResult = React.useCallback(async (channelKey, result, jobId, isCurrent) => {
    try {
      const photos = (result.photos || []).map(photo => {
        const source = selectedPhotos.find(item => String(item.id) === String(photo.id)) || {};
        return { ...source, ...photo,
          url: photo.url || source.url || source.thumbUrl || source.thumbSrc || source.thumb };
      });
      const processed = { ...result, photos };
      let cleaned = '';
      if (processed.markdown) {
        const injected = resolveNewsPhotos(processed.markdown, [...selectedPhotos, ...photos]);
        cleaned = normalizeMarkdownForRendering(fixNestedMarkdownImages(injected));
      }
      if (!isCurrent()) return false;
      updateChannelContent(channelKey, base => ({
        title: processed.title || formValues.eventName || '',
        subtitle: processed.subtitle || '',
        markdownText: cleaned,
        generatedHtml: '',
        extra: processed.extra || {},
        photos: processed.photos || [],
        factCheck: processed.factCheck || null,
        sourceJobId: jobId,
        history: archiveNewsContent(base),
      }));
      setActiveChannelKey((prev) => prev || channelKey);
      // 新结果落地：展开该渠道的校验警示条（若旧一轮曾被用户「忽略」过）
      setCollapsedWarnings((prev) => (prev[channelKey] ? { ...prev, [channelKey]: false } : prev));
      return true;
    } catch (e) {
      console.error('[AiNewsWriter] apply channel result failed', channelKey, e);
      throw e;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPhotos, formValues.eventName, updateChannelContent]);

  // 汇总一次 batch 轮询响应：更新每渠道 job 状态，并对新完成的渠道跑一遍占位符处理。
  const applyBatchResponse = React.useCallback(async (resp, isCurrent) => {
    if (!resp || !isCurrent()) return;
    const jobs = Array.isArray(resp.jobs) ? resp.jobs : [];
    setChannelJobs((prev) => {
      const next = { ...prev };
      jobs.forEach((job) => {
        next[job.channelKey] = { jobId: job.jobId, status: job.status, error: job.error || null,
          startedAt: job.startedAt, finishedAt: job.finishedAt };
      });
      return next;
    });
    for (const job of jobs) {
      if (job.status === 'succeeded' && job.result && !processedJobIdsRef.current.has(job.jobId)) {
        // eslint-disable-next-line no-await-in-loop
        if (await applyChannelResult(job.channelKey, job.result, job.jobId, isCurrent)) {
          processedJobIdsRef.current.add(job.jobId);
        }
      }
    }
    if (isCurrent()) setBatchStatus(resp.status || '');
  }, [applyChannelResult]);

  const batchResponseRef = React.useRef(applyBatchResponse);
  batchResponseRef.current = applyBatchResponse;
  React.useEffect(() => {
    if (!batchId) return undefined;
    const controller = new AbortController();
    pollNewsBatch({ id: batchId, getBatch, signal: controller.signal,
      onResponse: (response, isCurrent) => batchResponseRef.current(response, isCurrent),
      onError: (error, fatal) => {
        setTrackingError(error ? (fatal ? '任务状态无法读取，请检查账号或工作空间' : '连接暂时中断') : '');
        if (fatal) setBatchStatus('unavailable');
      },
    }).catch(() => { if (!controller.signal.aborted) setTrackingError('读取结果失败，请重新连接'); });
    return () => controller.abort();
  }, [batchId, trackingEpoch]);

  const toggleChannel = React.useCallback((key) => {
    setSelectedChannels((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }, []);

  const handleGenerate = async () => {
    if (generationRunningRef.current || isGenerating) return;
    if (!selectedChannels.length) {
      Toast.warning('请至少选择一个生成渠道');
      return;
    }
    if (!hasNewsSource(formValues, interviewText)) {
      Toast.warning('请粘贴活动材料或稿件原文；照片不能替代事实材料');
      return;
    }
    if (selectedPhotos.length > 30 || String(formValues.sourceMaterial || '').length > 20000 || interviewText.length > 20000 || referenceArticle.length > 20000 || advancedPrompt.length > 4000) {
      Toast.warning('最多使用 30 张照片、每份 20000 字材料与 4000 字写作要求，请精简后提交');
      return;
    }
    generationRunningRef.current = true;
    setIsSubmitting(true);
    setGenerationStartedAt(Date.now());
    setTrackingError('');
    try {
      // 智能预填：出席人物 chips 只在提交时并入 form.participants，不回写到可见输入框，
      // 避免用户还在编辑时输入框被静默改写
      const mergedParticipantNames = toNameList(formValues.participants);
      participantChips.forEach((n) => { if (!mergedParticipantNames.includes(n)) mergedParticipantNames.push(n); });
      const payload = {
        form: { ...formValues, eventDate: formatNewsDate(formValues.eventDate), participants: mergedParticipantNames.join('、'),
          confirmedParticipantNames: participantChips },
        referenceArticle: referenceArticle || '',
        interviewText: interviewText || '',
        channels: selectedChannels,
        writingRequirements: advancedPrompt,
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
      const initialJobs = {};
      (resp.jobs || []).forEach((j) => { initialJobs[j.channelKey] = { jobId: j.jobId, status: 'pending', error: null }; });
      try {
        if (DRAFT_STORAGE_KEY) {
          const draft = JSON.parse(localStorage.getItem(DRAFT_STORAGE_KEY) || '{}');
          localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify({ ...draft,
            formValues: payload.form, selectedPhotos, selectedChannels, channelContent, activeChannelKey,
            referenceArticle, interviewText, advancedPrompt, participantChips,
            batchId: resp.batchId, batchStatus: 'pending', channelJobs: initialJobs,
            processedJobIds: [], generationStartedAt: Date.now() }));
        }
      } catch (e) { if (mountedRef.current) Toast.warning('任务已提交，但本地存储不可用；请保留页面'); }
      if (!mountedRef.current) return;
      // Keep the previous draft editable until a new result has actually arrived.
      processedJobIdsRef.current = new Set();
      setBatchId(resp.batchId);
      setChannelJobs(initialJobs);
      setBatchStatus('pending');
      Toast.info('生成已提交，正在处理中');
    } catch (e) {
      console.error('[AiNewsWriter] generate failed', e);
      const reason = e && (e.message || (e.data && e.data.message)) ? String(e.message || e.data.message).slice(0, 140) : '';
      Toast.error(reason ? `生成请求失败：${reason}` : '生成请求失败');
    } finally {
      if (mountedRef.current) setIsSubmitting(false);
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
      setBatchStatus('pending');
      setTrackingError('');
      setGenerationStartedAt(Date.now());
      setTrackingEpoch(value => value + 1);
    } catch (e) {
      console.error('[AiNewsWriter] retry job failed', channelKey, e);
      const reason = e && (e.message || (e.data && e.data.message)) ? String(e.message || e.data.message).slice(0, 140) : '';
      Toast.error(reason ? `重试失败：${reason}` : '重试失败');
    }
  }, [channelJobs, batchId]);

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
      const htmlToCopy = sanitizeHtml(markdownText ? renderMarkdownToHtml(markdownText) : generatedHtml);
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

  const [isCheckingFacts, setIsCheckingFacts] = React.useState(false);
  const handleCheckFacts = async () => {
    if (isCheckingFacts) return;
    const channel = activeChannelKey;
    const markdown = activeContent.markdownText;
    setIsCheckingFacts(true);
    try {
      const factCheck = await request('/api/ai/news/check', { method: 'POST', timeoutMs: 15000, data: {
        markdown, form: { ...formValues, eventDate: formatNewsDate(formValues.eventDate), interviewText },
        personNames: participantChips,
      } });
      if (mountedRef.current) updateChannelContent(channel, base => (
        base.markdownText === markdown ? { ...base, factCheck } : base));
    } catch (error) {
      Toast.error(error.message || '核对失败，请稍后重试');
    } finally {
      if (mountedRef.current) setIsCheckingFacts(false);
    }
  };

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
      const { exportNewsDocx } = await import(/* webpackChunkName: "news-word-export" */ './utils/newsWordExport');
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

  const finalPreviewHtml = React.useMemo(() => getFinalPreviewHtml(),
    [activeContent.markdownText, activeContent.generatedHtml, selectedPhotos]);
  const reviewNotes = Array.isArray(activeContent.extra?.reviewNotes)
    ? activeContent.extra.reviewNotes.filter(note => typeof note === 'string' && note.trim()).slice(0, 5) : [];

  const fillFromTransfer = () => {
    try {
      const items = getTransferAll() || [];
      if (!items.length) { Toast.info('中转站暂无照片'); return; }
      const mapped = items.filter(p => p.mediaType !== 'video' && p.media_type !== 'video').slice(0, 30).map((p, idx) => ({
        id: p.id || p.url || `transfer-${idx}`,
        thumbUrl: p.thumbUrl || p.thumbSrc || p.thumb || p.url || '',
        url: p.thumbUrl || p.thumbSrc || p.url || '', description: p.description || p.caption || '',
        tags: p.tags || p.tagList || [], projectTitle: p.projectTitle || p.source || '',
        photographerId: p.photographerId || p.photographer_id || null,
        photographerName: p.photographerName || p.photographer_name || '', faceNames: extractFaceNames(p),
      }));
      if (!mapped.length) { Toast.info('中转站暂无可用照片'); return; }
      setSelectedPhotos(mapped);
      Toast.success(`已选 ${mapped.length} 张配图${items.length > 30 ? '，最多使用 30 张' : ''}`);
    } catch (error) { Toast.error('读取中转站失败'); }
  };

  const photoAttachments = <div className="news-photo-attachment">
    <div className="news-attachment-heading">
      <span>活动照片 <span className="news-attachment-count">{selectedPhotos.length} 张</span></span>
      <Button size="small" theme="borderless" icon={<IconPlus />} onClick={fillFromTransfer}>从中转站选图</Button>
    </div>
    {selectedPhotos.length ? <div className="news-photo-strip">
      {selectedPhotos.map((photo, index) => <figure key={photo.id} title={photo.description || `配图 ${index + 1}`}>
        <img src={photo.url || photo.thumbUrl} alt={photo.description || `配图 ${index + 1}`} loading="lazy" decoding="async" />
        <button type="button" onClick={() => removePhoto(photo.id)} aria-label={`移除配图 ${index + 1}`} title="移除配图"><IconClose /></button>
      </figure>)}
    </div> : null}
    {highlightSuggestion ? <details className="news-photo-clues">
      <summary>查看照片分析 <span>待确认</span></summary>
      <p>{highlightSuggestion}</p>
      <Button size="small" onClick={() => setFormValues(previous => ({ ...previous,
        sourceMaterial: [previous.sourceMaterial, `已确认的画面描述：${highlightSuggestion}`].filter(Boolean).join('\n\n') }))}>确认采用画面描述</Button>
    </details> : null}
  </div>;

  return (
    <Layout className="news-writer">
      <Header className="news-page-header">
        <div className="news-page-heading">
          <h2><IconSparkleAI />{preferredChannel ? preferredChannel.name : 'AI 写稿'}</h2>
          <Button theme="borderless" size="small" icon={<IconTrash />} onClick={() => Modal.confirm({
            title: '清空当前草稿？', content: '将清空本机保存的写作材料与稿件，已生成的后台任务不会被删除。',
            okText: '清空草稿', onOk: clearAllDraft,
          })} disabled={isGenerating}>清空草稿
          </Button>
        </div>
        {isGenerating && <NewsGenerationStatus startedAt={generationStartedAt} jobs={channelJobs}
          submitting={isSubmitting} error={trackingError} />}
        {hasLegacyDraft && !isGenerating ? <div className="news-legacy-draft">
          <span>发现本机旧版草稿</span>
          <Button size="small" onClick={() => Modal.confirm({ title: '导入旧版草稿？',
            content: '旧版缓存未区分账号，请确认这是你的稿件。导入会覆盖本页输入，原始旧版缓存仍会保留。',
            okText: '确认导入', onOk: () => {
              try {
                const legacy = JSON.parse(localStorage.getItem('mamage.aiNewsWriter.draft.v1'));
                localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(importLegacyNewsDraft(legacy)));
                window.location.reload();
              } catch (error) { Toast.error(error.message || '导入失败'); }
            } })}>导入旧稿</Button>
          <Button size="small" theme="borderless" onClick={() => setHasLegacyDraft(false)}>暂不导入</Button>
        </div> : null}
      </Header>

      <Content>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="news-workspace">
            {/* Left: form + reference */}
            <div className="news-source-pane">
              <section className="news-material-surface" aria-label="写作材料">
                <div className="news-material-heading">
                  <h3>写作材料</h3>
                  <SegmentedControl label="写作任务" value={formValues.writingMode || 'draft'}
                    options={[{ value: 'draft', label: '写初稿' }, { value: 'rewrite', label: '润色稿' }]}
                    onChange={value => setFormValues(previous => ({ ...previous, writingMode: value }))} />
                </div>
                {photoAttachments}
                <label className="news-material-label" htmlFor="news-source-material">{formValues.writingMode === 'rewrite' ? '稿件原文' : '现场情况'}</label>
                <TextArea id="news-source-material" className="news-material-input" aria-label="写作材料" value={formValues.sourceMaterial || ''}
                  onChange={value => setFormValues(previous => ({ ...previous, sourceMaterial: value }))}
                  rows={7} placeholder={formValues.writingMode === 'rewrite'
                    ? '粘贴需要润色的新闻稿原文……'
                    : '这是什么活动？现场主要发生了什么？你想突出什么？\n\n简单说几句即可，也可以粘贴现场记录。'} />
                <div className="news-field-count" data-over-limit={String(formValues.sourceMaterial || '').length > 20000}>
                  {String(formValues.sourceMaterial || '').length} 字{String(formValues.sourceMaterial || '').length > 18000 ? ' / 20000' : ''}
                </div>
                <details className="news-source-fields news-fact-details">
                  <summary><IconChevronRight />补充活动信息 <span>可选</span></summary>
                <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div>
                    <div style={{ marginBottom: 6, fontSize: 12, color: '#444' }}>活动名称</div>
                    <Input value={formValues.eventName} onChange={(v) => setFormValues((s) => ({ ...s, eventName: v }))} placeholder="请输入活动名称" />
                  </div>

                  <div style={{ display: 'flex', gap: 12, flexDirection: isMobile ? 'column' : 'row' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ marginBottom: 6, fontSize: 12, color: '#444' }}>活动日期</div>
                      <DatePicker value={formValues.eventDate} onChange={(v) => setFormValues((s) => ({ ...s, eventDate: v }))} style={{ width: '100%' }} placeholder="活动日期（可选）" />
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
                    {participantCandidates.length ? <div className="news-name-candidates">
                      <span>待确认人物</span>
                      {participantCandidates.map(name => <Button key={name} size="small"
                        onClick={() => setParticipantChips(previous => [...previous, name])}>确认 {name}</Button>)}
                    </div> : null}
                    <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                      {participantChips.length ? (
                        <span style={{ fontSize: 11, color: '#888' }}>已确认：</span>
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
                        placeholder="添加已确认人物"
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
                    <div style={{ marginBottom: 6, fontSize: 12, color: '#444' }}>主要事实与报道重点</div>
                    <TextArea value={formValues.highlights} onChange={(v) => setFormValues((s) => ({ ...s, highlights: v }))} rows={4} placeholder="本次活动实际发生的过程、成果与报道重点" />
                    {/* 智能预填：亮点为空且能从照片标签拼出建议时才展示，纯前端字符串拼接，不调用模型 */}
                    {!formValues.highlights && highlightSuggestion ? (
                      <div style={{ marginTop: 6, display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12, color: '#666', background: 'rgba(0,0,0,0.03)', borderRadius: 6, padding: '6px 8px' }}>
                        <span style={{ flex: 1 }}>照片线索：{highlightSuggestion}</span>
                        <Button size="small" onClick={() => setFormValues((s) => ({ ...s, highlights: highlightSuggestion }))}>确认采用</Button>
                      </div>
                    ) : null}
                  </div>

                </div>
                </details>

                <details className="news-source-fields news-writing-settings">
                  <summary><IconChevronRight />写作设置 <span>{selectedChannels.map(key => CHANNELS.find(channel => channel.key === key)?.name).filter(Boolean).join('、')} · {formValues.targetWords} 字</span></summary>
                  <div className="news-settings-grid">
                    <GlassSelect label="主要渠道" value={selectedChannels[0] || 'press_release'}
                      options={CHANNELS.map(channel => ({ value: channel.key, label: channel.name }))}
                      onChange={value => setSelectedChannels([value])} />
                    <GlassSelect label="篇幅" value={formValues.targetWords}
                      options={[...new Set(['300-500', '500-800', '800-1200', formValues.targetWords])].filter(Boolean)
                        .map(value => ({ value, label: `${value} 字` }))}
                      onChange={value => setFormValues(previous => ({ ...previous, targetWords: value }))} />
                  </div>
                  <details className="news-additional-channels">
                    <summary>同时生成其他平台</summary>
                    <div className="news-channel-checks">{CHANNELS.filter(channel => channel.key !== selectedChannels[0]).map(channel =>
                      <label key={channel.key}><input type="checkbox" checked={selectedChannels.includes(channel.key)}
                        onChange={() => toggleChannel(channel.key)} />{channel.name}</label>)}</div>
                  </details>
                  <Button size="small" onClick={() => setShowAdvancedEditor(true)}>写作要求{advancedPrompt ? ' · 已设置' : ''}</Button>
                  {interviewText ? <div className="news-settings-field">
                    <label htmlFor="news-interview">已有采访资料</label>
                    <TextArea id="news-interview" value={interviewText} onChange={setInterviewText} rows={4} />
                    <div className="news-field-count" data-over-limit={interviewText.length > 20000}>{interviewText.length} / 20000</div>
                  </div> : null}
                  <div className="news-settings-field">
                    <label htmlFor="news-style-reference">文风范文 · 可选</label>
                    <TextArea id="news-style-reference" value={referenceArticle} onChange={setReferenceArticle}
                      rows={3} placeholder="仅参考表达方式，不引用范文里的活动事实" />
                    <div className="news-field-count" data-over-limit={referenceArticle.length > REFERENCE_MAX}>{referenceArticle.length} / {REFERENCE_MAX}</div>
                  </div>
                </details>

                <div className="news-submit-area">
                    <Button className="news-generate-button" type="primary" icon={<IconSparkleAI />} onClick={() => handleGenerate()} disabled={isGenerating || !selectedChannels.length}>
                      {isGenerating ? '后台生成中' : formValues.writingMode === 'rewrite' ? '润色稿件' : '生成初稿'}
                    </Button>
                  {!isGenerating && trackingError ? <div className="news-reconnect" role="alert">
                    <span>{trackingError}</span><Button size="small" onClick={() => {
                      setTrackingError(''); setBatchStatus('pending'); setTrackingEpoch(value => value + 1);
                    }}>重新连接</Button>
                  </div> : null}
                  {(Object.values(channelJobs).some(job => job.status === 'failed') || (Object.keys(channelJobs).length > 1 && isGenerating)) && (
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
                                <Button size="small" type="danger" theme="borderless" disabled={isGenerating} onClick={() => handleRetryChannel(ch.key)}>重试</Button>
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
              </section>
            </div>

            <Modal
              title="写作要求"
              visible={showAdvancedEditor}
              onCancel={() => setShowAdvancedEditor(false)}
              onOk={() => {
                setShowAdvancedEditor(false);
              }}
              okText="保存要求"
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <TextArea value={advancedPrompt} onChange={setAdvancedPrompt} rows={isMobile ? 6 : 10}
                  placeholder="本篇的报道角度、语气、需要保留或避免的表达" />
                <div className="news-field-count" data-over-limit={advancedPrompt.length > 4000}>{advancedPrompt.length} / 4000</div>
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
            <div className="news-result-pane">
              <section className="news-result-surface" aria-label="稿件">
                <div className="news-result-heading">
                  <div className="news-result-title"><h3>稿件</h3>
                    <span>{activeContent.markdownText ? `${countVisibleChars(activeContent.markdownText)} 字 · AI 初稿` : '等待生成'}</span>
                  </div>
                  {activeContent.markdownText && activeChannelKey !== 'wechat_article' ? <div className="news-document-controls">
                    <SegmentedControl label="稿件视图" kind="tabs" value={documentView}
                      options={[{ value: 'preview', label: '预览' }, { value: 'editor', label: '编辑' }]}
                      onChange={setDocumentView} />
                    <Button size="small" theme="borderless" onClick={handleCopyBodyWithHashtags}>
                      {activeChannelKey === 'xiaohongshu' ? '复制正文+话题' : '复制正文'}
                    </Button>
                    {(activeChannelKey === 'press_release' || activeChannelKey === 'report_brief') ?
                      <Button size="small" icon={<IconDownload />} title="导出 Word 文档" aria-label="导出 Word 文档" onClick={handleExportWord}>Word</Button> : null}
                  </div> : null}
                </div>

                {Object.keys(channelContent).length ? (
                  <>
                    <div className="news-review-bar">
                      <details className="news-review-notes" key={activeChannelKey}>
                        <summary><span className="news-review-indicator" aria-hidden="true" />
                          {isGenerating ? '新稿生成中 · 当前稿件保留' : reviewNotes.length ? `发布前核对 · ${reviewNotes.length} 项材料待确认`
                            : !activeContent.factCheck ? '当前修改尚未核对' : '发布前请核对事实与署名'}
                          <IconChevronRight />
                        </summary>
                        <div className="news-review-content">
                          {reviewNotes.length ? <ul>{reviewNotes.map((note, index) => <li key={index}>{note.slice(0, 240)}</li>)}</ul>
                            : <p>请人工确认时间、地点、人物姓名、署名与表述。规则核对不能代替事实审核。</p>}
                          <Button size="small" theme="borderless" onClick={() => {
                            const input = document.getElementById('news-source-material');
                            input?.scrollIntoView({ block: 'center', behavior: 'smooth' }); input?.focus({ preventScroll: true });
                          }}>补充现场情况</Button>
                        </div>
                      </details>
                      <Button size="small" loading={isCheckingFacts} onClick={handleCheckFacts}>核对当前稿</Button>
                      {activeContent.history?.length ? <GlassSelect placeholder="历史稿件" value="current"
                        className="news-history-select" options={[
                          { value: 'current', label: '当前版本' },
                          ...activeContent.history.map((version, index) => ({ value: String(index),
                            label: `${new Date(version.savedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })} · ${version.title || '历史稿件'}` })),
                        ]} onChange={value => {
                          if (value === 'current') return;
                          updateChannelContent(activeChannelKey, base => {
                            const version = base.history?.[Number(value)];
                            if (!version) return base;
                            return { ...version, history: archiveNewsContent(base).filter(item => item !== version).slice(0, 5) };
                          });
                        }} /> : null}
                    </div>
                    {activeContent.markdownText ? <NewsParagraphTools key={`${DRAFT_STORAGE_KEY}:${activeChannelKey}`}
                      markdown={activeContent.markdownText} form={formValues} confirmedNames={participantChips}
                      interviewText={interviewText} storageKey={DRAFT_STORAGE_KEY ? `${DRAFT_STORAGE_KEY}:${activeChannelKey}` : null}
                      onApply={proposal => updateChannelContent(activeChannelKey, base => {
                        if (base.markdownText !== proposal.base || base.markdownText.slice(proposal.start, proposal.end) !== proposal.original) return base;
                        return { ...base, markdownText: base.markdownText.slice(0, proposal.start) + proposal.proposal + base.markdownText.slice(proposal.end),
                          generatedHtml: '', factCheck: null, history: archiveNewsContent(base) };
                      })} /> : null}
                    {/* 渠道 Tab：胶囊按钮组，选中黑底白字，切换后下方编辑器/预览随之切到该渠道的 keyed state；
                        存在待核对的事实/禁用词命中时右上角加红点 */}
                    {CHANNELS.filter(channel => channelContent[channel.key]).length > 1 ? <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
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
                    </div> : null}

                    {/* 校验标红：事实核对/禁用词命中列表，可点「忽略」折叠（不删除数据，仅隐藏本渠道的提示条） */}
                    {hasFactIssues(activeContent) && !collapsedWarnings[activeChannelKey] ? (
                      <div style={{ marginBottom: 14, padding: '10px 12px', borderRadius: 8, border: '1px solid rgba(220,38,38,0.35)', background: 'rgba(220,38,38,0.06)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                          <strong style={{ fontSize: 13, color: '#b91c1c' }}>待核对：规则提醒不代表已判定有误</strong>
                          <Button size="small" theme="borderless" onClick={() => setCollapsedWarnings((prev) => ({ ...prev, [activeChannelKey]: true }))}>收起</Button>
                        </div>
                        <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 12.5, color: '#7f1d1d', lineHeight: 1.7 }}>
                          {(activeContent.factCheck?.issues || []).map((iss, idx) => (
                            <li key={`issue-${idx}`}>
                              {iss.message || `${FACT_ISSUE_TYPE_LABEL[iss.type] || iss.type}：素材为「${iss.expect}」，正文出现「${iss.found}」`}
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
                    {hasFactIssues(activeContent) && collapsedWarnings[activeChannelKey] ? (
                      <Button size="small" theme="borderless" onClick={() => setCollapsedWarnings(previous => ({ ...previous, [activeChannelKey]: false }))}>展开待核对项</Button>
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
                      <>
                      {documentView === 'editor' ? <div className="news-markdown-editor" role="tabpanel" aria-label="编辑稿件">
                          <TextArea aria-label="稿件正文" value={activeContent.markdownText} onChange={setActiveMarkdownText} rows={isMobile ? 12 : 20} placeholder="生成内容将在这里显示" />
                          <div className="news-editor-footer">
                            <span>Markdown</span>
                            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: isMobile ? 'flex-end' : 'flex-start' }}>
                              <Button size="small" theme="borderless" onClick={copyMarkdown}>复制 Markdown</Button>
                              <Button size="small" theme="borderless" onClick={copyHtml}>复制 HTML</Button>
                              {/* 渠道专属导出：新闻稿/通讯稿导出 Word；小红书复制标题/正文+话题/保存图片；微博复制全文 */}
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
                        </div> : <div className="news-paper-stage" role="tabpanel" aria-label="稿件预览">
                          <article className="news-article-preview" ref={previewContentRef}>
                            {finalPreviewHtml ? (
                              <div dangerouslySetInnerHTML={{ __html: finalPreviewHtml }} />
                            ) : (
                              <div style={{ color: '#999' }}>暂无内容</div>
                            )}
                          </article>
                          <div className="news-paper-footer"><span>{countVisibleChars(activeContent.markdownText)} 字</span>
                            <Button size="small" theme="borderless" icon={<IconDownload />} onClick={generatePreviewImage}
                              loading={isGeneratingPreviewImage} disabled={!finalPreviewHtml}>导出长图</Button>
                          </div>
                        </div>}
                      </>
                    )}
                  </>
                ) : (
                  <div className="news-paper-stage"><div className="news-empty-manuscript">
                    <IconSparkleAI /><span>{isGenerating ? '正在整理材料并撰写初稿' : '等待你的第一份初稿'}</span>
                  </div></div>
                )}

                {/* 编辑区底部的实验性功能按钮已移除 */}
              </section>
            </div>
          </div>
        </div>
      </Content>
    </Layout>
  );
};

export default AiNewsWriter;
