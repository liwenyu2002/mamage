// src/ProjectDetail.jsx
import React from 'react';
import { Typography, Button, Tag, Spin, Empty, Modal, Input, DatePicker, TextArea, Toast } from '@douyinfe/semi-ui';
import './ProjectDetail.css';
import { getProjectById, updateProject, deleteProject } from './services/projectService';
import { me as fetchMe, getToken } from './services/authService';
import { fetchRandomByProject, uploadPhotos, deletePhotos } from './services/photoService';
import { resolveAssetUrl, BASE_URL } from './services/request';
import IfCan from './components/IfCan';
import PermButton from './components/PermButton';
import { canAny } from './permissionStore';

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

function ProjectDetail({ projectId, initialProject, onBack }) {
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
        } catch (e) {}

        const metaFinal = Object.assign({}, meta, { thumbSrc: resolveAssetUrl(thumbCandidate), originalSrc: resolveAssetUrl(origCandidate) });
        if (metaFinal.id) {
          tagsMap[metaFinal.id] = safeParseTags(item.tags);
          descMap[metaFinal.id] = item.description || item.desc || '';
        }
        return {
          src: resolveAssetUrl(thumbCandidate),
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
      } catch (e) {}
      const metaFinal = Object.assign({}, meta, { thumbSrc: resolveAssetUrl(thumbCandidate), originalSrc: resolveAssetUrl(origCandidate) });
      if (metaFinal.id) {
        tagsMap[metaFinal.id] = safeParseTags(item.tags);
        descMap[metaFinal.id] = item.description || item.desc || '';
      }
      return {
        src: resolveAssetUrl(thumbCandidate),
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
        try { URL.revokeObjectURL(u); } catch (e) {}
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

            // 如果 detail 中返回了更完整的 photo 对象，合并这些字段回 photoMetas
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

            // 如果部分 photo meta 缺少 photographerName，但包含 photographerId，
            // 前端仍可回退去请求用户信息并补全 name（可保留以提升体验）。
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
              // 忽略网络错误，不影响主流程
            }
          }
        } catch (e) {
          console.warn('Failed to process photos from project detail:', e);
        }
      } catch (err) {
        if (canceled) return;
        setError(err?.message || '获取项目详情失败');
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
    let cancelled = false;
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
      try { Toast.warning(`一次最多上传 ${MAX_FILES} 张照片，已选择前 ${MAX_FILES} 张`); } catch (e) {}
      list = list.slice(0, MAX_FILES);
    }
    const previews = list.map((f) => URL.createObjectURL(f));
    setStagingFiles(list);
    setStagingPreviews(previews);
    setUploadMode(true);
  }, []);

  const cancelUpload = React.useCallback(() => {
    stagingPreviews.forEach((u) => { try { URL.revokeObjectURL(u); } catch (e) {} });
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
      try { Toast.warning(`一次最多上传 ${MAX_FILES} 张照片，已按前 ${MAX_FILES} 张上传`); } catch (e) {}
      filesToUpload = stagingFiles.slice(0, MAX_FILES);
    }
    setUploading(true);
    try {
      // upload one file at a time using correct endpoint
      for (const f of filesToUpload) {
        // pass file and projectId to uploadPhotos; it will construct FormData
        await uploadPhotos({ file: f, projectId });
      }
      Toast.success('上传成功');
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
      Toast.error('上传失败');
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
        try { localStorage.removeItem('mamage_jwt_token'); } catch (e) {}
        Toast.error('请重新登录管理员账号');
        try { window.history.pushState({}, '', '/login'); } catch (e) { window.location.href = '/login'; }
      } else if (status === 404) {
        Toast.warning('相册已不存在');
        if (typeof onBack === 'function') onBack(true);
      } else if (status && status >= 500) {
        Toast.error('服务器异常，请稍后重试');
      } else {
        Toast.error('保存失败');
      }
    }
  }, [projectId, editTitle, editDescription, editEventDate]);

  const handleDeleteProject = React.useCallback(() => {
    if (!projectId) return Toast.warning('无效的项目ID');
    Modal.confirm({
      title: '确认删除相册',
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
            try { localStorage.removeItem('mamage_jwt_token'); } catch (e) {}
            Toast.error('权限不足或登录已过期，请重新登录或联系管理员');
            try { window.history.pushState({}, '', '/login'); } catch (e) { window.location.href = '/login'; }
          } else if (status === 404) {
            Toast.warning('相册已不存在');
            if (typeof onBack === 'function') onBack(true);
          } else if (status && status >= 500) {
            Toast.error('服务器异常，请稍后重试');
          } else {
            Toast.error('删除失败');
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
      const map = {}; for (let i=0;i<total;i++) map[String(i)] = true; setSelectedMap(map); setSelectedCount(total); setAllSelected(true);
    }
  }, [images, allSelected]);

  const confirmDelete = React.useCallback(() => {
    const indexes = Object.keys(selectedMap || {}).map(k => Number(k));
    if (!indexes.length) return Toast.warning('未选择照片');
    const ids = indexes.map(i => {
      const meta = (photoMetas && photoMetas[i]) || null;
      if (!meta) return null;
      return meta.id || meta.photoId || meta.photo_id || null;
    }).filter(Boolean);
    if (!ids.length) return Toast.warning('所选照片无可删除的 ID');

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
            Toast.success('删除成功');
          }
          if (Array.isArray(notFound) && notFound.length > 0) {
            Toast.warning('部分照片已不存在');
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
            try { localStorage.removeItem('mamage_jwt_token'); } catch (e) {}
            Toast.error('权限不足或登录已过期，请重新登录或联系管理员');
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
  const getSelectedIndexes = React.useCallback(() => Object.keys(selectedMap || {}).map((k) => Number(k)).sort((a,b) => a-b), [selectedMap]);

  const downloadCurrentPhoto = React.useCallback(async () => {
    const idx = viewerIndex;
    const meta = (photoMetas && photoMetas[idx]) || {};
    const url = meta.originalSrc || meta.url || meta.thumbSrc || images[idx];
    if (!url) return Toast.warning('无法获取图片资源');
    try {
      const resp = await fetch(url, { credentials: 'same-origin' });
      if (!resp.ok) throw new Error(`下载失败: ${resp.status}`);
      const blob = await resp.blob();
      let filename = getFilenameFromContentDisposition(resp);
      if (!filename) {
        try {
          const u = new URL(url, window.location.origin);
          filename = u.pathname.split('/').pop() || 'photo';
        } catch (e) {
          filename = 'photo';
        }
      }
      await downloadBlob(blob, filename || 'photo');
      Toast.success('已开始下载');
    } catch (err) {
      console.error('downloadCurrentPhoto error', err);
      Toast.error('下载失败，请稍后再试');
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
          || '项目';
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
    if (!idxs.length) return Toast.warning('未选择照片');
    const ids = idxs.map((i) => {
      const meta = (photoMetas && photoMetas[i]) || {};
      return meta.id || null;
    }).filter(Boolean);
    if (!ids.length) return Toast.warning('所选照片无可下载的 ID');

    const zipName = `photos_${projectId || 'pkg'}`;
    try {
      const resp = await fetch('/api/photos/zip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
      Toast.success('打包下载准备完成');
      return;
    } catch (err) {
      console.warn('packDownloadSelected: server zip failed', err);
      // 尝试从错误信息中提取服务器返回的详细文本并展示给用户
      let msg = '打包下载失败';
      try {
        if (err && err.message) {
          const m = err.message.match(/download failed:\s*(.*)$/s);
          if (m && m[1]) {
            // 如果服务器返回的是 JSON 字符串，尝试解析并展示 error 字段或摘要
            let detail = m[1].trim();
            try {
              const j = JSON.parse(detail);
              if (j && (j.error || j.message)) {
                detail = j.error || j.message;
              }
            } catch (e) {
              // not json, keep as-is
            }
            msg = `打包下载失败: ${detail}`;
          } else {
            msg = `打包下载失败: ${err.message}`;
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
      try { window.__MAMAGE_LAST_PROJECT = { resolvedProject: resolvedProject || null, tags: tags || [] }; } catch (e) {}
    } catch (e) {}
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
    // 更新照片信息
    const photoId = updatedPhoto.id;
    const photoIndex = photoMetas?.findIndex(m => m.id === photoId) ?? -1;
    
    if (photoIndex >= 0) {
      // 更新tags和description
      const newTags = safeParseTags(updatedPhoto.tags);
      const newDesc = updatedPhoto.description || '';
      
      setPhotoTagsMap(prev => ({ ...prev, [photoId]: newTags }));
      setPhotoDescMap(prev => ({ ...prev, [photoId]: newDesc }));
      
      // 刷新项目数据以保持同步
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
    if (!photoId) return Toast.warning('无法获取照片 ID');
    try {
      const token = getToken();
      if (!token) {
        Toast.error('未登录，请先登录');
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
        Toast.error('权限不足，仅管理员可操作');
        return;
      }
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(txt || '保存失败');
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
      Toast.error('保存失败');
    }
  }, [viewerIndex, viewerEditTags, viewerEditDescription, projectId, photoMetas]);

  // 推荐标记：添加"推荐"标签
  const addRecommendationTag = React.useCallback(async () => {
    if (viewerIndex < 0 || !photoMetas || !photoMetas[viewerIndex]) return;
    
    const currentMeta = photoMetas[viewerIndex];
    const photoId = currentMeta.id;
    
    // 检查是否已有"推荐"标签
    const currentTags = photoTagsMap[photoId] || [];
    if (currentTags.includes('推荐')) {
      Toast.warning('该照片已有"推荐"标签');
      return;
    }

    try {
      const token = getToken();
      if (!token) {
        Toast.error('未登录，请先登录');
        return;
      }

      // 添加"推荐"标签到现有标签
      const newTags = [...currentTags, '推荐'];
      
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
        Toast.error('权限不足，仅管理员可操作');
        return;
      }

      if (!res.ok) {
        const errText = await res.text();
        Toast.error(`操作失败: ${errText}`);
        return;
      }

      const data = await res.json();
      const updatedTags = safeParseTags(data.tags);
      setPhotoTagsMap(prev => ({ ...prev, [photoId]: updatedTags }));
      Toast.success('已添加推荐标签');
    } catch (err) {
      console.error('add recommendation failed:', err);
      Toast.error(`操作失败: ${err.message}`);
    }
  }, [viewerIndex, photoMetas, photoTagsMap]);

  return (
    <div className="detail-page">
      {/* 顶部信息栏 */}
      <div className="detail-header">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <Button
              onClick={onBack}
              type="primary"
              size="large"
              theme="solid"
              className="detail-back-btn"
              style={{ borderRadius: 8, boxShadow: '0 6px 18px rgba(16,24,40,0.08)', padding: '10px 18px' }}
            >
              ← 返回项目列表
            </Button>

            {canUploadPhotos ? (
              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Button
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
                      title="点击上传或者将图片拖拽到按钮上"
                      aria-label="上传照片"
                    >
                      <svg style={{ marginRight: 10 }} width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
                        <path d="M12 3v10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                        <path d="M8 7l4-4 4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                        <path d="M21 21H3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', lineHeight: 1 }}>
                        <span style={{ fontWeight: 400, color: '#111', marginBottom: 6 }}>补充照片</span>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                          <span style={{ fontSize: 12, color: '#6b6b6b', opacity: 0.95, fontWeight: 400, textAlign: 'left' }}>支持拖拽到按钮或点击上传</span>
                          <span style={{ fontSize: 12, color: '#6b6b6b', opacity: 0.95, fontWeight: 400, textAlign: 'left' }}>一次最多上传15张</span>
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

          <div style={{ display: 'flex', gap: 12, marginTop: 8, alignItems: 'center', width: '100%' }}>
            <div style={{ display: 'flex', gap: 0, alignItems: 'center' }}>
              <IfCan perms={['projects.update']}>
                <Button onClick={openEdit} type="primary">修改信息</Button>
              </IfCan>
              <Button
                onClick={() => setShowAILabels(!showAILabels)}
                type={showAILabels ? 'primary' : 'tertiary'}
                style={{ color: '#722ed1', marginLeft: 6 }}
              >
                AI 选片
              </Button>
            </div>
            {/* "我要补充照片" 已移至顶部返回按钮行 */}
            {(canDeletePhotos || canPackDownload) ? (
              <Button onClick={toggleDeleteMode} type={deleteMode ? 'danger' : 'tertiary'} style={{ marginLeft: 'auto' }}>{deleteMode ? '取消选择' : '选择'}</Button>
            ) : null}
          </div>

          <div className="detail-meta" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              {startText && <Text type="tertiary">{`开展于 ${startText}`}</Text>}
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

      <div className="detail-gallery" ref={galleryRef}>
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

        {!loading && !error && rows.length === 0 && (
          <div style={{ width: '100%', display: 'flex', justifyContent: 'center', padding: '60px 0' }}>
            <Empty description="该项目暂无图片" />
          </div>
        )}

        {!loading && !error &&
          rows.map((r, rowIndex) => (
            <div className="detail-gallery-row" key={rowIndex} style={{ height: r.height }}>
              {r.images.map((src, idx) => {
                const w = Math.round((r.ratios[idx] || 1) * r.height);
                const overallIndex = images.indexOf(src);
                return (
                  <div
                    className="detail-photo"
                    key={`${rowIndex}-${idx}`}
                    style={{ width: w }}
                  >
                    <div style={{ position: 'relative' }}>
                      <img
                        src={src}
                        alt={`${title}-${rowIndex}-${idx}`}
                        width={w}
                        height={r.height}
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
                          } catch (err) {}
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
                        // 支持多种可能的字段名，优先使用姓名字符串
                        const rawName = meta.photographerName || meta.photographer_name || meta.photographer || (meta.photographerId ? String(meta.photographerId) : null) || (meta.photographer_id ? String(meta.photographer_id) : null);
                        const hasName = rawName && String(rawName).trim();
                        let photographerLabel = null;
                        if (hasName) {
                          photographerLabel = String(rawName);
                        } else {
                          // 尝试从项目详情或初始项目中回退查找 photographerName
                          try {
                            const list = (project && (project.photos || project.images || project.gallery)) || (initialProject && (initialProject.photos || initialProject.images || initialProject.gallery)) || [];
                            const found = Array.isArray(list) ? list.find(p => p && (String(p.id) === String(meta.id) || String(p.photoId) === String(meta.id))) : null;
                            const fb = found ? (found.photographerName || found.photographer || found.photographer_name || found.photographerId || found.photographer_id) : null;
                            if (fb) photographerLabel = String(fb);
                          } catch (e) { /* ignore */ }
                          if (!photographerLabel) {
                            photographerLabel = meta.photographerId ? `摄影师 #${meta.photographerId}` : (meta.photographer_id ? `摄影师 #${meta.photographer_id}` : '未知摄影师');
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
                );
              })}
            </div>
          ))}
      {/* 底部操作：删除 / 全选 */}
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

      {/* 编辑弹窗 */}
      <Modal
        title="修改项目信息"
        visible={editVisible}
        onOk={saveEdit}
        onCancel={() => setEditVisible(false)}
        okText="保存"
        cancelText="取消"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
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
                <input value={editTagInput} onChange={(e) => setEditTagInput(e.target.value)} onKeyDown={(e) => {
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
              <Button type="danger" onClick={handleDeleteProject} loading={deletingProject} disabled={deletingProject}>删除相册</Button>
            </IfCan>
          </div>
        </div>
      </Modal>

      {/* 上传预览弹窗 */}
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
                      if (!label) label = meta.photographerId ? `摄影师 #${meta.photographerId}` : (meta.photographer_id ? `摄影师 #${meta.photographer_id}` : null);
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

      {/* Inline viewer edit — replaced modal with inline editor under the photo */}

      </div>
    </div>
  );
}

export default ProjectDetail;
