// src/App.jsx
import React from 'react';
import { Layout, Typography, Input, Nav, Avatar, Spin, Empty, Button } from '@douyinfe/semi-ui';
import '@semi-bot/semi-theme-mamage_day/semi.css';
import { IconUser, IconSearch } from '@douyinfe/semi-icons';
import ProjectCard from './ProjectCard';
import ProjectDetail from './ProjectDetail';
import { fetchProjectList, createProject } from './services/projectService';
import CreateAlbumModal from './CreateAlbumModal';
import { resolveAssetUrl } from './services/request';
import TransferStation from './TransferStation';

const { Header, Content, Footer } = Layout;
const { Text } = Typography;

function App() {
  const [projects, setProjects] = React.useState([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState(null);
  const [keyword, setKeyword] = React.useState('');
  const [currentProjectId, setCurrentProjectId] = React.useState(null);
  const [showCreateModal, setShowCreateModal] = React.useState(false);
  

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

  const handleSearchSubmit = React.useCallback(() => {
    loadProjects(keyword);
  }, [keyword, loadProjects]);

  const handleSelectProject = React.useCallback((projectId) => {
    setCurrentProjectId(projectId);
  }, []);

  const handleBackToList = React.useCallback(() => {
    setCurrentProjectId(null);
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
              { itemKey: 'function', text: '功能', onClick: () => { /* 未实现的导航项 */ } },
              { itemKey: 'about', text: '关于', onClick: () => { /* 未实现的导航项 */ } },
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
                  <Button onClick={() => setShowCreateModal(true)}>
                    新建相册
                  </Button>
                <Avatar size="small" color="orange" icon={<IconUser />} />
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
