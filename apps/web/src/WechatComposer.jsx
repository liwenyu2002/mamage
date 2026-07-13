import React from 'react';
import DOMPurify from 'dompurify';
import { Layout, Card, Button, Input, Modal, Toast, Typography, Empty } from './ui';
import { getAll as getTransferAll, subscribe as subscribeTransfer } from './services/transferStore';
import { request, resolveAssetUrl } from './services/request';
import {
  listCompositions, saveComposition, getComposition, updateComposition, deleteComposition,
  isArchiveLimitError, getArchiveLimitFromError,
} from './services/wechatCompositionService';
import { THEME_PRESETS, BUILTIN_BLOCKS_BY_ID, applyBlock } from './wechat/themes';
import { copyWechatRichText, downloadImagePack } from './wechat/wechatExport';
import CanvasEditor from './wechat/CanvasEditor';
import AlbumPanel from './wechat/AlbumPanel';
import FavoritesPanel from './wechat/FavoritesPanel';
import ImportPreviewModal from './wechat/ImportPreviewModal';
import ImageEditorModal from './wechat/ImageEditorModal';
import { listFavorites, addFavorite, removeFavorite } from './services/favoritesService';
import { makeUid, markdownToDoc, docToHtml, docToPlainText, createHistory, sanitizeRawHtml, sanitizeParaHtml, replaceRawImgSrc, unproxyWeChatImages } from './wechat/docModel';
import { autoTagThemeColors, detectThemePrimary } from './wechat/themeColor';
import { beginDrag } from './wechat/pointerDrag';
import { makeQrSvg } from './wechat/qr';
import './wechat/composer.css';
import './wechat/canvas.css';

const { Header, Content } = Layout;
const { Text } = Typography;

const DRAFT_KEY = 'wechat-composer-draft';
const IMPORT_KEY = 'wechat-composer-import'; // 矩阵页"去排版器精修"写入的 {title, markdown}，进页即读即清
const DEFAULT_THEME_KEY = 'minimal';
const ARCHIVE_NAME_LIMIT = 120;

// ── 草稿 vs 存档 ─────────────────────────────────────────────────
// 草稿（本节 DRAFT_KEY）：自动保存、单份、只存在本机 localStorage，画布任何变化都会静默写回，
// 标记"最近一次编辑状态"；换设备/清缓存/隐私模式即丢失，用户无感知、无需操作。
// 存档（下方 wechatCompositionService 对接 /api/wechat-compositions）：手动触发、可存多份、
// 落在服务端数据库、按用户隔离、跨设备可见；用户主动点「存档」保存一份具名快照，
// 点「存档记录」浏览/载入/覆盖/删除。两者互不依赖：载入或覆盖存档不会清空/暂停草稿的自动
// 持久化，画布状态变化后仍会照常写回 DRAFT_KEY（载入存档后的画布也会被当作新的草稿状态保存）。
const TITLE_LIMIT = 64;
const DIGEST_LIMIT = 120;

// 样式库面板：类型 tab 与每类的微缩预览示例文案
const BLOCK_TYPES = [
  { key: 'h2', name: '标题', sample: '标题样式' },
  { key: 'h3', name: '小标题', sample: '小标题样式' },
  { key: 'quote', name: '引用', sample: '这是一段引用示例，感谢每一位参与者。' },
  { key: 'divider', name: '分隔线', sample: '' },
  { key: 'imageCard', name: '图片卡', sample: '图注示例' },
  { key: 'signoff', name: '落款', sample: '— 完 —' },
];
const ACCENT_CHOICES = ['#111111', '#1f4e8c', '#e8590c', '#c0392b', '#2f9e44', '#7048e8', '#0c8599', '#d6336c'];
// 图片卡微缩预览占位图（内联 SVG，避免外链）
const PREVIEW_IMG = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#d8dce2"/><circle cx="120" cy="80" r="28" fill="#f5f6f8"/><path d="M40 150 L120 90 L190 140 L240 110 L290 150 Z" fill="#b8bfc9"/></svg>');

// 后端样式库行 → 前端 StyleBlock（id 加 db- 前缀避免与内置块撞名；dbId 留给删除接口）
function normalizeDbBlock(row) {
  return {
    id: `db-${row.id}`,
    dbId: row.id,
    type: row.type,
    name: row.name || '提取样式',
    htmlTemplate: row.html_template || row.htmlTemplate || '',
    accentEditable: !!(row.accent_editable || row.accentEditable),
    source: 'extracted',
    sourceUrl: row.source_url || null,
  };
}

// 中转站条目 → 插图选择器候选：id 必须存在，url 取原图优先（插入正文用高清图，缩略图只用于选择器展示）
function normalizeStationItems(items) {
  const out = [];
  (items || []).forEach((p) => {
    if (!p) return;
    const id = p.id != null && p.id !== '' ? String(p.id) : '';
    if (!id) return;
    out.push({
      id,
      thumbUrl: resolveAssetUrl(p.thumbSrc || p.url) || '',
      fullUrl: resolveAssetUrl(p.url || p.thumbSrc) || '',
      description: p.description || p.projectTitle || '',
    });
  });
  return out;
}

// 草稿安全解析：损坏的 JSON 不应炸掉整页，静默回退空草稿
function safeParse(raw) {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    return (v && typeof v === 'object') ? v : null;
  } catch (e) {
    return null;
  }
}

