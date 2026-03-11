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
import CreateAlbumModal from './CreateAlbumModal';
import { resolveAssetUrl } from './services/request';
import TransferStation from './TransferStation';
import IfCan from './permissions/IfCan';
import AiNewsWriter from './AiNewsWriter.jsx';

const { Header, Content, Footer } = Layout;
const { Text } = Typography;

function App() {
  const [projects, setProjects] = React.useState([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState(null);
  const [keyword, setKeyword] = React.useState('');
  const [currentProjectId, setCurrentProjectId] = React.useState(null);
  const [selectedNav, setSelectedNav] = React.useState('projects');
  const [showCreateModal, setShowCreateModal] = React.useState(false);
  const [functionPage, setFunctionPage] = React.useState(null);
  const [currentUser, setCurrentUser] = React.useState(null);
  const [authLoading, setAuthLoading] = React.useState(true);
  const [isMobileHeader, setIsMobileHeader] = React.useState(() => (typeof window !== 'undefined' ? window.innerWidth <= 768 : false));
  const [mobileNavVisible, setMobileNavVisible] = React.useState(false);
  const [shareMode, setShareMode] = React.useState(false);
  const [shareInitialProject, setShareInitialProject] = React.useState(null);
  const isSharePath = (() => {
    try {
      return typeof window !== 'undefined' && window.location && window.location.pathname && window.location.pathname.startsWith('/share/');
    } catch (e) {
      return false;
    }
  })();


  const latestRequestRef = React.useRef(0);

  const loadProjects = React.useCallback(async (kw = '', page = 1, pageSize = 6) => {
    const currentToken = latestRequestRef.current + 1;
    latestRequestRef.current = currentToken;
    setLoading(true);
    setError(null);
    try {
      // 鍚庣鍒嗛〉鎺ュ彛锛欸ET /api/projects/list?page=1&pageSize=6&keyword=xxx
      const response = await fetchProjectList({ page, pageSize, keyword: kw?.trim() || undefined });
      if (latestRequestRef.current !== currentToken) return;

      const list = Array.isArray(response?.list) ? response.list : [];
      setProjects(list);
    } catch (err) {
      if (latestRequestRef.current !== currentToken) return;
      // 灞曠ず鏇磋缁嗙殑閿欒淇℃伅锛堝悗绔彲鑳芥惡甯?body锛?
      const message = err?.body || err?.message || '获取项目列表失败';
      console.error('loadProjects error:', err);
      setError(message);
      setProjects([]);
    } finally {
      if (latestRequestRef.current === currentToken) {
        setLoading(false);
      }
    }
  }, []);

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
    loadProjects(keyword);
  }, [keyword, loadProjects]);

  const handleSelectProject = React.useCallback((projectId) => {
    setCurrentProjectId(projectId);
    setSelectedNav('projects');
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('projectId', projectId);
      window.history.pushState({}, '', url);
    } catch (e) {
      // ignore
    }
  }, []);

  const handleBackToList = React.useCallback(() => {
    setCurrentProjectId(null);
    setSelectedNav('projects');
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete('projectId');
      // navigate back to root list view
      const base = url.pathname && url.pathname !== '/' ? '/' : url.pathname || '/';
      window.history.pushState({}, '', base + (url.search ? url.search : ''));
    } catch (e) {
      // ignore
    }
  }, []);

  // On mount: read projectId from URL and listen to popstate for back/forward navigation
  React.useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const pid = params.get('projectId');
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
                    setShareInitialProject(Object.assign({ title: data.title || '鍒嗕韩', images: data.photos || data.list || data.images }, meta));
                  } else if (Array.isArray(data)) {
                    setShareInitialProject(Object.assign({ title: '鍒嗕韩', images: data }, meta));
                  } else if (data.items) {
                    setShareInitialProject(Object.assign({ title: data.title || '鍒嗕韩', images: data.items }, meta));
                  } else {
                    // fallback: pass raw data as images if it contains urls
                    const arr = [];
                    if (data && typeof data === 'object') {
                      Object.keys(data).forEach(k => { if (Array.isArray(data[k])) arr.push(...data[k]); });
                    }
                    if (arr.length) setShareInitialProject(Object.assign({ title: data.title || '鍒嗕韩', images: arr }, meta));
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
      } else {
        setSelectedNav('projects');
        setCurrentProjectId(null);
      }
    } catch (e) {
      // ignore
    }

    const onPop = () => {
      try {
        const path = window.location.pathname;
        const p = new URLSearchParams(window.location.search).get('projectId');
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
        } else {
          setSelectedNav('projects');
          setCurrentProjectId(null);
        }
      } catch (err) {
        setCurrentProjectId(null);
        setSelectedNav('projects');
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
        return it.url || it.fullUrl || it.fullThumbUrl || it.thumbUrl || it.coverUrl || null;
      };

      const baseList = baseImages.map(toSrc).filter(Boolean);
      const cover = (project?.coverUrl ?? project?.cover) || baseList[0] || null;
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

  if (!currentUser) {
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
                placeholder="搜索项目"
                prefix={<IconSearch />}
                showClear
                size="small"
                style={{ flex: 1, minWidth: 0 }}
                value={keyword}
                onChange={(value) => setKeyword(value)}
                onEnterPress={handleSearchSubmit}
              />
              <Button size="small" theme="solid" type="primary" onClick={handleSearchSubmit}>搜索</Button>
              <IfCan perms={['projects.create']}>
                <Button size="small" onClick={() => setShowCreateModal(true)}>新建</Button>
              </IfCan>
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
                text: 'MaMage 图库',
              }}
              footer={(
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: '1 1 auto', minWidth: 0 }}>
                    <Input
                      placeholder="搜索项目 / 标签"
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

                    <IfCan perms={['projects.create']}>
                      <Button onClick={() => setShowCreateModal(true)}>
                        新建相册
                      </Button>
                    </IfCan>
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
              projectId={currentProjectId}
              initialProject={currentProject}
              onBack={handleBackToList}
            />
          ) : (
            selectedNav === 'projects' ? (
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
          loadProjects();
        }}
      />
    </Layout>
  );
}

export default App;
