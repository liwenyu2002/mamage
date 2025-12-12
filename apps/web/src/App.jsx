// src/App.jsx
import React from 'react';
import { Layout, Typography, Input, Nav, Avatar, Spin, Empty, Button, Popover, Card } from '@douyinfe/semi-ui';
import '@semi-bot/semi-theme-mamage_day/semi.css';
import { IconUser, IconSearch } from '@douyinfe/semi-icons';
import ProjectCard from './ProjectCard';
import ProjectDetail from './ProjectDetail';
import Scenery from './Scenery';
import AuthPage from './AuthPage';
import AccountPage from './AccountPage';
import * as authService from './services/authService';
import { fetchProjectList, createProject } from './services/projectService';
import CreateAlbumModal from './CreateAlbumModal';
import { resolveAssetUrl } from './services/request';
import TransferStation from './TransferStation';
import IfCan from './components/IfCan';
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
  

  const latestRequestRef = React.useRef(0);

  const loadProjects = React.useCallback(async (kw = '', page = 1, pageSize = 6) => {
    const currentToken = latestRequestRef.current + 1;
    latestRequestRef.current = currentToken;
    setLoading(true);
    setError(null);
    try {
      // 后端分页接口：GET /api/projects/list?page=1&pageSize=6&keyword=xxx
      const response = await fetchProjectList({ page, pageSize, keyword: kw?.trim() || undefined });
      if (latestRequestRef.current !== currentToken) return;

      const list = Array.isArray(response?.list) ? response.list : [];
      setProjects(list);
    } catch (err) {
      if (latestRequestRef.current !== currentToken) return;
      // 展示更详细的错误信息（后端可能携带 body）
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

  // load current user on app start (fetch permissions from backend)
  React.useEffect(() => {
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
      if (path === '/scenery') {
        setSelectedNav('scenery');
        setCurrentProjectId(null);
      } else if (path === '/login') {
        // if visiting /login and already authenticated, redirect to root
        if (currentUser) {
          try { window.history.replaceState({}, '', '/'); } catch (e) {}
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
        if (path === '/scenery') {
          setSelectedNav('scenery');
          setCurrentProjectId(null);
        } else if (path === '/login') {
          // on popstate to /login, keep showing auth if not logged in
          if (currentUser) {
            try { window.history.replaceState({}, '', '/'); } catch (e) {}
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
      const title = project?.title ?? project?.projectName ?? project?.name ?? '未命名项目';
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

  return (
    // If still checking auth, show spinner; if not logged in, show AuthPage
    authLoading ? (
      <div style={{ width: '100%', height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Spin size="large" tip="检查登录状态中" />
      </div>
    ) : !currentUser ? (
      <AuthPage onAuthenticated={(u) => { setCurrentUser(u); loadProjects(); }} />
    ) : (
    <Layout style={{ background: '#f4f4f4ff' }}>
      <Header
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 1000,
          padding: 0,
          background: '#ffffff',
        }}
      >
        <div style={{ padding: '0 0px' }}>
          <Nav
            mode="horizontal"
            items={[
              { itemKey: 'projects', text: '项目', onClick: () => { handleBackToList(); } },
              { itemKey: 'scenery', text: '风景', onClick: () => { setSelectedNav('scenery'); setCurrentProjectId(null); try { window.history.pushState({}, '', '/scenery'); } catch(e){} } },
              { itemKey: 'function', text: (
                <Popover
                  position="bottomLeft"
                  trigger="hover"
                  content={(
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 160 }}>
                      <Button onClick={() => { try { window.history.pushState({}, '', '/function/ai-writer'); } catch (e) {} setSelectedNav('function'); setFunctionPage('ai-writer'); }}>AI 写新闻/推送</Button>
                      <div style={{ color: '#666', fontSize: 13 }}>更多功能入口</div>
                    </div>
                  )}
                >
                  <span style={{ cursor: 'pointer' }}>功能</span>
                </Popover>
              ), onClick: () => { setSelectedNav('function'); setCurrentProjectId(null); try { window.history.pushState({}, '', '/function'); } catch(e){} } },
              { itemKey: 'about', text: '关于', onClick: () => { setSelectedNav('about'); setCurrentProjectId(null); try { window.history.pushState({}, '', '/about'); } catch(e){} } },
            ]}
            header={{
              text: 'MaMage 图库',
            }}
            footer={(
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <Input
                  placeholder="搜索项目 / 标签"
                  prefix={<IconSearch />}
                  showClear
                  style={{ width: 260 }}
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
                  {/* 全局上传入口已移除 — 上传由项目详情页的“我要补充照片”承担 */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {currentUser ? (
                    <Popover
                      content={(
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 140 }}>
                          <Button type="tertiary" onClick={() => { try { const url = new URL(window.location.href); window.history.pushState({}, '', '/account'); setSelectedNav('account'); } catch (e) {} }}>账户信息</Button>
                          <Button type="tertiary" theme="borderless" onClick={async () => { try { await authService.logout(); setCurrentUser(null); try { window.history.pushState({}, '', '/login'); } catch(e){} } catch (e) { console.error(e); } }}>退出账号</Button>
                        </div>
                      )}
                      trigger="hover"
                      position="bottomRight"
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                        <Avatar size="small" alt={currentUser?.name || ''} style={{ backgroundColor: '#d9d9d9' }}>{(currentUser?.name || currentUser?.displayName || currentUser?.email || 'U')[0]}</Avatar>
                        <span style={{ fontSize: 14 }}>{currentUser && (currentUser.displayName || currentUser.email || currentUser.name)}</span>
                      </div>
                    </Popover>
                  ) : null}
                </div>
              </div>
            )}
          />
        </div>
      </Header>

      <Content style={{ padding: 24 }}>
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
                  <Spin size="large" tip="加载项目中" />
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
                        <Button onClick={() => { try { window.history.pushState({}, '', '/function/ai-writer'); } catch (e) {} setSelectedNav('function'); setFunctionPage('ai-writer'); }}>AI 写新闻/推送</Button>
                      </div>
                      <div style={{ color: '#666' }}>更多功能正在开发中…</div>
                    </div>
                  </Card>
                </div>
              )
            ) : (
              <div style={{ padding: 24 }}><Text>暂未实现该页面</Text></div>
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
    )
  );
}

export default App;
