// src/ProjectDetail.jsx
import React from 'react';
import { Typography, Button, Tag, Spin, Empty, Modal, Input, DatePicker, TextArea, Toast } from '@douyinfe/semi-ui';
import './ProjectDetail.css';
import { getProjectById, updateProject, deleteProject } from './services/projectService';
import { fetchRandomByProject, uploadPhotos, deletePhotos } from './services/photoService';
import { resolveAssetUrl } from './services/request';

const { Title, Text } = Typography;

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

  // selection / delete
  const [deleteMode, setDeleteMode] = React.useState(false);
  const [selectedMap, setSelectedMap] = React.useState({});
  const [selectedCount, setSelectedCount] = React.useState(0);
  const [allSelected, setAllSelected] = React.useState(false);

  const fileInputRef = React.useRef(null);

  const galleryRef = React.useRef(null);
  const [galleryWidth, setGalleryWidth] = React.useState(0);
  const [imageRatios, setImageRatios] = React.useState({});
  // image viewer
  const [viewerVisible, setViewerVisible] = React.useState(false);
  const [viewerIndex, setViewerIndex] = React.useState(0);
  // whether viewer currently shows the original image (toggle per viewer open/index)
  const [viewerShowOriginal, setViewerShowOriginal] = React.useState(false);

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

        return {
          src: resolveAssetUrl(thumbCandidate),
          meta: Object.assign({}, meta, { thumbSrc: resolveAssetUrl(thumbCandidate), originalSrc: resolveAssetUrl(origCandidate) })
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
      return {
        src: resolveAssetUrl(thumbCandidate),
        meta: Object.assign({}, meta, { thumbSrc: resolveAssetUrl(thumbCandidate), originalSrc: resolveAssetUrl(origCandidate) })
      };
    }).filter(Boolean);
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

  // ========== Upload / Edit / Selection handlers ==========
  const openUploadPicker = React.useCallback(() => {
    if (fileInputRef.current) fileInputRef.current.click();
  }, []);

  const handleFilesSelected = React.useCallback((files) => {
    const list = Array.from(files || []);
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
    setUploading(true);
    try {
      // upload one file at a time using field name 'file' (backend expects single 'file')
      for (const f of stagingFiles) {
        const fd = new FormData();
        fd.append('file', f);
        fd.append('projectId', projectId);
        // await each upload to ensure project photo_ids are updated correctly
        await uploadPhotos(fd);
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

      await updateProject(projectId, { projectName: editTitle, description: editDescription, eventDate: eventDatePayload || null });
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
      Toast.error('保存失败');
    }
  }, [projectId, editTitle, editDescription, editEventDate]);

  const handleDeleteProject = React.useCallback(() => {
    if (!projectId) return Toast.warning('无效的项目ID');
    Modal.confirm({
      title: '确认删除相册',
      content: '删除后将不可恢复，且可能同时删除关联照片。确定要删除该相册吗？',
      onOk: async () => {
        try {
          await deleteProject(projectId);
          Toast.success('相册已删除');
          if (typeof onBack === 'function') {
            // tell parent to reload list
            onBack(true);
          }
        } catch (err) {
          console.error('deleteProject error', err);
          Toast.error('删除失败');
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

  const confirmDelete = React.useCallback(async () => {
    const indexes = Object.keys(selectedMap || {}).map(k => Number(k));
    if (!indexes.length) return Toast.warning('未选择照片');
    const ids = indexes.map(i => {
      const meta = (photoMetas && photoMetas[i]) || null;
      if (!meta) return null;
      return meta.id || meta.photoId || meta.photo_id || null;
    }).filter(Boolean);
    if (!ids.length) return Toast.warning('所选照片无可删除的 ID');
    try {
      await deletePhotos(ids);
      Toast.success('删除成功');
      // reload
      const detail = await getProjectById(projectId);
      setProject(detail);
      const built = buildImagesAndMetas(detail);
      setImages(built.images);
      setPhotoMetas(built.metas);
      setDeleteMode(false); setSelectedMap({}); setSelectedCount(0); setAllSelected(false);
    } catch (err) {
      console.error('delete error', err);
      Toast.error('删除失败');
    }
  }, [selectedMap, images, projectId]);

  // ========== Download helpers ==========
  const getSelectedIndexes = React.useCallback(() => Object.keys(selectedMap || {}).map((k) => Number(k)).sort((a,b) => a-b), [selectedMap]);

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
          return {
            id: meta.id || meta.photoId || meta.photo_id || null,
            url: meta.originalSrc || meta.thumbSrc || images[i] || null,
            thumbSrc: meta.thumbSrc || images[i] || null,
            originalSrc: meta.originalSrc || images[i] || null,
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

  return (
    <div className="detail-page">
      {/* 顶部信息栏 */}
      <div className="detail-header">
        <div>
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

          <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
            <Button onClick={openEdit} type="primary">修改信息</Button>
            <Button onClick={openUploadPicker} type="tertiary">我要补充照片</Button>
            <Button onClick={toggleDeleteMode} type={deleteMode ? 'danger' : 'tertiary'}>{deleteMode ? '取消选择' : '选择'}</Button>
            <input ref={fileInputRef} style={{ display: 'none' }} type="file" accept="image/*" multiple onChange={(e) => handleFilesSelected(e.target.files)} />
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
                        onClick={() => {
                          if (deleteMode) {
                            toggleSelect(overallIndex);
                          } else if (overallIndex >= 0) {
                            setViewerIndex(overallIndex);
                            setViewerVisible(true);
                          }
                        }}
                      />
                      {deleteMode && (
                        <div style={{ position: 'absolute', right: 8, top: 8, width: 32, height: 32, borderRadius: 16, background: selectedMap[String(overallIndex)] ? '#ff5252' : 'rgba(0,0,0,0.45)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }} onClick={(e) => { e.stopPropagation(); toggleSelect(overallIndex); }}>
                          {selectedMap[String(overallIndex)] ? '✓' : ''}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
      {/* 底部操作：删除 / 全选 */}
      {deleteMode && (
        <div style={{ position: 'fixed', left: '50%', transform: 'translateX(-50%)', bottom: 24, zIndex: 1400, display: 'flex', gap: 12 }}>
            <Button onClick={toggleSelectAll}>{allSelected ? '取消全选' : '全选'}</Button>
            <Button onClick={packDownloadSelected} type="tertiary">打包下载</Button>
            <Button onClick={confirmDelete} type="danger">删除 ({selectedCount})</Button>
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
          <DatePicker
            value={editEventDate}
            onChange={(v) => setEditEventDate(v)}
            format="yyyy-MM-dd"
            placeholder="活动日期 (YYYY-MM-DD)"
            style={{ width: '100%' }}
            clearable
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 6 }}>
            <Button type="danger" onClick={handleDeleteProject}>删除相册</Button>
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

            <div className="viewer-img-wrap">
              {photoMetas && photoMetas[viewerIndex] ? (
                <>
                  <img
                    src={viewerShowOriginal ? (photoMetas[viewerIndex].originalSrc || images[viewerIndex]) : (photoMetas[viewerIndex].thumbSrc || images[viewerIndex])}
                    alt={`viewer-${viewerIndex}`}
                    className="viewer-img"
                    onClick={(e) => e.stopPropagation()}
                  />
                  <div style={{ position: 'absolute', right: 16, bottom: 16 }}>
                    <button type="button" className="viewer-original-btn" onClick={(e) => { e.stopPropagation(); setViewerShowOriginal((v) => !v); }}>
                      {viewerShowOriginal ? '查看缩略图' : '查看原图'}
                    </button>
                  </div>
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

            <button
              className="viewer-nav viewer-nav-right"
              onClick={(e) => { e.stopPropagation(); setViewerIndex((i) => (images.length ? (i + 1) % images.length : i)); }}
              aria-label="下一张"
            />
          </div>
        </div>
      )}
      </div>
    </div>
  );
}

export default ProjectDetail;
