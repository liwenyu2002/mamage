// src/App.jsx
import React from 'react';
import { Typography as UiTypography, Button as UiButton, Empty as UiEmpty, Card as UiCard, Toast, HexLoader } from './ui';
import ProjectCard from './ProjectCard';
import * as authService from './services/authService';
import { fetchProjectList, createProject } from './services/projectService';
import { searchPhotos } from './services/photoQueryService';
import { resolveAssetUrl } from './services/request';
import IfCan from './permissions/IfCan';
import { LiquidGlassDefs } from './liquidGlass';
import { initLiquidLens } from './liquidLens';

const lazyWithPreload = (loader) => {
  const Component = React.lazy(loader);
  Component.preload = loader;
  return Component;
};

const ProjectDetail = lazyWithPreload(() => import(/* webpackChunkName: "project-detail" */ './ProjectDetail'));
const ShareView = lazyWithPreload(() => import(/* webpackChunkName: "share-view" */ './ShareView'));
const AuthPage = lazyWithPreload(() => import(/* webpackChunkName: "auth-page" */ './AuthPage'));
const CreateAlbumModal = lazyWithPreload(() => import(/* webpackChunkName: "create-album" */ './CreateAlbumModal'));
const TransferStation = lazyWithPreload(() => import(/* webpackChunkName: "transfer-station" */ './TransferStation'));
const PhotoPreviewOverlay = lazyWithPreload(() => import(/* webpackChunkName: "photo-preview" */ './PhotoPreviewOverlay.jsx'));
const Scenery = lazyWithPreload(() => import(/* webpackChunkName: "scenery" */ './Scenery'));
const AccountPage = lazyWithPreload(() => import(/* webpackChunkName: "account-page" */ './AccountPage'));
const AiNewsWriter = lazyWithPreload(() => import(/* webpackChunkName: "ai-news-writer" */ './AiNewsWriter.jsx'));
const GroupRescue = lazyWithPreload(() => import(/* webpackChunkName: "group-rescue" */ './GroupRescue.jsx'));
const WechatComposer = lazyWithPreload(() => import(/* webpackChunkName: "wechat-composer" */ './WechatComposer.jsx'));

const PROJECT_PAGE_SIZE = 24;

function formatHeaderDate(val) {
  if (!val && val !== 0) return '';
  try {
    const dt = (typeof val === 'string' || typeof val === 'number') ? new Date(val) : (val instanceof Date ? val : new Date(String(val)));
    if (Number.isNaN(dt.getTime())) return '';
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, '0');
    const d = String(dt.getDate()).padStart(2, '0');
    const hh = String(dt.getHours()).padStart(2, '0');
    const mm = String(dt.getMinutes()).padStart(2, '0');
    return `${y}-${m}-${d} ${hh}:${mm}`;
  } catch (e) {
    return '';
  }
}

function AppLoadingState({ title = '正在加载', subtitle = '请稍候', compact = false }) {
  return (
    <div className={`app-loading-state${compact ? ' is-compact' : ''}`}>
      <HexLoader size={compact ? 46 : 60} className="app-loading-mark" />
      <div className="app-loading-title">{title}</div>
      {subtitle ? <div className="app-loading-subtitle">{subtitle}</div> : null}
    </div>
  );
}

function LazyPanel({ children, title = '正在加载功能' }) {
  return (
    <React.Suspense
      fallback={(
        <div className="mamage-route-loading" role="status" aria-live="polite">
          <AppLoadingState title={title} subtitle="马上打开" compact />
        </div>
      )}
    >
      {children}
    </React.Suspense>
  );
}

function LazySilent({ children }) {
  return (
    <React.Suspense fallback={null}>
      {children}
    </React.Suspense>
  );
}

// 以下四个组件委托给 src/ui 组件库渲染，保证首页/搜索页与全站视觉一致
function Text({ children, type = '', strong = false, size = '', style }) {
  return <UiTypography.Text type={type} strong={strong} size={size} style={style}>{children}</UiTypography.Text>;
}

function Button({ children, className = '', disabled = false, loading = false, onClick, size = '', style }) {
  return (
    <UiButton className={className} disabled={disabled} loading={loading} onClick={onClick} size={size} style={style}>
      {children}
    </UiButton>
  );
}

function Empty({ description = '暂无内容' }) {
  return <UiEmpty description={description} />;
}

function Card({ title, children }) {
  return <UiCard title={title}>{children}</UiCard>;
}

// 钉钉 OAuth 回调把 JWT 挂在 fragment 上（不进服务器日志）；模块加载即落地并清理
try {
  const dtkMatch = String(window.location.hash || '').match(/dingtalk_token=([^&]+)/);
  if (dtkMatch) {
    localStorage.setItem('mamage_jwt_token', decodeURIComponent(dtkMatch[1]));
    window.history.replaceState({}, '', window.location.pathname + window.location.search);
  }
} catch (e) { /* ignore */ }

