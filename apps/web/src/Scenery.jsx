// Scenery page: render ProjectDetail for projectId=1 but hide metadata header
import React from 'react';
import ProjectDetail from './ProjectDetail';
import { goBack } from './utils/navigation';
import './Scenery.css';
import { fetchSceneryProjects } from './services/projectService';
import { Button, ButtonGroup } from './ui';

export default function Scenery({ currentUser = null }) {
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(null);
  const [project, setProject] = React.useState(null);
  const [galleryMode, setGalleryMode] = React.useState('masonry');

  React.useEffect(() => {
    let canceled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchSceneryProjects();
        if (canceled) return;
        if (Array.isArray(data) && data.length > 0) {
          // choose the first scenery project by default
          setProject(data[0]);
        } else {
          setProject(null);
        }
      } catch (e) {
        if (canceled) return;
        console.error('Scenery fetch error', e);
        setError(e.message || String(e));
        setProject(null);
      } finally {
        if (!canceled) setLoading(false);
      }
    })();
    return () => { canceled = true; };
  }, []);

  return (
    <div className="scenery-page">
      <div className="scenery-toolbar">
        <ButtonGroup>
          <Button type={galleryMode === 'grid' ? 'primary' : 'tertiary'} onClick={() => setGalleryMode('grid')}>宫格</Button>
          <Button type={galleryMode === 'masonry' ? 'primary' : 'tertiary'} onClick={() => setGalleryMode('masonry')}>瀑布流</Button>
        </ButtonGroup>
      </div>
      {loading ? (
        <div style={{ padding: 24 }}>加载中…</div>
      ) : error ? (
        <div style={{ padding: 24, color: '#e53935' }}>加载风景项目失败：{error}</div>
      ) : project ? (
        <ProjectDetail
          projectId={project.id}
          initialProject={project}
          currentUser={currentUser}
          onBack={() => goBack('/')}
          galleryMode={galleryMode}
          onGalleryModeChange={setGalleryMode}
        />
      ) : (
        <div style={{ padding: 24 }}>暂无风景相册</div>
      )}
    </div>
  );
}
