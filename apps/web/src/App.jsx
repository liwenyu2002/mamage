// src/App.jsx
import React from 'react';
import { Layout, Typography, Input, Nav, Avatar, Spin, Empty, Button, Popover, Card, SideSheet } from '@douyinfe/semi-ui';
import '@semi-bot/semi-theme-mamage_day/semi.css';
import { IconUser, IconSearch, IconMenu } from '@douyinfe/semi-icons';
import ProjectCard from './ProjectCard';
import ProjectDetail from './ProjectDetail';
import ShareView from './ShareView';
import Scenery from './Scenery';
import AuthPage from './AuthPage';
import AccountPage from './AccountPage';
import * as authService from './services/authService';
import { fetchProjectList, createProject } from './services/projectService';
import { searchPhotos } from './services/photoService';
import CreateAlbumModal from './CreateAlbumModal';
import { resolveAssetUrl } from './services/request';
import TransferStation from './TransferStation';
import IfCan from './permissions/IfCan';
import AiNewsWriter from './AiNewsWriter.jsx';
import PhotoPreviewOverlay from './PhotoPreviewOverlay.jsx';

const { Header, Content, Footer } = Layout;
const { Text } = Typography;
const PROJECT_PAGE_SIZE = 24;

function App() {
  const [projects, setProjects] = React.useState([]);
  const [projectPage, setProjectPage] = React.useState(1);
  const [projectHasMore, setProjectHasMore] = React.useState(false);
  const [projectTotal, setProjectTotal] = React.useState(0);
  const [projectQuery, setProjectQuery] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState(null);
  const [keyword, setKeyword] = React.useState('');
  const [currentProjectId, setCurrentProjectId] = React.useState(null);
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
  const [isMobileHeader, setIsMobileHeader] = React.useState(() => (typeof window !== 'undefined' ? window.innerWidth <= 768 : false));
  const [mobileNavVisible, setMobileNavVisible] = React.useState(false);
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
    if (typeof window === 'undefined') return undefined;
    const onResize = () => setIsMobileHeader(window.innerWidth <= 768);
    onResize();
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
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
                  message: data.message || (data.error === 'EXPIRED' ? 'Link expired' : (data.error === 'REVOKED' ? 'Link revoked' : null)),
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
        count,
        images: normalizedImages,
        cover: resolvedCover,
        thumbnails: resolvedThumbnails,
      };
    }).filter((project) => project.id != null);

    return result;
  }, [projects]);

  const currentProject = React.useMemo(() => {
    if (!currentProjectId) return null;
    return normalizedProjects.find((project) => project.id === currentProjectId) || null;
  }, [normalizedProjects, currentProjectId]);

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
          <ShareView
            share={shareInitialProject}
            onBack={() => { try { window.history.replaceState({}, '', '/'); window.location.reload(); } catch (e) { window.location.href = '/'; } }}
          />
        </div>
      );
    }
    return (
      <div style={{ width: '100%', height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Spin size="large" tip="Loading shared content..." />
      </div>
    );
  }

  if (authLoading) {
    return (
      <div style={{ width: '100%', height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Spin size="large" tip="检查登录状态中" />
      </div>
    );
  }

  if (!currentUser && !isDemoPath) {
    return <AuthPage onAuthenticated={(u) => { setCurrentUser(u); loadProjects(); }} />;
  }

  return (
    <Layout style={{ background: '#f4f4f4ff' }}>
      <Header
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 1000,
          padding: 0,
          background: '#ffffff',
          borderBottom: '1px solid #eef2f7',
        }}
      >
        {isMobileHeader ? (
          <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                <Button
                  icon={<IconMenu />}
                  theme="borderless"
                  size="small"
                  onClick={() => setMobileNavVisible(true)}
                  style={{ flex: '0 0 auto' }}
                />
                <button
                  type="button"
                  onClick={handleBackToList}
                  style={{
                    fontSize: 24,
                    fontWeight: 700,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    border: 'none',
                    background: 'transparent',
                    padding: 0,
                    cursor: 'pointer',
                    color: 'inherit',
                  }}
                >
                  MaMage 图库
                </button>
              </div>
              {currentUser ? (
                <Popover
                  content={(
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 140 }}>
                      <Button type="tertiary" onClick={() => { try { window.history.pushState({}, '', '/account'); } catch (e) { } setSelectedNav('account'); }}>账户信息</Button>
                      <Button type="tertiary" theme="borderless" onClick={async () => { try { await authService.logout(); setCurrentUser(null); try { window.history.pushState({}, '', '/login'); } catch (e) { } } catch (e) { console.error(e); } }}>退出登录</Button>
                    </div>
                  )}
                  trigger="click"
                  position="bottomRight"
                >
                  <Avatar size="small" alt={currentUser?.name || ''} style={{ backgroundColor: '#d9d9d9', cursor: 'pointer' }}>
                    {(currentUser?.name || currentUser?.displayName || currentUser?.email || 'U')[0]}
                  </Avatar>
                </Popover>
              ) : (
                <Button size="small" type="primary" onClick={() => { try { window.history.pushState({}, '', '/login'); window.location.reload(); } catch (e) { window.location.href = '/login'; } }}>
                  管理员登录
                </Button>
              )}
            </div>
            <SideSheet
              title="导航"
              placement="left"
              visible={mobileNavVisible}
              onCancel={() => setMobileNavVisible(false)}
              width={240}
              bodyStyle={{ padding: 12 }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <Button
                  block
                  type={selectedNav === 'projects' ? 'primary' : 'tertiary'}
                  onClick={() => { handleBackToList(); setMobileNavVisible(false); }}
                >
                  项目
                </Button>
                <Button
                  block
                  type={selectedNav === 'scenery' ? 'primary' : 'tertiary'}
                  onClick={() => {
                    setSelectedNav('scenery');
                    setCurrentProjectId(null);
                    try { window.history.pushState({}, '', '/scenery'); } catch (e) { }
                    setMobileNavVisible(false);
                  }}
                >
                  风景
                </Button>
                <Button
                  block
                  type={selectedNav === 'function' ? 'primary' : 'tertiary'}
                  onClick={() => {
                    setSelectedNav('function');
                    setCurrentProjectId(null);
                    setFunctionPage('ai-writer');
                    try { window.history.pushState({}, '', '/function/ai-writer'); } catch (e) { }
                    setMobileNavVisible(false);
                  }}
                >
                  功能
                </Button>
                <Button
                  block
                  type={selectedNav === 'about' ? 'primary' : 'tertiary'}
                  onClick={() => {
                    setSelectedNav('about');
                    setCurrentProjectId(null);
                    try { window.history.pushState({}, '', '/about'); } catch (e) { }
                    setMobileNavVisible(false);
                  }}
                >
                  关于
                </Button>
              </div>
            </SideSheet>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Input
                placeholder="搜索项目/照片"
                prefix={<IconSearch />}
                showClear
                size="small"
                style={{ flex: 1, minWidth: 0 }}
                value={keyword}
                onChange={(value) => setKeyword(value)}
                onEnterPress={handleSearchSubmit}
              />
              <Button size="small" theme="solid" type="primary" onClick={handleSearchSubmit}>搜索</Button>
              {!isDemoPath ? (
                <IfCan perms={['projects.create']}>
                  <Button size="small" onClick={() => setShowCreateModal(true)}>新建</Button>
                </IfCan>
              ) : null}
            </div>
          </div>
        ) : (
          <div style={{ padding: '0 0px' }}>
            <Nav
              mode="horizontal"
              items={[
                { itemKey: 'projects', text: '项目', onClick: () => { handleBackToList(); } },
                { itemKey: 'scenery', text: '风景', onClick: () => { setSelectedNav('scenery'); setCurrentProjectId(null); try { window.history.pushState({}, '', '/scenery'); } catch (e) { } } },
                {
                  itemKey: 'function', text: (
                    <Popover
                      position="bottomLeft"
                      trigger="hover"
                      content={(
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 160 }}>
                          <Button onClick={() => { try { window.history.pushState({}, '', '/function/ai-writer'); } catch (e) { } setSelectedNav('function'); setFunctionPage('ai-writer'); }}>AI 写新闻稿</Button>
                          <div style={{ color: '#666', fontSize: 13 }}>更多功能入口</div>
                        </div>
                      )}
                    >
                      <span style={{ cursor: 'pointer' }}>功能</span>
                    </Popover>
                  ), onClick: () => { setSelectedNav('function'); setCurrentProjectId(null); try { window.history.pushState({}, '', '/function'); } catch (e) { } }
                },
                { itemKey: 'about', text: '关于', onClick: () => { setSelectedNav('about'); setCurrentProjectId(null); try { window.history.pushState({}, '', '/about'); } catch (e) { } } },
              ]}
              header={{
                text: (
                  <button
                    type="button"
                    onClick={handleBackToList}
                    style={{
                      border: 'none',
                      background: 'transparent',
                      padding: 0,
                      margin: 0,
                      fontSize: 18,
                      fontWeight: 700,
                      cursor: 'pointer',
                      color: '#111827',
                    }}
                  >
                    MaMage 图库
                  </button>
                ),
              }}
              footer={(
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: '1 1 auto', minWidth: 0 }}>
                    <Input
                      placeholder="搜索项目 / 照片 / 标签 / 摄影师"
                      prefix={<IconSearch />}
                      showClear
                      style={{ width: 'clamp(120px, 30vw, 260px)' }}
                      value={keyword}
                      onChange={(value) => setKeyword(value)}
                      onEnterPress={handleSearchSubmit}
                    />
                    <Button theme="solid" type="primary" onClick={handleSearchSubmit}>
                      搜索
                    </Button>

                    {!isDemoPath ? (
                      <IfCan perms={['projects.create']}>
                        <Button onClick={() => setShowCreateModal(true)}>
                          新建相册
                        </Button>
                      </IfCan>
                    ) : null}
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: '0 0 auto', minWidth: 0 }}>
                    {currentUser ? (
                      <Popover
                        content={(
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 140 }}>
                            <Button type="tertiary" onClick={() => { try { const url = new URL(window.location.href); window.history.pushState({}, '', '/account'); setSelectedNav('account'); } catch (e) { } }}>账户信息</Button>
                            <Button type="tertiary" theme="borderless" onClick={async () => { try { await authService.logout(); setCurrentUser(null); try { window.history.pushState({}, '', '/login'); } catch (e) { } } catch (e) { console.error(e); } }}>退出账号</Button>
                          </div>
                        )}
                        trigger="hover"
                        position="bottomRight"
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', minWidth: 0 }}>
                          <Avatar size="small" alt={currentUser?.name || ''} style={{ backgroundColor: '#d9d9d9' }}>{(currentUser?.name || currentUser?.displayName || currentUser?.email || 'U')[0]}</Avatar>
                          <span style={{ fontSize: 14, maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-block' }}>{currentUser && (currentUser.displayName || currentUser.email || currentUser.name)}</span>
                        </div>
                      </Popover>
                    ) : null}
                  </div>
                </div>
              )}
            />
          </div>
        )}
      </Header>

      <Content style={{ padding: 'clamp(10px, 2.5vw, 24px)' }}>
        <div className="project-page">
          {currentProjectId ? (
            <ProjectDetail
              key={`project-${currentProjectId}`}
              projectId={currentProjectId}
              initialProject={currentProject ? { ...currentProject, images: [] } : null}
              onBack={handleBackToList}
              readOnly={isDemoPath}
              initialOpenPhotoId={pendingOpenPhotoId}
              onInitialOpenPhotoHandled={handleInitialPhotoOpened}
            />
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
                        <div style={{ width: '100%', display: 'flex', justifyContent: 'center', padding: '48px 0' }}>
                          <Spin size="large" tip="搜索项目中..." />
                        </div>
                      )}

                      {!loading && error && (
                        <div style={{ width: '100%', display: 'flex', justifyContent: 'center', padding: '48px 0' }}>
                          <Text type="danger">{error}</Text>
                        </div>
                      )}

                      {!loading && !error && normalizedProjects.length === 0 && (
                        <div style={{ width: '100%', display: 'flex', justifyContent: 'center', padding: '48px 0' }}>
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
                        <Spin size="large" tip="搜索照片中..." />
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
                            style={{
                              border: '1px solid rgba(148,163,184,0.2)',
                              background: '#fff',
                              borderRadius: 10,
                              overflow: 'hidden',
                              padding: 0,
                              textAlign: 'left'
                            }}
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
                              style={{
                                width: '100%',
                                border: 'none',
                                borderTop: '1px solid rgba(148,163,184,0.2)',
                                background: '#fff',
                                padding: '10px 12px',
                                textAlign: 'left',
                                cursor: photo.projectId ? 'pointer' : 'default',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 4,
                                position: 'relative',
                                overflow: 'hidden',
                              }}
                            >
                              <Text size="small" style={{ color: '#0f172a' }}>
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
                                  color: '#1d4ed8',
                                  fontSize: 12,
                                  fontWeight: 600,
                                  background: 'rgba(241,245,249,0.72)',
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
                      <div style={{ width: '100%', display: 'flex', justifyContent: 'center', padding: '80px 0' }}>
                        <Spin size="large" tip="Loading projects..." />
                      </div>
                    )}

                    {!loading && error && (
                      <div style={{ width: '100%', display: 'flex', justifyContent: 'center', padding: '80px 0' }}>
                        <Text type="danger">{error}</Text>
                      </div>
                    )}

                    {!loading && !error && normalizedProjects.length === 0 && (
                      <div style={{ width: '100%', display: 'flex', justifyContent: 'center', padding: '80px 0' }}>
                        <Empty description="暂无项目" />
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
                </>
              )
            ) : selectedNav === 'scenery' ? (
              <Scenery />
            ) : selectedNav === 'account' ? (
              <AccountPage currentUser={currentUser} onUpdated={(u) => { setCurrentUser(u); }} />
            ) : selectedNav === 'function' ? (
              functionPage === 'ai-writer' ? (
                <AiNewsWriter />
              ) : (
                <div style={{ padding: 24 }}>
                  <Card title="功能" bordered>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <Button onClick={() => { try { window.history.pushState({}, '', '/function/ai-writer'); } catch (e) { } setSelectedNav('function'); setFunctionPage('ai-writer'); }}>AI 写新闻稿</Button>
                      </div>
                      <div style={{ color: '#666' }}>更多功能正在开发中</div>
                    </div>
                  </Card>
                </div>
              )
            ) : (
              <div style={{ padding: 24 }}><Text>该页面暂未实现</Text></div>
            )
          )}
        </div>
      </Content>

      <PhotoPreviewOverlay
        visible={photoPreviewVisible}
        src={photoPreviewSrc}
        title={photoPreviewTitle}
        description={photoPreviewDescription}
        tags={photoPreviewTags}
        onClose={closePhotoPreview}
      />

      <Footer style={{ textAlign: 'center' }}>
        MaMage 校园图库 © {new Date().getFullYear()}
      </Footer>
      <TransferStation />
      <CreateAlbumModal
        visible={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        createProject={createProject}
        onCreated={() => {
          setShowCreateModal(false);
          loadProjects(projectQuery, 1, PROJECT_PAGE_SIZE);
        }}
      />
    </Layout>
  );
}

export default App;