// 存档记录里的 updatedAt（ISO 字符串）→ 列表展示用的本地时间短格式；解析失败原样兜底
function formatArchiveTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso).slice(0, 16).replace('T', ' ');
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// 新建/首次保存未命名推文时的默认文件名（带创建时刻，便于在文件管理器里区分）
function defaultFileName() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `未命名推文 ${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// 首帧同步读取草稿 + 导入数据（比 useEffect 异步回填快，避免"先空后填"的闪烁）；
// 导入键读到即删，保证只消费一次。真正的 side-effect（Toast）留给挂载后的 effect 处理。
function buildInitialState() {
  let draftRaw = null;
  try {
    draftRaw = (typeof localStorage !== 'undefined') ? localStorage.getItem(DRAFT_KEY) : null;
  } catch (e) {
    // 部分隐私模式下 getItem 也会抛，静默兜底（与下方 IMPORT_KEY 读取一致）
  }
  const draft = safeParse(draftRaw) || {};
  let imported = null;
  try {
    const rawImport = (typeof localStorage !== 'undefined') ? localStorage.getItem(IMPORT_KEY) : null;
    if (rawImport) {
      localStorage.removeItem(IMPORT_KEY);
      imported = safeParse(rawImport);
    }
  } catch (e) {
    // 隐私模式/存储被禁用时静默忽略
  }
  const hasImport = !!(imported && (imported.title || imported.markdown));
  const themeKey = draft.themeKey || DEFAULT_THEME_KEY;
  const blockConfig = (draft.blockConfig && typeof draft.blockConfig === 'object') ? draft.blockConfig : null;
  const effective = blockConfig || THEME_PRESETS[themeKey] || THEME_PRESETS[DEFAULT_THEME_KEY];

  // 文档来源优先级：矩阵导入 markdown > v3 草稿 doc > 旧草稿 markdown（一次性转块）> 空文档
  let doc = null;
  if (hasImport && imported.markdown) {
    doc = markdownToDoc(imported.markdown, { blockConfig: effective });
  } else if (Array.isArray(draft.doc) && draft.doc.length) {
    doc = draft.doc;
  } else if (draft.markdown) {
    doc = markdownToDoc(draft.markdown, { blockConfig: effective });
  }
  const title = (hasImport && imported.title) || draft.title || '';
  const digest = draft.digest || '';
  const finalDoc = doc || [];
  // 草稿归属的存档文件 id（v4 起随草稿一起写回）；null=尚未保存为服务端文件的新推文
  const draftOpenId = (draft.openId != null && draft.openId !== '') ? draft.openId : null;
  const draftHasContent = (finalDoc.length > 0) || !!title.trim() || !!digest.trim();
  // 进页默认落在「推文文件管理器」；仅两种情况直接进编辑器：
  //   1) 从 AI 矩阵「去排版器精修」带内容进来（必须立即进编辑接住导入内容）
  //   2) 上次正在编辑一篇【尚未保存为文件】的新推文（reload 后能接着编，否则草稿虽在本地但无入口找回）
  //   已保存文件的草稿(draftOpenId 有值) → 仍回文件管理器，从列表打开会拉服务端干净版本
  const view = (hasImport || (draftHasContent && draftOpenId == null)) ? 'editor' : 'manager';
  return {
    title,
    digest,
    doc: finalDoc,
    themeKey,
    blockConfig,
    imported: hasImport,
    view,
    // 初始 openId 恒为 null：能进编辑器的两种情形（导入 / 续编未保存新推文）本就没有归属文件；
    // 归属已存文件的草稿(draftOpenId 有值)一律落管理器，openId 保持 null，避免"管理器里删掉该文件
    // 时误把它当成当前编辑文件、把残留草稿重存为新文件"的脏状态。需要那份内容从列表重新打开即可。
    openId: null,
    // 进编辑器即视为"有未保存改动"（导入内容/续编的新推文都还没落库），进管理器则无所谓
    dirty: view === 'editor',
  };
}

function WechatComposer() {
  const [initial] = React.useState(buildInitialState);
  const [title, setTitle] = React.useState(initial.title);
  const [digest, setDigest] = React.useState(initial.digest);
  // 主题模板 UI 已移除：themeKey 仅作为 blockConfig 未自定义时的预设兜底键保留（草稿兼容）。
  // setThemeKey 平时不用（没有主题选择 UI），仅供"载入存档"时按存档记录的 themeKey 恢复兜底预设。
  const [themeKey, setThemeKey] = React.useState(initial.themeKey);
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [stationItemsRaw, setStationItemsRaw] = React.useState(() => getTransferAll());
  const [isMobile, setIsMobile] = React.useState(() => (typeof window !== 'undefined' ? window.innerWidth <= 768 : false));

  // ── 画布文档（v3 编辑主源）────────────────────────────────
  const [doc, setDoc] = React.useState(initial.doc);
  const [selectedUid, setSelectedUid] = React.useState(null);
  const canvasApiRef = React.useRef(null); // CanvasEditor 命令式句柄（insertIntoRawCaret 容器内嵌套插入）
  const historyRef = React.useRef(null);
  if (!historyRef.current) historyRef.current = createHistory(initial.doc);
  const [historyTick, setHistoryTick] = React.useState(0); // 撤销/重做按钮禁用态的重渲信号
  void historyTick;
  const [replaceTarget, setReplaceTarget] = React.useState(null); // 换样式模式：目标块 uid
  // 中转站选图目标：null=插新图块；uid 字符串=给 imageCard 块换图；{uid, imgIndex}=替换 raw 块内第 N 张图
  const [pickerTarget, setPickerTarget] = React.useState(null);

  const applyDocChange = React.useCallback((nextDoc, opts) => {
    setDoc(nextDoc);
    if (!opts || !opts.transient) {
      historyRef.current.push(nextDoc);
      setHistoryTick((t) => t + 1);
    }
  }, []);

  const handleUndo = React.useCallback(() => {
    const prev = historyRef.current.undo();
    if (prev) { setDoc(prev); setSelectedUid(null); setHistoryTick((t) => t + 1); }
  }, []);

  const handleRedo = React.useCallback(() => {
    const next = historyRef.current.redo();
    if (next) { setDoc(next); setSelectedUid(null); setHistoryTick((t) => t + 1); }
  }, []);

  // ⌘S 保存当前文件（含输入框内触发，拦掉浏览器保存网页对话框）；⌘Z / ⌘⇧Z 撤销/重做
  // （画布不拦截，父级统一处理；输入场景交还浏览器原生撤销）。saveOpen/view 用 ref 读最新值避免闭包过期。
  React.useEffect(() => {
    const onKey = (e) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (viewRef.current === 'editor' && saveOpenRef.current) saveOpenRef.current();
        return;
      }
      if (!mod || e.key.toLowerCase() !== 'z') return;
      const t = e.target;
      const typing = t && (t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA');
      if (typing) return;
      e.preventDefault();
      if (e.shiftKey) handleRedo(); else handleUndo();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [handleUndo, handleRedo]);

  // 样式块自选：blockConfig=null 表示跟随主题预设；一旦在样式库里挑过块即转为自定义配置
  const [blockConfig, setBlockConfig] = React.useState(initial.blockConfig);
  const [libraryOpen, setLibraryOpen] = React.useState(false);
  const [libType, setLibType] = React.useState('h2');
  const [sideTab, setSideTab] = React.useState('style'); // 左侧面板顶层 Tab：style|album|fav
  // 已访问过的 Tab 保持挂载（用 display 切换而非卸载），避免切走再切回丢失搜索词/滚动位置；
  // 但首次仍是懒加载——没点过的 Tab 不挂载、不发请求
  const [visitedTabs, setVisitedTabs] = React.useState(() => ({ style: true }));
  const switchSideTab = React.useCallback((key) => {
    setSideTab(key);
    setVisitedTabs((prev) => (prev[key] ? prev : { ...prev, [key]: true }));
  }, []);

  // ── 用户收藏（一用户一收藏，样式块+照片两类）────────────────
  const [styleFavs, setStyleFavs] = React.useState([]);
  const [photoFavs, setPhotoFavs] = React.useState([]);
  // 加载失败必须显式标记，否则空态与"加载失败"无法区分——用户会误以为收藏丢了
  const [favError, setFavError] = React.useState(false);

  const [snippetFavs, setSnippetFavs] = React.useState([]); // 框选收藏的元素片段

  const loadFavorites = React.useCallback(async () => {
    try {
      const resp = await listFavorites();
      const rows = Array.isArray(resp && resp.favorites) ? resp.favorites : [];
      setStyleFavs(rows.filter((r) => r.kind === 'styleBlock'));
      setPhotoFavs(rows.filter((r) => r.kind === 'photo'));
      setSnippetFavs(rows.filter((r) => r.kind === 'snippet'));
      setFavError(false);
    } catch (e) {
      console.error('[WechatComposer] load favorites failed', e);
      setFavError(true);
    }
  }, []);

  // 进页即拉：草稿可能引用"仅存在于收藏快照"的样式块（原 db 块已删），blocksById 需要快照兜底
  React.useEffect(() => { loadFavorites(); }, [loadFavorites]);

  const favoriteBlockKeys = React.useMemo(() => new Set(styleFavs.map((f) => f.refKey)), [styleFavs]);
  const favoritePhotoKeys = React.useMemo(() => new Set(photoFavs.map((f) => String(f.refKey))), [photoFavs]);
  const [myBlocks, setMyBlocks] = React.useState([]); // 从链接提取并保存的"我的样式库"
  const [myBlocksLoaded, setMyBlocksLoaded] = React.useState(false);
  const [extractUrl, setExtractUrl] = React.useState('');
  const [extracting, setExtracting] = React.useState(false);
  const [extractedBlocks, setExtractedBlocks] = React.useState(null); // 非 null 时显示提取结果弹层
  const [extractPicked, setExtractPicked] = React.useState({});
  const [savingExtract, setSavingExtract] = React.useState(false);
  const [importing, setImporting] = React.useState(false);
  const [importResult, setImportResult] = React.useState(null); // 画布非空时的"替换/追加"确认弹层数据
  const [previewGen, setPreviewGen] = React.useState(false);     // 手机预览：生成中
  const [previewInfo, setPreviewInfo] = React.useState(null);    // { url, qrSvg } | null，非空显示二维码弹层
  const [exportMenuOpen, setExportMenuOpen] = React.useState(false); // 导出「更多」溢出菜单开合
  const exportMenuRef = React.useRef(null);
  // 点菜单外/按 Esc 关闭「更多」溢出菜单
  React.useEffect(() => {
    if (!exportMenuOpen) return undefined;
    const onDown = (e) => { if (exportMenuRef.current && !exportMenuRef.current.contains(e.target)) setExportMenuOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setExportMenuOpen(false); };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onDown); document.removeEventListener('keydown', onKey); };
  }, [exportMenuOpen]);
  const [imgEditTarget, setImgEditTarget] = React.useState(null); // { uid, imgIndex?, src } | null，图片编辑器

  // ── 存档（服务端多份快照）──────────────────────────────────────
  const [archiveSaveOpen, setArchiveSaveOpen] = React.useState(false); // "存档"弹窗：输入名称后 POST
  const [archiveSaveName, setArchiveSaveName] = React.useState('');
  const [archiveList, setArchiveList] = React.useState([]);
  const [archiveListLoading, setArchiveListLoading] = React.useState(false);
  const [archiveListError, setArchiveListError] = React.useState(false);
  // 当前正在处理的行内操作，形如 "<id>:open" | "<id>:dup" | "<id>:delete"；
  // 用来单独给该行按钮加 loading，同时把该行其余按钮禁用，防止同一条文件并发操作
  const [archiveBusyKey, setArchiveBusyKey] = React.useState(null);

  // ── 推文文件管理器 ────────────────────────────────────────────
  // view=manager：文件列表（新建/打开/重命名/复制/删除）；view=editor：画布编辑当前文件。
  // openId=当前编辑的服务端文件 id（null=尚未保存的新推文）；dirty=自上次保存/载入后有改动。
  // 文件列表复用上面的 archiveList* 状态（就是 /api/wechat-compositions 的列表）。
  const [view, setView] = React.useState(initial.view);
  const [openId, setOpenId] = React.useState(initial.openId);
  const [openName, setOpenName] = React.useState('');
  const [dirty, setDirty] = React.useState(initial.dirty);
  const [saving, setSaving] = React.useState(false);
  const [leavePrompt, setLeavePrompt] = React.useState(null); // {proceed} | null：有未保存改动时的三选一离开确认
  const [saveMode, setSaveMode] = React.useState('new'); // 命名弹窗用途：'new'=首次保存新推文 | 'rename'=重命名文件
  const [renameTargetId, setRenameTargetId] = React.useState(null);
  // loadingRef：程序化整批替换编辑器状态（载入/新建/复位）时置 true，让 dirty 副作用跳过这一批变更；
  // 首帧也当作一次程序化装载跳过，避免挂载即被标脏。
  const loadingRef = React.useRef(true);
  const saveOpenRef = React.useRef(null); // 供全局 ⌘S 读取最新 saveOpen，避免闭包过期
  const viewRef = React.useRef(initial.view);
  const pendingAfterSaveRef = React.useRef(null); // "保存并离开"新推文时：命名保存成功后要执行的后续动作
  React.useEffect(() => { viewRef.current = view; }, [view]);

  // 生效的块配置：自定义优先，否则用当前主题预设
  const effectiveConfig = React.useMemo(
    () => blockConfig || THEME_PRESETS[themeKey] || THEME_PRESETS[DEFAULT_THEME_KEY],
    [blockConfig, themeKey]
  );
  const blocksById = React.useMemo(() => {
    const map = { ...BUILTIN_BLOCKS_BY_ID };
    // 收藏快照先铺底（原 db 块被删后收藏/草稿仍可渲染），在库的真实块随后覆盖（数据更新鲜）
    styleFavs.forEach((f) => {
      if (f && f.refKey && f.payload && f.payload.htmlTemplate && !map[f.refKey]) {
        map[f.refKey] = { id: f.refKey, ...f.payload };
      }
    });
    myBlocks.forEach((b) => { map[b.id] = b; });
    return map;
  }, [myBlocks, styleFavs]);

  const loadMyBlocks = React.useCallback(async () => {
    try {
      const resp = await request('/api/wechat-style/blocks', { method: 'GET' });
      const rows = Array.isArray(resp && resp.blocks) ? resp.blocks : (Array.isArray(resp) ? resp : []);
      setMyBlocks(rows.map(normalizeDbBlock));
      setMyBlocksLoaded(true);
    } catch (e) {
      console.error('[WechatComposer] load my blocks failed', e);
    }
  }, []);

  // 面板首次打开时拉一次"我的样式库"；草稿里引用了 db- 块时进页就要拉（否则渲染回退兜底块）
  React.useEffect(() => {
    if (myBlocksLoaded) return;
    const usesDbBlock = blockConfig && Object.values(blockConfig).some((v) => typeof v === 'string' && v.startsWith('db-'));
    if (libraryOpen || usesDbBlock) loadMyBlocks();
  }, [libraryOpen, blockConfig, myBlocksLoaded, loadMyBlocks]);


  React.useEffect(() => {
    if (initial.imported) Toast.success('已导入公众号草稿');
    // 只在挂载时触发一次；initial 本身不随渲染变化
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // 实时镜像中转站：从相册新存入的照片立即能在插图选择器里点选
  React.useEffect(() => subscribeTransfer((items) => setStationItemsRaw(items)), []);
  const stationItems = React.useMemo(() => normalizeStationItems(stationItemsRaw), [stationItemsRaw]);

  // 编辑器改动即标脏（供"保存/离开确认"判断）。整批程序化装载（载入文件/新建/复位）由 loadingRef 跳过；
  // 首帧也跳过（loadingRef 初值 true），避免挂载即被标脏。一次载入会同步 setTitle/setDoc 等多个 state，
  // React 批处理合并成一次副作用触发，消费一次 loadingRef 即可。
  React.useEffect(() => {
    if (loadingRef.current) { loadingRef.current = false; return; }
    setDirty(true);
  }, [title, digest, doc, themeKey, blockConfig]);

  // 草稿持久化（v4：随块文档一起存 openId，标明这份草稿属于哪个服务端文件；null=未保存的新推文）；
  // 写入失败（隐私模式/配额满）静默忽略，不打断编辑
  React.useEffect(() => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ v: 4, openId, title, digest, doc, themeKey, blockConfig }));
    } catch (e) {
      // ignore
    }
  }, [title, digest, doc, themeKey, blockConfig]);

  // 在画布中插入一个新块：有选中块插其后，否则追加末尾；返回新块 uid
  const insertDocBlock = React.useCallback((block) => {
    const withUid = { ...block, uid: makeUid() };
    const next = [...doc];
    const idx = selectedUid ? next.findIndex((b) => b.uid === selectedUid) : -1;
    if (idx >= 0) next.splice(idx + 1, 0, withUid); else next.push(withUid);
    applyDocChange(next);
    setSelectedUid(withUid.uid);
    return withUid.uid;
  }, [doc, selectedUid, applyDocChange]);

  // 中转站选图确认：pickerTarget 按形态分发——对象={uid,imgIndex} 替换 raw 内第 N 图，
  // 字符串=imageCard 换图，null=插入新图片卡块
  const insertPhoto = React.useCallback((item) => {
    const url = item.fullUrl || item.thumbUrl;
    if (!url) { Toast.warning('该照片缺少可用地址'); return; }
    const caption = String(item.description || '').slice(0, 40);
    if (pickerTarget && typeof pickerTarget === 'object') {
      const { uid, imgIndex } = pickerTarget;
      const next = doc.map((b) => (b.uid === uid ? { ...b, html: replaceRawImgSrc(b.html || '', imgIndex, url) } : b));
      applyDocChange(next);
      Toast.success('已替换图片');
    } else if (pickerTarget) {
      const next = doc.map((b) => (b.uid === pickerTarget ? { ...b, src: url } : b));
      applyDocChange(next);
      Toast.success('已替换图片');
    } else {
      const imageBlockId = (blockConfig || THEME_PRESETS[themeKey] || THEME_PRESETS[DEFAULT_THEME_KEY]).imageCard;
      insertDocBlock({ kind: 'styled', type: 'imageCard', blockId: imageBlockId, src: url, caption, accent: null });
      Toast.success('已插入图片卡');
    }
    setPickerTarget(null);
    setPickerOpen(false);
  }, [pickerTarget, doc, applyDocChange, blockConfig, themeKey, insertDocBlock]);

  const titleLen = React.useMemo(() => Array.from(String(title || '')).length, [title]);
  const digestLen = React.useMemo(() => Array.from(String(digest || '')).length, [digest]);
  const titleOver = titleLen > TITLE_LIMIT;
  const digestOver = digestLen > DIGEST_LIMIT;

  // ── 样式库交互 ────────────────────────────────────────────────

  // 每种类型插入新块时的默认内容
  const DEFAULT_CONTENT = React.useMemo(() => ({
    h2: '在这里输入标题', h3: '在这里输入小标题', quote: '在这里输入引用内容', signoff: '— 完 —',
  }), []);

  // 把一个样式块渲染成可嵌入容器的 HTML（文字块带默认文案,divider 无内容）。
  // 用 sanitizeRawHtml 清洗（与 raw 块统一口径,RAW_FORBID_TAGS 最全）——插入后本就会再过一次
  // sanitizeRawHtml,源头即用同一函数可消除清洗口径不一致的窗口。
  const renderStyleBlockHtmlForNest = React.useCallback((type, id) => {
    const block = blocksById[id];
    if (!block) return '';
    const raw = type === 'divider'
      ? applyBlock(block, { accent: effectiveConfig.accent })
      : applyBlock(block, { content: DEFAULT_CONTENT[type] || '', accent: effectiveConfig.accent });
    return sanitizeRawHtml(raw);
  }, [blocksById, effectiveConfig.accent, DEFAULT_CONTENT]);

  // 点样式块：换样式模式=替换目标块的样式保内容；否则优先插入到选中 raw 容器的光标处（嵌套），
  // 无有效容器光标时回退为向画布插入新的顶层块。
  const applyBlockPick = React.useCallback((type, id) => {
    if (replaceTarget) {
      const next = doc.map((b) => (b.uid === replaceTarget && b.type === type ? { ...b, blockId: id } : b));
      applyDocChange(next);
      setReplaceTarget(null);
      Toast.success('已替换样式');
      return;
    }
    setBlockConfig({ ...effectiveConfig, [type]: id });
    if (type === 'imageCard') {
      // 图片卡需要先选图：打开中转站选择器，选定后按当前配置插入
      setPickerTarget(null);
      setPickerOpen(true);
      return;
    }
    // 容器内嵌套：光标在某个 raw 容器内时，样式元素插到光标处而非新建顶层块
    const nestHtml = renderStyleBlockHtmlForNest(type, id);
    if (nestHtml && canvasApiRef.current && canvasApiRef.current.insertIntoRawCaret(nestHtml)) {
      Toast.success('已插入到容器内');
      return;
    }
    insertDocBlock({
      kind: 'styled', type, blockId: id,
      content: DEFAULT_CONTENT[type] || '', accent: null,
    });
  }, [replaceTarget, doc, applyDocChange, effectiveConfig, insertDocBlock, DEFAULT_CONTENT, renderStyleBlockHtmlForNest]);

  const applyAccent = React.useCallback((hex) => {
    setBlockConfig({ ...effectiveConfig, accent: hex });
  }, [effectiveConfig]);

  // 单块微缩预览：提取块模板来自后端（已服务端清洗），此处再过一遍 DOMPurify 兜底
  const renderBlockPreview = React.useCallback((block) => {
    try {
      const typeDef = BLOCK_TYPES.find((t) => t.key === block.type);
      const raw = applyBlock(block, {
        content: (typeDef && typeDef.sample) || '示例文本',
        src: PREVIEW_IMG,
        caption: block.type === 'imageCard' ? '图注示例' : '',
        accent: effectiveConfig.accent,
      });
      return DOMPurify.sanitize(raw, { FORBID_TAGS: ['style', 'script', 'iframe'], ADD_ATTR: ['style'] });
    } catch (e) {
      return '<span style="color:#999;font-size:12px">预览失败</span>';
    }
  }, [effectiveConfig.accent]);

  const handleExtract = React.useCallback(async () => {
    const url = extractUrl.trim();
    if (!url) { Toast.warning('先粘贴一篇公众号文章链接'); return; }
    if (!/^https?:\/\/mp\.weixin\.qq\.com\//.test(url)) { Toast.warning('只支持公众号文章链接（mp.weixin.qq.com）'); return; }
    setExtracting(true);
    try {
      const resp = await request('/api/wechat-style/extract', { method: 'POST', data: { url } });
      const blocks = Array.isArray(resp && resp.blocks) ? resp.blocks : [];
      if (!blocks.length) { Toast.info('这篇文章没有识别出可复用的样式块（可能排版太简单）'); return; }
      const picked = {};
      blocks.forEach((b, i) => { picked[i] = true; });
      setExtractedBlocks(blocks);
      setExtractPicked(picked);
    } catch (e) {
      console.error('[WechatComposer] extract failed', e);
      Toast.error(e && e.message ? `提取失败：${String(e.message).slice(0, 100)}` : '提取失败，请稍后重试');
    } finally {
      setExtracting(false);
    }
  }, [extractUrl]);

  // ── 整文复现：把别人的推文完整解析成 raw 块导入画布（文字/图片/排版全保留）──────

  // raw 块（整文导入）以 html 论有无内容，与 para 同轨；styled 块看 content/src
  const docHasContent = React.useMemo(
    () => doc.some((b) => ((b.kind === 'para' || b.kind === 'raw') ? String(b.html || '').trim() : (b.content || b.src))),
    [doc]
  );

  const applyImportedArticle = React.useCallback((result, mode) => {
    const rawBlocks = (result && Array.isArray(result.blocks) ? result.blocks : [])
      .map((html) => ({ uid: makeUid(), kind: 'raw', html: sanitizeRawHtml(html) }))
      .filter((b) => b.html && b.html.trim());
    if (!rawBlocks.length) { Toast.warning('没有可导入的内容'); setImportResult(null); return; }
    // 秀米式主题色标注：探测这篇推文的主色，给所有块的彩色元素打 data-mm-theme 角色标注，
    // 让整篇导入的推文变得可一键换主题色（正文黑字/纯白底等中性色不标，保持固定）。
    let themedCount = 0;
    let detectedPrimary = null;
    try {
      detectedPrimary = detectThemePrimary(rawBlocks.map((b) => b.html).join(''));
      if (detectedPrimary) {
        rawBlocks.forEach((b) => {
          const r = autoTagThemeColors(b.html, { primary: detectedPrimary });
          b.html = r.html; themedCount += r.count;
        });
      }
    } catch (e) { /* 标注失败不阻断导入，退化为不可换色 */ }
    const next = mode === 'append' ? [...doc, ...rawBlocks] : rawBlocks;
    applyDocChange(next);
    setSelectedUid(null);
    if (result.title && !String(title || '').trim()) setTitle(String(result.title).slice(0, TITLE_LIMIT));
    // 采纳原文主色为主题色（替换导入或空画布时）：既让外观保持原样、也让"换主题色"以此为基线。
    // 追加到已有内容时不动用户既有主题色，避免顺带改了原有块的配色。
    if (detectedPrimary && (mode !== 'append' || !docHasContent)) {
      setBlockConfig({ ...effectiveConfig, accent: detectedPrimary });
    }
    setImportResult(null);
    const imgN = rawBlocks.reduce((n, b) => n + ((b.html.match(/<img\b/gi) || []).length), 0);
    Toast.success(`已导入 ${rawBlocks.length} 个内容块${imgN ? `、${imgN} 张图` : ''}${themedCount ? '，已识别主题色，可一键换色' : ''}`);
  }, [doc, applyDocChange, title, docHasContent, effectiveConfig]);

  const handleImportArticle = React.useCallback(async () => {
    const url = extractUrl.trim();
    if (!url) { Toast.warning('先粘贴一篇公众号推文链接'); return; }
    // 前置链接检测：非推文链接不发请求，直接给出格式提示（后端还有同规则的二次校验）
    if (!/^https?:\/\/mp\.weixin\.qq\.com\/s([/?#]|$)/.test(url)) {
      Toast.warning('这不是公众号推文链接（应形如 mp.weixin.qq.com/s/…）');
      return;
    }
    setImporting(true);
    try {
      const resp = await request('/api/wechat-style/import-article', { method: 'POST', data: { url } });
      const blocks = Array.isArray(resp && resp.blocks) ? resp.blocks : [];
      if (!blocks.length) { Toast.info('这篇推文没有解析到正文内容'); return; }
      setImportResult(resp); // 一律进完整预览层：块级勾选/框选后再导入
    } catch (e) {
      console.error('[WechatComposer] import article failed', e);
      Toast.error(e && e.message ? `复现失败：${String(e.message).slice(0, 100)}` : '复现失败，请稍后重试');
    } finally {
      setImporting(false);
    }
  }, [extractUrl]);

  const handleSaveExtracted = React.useCallback(async () => {
    const chosen = (extractedBlocks || []).filter((_, i) => extractPicked[i]);
    if (!chosen.length) { Toast.warning('先勾选要保存的样式块'); return; }
    setSavingExtract(true);
    try {
      await request('/api/wechat-style/blocks', { method: 'POST', data: { blocks: chosen } });
      Toast.success(`已存入我的样式库（${chosen.length} 个）`);
      setExtractedBlocks(null);
      setExtractUrl('');
      await loadMyBlocks();
      setLibraryOpen(true);
    } catch (e) {
      console.error('[WechatComposer] save extracted failed', e);
      Toast.error(e && e.message ? `保存失败：${String(e.message).slice(0, 100)}` : '保存失败');
    } finally {
      setSavingExtract(false);
    }
  }, [extractedBlocks, extractPicked, loadMyBlocks]);

  const handleDeleteMyBlock = React.useCallback(async (block) => {
    try {
      await request(`/api/wechat-style/blocks/${block.dbId}`, { method: 'DELETE' });
      setMyBlocks((prev) => prev.filter((b) => b.id !== block.id));
      // 正在使用被删块的槽位回退到当前主题预设对应块
      setBlockConfig((prev) => {
        if (!prev) return prev;
        const preset = THEME_PRESETS[themeKey] || THEME_PRESETS[DEFAULT_THEME_KEY];
        const next = { ...prev };
        Object.keys(next).forEach((k) => { if (next[k] === block.id) next[k] = preset[k]; });
        return next;
      });
      Toast.success('已从我的样式库删除');
    } catch (e) {
      Toast.error('删除失败');
    }
  }, [themeKey]);

  // ── 收藏交互：样式块/照片星标切换（乐观更新，失败回拉全量对账）────
  const toggleStyleFav = React.useCallback(async (block) => {
    const existing = styleFavs.find((f) => f.refKey === block.id);
    try {
      if (existing) {
        setStyleFavs((prev) => prev.filter((f) => f.id !== existing.id));
        await removeFavorite(existing.id);
      } else {
        const payload = {
          type: block.type, name: block.name, htmlTemplate: block.htmlTemplate,
          accentEditable: !!block.accentEditable, source: block.source || 'builtin',
        };
        const resp = await addFavorite({ kind: 'styleBlock', refKey: block.id, payload });
        if (resp && resp.favorite) setStyleFavs((prev) => [resp.favorite, ...prev.filter((f) => f.refKey !== block.id)]);
        Toast.success('已收藏样式');
      }
    } catch (e) {
      console.error('[WechatComposer] toggle style fav failed', e);
      Toast.error('收藏操作失败');
      loadFavorites();
    }
  }, [styleFavs, loadFavorites]);

  const togglePhotoFav = React.useCallback(async (photo, next) => {
    const key = String(photo.id);
    const existing = photoFavs.find((f) => String(f.refKey) === key);
    try {
      if (!next && existing) {
        setPhotoFavs((prev) => prev.filter((f) => f.id !== existing.id));
        await removeFavorite(existing.id);
      } else if (next && !existing) {
        const resp = await addFavorite({ kind: 'photo', refKey: key, payload: photo });
        if (resp && resp.favorite) setPhotoFavs((prev) => [resp.favorite, ...prev.filter((f) => String(f.refKey) !== key)]);
        Toast.success('已收藏照片');
      }
    } catch (e) {
      console.error('[WechatComposer] toggle photo fav failed', e);
      Toast.error('收藏操作失败');
      loadFavorites();
    }
  }, [photoFavs, loadFavorites]);

  const handleRemoveFav = React.useCallback(async (favId) => {
    setStyleFavs((prev) => prev.filter((f) => f.id !== favId));
    setPhotoFavs((prev) => prev.filter((f) => f.id !== favId));
    setSnippetFavs((prev) => prev.filter((f) => f.id !== favId));
    try {
      await removeFavorite(favId);
    } catch (e) {
      console.error('[WechatComposer] remove fav failed', e);
      loadFavorites();
    }
  }, [loadFavorites]);

  // 框选后"收藏选中"：把选中的 DocBlock 数组存为 snippet 收藏（去掉 uid,插入时重新生成）
  const favoriteSelection = React.useCallback(async (blocks) => {
    if (!Array.isArray(blocks) || !blocks.length) return;
    const cleanBlocks = blocks.map(({ uid, ...rest }) => rest); // 剥 uid,再插入时 makeUid
    // 名称取第一个块的文字预览
    const first = blocks[0];
    const nameText = (first.content || first.html || first.caption || '')
      .replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 16) || `片段 ${blocks.length} 块`;
    const refKey = `snip-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    try {
      const resp = await addFavorite({ kind: 'snippet', refKey, payload: { name: nameText, blocks: cleanBlocks } });
      if (resp && resp.favorite) setSnippetFavs((prev) => [resp.favorite, ...prev]);
      Toast.success(`已收藏 ${blocks.length} 个元素为片段`);
    } catch (e) {
      console.error('[WechatComposer] favorite snippet failed', e);
      Toast.error(e && e.message && /413/.test(String(e.message)) ? '选中内容过大，无法收藏' : '收藏失败');
    }
  }, []);

  // 片段收藏点插：把片段里的所有块（重新生成 uid）追加到画布。
  // raw/para 块的 html 必须再过一遍客户端 sanitize——RawView/ParaView 无条件 innerHTML 写入,
  // 全靠"进 doc 前已清洗"这个不变量兜底；服务端正则清洗不完备(不拦 base/meta/link),
  // 唯有这里补上客户端 DOMPurify 才能与导入/编辑提交路径保持同一防线,防 base/meta refresh 注入。
  const insertSnippet = React.useCallback((snippetFav) => {
    const blocks = snippetFav && snippetFav.payload && Array.isArray(snippetFav.payload.blocks) ? snippetFav.payload.blocks : [];
    if (!blocks.length) { Toast.warning('该片段为空'); return; }
    const withUids = blocks.map((b) => {
      const clean = { ...b, uid: makeUid() };
      if (b && typeof b.html === 'string') {
        clean.html = b.kind === 'para' ? sanitizeParaHtml(b.html) : sanitizeRawHtml(b.html);
      }
      return clean;
    });
    const next = [...doc, ...withUids];
    applyDocChange(next);
    setSelectedUid(withUids[0].uid);
    Toast.success(`已插入片段（${withUids.length} 块）`);
  }, [doc, applyDocChange]);

  // 打开图片编辑器：解析目标图片当前 src（imageCard 取 block.src；raw 取第 N 个 img 的 src）
  const handleRequestImageEdit = React.useCallback((uid, imgIndex) => {
    const block = doc.find((b) => b.uid === uid);
    if (!block) return;
    let src = '';
    if (imgIndex === undefined) {
      src = block.src || '';
    } else {
      const m = String(block.html || '').match(/<img\b[^>]*>/gi) || [];
      const tag = m[imgIndex] || '';
      const sm = tag.match(/\ssrc\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/i);
      src = sm ? (sm[2] || sm[3] || sm[4] || '') : '';
    }
    if (!src) { Toast.warning('未找到可编辑的图片'); return; }
    setImgEditTarget({ uid, imgIndex, src });
  }, [doc]);

  // 图片编辑完成：把编辑后的 data URL 写回目标图片（imageCard 换 src / raw 换第 N img 的 src）
  const applyImageEdit = React.useCallback((dataUrl) => {
    if (!imgEditTarget || !dataUrl) { setImgEditTarget(null); return; }
    const { uid, imgIndex } = imgEditTarget;
    const next = doc.map((b) => {
      if (b.uid !== uid) return b;
      if (imgIndex === undefined) return { ...b, src: dataUrl };
      return { ...b, html: replaceRawImgSrc(b.html || '', imgIndex, dataUrl) };
    });
    applyDocChange(next);
    setImgEditTarget(null);
    Toast.success('已应用图片编辑');
  }, [imgEditTarget, doc, applyDocChange]);

  // 相册/收藏面板照片 → 画布 imageCard 块（不经中转站）
  const insertPanelPhoto = React.useCallback((photo) => {
    const url = (photo && (photo.url || photo.thumbUrl)) || '';
    if (!url) { Toast.warning('该照片缺少可用地址'); return; }
    const imageBlockId = effectiveConfig.imageCard;
    insertDocBlock({
      kind: 'styled', type: 'imageCard', blockId: imageBlockId,
      src: url, caption: String(photo.description || '').slice(0, 40), accent: null,
    });
    Toast.success('已插入图片卡');
  }, [effectiveConfig, insertDocBlock]);

  // 收藏样式点插：走 applyBlockPick（换样式模式/imageCard 先选图等语义天然复用）
  const handleFavInsertBlock = React.useCallback((blockLike) => {
    if (!blockLike || !blockLike.type) return;
    applyBlockPick(blockLike.type, blockLike.id);
  }, [applyBlockPick]);

  // 外部拖入画布：样式块 {kind:'style-block', data:{type,blockId}} / 照片 {kind:'photo-item', data:photo}
  const handleExternalDrop = React.useCallback((payload, insertIndex) => {
    if (!payload || !payload.kind || !payload.data) return;
    const next = [...doc];
    const idx = Math.max(0, Math.min(Number(insertIndex) || 0, next.length));

    if (payload.kind === 'photo-item') {
      const photo = payload.data;
      const url = photo.url || photo.thumbUrl || '';
      if (!url) return;
      const block = {
        kind: 'styled', type: 'imageCard', blockId: effectiveConfig.imageCard,
        src: url, caption: String(photo.description || '').slice(0, 40), accent: null, uid: makeUid(),
      };
      next.splice(idx, 0, block);
      applyDocChange(next);
      setSelectedUid(block.uid);
      return;
    }

    const data = payload.data;
    if (!data.type || !data.blockId) return;
    const base = {
      kind: 'styled', type: data.type, blockId: data.blockId, accent: null, uid: makeUid(),
    };
    const block = data.type === 'imageCard'
      ? { ...base, src: PREVIEW_IMG, caption: '点击图片从中转站选图' }
      : data.type === 'divider'
        ? base
        : { ...base, content: DEFAULT_CONTENT[data.type] || '' };
    next.splice(idx, 0, block);
    applyDocChange(next);
    setSelectedUid(block.uid);
  }, [doc, applyDocChange, DEFAULT_CONTENT, effectiveConfig]);

  const handleCopyRich = React.useCallback(async () => {
    if (!docHasContent) { Toast.warning('画布还是空的，先从样式库插入内容'); return; }
    try {
      // 画布与复制共用 docToHtml 同源渲染（所见即所得）；标题填在公众号后台标题栏，不进正文
      const { html } = docToHtml(doc, { blocksById, globalAccent: effectiveConfig.accent, body: effectiveConfig.body });
      // 复制到公众号时把背景图/图片的 /api/wx-img 代理链还原为原始 mmbiz 链接——代理链只在本站预览用，
      // 微信里无效；mmbiz 原链在微信 referer 下能显示（等同复制原文）。手机预览不做此还原（仍需代理）。
      const wechatHtml = unproxyWeChatImages(html);
      await copyWechatRichText({ html: wechatHtml, plainText: [title, digest, docToPlainText(doc)].filter(Boolean).join('\n\n') });
      Toast.success('已复制正文，去公众号后台粘贴即可（标题单独填）；<img> 图会被公众号自动转存，CSS 背景图沿用原文链接');
    } catch (e) {
      console.error('[WechatComposer] copy rich text failed', e);
      Toast.error(e && e.message ? e.message : '复制失败');
    }
  }, [docHasContent, doc, blocksById, effectiveConfig, title, digest]);

  // 手机预览：把当前排版渲染成 HTML 存到后端，拿到公开 token，拼成绝对 URL + 二维码，手机扫码即看
  const handleMobilePreview = React.useCallback(async () => {
    if (!docHasContent) { Toast.warning('画布还是空的，先从样式库插入内容'); return; }
    setPreviewGen(true);
    try {
      const { html } = docToHtml(doc, { blocksById, globalAccent: effectiveConfig.accent, body: effectiveConfig.body });
      const resp = await request('/api/wechat-preview', { method: 'POST', data: { title, digest, html } });
      const path = resp && resp.path;
      if (!path) throw new Error('生成预览失败');
      // 绝对 URL 用当前站点 origin 拼（生产 = mamage.wenyuli.site，手机可直达；本地 dev 手机不可达但流程可测）
      const url = `${window.location.origin}${path}`;
      setPreviewInfo({ url, qrSvg: makeQrSvg(url, { cellSize: 6, margin: 12 }) });
    } catch (e) {
      console.error('[WechatComposer] mobile preview failed', e);
      Toast.error(e && e.message ? `生成预览失败：${String(e.message).slice(0, 80)}` : '生成预览失败');
    } finally {
      setPreviewGen(false);
    }
  }, [docHasContent, doc, blocksById, effectiveConfig, title, digest]);

  const handleCopyPreviewUrl = React.useCallback(async () => {
    if (!previewInfo) return;
    try {
      if (!window.navigator || !window.navigator.clipboard || !window.navigator.clipboard.writeText) {
        throw new Error('当前浏览器不支持剪贴板写入');
      }
      await window.navigator.clipboard.writeText(previewInfo.url);
      Toast.success('已复制预览链接');
    } catch (e) {
      Toast.error(e && e.message ? e.message : '复制失败');
    }
  }, [previewInfo]);

  const handleDownloadPack = React.useCallback(async () => {
    const photos = doc.filter((b) => b.type === 'imageCard' && b.src).map((b, i) => ({ id: i + 1, url: b.src }));
    if (!photos.length) { Toast.warning('画布里没有图片，无需下载图片包'); return; }
    try {
      const n = await downloadImagePack({ photos, baseName: title || 'wechat' });
      Toast.success(`已下载 ${n} 张图片`);
    } catch (e) {
      console.error('[WechatComposer] downloadImagePack failed', e);
      Toast.error(e && e.message ? e.message : '下载失败');
    }
  }, [doc, title]);

  const handleCopyMarkdown = React.useCallback(async () => {
    if (!docHasContent) { Toast.warning('画布还是空的，先从样式库插入内容'); return; }
    try {
      if (!window.navigator || !window.navigator.clipboard || !window.navigator.clipboard.writeText) {
        throw new Error('当前浏览器不支持剪贴板写入');
      }
      await window.navigator.clipboard.writeText(docToPlainText(doc));
      Toast.success('已复制纯文本');
    } catch (e) {
      Toast.error(e && e.message ? e.message : '复制失败');
    }
  }, [docHasContent, doc]);

  // ── 推文文件管理器：列表 ──────────────────────────────────────
  const loadArchiveList = React.useCallback(async () => {
    setArchiveListLoading(true);
    setArchiveListError(false);
    try {
      const resp = await listCompositions();
      setArchiveList(Array.isArray(resp && resp.items) ? resp.items : []);
    } catch (e) {
      console.error('[WechatComposer] load compositions failed', e);
      setArchiveListError(true);
    } finally {
      setArchiveListLoading(false);
    }
  }, []);

  // 进入文件管理器（含挂载时 initial.view==='manager'）即拉最新文件列表
  React.useEffect(() => { if (view === 'manager') loadArchiveList(); }, [view, loadArchiveList]);

  // 把一份文件详情/空白恢复进编辑器：doc/title/digest/blockConfig/themeKey 各走既有受控 state 的 setter。
  // loadingRef 置 true 让 dirty 副作用跳过这一整批程序化变更（否则载入立刻被标脏）。
  // 撤销栈单独处理：直接把 historyRef 换成以载入内容为起点的新历史栈（不走 applyDocChange，
  // 否则会把"载入前的旧文档"押进历史栈，⌘Z 残影回载入前），载入瞬间撤销/重做即禁用态。
  const applyEditorState = React.useCallback((next) => {
    loadingRef.current = true;
    const nextDoc = Array.isArray(next && next.doc) ? next.doc : [];
    const nextBlockConfig = (next && next.blockConfig && typeof next.blockConfig === 'object') ? next.blockConfig : null;
    const nextThemeKey = (next && next.themeKey) || DEFAULT_THEME_KEY;
    setTitle((next && next.title) || '');
    setDigest((next && next.digest) || '');
    setThemeKey(nextThemeKey);
    setBlockConfig(nextBlockConfig);
    historyRef.current = createHistory(nextDoc);
    setDoc(nextDoc);
    setHistoryTick((t) => t + 1);
    setSelectedUid(null);
    setReplaceTarget(null);
    setPickerTarget(null);
  }, []);

  // 有未保存改动时拦截"离开当前文件"的动作（返回管理器/打开别的文件/新建），弹三选一确认。
  const guardLeave = React.useCallback((proceed) => {
    if (!dirty) { proceed(); return; }
    setLeavePrompt({ proceed });
  }, [dirty]);

  // 返回文件管理器 = 关闭当前文件：清空编辑器并复位 openId，草稿随之清空 → reload 仍落管理器；
  // 需要那份内容时从列表重新打开（拉服务端干净版本）。
  const reallyGoManager = React.useCallback(() => {
    applyEditorState(null);
    setOpenId(null);
    setOpenName('');
    setDirty(false);
    setView('manager');
  }, [applyEditorState]);

  const goToManager = React.useCallback(() => { guardLeave(reallyGoManager); }, [guardLeave, reallyGoManager]);

  const newFile = React.useCallback(() => {
    guardLeave(() => {
      applyEditorState(null);
      setOpenId(null);
      setOpenName('');
      setDirty(false);
      setView('editor');
    });
  }, [guardLeave, applyEditorState]);

  const openFileById = React.useCallback((item) => {
    guardLeave(async () => {
      setArchiveBusyKey(`${item.id}:open`);
      try {
        const full = await getComposition(item.id);
        applyEditorState(full);
        setOpenId(item.id);
        setOpenName((full && full.name) || item.name);
        setDirty(false);
        setView('editor');
      } catch (e) {
        console.error('[WechatComposer] open composition failed', e);
        Toast.error(e && e.status === 404 ? '该文件不存在或已被删除' : '打开失败，请稍后重试');
        loadArchiveList();
      } finally {
        setArchiveBusyKey(null);
      }
    });
  }, [guardLeave, applyEditorState, loadArchiveList]);

  // 保存当前文件：已是服务端文件→PUT 覆盖；尚未命名的新推文→弹命名弹窗后 POST 建档
  const saveOpen = React.useCallback(async () => {
    if (saving) return;
    if (openId == null) {
      pendingAfterSaveRef.current = null; // 普通保存不携带"保存后跳转"，清掉可能残留的离开动作
      setSaveMode('new');
      setRenameTargetId(null);
      setArchiveSaveName(String(title || '').trim() || defaultFileName());
      setArchiveSaveOpen(true);
      return;
    }
    setSaving(true);
    try {
      await updateComposition(openId, { name: openName, title, digest, doc, blockConfig: effectiveConfig, themeKey });
      setDirty(false);
      Toast.success('已保存');
    } catch (e) {
      console.error('[WechatComposer] save composition failed', e);
      if (e && e.status === 404) { Toast.error('文件已不存在，请重新命名保存'); setOpenId(null); }
      else if (e && e.status === 400) Toast.error('内容不合法或过大，保存失败');
      else Toast.error('保存失败，请稍后重试');
    } finally {
      setSaving(false);
    }
  }, [saving, openId, openName, title, digest, doc, effectiveConfig, themeKey]);
  React.useEffect(() => { saveOpenRef.current = saveOpen; }, [saveOpen]);

  // 命名弹窗确认：saveMode='new' 首次建档；'rename' 重命名已有文件
  const handleSaveNameConfirm = React.useCallback(async () => {
    const name = archiveSaveName.trim().slice(0, ARCHIVE_NAME_LIMIT) || defaultFileName();
    if (saveMode === 'rename' && renameTargetId != null) {
      try {
        await updateComposition(renameTargetId, { name });
        if (renameTargetId === openId) setOpenName(name);
        setArchiveSaveOpen(false);
        Toast.success('已重命名');
        loadArchiveList();
      } catch (e) {
        console.error('[WechatComposer] rename composition failed', e);
        Toast.error(e && e.status === 404 ? '该文件不存在或已被删除' : '重命名失败，请稍后重试');
      }
      return;
    }
    setSaving(true);
    try {
      const created = await saveComposition({ name, title, digest, doc, blockConfig: effectiveConfig, themeKey });
      setOpenId((created && created.id != null) ? created.id : null);
      setOpenName(name);
      setDirty(false);
      setArchiveSaveOpen(false);
      Toast.success('已保存');
      const after = pendingAfterSaveRef.current;
      pendingAfterSaveRef.current = null;
      if (after) after();
    } catch (e) {
      console.error('[WechatComposer] save composition failed', e);
      pendingAfterSaveRef.current = null;
      if (isArchiveLimitError(e)) {
        const limit = getArchiveLimitFromError(e);
        Toast.error(`推文文件已达上限${limit ? `（${limit} 篇）` : ''}，请删除一些旧文件再存`);
      } else if (e && e.status === 400) {
        Toast.error('内容不合法或过大，请精简后重试');
      } else {
        Toast.error('保存失败，请稍后重试');
      }
    } finally {
      setSaving(false);
    }
  }, [archiveSaveName, saveMode, renameTargetId, openId, title, digest, doc, effectiveConfig, themeKey, loadArchiveList]);

  // 离开确认三选一
  const handleLeaveSaveAndGo = React.useCallback(async () => {
    const proceed = leavePrompt && leavePrompt.proceed;
    setLeavePrompt(null);
    if (openId == null) {
      // 新推文：命名保存成功后再继续离开
      pendingAfterSaveRef.current = () => { if (proceed) proceed(); };
      setSaveMode('new');
      setRenameTargetId(null);
      setArchiveSaveName(String(title || '').trim() || defaultFileName());
      setArchiveSaveOpen(true);
      return;
    }
    setSaving(true);
    try {
      await updateComposition(openId, { name: openName, title, digest, doc, blockConfig: effectiveConfig, themeKey });
      setDirty(false);
      if (proceed) proceed();
    } catch (e) {
      console.error('[WechatComposer] save-before-leave failed', e);
      Toast.error('保存失败，未离开');
    } finally {
      setSaving(false);
    }
  }, [leavePrompt, openId, openName, title, digest, doc, effectiveConfig, themeKey]);

  const handleLeaveDiscardAndGo = React.useCallback(() => {
    const proceed = leavePrompt && leavePrompt.proceed;
    setLeavePrompt(null);
    setDirty(false);
    if (proceed) proceed();
  }, [leavePrompt]);

  // 文件行：重命名 / 复制 / 删除
  const handleRenameFile = React.useCallback((item) => {
    setSaveMode('rename');
    setRenameTargetId(item.id);
    setArchiveSaveName(item.name || '');
    setArchiveSaveOpen(true);
  }, []);

  const handleDuplicateFile = React.useCallback(async (item) => {
    setArchiveBusyKey(`${item.id}:dup`);
    try {
      const full = await getComposition(item.id);
      const dupName = `${(full && full.name) || item.name} 副本`.slice(0, ARCHIVE_NAME_LIMIT);
      await saveComposition({
        name: dupName,
        title: (full && full.title) || '',
        digest: (full && full.digest) || '',
        doc: (full && full.doc) || [],
        blockConfig: (full && full.blockConfig) || null,
        themeKey: (full && full.themeKey) || DEFAULT_THEME_KEY,
      });
      Toast.success('已复制');
      loadArchiveList();
    } catch (e) {
      console.error('[WechatComposer] duplicate composition failed', e);
      if (isArchiveLimitError(e)) Toast.error('推文文件已达上限，请删除一些再复制');
      else Toast.error('复制失败，请稍后重试');
    } finally {
      setArchiveBusyKey(null);
    }
  }, [loadArchiveList]);

  const handleDeleteArchiveItem = React.useCallback((item) => {
    Modal.confirm({
      title: '删除推文文件',
      content: `确定删除「${item.name}」？删除后不可恢复。`,
      okText: '删除',
      cancelText: '取消',
      onOk: async () => {
        const key = `${item.id}:delete`;
        setArchiveBusyKey(key);
        try {
          await deleteComposition(item.id);
          setArchiveList((prev) => prev.filter((row) => row.id !== item.id));
          if (openId === item.id) { setOpenId(null); setDirty(true); } // 删的是正在编辑的文件：转为未保存新推文态
          Toast.success('已删除');
        } catch (e) {
          console.error('[WechatComposer] delete composition failed', e);
          Toast.error('删除失败，请稍后重试');
        } finally {
          setArchiveBusyKey(null);
        }
      },
    });
  }, [openId]);

  return (
    <Layout style={{ padding: isMobile ? 10 : 16, overflowX: 'hidden' }}>
      {view === 'manager' ? (
        <Content>
          <div className="wxc-manager">
            <div className="wxc-manager-head">
              <h2 style={{ margin: 0 }}>公众号推文</h2>
              <Text type="secondary">选择一篇继续编辑，或新建一篇。推文存在服务端、跨设备可见。</Text>
            </div>
            <div className="wxc-manager-grid">
              <button type="button" className="wxc-manager-new" onClick={newFile}>
                <span className="wxc-manager-new-plus" aria-hidden="true">＋</span>
                <span>新建推文</span>
              </button>
              {archiveListLoading ? (
                <div className="wxc-manager-state"><Text type="secondary">加载中…</Text></div>
              ) : archiveListError ? (
                <div className="wxc-manager-state">
                  <p>加载推文列表失败，可能是网络问题。</p>
                  <Button size="small" onClick={loadArchiveList}>重试</Button>
                </div>
              ) : archiveList.length === 0 ? (
                <div className="wxc-manager-state"><Empty description="还没有推文，点「新建推文」开始排版" /></div>
              ) : (
                archiveList.map((item) => {
                  const busyAction = (archiveBusyKey && archiveBusyKey.startsWith(`${item.id}:`))
                    ? archiveBusyKey.slice(String(item.id).length + 1)
                    : null;
                  const rowBusy = !!busyAction;
                  return (
                    <div key={item.id} className="wxc-manager-card">
                      <button
                        type="button"
                        className="wxc-manager-card-open"
                        onClick={() => openFileById(item)}
                        disabled={rowBusy}
                        title={`打开「${item.name}」`}
                      >
                        <div className="wxc-manager-card-name">{item.name}</div>
                        <div className="wxc-manager-card-meta">{item.blockCount ?? 0} 块 · {item.imageCount ?? 0} 图</div>
                        <div className="wxc-manager-card-time">{formatArchiveTime(item.updatedAt)}</div>
                        {busyAction === 'open' ? <div className="wxc-manager-card-loading">打开中…</div> : null}
                      </button>
                      <div className="wxc-manager-card-actions">
                        <Button size="small" disabled={rowBusy} onClick={() => handleRenameFile(item)}>重命名</Button>
                        <Button size="small" loading={busyAction === 'dup'} disabled={rowBusy} onClick={() => handleDuplicateFile(item)}>复制</Button>
                        <Button size="small" type="danger" loading={busyAction === 'delete'} disabled={rowBusy} onClick={() => handleDeleteArchiveItem(item)}>删除</Button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </Content>
      ) : (
      <>
      <Header className="wxc-page-header" style={{ background: 'transparent', padding: 0, marginBottom: 12 }}>
        <div className="wxc-editor-bar">
          <Button size="small" onClick={goToManager}>← 文件管理</Button>
          <span className="wxc-editor-filename" title={openName || '未保存的新推文'}>
            {openName || '未保存的新推文'}
            {dirty ? <em className="wxc-dirty-dot" title="有未保存的更改">●</em> : null}
          </span>
          <span className="wxc-editor-bar-spacer" />
          <Button size="small" type="primary" loading={saving} onClick={saveOpen}>{openId == null ? '保存到文件' : '保存'}</Button>
        </div>

        <div className="wxc-meta-row">
          <div className="wxc-field">
            <label className="wxc-field-label" htmlFor="wxc-title-input">标题</label>
            <Input
              id="wxc-title-input"
              value={title}
              onChange={(v) => setTitle(v)}
              placeholder="文章标题，公众号列表页展示"
            />
            <span className={`wxc-field-count${titleOver ? ' is-over' : ''}`}>{titleLen}/{TITLE_LIMIT}</span>
          </div>
          <div className="wxc-field">
            <label className="wxc-field-label" htmlFor="wxc-digest-input">摘要（可选）</label>
            <Input
              id="wxc-digest-input"
              value={digest}
              onChange={(v) => setDigest(v)}
              placeholder="摘要，显示在分享卡片和消息列表"
            />
            <span className={`wxc-field-count${digestOver ? ' is-over' : ''}`}>{digestLen}/{DIGEST_LIMIT}</span>
          </div>
        </div>
      </Header>

      <Content>
        <div className="wxc-workspace">
          {/* 左侧面板：桌面常驻，窄屏由"样式库"按钮抽屉化；顶层三 Tab＝样式/相册/收藏 */}
          <aside className={`wxc-side-lib${libraryOpen ? ' is-open' : ''}`}>
            <div className="wxc-side-toptabs" role="tablist" aria-label="面板切换">
              {[['style', '样式'], ['album', '相册'], ['fav', '收藏']].map(([key, name]) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={sideTab === key}
                  className={`wxc-side-toptab${sideTab === key ? ' is-active' : ''}`}
                  onClick={() => switchSideTab(key)}
                >
                  {name}
                </button>
              ))}
            </div>
            {visitedTabs.album && (
              <div className="wxc-tabpane" style={sideTab === 'album' ? undefined : { display: 'none' }}>
                <AlbumPanel
                  onInsertPhoto={insertPanelPhoto}
                  onToggleFavorite={togglePhotoFav}
                  favoritePhotoKeys={favoritePhotoKeys}
                />
              </div>
            )}
            {visitedTabs.fav && (
              <div className="wxc-tabpane" style={sideTab === 'fav' ? undefined : { display: 'none' }}>
                {favError ? (
                  <div className="wxc-fav-loaderr">
                    <p>收藏加载失败，可能是网络问题。</p>
                    <Button size="small" onClick={loadFavorites}>重试</Button>
                  </div>
                ) : (
                  <FavoritesPanel
                    styleFavs={styleFavs}
                    photoFavs={photoFavs}
                    snippetFavs={snippetFavs}
                    renderBlockHtml={renderBlockPreview}
                    onInsertBlock={handleFavInsertBlock}
                    onInsertPhoto={insertPanelPhoto}
                    onInsertSnippet={insertSnippet}
                    onRemoveFav={handleRemoveFav}
                  />
                )}
              </div>
            )}
            {/* 样式 tab 用 display 显隐而非卸载：保住提取输入内容与块列表滚动位置 */}
            <div className="wxc-style-pane" style={sideTab === 'style' ? undefined : { display: 'none' }}>
            <div className="wxc-lib-extract">
              <input
                className="wxc-lib-extract-input"
                value={extractUrl}
                onChange={(e) => setExtractUrl(e.target.value)}
                placeholder="贴公众号推文链接…"
                onKeyDown={(e) => { if (e.key === 'Enter') handleExtract(); }}
              />
              <div className="wxc-lib-extract-actions">
                <Button size="small" type="primary" loading={extracting} disabled={extracting || importing} onClick={handleExtract} title="只提取排版样式为可复用样式块，不带文字">
                  {extracting ? '…' : '提取样式'}
                </Button>
                <Button size="small" loading={importing} disabled={extracting || importing} onClick={handleImportArticle} title="整篇复现到画布：文字、图片、排版全保留">
                  {importing ? '…' : '整文复现'}
                </Button>
              </div>
            </div>
            <div className="wxc-lib-tabs">
              {BLOCK_TYPES.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  className={`wxc-lib-tab${libType === t.key ? ' is-active' : ''}`}
                  onClick={() => setLibType(t.key)}
                >
                  {t.name}
                </button>
              ))}
            </div>
            <div className="wxc-lib-accents" title="主题色：作用于可换色的样式块，以及整文复现导入后识别出的推文配色（一键换色）">
              <span className="wxc-lib-accents-label">主题色</span>
              {ACCENT_CHOICES.map((hex) => (
                <button
                  key={hex}
                  type="button"
                  className={`wxc-lib-accent-dot${(effectiveConfig.accent || '').toLowerCase() === hex ? ' is-active' : ''}`}
                  style={{ background: hex }}
                  onClick={() => applyAccent(hex)}
                  aria-label={`主题色 ${hex}`}
                />
              ))}
              {/* 任意取色：native color input，超出 8 个预设时用；派生浅底/深字/辅助色联动整篇 */}
              <label className="wxc-lib-accent-custom" title="自定义主题色">
                <input
                  type="color"
                  value={/^#[0-9a-fA-F]{6}$/.test(effectiveConfig.accent || '') ? effectiveConfig.accent : '#1a1a1a'}
                  onChange={(e) => applyAccent(e.target.value)}
                  aria-label="自定义主题色"
                />
              </label>
            </div>
            {replaceTarget ? (
              <div className="wxc-lib-replace-bar">
                正在为选中块换样式
                <button type="button" onClick={() => setReplaceTarget(null)}>取消</button>
              </div>
            ) : null}
            <div className="wxc-lib-list">
              {[...Object.values(blocksById)].filter((b) => b.type === libType).map((b) => (
                <div
                  key={b.id}
                  role="button"
                  tabIndex={0}
                  // 拖拽走 pointerDrag 自研引擎；未过移动阈值的按压不影响 onClick 点击插入。
                  // preventDefault 保住 raw 容器的焦点/选区：否则点击本卡片会让浏览器把焦点从
                  // raw contentEditable 夺走，触发其 blur→sanitizeRawHtml 重写 DOM，使缓存的
                  // 光标 Range 指向脱离文档的旧节点，容器内嵌套插入会静默降级为顶层块。
                  // onDragStart preventDefault 另掐灭块内 img/文字的浏览器原生拖拽（会掐断自研拖拽）。
                  onPointerDown={(e) => { e.preventDefault(); beginDrag(e, { kind: 'style-block', data: { type: b.type, blockId: b.id }, ghostLabel: b.name }); }}
                  onDragStart={(e) => e.preventDefault()}
                  className={`wxc-lib-block${effectiveConfig[libType] === b.id ? ' is-active' : ''}`}
                  onClick={() => applyBlockPick(libType, b.id)}
                  onKeyDown={(e) => { if (e.key === 'Enter') applyBlockPick(libType, b.id); }}
                  title={`${b.name}（点击插入 / 拖到画布定位插入）`}
                >
                  <div className="wxc-lib-block-stage">
                    <div
                      className="wxc-lib-block-scale"
                      // eslint-disable-next-line react/no-danger
                      dangerouslySetInnerHTML={{ __html: renderBlockPreview(b) }}
                    />
                  </div>
                  <div className="wxc-lib-block-meta">
                    <span className="wxc-lib-block-name">{b.name}</span>
                    <button
                      type="button"
                      className={`wxc-lib-block-star${favoriteBlockKeys.has(b.id) ? ' is-on' : ''}`}
                      title={favoriteBlockKeys.has(b.id) ? '取消收藏' : '收藏样式'}
                      aria-label={favoriteBlockKeys.has(b.id) ? '取消收藏' : '收藏样式'}
                      onClick={(e) => { e.stopPropagation(); toggleStyleFav(b); }}
                      onPointerDown={(e) => e.stopPropagation()}
                    >
                      {favoriteBlockKeys.has(b.id) ? '★' : '☆'}
                    </button>
                    {b.source === 'extracted' ? (
                      <>
                        <span className="wxc-lib-badge">我的库</span>
                        <button
                          type="button"
                          className="wxc-lib-block-del"
                          title="从我的样式库删除"
                          onClick={(e) => { e.stopPropagation(); handleDeleteMyBlock(b); }}
                          onPointerDown={(e) => e.stopPropagation()}
                        >
                          ×
                        </button>
                      </>
                    ) : null}
                  </div>
                </div>
              ))}
              {libType === 'signoff' ? (
                <div
                  role="button"
                  tabIndex={0}
                  className={`wxc-lib-block wxc-lib-block--none${effectiveConfig.signoff === null ? ' is-active' : ''}`}
                  onClick={() => applyBlockPick('signoff', null)}
                >
                  <div className="wxc-lib-block-stage"><span className="wxc-lib-none-text">不要落款</span></div>
                </div>
              ) : null}
            </div>
            </div>
          </aside>

          <div className="wxc-workarea">
            <div className="wxc-canvas-region">
              <div className="wxc-canvas-toolbar">
                <div className="wxc-canvas-toolbar-left">
                  {/* 窄屏打开左侧样式面板的入口；插图入口收敛为一个「＋插图」 */}
                  <Button size="small" className="wxc-lib-toggle-mobile" onClick={() => setLibraryOpen((v) => !v)}>☰ 样式面板</Button>
                  <Button size="small" type="tertiary" onClick={() => { setPickerTarget(null); setPickerOpen(true); }} title="从中转站插入照片">＋ 插图</Button>
                  <Text type="secondary" className="wxc-canvas-tip">点左侧样式插入，点画布块直接编辑</Text>
                </div>
                <div className="wxc-canvas-toolbar-right">
                  <Button size="small" type="tertiary" disabled={!historyRef.current.canUndo()} onClick={handleUndo} title="撤销 ⌘Z" aria-label="撤销">↩</Button>
                  <Button size="small" type="tertiary" disabled={!historyRef.current.canRedo()} onClick={handleRedo} title="重做 ⌘⇧Z" aria-label="重做">↪</Button>
                </div>
              </div>
              <CanvasEditor
                ref={canvasApiRef}
                doc={doc}
                onChange={applyDocChange}
                selectedUid={selectedUid}
                onSelect={setSelectedUid}
                blocksById={blocksById}
                globalAccent={effectiveConfig.accent}
                bodyConfig={effectiveConfig.body}
                onRequestStylePicker={(type, uid) => { setSideTab('style'); setLibType(type); setReplaceTarget(uid); setLibraryOpen(true); }}
                onRequestImagePick={(uid, imgIndex) => {
                  setPickerTarget(imgIndex !== undefined ? { uid, imgIndex } : uid);
                  setPickerOpen(true);
                }}
                onRequestImageEdit={handleRequestImageEdit}
                onExternalDrop={handleExternalDrop}
                onNotify={(type, msg) => { (Toast[type] || Toast.info)(msg); }}
                onFavoriteSelection={favoriteSelection}
              />
            </div>

            <Card bordered className="wxc-export-card">
              {/* 导出区按交互优先级收敛：主操作「复制到公众号」+ 常用「手机预览」+「更多」溢出菜单，
                  从 5 个平铺按钮降到 3 个，建立主次层级，窄屏也不再挤成一片 */}
              <div className="wxc-export-row">
                <Button type="primary" className="wxc-export-primary" onClick={handleCopyRich}>复制到公众号</Button>
                <Button onClick={handleMobilePreview} loading={previewGen} disabled={previewGen}>📱 手机预览</Button>
                <div className="wxc-export-more" ref={exportMenuRef}>
                  <Button
                    type="tertiary"
                    onClick={() => setExportMenuOpen((v) => !v)}
                    aria-haspopup="menu"
                    aria-expanded={exportMenuOpen}
                    className={`wxc-export-more-btn${exportMenuOpen ? ' is-open' : ''}`}
                  >
                    更多 ⌄
                  </Button>
                  {exportMenuOpen ? (
                    <div className="wxc-export-menu" role="menu">
                      <button type="button" className="wxc-export-menu-item" role="menuitem" onClick={() => { setExportMenuOpen(false); handleDownloadPack(); }}>下载图片包</button>
                      <button type="button" className="wxc-export-menu-item" role="menuitem" onClick={() => { setExportMenuOpen(false); handleCopyMarkdown(); }}>复制 Markdown</button>
                      <button type="button" className="wxc-export-menu-item is-disabled" role="menuitem" disabled title="需企业公众号资质配置，即将开放">发送到草稿箱（即将开放）</button>
                    </div>
                  ) : null}
                </div>
              </div>
            </Card>
          </div>
        </div>
      </Content>
      </>
      )}

      <Modal
        visible={pickerOpen}
        title="从中转站插图（点击插入到光标处）"
        onCancel={() => setPickerOpen(false)}
        footer={null}
      >
        {stationItems.length ? (
          <div className="wxc-photopick-grid">
            {stationItems.map((it) => (
              <button
                key={it.id}
                type="button"
                className="wxc-photopick-thumb"
                onClick={() => insertPhoto(it)}
                title={it.description || `插入照片 #${it.id}`}
              >
                {it.thumbUrl ? (
                  <img src={it.thumbUrl} alt={it.description || `#${it.id}`} loading="lazy" />
                ) : (
                  <span className="wxc-photopick-fallback">#{it.id}</span>
                )}
              </button>
            ))}
          </div>
        ) : (
          <Text type="secondary">
            中转站还没有照片。先打开相册，把要用的照片存入右侧中转站，再回来插图。
          </Text>
        )}
      </Modal>

      {/* 提取结果确认：预览识别出的样式块，勾选后存入我的样式库 */}
      <Modal
        title={`提取到 ${extractedBlocks ? extractedBlocks.length : 0} 个样式块（勾选要保存的）`}
        visible={!!extractedBlocks}
        onCancel={() => setExtractedBlocks(null)}
        footer={null}
        width={isMobile ? 'calc(100vw - 16px)' : 720}
      >
        {extractedBlocks ? (
          <div className="wxc-extract-body">
            <div className="wxc-lib-grid">
              {extractedBlocks.map((b, i) => (
                <div
                  key={i}
                  role="button"
                  tabIndex={0}
                  className={`wxc-lib-block${extractPicked[i] ? ' is-active' : ''}`}
                  onClick={() => setExtractPicked((prev) => ({ ...prev, [i]: !prev[i] }))}
                >
                  <div className="wxc-lib-block-stage">
                    <div
                      className="wxc-lib-block-scale"
                      // eslint-disable-next-line react/no-danger
                      dangerouslySetInnerHTML={{ __html: renderBlockPreview({ ...b, id: `ext-${i}` }) }}
                    />
                  </div>
                  <div className="wxc-lib-block-meta">
                    <span className="wxc-lib-block-name">{b.name || `提取块 ${i + 1}`}</span>
                    <span className="wxc-lib-badge">{(BLOCK_TYPES.find((t) => t.key === b.type) || {}).name || b.type}</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="wxc-extract-actions">
              <Button type="tertiary" onClick={() => setExtractedBlocks(null)}>取消</Button>
              <Button type="primary" loading={savingExtract} disabled={savingExtract} onClick={handleSaveExtracted}>
                存入我的样式库（{Object.values(extractPicked).filter(Boolean).length}）
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>

      {/* 整文复现：完整推文预览层，单击选块/双击改字/框选多选，选完再决定替换或追加 */}
      <ImportPreviewModal
        visible={!!importResult}
        result={importResult}
        canvasHasContent={docHasContent}
        onCancel={() => setImportResult(null)}
        onImport={(selectedBlocks, mode) => applyImportedArticle({ ...importResult, blocks: selectedBlocks }, mode)}
      />

      {/* 图片编辑器：裁切/旋转/翻转/比例/滤镜，输出 data URL 写回图片 */}
      <ImageEditorModal
        visible={!!imgEditTarget}
        src={imgEditTarget ? imgEditTarget.src : ''}
        onCancel={() => setImgEditTarget(null)}
        onApply={applyImageEdit}
      />

      {/* 手机预览：扫码或复制链接，手机上直接打开看排版效果 */}
      <Modal
        title="手机预览"
        visible={!!previewInfo}
        onCancel={() => setPreviewInfo(null)}
        footer={null}
        width={isMobile ? 'calc(100vw - 16px)' : 380}
      >
        {previewInfo ? (
          <div className="wxc-qr-body">
            <p className="wxc-qr-hint">用手机扫码，或复制链接在手机浏览器打开，即可看到排版效果（链接 20 分钟内有效）。</p>
            <div
              className="wxc-qr-code"
              // eslint-disable-next-line react/no-danger -- qrSvg 由 qrcode-generator 生成的纯 SVG，无外部输入
              dangerouslySetInnerHTML={{ __html: previewInfo.qrSvg }}
            />
            <div className="wxc-qr-url" title={previewInfo.url}>{previewInfo.url}</div>
            <div className="wxc-qr-actions">
              <Button type="primary" onClick={handleCopyPreviewUrl}>复制链接</Button>
              <Button type="tertiary" onClick={() => window.open(previewInfo.url, '_blank', 'noopener')}>本机打开</Button>
            </div>
          </div>
        ) : null}
      </Modal>

      {/* 命名弹窗：首次把新推文保存为服务端文件（saveMode=new），或给已有文件重命名（saveMode=rename） */}
      <Modal
        title={saveMode === 'rename' ? '重命名推文' : '保存推文文件'}
        visible={archiveSaveOpen}
        onCancel={() => { setArchiveSaveOpen(false); pendingAfterSaveRef.current = null; }}
        onOk={handleSaveNameConfirm}
        okText={saveMode === 'rename' ? '重命名' : '保存'}
        cancelText="取消"
        okButtonProps={{ loading: saving }}
      >
        <div className="wxc-archive-save-body">
          <label className="wxc-field-label" htmlFor="wxc-archive-name-input">推文名称</label>
          <Input
            id="wxc-archive-name-input"
            value={archiveSaveName}
            onChange={(v) => setArchiveSaveName(v)}
            placeholder="未命名推文"
            maxLength={ARCHIVE_NAME_LIMIT}
            onEnterPress={handleSaveNameConfirm}
          />
        </div>
      </Modal>

      {/* 离开当前文件前的未保存提醒：保存并离开 / 不保存离开 / 取消 */}
      <Modal
        title="有未保存的更改"
        visible={!!leavePrompt}
        onCancel={() => setLeavePrompt(null)}
        footer={null}
        width={isMobile ? 'calc(100vw - 16px)' : 420}
      >
        <div className="wxc-leave-prompt">
          <p>当前推文有未保存的更改，离开后未保存的修改将丢失。</p>
          <div className="wxc-leave-actions">
            <Button type="primary" loading={saving} onClick={handleLeaveSaveAndGo}>保存并离开</Button>
            <Button type="danger" onClick={handleLeaveDiscardAndGo}>不保存离开</Button>
            <Button type="tertiary" onClick={() => setLeavePrompt(null)}>取消</Button>
          </div>
        </div>
      </Modal>
    </Layout>
  );
}

export default WechatComposer;
