// Scenery page: render ProjectDetail for projectId=1 but hide metadata header
import React from 'react';
import ProjectDetail from './ProjectDetail';
import './Scenery.css';
import { getToken } from './services/authService';

export default function Scenery() {
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(null);
  const [project, setProject] = React.useState(null);

  React.useEffect(() => {
    let canceled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const headers = {};
        const token = getToken ? getToken() : null;
        if (token) headers['Authorization'] = `Bearer ${token}`;
        const res = await fetch('/api/projects/scenery', { headers });
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          throw new Error(`Failed to fetch scenery projects: ${res.status} ${text}`);
        }
        const data = await res.json().catch(() => []);
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
      {loading ? (
        <div style={{ padding: 24 }}>加载中…</div>
      ) : error ? (
        <div style={{ padding: 24, color: '#e53935' }}>加载风景项目失败：{error}</div>
      ) : project ? (
        <ProjectDetail projectId={project.id} initialProject={project} onBack={() => { /* no-op for scenery */ }} />
      ) : (
        <div style={{ padding: 24 }}>暂无风景相册</div>
      )}
    </div>
  );
}
