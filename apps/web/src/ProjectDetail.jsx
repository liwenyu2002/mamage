// src/ProjectDetail.jsx
import React from 'react';
import { Typography, Button, Tag, Spin, Empty, Modal, Input, DatePicker, TextArea, Toast } from '@douyinfe/semi-ui';
import './ProjectDetail.css';
import { getProjectById, updateProject, deleteProject } from './services/projectService';
import { me as fetchMe, getToken } from './services/authService';
import { fetchRandomByProject, uploadPhotos, deletePhotos } from './services/photoService';
import { resolveAssetUrl, BASE_URL } from './services/request';
import IfCan from './permissions/IfCan';
import PermButton from './permissions/PermButton';
import { canAny } from './permissions/permissionStore';

const { Title, Text } = Typography;

function safeParseTags(tags) {
  try {
    if (Array.isArray(tags)) return tags;
    if (typeof tags === 'string') return JSON.parse(tags || '[]');
    return [];
  } catch (e) {
    console.warn('Failed to parse tags:', tags, e);
    return [];
  }
}

function ProjectDetail({
  projectId,
  initialProject,
  onBack,
  galleryMode: controlledGalleryMode,
  onGalleryModeChange,
}) {
  const [project, setProject] = React.useState(initialProject || null);
  const [images, setImages] = React.useState(() => (initialProject?.images ? initialProject.images.map((it) => (typeof it === 'string' ? resolveAssetUrl(it) : resolveAssetUrl(it.url || it.imageUrl || it.src || it.fileUrl || ''))) : []));
  const [photoMetas, setPhotoMetas] = React.useState(() => (initialProject?.images ? initialProject.images.map((it) => (typeof it === 'string' ? { url: it } : it)) : []));
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState(null);

  // upload / staging
  const [uploadMode, setUploadMode] = React.useState(false);
  const [stagingFiles, setStagingFiles] = React.useState([]); // File objects
  const [stagingPreviews, setStagingPreviews] = React.useState([]); // object URLs
  const [uploading, setUploading] = React.useState(false);

  // edit modal
  const [editVisible, setEditVisible] = React.useState(false);
  const [editTitle, setEditTitle] = React.useState('');
  const [editDescription, setEditDescription] = React.useState('');
  const [editEventDate, setEditEventDate] = React.useState(null); // Date object or null
  const [editTags, setEditTags] = React.useState([]);
  const [editTagInput, setEditTagInput] = React.useState('');
  const [userPermissions, setUserPermissions] = React.useState([]);
  const [deletingProject, setDeletingProject] = React.useState(false);

  // selection / delete
  const [deleteMode, setDeleteMode] = React.useState(false);
  const [selectedMap, setSelectedMap] = React.useState({});
  const [selectedCount, setSelectedCount] = React.useState(0);
  const [allSelected, setAllSelected] = React.useState(false);
  const [deletingPhotos, setDeletingPhotos] = React.useState(false);

  const fileInputRef = React.useRef(null);
  const dragPreviewRef = React.useRef(null);
  const [hoveredPhotoIdx, setHoveredPhotoIdx] = React.useState(-1);
  const [dragActive, setDragActive] = React.useState(false);
  const [uploadHover, setUploadHover] = React.useState(false);

  const galleryRef = React.useRef(null);
  const [galleryWidth, setGalleryWidth] = React.useState(0);
  const [imageRatios, setImageRatios] = React.useState({});
  // image viewer
  const [viewerVisible, setViewerVisible] = React.useState(false);
  const [viewerIndex, setViewerIndex] = React.useState(0);
  // whether viewer currently shows the original image (toggle per viewer open/index)
  const [viewerShowOriginal, setViewerShowOriginal] = React.useState(false);
  // parsed photo tags and descriptions indexed by photo ID
  const [photoTagsMap, setPhotoTagsMap] = React.useState({});
  const [photoDescMap, setPhotoDescMap] = React.useState({});
  // AI selection mode toggle
  const [showAILabels, setShowAILabels] = React.useState(false);
  // AI recommendation labels (recommended/rejected) indexed by photo ID
  const [photoAILabelMap, setPhotoAILabelMap] = React.useState({});
  // viewer-based photo edit (tags & description)
  const [viewerEditVisible, setViewerEditVisible] = React.useState(false);
  const [viewerEditTags, setViewerEditTags] = React.useState([]);
  const [viewerEditTagInput, setViewerEditTagInput] = React.useState('');
  const [viewerEditDescription, setViewerEditDescription] = React.useState('');
  const [internalGalleryMode, setInternalGalleryMode] = React.useState('masonry'); // 'grid' | 'masonry'
  const galleryMode = controlledGalleryMode || internalGalleryMode;
  const handleGalleryModeChange = React.useCallback((nextMode) => {
    if (onGalleryModeChange) onGalleryModeChange(nextMode);
    if (!controlledGalleryMode) setInternalGalleryMode(nextMode);
  }, [onGalleryModeChange, controlledGalleryMode]);

  // similarity modal (鐩镐技鐓х墖鍒嗙粍)
  const [simModalVisible, setSimModalVisible] = React.useState(false);
  const [simLoading, setSimLoading] = React.useState(false);
  const [simGroups, setSimGroups] = React.useState(null);
  const [simPhotos, setSimPhotos] = React.useState({}); // id -> meta
  const [simError, setSimError] = React.useState(null);
  const [simDeleteMode, setSimDeleteMode] = React.useState(false);
  const [simSelectedMap, setSimSelectedMap] = React.useState({}); // id -> true
  const [simSelectedCount, setSimSelectedCount] = React.useState(0);
  const [simDeleting, setSimDeleting] = React.useState(false);
  const [isMobile, setIsMobile] = React.useState(() => (typeof window !== 'undefined' ? window.innerWidth <= 768 : false));

  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onResize = () => setIsMobile(window.innerWidth <= 768);
    onResize();
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, []);

  React.useEffect(() => {
    if (initialProject) {
      setProject((prev) => {
        if (!prev || (initialProject.id && prev.id !== initialProject.id)) {
          return initialProject;
        }
        return prev;
      });
      if (initialProject.images && initialProject.images.length) {
        setImages((prev) => (prev.length ? prev : initialProject.images.map((it) => (typeof it === 'string' ? resolveAssetUrl(it) : resolveAssetUrl(it.url || it.imageUrl || it.src || it.fileUrl || '')))));
        setPhotoMetas((prev) => (prev.length ? prev : initialProject.images.map((it) => (typeof it === 'string' ? { url: it } : it))));
      }
    }
  }, [initialProject]);

  // helper: construct aligned images (src strings) and metas (original objects) from project detail
  const buildImagesAndMetas = React.useCallback((detail) => {
    if (!detail) return { images: [], metas: [] };
    const items = (detail.images || detail.photos || detail.gallery || []).filter(Boolean);
    const photoIds = Array.isArray(detail.photo_ids) ? detail.photo_ids : (Array.isArray(detail.photoIds) ? detail.photoIds : null);
    const tagsMap = {};
    const descMap = {};
    const normalized = items.map((item, idx) => {
      if (typeof item === 'string') {
        const meta = { url: item };
        if (photoIds && photoIds[idx] !== undefined) meta.id = photoIds[idx];
        // determine thumbnail and original candidates
        let thumbCandidate = meta.thumbUrl || meta.thumbnail || meta.thumb || item;
        const origCandidate = meta.originalUrl || meta.original || meta.full || meta.large || item;
        // If thumb candidate equals original, try to infer a thumbnail path in the same directory
        // common pattern: /uploads/2025/12/01/<filename>.jpg -> /uploads/2025/12/01/thumbs/thumb_<filename>.jpg
        try {
          if (thumbCandidate === origCandidate) {
            const m = String(origCandidate).match(/^(.*\/)([^\/]+)$/);
            if (m) {
              const dir = m[1];
              const file = m[2];
              thumbCandidate = `${dir}thumbs/thumb_${file}`;
            } else {
              // fallback: append a query param to distinguish cache key
              thumbCandidate = `${thumbCandidate}${thumbCandidate.includes('?') ? '&' : '?'}thumb=1`;
            }
          }
        } catch (e) { }

        const metaFinal = Object.assign({}, meta, { thumbSrc: resolveAssetUrl(thumbCandidate), originalSrc: resolveAssetUrl(origCandidate) });
        if (metaFinal.id) {
          tagsMap[metaFinal.id] = safeParseTags(item.tags);
          descMap[metaFinal.id] = item.description || item.desc || '';
        }
        // If this resolved src is still relative but there are absolute urls
        // available elsewhere in the provided items, try to prefer an absolute one.
        let resolvedSrc = resolveAssetUrl(thumbCandidate);
        try {
          const isRelativeResolved = resolvedSrc && /^\//.test(resolvedSrc);
          if (isRelativeResolved) {
            const allSrcs = items.map((it) => (typeof it === 'string' ? it : (it && (it.url || it.imageUrl || it.src || it.fileUrl)))).filter(Boolean);
            const absCandidates = allSrcs.filter(s => /^https?:\/\//i.test(s));
            if (absCandidates.length) {
              const getFilename = (s) => { try { const m = String(s).match(/([^\/:?#]+)(?:[?#].*)?$/); return m ? m[1] : null; } catch (e) { return null; } };
              const targetName = getFilename(item);
              let pick = null;
              if (targetName) pick = absCandidates.find(a => getFilename(a) === targetName) || null;
              if (!pick) pick = absCandidates[0];
              if (pick) {
                resolvedSrc = pick;
                metaFinal.thumbSrc = pick;
                // if original was relative, also try to set originalSrc to absolute equivalent
                metaFinal.originalSrc = pick;
              }
            }
          }
        } catch (e) { }

        return {
          src: resolvedSrc,
          meta: metaFinal
        };
      }
      const src = item.url || item.imageUrl || item.src || item.fileUrl || null;
      const meta = Object.assign({}, item);
      if (!meta.id && photoIds && photoIds[idx] !== undefined) meta.id = photoIds[idx];
      if (!src) return null;
      let thumbCandidate = meta.thumbUrl || meta.thumbnail || meta.thumb || src;
      const origCandidate = meta.originalUrl || meta.original || meta.full || meta.large || src;
      try {
        if (thumbCandidate === origCandidate) {
          const m = String(origCandidate).match(/^(.*\/)([^\/]+)$/);
          if (m) {
            const dir = m[1];
            const file = m[2];
            thumbCandidate = `${dir}thumbs/thumb_${file}`;
          } else {
            thumbCandidate = `${thumbCandidate}${thumbCandidate.includes('?') ? '&' : '?'}thumb=1`;
          }
        }
      } catch (e) { }
      const metaFinal = Object.assign({}, meta, { thumbSrc: resolveAssetUrl(thumbCandidate), originalSrc: resolveAssetUrl(origCandidate) });
      if (metaFinal.id) {
        tagsMap[metaFinal.id] = safeParseTags(item.tags);
        descMap[metaFinal.id] = item.description || item.desc || '';
      }
      // Prefer absolute candidate when available (similar to ProjectCard behavior)
      let resolvedSrc = resolveAssetUrl(thumbCandidate);
      try {
        const isRelativeResolved = resolvedSrc && /^\//.test(resolvedSrc);
        if (isRelativeResolved) {
          const allSrcs = items.map((it) => (typeof it === 'string' ? it : (it && (it.url || it.imageUrl || it.src || it.fileUrl)))).filter(Boolean);
          const absCandidates = allSrcs.filter(s => /^https?:\/\//i.test(s));
          if (absCandidates.length) {
            const getFilename = (s) => { try { const m = String(s).match(/([^\/:?#]+)(?:[?#].*)?$/); return m ? m[1] : null; } catch (e) { return null; } };
            const targetName = getFilename(src || meta.url);
            let pick = null;
            if (targetName) pick = absCandidates.find(a => getFilename(a) === targetName) || null;
            if (!pick) pick = absCandidates[0];
            if (pick) {
              resolvedSrc = pick;
              metaFinal.thumbSrc = pick;
              metaFinal.originalSrc = pick;
            }
          }
        }
      } catch (e) { }

      return {
        src: resolvedSrc,
        meta: metaFinal
      };
    }).filter(Boolean);
    // Only update global maps if we actually found any tags/descriptions
    // to avoid clearing previously-loaded tags (for example from /api/photos)
    if (Object.keys(tagsMap).length) {
      setPhotoTagsMap(tagsMap);
    }
    if (Object.keys(descMap).length) {
      setPhotoDescMap(descMap);
    }
    return { images: normalized.map((n) => n.src), metas: normalized.map((n) => n.meta) };
  }, []);

  React.useEffect(() => {
    // cleanup previews on unmount
    return () => {
      stagingPreviews.forEach((u) => {
        try { URL.revokeObjectURL(u); } catch (e) { }
      });
    };
  }, [stagingPreviews]);

  React.useEffect(() => {
    if (!projectId) return undefined;
    let canceled = false;

    const extractImageUrls = (list) => {
      if (!Array.isArray(list)) return [];
      return list
        .map((item) => {
          if (!item) return null;
          if (typeof item === 'string') return item;
          return item.url || item.imageUrl || item.src || item.fileUrl || null;
        })
        .filter(Boolean);
    };

    const mergeUnique = (primary, fallback) => {
      const seen = new Set();
      const result = [];
      [
        ...(Array.isArray(primary) ? primary : []),
        ...(Array.isArray(fallback) ? fallback : []),
      ].forEach((src) => {
        if (!src || seen.has(src)) return;
        seen.add(src);
        result.push(src);
      });
      return result;
    };

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const detail = await getProjectById(projectId);
        if (canceled) return;

        setProject(detail);

        const detailImages = mergeUnique(
          extractImageUrls(detail?.images ?? detail?.photos ?? detail?.gallery),
          extractImageUrls(detail?.previewImages)
        );

        let gallery = detailImages;
        if (!gallery.length) {
          const random = await fetchRandomByProject(projectId, 30);
          if (canceled) return;
          const randomList = Array.isArray(random?.list) ? random.list : Array.isArray(random) ? random : [];
          gallery = mergeUnique(detailImages, extractImageUrls(randomList).map(resolveAssetUrl));
        }

        if (!gallery.length && initialProject?.images?.length) {
          gallery = mergeUnique(gallery, initialProject.images.map(resolveAssetUrl));
        }

        // use helper to include photo_ids if available
        const built = buildImagesAndMetas({ images: gallery, photo_ids: detail?.photo_ids, photoIds: detail?.photoIds });
        setImages(built.images);
        setPhotoMetas(built.metas);

        // Use photos embedded in project detail (preferred) instead of calling /api/photos
        try {
          const photoIds = built.metas.map((m) => m.id).filter(Boolean);
          if (photoIds.length > 0) {
            const photosArray = Array.isArray(detail.photos) ? detail.photos : (Array.isArray(detail.images) ? detail.images : []);
            const photoMap = {};

            if (photosArray.length) {
              photosArray.forEach((p) => {
                const id = p && (p.id || p.photoId || p.photo_id);
                if (!id) return;
                const allTags = p.tags ? safeParseTags(p.tags) : [];
                let aiLabel = null;
                if (allTags.includes('AI recommended')) aiLabel = 'recommended';
                else if (allTags.includes('AI rejected')) aiLabel = 'rejected';
                const otherTags = allTags.filter(tag => tag !== 'AI recommended' && tag !== 'AI rejected');
                photoMap[id] = { tags: otherTags, description: p.description || p.desc || '', aiLabel, raw: p };
              });
            }

            // merge/extend existing maps instead of replacing to avoid wiping data
            const tagsMapOnly = {};
            const descMapOnly = {};
            const aiLabelMapOnly = {};
            Object.keys(photoMap).forEach((id) => {
              tagsMapOnly[id] = photoMap[id].tags;
              descMapOnly[id] = photoMap[id].description;
              aiLabelMapOnly[id] = photoMap[id].aiLabel;
            });

            setPhotoTagsMap((prev) => ({ ...(prev || {}), ...tagsMapOnly }));
            setPhotoDescMap((prev) => ({ ...(prev || {}), ...descMapOnly }));
            setPhotoAILabelMap((prev) => ({ ...(prev || {}), ...aiLabelMapOnly }));

            // 濡傛灉 detail 涓繑鍥炰簡鏇村畬鏁寸殑 photo 瀵硅薄锛屽悎骞惰繖浜涘瓧娈靛洖 photoMetas
            try {
              const photoById = {};
              photosArray.forEach(p => { const id = p && (p.id || p.photoId || p.photo_id); if (id) photoById[id] = p; });
              if (Object.keys(photoById).length) {
                const merged = (built.metas || []).map((m) => {
                  if (!m) return m;
                  const p = photoById[m.id];
                  if (!p) return m;
                  const mergedMeta = Object.assign({}, m, p);
                  const thumbCandidate = p.thumbUrl || p.thumb || p.thumbnail || mergedMeta.thumbSrc || mergedMeta.thumb || mergedMeta.src || p.url;
                  const origCandidate = p.url || p.originalUrl || p.original || p.full || mergedMeta.originalSrc || mergedMeta.url || mergedMeta.src;
                  mergedMeta.thumbSrc = resolveAssetUrl(thumbCandidate);
                  mergedMeta.originalSrc = resolveAssetUrl(origCandidate);
                  return mergedMeta;
                });
                setPhotoMetas(merged);
                setImages(merged.map((m) => m.thumbSrc || m.src || resolveAssetUrl(m.url || m.fileUrl || m.imageUrl || '')));
              }
            } catch (e) {
              console.warn('merge photo urls failed', e);
            }

            // 濡傛灉閮ㄥ垎 photo meta 缂哄皯 photographerName锛屼絾鍖呭惈 photographerId锛?
            // 鍓嶇浠嶅彲鍥為€€鍘昏姹傜敤鎴蜂俊鎭苟琛ュ叏 name锛堝彲淇濈暀浠ユ彁鍗囦綋楠岋級銆?
            try {
              const mergedList = (built.metas || []).map(m => m).map(m => ({ ...(m || {}) }));
              const idsToFetch = Array.from(new Set((mergedList || [])
                .filter(p => p && !p.photographerName && (p.photographerId || p.userId || p.ownerId))
                .map(p => p.photographerId || p.userId || p.ownerId)
                .filter(Boolean)));
              if (idsToFetch.length) {
                const token = getToken ? getToken() : null;
                const headers = token ? { Authorization: `Bearer ${token}` } : {};
                const fetchUser = async (id) => {
                  try {
                    const resp = await fetch(`/api/users/${id}`, { headers });
                    if (!resp.ok) return null;
                    const data = await resp.json();
                    return data && (data.name || data.username || data.displayName || data.nickname || data.nick || data.realName);
                  } catch (e) {
                    return null;
                  }
                };

                const userNamePromises = idsToFetch.map(id => fetchUser(id));
                const names = await Promise.all(userNamePromises);
                const idToName = {};
                idsToFetch.forEach((id, i) => { if (names[i]) idToName[id] = names[i]; });
                if (Object.keys(idToName).length) {
                  const updated = (mergedList || []).map((m) => {
                    if (!m) return m;
                    const pid = m.photographerId || m.userId || m.ownerId;
                    if (pid && !m.photographerName && idToName[pid]) {
                      return Object.assign({}, m, { photographerName: idToName[pid] });
                    }
                    return m;
                  });
                  setPhotoMetas(updated);
                }
              }
            } catch (e) {
              // 蹇界暐缃戠粶閿欒锛屼笉褰卞搷涓绘祦绋?
            }
          }
        } catch (e) {
          console.warn('Failed to process photos from project detail:', e);
        }
      } catch (err) {
        if (canceled) return;
        setError(err?.message || '鑾峰彇椤圭洰璇︽儏澶辫触');
        if (initialProject?.images?.length) {
          setImages(initialProject.images.map((it) => (typeof it === 'string' ? resolveAssetUrl(it) : resolveAssetUrl(it.url || it.imageUrl || it.src || it.fileUrl || ''))));
          setPhotoMetas(initialProject.images.map((it) => (typeof it === 'string' ? { url: it } : it)));
        }
      } finally {
        if (!canceled) setLoading(false);
      }
    };

    load();

    return () => {
      canceled = true;
    };
  }, [projectId, initialProject]);

  // fetch current user to get permissions from backend
  React.useEffect(() => {
    // If this detail view is being opened as a public share, skip fetching
    // the current user to avoid forcing an auth check for anonymous visitors.
    let cancelled = false;
    try {
      if (typeof window !== 'undefined' && window.location && String(window.location.pathname).startsWith('/share/')) {
        // do not attempt to fetch current user on public share pages
        return () => { cancelled = true; };
      }
    } catch (e) {
      // ignore and continue to fetch
    }

    (async () => {
      try {
        const u = await fetchMe();
        if (cancelled) return;
        // u.permissions is now the source of truth (array of permission strings)
        const perms = Array.isArray(u && u.permissions) ? u.permissions : [];
        setUserPermissions(perms);
      } catch (e) {
        // ignore
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ========== Upload / Edit / Selection handlers ==========
  const openUploadPicker = React.useCallback(() => {
    if (fileInputRef.current) fileInputRef.current.click();
  }, []);

  const handleFilesSelected = React.useCallback((files) => {
    const MAX_FILES = 15;
    let list = Array.from(files || []);
    if (list.length > MAX_FILES) {
      try { Toast.warning(`一次最多上传 ${MAX_FILES} 张照片，已选择前 ${MAX_FILES} 张`); } catch (e) { }
      list = list.slice(0, MAX_FILES);
    }
    const previews = list.map((f) => URL.createObjectURL(f));
    setStagingFiles(list);
    setStagingPreviews(previews);
    setUploadMode(true);
  }, []);

  const cancelUpload = React.useCallback(() => {
    stagingPreviews.forEach((u) => { try { URL.revokeObjectURL(u); } catch (e) { } });
    setStagingFiles([]);
    setStagingPreviews([]);
    setUploadMode(false);
    setUploading(false);
  }, [stagingPreviews]);

  const confirmUpload = React.useCallback(async () => {
    if (!stagingFiles.length || !projectId) return;
    const MAX_FILES = 15;
    let filesToUpload = stagingFiles;
    if (stagingFiles.length > MAX_FILES) {
      try { Toast.warning(`一次最多上传 ${MAX_FILES} 张照片，已按前 ${MAX_FILES} 张上传`); } catch (e) { }
      filesToUpload = stagingFiles.slice(0, MAX_FILES);
    }
    setUploading(true);
    try {
      // upload one file at a time using correct endpoint
      for (const f of filesToUpload) {
        // pass file and projectId to uploadPhotos; it will construct FormData
        await uploadPhotos({ file: f, projectId });
      }
      Toast.success('涓婁紶鎴愬姛');
      cancelUpload();
      // reload images
      try {
        const detail = await getProjectById(projectId);
        setProject(detail);
        const built = buildImagesAndMetas(detail);
        setImages(built.images);
        setPhotoMetas(built.metas);
      } catch (e) { /* ignore */ }
    } catch (err) {
      console.error('upload error', err);
      Toast.error('涓婁紶澶辫触');
    } finally {
      setUploading(false);
    }
  }, [stagingFiles, projectId, cancelUpload]);

  const openEdit = React.useCallback(() => {
    const p = project || {};
    setEditTitle(p.title || p.projectName || '');
    setEditDescription(p.description || '');
    setEditEventDate(p.date ? (p.date.slice && typeof p.date === 'string' ? new Date(p.date) : (p.date instanceof Date ? p.date : new Date(p.date))) : null);
    // populate tags for admin
    const incomingTags = p.tags || p.labels || p.tagList || p.projectTags || [];
    const normalized = Array.isArray(incomingTags) ? incomingTags.map((t) => (typeof t === 'string' ? t : String(t))).filter(Boolean) : (typeof incomingTags === 'string' ? incomingTags.split(/[;,\n]/).map(s => s.trim()).filter(Boolean) : []);
    setEditTags(normalized);
    setEditVisible(true);
  }, [project]);

  const saveEdit = React.useCallback(async () => {
    if (!projectId) return;
    try {
      // normalize eventDate to YYYY-MM-DD string or null
      let eventDatePayload = null;
      if (editEventDate) {
        if (editEventDate instanceof Date) {
          const y = editEventDate.getFullYear();
          const m = String(editEventDate.getMonth() + 1).padStart(2, '0');
          const d = String(editEventDate.getDate()).padStart(2, '0');
          eventDatePayload = `${y}-${m}-${d}`;
        } else {
          eventDatePayload = String(editEventDate).slice(0, 10);
        }
      }

      const payload = { projectName: editTitle, description: editDescription, eventDate: eventDatePayload || null };
      // only include tags when current user has permission
      if (canUpdateProject || canEditTags) {
        payload.tags = editTags && editTags.length ? editTags : [];
      }
      await updateProject(projectId, payload);
      Toast.success('已保存');
      setEditVisible(false);
      // reload
      const detail = await getProjectById(projectId);
      setProject(detail);
      const built = buildImagesAndMetas(detail);
      setImages(built.images);
      setPhotoMetas(built.metas);
    } catch (err) {
      console.error('saveEdit error', err);
      const status = err && err.status ? err.status : (err && err.cause && err.cause.status) ? err.cause.status : null;
      if (status === 401 || status === 403) {
        try { localStorage.removeItem('mamage_jwt_token'); } catch (e) { }
        Toast.error('璇烽噸鏂扮櫥褰曠鐞嗗憳璐﹀彿');
        try { window.history.pushState({}, '', '/login'); } catch (e) { window.location.href = '/login'; }
      } else if (status === 404) {
        Toast.warning('鐩稿唽宸蹭笉瀛樺湪');
        if (typeof onBack === 'function') onBack(true);
      } else if (status && status >= 500) {
        Toast.error('服务器异常，请稍后重试');
      } else {
        Toast.error('淇濆瓨澶辫触');
      }
    }
  }, [projectId, editTitle, editDescription, editEventDate]);

  const handleDeleteProject = React.useCallback(() => {
    if (!projectId) return Toast.warning('鏃犳晥鐨勯」鐩甀D');
    Modal.confirm({
      title: '纭鍒犻櫎鐩稿唽',
      content: '删除后将不可恢复，且可能同时删除关联照片。确定要删除该相册吗？',
      onOk: async () => {
        setDeletingProject(true);
        try {
          const res = await deleteProject(projectId);
          // assume success if no exception; backend may return { success: true }
          Toast.success('相册已删除');
          if (typeof onBack === 'function') {
            onBack(true);
          }
        } catch (err) {
          console.error('deleteProject error', err);
          const status = err && err.status ? err.status : (err && err.cause && err.cause.status) ? err.cause.status : null;
          if (status === 401 || status === 403) {
            try { localStorage.removeItem('mamage_jwt_token'); } catch (e) { }
            Toast.error('鏉冮檺涓嶈冻鎴栫櫥褰曞凡杩囨湡锛岃閲嶆柊鐧诲綍鎴栬仈绯荤鐞嗗憳');
            try { window.history.pushState({}, '', '/login'); } catch (e) { window.location.href = '/login'; }
          } else if (status === 404) {
            Toast.warning('鐩稿唽宸蹭笉瀛樺湪');
            if (typeof onBack === 'function') onBack(true);
          } else if (status && status >= 500) {
            Toast.error('服务器异常，请稍后重试');
          } else {
            Toast.error('鍒犻櫎澶辫触');
          }
        } finally {
          setDeletingProject(false);
        }
      }
    });
  }, [projectId, onBack]);

  const toggleDeleteMode = React.useCallback(() => {
    const turningOff = !!deleteMode;
    setDeleteMode(!deleteMode);
    if (turningOff) {
      setSelectedMap({});
      setSelectedCount(0);
      setAllSelected(false);
    }
  }, [deleteMode]);

  const toggleSelect = React.useCallback((index) => {
    const key = String(index);
    const map = Object.assign({}, selectedMap || {});
    if (map[key]) delete map[key]; else map[key] = true;
    const count = Object.keys(map).length;
    const total = (images && images.length) || 0;
    setSelectedMap(map);
    setSelectedCount(count);
    setAllSelected(total > 0 && count === total);
  }, [selectedMap, images]);

  const toggleSelectAll = React.useCallback(() => {
    const total = (images && images.length) || 0;
    if (!total) return;
    if (allSelected) {
      setSelectedMap({}); setSelectedCount(0); setAllSelected(false);
    } else {
      const map = {}; for (let i = 0; i < total; i++) map[String(i)] = true; setSelectedMap(map); setSelectedCount(total); setAllSelected(true);
    }
  }, [images, allSelected]);

  const confirmDelete = React.useCallback(() => {
    const indexes = Object.keys(selectedMap || {}).map(k => Number(k));
    if (!indexes.length) return Toast.warning('鏈€夋嫨鐓х墖');
    const ids = indexes.map(i => {
      const meta = (photoMetas && photoMetas[i]) || null;
      if (!meta) return null;
      return meta.id || meta.photoId || meta.photo_id || null;
    }).filter(Boolean);
    if (!ids.length) return Toast.warning('鎵€閫夌収鐗囨棤鍙垹闄ょ殑 ID');

    Modal.confirm({
      title: '确认删除所选照片',
      content: `删除后不可恢复，确定要删除 ${ids.length} 张照片吗？`,
      onOk: async () => {
        setDeletingPhotos(true);
        try {
          const res = await deletePhotos(ids);
          // res expected to be { deletedIds: [], notFoundIds: [] } or similar
          const deleted = (res && (res.deletedIds || res.deleted || res.deleted_ids)) || [];
          const notFound = (res && (res.notFoundIds || res.not_found_ids || res.notFound || [])) || [];
          if (Array.isArray(deleted) && deleted.length > 0) {
            Toast.success(`已删除 ${deleted.length} 张`);
          } else {
            Toast.success('鍒犻櫎鎴愬姛');
          }
          if (Array.isArray(notFound) && notFound.length > 0) {
            Toast.warning('閮ㄥ垎鐓х墖宸蹭笉瀛樺湪');
          }
          // reload project detail
          try {
            const detail = await getProjectById(projectId);
            setProject(detail);
            const built = buildImagesAndMetas(detail);
            setImages(built.images);
            setPhotoMetas(built.metas);
          } catch (e) {
            console.error('reload after delete failed', e);
          }
          setDeleteMode(false); setSelectedMap({}); setSelectedCount(0); setAllSelected(false);
        } catch (err) {
          console.error('delete error', err);
          // handle different status codes if available
          const status = err && err.status ? err.status : (err && err.cause && err.cause.status) ? err.cause.status : null;
          const body = err && err.body ? err.body : null;
          if (status === 400) {
            Toast.warning('请选择至少一张照片');
          } else if (status === 401 || status === 403) {
            // clear token and redirect to login
            try { localStorage.removeItem('mamage_jwt_token'); } catch (e) { }
            Toast.error('鏉冮檺涓嶈冻鎴栫櫥褰曞凡杩囨湡锛岃閲嶆柊鐧诲綍鎴栬仈绯荤鐞嗗憳');
            try { window.history.pushState({}, '', '/login'); } catch (e) { window.location.href = '/login'; }
          } else {
            Toast.error('服务器异常，请稍后重试');
          }
        } finally {
          setDeletingPhotos(false);
        }
      }
    });
  }, [selectedMap, images, projectId]);

  // ========== Download helpers ==========
  const getSelectedIndexes = React.useCallback(() => Object.keys(selectedMap || {}).map((k) => Number(k)).sort((a, b) => a - b), [selectedMap]);

  const downloadCurrentPhoto = React.useCallback(() => {
    const idx = viewerIndex;
    const meta = (photoMetas && photoMetas[idx]) || {};
    const url = meta.originalSrc || meta.url || meta.thumbSrc || images[idx];
    if (!url) return Toast.warning('鏃犳硶鑾峰彇鍥剧墖璧勬簮');
    try {
      if (typeof window !== 'undefined' && window.open) {
        window.open(url, '_blank', 'noopener');
        Toast.success('宸插湪鏂版爣绛鹃〉鎵撳紑鍥剧墖锛屾祻瑙堝櫒灏嗘牴鎹祫婧愬喅瀹氫笅杞芥垨鏄剧ず');
        return;
      }
      // Fallback: create an anchor and click it
      const a = document.createElement('a');
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
      Toast.success('宸插湪鏂版爣绛鹃〉鎵撳紑鍥剧墖锛屾祻瑙堝櫒灏嗘牴鎹祫婧愬喅瀹氫笅杞芥垨鏄剧ず');
    } catch (err) {
      console.error('downloadCurrentPhoto error', err);
      Toast.error('鎵撳紑鍥剧墖澶辫触锛岃绋嶅悗鍐嶈瘯');
    }
  }, [viewerIndex, photoMetas, images]);

  // Expose a global getter so the floating TransferStation can read current selection
  React.useEffect(() => {
    // return array of simple metas: { id, url, thumbSrc, originalSrc, projectTitle }
    window.__MAMAGE_GET_CURRENT_PROJECT_SELECTION = () => {
      try {
        const idxs = getSelectedIndexes();
        // try to infer project title from available state
        const srcProjectName = (project && (project.title || project.projectName || project.name))
          || (initialProject && (initialProject.title || initialProject.projectName || initialProject.name))
          || '椤圭洰';
        return idxs.map((i) => {
          const meta = (photoMetas && photoMetas[i]) || {};
          const pid = meta.id || meta.photoId || meta.photo_id || null;
          return {
            id: pid,
            url: meta.originalSrc || meta.url || meta.thumbSrc || images[i] || null,
            thumbSrc: meta.thumbSrc || images[i] || null,
            originalSrc: meta.originalSrc || images[i] || null,
            description: (pid && photoDescMap && photoDescMap[pid]) ? photoDescMap[pid] : (meta.description || ''),
            tags: (pid && photoTagsMap && photoTagsMap[pid]) ? photoTagsMap[pid] : (safeParseTags(meta.tags) || []),
            projectTitle: srcProjectName,
          };
        }).filter(Boolean);
      } catch (e) {
        return [];
      }
    };
    return () => {
      try { delete window.__MAMAGE_GET_CURRENT_PROJECT_SELECTION; } catch (e) { window.__MAMAGE_GET_CURRENT_PROJECT_SELECTION = undefined; }
    };
  }, [getSelectedIndexes, photoMetas, images]);

  const downloadBlob = async (blob, filename) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || 'file';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  const getFilenameFromContentDisposition = (resp) => {
    try {
      const cd = resp.headers.get('content-disposition') || '';
      if (!cd) return null;
      // RFC 6266 parsing: try filename*=UTF-8''..., then filename="..." then filename=...
      const mStar = cd.match(/filename\*=(?:UTF-8'')?([^;\n]+)/i);
      if (mStar && mStar[1]) return decodeURIComponent(mStar[1].trim().replace(/^"|"$/g, ''));
      const mQuoted = cd.match(/filename="([^"\n]+)"/i);
      if (mQuoted && mQuoted[1]) return mQuoted[1];
      const m = cd.match(/filename=([^;\n]+)/i);
      if (m && m[1]) return m[1].trim().replace(/^"|"$/g, '');
    } catch (e) {
      // ignore
    }
    return null;
  };




  // Try backend-pack endpoint first; fallback to individual downloads if unavailable.
  const packDownloadSelected = React.useCallback(async () => {
    const idxs = getSelectedIndexes();
    if (!idxs.length) return Toast.warning('鏈€夋嫨鐓х墖');
    const ids = idxs.map((i) => {
      const meta = (photoMetas && photoMetas[i]) || {};
      return meta.id || null;
    }).filter(Boolean);
    if (!ids.length) return Toast.warning('鎵€閫夌収鐗囨棤鍙笅杞界殑 ID');

    const zipName = `photos_${projectId || 'pkg'}`;
    try {
      const token = typeof getToken === 'function' ? getToken() : (localStorage.getItem ? localStorage.getItem('mamage_jwt_token') : '');
      if (!token) {
        Toast.warning('鎵撳寘涓嬭浇闇€瑕佺櫥褰曪紝璇峰厛鐧诲綍');
        return;
      }
      const resp = await fetch('/api/photos/zip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        credentials: 'same-origin',
        body: JSON.stringify({ photoIds: ids, zipName }),
      });
      if (!resp.ok) {
        const txt = await resp.text();
        throw new Error('download failed: ' + txt);
      }
      const blob = await resp.blob();
      const serverFilename = getFilenameFromContentDisposition(resp) || `${zipName}.zip`;
      await downloadBlob(blob, serverFilename);
      Toast.success('鎵撳寘涓嬭浇鍑嗗瀹屾垚');
      return;
    } catch (err) {
      console.warn('packDownloadSelected: server zip failed', err);
      // 灏濊瘯浠庨敊璇俊鎭腑鎻愬彇鏈嶅姟鍣ㄨ繑鍥炵殑璇︾粏鏂囨湰骞跺睍绀虹粰鐢ㄦ埛
      let msg = '鎵撳寘涓嬭浇澶辫触';
      try {
        if (err && err.message) {
          const m = err.message.match(/download failed:\s*(.*)$/s);
          if (m && m[1]) {
            // 濡傛灉鏈嶅姟鍣ㄨ繑鍥炵殑鏄?JSON 瀛楃涓诧紝灏濊瘯瑙ｆ瀽骞跺睍绀?error 瀛楁鎴栨憳瑕?
            let detail = m[1].trim();
            try {
              const j = JSON.parse(detail);
              if (j && (j.error || j.message)) {
                detail = j.error || j.message;
              }
            } catch (e) {
              // not json, keep as-is
            }
            msg = `鎵撳寘涓嬭浇澶辫触: ${detail}`;
          } else {
            msg = `鎵撳寘涓嬭浇澶辫触: ${err.message}`;
          }
        }
      } catch (e) {
        // ignore parsing errors
      }
      Toast.error(msg);
      return;
    }
  }, [getSelectedIndexes, photoMetas, images, projectId]);

  const resolvedProject = project || initialProject;

  const title = resolvedProject?.title ?? resolvedProject?.projectName ?? resolvedProject?.name ?? '未命名项目';
  const subtitle = resolvedProject?.subtitle ?? resolvedProject?.tagline ?? resolvedProject?.category ?? '';
  const description = resolvedProject?.description ?? resolvedProject?.intro ?? resolvedProject?.description ?? '';
  // tags: try multiple common field names and normalize to array of strings
  const rawTags = resolvedProject?.tags || resolvedProject?.labels || resolvedProject?.projectTags || resolvedProject?.tagList || null;
  const tags = React.useMemo(() => {
    if (!rawTags) return [];
    if (Array.isArray(rawTags)) return rawTags.filter(Boolean).map((t) => (typeof t === 'string' ? t : String(t)));
    if (typeof rawTags === 'string') {
      const s = rawTags.trim();
      // try parse JSON array/string
      if ((s.startsWith('[') && s.endsWith(']')) || (s.startsWith('{') && s.endsWith('}'))) {
        try {
          const parsed = JSON.parse(s);
          if (Array.isArray(parsed)) return parsed.filter(Boolean).map((t) => (typeof t === 'string' ? t : String(t)));
          // if parsed is object, try to extract values
          return Object.values(parsed).map((v) => (v && v.name) ? v.name : String(v)).filter(Boolean);
        } catch (e) {
          // fallthrough to splitting
        }
      }
      return s.split(/[;,\n]+/).map((ss) => ss.trim()).filter(Boolean);
    }
    // object or other shape: try to extract name properties or values
    try {
      const vals = Object.values(rawTags || {});
      if (vals.length && (typeof vals[0] === 'string' || typeof vals[0] === 'number')) {
        return vals.map((v) => String(v)).filter(Boolean);
      }
      return vals.map((v) => (v && v.name) ? v.name : String(v)).filter(Boolean);
    } catch (e) {
      return [];
    }
  }, [rawTags]);

  // expose resolved project and tags for easy debugging in browser console
  React.useEffect(() => {
    try {
      // eslint-disable-next-line no-console
      console.debug('[ProjectDetail] resolvedProject:', resolvedProject);
      // eslint-disable-next-line no-console
      console.debug('[ProjectDetail] parsed tags:', tags);
      try { window.__MAMAGE_LAST_PROJECT = { resolvedProject: resolvedProject || null, tags: tags || [] }; } catch (e) { }
    } catch (e) { }
  }, [resolvedProject, tags]);
  // compute display dates: start (event) and created
  const startRaw = resolvedProject?.eventDate ?? resolvedProject?.startDate ?? resolvedProject?.date ?? resolvedProject?.shootDate ?? null;
  const createdRaw = resolvedProject?.createdAt ?? resolvedProject?.created_at ?? resolvedProject?.updatedAt ?? null;
  const date = resolvedProject?.date ?? resolvedProject?.shootDate ?? resolvedProject?.updatedAt ?? resolvedProject?.createdAt ?? '';

  const formatToMinute = (val) => {
    if (!val && val !== 0) return null;
    try {
      const dt = (typeof val === 'string' || typeof val === 'number') ? new Date(val) : (val instanceof Date ? val : new Date(String(val)));
      if (isNaN(dt.getTime())) return null;
      const y = dt.getFullYear();
      const m = String(dt.getMonth() + 1).padStart(2, '0');
      const d = String(dt.getDate()).padStart(2, '0');
      const hh = String(dt.getHours()).padStart(2, '0');
      const mm = String(dt.getMinutes()).padStart(2, '0');
      return `${y}-${m}-${d} ${hh}:${mm}`;
    } catch (e) {
      return null;
    }
  };

  const startText = formatToMinute(startRaw);
  const createdText = formatToMinute(createdRaw);
  const count = resolvedProject?.photoCount ?? resolvedProject?.count ?? images.length;
  const masonryColumns = React.useMemo(() => {
    const w = galleryWidth || 0;
    if (!w) return 3;
    if (w <= 768) return 2;
    // Force desktop to at least 4 columns so it won't fall back to 3 too early.
    if (w <= 1200) return 4;
    return Math.max(4, Math.floor((w + 12) / (240 + 12)));
  }, [galleryWidth]);

  const gridColumns = React.useMemo(() => {
    const w = galleryWidth || 0;
    if (!w) return 1;
    if (w <= 768) return 3;
    const gap = 8;
    const minColWidth = 220;
    return Math.max(1, Math.floor((w + gap) / (minColWidth + gap)));
  }, [galleryWidth]);

  if (!projectId) {
    return null;
  }

  // compute rows with justified layout
  const rows = React.useMemo(() => {
    const GAP = 10;
    const targetRowHeight = 200; // preferred height
    const minHeight = 100;
    const maxHeight = 400;
    const w = galleryWidth || 800;
    const out = [];
    if (!images || images.length === 0) return out;

    let i = 0;
    while (i < images.length) {
      let sumRatio = 0;
      let j = i;
      for (; j < images.length; j++) {
        const r = imageRatios[images[j]] || 1.5; // fallback ratio
        sumRatio += r;
        const totalGap = GAP * (j - i);
        const rowH = (w - totalGap) / sumRatio;
        // stop when row height goes below targetRowHeight (too many images)
        if (rowH < targetRowHeight) {
          break;
        }
      }

      // if we didn't add any (first image already below target), ensure at least one
      if (j === i) j = i + 1;

      const rowImgs = images.slice(i, j + 1);
      // compute final height for the chosen images
      const ratios = rowImgs.map((src) => imageRatios[src] || 1.5);
      const totalRatio = ratios.reduce((s, r) => s + r, 0);
      const totalGap = GAP * (rowImgs.length - 1);
      let height = Math.max(minHeight, Math.min(maxHeight, (w - totalGap) / totalRatio));

      out.push({ images: rowImgs, height, ratios });
      i = j + 1;
    }

    return out;
  }, [images, imageRatios, galleryWidth]);

  const handleImageLoad = React.useCallback((src, event) => {
    const { naturalWidth, naturalHeight } = event.target;
    if (!naturalWidth || !naturalHeight) return;
    setImageRatios((prev) => {
      if (prev[src]) return prev;
      return { ...prev, [src]: naturalWidth / naturalHeight };
    });
  }, []);

  React.useEffect(() => {
    if (!galleryRef.current) return undefined;
    const update = () => {
      if (!galleryRef.current) return;
      setGalleryWidth(Math.floor(galleryRef.current.clientWidth));
    };
    update();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    if (ro) ro.observe(galleryRef.current);
    window.addEventListener('resize', update);
    return () => {
      if (ro) ro.disconnect();
      window.removeEventListener('resize', update);
    };
  }, []);

  // viewer keyboard navigation
  React.useEffect(() => {
    if (!viewerVisible) return undefined;
    const onKey = (e) => {
      if (e.key === 'ArrowRight') {
        setViewerIndex((i) => (images.length ? (i + 1) % images.length : i));
      } else if (e.key === 'ArrowLeft') {
        setViewerIndex((i) => (images.length ? (i - 1 + images.length) % images.length : i));
      } else if (e.key === 'Escape') {
        setViewerVisible(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [viewerVisible, images]);

  // While dragging project photos, keep copy cursor globally and avoid forbidden icon.
  React.useEffect(() => {
    const onDragOver = (e) => {
      try {
        const types = Array.from(e.dataTransfer?.types || []);
        if (types.includes('application/x-mamage-photo')) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
        }
      } catch (err) {
        // ignore
      }
    };
    const onDrop = (e) => {
      try {
        const types = Array.from(e.dataTransfer?.types || []);
        if (types.includes('application/x-mamage-photo')) {
          e.preventDefault();
        }
      } catch (err) {
        // ignore
      }
    };
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onDrop);
    };
  }, []);

  // reset viewer original flag when opening viewer or when index changes
  React.useEffect(() => {
    if (viewerVisible) setViewerShowOriginal(false);
  }, [viewerVisible, viewerIndex]);

  const hasPerm = React.useCallback((key) => userPermissions.includes(key) || canAny(key), [userPermissions]);
  const canUpdateProject = hasPerm('projects.update');
  const canUploadPhotos = hasPerm('photos.upload') || hasPerm('upload.photo');
  const canDeletePhotos = hasPerm('photos.delete');
  const canDeleteProject = hasPerm('projects.delete');
  const canEditTags = hasPerm('tags.edit');
  const canPackDownload = hasPerm('photos.zip');

  // ========== Photo Editing Handlers ==========
  const openPhotoEditModal = React.useCallback(() => {
    if (viewerIndex < 0) return;
    const meta = (photoMetas && photoMetas[viewerIndex]) || {};
    const id = meta.id;
    // initialize editing fields from current maps / meta
    setViewerEditTags((photoTagsMap[id] && Array.isArray(photoTagsMap[id])) ? [...photoTagsMap[id]] : (safeParseTags(meta.tags) || []));
    setViewerEditDescription(photoDescMap[id] || meta.description || '');
    setViewerEditTagInput('');
    setViewerEditVisible(true);
  }, [viewerIndex, photoMetas, photoTagsMap, photoDescMap]);

  const handlePhotoEditSuccess = React.useCallback((updatedPhoto) => {
    // 鏇存柊鐓х墖淇℃伅
    const photoId = updatedPhoto.id;
    const photoIndex = photoMetas?.findIndex(m => m.id === photoId) ?? -1;

    if (photoIndex >= 0) {
      // 鏇存柊tags鍜宒escription
      const newTags = safeParseTags(updatedPhoto.tags);
      const newDesc = updatedPhoto.description || '';

      setPhotoTagsMap(prev => ({ ...prev, [photoId]: newTags }));
      setPhotoDescMap(prev => ({ ...prev, [photoId]: newDesc }));

      // 鍒锋柊椤圭洰鏁版嵁浠ヤ繚鎸佸悓姝?
      getProjectById(projectId).then(detail => {
        setProject(detail);
        const built = buildImagesAndMetas(detail);
        setImages(built.images);
        setPhotoMetas(built.metas);
      }).catch(err => console.error('reload after photo edit failed', err));
    }
  }, [projectId, photoMetas]);

  const saveViewerPhotoEdit = React.useCallback(async () => {
    const idx = viewerIndex;
    const meta = (photoMetas && photoMetas[idx]) || {};
    const photoId = meta.id;
    if (!photoId) return Toast.warning('鏃犳硶鑾峰彇鐓х墖 ID');
    try {
      const token = getToken();
      if (!token) {
        Toast.error('鏈櫥褰曪紝璇峰厛鐧诲綍');
        return;
      }
      const payload = { tags: viewerEditTags && viewerEditTags.length ? viewerEditTags : [], description: viewerEditDescription || '' };
      const url = `${BASE_URL || ''}/api/photos/${photoId}`;
      const res = await fetch(url, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });
      if (res.status === 401 || res.status === 403) {
        Toast.error('鏉冮檺涓嶈冻锛屼粎绠＄悊鍛樺彲鎿嶄綔');
        return;
      }
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(txt || '淇濆瓨澶辫触');
      }
      const data = await res.json();
      const updatedTags = safeParseTags(data.tags);
      setPhotoTagsMap(prev => ({ ...prev, [photoId]: updatedTags }));
      setPhotoDescMap(prev => ({ ...prev, [photoId]: data.description || '' }));
      Toast.success('已保存照片信息');
      setViewerEditVisible(false);
      // reload project detail to sync metas
      try {
        const detail = await getProjectById(projectId);
        setProject(detail);
        const built = buildImagesAndMetas(detail);
        setImages(built.images);
        setPhotoMetas(built.metas);
      } catch (e) {
        // ignore reload errors
      }
    } catch (err) {
      console.error('saveViewerPhotoEdit error', err);
      Toast.error('淇濆瓨澶辫触');
    }
  }, [viewerIndex, viewerEditTags, viewerEditDescription, projectId, photoMetas]);

  // 鎵撳紑 / 鍏抽棴 鐩镐技鍒嗙粍寮圭獥骞跺姞杞芥暟鎹?
  const openSimilarityModal = React.useCallback(async () => {
    if (!projectId) return;
    setSimModalVisible(true);
    if (simGroups !== null) return; // already loaded
    setSimLoading(true);
    setSimError(null);
    try {
      const token = getToken && typeof getToken === 'function' ? getToken() : null;
      const headers = token ? { Authorization: 'Bearer ' + token } : {};
      const url = `/api/similarity/groups/simple?projectId=${projectId}`;
      const r = await fetch(url, { headers });
      const data = await r.json().catch(() => ({}));
      const groups = data && Array.isArray(data.groups) ? data.groups : [];
      setSimGroups(groups);
      const ids = Array.from(new Set((groups || []).flat()));
      if (ids.length) {
        const metas = await Promise.all(ids.map(id => fetch(`/api/photos/${id}`, { headers }).then(rr => rr.ok ? rr.json() : null).catch(() => null)));
        const map = {};
        ids.forEach((id, i) => { if (metas[i]) map[id] = metas[i]; });
        setSimPhotos(map);
      } else {
        setSimPhotos({});
      }
    } catch (e) {
      console.error('load similarity groups error', e);
      setSimError('鍔犺浇澶辫触锛岃閲嶈瘯');
      setSimGroups([]);
    } finally {
      setSimLoading(false);
    }
  }, [projectId, simGroups]);

  const closeSimilarityModal = React.useCallback(() => setSimModalVisible(false), []);

  const toggleSimSelect = React.useCallback((id) => {
    setSimSelectedMap((prev) => {
      const next = Object.assign({}, prev || {});
      if (next[id]) delete next[id]; else next[id] = true;
      const count = Object.keys(next).length;
      setSimSelectedCount(count);
      return next;
    });
  }, []);

  const confirmSimDelete = React.useCallback(() => {
    const ids = Object.keys(simSelectedMap || {}).filter(Boolean);
    if (!ids.length) return Toast.warning('璇峰厛閫夋嫨瑕佸垹闄ょ殑鐓х墖');
    Modal.confirm({
      title: '确认删除所选照片',
      content: `删除后不可恢复，确定要删除 ${ids.length} 张照片吗？`,
      onOk: async () => {
        try {
          setSimDeleting(true);
          await deletePhotos(ids);
          Toast.success('鍒犻櫎鎴愬姛');
          // remove deleted ids from simGroups and simPhotos
          setSimGroups((prev) => (prev || []).map(g => g.filter(id => !ids.includes(String(id)))).filter(g => g.length));
          setSimPhotos((prev) => { const next = Object.assign({}, prev || {}); ids.forEach(id => delete next[id]); return next; });
          // also remove from main lists if present
          setPhotoMetas((prev) => (prev || []).filter(m => !ids.includes(String(m.id))));
          setImages((prev) => (prev || []).filter((src, idx) => { const m = photoMetas && photoMetas[idx]; return !(m && ids.includes(String(m.id))); }));
          setSimSelectedMap({});
          setSimSelectedCount(0);
          setSimDeleteMode(false);
        } catch (e) {
          console.error('sim delete failed', e);
          Toast.error('鍒犻櫎澶辫触');
        } finally {
          setSimDeleting(false);
        }
      }
    });
  }, [simSelectedMap, deletePhotos, photoMetas, setPhotoMetas]);

  // 鎺ㄨ崘鏍囪锛氭坊鍔?鎺ㄨ崘"鏍囩
  const addRecommendationTag = React.useCallback(async () => {
    if (viewerIndex < 0 || !photoMetas || !photoMetas[viewerIndex]) return;

    const currentMeta = photoMetas[viewerIndex];
    const photoId = currentMeta.id;

    // 妫€鏌ユ槸鍚﹀凡鏈?鎺ㄨ崘"鏍囩
    const currentTags = photoTagsMap[photoId] || [];
    if (currentTags.includes('鎺ㄨ崘')) {
      Toast.warning('璇ョ収鐗囧凡鏈?鎺ㄨ崘"鏍囩');
      return;
    }

    try {
      const token = getToken();
      if (!token) {
        Toast.error('鏈櫥褰曪紝璇峰厛鐧诲綍');
        return;
      }

      // 娣诲姞"鎺ㄨ崘"鏍囩鍒扮幇鏈夋爣绛?
      const newTags = [...currentTags, '鎺ㄨ崘'];

      const url = `${BASE_URL || ''}/api/photos/${photoId}`;
      const res = await fetch(url, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ tags: newTags }),
      });

      if (res.status === 401 || res.status === 403) {
        Toast.error('鏉冮檺涓嶈冻锛屼粎绠＄悊鍛樺彲鎿嶄綔');
        return;
      }

      if (!res.ok) {
        const errText = await res.text();
        Toast.error(`鎿嶄綔澶辫触: ${errText}`);
        return;
      }

      const data = await res.json();
      const updatedTags = safeParseTags(data.tags);
      setPhotoTagsMap(prev => ({ ...prev, [photoId]: updatedTags }));
      Toast.success('已添加推荐标签');
    } catch (err) {
      console.error('add recommendation failed:', err);
      Toast.error(`鎿嶄綔澶辫触: ${err.message}`);
    }
  }, [viewerIndex, photoMetas, photoTagsMap]);

  const masonryBuckets = React.useMemo(() => {
    const cols = Math.max(1, masonryColumns);
    const buckets = Array.from({ length: cols }, () => ({ h: 0, items: [] }));
    images.forEach((src, idx) => {
      const ratio = imageRatios[src] || 1.5;
      const estHeight = 1 / Math.max(0.2, ratio);
      let minCol = 0;
      for (let i = 1; i < buckets.length; i += 1) {
        if (buckets[i].h < buckets[minCol].h) minCol = i;
      }
      buckets[minCol].items.push({ src, idx });
      buckets[minCol].h += estHeight;
    });
    return buckets.map((b) => b.items);
  }, [images, imageRatios, masonryColumns]);

  const masonryPositionMap = React.useMemo(() => {
    const map = {};
    masonryBuckets.forEach((bucket, c) => {
      bucket.forEach((item, r) => {
        map[item.idx] = { r, c };
      });
    });
    return map;
  }, [masonryBuckets]);

  const getRippleStyle = React.useCallback((index) => {
    if (hoveredPhotoIdx < 0 || hoveredPhotoIdx === index) return undefined;
    if (galleryMode === 'grid') {
      const cols = Math.max(1, gridColumns || 1);
      const r = Math.floor(index / cols);
      const c = index % cols;
      const hr = Math.floor(hoveredPhotoIdx / cols);
      const hc = hoveredPhotoIdx % cols;
      const dr = r - hr;
      const dc = c - hc;
      if (Math.abs(dr) > 1 || Math.abs(dc) > 1) return undefined;
      const isDirect = Math.abs(dr) + Math.abs(dc) === 1;
      const step = isDirect ? 6 : 4;
      const tx = dc === 0 ? 0 : (dc > 0 ? step : -step);
      const ty = dr === 0 ? 0 : (dr > 0 ? step : -step);
      return { transform: `translate(${tx}px, ${ty}px)` };
    }
    if (galleryMode === 'masonry') {
      const p = masonryPositionMap[index];
      const hp = masonryPositionMap[hoveredPhotoIdx];
      if (!p || !hp) return undefined;
      const dr = p.r - hp.r;
      const dc = p.c - hp.c;
      if (Math.abs(dr) > 1 || Math.abs(dc) > 1) return undefined;
      const isDirect = Math.abs(dr) + Math.abs(dc) === 1;
      const step = isDirect ? 6 : 4;
      const tx = dc === 0 ? 0 : (dc > 0 ? step : -step);
      const ty = dr === 0 ? 0 : (dr > 0 ? step : -step);
      return { transform: `translate(${tx}px, ${ty}px)` };
    }
    return undefined;
  }, [galleryMode, hoveredPhotoIdx, gridColumns, masonryPositionMap]);

  const buildTransferItem = React.useCallback((index) => {
    const meta = (photoMetas && photoMetas[index]) || {};
    const pid = meta.id || meta.photoId || meta.photo_id || null;
    const url = meta.originalSrc || meta.url || images[index] || '';
    const thumbSrc = meta.thumbSrc || images[index] || url;
    const description = photoDescMap[pid] || meta.description || '';
    const tags = Array.isArray(photoTagsMap[pid]) ? photoTagsMap[pid] : safeParseTags(meta.tags);
    return {
      id: pid || url,
      url,
      thumbSrc,
      description,
      tags: Array.isArray(tags) ? tags : [],
      projectTitle: title || '',
    };
  }, [photoMetas, images, photoDescMap, photoTagsMap, title]);

  const handlePhotoDragStart = React.useCallback((e, index) => {
    try {
      const payload = buildTransferItem(index);
      e.dataTransfer.effectAllowed = 'copy';
      e.dataTransfer.setData('application/x-mamage-photo', JSON.stringify(payload));
      e.dataTransfer.setData('application/json', JSON.stringify(payload));
      e.dataTransfer.setData('text/plain', payload.url || '');

      // Create a "real photo card" drag preview.
      const preview = document.createElement('div');
      preview.style.width = '180px';
      preview.style.height = '120px';
      preview.style.borderRadius = '8px';
      preview.style.overflow = 'hidden';
      preview.style.boxShadow = '0 10px 24px rgba(0,0,0,0.28)';
      preview.style.background = '#fff';
      preview.style.position = 'fixed';
      preview.style.left = '-9999px';
      preview.style.top = '-9999px';
      preview.style.pointerEvents = 'none';

      const img = document.createElement('img');
      img.src = payload.thumbSrc || payload.url || '';
      img.style.width = '100%';
      img.style.height = '100%';
      img.style.objectFit = 'cover';
      img.draggable = false;
      preview.appendChild(img);
      document.body.appendChild(preview);
      dragPreviewRef.current = preview;
      e.dataTransfer.setDragImage(preview, 24, 20);
      try {
        window.dispatchEvent(new CustomEvent('mamage-photo-drag-start'));
      } catch (evtErr) {
        // ignore
      }
    } catch (err) {
      console.warn('photo dragstart failed', err);
    }
  }, [buildTransferItem]);

  const handlePhotoDragEnd = React.useCallback(() => {
    try {
      if (dragPreviewRef.current) {
        dragPreviewRef.current.remove();
        dragPreviewRef.current = null;
      }
      try {
        window.dispatchEvent(new CustomEvent('mamage-photo-drag-end'));
      } catch (evtErr) {
        // ignore
      }
    } catch (err) {
      // ignore
    }
  }, []);

  const renderPhotoItem = React.useCallback((src, overallIndex) => (
    <div className="detail-photo-item" key={overallIndex} style={getRippleStyle(overallIndex)}>
      <div className="detail-photo">
        <div style={{ position: 'relative' }}>
          <img
            src={src}
            alt={`${title}-${overallIndex}`}
            draggable
            onDragStart={(e) => handlePhotoDragStart(e, overallIndex)}
            onDragEnd={handlePhotoDragEnd}
            onLoad={(event) => handleImageLoad(src, event)}
            style={{ display: 'block', cursor: deleteMode ? 'pointer' : 'zoom-in' }}
            data-original={photoMetas && photoMetas[overallIndex] ? (photoMetas[overallIndex].originalSrc || images[overallIndex]) : images[overallIndex]}
            data-tried="0"
            onError={(e) => {
              try {
                const img = e.target;
                const tried = img.getAttribute('data-tried');
                if (tried === '0') {
                  img.setAttribute('data-tried', '1');
                  const original = img.getAttribute('data-original');
                  if (original) img.src = original;
                }
              } catch (err) { }
            }}
            onMouseEnter={() => setHoveredPhotoIdx(overallIndex)}
            onMouseLeave={() => setHoveredPhotoIdx(-1)}
            onClick={() => {
              if (deleteMode) {
                toggleSelect(overallIndex);
              } else if (overallIndex >= 0) {
                setViewerIndex(overallIndex);
                setViewerVisible(true);
              }
            }}
          />
          {(() => {
            const meta = photoMetas?.[overallIndex] || {};
            const rawName = meta.photographerName || meta.photographer_name || meta.photographer || (meta.photographerId ? String(meta.photographerId) : null) || (meta.photographer_id ? String(meta.photographer_id) : null);
            const hasName = rawName && String(rawName).trim();
            let photographerLabel = null;
            if (hasName) {
              photographerLabel = String(rawName);
            } else {
              try {
                const list = (project && (project.photos || project.images || project.gallery)) || (initialProject && (initialProject.photos || initialProject.images || initialProject.gallery)) || [];
                const found = Array.isArray(list) ? list.find(p => p && (String(p.id) === String(meta.id) || String(p.photoId) === String(meta.id))) : null;
                const fb = found ? (found.photographerName || found.photographer || found.photographer_name || found.photographerId || found.photographer_id) : null;
                if (fb) photographerLabel = String(fb);
              } catch (e) { }
              if (!photographerLabel) {
                photographerLabel = meta.photographerId ? `摄影师#${meta.photographerId}` : (meta.photographer_id ? `摄影师#${meta.photographer_id}` : '未知摄影师');
              }
            }
            return (
              <div style={{ position: 'absolute', left: 8, top: 8, background: 'rgba(0,0,0,0.55)', color: '#fff', padding: '4px 6px', borderRadius: 4, fontSize: '12px', pointerEvents: 'none', maxWidth: '70%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {photographerLabel}
              </div>
            );
          })()}
          {deleteMode && (
            <div style={{ position: 'absolute', right: 8, top: 8, width: 32, height: 32, borderRadius: 16, background: selectedMap[String(overallIndex)] ? '#ff5252' : 'rgba(0,0,0,0.45)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }} onClick={(e) => { e.stopPropagation(); toggleSelect(overallIndex); }}>
              {selectedMap[String(overallIndex)] ? '✓' : ''}
            </div>
          )}
          {hoveredPhotoIdx === overallIndex && !deleteMode && (
            <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, color: '#fff', padding: '8px', fontSize: '12px', pointerEvents: 'none', display: 'flex', flexDirection: 'column-reverse' }}>
              {(() => {
                const photoId = photoMetas?.[overallIndex]?.id;
                const tags = photoTagsMap[photoId];
                return tags && tags.length > 0 ? (
                  <div style={{ display: 'flex', flexWrap: 'wrap-reverse', gap: '4px' }}>
                    {tags.slice(0, 5).map((tag, i) => (
                      <span key={i} style={{ background: '#1890ff', padding: '2px 6px', borderRadius: '2px', whiteSpace: 'nowrap' }}>{tag}</span>
                    ))}
                  </div>
                ) : <span style={{ color: '#ccc' }}>无标签</span>;
              })()}
            </div>
          )}
          {showAILabels && photoAILabelMap[photoMetas?.[overallIndex]?.id] && (
            <div style={{ position: 'absolute', right: 8, top: 8, background: photoAILabelMap[photoMetas?.[overallIndex]?.id] === 'recommended' ? '#4caf50' : '#f44336', color: '#fff', padding: '4px 8px', borderRadius: '3px', fontSize: '12px', fontWeight: 'bold', pointerEvents: 'none' }}>
              {photoAILabelMap[photoMetas?.[overallIndex]?.id] === 'recommended' ? 'AI推荐' : 'AI不推荐'}
            </div>
          )}
          {(() => {
            const pid = photoMetas?.[overallIndex]?.id;
            if (!pid) return null;
            const hasRecommend = (photoTagsMap[pid] || []).includes('推荐');
            if (!hasRecommend) return null;
            return (
              <div style={{ position: 'absolute', right: 8, top: showAILabels && photoAILabelMap[pid] ? 36 : 8, background: '#2196f3', color: '#fff', padding: '4px 8px', borderRadius: '3px', fontSize: '12px', fontWeight: 'bold', pointerEvents: 'none' }}>
                推荐
              </div>
            );
          })()}
        </div>
      </div>
    </div>
  ), [title, handlePhotoDragStart, handleImageLoad, deleteMode, photoMetas, images, hoveredPhotoIdx, photoTagsMap, showAILabels, photoAILabelMap, selectedMap, toggleSelect, project, initialProject, getRippleStyle]);

  return (
    <div className="detail-page">
      {/* 椤堕儴淇℃伅鏍?*/}
      <div className="detail-header">
        <div>
          <div className="detail-topbar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-start', gap: 12 }}>
            {canUploadPhotos ? (
              <div className="detail-upload-wrap" style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <div className="detail-upload-stack" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Button
                      className="detail-upload-trigger"
                      onClick={openUploadPicker}
                      onMouseEnter={() => setUploadHover(true)}
                      onMouseLeave={() => setUploadHover(false)}
                      onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
                      onDragEnter={(e) => { e.preventDefault(); setDragActive(true); }}
                      onDragLeave={(e) => { e.preventDefault(); setDragActive(false); }}
                      onDrop={(e) => { e.preventDefault(); setDragActive(false); if (e.dataTransfer && e.dataTransfer.files) handleFilesSelected(e.dataTransfer.files); }}
                      type="primary"
                      style={{
                        borderRadius: 10,
                        padding: '16px 24px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 12,
                        fontSize: 16,
                        height: 72,
                        border: '1.5px dashed #d9d9d9',
                        boxShadow: dragActive ? '0 6px 18px rgba(0,0,0,0.12)' : (uploadHover ? '0 8px 20px rgba(0,0,0,0.12)' : undefined),
                        transform: dragActive ? 'translateY(-1px)' : undefined,
                      }}
                      title="点击上传，或将图片拖拽到按钮上"
                      aria-label="上传照片"
                    >
                      <svg style={{ marginRight: 10 }} width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
                        <path d="M12 3v10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                        <path d="M8 7l4-4 4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                        <path d="M21 21H3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      <div className="detail-upload-copy" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', lineHeight: 1 }}>
                        <span style={{ fontWeight: 400, color: '#111', marginBottom: 6 }}>补充照片</span>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                          <span style={{ fontSize: 12, color: '#6b6b6b', opacity: 0.95, fontWeight: 400, textAlign: 'left' }}>支持拖拽到按钮或点击上传</span>
                          <span style={{ fontSize: 12, color: '#6b6b6b', opacity: 0.95, fontWeight: 400, textAlign: 'left' }}>一次最多上传 15 张</span>
                        </div>
                      </div>
                      {stagingFiles && stagingFiles.length > 0 ? (
                        <span style={{ marginLeft: 8, background: '#ff4d4f', color: '#fff', padding: '4px 10px', borderRadius: 14, fontSize: 13 }}>
                          {stagingFiles.length}
                        </span>
                      ) : null}
                    </Button>
                  </div>

                  <input
                    id="project-file-input"
                    ref={fileInputRef}
                    style={{ display: 'none' }}
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={(e) => handleFilesSelected(e.target.files)}
                    aria-hidden="true"
                  />
                </div>
              </div>
            ) : null}
          </div>

          <div className="detail-title-row">
            <Title heading={3} style={{ margin: 0 }}>
              {title}
            </Title>
            {subtitle && (
              <Tag size="large" type="solid" color="blue" style={{ marginLeft: 12 }}>
                {subtitle}
              </Tag>
            )}
          </div>

          <div className="detail-toolbar" style={{ display: 'flex', gap: 12, marginTop: 8, alignItems: 'center', width: '100%' }}>
            <div className="detail-toolbar-main" style={{ display: 'flex', gap: 0, alignItems: 'center' }}>
              <Button
                className="detail-view-toggle"
                type="tertiary"
                onClick={() => handleGalleryModeChange(galleryMode === 'grid' ? 'masonry' : 'grid')}
              >
                样式
              </Button>
              <IfCan perms={['projects.update']}>
                <Button className="detail-toolbar-btn" onClick={openEdit} type="primary" style={{ marginLeft: 6 }}>修改信息</Button>
              </IfCan>
              <Button
                className="detail-toolbar-btn"
                onClick={() => setShowAILabels(!showAILabels)}
                type={showAILabels ? 'primary' : 'tertiary'}
                style={{ color: '#722ed1', marginLeft: 6 }}
              >
                AI 选片
              </Button>
              <Button
                className="detail-toolbar-btn"
                onClick={openSimilarityModal}
                type="tertiary"
                style={{ marginLeft: 6 }}
              >
                查看相似照片
              </Button>
            </div>
            {/* "鎴戣琛ュ厖鐓х墖" 宸茬Щ鑷抽《閮ㄨ繑鍥炴寜閽 */}
            {(canDeletePhotos || canPackDownload) ? (
              <Button className="detail-select-btn" onClick={toggleDeleteMode} type={deleteMode ? 'danger' : 'tertiary'} style={{ marginLeft: 'auto' }}>{deleteMode ? '取消选择' : '选择'}</Button>
            ) : null}
          </div>

          <div className="detail-meta" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div className="detail-meta-dates" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              {startText && <Text type="tertiary">{`开始于 ${startText}`}</Text>}
              {createdText && <Text type="tertiary">{`创建于 ${createdText}`}</Text>}
              {!startText && !createdText && date && <Text type="tertiary">{date}</Text>}
            </div>
            <Text type="tertiary" style={{ marginLeft: 16 }}>
              共 {count} 张照片
            </Text>
          </div>

          {description && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <Text strong className="detail-desc-label">详情描述</Text>
              <Text strong type="secondary" className="detail-desc">
                {description}
              </Text>
            </div>
          )}
          {tags && tags.length > 0 && (
            <div className="detail-tags" style={{ marginTop: 8 }}>
              <Text strong className="detail-desc-label">项目标签</Text>
              <div className="detail-tags-list" style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {tags.map((t, idx) => (
                  <Tag key={idx} size="small" type="light" color="grey">
                    {t}
                  </Tag>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <div
        className={`detail-gallery ${galleryMode === 'masonry' ? 'detail-gallery--masonry' : 'detail-gallery--grid'}`}
        ref={galleryRef}
      >
        {loading && (
          <div style={{ width: '100%', display: 'flex', justifyContent: 'center', padding: '60px 0' }}>
            <Spin size="large" tip="加载项目详情" />
          </div>
        )}

        {!loading && error && (
          <div style={{ width: '100%', display: 'flex', justifyContent: 'center', padding: '60px 0' }}>
            <Text type="danger">{error}</Text>
          </div>
        )}

        {!loading && !error && images.length === 0 && (
          <div style={{ width: '100%', display: 'flex', justifyContent: 'center', padding: '60px 0' }}>
            <Empty description="该项目暂无图片" />
          </div>
        )}

        {!loading && !error && (
          galleryMode === 'masonry' ? (
            <div className="detail-masonry-columns" style={{ '--masonry-cols': masonryColumns }}>
              {masonryBuckets.map((bucket, colIdx) => (
                <div className="detail-masonry-column" key={`masonry-col-${colIdx}`}>
                  {bucket.map(({ src, idx }) => renderPhotoItem(src, idx))}
                </div>
              ))}
            </div>
          ) : (
            images.map((src, overallIndex) => renderPhotoItem(src, overallIndex))
          )
        )}
        {/* 搴曢儴鎿嶄綔锛氬垹闄?/ 鍏ㄩ€?*/}
        {deleteMode && (canDeletePhotos || canPackDownload) && (
          <div style={{ position: 'fixed', left: '50%', transform: 'translateX(-50%)', bottom: 24, zIndex: 1400, display: 'flex', gap: 12 }}>
            <Button onClick={toggleSelectAll}>{allSelected ? '取消全选' : '全选'}</Button>
            {canPackDownload ? <Button onClick={packDownloadSelected} type="tertiary">打包下载</Button> : null}
            {canDeletePhotos ? (
              <>
                <PermButton perms={['photos.delete']} onClick={confirmDelete} type="danger" loading={deletingPhotos} disabled={deletingPhotos}>删除 ({selectedCount})</PermButton>
              </>
            ) : null}
            <Button onClick={toggleDeleteMode}>完成</Button>
          </div>
        )}

        {/* 缂栬緫寮圭獥 */}
        <Modal
          title="修改项目信息"
          className="detail-edit-modal"
          visible={editVisible}
          onOk={saveEdit}
          onCancel={() => setEditVisible(false)}
          okText="保存"
          cancelText="取消"
          width={isMobile ? 'calc(100vw - 16px)' : undefined}
          bodyStyle={isMobile ? { maxHeight: '70vh', overflowY: 'auto', padding: '12px' } : undefined}
        >
          <div className="detail-edit-modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Input value={editTitle} onChange={(v) => setEditTitle(v)} placeholder="项目标题" />
            <TextArea value={editDescription} onChange={(v) => setEditDescription(v)} rows={4} placeholder="项目描述" />
            {(canUpdateProject || canEditTags) ? (
              <div>
                <div style={{ marginBottom: 6 }}>项目标签（按回车添加）</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {(editTags || []).map((t, i) => (
                    <Tag key={t + i} size="small" type="light" onClick={() => { /* no-op */ }}>{t}
                      <button style={{ marginLeft: 6, border: 'none', background: 'transparent', cursor: 'pointer' }} onClick={(e) => { e.stopPropagation(); setEditTags((s) => s.filter(x => x !== t)); }}>×</button>
                    </Tag>
                  ))}
                  <input className="detail-edit-tag-input" value={editTagInput} onChange={(e) => setEditTagInput(e.target.value)} onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ',') {
                      e.preventDefault();
                      const v = (editTagInput || '').trim();
                      if (v && !(editTags || []).includes(v)) setEditTags((s) => [...(s || []), v]);
                      setEditTagInput('');
                    }
                  }} placeholder="输入标签并回车" style={{ minWidth: 160, padding: '6px 8px' }} />
                </div>
              </div>
            ) : null}
            <DatePicker
              value={editEventDate}
              onChange={(v) => setEditEventDate(v)}
              format="yyyy-MM-dd"
              placeholder="活动日期 (YYYY-MM-DD)"
              style={{ width: '100%' }}
              clearable
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 6 }}>
              <IfCan perms={['projects.delete']}>
                <Button className="detail-edit-delete-btn" type="danger" onClick={handleDeleteProject} loading={deletingProject} disabled={deletingProject}>删除项目</Button>
              </IfCan>
            </div>
          </div>
        </Modal>

        {/* 鐩镐技鍒嗙粍寮圭獥 */}
        <Modal
          title="相似照片分组"
          className="detail-sim-modal"
          visible={simModalVisible}
          onCancel={closeSimilarityModal}
          footer={null}
          size="large"
          width={isMobile ? 'calc(100vw - 16px)' : undefined}
          bodyStyle={isMobile ? { maxHeight: '72vh', overflowY: 'auto', padding: '10px 12px 12px' } : undefined}
        >
          <div style={{ minHeight: 160 }}>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginBottom: 8 }}>
              {!simDeleteMode ? (
                <Button onClick={() => setSimDeleteMode(true)} type="tertiary">选择</Button>
              ) : (
                <>
                  <Button onClick={() => { setSimDeleteMode(false); setSimSelectedMap({}); setSimSelectedCount(0); }} type="tertiary">取消选择</Button>
                  <PermButton perms={['photos.delete']} onClick={confirmSimDelete} type="danger" loading={simDeleting} disabled={simDeleting}>删除 ({simSelectedCount})</PermButton>
                </>
              )}
            </div>
            {simLoading ? (
              <div style={{ width: '100%', display: 'flex', justifyContent: 'center', padding: '40px 0' }}>
                <Spin tip="正在分析相似照片" />
              </div>
            ) : simError ? (
              <div style={{ width: '100%', display: 'flex', justifyContent: 'center', padding: '40px 0' }}>
                <Text type="danger">{simError}</Text>
              </div>
            ) : (simGroups && simGroups.length) ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {simGroups.map((g, gi) => (
                  <div key={gi} className="similarity-group">
                    <div style={{ fontWeight: 'bold' }}>Group #{gi + 1} ({g.length} 张照片)</div>
                    <div className="similarity-group-images" style={{ marginTop: 8, display: 'flex', gap: 12, flexWrap: isMobile ? 'nowrap' : 'wrap', overflowX: isMobile ? 'auto' : 'visible', paddingBottom: isMobile ? 4 : 0 }}>
                      {g.map((id) => {
                        const p = simPhotos[id];
                        const thumb = p ? (p.thumbUrl || p.url || p.thumbSrc || p.originalSrc) : null;
                        const titleText = p ? (p.title || p.name || `#${id}`) : `#${id}`;
                        const url = thumb || (p && (p.url || p.originalSrc)) || (BASE_URL ? `${BASE_URL}/photos/${id}` : `/api/photos/${id}`);
                        const selected = !!simSelectedMap[String(id)];
                        return (
                          <div key={id} className="similarity-thumb" style={{ width: isMobile ? 152 : 180, minWidth: isMobile ? 152 : undefined, flex: isMobile ? '0 0 auto' : undefined, position: 'relative' }}>
                            {thumb ? (
                              <img src={thumb} alt={titleText} style={{ width: '100%', height: 120, objectFit: 'cover', display: 'block', cursor: simDeleteMode ? 'pointer' : 'zoom-in' }} onClick={() => {
                                if (simDeleteMode) {
                                  toggleSimSelect(String(id));
                                  return;
                                }
                                // try to open in viewer by finding index
                                const findIdx = (photoMetas || []).findIndex(m => String(m.id) === String(id));
                                if (findIdx >= 0) {
                                  closeSimilarityModal();
                                  setTimeout(() => {
                                    setViewerIndex(findIdx);
                                    setViewerVisible(true);
                                  }, 0);
                                } else {
                                  window.open(url, '_blank');
                                }
                              }} />
                            ) : (
                              <div style={{ width: '100%', height: 120, background: '#eee' }} />
                            )}
                            {simDeleteMode && (
                              <div onClick={(e) => { e.stopPropagation(); toggleSimSelect(String(id)); }} style={{ position: 'absolute', right: 8, top: 8, width: 28, height: 28, borderRadius: 14, background: selected ? '#ff5252' : 'rgba(0,0,0,0.45)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>{selected ? '✓' : ''}</div>
                            )}
                            <div style={{ fontSize: 12, marginTop: 6 }}>{titleText}</div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ width: '100%', display: 'flex', justifyContent: 'center', padding: '40px 0' }}>
                <Empty description="未发现相似分组" />
              </div>
            )}
          </div>
        </Modal>

        {/* 涓婁紶棰勮寮圭獥 */}
        <Modal
          title={`准备上传 (${stagingFiles.length})`}
          visible={uploadMode}
          onOk={confirmUpload}
          onCancel={cancelUpload}
          okButtonProps={{ loading: uploading }}
          okText="确认上传"
          cancelText="取消"
        >
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            {stagingPreviews.map((p, i) => (
              <div key={i} style={{ width: 120, height: 120, overflow: 'hidden', borderRadius: 0 }}>
                <img src={p} alt={`preview-${i}`} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
              </div>
            ))}
          </div>
        </Modal>

        {/* Image viewer overlay (no container) */}
        {viewerVisible && (
          <div className="viewer-overlay" onClick={() => setViewerVisible(false)}>
            <div className="viewer-wrap">
              <button
                className="viewer-nav viewer-nav-left"
                onClick={(e) => { e.stopPropagation(); setViewerIndex((i) => (images.length ? (i - 1 + images.length) % images.length : i)); }}
                aria-label="上一张"
              />

              <div className="viewer-img-wrap" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                {photoMetas && photoMetas[viewerIndex] ? (
                  <>
                    <img
                      src={viewerShowOriginal ? (photoMetas[viewerIndex].originalSrc || images[viewerIndex]) : (photoMetas[viewerIndex].thumbSrc || images[viewerIndex])}
                      alt={`viewer-${viewerIndex}`}
                      className="viewer-img"
                      onClick={(e) => e.stopPropagation()}
                    />
                    {(() => {
                      const meta = photoMetas[viewerIndex] || {};
                      const rawName = meta.photographerName || meta.photographer_name || meta.photographer || (meta.photographerId ? String(meta.photographerId) : null) || (meta.photographer_id ? String(meta.photographer_id) : null);
                      const hasName = rawName && String(rawName).trim();
                      let label = null;
                      if (hasName) {
                        label = String(rawName);
                      } else {
                        try {
                          const list = (project && (project.photos || project.images || project.gallery)) || (initialProject && (initialProject.photos || initialProject.images || initialProject.gallery)) || [];
                          const found = Array.isArray(list) ? list.find(p => p && (String(p.id) === String(meta.id) || String(p.photoId) === String(meta.id))) : null;
                          const fb = found ? (found.photographerName || found.photographer || found.photographer_name || found.photographerId || found.photographer_id) : null;
                          if (fb) label = String(fb);
                        } catch (e) { /* ignore */ }
                        if (!label) label = meta.photographerId ? `摄影师#${meta.photographerId}` : (meta.photographer_id ? `摄影师#${meta.photographer_id}` : null);
                      }
                      if (!label) return null;
                      return (
                        <div style={{ position: 'absolute', left: 16, top: 16, background: 'rgba(0,0,0,0.55)', color: '#fff', padding: '6px 10px', borderRadius: 4, fontSize: '13px', pointerEvents: 'none', maxWidth: '60%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {label}
                        </div>
                      );
                    })()}
                    <div style={{ position: 'absolute', right: 16, bottom: 16 }}>
                      <button type="button" className="viewer-original-btn" onClick={(e) => { e.stopPropagation(); setViewerShowOriginal((v) => !v); }}>
                        {viewerShowOriginal ? '查看缩略图' : '查看原图'}
                      </button>
                    </div>
                    {showAILabels && photoAILabelMap[photoMetas[viewerIndex].id] && (
                      <div style={{ position: 'absolute', right: 16, top: 16, background: photoAILabelMap[photoMetas[viewerIndex].id] === 'recommended' ? '#4caf50' : '#f44336', color: '#fff', padding: '6px 12px', borderRadius: '3px', fontSize: '13px', fontWeight: 'bold' }}>
                        {photoAILabelMap[photoMetas[viewerIndex].id] === 'recommended' ? 'AI推荐' : 'AI不推荐'}
                      </div>
                    )}
                    {(() => {
                      const pid = photoMetas[viewerIndex]?.id;
                      if (!pid) return null;
                      const hasRecommend = (photoTagsMap[pid] || []).includes('推荐');
                      if (!hasRecommend) return null;
                      const hasAI = showAILabels && photoAILabelMap[pid];
                      return (
                        <div style={{ position: 'absolute', right: 16, top: hasAI ? 48 : 16, background: '#2196f3', color: '#fff', padding: '6px 12px', borderRadius: '3px', fontSize: '13px', fontWeight: 'bold' }}>
                          推荐
                        </div>
                      );
                    })()}
                    {(() => {
                      const pid = photoMetas[viewerIndex]?.id;
                      const hasDesc = !!(photoDescMap[pid]);
                      const hasTags = (photoTagsMap[pid] || []).length > 0;
                      if (!hasDesc && !hasTags && !viewerEditVisible) return null;
                      return (
                        <div
                          style={{
                            position: 'absolute',
                            // center horizontally relative to the image container
                            left: '50%',
                            transform: 'translateX(-50%)',
                            bottom: 96,
                            width: '80%',
                            maxWidth: '900px',
                            padding: '12px',
                            borderRadius: '4px',
                            fontSize: '14px',
                            // when editing use opaque light background and dark text for readability
                            background: viewerEditVisible ? 'rgba(255,255,255,0.98)' : 'rgba(0,0,0,0.45)',
                            color: viewerEditVisible ? '#111' : '#fff',
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'stretch',
                          }}
                          onClick={(e) => e.stopPropagation()}
                        >
                          {viewerEditVisible ? (
                            <div style={{ pointerEvents: 'auto' }}>
                              <TextArea value={viewerEditDescription} onChange={(v) => setViewerEditDescription(v)} rows={4} placeholder="照片描述" style={{ background: '#fff', color: '#111' }} />
                              <div style={{ marginTop: 8, marginBottom: 6 }}>照片标签（按回车添加）</div>
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                                {(viewerEditTags || []).map((t, i) => (
                                  <Tag key={t + i} size="small" type="light">{t}
                                    <button style={{ marginLeft: 6, border: 'none', background: 'transparent', cursor: 'pointer', color: '#333' }} onClick={(e) => { e.stopPropagation(); setViewerEditTags((s) => s.filter(x => x !== t)); }}>×</button>
                                  </Tag>
                                ))}
                                <input value={viewerEditTagInput} onChange={(e) => setViewerEditTagInput(e.target.value)} onKeyDown={(e) => {
                                  if (e.key === 'Enter' || e.key === ',') {
                                    e.preventDefault();
                                    const v = (viewerEditTagInput || '').trim();
                                    if (v && !(viewerEditTags || []).includes(v)) setViewerEditTags((s) => [...(s || []), v]);
                                    setViewerEditTagInput('');
                                  }
                                }} placeholder="输入标签并回车" style={{ minWidth: 160, padding: '6px 8px' }} />

                                <div style={{ width: '100%', display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
                                  <button type="button" className="viewer-original-btn" onClick={(e) => { e.stopPropagation(); saveViewerPhotoEdit(); }} style={{ padding: '8px 12px', background: '#1890ff', color: '#fff' }}>保存</button>
                                  <button type="button" className="viewer-original-btn" onClick={(e) => { e.stopPropagation(); setViewerEditVisible(false); }} style={{ padding: '8px 12px', background: '#f0f0f0', color: '#333' }}>取消</button>
                                </div>
                              </div>
                            </div>
                          ) : (
                            <div style={{ pointerEvents: 'none' }}>
                              {hasDesc && (
                                <div style={{ marginBottom: hasTags ? '8px' : 0, fontSize: '14px' }}>{photoDescMap[pid]}</div>
                              )}
                              {hasTags && (
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                                  {photoTagsMap[pid].map((tag, i) => (
                                    <span key={i} style={{ background: '#1890ff', padding: '4px 8px', borderRadius: '3px', whiteSpace: 'nowrap', fontSize: '12px' }}>{tag}</span>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </>
                ) : images[viewerIndex] ? (
                  <img
                    src={images[viewerIndex]}
                    alt={`viewer-${viewerIndex}`}
                    className="viewer-img"
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : null}
              </div>

              <div style={{ position: 'absolute', left: '50%', bottom: 16, transform: 'translateX(-50%)', zIndex: 2, display: 'flex', gap: 12, alignItems: 'center' }}>
                <button
                  type="button"
                  className="viewer-original-btn"
                  onClick={(e) => { e.stopPropagation(); downloadCurrentPhoto(); }}
                  style={{ padding: '10px 16px', minWidth: 140 }}
                >
                  下载该照片
                </button>

                {(photoMetas && photoMetas[viewerIndex]) && (
                  <button
                    type="button"
                    className="viewer-original-btn"
                    onClick={(e) => { e.stopPropagation(); openPhotoEditModal(); }}
                    style={{ padding: '10px 16px', minWidth: 140, background: '#1890ff', color: '#fff' }}
                  >
                    修改照片信息
                  </button>
                )}

                {(() => {
                  const meta = photoMetas?.[viewerIndex];
                  if (!meta || !meta.id) return null;
                  const hasRecommendTag = (photoTagsMap[meta.id] || []).includes('推荐');
                  const hasAIRecommend = photoAILabelMap[meta.id] === 'recommended';
                  if (!canEditTags || hasRecommendTag || hasAIRecommend) return null;
                  return (
                    <button
                      type="button"
                      className="viewer-original-btn"
                      onClick={(e) => { e.stopPropagation(); addRecommendationTag(); }}
                      style={{ padding: '10px 16px', minWidth: 100, background: '#4caf50', color: '#fff' }}
                    >
                      推荐标记
                    </button>
                  );
                })()}
              </div>

              <button
                className="viewer-nav viewer-nav-right"
                onClick={(e) => { e.stopPropagation(); setViewerIndex((i) => (images.length ? (i + 1) % images.length : i)); }}
                aria-label="下一张"
              />
            </div>
          </div>
        )}

        {/* Inline viewer edit 鈥?replaced modal with inline editor under the photo */}

      </div>
    </div>
  );
}

export default ProjectDetail;