function App() {
  React.useEffect(() => initLiquidLens(), []);
  const [projects, setProjects] = React.useState([]);
  const [projectPage, setProjectPage] = React.useState(1);
  const [projectHasMore, setProjectHasMore] = React.useState(false);
  const [projectTotal, setProjectTotal] = React.useState(0);
  const [projectQuery, setProjectQuery] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState(null);
  const [keyword, setKeyword] = React.useState('');
  const [currentProjectId, setCurrentProjectId] = React.useState(null);
  const [activeProjectHeader, setActiveProjectHeader] = React.useState(null);
  const [pendingOpenPhotoId, setPendingOpenPhotoId] = React.useState(null);
  const [selectedNav, setSelectedNav] = React.useState('projects');
  const [showCreateModal, setShowCreateModal] = React.useState(false);
  const [functionPage, setFunctionPage] = React.useState(null);
  const [currentUser, setCurrentUser] = React.useState(null);
  const [authLoading, setAuthLoading] = React.useState(() => {
    try {
      return Boolean(authService.getToken && authService.getToken());
    } catch (e) {
      return false;
    }
  });
  const [isMobileHeader, setIsMobileHeader] = React.useState(() => (typeof window !== 'undefined' ? window.innerWidth <= 1024 : false));
  const [mobileNavVisible, setMobileNavVisible] = React.useState(false);
  const [projectInfoOpen, setProjectInfoOpen] = React.useState(false);
  const [shareMode, setShareMode] = React.useState(false);
  const [shareInitialProject, setShareInitialProject] = React.useState(null);
  const [photoSearchMode, setPhotoSearchMode] = React.useState(false);
  const [photoSearchResults, setPhotoSearchResults] = React.useState([]);
  const [photoSearchLoading, setPhotoSearchLoading] = React.useState(false);
  const [photoSearchError, setPhotoSearchError] = React.useState(null);
  const [photoSearchHasMore, setPhotoSearchHasMore] = React.useState(false);
  const [photoSearchPage, setPhotoSearchPage] = React.useState(1);
  const [photoSearchTotal, setPhotoSearchTotal] = React.useState(0);
  const [hoverPhotoSearchIdx, setHoverPhotoSearchIdx] = React.useState(-1);
  const [photoPreviewVisible, setPhotoPreviewVisible] = React.useState(false);
  const [photoPreviewSrc, setPhotoPreviewSrc] = React.useState('');
  const [photoPreviewTitle, setPhotoPreviewTitle] = React.useState('');
  const [photoPreviewDescription, setPhotoPreviewDescription] = React.useState('');
  const [photoPreviewTags, setPhotoPreviewTags] = React.useState([]);
  const [mountTransferStation, setMountTransferStation] = React.useState(false);
  const isSharePath = (() => {
    try {
      return typeof window !== 'undefined' && window.location && window.location.pathname && window.location.pathname.startsWith('/share/');
    } catch (e) {
      return false;
    }
  })();
  const isDemoPath = (() => {
    try {
      if (typeof window === 'undefined' || !window.location) return false;
      const p = String(window.location.pathname || '').toLowerCase();
      return p === '/demo' || p === '/demo/';
    } catch (e) {
      return false;
    }
  })();


  const latestRequestRef = React.useRef(0);
  const latestPhotoSearchReqRef = React.useRef(0);
  const userMenuRef = React.useRef(null);

  // 用户菜单（原生 <details>）：点外部/按 Esc 关闭；点菜单项后也自动收起
  React.useEffect(() => {
    const onDocClick = (e) => {
      const el = userMenuRef.current;
      if (!el || !el.open) return;
      const summary = el.querySelector('summary');
      if (summary && summary.contains(e.target)) return; // 原生 toggle 自己处理
      el.open = false;
    };
    const onKey = (e) => {
      const el = userMenuRef.current;
      if (e.key === 'Escape' && el && el.open) el.open = false;
    };
    document.addEventListener('click', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  const preloadProjectDetail = React.useCallback(() => {
    if (ProjectDetail.preload) ProjectDetail.preload();
  }, []);

  const preloadCreateAlbum = React.useCallback(() => {
    if (CreateAlbumModal.preload) CreateAlbumModal.preload();
  }, []);

  const preloadNavItem = React.useCallback((key) => {
    if (key === 'scenery' && Scenery.preload) Scenery.preload();
    if (key === 'function' && AiNewsWriter.preload) AiNewsWriter.preload();
  }, []);

  const loadProjects = React.useCallback(async (kw = '', page = 1, pageSize = PROJECT_PAGE_SIZE) => {
    const currentToken = latestRequestRef.current + 1;
    latestRequestRef.current = currentToken;
    const normalizedKw = String(kw || '').trim();
    const normalizedPage = Number.isFinite(Number(page)) && Number(page) > 0 ? Math.floor(Number(page)) : 1;
    const normalizedPageSize = Number.isFinite(Number(pageSize)) && Number(pageSize) > 0 ? Math.floor(Number(pageSize)) : PROJECT_PAGE_SIZE;
    setProjectQuery(normalizedKw);
    setLoading(true);
    setError(null);
    try {
      // 后端分页接口：GET /api/projects/list?page=1&pageSize=24&keyword=xxx
      const response = await fetchProjectList({ page: normalizedPage, pageSize: normalizedPageSize, keyword: normalizedKw || undefined, demo: isDemoPath });
      if (latestRequestRef.current !== currentToken) return;

      const list = Array.isArray(response?.list) ? response.list : [];
      setProjects(list);
      setProjectPage(Number(response?.page) > 0 ? Number(response.page) : normalizedPage);
      setProjectHasMore(Boolean(response?.hasMore));
      setProjectTotal(Number(response?.total) || 0);
    } catch (err) {
      if (latestRequestRef.current !== currentToken) return;
      // 灞曠ず鏇磋缁嗙殑閿欒淇℃伅锛堝悗绔彲鑳芥惡甯?body锛?
      const message = err?.body || err?.message || '获取项目列表失败';
      console.error('loadProjects error:', err);
      setError(message);
      setProjects([]);
      setProjectHasMore(false);
      setProjectTotal(0);
    } finally {
      if (latestRequestRef.current === currentToken) {
        setLoading(false);
      }
    }
  }, [isDemoPath]);

  const clearPhotoSearchState = React.useCallback(() => {
    setPhotoSearchMode(false);
    setPhotoSearchResults([]);
    setPhotoSearchLoading(false);
    setPhotoSearchError(null);
    setPhotoSearchHasMore(false);
    setPhotoSearchPage(1);
    setPhotoSearchTotal(0);
    setHoverPhotoSearchIdx(-1);
  }, []);

  const loadPhotoSearchResults = React.useCallback(async ({ kw = '', page = 1, append = false } = {}) => {
    const trimmed = String(kw || '').trim();
    if (!trimmed) {
      clearPhotoSearchState();
      return;
    }

    const currentToken = latestPhotoSearchReqRef.current + 1;
    latestPhotoSearchReqRef.current = currentToken;
    setPhotoSearchLoading(true);
    setPhotoSearchError(null);
    try {
      const response = await searchPhotos({
        q: trimmed,
        page,
        pageSize: 24,
        sort: 'relevance',
        demo: isDemoPath,
      });
      if (latestPhotoSearchReqRef.current !== currentToken) return;

      const list = Array.isArray(response?.list) ? response.list : [];
      const mapped = list.map((item) => ({
        ...item,
        url: item?.url ? resolveAssetUrl(item.url) : null,
        thumbUrl: item?.thumbUrl ? resolveAssetUrl(item.thumbUrl) : (item?.url ? resolveAssetUrl(item.url) : null),
      }));

      setPhotoSearchResults((prev) => (append ? [...prev, ...mapped] : mapped));
      setPhotoSearchMode(true);
      setPhotoSearchPage(page);
      setPhotoSearchTotal(Number(response?.total) || 0);
      setPhotoSearchHasMore(Boolean(response?.hasMore));
    } catch (err) {
      if (latestPhotoSearchReqRef.current !== currentToken) return;
      const message = err?.body || err?.message || '搜索照片失败';
      setPhotoSearchError(message);
      if (!append) setPhotoSearchResults([]);
      setPhotoSearchHasMore(false);
    } finally {
      if (latestPhotoSearchReqRef.current === currentToken) {
        setPhotoSearchLoading(false);
      }
    }
  }, [clearPhotoSearchState, isDemoPath]);

  React.useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  React.useEffect(() => {
    setActiveProjectHeader(null);
    setProjectInfoOpen(false);
  }, [currentProjectId]);

  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    let frame = 0;
    const apply = () => {
      frame = 0;
      setIsMobileHeader(window.innerWidth <= 1024);
    };
    const onResize = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(apply);
    };
    apply();
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, []);

  React.useEffect(() => {
    if (typeof window === 'undefined') {
      setMountTransferStation(true);
      return undefined;
    }
    let canceled = false;
    const mount = () => {
      if (!canceled) setMountTransferStation(true);
    };
    const idleId = typeof window.requestIdleCallback === 'function'
      ? window.requestIdleCallback(mount, { timeout: 1600 })
      : window.setTimeout(mount, 900);
    return () => {
      canceled = true;
      if (typeof window.cancelIdleCallback === 'function') {
        window.cancelIdleCallback(idleId);
      } else {
        window.clearTimeout(idleId);
      }
    };
  }, []);

  // load current user on app start (fetch permissions from backend)
  React.useEffect(() => {
    // If this is a public share page, skip the global auth check to avoid
    // redirecting/showing the login UI before share content is loaded.
    if (isSharePath) {
      setAuthLoading(false);
      return;
    }

    const token = (typeof authService.getToken === 'function') ? authService.getToken() : null;
    if (!token) {
      setCurrentUser(null);
      setAuthLoading(false);
      return;
    }

    let canceled = false;
    (async () => {
      setAuthLoading(true);
      try {
        const u = await authService.me();
        if (canceled) return;
        // u now includes permissions array from backend: { id, username, role, permissions: [...] }
        setCurrentUser(u);
      } catch (e) {
        setCurrentUser(null);
      } finally {
        if (!canceled) setAuthLoading(false);
      }
    })();
    return () => { canceled = true; };
  }, []);

  const handleSearchSubmit = React.useCallback(() => {
    const trimmed = String(keyword || '').trim();
    setSelectedNav('projects');
    setCurrentProjectId(null);
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete('projectId');
      const base = isDemoPath ? '/demo' : (url.pathname && url.pathname !== '/' ? '/' : url.pathname || '/');
      window.history.pushState({}, '', base + (url.search ? url.search : ''));
    } catch (e) {
      // ignore
    }
    if (!trimmed) {
      clearPhotoSearchState();
      loadProjects('', 1, PROJECT_PAGE_SIZE);
      return;
    }
    setPhotoSearchMode(true);
    setPhotoSearchResults([]);
    setPhotoSearchError(null);
    setPhotoSearchHasMore(false);
    setPhotoSearchPage(1);
    setPhotoSearchTotal(0);
    loadProjects(trimmed, 1, PROJECT_PAGE_SIZE);
    loadPhotoSearchResults({ kw: trimmed, page: 1, append: false });
  }, [keyword, loadPhotoSearchResults, clearPhotoSearchState, loadProjects, isDemoPath]);

  const handlePhotoSearchLoadMore = React.useCallback(() => {
    if (photoSearchLoading || !photoSearchHasMore) return;
    loadPhotoSearchResults({ kw: keyword, page: photoSearchPage + 1, append: true });
  }, [photoSearchLoading, photoSearchHasMore, loadPhotoSearchResults, keyword, photoSearchPage]);

  const openPhotoPreview = React.useCallback((photo) => {
    const src = photo?.thumbUrl || photo?.url || '';
    if (!src) return;
    let tags = [];
    if (Array.isArray(photo?.tags)) {
      tags = photo.tags.map((t) => String(t).trim()).filter(Boolean);
    } else if (typeof photo?.tags === 'string') {
      const raw = photo.tags.trim();
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            tags = parsed.map((t) => String(t).trim()).filter(Boolean);
          } else {
            tags = raw.split(',').map((t) => t.trim()).filter(Boolean);
          }
        } catch (e) {
          tags = raw.split(',').map((t) => t.trim()).filter(Boolean);
        }
      }
    }

    setPhotoPreviewSrc(src);
    setPhotoPreviewTitle(photo?.title || photo?.projectName || '照片预览');
    setPhotoPreviewDescription(photo?.description ? String(photo.description) : '');
    setPhotoPreviewTags(tags.slice(0, 20));
    setPhotoPreviewVisible(true);
  }, []);

  const closePhotoPreview = React.useCallback(() => {
    setPhotoPreviewVisible(false);
  }, []);

  const handleSelectProject = React.useCallback((projectId) => {
    setCurrentProjectId(projectId);
    setPendingOpenPhotoId(null);
    setSelectedNav('projects');
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('projectId', projectId);
      url.searchParams.delete('photoId');
      window.history.pushState({}, '', url);
    } catch (e) {
      // ignore
    }
  }, []);

  const handleBackToList = React.useCallback(() => {
    setCurrentProjectId(null);
    setSelectedNav('projects');
    setKeyword('');
    clearPhotoSearchState();
    loadProjects('', 1, PROJECT_PAGE_SIZE);
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete('projectId');
      url.searchParams.delete('photoId');
      // navigate back to root list view
      const base = isDemoPath ? '/demo' : (url.pathname && url.pathname !== '/' ? '/' : url.pathname || '/');
      window.history.pushState({}, '', base + (url.search ? url.search : ''));
    } catch (e) {
      // ignore
    }
  }, [clearPhotoSearchState, loadProjects, isDemoPath]);

  const handleProjectPrevPage = React.useCallback(() => {
    if (loading || projectPage <= 1) return;
    loadProjects(projectQuery, projectPage - 1, PROJECT_PAGE_SIZE);
  }, [loading, projectPage, projectQuery, loadProjects]);

  const handleProjectNextPage = React.useCallback(() => {
    if (loading || !projectHasMore) return;
    loadProjects(projectQuery, projectPage + 1, PROJECT_PAGE_SIZE);
  }, [loading, projectHasMore, projectPage, projectQuery, loadProjects]);

  // On mount: read projectId from URL and listen to popstate for back/forward navigation
  React.useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const pid = params.get('projectId');
      const openPhotoId = params.get('photoId');
      const path = window.location.pathname;
      // handle public share links served by SPA: /share/:code
      if (path && path.startsWith('/share/')) {
        const code = path.split('/')[2];
        if (code) {
          (async () => {
            try {
              const resp = await fetch(`/api/share/${code}?limit=100&offset=0`);
              // Always try to parse JSON body when possible, even if status is not ok
              const data = await (async () => {
                try { return await resp.json(); } catch (e) { return null; }
              })();

              if (resp && resp.ok && data) {
                // successful share response
                if (data) {
                  // build a normalized share object that preserves potential metadata
                  const meta = {
                    createdBy: data.createdBy || data.owner || null,
                    creatorName: data.creatorName || data.creator || data.sharedBy || data.ownerName || null,
                    createdAt: data.createdAt || data.created || null,
                    expiresAt: (typeof data.expiresAt !== 'undefined') ? data.expiresAt : (data.expires || null),
                    remainingSeconds: (typeof data.remainingSeconds === 'number') ? data.remainingSeconds : (typeof data.remaining_seconds === 'number' ? data.remaining_seconds : null),
                  };

                  // If backend returned a project-like object, merge metadata into it
                  if (data.project) {
                    setShareInitialProject(Object.assign({}, data.project, meta));
                  } else if (Array.isArray(data.photos) || Array.isArray(data.list) || Array.isArray(data.images)) {
                    setShareInitialProject(Object.assign({ title: data.title || '分享', images: data.photos || data.list || data.images }, meta));
                  } else if (Array.isArray(data)) {
                    setShareInitialProject(Object.assign({ title: '分享', images: data }, meta));
                  } else if (data.items) {
                    setShareInitialProject(Object.assign({ title: data.title || '分享', images: data.items }, meta));
                  } else {
                    // fallback: pass raw data as images if it contains urls
                    const arr = [];
                    if (data && typeof data === 'object') {
                      Object.keys(data).forEach(k => { if (Array.isArray(data[k])) arr.push(...data[k]); });
                    }
                    if (arr.length) setShareInitialProject(Object.assign({ title: data.title || '分享', images: arr }, meta));
                  }
                  setShareMode(true);
                  return;
                }
              }

              // If response is not ok (e.g. 410) but server returned JSON with message/meta,
              // map common fields and provide a friendly message fallback so the UI can display it.
              if (resp && !resp.ok && data && typeof data === 'object') {
                const meta = {
                  createdBy: data.createdBy || data.owner || data.created_by || null,
                  creatorName: data.creatorName || data.creator || data.sharedBy || data.ownerName || data.name || null,
                  createdAt: data.createdAt || data.created || null,
                  expiresAt: (typeof data.expiresAt !== 'undefined') ? data.expiresAt : (data.expires || null),
                  remainingSeconds: (typeof data.remainingSeconds === 'number') ? data.remainingSeconds : (typeof data.remaining_seconds === 'number' ? data.remaining_seconds : null),
                  error: data.error || null,
                  message: data.message || (data.error === 'EXPIRED' ? '分享链接已过期' : (data.error === 'REVOKED' ? '分享链接已被撤销' : null)),
                };

                setShareInitialProject(meta);
                setShareMode(true);
                return;
              }
            } catch (e) {
              // ignore fetch errors 鈥?fall back to normal app
            }
          })();
        }
      }
      if (path === '/scenery') {
        setSelectedNav('scenery');
        setCurrentProjectId(null);
      } else if (path === '/login') {
        // if visiting /login and already authenticated, redirect to root
        if (currentUser) {
          try { window.history.replaceState({}, '', '/'); } catch (e) { }
          setSelectedNav('projects');
          setCurrentProjectId(null);
        }
      } else if (path === '/function/ai-writer') {
        setSelectedNav('function');
        setFunctionPage('ai-writer');
        setCurrentProjectId(null);
      } else if (path === '/function/group-rescue') {
        setSelectedNav('function');
        setFunctionPage('group-rescue');
        setCurrentProjectId(null);
      } else if (path === '/function/wechat-composer') {
        setSelectedNav('function');
        setFunctionPage('wechat-composer');
        setCurrentProjectId(null);
      } else if (path === '/function') {
        setSelectedNav('function');
        setFunctionPage(null);
        setCurrentProjectId(null);
      } else if (pid) {
        setSelectedNav('projects');
        setCurrentProjectId(pid);
        setPendingOpenPhotoId(openPhotoId ? String(openPhotoId) : null);
      } else {
        setSelectedNav('projects');
        setCurrentProjectId(null);
        setPendingOpenPhotoId(null);
      }
    } catch (e) {
      // ignore
    }

    const onPop = () => {
      try {
        const path = window.location.pathname;
        const params = new URLSearchParams(window.location.search);
        const p = params.get('projectId');
        const openPhotoId = params.get('photoId');
        if (path && path.startsWith('/share/')) {
          // reload to allow share handling effect to fetch fresh data
          try { window.location.reload(); } catch (e) { window.location.href = path; }
          return;
        }
        if (path === '/scenery') {
          setSelectedNav('scenery');
          setCurrentProjectId(null);
        } else if (path === '/login') {
          // on popstate to /login, keep showing auth if not logged in
          if (currentUser) {
            try { window.history.replaceState({}, '', '/'); } catch (e) { }
            setSelectedNav('projects');
            setCurrentProjectId(null);
          }
        } else if (path === '/function/ai-writer') {
          setSelectedNav('function');
          setFunctionPage('ai-writer');
          setCurrentProjectId(null);
        } else if (path === '/function/group-rescue') {
          setSelectedNav('function');
          setFunctionPage('group-rescue');
          setCurrentProjectId(null);
        } else if (path === '/function/wechat-composer') {
          setSelectedNav('function');
          setFunctionPage('wechat-composer');
          setCurrentProjectId(null);
        } else if (path === '/function') {
          setSelectedNav('function');
          setFunctionPage(null);
          setCurrentProjectId(null);
        } else if (p) {
          setSelectedNav('projects');
          setCurrentProjectId(p);
          setPendingOpenPhotoId(openPhotoId ? String(openPhotoId) : null);
        } else {
          setSelectedNav('projects');
          setCurrentProjectId(null);
          setPendingOpenPhotoId(null);
        }
      } catch (err) {
        setCurrentProjectId(null);
        setSelectedNav('projects');
        setPendingOpenPhotoId(null);
      }
    };

    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const normalizedProjects = React.useMemo(() => {
    const result = projects.map((project) => {
      const id = project?.id ?? project?.projectId ?? project?._id;
      const title = project?.title ?? project?.projectName ?? project?.name ?? 'Untitled Project';
      const subtitle = project?.subtitle ?? project?.tagline ?? project?.category ?? '';
      const description = project?.description ?? project?.intro ?? project?.description ?? '';
      const date = project?.date ?? project?.shootDate ?? project?.updatedAt ?? project?.createdAt ?? '';
      const startDate = project?.eventDate ?? project?.startDate ?? project?.date ?? project?.shootDate ?? null;
      const createdAt = project?.createdAt ?? project?.created_at ?? project?.updatedAt ?? null;
      const updatedAt = project?.updatedAt ?? project?.updated_at ?? project?.modifiedAt ?? project?.modified_at ?? null;
      const baseImages = Array.isArray(project?.previewImages)
        ? project.previewImages
        : Array.isArray(project?.images)
          ? project.images
          : [];
      const toSrc = (it) => {
        if (!it) return null;
        if (typeof it === 'string') return it;
        return it.thumbUrl || it.fullThumbUrl || it.thumbnail || it.thumb || it.coverThumbUrl || it.url || it.fullUrl || it.coverUrl || null;
      };

      const baseList = baseImages.map(toSrc).filter(Boolean);
      const cover = (project?.coverThumbUrl ?? project?.coverUrl ?? project?.cover) || baseList[0] || null;
      // start thumbnails from any explicit coverThumbUrl (common in this backend)
      const thumbsFromCoverThumb = project?.coverThumbUrl ? [project.coverThumbUrl] : [];
      // other thumbnails from baseList excluding the cover
      const otherThumbs = baseList.filter((src) => src && src !== cover);
      const thumbnails = Array.from(new Set([...thumbsFromCoverThumb, ...otherThumbs]));
      const normalizedImages = baseList.map(resolveAssetUrl);

      // Resolve cover and thumbnails to absolute URLs and ensure thumbnails do not equal cover
      const resolvedCover = cover ? resolveAssetUrl(cover) : resolveAssetUrl('uploads/assets/daishangchuan.png');
      const resolvedThumbnails = thumbnails
        .map((s) => resolveAssetUrl(s))
        .filter((s) => s && s !== resolvedCover)
        .slice(0, 6);
      const count = project?.photoCount ?? (Array.isArray(project?.photoIds) ? project.photoIds.length : undefined) ?? project?.count ?? normalizedImages.length;

      return {
        id,
        title,
        subtitle,
        description,
        date,
        startDate,
        createdAt,
        updatedAt,
        count,
        images: normalizedImages,
        cover: resolvedCover,
        coverSrc: resolvedCover,
        thumbnails: resolvedThumbnails,
      };
    }).filter((project) => project.id != null);

    return result;
  }, [projects]);

  const currentProject = React.useMemo(() => {
    if (!currentProjectId) return null;
    const sid = String(currentProjectId);
    return normalizedProjects.find((project) => String(project.id) === sid) || null;
  }, [normalizedProjects, currentProjectId]);

  const projectHeader = React.useMemo(() => {
    if (!currentProjectId) return null;
    const fallback = currentProject ? {
      id: currentProject.id,
      title: currentProject.title,
      subtitle: currentProject.subtitle,
      description: currentProject.description,
      count: currentProject.count,
      createdText: formatHeaderDate(currentProject.createdAt),
      updatedText: formatHeaderDate(currentProject.updatedAt),
      coverSrc: currentProject.coverSrc || currentProject.cover || currentProject.thumbnails?.[0] || currentProject.images?.[0] || '',
    } : {};
    return {
      ...fallback,
      ...(activeProjectHeader || {}),
    };
  }, [activeProjectHeader, currentProject, currentProjectId]);

  const projectHeaderReady = Boolean(projectHeader && (
    projectHeader.title
    || projectHeader.description
    || projectHeader.subtitle
    || projectHeader.createdText
    || projectHeader.updatedText
    || projectHeader.count !== undefined
  ));
  const projectHeaderTitle = currentProjectId
    ? (projectHeaderReady ? (projectHeader?.title || '未命名相册') : '正在加载相册')
    : 'MaMage 图库';
  const projectHeaderDescription = String(projectHeader?.description || projectHeader?.subtitle || '').trim();
  const projectHeaderDescriptionText = currentProjectId
    ? (projectHeaderReady ? (projectHeaderDescription || '暂无描述') : '正在同步照片信息')
    : '';
  const projectHeaderMeta = React.useMemo(() => {
    if (!projectHeader) return [];
    if (currentProjectId && !projectHeaderReady) return ['读取照片信息'];
    const items = [];
    const countValue = Number(projectHeader.count);
    if (Number.isFinite(countValue)) {
      items.push(`${countValue} 张照片`);
    } else {
      items.push(`${projectHeader.count || 0} 张照片`);
    }
    items.push(`创建 ${projectHeader.createdText || '-'}`);
    items.push(`更新 ${projectHeader.updatedText || '-'}`);
    return items;
  }, [currentProjectId, projectHeader, projectHeaderReady]);

  const userLabel = currentUser && (currentUser.displayName || currentUser.email || currentUser.name);
  const userInitial = String(userLabel || 'U').trim().charAt(0).toUpperCase() || 'U';

  const closeMobileNav = React.useCallback(() => {
    setMobileNavVisible(false);
  }, []);

  React.useEffect(() => {
    if (!isMobileHeader && mobileNavVisible) {
      setMobileNavVisible(false);
    }
  }, [isMobileHeader, mobileNavVisible]);

  React.useEffect(() => {
    if (!mobileNavVisible) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') closeMobileNav();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [closeMobileNav, mobileNavVisible]);

  const handleNavigateScenery = React.useCallback(() => {
    setSelectedNav('scenery');
    setCurrentProjectId(null);
    try { window.history.pushState({}, '', '/scenery'); } catch (e) { }
  }, []);

  // 功能导航落在功能列表页（功能不止一个后，由用户自己选）
  const handleNavigateFunction = React.useCallback(() => {
    setSelectedNav('function');
    setCurrentProjectId(null);
    setFunctionPage(null);
    try { window.history.pushState({}, '', '/function'); } catch (e) { }
  }, []);

  const handleNavigateAbout = React.useCallback(() => {
    setSelectedNav('about');
    setCurrentProjectId(null);
    try { window.history.pushState({}, '', '/about'); } catch (e) { }
  }, []);

  const handleNavigateAccount = React.useCallback(() => {
    try { window.history.pushState({}, '', '/account'); } catch (e) { }
    setSelectedNav('account');
    setCurrentProjectId(null);
  }, []);

  const handleLogout = React.useCallback(async () => {
    try {
      await authService.logout();
      setCurrentUser(null);
      try { window.history.pushState({}, '', '/login'); } catch (e) { }
    } catch (e) {
      console.error(e);
    }
  }, []);

  const navItems = React.useMemo(() => ([
    { key: 'projects', label: '项目', onClick: handleBackToList },
    { key: 'scenery', label: '风景', onClick: handleNavigateScenery },
    { key: 'function', label: '功能', onClick: handleNavigateFunction },
    { key: 'about', label: '关于', onClick: handleNavigateAbout },
  ]), [handleBackToList, handleNavigateAbout, handleNavigateFunction, handleNavigateScenery]);

  const renderNavItem = React.useCallback((item, mobile = false) => (
    <button
      key={item.key}
      type="button"
      className={`${mobile ? 'mamage-mobile-nav-item' : 'mamage-nav-link'}${selectedNav === item.key ? ' is-active' : ''}`}
      onPointerEnter={() => preloadNavItem(item.key)}
      onFocus={() => preloadNavItem(item.key)}
      onClick={() => {
        item.onClick();
        if (mobile) closeMobileNav();
      }}
    >
      {item.label}
    </button>
  ), [closeMobileNav, preloadNavItem, selectedNav]);

  const showProjectPager = (projectPage > 1) || projectHasMore;
  const projectPageText = projectTotal > 0
    ? `第 ${projectPage} 页 / 共 ${Math.max(1, Math.ceil(projectTotal / PROJECT_PAGE_SIZE))} 页（共 ${projectTotal} 个相册）`
    : `第 ${projectPage} 页`;

  const handleInitialPhotoOpened = React.useCallback((photoId) => {
    const sid = photoId === null || photoId === undefined ? '' : String(photoId).trim();
    if (!sid) return;
    setPendingOpenPhotoId((prev) => (prev && String(prev).trim() === sid ? null : prev));
    try {
      const url = new URL(window.location.href);
      if (String(url.searchParams.get('photoId') || '').trim() === sid) {
        url.searchParams.delete('photoId');
        window.history.replaceState({}, '', url);
      }
    } catch (e) {
      // ignore
    }
  }, []);


  if (isSharePath) {
    if (shareMode && shareInitialProject) {
      return (
        <div style={{ minHeight: '100vh' }}>
          <LazyPanel title="正在打开分享内容">
            <ShareView
              share={shareInitialProject}
              onBack={() => { try { window.history.replaceState({}, '', '/'); window.location.reload(); } catch (e) { window.location.href = '/'; } }}
            />
          </LazyPanel>
        </div>
      );
    }
    return (
      <div style={{ width: '100%', height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <AppLoadingState title="正在打开分享内容" subtitle="正在整理相册信息" />
      </div>
    );
  }

  if (authLoading) {
    return (
      <div style={{ width: '100%', height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <AppLoadingState title="正在检查登录状态" subtitle="马上进入图库" />
      </div>
    );
  }

  if (!currentUser && !isDemoPath) {
    return (
      <LazyPanel title="正在打开登录页">
        <AuthPage onAuthenticated={(u) => { setCurrentUser(u); loadProjects(); }} />
      </LazyPanel>
    );
  }

  return (
    <div className="mamage-shell">
      <LiquidGlassDefs />
      <div className="mamage-dynamic-backdrop" aria-hidden="true" />
      <header className={`mamage-header${currentProjectId ? ' is-project-detail' : ''}${isMobileHeader ? ' is-mobile-header' : ' is-desktop-header'}`}>
        <div className={`mamage-topbar${currentProjectId ? ' is-project-detail' : ''}`}>
          <div className="mamage-brand-area">
            {isMobileHeader ? (
              <button
                type="button"
                className={`mamage-menu-trigger${currentProjectId ? ' is-home' : (mobileNavVisible ? ' is-open' : '')}`}
                aria-label={currentProjectId ? '返回首页' : '打开导航'}
                aria-controls={currentProjectId ? undefined : 'mamage-mobile-nav'}
                aria-expanded={currentProjectId ? undefined : mobileNavVisible}
                onClick={currentProjectId ? handleBackToList : () => setMobileNavVisible((prev) => !prev)}
              >
                <span />
                <span />
                <span />
              </button>
            ) : null}

            <button
              type="button"
              onClick={currentProjectId && isMobileHeader ? () => setProjectInfoOpen((prev) => !prev) : handleBackToList}
              className={`mamage-brand-button${currentProjectId && isMobileHeader ? ' is-project-title' : ''}`}
              title={currentProjectId && isMobileHeader ? '查看相册信息' : (currentProjectId ? '返回项目列表' : '返回首页')}
              aria-expanded={currentProjectId && isMobileHeader ? projectInfoOpen : undefined}
            >
              {currentProjectId && isMobileHeader ? (
                <span className="mamage-project-title-text">{projectHeaderTitle}</span>
              ) : (
                <span className="mamage-brand-name">{isMobileHeader ? 'MaMage 图库' : 'MaMage'}</span>
              )}
            </button>

            {currentProjectId && isMobileHeader ? (
              projectInfoOpen ? (
                <div className="mamage-project-info-panel">
                  <div className="mamage-project-info-title">{projectHeaderTitle}</div>
                  {projectHeaderMeta.length > 0 ? (
                    <div className="mamage-project-info-meta">
                      {projectHeaderMeta.map((item) => <span key={item}>{item}</span>)}
                    </div>
                  ) : null}
                  <div className="mamage-project-info-desc">描述：{projectHeaderDescriptionText}</div>
                </div>
              ) : null
            ) : null}
          </div>

          {!isMobileHeader ? (
            <>
              <nav className="mamage-nav-links" aria-label="主导航">
                {navItems.map((item) => renderNavItem(item))}
              </nav>
              {currentProjectId ? (
                <button
                  type="button"
                  className="mamage-desktop-project-title"
                  title={projectHeaderTitle}
                  onClick={handleBackToList}
                >
                  {projectHeaderTitle}
                </button>
              ) : null}
            </>
          ) : null}

          <div className="mamage-nav-actions">
            <div className="mamage-nav-search-field">
              <input
                className="mamage-nav-search-input"
                aria-label="搜索项目、照片、标签或摄影师"
                placeholder={isMobileHeader ? '搜索项目 / 照片' : '搜索项目 / 照片 / 标签 / 摄影师'}
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') handleSearchSubmit();
                }}
              />
              {keyword ? (
                <button
                  type="button"
                  className="mamage-search-clear"
                  aria-label="清空搜索"
                  onClick={() => {
                    // 清空输入的同时退出搜索结果态，回到项目列表（与"搜索空关键词"行为一致）
                    setKeyword('');
                    clearPhotoSearchState();
                    loadProjects('', 1, PROJECT_PAGE_SIZE);
                  }}
                >
                  ×
                </button>
              ) : null}
              <button
                type="button"
                className="mamage-search-submit"
                aria-label="搜索"
                onClick={handleSearchSubmit}
              >
                <span className="mamage-search-symbol" aria-hidden="true" />
              </button>
            </div>

            <button type="button" className="mamage-action-button is-primary mamage-desktop-search-button" onClick={handleSearchSubmit}>
              搜索
            </button>

            {!isDemoPath && !currentProjectId ? (
              <IfCan perms={['projects.create']}>
                <button
                  type="button"
                  className="mamage-action-button is-secondary"
                  onPointerEnter={preloadCreateAlbum}
                  onFocus={preloadCreateAlbum}
                  onClick={() => setShowCreateModal(true)}
                >
                  <span className="mamage-label-full">新建相册</span>
                  <span className="mamage-label-short">新建</span>
                </button>
              </IfCan>
            ) : null}

            {currentUser ? (
              <details
                className="mamage-user-menu"
                ref={(el) => { userMenuRef.current = el; }}
              >
                <summary className="mamage-user-chip">
                  <span className="mamage-avatar" aria-hidden="true">{userInitial}</span>
                  <span className="mamage-user-email">{userLabel}</span>
                </summary>
                <div className="mamage-user-menu-panel">
                  <button type="button" onClick={handleNavigateAccount}>账户信息</button>
                  <button type="button" onClick={handleLogout}>退出账号</button>
                </div>
              </details>
            ) : (
              <button
                type="button"
                className="mamage-action-button is-secondary"
                onClick={() => {
                  try {
                    window.history.pushState({}, '', '/login');
                    window.location.reload();
                  } catch (e) {
                    window.location.href = '/login';
                  }
                }}
              >
                管理员登录
              </button>
            )}
          </div>
        </div>

        {currentProjectId && !isMobileHeader ? (
          <div className="mamage-desktop-project-notch" aria-label="相册信息">
            {projectHeaderMeta.length > 0 ? (
              <span className="mamage-notch-meta">
                {projectHeaderMeta.map((item) => <span key={item}>{item}</span>)}
              </span>
            ) : null}
            <span className="mamage-notch-description">描述：{projectHeaderDescriptionText}</span>
          </div>
        ) : null}

        {isMobileHeader && mobileNavVisible ? (
          <>
            <button type="button" className="mamage-mobile-nav-backdrop" aria-label="关闭导航遮罩" onClick={closeMobileNav} />
            <aside id="mamage-mobile-nav" className="mamage-mobile-nav-panel is-open" role="dialog" aria-modal="true" aria-hidden={false}>
              <div className="mamage-mobile-nav-head">
                <span>导航</span>
                <button type="button" aria-label="关闭导航" onClick={closeMobileNav}>×</button>
              </div>
              <div className="mamage-mobile-nav-list">
                {navItems.map((item) => renderNavItem(item, true))}
              </div>
            </aside>
          </>
        ) : null}
      </header>

      <main className="mamage-content" style={{ padding: 'clamp(10px, 2.5vw, 24px)' }}>
        <div className="project-page">
          {currentProjectId ? (
            <LazyPanel title="正在加载相册">
              <ProjectDetail
                key={`project-${currentProjectId}`}
                projectId={currentProjectId}
                initialProject={currentProject || null}
                onBack={handleBackToList}
                readOnly={isDemoPath}
                initialOpenPhotoId={pendingOpenPhotoId}
                onInitialOpenPhotoHandled={handleInitialPhotoOpened}
                onProjectHeaderChange={setActiveProjectHeader}
              />
            </LazyPanel>
          ) : (
            selectedNav === 'projects' ? (
              photoSearchMode ? (
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
                    <Text>{`关键词“${String(keyword || '').trim()}”的搜索结果`}</Text>
                    <Button
                      size="small"
                      onClick={handleBackToList}
                    >
                      清空搜索
                    </Button>
                  </div>

                  <div style={{ marginBottom: 20 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                      <Text strong>项目结果</Text>
                    </div>

                    <div className="project-grid">
                      {loading && (
                        <div className="mamage-grid-state is-compact">
                          <AppLoadingState title="正在搜索项目" subtitle="匹配相册中" compact />
                        </div>
                      )}

                      {!loading && error && (
                        <div className="mamage-grid-state is-compact">
                          <Text type="danger">{error}</Text>
                        </div>
                      )}

                      {!loading && !error && normalizedProjects.length === 0 && (
                        <div className="mamage-grid-state is-compact">
                          <Empty description="没有匹配的项目" />
                        </div>
                      )}

                      {!loading && !error &&
                        normalizedProjects.map((project) => (
                          <ProjectCard
                            key={project.id}
                            {...project}
                            onClick={() => handleSelectProject(project.id)}
                          />
                        ))}
                    </div>
                    {!loading && !error && showProjectPager && (
                      <div style={{ width: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 10, marginTop: 12 }}>
                        <Button size="small" disabled={projectPage <= 1 || loading} onClick={handleProjectPrevPage}>上一页</Button>
                        <Text type="tertiary">{projectPageText}</Text>
                        <Button size="small" disabled={!projectHasMore || loading} onClick={handleProjectNextPage}>下一页</Button>
                      </div>
                    )}
                  </div>

                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                      <Text strong>{`照片结果${Number(photoSearchTotal) > 0 ? `（${photoSearchTotal}）` : ''}`}</Text>
                    </div>

                    {photoSearchLoading && photoSearchResults.length === 0 && (
                      <div style={{ width: '100%', display: 'flex', justifyContent: 'center', padding: '48px 0' }}>
                        <AppLoadingState title="正在搜索照片" subtitle="按描述、标签和摄影师匹配" compact />
                      </div>
                    )}

                    {!photoSearchLoading && photoSearchError && (
                      <div style={{ width: '100%', display: 'flex', justifyContent: 'center', padding: '40px 0' }}>
                        <Text type="danger">{photoSearchError}</Text>
                      </div>
                    )}

                    {!photoSearchLoading && !photoSearchError && photoSearchResults.length === 0 && (
                      <div style={{ width: '100%', display: 'flex', justifyContent: 'center', padding: '48px 0' }}>
                        <Empty description="没有匹配的照片" />
                      </div>
                    )}

                    {photoSearchResults.length > 0 && (
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 14 }}>
                        {photoSearchResults.map((photo, idx) => (
                          <div
                            key={`${photo.id || 'p'}-${idx}`}
                            className="app-photo-search-card"
                          >
                            <button
                              type="button"
                              onClick={() => openPhotoPreview(photo)}
                              title={(photo.thumbUrl || photo.url) ? '点击预览大图' : ''}
                              style={{
                                width: '100%',
                                border: 'none',
                                padding: 0,
                                background: 'transparent',
                                cursor: (photo.thumbUrl || photo.url) ? 'zoom-in' : 'default',
                                display: 'block'
                              }}
                            >
                              <div className="detail-photo-item" style={{ width: '100%', overflow: 'hidden', transform: 'none' }}>
                                <div className="detail-photo" style={{ overflow: 'hidden', background: '#e5e7eb', transform: 'none' }}>
                                  {photo.thumbUrl || photo.url ? (
                                    <img
                                      src={photo.thumbUrl || photo.url}
                                      alt={photo.title || 'photo'}
                                      loading="lazy"
                                      decoding="async"
                                      className="detail-photo-img is-ready"
                                      style={{ width: '100%', height: 'auto', objectFit: 'cover', cursor: (photo.thumbUrl || photo.url) ? 'zoom-in' : 'default' }}
                                    />
                                  ) : null}
                                </div>
                              </div>
                            </button>

                            <button
                              type="button"
                              onMouseEnter={() => setHoverPhotoSearchIdx(idx)}
                              onMouseLeave={() => setHoverPhotoSearchIdx((prev) => (prev === idx ? -1 : prev))}
                              onClick={() => {
                                if (photo.projectId) handleSelectProject(String(photo.projectId));
                              }}
                              title={photo.projectId ? '点击进入对应相册' : ''}
                              className="app-photo-search-card__meta"
                              style={{
                                cursor: photo.projectId ? 'pointer' : 'default',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 4,
                                position: 'relative',
                                overflow: 'hidden',
                              }}
                            >
                              <Text size="small" strong>
                                {photo.projectName || `项目 #${photo.projectId || '-'}`}
                              </Text>
                              <Text size="small" type="tertiary" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {photo.photographerName ? `摄影师：${photo.photographerName}` : '摄影师：-'}
                              </Text>
                              <div
                                style={{
                                  position: 'absolute',
                                  inset: 0,
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  color: 'var(--lg-blue, #111)',
                                  fontSize: 12,
                                  fontWeight: 600,
                                  background: 'rgba(255,255,255,0.7)',
                                  backdropFilter: 'blur(6px)',
                                  WebkitBackdropFilter: 'blur(6px)',
                                  opacity: hoverPhotoSearchIdx === idx ? 1 : 0,
                                  transition: 'opacity 160ms ease',
                                  pointerEvents: 'none',
                                }}
                              >
                                点击进入对应相册
                              </div>
                            </button>
                          </div>
                        ))}
                      </div>
                    )}

                    <div style={{ width: '100%', display: 'flex', justifyContent: 'center', padding: '16px 0 8px' }}>
                      {photoSearchHasMore ? (
                        <Button loading={photoSearchLoading} onClick={handlePhotoSearchLoadMore}>加载更多</Button>
                      ) : (
                        photoSearchResults.length > 0 ? <Text type="tertiary">已显示全部结果</Text> : null
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  <div className="project-grid">
                    {loading && (
                      <div className="mamage-grid-state">
                        <AppLoadingState title="正在加载相册" subtitle="照片马上出现" compact />
                      </div>
                    )}

                    {!loading && error && (
                      <div className="mamage-grid-state">
                        <Text type="danger">{error}</Text>
                      </div>
                    )}

                    {!loading && !error && normalizedProjects.length === 0 && (
                      <div className="mamage-grid-state">
                        <Empty description="暂无项目" />
                      </div>
                    )}

                    {!loading && !error &&
                      normalizedProjects.map((project) => (
                        <ProjectCard
                          key={project.id}
                          {...project}
                          onHoverIntent={preloadProjectDetail}
                          onClick={() => handleSelectProject(project.id)}
                        />
                      ))}
                  </div>
                  {!loading && !error && showProjectPager && (
                    <div style={{ width: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 10, marginTop: 12 }}>
                      <Button size="small" disabled={projectPage <= 1 || loading} onClick={handleProjectPrevPage}>上一页</Button>
                      <Text type="tertiary">{projectPageText}</Text>
                      <Button size="small" disabled={!projectHasMore || loading} onClick={handleProjectNextPage}>下一页</Button>
                    </div>
                  )}
                </>
              )
            ) : selectedNav === 'scenery' ? (
              <LazyPanel title="正在加载风景页">
                <Scenery />
              </LazyPanel>
            ) : selectedNav === 'account' ? (
              <LazyPanel title="正在加载账户页">
                <AccountPage currentUser={currentUser} onUpdated={(u) => { setCurrentUser(u); }} />
              </LazyPanel>
            ) : selectedNav === 'function' ? (
              functionPage === 'ai-writer' ? (
                <LazyPanel title="正在加载 AI 写作">
                  <AiNewsWriter />
                </LazyPanel>
              ) : functionPage === 'group-rescue' ? (
                <LazyPanel title="正在加载合影救场">
                  <GroupRescue />
                </LazyPanel>
              ) : functionPage === 'wechat-composer' ? (
                <LazyPanel title="正在加载公众号排版器">
                  <WechatComposer />
                </LazyPanel>
              ) : (
                <div style={{ padding: 24 }}>
                  <Card title="功能" bordered>
                    <div className="function-index-grid">
                      <button
                        type="button"
                        className="function-index-card"
                        onClick={() => { try { window.history.pushState({}, '', '/function/ai-writer'); } catch (e) { } setSelectedNav('function'); setFunctionPage('ai-writer'); }}
                      >
                        <div className="function-index-card-title">AI 写新闻稿</div>
                        <div className="function-index-card-desc">挑好照片，AI 按新闻稿格式生成图文初稿</div>
                      </button>
                      <button
                        type="button"
                        className="function-index-card"
                        onClick={() => { try { window.history.pushState({}, '', '/function/group-rescue'); } catch (e) { } setSelectedNav('function'); setFunctionPage('group-rescue'); }}
                      >
                        <div className="function-index-card-title">合影救场</div>
                        <div className="function-index-card-desc">连拍合影里有人闭眼？AI 为每个人挑最佳表情合成一张</div>
                      </button>
                      <button
                        type="button"
                        className="function-index-card"
                        onClick={() => { try { window.history.pushState({}, '', '/function/wechat-composer'); } catch (e) { } setSelectedNav('function'); setFunctionPage('wechat-composer'); }}
                      >
                        <div className="function-index-card-title">公众号排版器</div>
                        <div className="function-index-card-desc">套主题排版、带图一键复制进公众号后台</div>
                      </button>
                    </div>
                    <div style={{ color: '#666', marginTop: 12 }}>更多功能正在开发中</div>
                  </Card>
                </div>
              )
            ) : selectedNav === 'about' ? (
              <div style={{ padding: 24, maxWidth: 720, margin: '0 auto' }}>
                <Card title="关于 MaMage" bordered>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, lineHeight: 1.7 }}>
                    <Text>MaMage 是一套面向校园活动的照片/视频图库：按相册与活动环节组织媒体，支持批量上传、AI 智能打标与选片、人脸识别、时间轴浏览、跨相册中转与限时分享。</Text>
                    <Text type="tertiary" size="small">照片存储于对象存储并经私有代理签名访问；AI 能力由本地视觉模型驱动。</Text>
                    <Text type="tertiary" size="small">© 2026 MaMage 校园图库</Text>
                  </div>
                </Card>
              </div>
            ) : (
              <div style={{ padding: 24 }}><Text>该页面暂未实现</Text></div>
            )
          )}
        </div>
      </main>

      {photoPreviewVisible ? (
        <LazySilent>
          <PhotoPreviewOverlay
            visible={photoPreviewVisible}
            src={photoPreviewSrc}
            title={photoPreviewTitle}
            description={photoPreviewDescription}
            tags={photoPreviewTags}
            onClose={closePhotoPreview}
          />
        </LazySilent>
      ) : null}

      {!currentProjectId ? (
        <footer className="mamage-footer" style={{ textAlign: 'center' }}>
          MaMage 校园图库 © {new Date().getFullYear()}
        </footer>
      ) : null}
      {mountTransferStation ? (
        <LazySilent>
          <TransferStation />
        </LazySilent>
      ) : null}
      {showCreateModal ? (
        <LazySilent>
          <CreateAlbumModal
            visible={showCreateModal}
            onClose={() => setShowCreateModal(false)}
            createProject={createProject}
            onCreated={() => {
              setShowCreateModal(false);
              loadProjects(projectQuery, 1, PROJECT_PAGE_SIZE);
            }}
          />
        </LazySilent>
      ) : null}
    </div>
  );
}

export default App;
