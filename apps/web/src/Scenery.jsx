// Scenery page: render ProjectDetail for projectId=1 but hide metadata header
import React from 'react';
import ProjectDetail from './ProjectDetail';
import './Scenery.css';

export default function Scenery() {
  // use projectId 1 explicitly; ProjectDetail expects string or number
  return (
    <div className="scenery-page">
      <ProjectDetail projectId={1} initialProject={null} onBack={() => { /* no-op for scenery */ }} />
    </div>
  );
}
