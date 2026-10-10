// src/index.jsx
import React from 'react';
import { createRoot } from 'react-dom/client';
import './global.css';
import './liquidGlass.css';
import App from './App';

const container = document.getElementById('root');
const root = createRoot(container);

if (process.env.NODE_ENV !== 'production' && window.location.pathname === '/__prototype/share-album') {
  import('./prototypes/ShareAlbumPrototype').then(({ default: ShareAlbumPrototype }) => {
    root.render(<ShareAlbumPrototype />);
  });
} else if (process.env.NODE_ENV !== 'production' && window.location.pathname === '/__prototype/album-form') {
  import('./prototypes/AlbumFormPrototype').then(({ default: AlbumFormPrototype }) => {
    root.render(<AlbumFormPrototype />);
  });
} else if (process.env.NODE_ENV !== 'production' && window.location.pathname === '/__prototype/album-collections') {
  import('./prototypes/AlbumCollectionsPrototype').then(({ default: AlbumCollectionsPrototype }) => {
    root.render(<AlbumCollectionsPrototype />);
  });
} else {
  root.render(<App />);
}
