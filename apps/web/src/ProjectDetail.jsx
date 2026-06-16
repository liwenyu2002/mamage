// src/ProjectDetail.jsx
import React from 'react';
import { Typography, Button, Tag, Spin, Empty, Modal, Input, DatePicker, TextArea, Toast } from '@douyinfe/semi-ui';
import {
  IconAIStrokedLevel1,
  IconClose,
  IconCloudUploadStroked,
  IconEditStroked,
  IconGridView,
  IconListView,
  IconMoreStroked,
  IconSearch,
} from '@douyinfe/semi-icons';
import './ProjectDetail.css';
import { getProjectById, updateProject, deleteProject } from './services/projectService';
import { getToken } from './services/authService';
import { fetchRandomByProject, searchPhotos, getPhotoById, getFacePersonInfo, labelFacePerson, renameFacePerson, uploadPhotoFiles, deletePhotos, getPhotoFaces } from './services/photoService';
import { resolveAssetUrl, BASE_URL } from './services/request';
import IfCan from './permissions/IfCan';
import PermButton from './permissions/PermButton';
import { canAny, getPermissions } from './permissions/permissionStore';

const { Title, Text } = Typography;
const ANALYSIS_POLL_INITIAL_DELAY_MS = 900;
const ANALYSIS_POLL_INTERVAL_MS = 1800;
const ANALYSIS_POLL_MAX_ATTEMPTS = 45;
const AI_QUALITY_TAGS = ['AI recommended', 'AI medium', 'AI rejected'];
const GALLERY_INITIAL_RENDER_LIMIT = 96;
const GALLERY_RENDER_BATCH_SIZE = 96;

function getAISelectionLabel(label) {
  if (label === 'recommended') return 'AI推荐';
  if (label === 'medium') return 'AI中等';
  if (label === 'rejected') return 'AI不推荐';
  return '';
}

function getAISelectionColor(label) {
  if (label === 'recommended') return '#16a34a';
  if (label === 'medium') return '#f59e0b';
  if (label === 'rejected') return '#dc2626';
  return '#64748b';
}

function getAISelectionChipClass(label) {
  if (label === 'recommended') return 'viewer-chip--good';
  if (label === 'medium') return 'viewer-chip--medium';
  if (label === 'rejected') return 'viewer-chip--bad';
  return '';
}

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

function getPhotoThumbCandidate(item) {
  if (!item) return '';
  if (typeof item === 'string') return item;
  return item.thumbSrc || item.thumbUrl || item.thumbnail || item.thumb || item.url || item.imageUrl || item.src || item.fileUrl || item.originalSrc || item.originalUrl || item.original || item.full || item.large || '';
}

function getPhotoOriginalCandidate(item) {
  if (!item) return '';
  if (typeof item === 'string') return item;
  return item.originalSrc || item.originalUrl || item.original || item.full || item.large || item.url || item.imageUrl || item.src || item.fileUrl || item.thumbSrc || item.thumbUrl || item.thumbnail || item.thumb || '';
}

function getPhotoRecordId(item) {
  if (!item || typeof item !== 'object') return null;
  const raw = item.id || item.photoId || item.photo_id || item.imageId || item.image_id || null;
  if (raw === null || raw === undefined) return null;
  const sid = String(raw).trim();
  return sid || null;
}

function extractPhotoSemantic(photo) {
  const allTags = safeParseTags(photo && photo.tags);
  let aiLabel = null;
  if (allTags.includes('AI recommended')) aiLabel = 'recommended';
  else if (allTags.includes('AI medium')) aiLabel = 'medium';
  else if (allTags.includes('AI rejected')) aiLabel = 'rejected';
  const tags = allTags.filter((tag) => !AI_QUALITY_TAGS.includes(tag));
  const description = String((photo && (photo.description || photo.desc)) || '').trim();
  return {
    tags,
    description,
    aiLabel,
    hasAnalysis: Boolean(description || tags.length)
  };
}

function normalizePhotoForGallery(photo) {
  if (!photo || typeof photo !== 'object') return null;
  const id = getPhotoRecordId(photo);
  const thumbSrc = resolveAssetUrl(getPhotoThumbCandidate(photo));
  const originalSrc = resolveAssetUrl(getPhotoOriginalCandidate(photo));
  const src = thumbSrc || originalSrc;
  if (!id || !src) return null;
  return {
    src,
    meta: {
      ...photo,
      id,
      photoId: id,
      thumbSrc,
      originalSrc
    }
  };
}

function toFiniteNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toNameList(input) {
  if (!input) return [];
  const arr = Array.isArray(input) ? input : String(input).split(/[;,，、|]/);
  const out = [];
  arr.forEach((v) => {
    const s = String(v || '').trim();
    if (!s) return;
    if (out.includes(s)) return;
    out.push(s);
  });
  return out;
}

function extractFaceNamesFromMeta(meta, viewerFaces) {
  const direct = toNameList(
    (meta && (
      meta.faceNames
      || meta.personNames
      || meta.personNameList
      || meta.face_name_list
      || meta.person_name_list
      || meta.people
    )) || []
  );
  if (direct.length) return direct;

  const names = [];
  const faces = Array.isArray(viewerFaces) ? viewerFaces : (Array.isArray(meta?.faces) ? meta.faces : []);
  faces.forEach((f) => {
    const n = String((f && (f.personName || f.person_name || f.name || f.label)) || '').trim();
    if (!n) return;
    if (/^人脸#?\d+$/i.test(n) || /^face#?\d+$/i.test(n)) return;
    if (!names.includes(n)) names.push(n);
  });
  return names;
}

function normalizeRelatedFacePhotos(input) {
  if (!Array.isArray(input)) return [];
  return input.map((item, idx) => {
    if (!item) return null;
    if (typeof item === 'string') {
      const url = resolveAssetUrl(item);
      return { id: `photo-${idx + 1}`, url, thumbUrl: url, title: `照片 ${idx + 1}` };
    }
    const id = item.id || item.photoId || item.photo_id || item.imageId || item.image_id || `photo-${idx + 1}`;
    const thumb = item.thumbUrl || item.thumbSrc || item.thumbnail || item.thumb || item.url || item.src || '';
    const full = item.url || item.originalUrl || item.originalSrc || item.src || thumb;
    return {
      id: String(id),
      photoId: String(id),
      projectId: item.projectId || item.project_id || null,
      projectName: item.projectName || item.project_name || '',
      url: full ? resolveAssetUrl(full) : '',
      thumbUrl: thumb ? resolveAssetUrl(thumb) : (full ? resolveAssetUrl(full) : ''),
      title: item.title || item.description || item.name || `照片 ${idx + 1}`,
      description: item.description || '',
    };
  }).filter(Boolean);
}

function normalizeFaceDetections(payload) {
  const root = (payload && typeof payload === 'object') ? payload : {};
  const data = (root.data && typeof root.data === 'object') ? root.data : root;
  const list = Array.isArray(root)
    ? root
    : Array.isArray(data.faces)
      ? data.faces
      : Array.isArray(data.list)
        ? data.list
        : Array.isArray(data.items)
          ? data.items
          : Array.isArray(data.results)
            ? data.results
            : Array.isArray(data.boxes)
              ? data.boxes
              : [];

  const defaultImgW = toFiniteNumber(data.imageWidth ?? data.image_width ?? root.imageWidth ?? root.image_width);
  const defaultImgH = toFiniteNumber(data.imageHeight ?? data.image_height ?? root.imageHeight ?? root.image_height);

  return list.map((item, idx) => {
    const face = (item && typeof item === 'object') ? item : null;
    if (!face) return null;
    const rect = face.bbox || face.box || face.rect || face.region || face.faceBox || face.location || {};

    let left = toFiniteNumber(rect.left ?? rect.x ?? rect.x1 ?? rect.minX ?? face.left ?? face.x ?? face.x1 ?? face.minX);
    let top = toFiniteNumber(rect.top ?? rect.y ?? rect.y1 ?? rect.minY ?? face.top ?? face.y ?? face.y1 ?? face.minY);
    let width = toFiniteNumber(rect.width ?? rect.w ?? face.width ?? face.w);
    let height = toFiniteNumber(rect.height ?? rect.h ?? face.height ?? face.h);
    const right = toFiniteNumber(rect.right ?? rect.x2 ?? rect.maxX ?? face.right ?? face.x2 ?? face.maxX);
    const bottom = toFiniteNumber(rect.bottom ?? rect.y2 ?? rect.maxY ?? face.bottom ?? face.y2 ?? face.maxY);

    if ((left === null || top === null || width === null || height === null) && Array.isArray(rect) && rect.length >= 4) {
      left = left ?? toFiniteNumber(rect[0]);
      top = top ?? toFiniteNumber(rect[1]);
      width = width ?? toFiniteNumber(rect[2]);
      height = height ?? toFiniteNumber(rect[3]);
    }
    if (width === null && left !== null && right !== null) width = right - left;
    if (height === null && top !== null && bottom !== null) height = bottom - top;
    if (left === null || top === null || width === null || height === null || width <= 0 || height <= 0) return null;

    const normalizedHint = Boolean(face.normalized ?? rect.normalized ?? data.normalized ?? root.normalized);
    const looksNormalized = Math.abs(left) <= 1.05 && Math.abs(top) <= 1.05 && Math.abs(width) <= 1.2 && Math.abs(height) <= 1.2;
    const unit = (normalizedHint || looksNormalized) ? 'ratio' : 'pixel';
    const faceNo = face.faceNo || face.faceNumber || face.no || (idx + 1);
    const faceId = String(face.faceId || face.face_id || face.id || face.trackId || `face-${faceNo}`);
    const rawPhotoId = face.photoId || face.photo_id || face.imageId || face.image_id || '';
    const photoId = rawPhotoId ? String(rawPhotoId) : '';
    const personIdRaw = face.personId || face.person_id || face.identityId || face.identity_id || face.clusterId || face.cluster_id || null;
    const personId = (personIdRaw !== null && personIdRaw !== undefined && String(personIdRaw).trim() !== '') ? String(personIdRaw) : '';
    const personNameRaw = face.personName || face.person_name || face.name || face.label || '';
    const personName = String(personNameRaw || '').trim();

    return {
      faceId,
      photoId,
      faceNo,
      personId,
      personName,
      label: personName || (personId ? `人物#${personId}` : `人脸#${faceNo}`),
      left,
      top,
      width,
      height,
      unit,
      imageWidth: toFiniteNumber(face.imageWidth ?? face.image_width ?? rect.imageWidth ?? defaultImgW),
      imageHeight: toFiniteNumber(face.imageHeight ?? face.image_height ?? rect.imageHeight ?? defaultImgH),
      score: toFiniteNumber(face.score ?? face.confidence ?? face.similarity),
      relatedPhotos: normalizeRelatedFacePhotos(face.relatedPhotos || face.photos || face.matches || []),
      raw: face,
    };
  }).filter(Boolean);
}

function normalizeFacePerson(payload, sourceFace) {
  const root = (payload && typeof payload === 'object') ? payload : {};
  const data = (root.data && typeof root.data === 'object') ? root.data : root;
  const person = (data.person && typeof data.person === 'object')
    ? data.person
    : (data.profile && typeof data.profile === 'object')
      ? data.profile
      : (data.face && typeof data.face === 'object')
        ? data.face
        : data;

  const rawPersonId = person.personId || person.person_id || person.id || sourceFace?.personId || '';
  const personId = rawPersonId ? String(rawPersonId) : '';
  const faceId = sourceFace?.faceId ? String(sourceFace.faceId) : '';
  const personNameRaw = person.name || person.personName || person.person_name || person.label || sourceFace?.personName || '';
  const personName = String(personNameRaw || '').trim();
  const relatedPhotos = normalizeRelatedFacePhotos(
    data.relatedPhotos || data.photos || person.relatedPhotos || person.photos || sourceFace?.relatedPhotos || []
  );

  return {
    personId,
    faceId,
    personName,
    displayName: personName || (personId ? `人物#${personId}` : (sourceFace?.faceNo ? `人脸#${sourceFace.faceNo}` : '未标注人物')),
    description: String(person.description || person.bio || person.summary || '').trim(),
    relatedPhotos,
    sourceFace: sourceFace || null,
    raw: data,
  };
}

function ProjectDetail({
  projectId,
  initialProject,
  onBack,
  initialOpenPhotoId,
  onInitialOpenPhotoHandled,
  readOnly = false,
  galleryMode: controlledGalleryMode,
  onGalleryModeChange,
  onProjectHeaderChange,
}) {
  const DISABLE_UPLOAD_FEATURE = !!readOnly;
  const DISABLE_DELETE_FEATURE = !!readOnly;

  const [project, setProject] = React.useState(initialProject || null);
  const [images, setImages] = React.useState(() => (initialProject?.images ? initialProject.images.map((it) => resolveAssetUrl(getPhotoThumbCandidate(it))) : []));
  const [photoMetas, setPhotoMetas] = React.useState(() => (initialProject?.images ? initialProject.images.map((it) => (typeof it === 'string' ? { url: it } : { ...it, thumbSrc: resolveAssetUrl(getPhotoThumbCandidate(it)), originalSrc: resolveAssetUrl(getPhotoOriginalCandidate(it)) })) : []));
  const [loading, setLoading] = React.useState(() => !!projectId);
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
  const [userPermissions, setUserPermissions] = React.useState(() => getPermissions());
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
  const ratioCacheRef = React.useRef({});
  const [galleryPrepared, setGalleryPrepared] = React.useState(false);
  const [galleryRenderLimit, setGalleryRenderLimit] = React.useState(GALLERY_INITIAL_RENDER_LIMIT);
  const galleryMoreRef = React.useRef(null);
  const [detailImageReadyMap, setDetailImageReadyMap] = React.useState({});
  // image viewer
  const [viewerVisible, setViewerVisible] = React.useState(false);
  const [viewerIndex, setViewerIndex] = React.useState(0);
  const [viewerEnableOpenZoom, setViewerEnableOpenZoom] = React.useState(false);
  // whether viewer currently shows the original image (toggle per viewer open/index)
  const [viewerShowOriginal, setViewerShowOriginal] = React.useState(false);
  const [viewerFaceOverlayVisible, setViewerFaceOverlayVisible] = React.useState(false);
  const [viewerFaceMap, setViewerFaceMap] = React.useState({});
  const [viewerFaceErrorMap, setViewerFaceErrorMap] = React.useState({});
  const viewerFaceFetchPromiseRef = React.useRef({});
  const [viewerImageNaturalMap, setViewerImageNaturalMap] = React.useState({});
  const [facePersonVisible, setFacePersonVisible] = React.useState(false);
  const [facePersonLoading, setFacePersonLoading] = React.useState(false);
  const [facePersonError, setFacePersonError] = React.useState('');
  const [facePersonData, setFacePersonData] = React.useState(null);
  const [facePersonHeroPhoto, setFacePersonHeroPhoto] = React.useState(null);
  const [facePersonEditName, setFacePersonEditName] = React.useState('');
  const [facePersonSaving, setFacePersonSaving] = React.useState(false);
  // parsed photo tags and descriptions indexed by photo ID
  const [photoTagsMap, setPhotoTagsMap] = React.useState({});
  const [photoDescMap, setPhotoDescMap] = React.useState({});
  const [photoAnalysisPendingMap, setPhotoAnalysisPendingMap] = React.useState({});
  const analysisPollTimersRef = React.useRef({});
  // AI selection mode toggle
  const [showAILabels, setShowAILabels] = React.useState(false);
  // AI quality labels (recommended/medium/rejected) indexed by photo ID
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
  const viewerPointerRef = React.useRef({ active: false, pointerId: null, startX: 0, startY: 0 });
  const [searchKeyword, setSearchKeyword] = React.useState('');
  const [searching, setSearching] = React.useState(false);
  const [searchError, setSearchError] = React.useState('');
  const [searchOpen, setSearchOpen] = React.useState(false);
  const [actionSheetOpen, setActionSheetOpen] = React.useState(false);
  const searchReqSeqRef = React.useRef(0);
  const hasSearchedRef = React.useRef(false);

  React.useEffect(() => {
    setActionSheetOpen(false);
    setSearchOpen(false);
  }, [projectId]);

  React.useEffect(() => {
    if (!actionSheetOpen) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape') setActionSheetOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [actionSheetOpen]);

  React.useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    document.body.classList.toggle('mamage-detail-actions-open', actionSheetOpen);
    return () => document.body.classList.remove('mamage-detail-actions-open');
  }, [actionSheetOpen]);

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

  React.useEffect(() => () => {
    Object.values(analysisPollTimersRef.current || {}).forEach((timer) => {
      try { clearTimeout(timer); } catch (e) { }
    });
    analysisPollTimersRef.current = {};
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
        setImages((prev) => (prev.length ? prev : initialProject.images.map((it) => resolveAssetUrl(getPhotoThumbCandidate(it)))));
        setPhotoMetas((prev) => (prev.length ? prev : initialProject.images.map((it) => (typeof it === 'string' ? { url: it } : { ...it, thumbSrc: resolveAssetUrl(getPhotoThumbCandidate(it)), originalSrc: resolveAssetUrl(getPhotoOriginalCandidate(it)) }))));
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
    const aiLabelMap = {};
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
          const semantic = extractPhotoSemantic(item);
          if (semantic.hasAnalysis) {
            tagsMap[metaFinal.id] = semantic.tags;
            descMap[metaFinal.id] = semantic.description;
          }
          if (semantic.aiLabel) aiLabelMap[metaFinal.id] = semantic.aiLabel;
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
        const semantic = extractPhotoSemantic(item);
        if (semantic.hasAnalysis) {
          tagsMap[metaFinal.id] = semantic.tags;
          descMap[metaFinal.id] = semantic.description;
        }
        if (semantic.aiLabel) aiLabelMap[metaFinal.id] = semantic.aiLabel;
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
      setPhotoTagsMap((prev) => ({ ...(prev || {}), ...tagsMap }));
    }
    if (Object.keys(descMap).length) {
      setPhotoDescMap((prev) => ({ ...(prev || {}), ...descMap }));
    }
    if (Object.keys(aiLabelMap).length) {
      setPhotoAILabelMap((prev) => ({ ...(prev || {}), ...aiLabelMap }));
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
        const detail = await getProjectById(projectId, { demo: readOnly });
        if (canceled) return;

        setProject(detail);

        const detailItems = Array.isArray(detail?.images) ? detail.images : (Array.isArray(detail?.photos) ? detail.photos : (Array.isArray(detail?.gallery) ? detail.gallery : []));
        const previewItems = Array.isArray(detail?.previewImages) ? detail.previewImages : [];
        let built = buildImagesAndMetas({ images: detailItems.length ? detailItems : previewItems, photo_ids: detail?.photo_ids, photoIds: detail?.photoIds });

        if (!built.images.length) {
          let gallery = mergeUnique(
            extractImageUrls(detail?.images ?? detail?.photos ?? detail?.gallery),
            extractImageUrls(detail?.previewImages)
          );
          const random = await fetchRandomByProject(projectId, 30);
          if (canceled) return;
          const randomList = Array.isArray(random?.list) ? random.list : Array.isArray(random) ? random : [];
          gallery = mergeUnique(gallery, extractImageUrls(randomList).map(resolveAssetUrl));
          if (!gallery.length && initialProject?.images?.length) {
            gallery = mergeUnique(gallery, initialProject.images.map((it) => resolveAssetUrl(getPhotoThumbCandidate(it))));
          }
          built = buildImagesAndMetas({ images: gallery, photo_ids: detail?.photo_ids, photoIds: detail?.photoIds });
        }
        let nextImages = built.images;
        let nextMetas = built.metas;

        // Use photos embedded in project detail (preferred) instead of calling /api/photos
        try {
          const photoIds = nextMetas.map((m) => m.id).filter(Boolean);
          if (photoIds.length > 0) {
            const photosArray = Array.isArray(detail.photos) ? detail.photos : (Array.isArray(detail.images) ? detail.images : []);
            const photoMap = {};

            if (photosArray.length) {
              photosArray.forEach((p) => {
                const id = p && (p.id || p.photoId || p.photo_id);
                if (!id) return;
                const semantic = extractPhotoSemantic(p);
                photoMap[id] = {
                  tags: semantic.tags,
                  description: semantic.description,
                  aiLabel: semantic.aiLabel,
                  hasAnalysis: semantic.hasAnalysis,
                  raw: p
                };
              });
            }

            // merge/extend existing maps instead of replacing to avoid wiping data
            const tagsMapOnly = {};
            const descMapOnly = {};
            const aiLabelMapOnly = {};
            Object.keys(photoMap).forEach((id) => {
              if (photoMap[id].aiLabel) aiLabelMapOnly[id] = photoMap[id].aiLabel;
              if (!photoMap[id].hasAnalysis) return;
              tagsMapOnly[id] = photoMap[id].tags;
              descMapOnly[id] = photoMap[id].description;
            });

            setPhotoTagsMap((prev) => ({ ...(prev || {}), ...tagsMapOnly }));
            setPhotoDescMap((prev) => ({ ...(prev || {}), ...descMapOnly }));
            setPhotoAILabelMap((prev) => ({ ...(prev || {}), ...aiLabelMapOnly }));

            // 濡傛灉 detail 涓繑鍥炰簡鏇村畬鏁寸殑 photo 瀵硅薄锛屽悎骞惰繖浜涘瓧娈靛洖 photoMetas
            try {
              const photoById = {};
              photosArray.forEach(p => { const id = p && (p.id || p.photoId || p.photo_id); if (id) photoById[id] = p; });
              if (Object.keys(photoById).length) {
                const merged = (nextMetas || []).map((m) => {
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
                nextMetas = merged;
                nextImages = merged.map((m) => m.thumbSrc || m.src || resolveAssetUrl(m.url || m.fileUrl || m.imageUrl || ''));
              }
            } catch (e) {
              console.warn('merge photo urls failed', e);
            }

            // 濡傛灉閮ㄥ垎 photo meta 缂哄皯 photographerName锛屼絾鍖呭惈 photographerId锛?
            // 鍓嶇浠嶅彲鍥為€€鍘昏姹傜敤鎴蜂俊鎭苟琛ュ叏 name锛堝彲淇濈暀浠ユ彁鍗囦綋楠岋級銆?
            try {
              const mergedList = (nextMetas || []).map(m => ({ ...(m || {}) }));
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
                  nextMetas = updated;
                }
              }
            } catch (e) {
              // 蹇界暐缃戠粶閿欒锛屼笉褰卞搷涓绘祦绋?
            }
          }
        } catch (e) {
          console.warn('Failed to process photos from project detail:', e);
        }
        if (!canceled) {
          setPhotoMetas(nextMetas);
          setImages(nextImages);
        }
      } catch (err) {
        if (canceled) return;
        setError(err?.message || '鑾峰彇椤圭洰璇︽儏澶辫触');
        if (initialProject?.images?.length) {
          setImages(initialProject.images.map((it) => resolveAssetUrl(getPhotoThumbCandidate(it))));
          setPhotoMetas(initialProject.images.map((it) => (typeof it === 'string' ? { url: it } : { ...it, thumbSrc: resolveAssetUrl(getPhotoThumbCandidate(it)), originalSrc: resolveAssetUrl(getPhotoOriginalCandidate(it)) })));
        }
      } finally {
        if (!canceled) setLoading(false);
      }
    };

    load();

    return () => {
      canceled = true;
    };
  }, [projectId, initialProject, readOnly]);

  const reloadGalleryFromServer = React.useCallback(async () => {
    if (!projectId) return;
    const detail = await getProjectById(projectId, { demo: readOnly });
    setProject(detail);
    const built = buildImagesAndMetas(detail);
    setImages(built.images);
    setPhotoMetas(built.metas);
  }, [projectId, buildImagesAndMetas, readOnly]);

  const clearAnalysisPollTimer = React.useCallback((photoId) => {
    const key = String(photoId || '').trim();
    if (!key) return;
    const timer = analysisPollTimersRef.current[key];
    if (timer) {
      try { clearTimeout(timer); } catch (e) { }
    }
    delete analysisPollTimersRef.current[key];
  }, []);

  const mergePhotoAnalysisResult = React.useCallback((photo) => {
    const photoId = getPhotoRecordId(photo);
    if (!photoId) return false;
    const semantic = extractPhotoSemantic(photo);
    const normalized = normalizePhotoForGallery(photo);

    setPhotoTagsMap((prev) => ({ ...(prev || {}), [photoId]: semantic.tags }));
    setPhotoDescMap((prev) => ({ ...(prev || {}), [photoId]: semantic.description }));
    setPhotoAILabelMap((prev) => ({ ...(prev || {}), [photoId]: semantic.aiLabel }));

    if (normalized) {
      setPhotoMetas((prev) => {
        const list = Array.isArray(prev) ? prev : [];
        let changed = false;
        const next = list.map((meta) => {
          if (String(getPhotoRecordId(meta) || '') !== photoId) return meta;
          changed = true;
          return { ...(meta || {}), ...normalized.meta };
        });
        return changed ? next : list;
      });
    }

    if (semantic.hasAnalysis) {
      setPhotoAnalysisPendingMap((prev) => {
        if (!prev || !prev[photoId]) return prev || {};
        const next = { ...prev };
        delete next[photoId];
        return next;
      });
    }

    return semantic.hasAnalysis;
  }, []);

  const prependUploadedPhotos = React.useCallback((photos) => {
    const normalized = (Array.isArray(photos) ? photos : [])
      .map(normalizePhotoForGallery)
      .filter(Boolean);
    if (!normalized.length) return [];

    const patchesById = {};
    normalized.forEach(({ meta }) => {
      const photoId = getPhotoRecordId(meta);
      if (!photoId) return;
      patchesById[photoId] = meta;
      const semantic = extractPhotoSemantic(meta);
      setPhotoTagsMap((prev) => ({ ...(prev || {}), [photoId]: semantic.tags }));
      setPhotoDescMap((prev) => ({ ...(prev || {}), [photoId]: semantic.description }));
      setPhotoAILabelMap((prev) => ({ ...(prev || {}), [photoId]: semantic.aiLabel }));
    });

    const currentMetas = Array.isArray(photoMetas) ? photoMetas : [];
    const existingIds = new Set(currentMetas.map((meta) => getPhotoRecordId(meta)).filter(Boolean));
    const freshMetas = normalized
      .filter(({ meta }) => !existingIds.has(getPhotoRecordId(meta)))
      .map(({ meta }) => meta);
    const updatedExisting = currentMetas.map((meta) => {
      const photoId = getPhotoRecordId(meta);
      return photoId && patchesById[photoId] ? { ...(meta || {}), ...patchesById[photoId] } : meta;
    });
    const nextMetas = [...freshMetas, ...updatedExisting];
    setPhotoMetas(nextMetas);
    setImages(nextMetas.map((meta) => meta.thumbSrc || resolveAssetUrl(getPhotoThumbCandidate(meta))).filter(Boolean));
    return normalized.map(({ meta }) => getPhotoRecordId(meta)).filter(Boolean);
  }, [photoMetas]);

  const scheduleAnalysisPolling = React.useCallback((photoId) => {
    const key = String(photoId || '').trim();
    if (!key) return;
    clearAnalysisPollTimer(key);
    setPhotoAnalysisPendingMap((prev) => ({ ...(prev || {}), [key]: true }));

    let attempts = 0;
    const poll = async () => {
      attempts += 1;
      try {
        const photo = await getPhotoById(key);
        const ready = mergePhotoAnalysisResult(photo);
        if (ready) {
          clearAnalysisPollTimer(key);
          return;
        }
      } catch (err) {
        console.warn('[ProjectDetail] photo analysis polling failed:', key, err);
      }

      if (attempts >= ANALYSIS_POLL_MAX_ATTEMPTS) {
        clearAnalysisPollTimer(key);
        return;
      }
      analysisPollTimersRef.current[key] = setTimeout(poll, ANALYSIS_POLL_INTERVAL_MS);
    };

    analysisPollTimersRef.current[key] = setTimeout(poll, ANALYSIS_POLL_INITIAL_DELAY_MS);
  }, [clearAnalysisPollTimer, mergePhotoAnalysisResult]);

  const getPhotoSemanticState = React.useCallback((meta) => {
    const photoId = getPhotoRecordId(meta);
    const semantic = extractPhotoSemantic(meta);
    const hasMappedTags = photoId && Object.prototype.hasOwnProperty.call(photoTagsMap || {}, photoId);
    const mappedTags = hasMappedTags ? photoTagsMap[photoId] : undefined;
    const hasMappedDesc = photoId && Object.prototype.hasOwnProperty.call(photoDescMap || {}, photoId);
    const description = hasMappedDesc ? String(photoDescMap[photoId] || '').trim() : semantic.description;
    const tags = Array.isArray(mappedTags) ? mappedTags : semantic.tags;
    const hasAnalysis = Boolean(description || (Array.isArray(tags) && tags.length));
    return {
      photoId,
      description,
      tags: Array.isArray(tags) ? tags : [],
      hasAnalysis,
      pending: Boolean(photoId && photoAnalysisPendingMap[photoId] && !hasAnalysis)
    };
  }, [photoTagsMap, photoDescMap, photoAnalysisPendingMap]);

  React.useEffect(() => {
    setSearchKeyword('');
    setSearchError('');
    setSearching(false);
    searchReqSeqRef.current = 0;
    hasSearchedRef.current = false;
  }, [projectId]);

  React.useEffect(() => {
    const timer = setTimeout(async () => {
      const q = String(searchKeyword || '').trim();
      const seq = searchReqSeqRef.current + 1;
      searchReqSeqRef.current = seq;

      if (!q) {
        setSearchError('');
        if (!hasSearchedRef.current) return;
        setSearching(true);
        try {
          await reloadGalleryFromServer();
          if (searchReqSeqRef.current === seq) {
            hasSearchedRef.current = false;
          }
        } catch (err) {
          if (searchReqSeqRef.current !== seq) return;
          setSearchError('恢复全部照片失败，请重试');
        } finally {
          if (searchReqSeqRef.current === seq) setSearching(false);
        }
        return;
      }

      if (!projectId) return;
      setSearching(true);
      setSearchError('');
      try {
        const resp = await searchPhotos({
          q,
          projectId,
          page: 1,
          pageSize: 200,
          sort: 'relevance',
          demo: readOnly,
        });
        if (searchReqSeqRef.current !== seq) return;
        const list = Array.isArray(resp?.list) ? resp.list : [];
        const nextMetas = list.map((it) => {
          const thumbSrc = resolveAssetUrl(getPhotoThumbCandidate(it));
          const originalSrc = resolveAssetUrl(getPhotoOriginalCandidate(it));
          return { ...it, thumbSrc, originalSrc };
        });
        const nextImages = nextMetas.map((m) => m.thumbSrc || resolveAssetUrl(getPhotoThumbCandidate(m))).filter(Boolean);

        const tagsPatch = {};
        const descPatch = {};
        nextMetas.forEach((m) => {
          if (!m || !m.id) return;
          tagsPatch[m.id] = safeParseTags(m.tags);
          descPatch[m.id] = m.description || '';
        });
        if (Object.keys(tagsPatch).length) {
          setPhotoTagsMap((prev) => ({ ...(prev || {}), ...tagsPatch }));
        }
        if (Object.keys(descPatch).length) {
          setPhotoDescMap((prev) => ({ ...(prev || {}), ...descPatch }));
        }

        setDeleteMode(false);
        setSelectedMap({});
        setSelectedCount(0);
        setAllSelected(false);
        setImages(nextImages);
        setPhotoMetas(nextMetas);
        hasSearchedRef.current = true;
      } catch (err) {
        if (searchReqSeqRef.current !== seq) return;
        setSearchError(err?.body || err?.message || '搜索失败');
      } finally {
        if (searchReqSeqRef.current === seq) setSearching(false);
      }
    }, 260);

    return () => clearTimeout(timer);
  }, [searchKeyword, projectId, reloadGalleryFromServer, readOnly]);

  React.useEffect(() => {
    setUserPermissions(getPermissions());
  }, []);

  // ========== Upload / Edit / Selection handlers ==========
  const openUploadPicker = React.useCallback(() => {
    if (DISABLE_UPLOAD_FEATURE) {
      Toast.warning('上传功能已禁用');
      return;
    }
    if (fileInputRef.current) fileInputRef.current.click();
  }, [DISABLE_UPLOAD_FEATURE]);

  const handleFilesSelected = React.useCallback((files) => {
    if (DISABLE_UPLOAD_FEATURE) {
      Toast.warning('上传功能已禁用');
      return;
    }
    const list = Array.from(files || []);
    const previews = list.map((f) => URL.createObjectURL(f));
    setStagingFiles(list);
    setStagingPreviews(previews);
    setUploadMode(true);
  }, [DISABLE_UPLOAD_FEATURE]);

  const cancelUpload = React.useCallback(() => {
    stagingPreviews.forEach((u) => { try { URL.revokeObjectURL(u); } catch (e) { } });
    setStagingFiles([]);
    setStagingPreviews([]);
    setUploadMode(false);
    setUploading(false);
  }, [stagingPreviews]);

  const confirmUpload = React.useCallback(async () => {
    if (DISABLE_UPLOAD_FEATURE) {
      Toast.warning('上传功能已禁用');
      return;
    }
    if (!stagingFiles.length || !projectId) return;
    const filesToUpload = stagingFiles;
    setUploading(true);
    try {
      const results = await uploadPhotoFiles(filesToUpload, { projectId });

      const failed = results.filter((r) => r && r.status === 'rejected');
      const succeeded = results.filter((r) => r && r.status === 'fulfilled');

      if (succeeded.length > 0 && failed.length === 0) {
        Toast.success('上传成功');
      } else if (succeeded.length > 0 && failed.length > 0) {
        Toast.warning(`上传完成：成功 ${succeeded.length} 张，失败 ${failed.length} 张`);
      } else {
        throw (failed[0] && failed[0].error) || new Error('上传失败');
      }

      if (succeeded.length > 0) {
        const uploadedPhotos = succeeded
          .map((r) => (r && (r.response || r.photo)) || null)
          .filter((photo) => !!getPhotoRecordId(photo));
        const uploadedIds = prependUploadedPhotos(uploadedPhotos);
        uploadedIds.forEach((photoId) => scheduleAnalysisPolling(photoId));
        cancelUpload();
        // Refresh in background; don't block upload completion feedback.
        getProjectById(projectId, { demo: readOnly, includeFaces: false })
          .then((detail) => {
            setProject(detail);
            const built = buildImagesAndMetas(detail);
            setImages(built.images);
            setPhotoMetas(built.metas);
          })
          .catch(() => { /* ignore */ });
      }
    } catch (err) {
      console.error('upload error', err);
      Toast.error('上传失败');
    } finally {
      setUploading(false);
    }
  }, [stagingFiles, projectId, cancelUpload, DISABLE_UPLOAD_FEATURE, prependUploadedPhotos, scheduleAnalysisPolling, readOnly, buildImagesAndMetas]);

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
      const detail = await getProjectById(projectId, { demo: readOnly });
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
  }, [projectId, editTitle, editDescription, editEventDate, readOnly]);

  const handleDeleteProject = React.useCallback(() => {
    if (DISABLE_DELETE_FEATURE) {
      Toast.warning('删除功能已禁用');
      return;
    }
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
  }, [projectId, onBack, DISABLE_DELETE_FEATURE]);

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
    if (DISABLE_DELETE_FEATURE) {
      Toast.warning('删除功能已禁用');
      return;
    }
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
            const detail = await getProjectById(projectId, { demo: readOnly });
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
  }, [selectedMap, images, projectId, DISABLE_DELETE_FEATURE]);

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
          const cachedFaces = pid ? (viewerFaceMap && viewerFaceMap[String(pid)]) : null;
          const faceNames = extractFaceNamesFromMeta(meta, cachedFaces);
          return {
            id: pid,
            url: meta.originalSrc || meta.url || meta.thumbSrc || images[i] || null,
            thumbSrc: meta.thumbSrc || images[i] || null,
            originalSrc: meta.originalSrc || images[i] || null,
            description: (pid && photoDescMap && photoDescMap[pid]) ? photoDescMap[pid] : (meta.description || ''),
            tags: (pid && photoTagsMap && photoTagsMap[pid]) ? photoTagsMap[pid] : (safeParseTags(meta.tags) || []),
            projectTitle: srcProjectName,
            faceNames,
            personNames: faceNames,
            faces: Array.isArray(cachedFaces) ? cachedFaces : (Array.isArray(meta.faces) ? meta.faces : []),
          };
        }).filter(Boolean);
      } catch (e) {
        return [];
      }
    };
    return () => {
      try { delete window.__MAMAGE_GET_CURRENT_PROJECT_SELECTION; } catch (e) { window.__MAMAGE_GET_CURRENT_PROJECT_SELECTION = undefined; }
    };
  }, [getSelectedIndexes, photoMetas, images, project, initialProject, photoDescMap, photoTagsMap, viewerFaceMap]);

  const downloadSelectedIndividually = React.useCallback(async () => {
    const idxs = getSelectedIndexes();
    if (!idxs.length) return Toast.warning('未选择照片');
    const anchors = [];
    let prepared = 0;
    const isSameOrigin = (rawUrl) => {
      try {
        const u = new URL(String(rawUrl || ''), window.location.origin);
        return u.origin === window.location.origin;
      } catch (e) {
        return false;
      }
    };
    const inferExt = (rawUrl) => {
      try {
        const u = new URL(String(rawUrl || ''), window.location.origin);
        const m = String(u.pathname || '').match(/\.([a-zA-Z0-9]{2,6})$/);
        const ext = m && m[1] ? `.${String(m[1]).toLowerCase()}` : '.jpg';
        return ext;
      } catch (e) {
        return '.jpg';
      }
    };

    for (const i of idxs) {
      const meta = (photoMetas && photoMetas[i]) || {};
      const url = meta.originalSrc || meta.url || meta.thumbSrc || images[i];
      if (!url) continue;
      const baseName = String(meta.title || meta.name || `photo-${meta.id || i + 1}`).replace(/[\\/:*?"<>|]/g, '_').slice(0, 64) || `photo-${i + 1}`;
      try {
        const a = document.createElement('a');
        a.href = url;
        if (!isSameOrigin(url)) {
          // Cross-origin URLs may ignore `download`; open in new tab as fallback.
          a.target = '_blank';
          a.rel = 'noopener';
        }
        a.download = `${baseName}${inferExt(url)}`;
        document.body.appendChild(a);
        anchors.push(a);
        prepared += 1;
      } catch (e) {
        // ignore
      }
    }

    for (let i = 0; i < anchors.length; i += 1) {
      const a = anchors[i];
      try { a.click(); } catch (e) { }
      if (i < anchors.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 80));
      }
    }
    for (const a of anchors) {
      try { a.remove(); } catch (e) { }
    }

    if (prepared > 0) {
      if (prepared < idxs.length) {
        Toast.warning(`已触发 ${prepared}/${idxs.length} 张下载`);
      } else {
        Toast.success(`已开始下载 ${prepared} 张`);
      }
      if (prepared > 1) {
        Toast.info('若浏览器仅下载 1 张，请在浏览器设置里允许该站点“多文件下载”');
      }
    } else {
      Toast.error('下载失败');
    }
  }, [getSelectedIndexes, photoMetas, images]);




  const packDownloadSelected = React.useCallback(() => {
    const count = getSelectedIndexes().length;
    if (!count) return Toast.warning('未选择照片');
    Modal.confirm({
      title: '确认直接下载',
      content: count > 1
        ? `将直接下载 ${count} 张照片（不打包）。若浏览器拦截多文件下载，请在浏览器里允许该站点“多文件下载”。`
        : '将直接下载当前选中照片。',
      okText: '开始下载',
      cancelText: '取消',
      onOk: () => {
        downloadSelectedIndividually();
      },
    });
  }, [getSelectedIndexes, downloadSelectedIndividually]);

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

  const aiSelectionStats = React.useMemo(() => {
    const stats = { recommended: 0, medium: 0, rejected: 0, total: 0 };
    (photoMetas || []).forEach((meta) => {
      const photoId = getPhotoRecordId(meta);
      if (!photoId) return;
      const label = photoAILabelMap[photoId];
      const currentTags = Array.isArray(photoTagsMap[photoId]) ? photoTagsMap[photoId] : safeParseTags(meta.tags);
      if (label === 'recommended' || currentTags.includes('推荐')) {
        stats.recommended += 1;
      } else if (label === 'medium') {
        stats.medium += 1;
      } else if (label === 'rejected') {
        stats.rejected += 1;
      }
    });
    stats.total = stats.recommended + stats.medium + stats.rejected;
    return stats;
  }, [photoMetas, photoAILabelMap, photoTagsMap]);

  const toggleAILabels = React.useCallback(() => {
    const nextVisible = !showAILabels;
    setShowAILabels(nextVisible);
    if (!nextVisible) return;
    if (!aiSelectionStats.total) {
      Toast.info('当前相册暂无 AI 选片结果，照片分析完成后会显示推荐/不推荐标记');
      return;
    }
    Toast.info(`AI 选片：推荐 ${aiSelectionStats.recommended} 张，中等 ${aiSelectionStats.medium} 张，不推荐 ${aiSelectionStats.rejected} 张`);
  }, [showAILabels, aiSelectionStats]);

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
  const createdRaw = resolvedProject?.createdAt ?? resolvedProject?.created_at ?? null;
  const updatedRaw = resolvedProject?.updatedAt ?? resolvedProject?.updated_at ?? resolvedProject?.modifiedAt ?? resolvedProject?.modified_at ?? null;
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
  const updatedText = formatToMinute(updatedRaw);
  const count = resolvedProject?.photoCount ?? resolvedProject?.count ?? images.length;
  const masonryColumns = React.useMemo(() => {
    const w = galleryWidth || 0;
    if (!w) return 3;
    if (w <= 768) return 2;
    // Force desktop to at least 4 columns so it won't fall back to 3 too early.
    if (w <= 1200) return 4;
    return Math.max(4, Math.floor((w + 12) / (240 + 12)));
  }, [galleryWidth]);

  React.useEffect(() => {
    setGalleryRenderLimit(GALLERY_INITIAL_RENDER_LIMIT);
  }, [projectId, searchKeyword]);

  const visiblePhotoCount = Math.min(images.length, Math.max(GALLERY_INITIAL_RENDER_LIMIT, galleryRenderLimit));
  const visibleImages = React.useMemo(
    () => images.slice(0, visiblePhotoCount),
    [images, visiblePhotoCount]
  );
  const hasMoreGalleryPhotos = visiblePhotoCount < images.length;
  const searchKeywordTrimmed = String(searchKeyword || '').trim();
  const detailSearchVisible = Boolean(searchOpen || searching || searchError || searchKeywordTrimmed);
  const compactCountText = hasMoreGalleryPhotos
    ? `${count} 张，已显示 ${visiblePhotoCount}`
    : `${count} 张照片`;
  React.useEffect(() => {
    if (typeof onProjectHeaderChange !== 'function') return;
    onProjectHeaderChange({
      id: projectId,
      title,
      subtitle,
      description,
      count,
      createdText,
      updatedText,
      tags,
    });
  }, [onProjectHeaderChange, projectId, title, subtitle, description, count, createdText, updatedText, tags]);
  React.useEffect(() => () => {
    if (typeof onProjectHeaderChange === 'function') onProjectHeaderChange(null);
  }, [onProjectHeaderChange]);
  const loadMoreGalleryPhotos = React.useCallback(() => {
    setGalleryRenderLimit((prev) => Math.min(
      images.length,
      Math.max(GALLERY_INITIAL_RENDER_LIMIT, prev + GALLERY_RENDER_BATCH_SIZE)
    ));
  }, [images.length]);

  const isGalleryPreparing = !loading && !error && visibleImages.length > 0 && !galleryPrepared;

  if (!projectId) {
    return null;
  }

  const handleImageLoad = React.useCallback((src, event) => {
    const { naturalWidth, naturalHeight } = event.target;
    if (!naturalWidth || !naturalHeight) return;
    setImageRatios((prev) => {
      if (prev[src]) return prev;
      const nextRatio = naturalWidth / naturalHeight;
      ratioCacheRef.current[src] = nextRatio;
      return { ...prev, [src]: nextRatio };
    });
  }, []);

  React.useEffect(() => {
    const list = Array.isArray(visibleImages) ? visibleImages.filter(Boolean) : [];
    if (!list.length) {
      setGalleryPrepared(true);
      return undefined;
    }

    const readMetaRatio = (meta) => {
      if (!meta || typeof meta !== 'object') return null;
      const width = Number(
        meta.width
        ?? meta.w
        ?? meta.imageWidth
        ?? meta.naturalWidth
        ?? meta.pixelWidth
      );
      const height = Number(
        meta.height
        ?? meta.h
        ?? meta.imageHeight
        ?? meta.naturalHeight
        ?? meta.pixelHeight
      );
      if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        return null;
      }
      return width / height;
    };

    const nextRatios = {};

    list.forEach((src, idx) => {
      const cachedRatio = imageRatios[src] || ratioCacheRef.current[src] || readMetaRatio(photoMetas?.[idx]);
      if (cachedRatio && Number.isFinite(cachedRatio) && cachedRatio > 0) {
        nextRatios[src] = cachedRatio;
        ratioCacheRef.current[src] = cachedRatio;
      }
    });

    if (Object.keys(nextRatios).length) {
      setImageRatios((prev) => {
        let changed = false;
        const merged = { ...prev };
        Object.keys(nextRatios).forEach((src) => {
          const ratio = nextRatios[src];
          if (!ratio || !Number.isFinite(ratio) || ratio <= 0) return;
          if (merged[src] !== ratio) {
            merged[src] = ratio;
            changed = true;
          }
        });
        return changed ? merged : prev;
      });
    }

    setGalleryPrepared(true);
    return undefined;
  }, [visibleImages, photoMetas]);

  React.useEffect(() => {
    if (!galleryPrepared || !hasMoreGalleryPhotos) return undefined;
    const target = galleryMoreRef.current;
    if (!target || typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        loadMoreGalleryPhotos();
      }
    }, { rootMargin: '700px 0px 900px 0px' });
    observer.observe(target);
    return () => observer.disconnect();
  }, [galleryPrepared, hasMoreGalleryPhotos, loadMoreGalleryPhotos]);

  React.useEffect(() => {
    setDetailImageReadyMap((prev) => {
      const next = {};
      (images || []).forEach((src, idx) => {
        const key = `${idx}|${src}`;
        if (prev[key]) next[key] = true;
      });
      return next;
    });
  }, [images]);

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

  // reset viewer original flag when opening viewer or switching slides
  React.useEffect(() => {
    if (viewerVisible) setViewerShowOriginal(false);
  }, [viewerVisible, viewerIndex]);

  const getViewerTargetSrc = React.useCallback((index, showOriginal = false) => {
    const meta = photoMetas?.[index] || {};
    if (showOriginal) return meta.originalSrc || meta.url || meta.thumbSrc || images[index] || '';
    return meta.thumbSrc || images[index] || meta.originalSrc || meta.url || '';
  }, [photoMetas, images]);

  const getMetaPhotoId = React.useCallback((meta) => {
    if (!meta) return null;
    const raw = meta.id || meta.photoId || meta.photo_id || null;
    if (raw === null || raw === undefined) return null;
    const sid = String(raw).trim();
    return sid || null;
  }, []);

  const currentViewerPhotoId = React.useMemo(() => getMetaPhotoId(photoMetas?.[viewerIndex]), [photoMetas, viewerIndex, getMetaPhotoId]);
  const currentViewerFaces = React.useMemo(() => (currentViewerPhotoId ? (viewerFaceMap[currentViewerPhotoId] || []) : []), [currentViewerPhotoId, viewerFaceMap]);
  const currentViewerFaceError = currentViewerPhotoId ? (viewerFaceErrorMap[currentViewerPhotoId] || '') : '';

  const handleViewerImageLoad = React.useCallback((photoId, e) => {
    if (!photoId || !e?.target) return;
    const width = toFiniteNumber(e.target.naturalWidth);
    const height = toFiniteNumber(e.target.naturalHeight);
    if (!width || !height) return;
    setViewerImageNaturalMap((prev) => {
      const old = prev[photoId];
      if (old && old.width === width && old.height === height) return prev;
      return { ...(prev || {}), [photoId]: { width, height } };
    });
  }, []);

  const getViewerFaceBoxStyle = React.useCallback((face, photoId) => {
    if (!face) return { display: 'none' };
    let left = toFiniteNumber(face.left);
    let top = toFiniteNumber(face.top);
    let width = toFiniteNumber(face.width);
    let height = toFiniteNumber(face.height);
    if (left === null || top === null || width === null || height === null) return { display: 'none' };

    if (face.unit !== 'ratio') {
      const fallback = viewerImageNaturalMap && photoId ? viewerImageNaturalMap[photoId] : null;
      const baseW = toFiniteNumber(face.imageWidth) || toFiniteNumber(fallback?.width);
      const baseH = toFiniteNumber(face.imageHeight) || toFiniteNumber(fallback?.height);
      if (baseW && baseH) {
        left = left / baseW;
        top = top / baseH;
        width = width / baseW;
        height = height / baseH;
      } else if (!(Math.abs(left) <= 1.05 && Math.abs(top) <= 1.05 && Math.abs(width) <= 1.2 && Math.abs(height) <= 1.2)) {
        return { display: 'none' };
      }
    }

    const l = Math.max(0, Math.min(1, left));
    const t = Math.max(0, Math.min(1, top));
    const w = Math.max(0.03, Math.min(1 - l, width));
    const h = Math.max(0.03, Math.min(1 - t, height));
    return {
      left: `${l * 100}%`,
      top: `${t * 100}%`,
      width: `${w * 100}%`,
      height: `${h * 100}%`,
    };
  }, [viewerImageNaturalMap]);

  const pickFacePersonHeroPhoto = React.useCallback((data) => {
    const related = Array.isArray(data?.relatedPhotos) ? data.relatedPhotos.filter(Boolean) : [];
    if (!related.length) return null;
    const sourceFacePhotoId = String(data?.sourceFace?.photoId || data?.sourceFace?.raw?.photoId || '').trim();
    if (sourceFacePhotoId) {
      const exact = related.find((p) => String(p?.photoId || p?.id || '').trim() === sourceFacePhotoId);
      if (exact) return exact;
    }
    const idx = Math.floor(Math.random() * related.length);
    return related[idx] || related[0] || null;
  }, []);

  const getFaceHeroImageStyle = React.useCallback((data, heroPhoto) => {
    const base = { width: '100%', height: '100%', objectFit: 'cover' };
    if (!data || !heroPhoto) return base;
    const sourceFace = data.sourceFace || null;
    if (!sourceFace) return base;
    const sourceFacePhotoId = String(sourceFace.photoId || sourceFace.raw?.photoId || '').trim();
    const heroPhotoId = String(heroPhoto.photoId || heroPhoto.id || '').trim();
    if (!sourceFacePhotoId || !heroPhotoId || sourceFacePhotoId !== heroPhotoId) return base;

    let left = toFiniteNumber(sourceFace.left);
    let top = toFiniteNumber(sourceFace.top);
    let width = toFiniteNumber(sourceFace.width);
    let height = toFiniteNumber(sourceFace.height);
    if (left === null || top === null || width === null || height === null) return base;

    if (sourceFace.unit !== 'ratio') {
      const iw = toFiniteNumber(sourceFace.imageWidth);
      const ih = toFiniteNumber(sourceFace.imageHeight);
      if (iw && ih) {
        left /= iw;
        top /= ih;
        width /= iw;
        height /= ih;
      } else {
        return base;
      }
    }

    const cx = Math.max(0, Math.min(1, left + (width / 2)));
    const cy = Math.max(0, Math.min(1, top + (height / 2)));
    // Push horizontal framing slightly outward from center:
    // right-side faces move a bit more right, left-side faces a bit more left.
    const biasedCx = Math.max(0.04, Math.min(0.96, 0.5 + ((cx - 0.5) * 1.18)));
    const faceSize = Math.max(width, height);
    // Make avatar a face close-up: smaller face box => stronger zoom.
    const targetFaceSizeInAvatar = 0.62;
    const rawScale = faceSize > 0 ? (targetFaceSizeInAvatar / faceSize) : 1;
    const zoom = Math.max(1, Math.min(3.4, rawScale));
    return {
      ...base,
      objectPosition: `${(biasedCx * 100).toFixed(2)}% ${(cy * 100).toFixed(2)}%`,
      transformOrigin: `${(biasedCx * 100).toFixed(2)}% ${(cy * 100).toFixed(2)}%`,
      transform: `scale(${zoom.toFixed(3)})`,
    };
  }, []);

  const closeFacePersonModal = React.useCallback(() => {
    setFacePersonVisible(false);
    setFacePersonLoading(false);
    setFacePersonSaving(false);
    setFacePersonError('');
    setFacePersonEditName('');
    setFacePersonHeroPhoto(null);
  }, []);

  const openFacePersonModal = React.useCallback(async (face) => {
    if (!face) return;
    const seedData = normalizeFacePerson({}, face);
    setFacePersonError('');
    setFacePersonVisible(true);
    setFacePersonData(seedData);
    setFacePersonEditName(seedData.personName || '');
    setFacePersonHeroPhoto(pickFacePersonHeroPhoto(seedData));

    if (!face.faceId && !face.personId) return;

    setFacePersonLoading(true);
    try {
      const data = await getFacePersonInfo({
        faceId: face.faceId || undefined,
        personId: face.personId || undefined,
        projectId: projectId || undefined,
      });
      const normalized = normalizeFacePerson(data, face);
      setFacePersonData(normalized);
      setFacePersonEditName(normalized.personName || '');
      setFacePersonHeroPhoto(pickFacePersonHeroPhoto(normalized));
    } catch (err) {
      console.error('getFacePersonInfo failed', err);
      setFacePersonError(err?.body || err?.message || '获取人物信息失败');
    } finally {
      setFacePersonLoading(false);
    }
  }, [pickFacePersonHeroPhoto, projectId]);

  const saveFacePersonName = React.useCallback(async () => {
    if (!facePersonData) return;
    const nextName = String(facePersonEditName || '').trim();
    if (!nextName) {
      Toast.warning('请输入人物姓名');
      return;
    }

    if (!facePersonData.personId && !facePersonData.faceId) {
      Toast.warning('缺少人物或人脸标识，无法保存');
      return;
    }

    setFacePersonSaving(true);
    setFacePersonError('');
    try {
      let data;
      if (facePersonData.personId) {
        data = await renameFacePerson({
          personId: facePersonData.personId,
          personName: nextName,
        });
      } else {
        data = await labelFacePerson({
          faceId: facePersonData.faceId,
          personName: nextName,
        });
      }

      const normalized = normalizeFacePerson(data, {
        faceId: facePersonData.faceId || '',
        personId: facePersonData.personId || '',
        personName: nextName,
      });
      const patched = {
        ...facePersonData,
        ...normalized,
        personName: nextName,
        displayName: nextName,
      };
      setFacePersonData(patched);
      setFacePersonEditName(nextName);

      setViewerFaceMap((prev) => {
        const targetFaceId = patched.faceId ? String(patched.faceId) : '';
        const targetPersonId = patched.personId ? String(patched.personId) : '';
        let changed = false;
        const nextMap = {};
        Object.keys(prev || {}).forEach((photoIdKey) => {
          const list = prev[photoIdKey];
          if (!Array.isArray(list)) {
            nextMap[photoIdKey] = list;
            return;
          }
          let listChanged = false;
          const nextList = list.map((face) => {
            const row = (face && typeof face === 'object') ? face : {};
            const rowFaceId = row.faceId || row.face_id ? String(row.faceId || row.face_id) : '';
            const rowPersonId = row.personId || row.person_id ? String(row.personId || row.person_id) : '';
            const matchedByFace = targetFaceId && rowFaceId && rowFaceId === targetFaceId;
            const matchedByPerson = !matchedByFace && targetPersonId && rowPersonId && rowPersonId === targetPersonId;
            if (!matchedByFace && !matchedByPerson) return row;
            listChanged = true;
            changed = true;
            const nextPersonId = targetPersonId || rowPersonId || '';
            return {
              ...row,
              personId: nextPersonId,
              personName: nextName,
              label: nextName || (nextPersonId ? `人物#${nextPersonId}` : row.label),
            };
          });
          nextMap[photoIdKey] = listChanged ? nextList : list;
        });
        return changed ? nextMap : prev;
      });

      Toast.success('人物姓名已更新');
    } catch (err) {
      console.error('saveFacePersonName failed', err);
      let msg = err?.message || '更新人物姓名失败';
      if (err?.body) {
        try {
          const parsed = typeof err.body === 'string' ? JSON.parse(err.body) : err.body;
          msg = parsed?.message || parsed?.error || msg;
        } catch (e) {
          msg = typeof err.body === 'string' ? err.body : msg;
        }
      }
      setFacePersonError(msg);
      Toast.error(msg);
    } finally {
      setFacePersonSaving(false);
    }
  }, [facePersonData, facePersonEditName]);

  const openRelatedFacePhoto = React.useCallback((photo) => {
    if (!photo) return;
    const targetIdRaw = photo.id || photo.photoId || photo.photo_id || '';
    const targetId = targetIdRaw ? String(targetIdRaw) : '';
    const targetProjectIdRaw = photo.projectId || photo.project_id || '';
    const targetProjectId = targetProjectIdRaw ? String(targetProjectIdRaw).trim() : '';
    const hitIdx = targetId ? (photoMetas || []).findIndex((m) => String(getMetaPhotoId(m) || '') === targetId) : -1;
    if (hitIdx >= 0) {
      closeFacePersonModal();
      setViewerEnableOpenZoom(false);
      setViewerShowOriginal(false);
      setViewerIndex(hitIdx);
      return;
    }
    if (targetProjectId && typeof window !== 'undefined') {
      closeFacePersonModal();
      try {
        const url = new URL(window.location.href);
        url.searchParams.set('projectId', targetProjectId);
        if (targetId) {
          url.searchParams.set('photoId', targetId);
        } else {
          url.searchParams.delete('photoId');
        }
        window.history.pushState({}, '', url);
        try {
          window.dispatchEvent(new PopStateEvent('popstate'));
        } catch (evtErr) {
          window.dispatchEvent(new Event('popstate'));
        }
        return;
      } catch (e) {
        // fallback below
      }
    }
    const url = photo.url || photo.thumbUrl || '';
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
  }, [photoMetas, getMetaPhotoId, closeFacePersonModal]);

  const getStoredFacesByPhotoId = React.useCallback((photoId) => {
    if (!photoId) return null;
    const sid = String(photoId);
    const meta = (photoMetas || []).find((m) => String(getMetaPhotoId(m) || '') === sid);
    if (!meta) return null;

    const faces = normalizeFaceDetections(meta);
    if (faces.length > 0) return faces;

    if (Array.isArray(meta.faces)) return [];
    const zeroCount = Number(meta.faceCount ?? meta.face_count ?? meta.facesCount ?? meta.faces_count);
    if (Number.isFinite(zeroCount) && zeroCount <= 0) return [];

    return null;
  }, [photoMetas, getMetaPhotoId]);

  const ensureViewerFacesCached = React.useCallback(async (photoId, opts = {}) => {
    if (!photoId) return { loaded: false, faces: [] };
    const sid = String(photoId);
    const silent = Boolean(opts && opts.silent);

    if (Object.prototype.hasOwnProperty.call(viewerFaceMap || {}, sid)) {
      const cached = Array.isArray(viewerFaceMap[sid]) ? viewerFaceMap[sid] : [];
      return { loaded: true, faces: cached };
    }

    const stored = getStoredFacesByPhotoId(sid);
    if (stored) {
      setViewerFaceMap((prev) => ({ ...(prev || {}), [sid]: stored }));
      setViewerFaceErrorMap((prev) => ({ ...(prev || {}), [sid]: '' }));
      return { loaded: true, faces: stored };
    }

    if (viewerFaceFetchPromiseRef.current[sid]) {
      return viewerFaceFetchPromiseRef.current[sid];
    }

    const task = (async () => {
      try {
        const payload = await getPhotoFaces(sid, { projectId: projectId || undefined });
        const fetched = normalizeFaceDetections(payload);
        setViewerFaceMap((prev) => ({ ...(prev || {}), [sid]: fetched }));
        setViewerFaceErrorMap((prev) => ({ ...(prev || {}), [sid]: '' }));
        return { loaded: true, faces: fetched };
      } catch (e) {
        if (!silent) {
          setViewerFaceErrorMap((prev) => ({ ...(prev || {}), [sid]: '人脸未识别完成，请稍后重试' }));
        }
        return { loaded: false, faces: [] };
      } finally {
        if (viewerFaceFetchPromiseRef.current[sid]) {
          delete viewerFaceFetchPromiseRef.current[sid];
        }
      }
    })();

    viewerFaceFetchPromiseRef.current[sid] = task;
    return task;
  }, [viewerFaceMap, getStoredFacesByPhotoId, projectId]);

  const handleDetectViewerFaces = React.useCallback(async () => {
    const meta = photoMetas?.[viewerIndex] || null;
    const photoId = getMetaPhotoId(meta);
    if (!photoId) {
      Toast.warning('当前照片缺少ID，无法显示人脸框');
      return;
    }

    if (Array.isArray(viewerFaceMap[photoId])) {
      if (!viewerFaceMap[photoId].length) {
        Toast.info('未检测到人脸');
        return;
      }
      setViewerFaceOverlayVisible((prev) => !prev);
      return;
    }

    const { loaded, faces } = await ensureViewerFacesCached(photoId);
    if (!loaded) {
      Toast.warning('人脸未识别完成，请稍后重试');
      return;
    }
    if (!faces.length) {
      Toast.info('未检测到人脸');
      return;
    }
    setViewerFaceOverlayVisible(true);
  }, [photoMetas, viewerIndex, getMetaPhotoId, viewerFaceMap, ensureViewerFacesCached]);

  React.useEffect(() => {
    if (!viewerVisible || !viewerFaceOverlayVisible) return;
    if (!currentViewerPhotoId) return;
    if (Array.isArray(viewerFaceMap[currentViewerPhotoId])) return;
    let active = true;
    (async () => {
      const { loaded } = await ensureViewerFacesCached(currentViewerPhotoId, { silent: true });
      if (!loaded && active) {
        setViewerFaceErrorMap((prev) => ({ ...(prev || {}), [currentViewerPhotoId]: '人脸未识别完成，请稍后重试' }));
      }
    })();
    return () => { active = false; };
  }, [viewerVisible, viewerFaceOverlayVisible, currentViewerPhotoId, viewerFaceMap, ensureViewerFacesCached]);

  React.useEffect(() => {
    if (viewerVisible) return;
    setViewerFaceOverlayVisible(false);
    closeFacePersonModal();
  }, [viewerVisible, closeFacePersonModal]);

  React.useEffect(() => {
    closeFacePersonModal();
  }, [viewerIndex, closeFacePersonModal]);

  const viewerCount = images.length || 0;
  const normalizeViewerIndex = React.useCallback((idx) => {
    if (!viewerCount) return 0;
    return (idx + viewerCount) % viewerCount;
  }, [viewerCount]);
  const prevViewerIndex = normalizeViewerIndex(viewerIndex - 1);
  const nextViewerIndex = normalizeViewerIndex(viewerIndex + 1);
  const viewerTrackStyle = React.useMemo(() => {
    if (!viewerCount) return { width: '100%', transform: 'translate3d(0, 0, 0)' };
    return {
      width: `${viewerCount * 100}%`,
      transform: `translate3d(-${(viewerIndex * 100) / viewerCount}%, 0, 0)`,
    };
  }, [viewerCount, viewerIndex]);
  const viewerSlideStyle = React.useMemo(() => (
    viewerCount ? { width: `${100 / viewerCount}%` } : { width: '100%' }
  ), [viewerCount]);

  React.useEffect(() => {
    if (!viewerVisible || !viewerCount || viewerIndex < 0) return undefined;
    const currentThumb = getViewerTargetSrc(viewerIndex, false);
    const prevThumb = getViewerTargetSrc(prevViewerIndex, false);
    const nextThumb = getViewerTargetSrc(nextViewerIndex, false);
    const currentOriginal = viewerShowOriginal ? getViewerTargetSrc(viewerIndex, true) : '';
    const candidates = [currentThumb, prevThumb, nextThumb, currentOriginal].filter(Boolean);
    const preloads = [];
    candidates.forEach((src) => {
      const img = new Image();
      img.src = src;
      if (!img.complete) {
        if (typeof img.decode === 'function') {
          img.decode().catch(() => { /* ignore */ });
        }
      }
      preloads.push(img);
    });
    return () => {
      preloads.forEach((img) => {
        img.onload = null;
        img.onerror = null;
      });
    };
  }, [viewerVisible, viewerCount, viewerIndex, prevViewerIndex, nextViewerIndex, getViewerTargetSrc, viewerShowOriginal]);

  const navigateViewer = React.useCallback((step) => {
    if (!viewerVisible || viewerCount <= 1) return;
    setViewerEnableOpenZoom(false);
    const direction = step > 0 ? 1 : -1;
    const nextIndex = normalizeViewerIndex(viewerIndex + direction);
    if (nextIndex === viewerIndex) return;
    setViewerIndex(nextIndex);
  }, [viewerVisible, viewerCount, normalizeViewerIndex, viewerIndex]);

  const openViewerAt = React.useCallback((index, immediateSrc = '') => {
    if (index < 0) return;
    const warmSrc = immediateSrc || getViewerTargetSrc(index, false);
    setViewerEnableOpenZoom(true);
    if (warmSrc) {
      const img = new Image();
      img.src = warmSrc;
    }
    setViewerIndex(index);
    setViewerShowOriginal(false);
    setViewerVisible(true);
  }, [getViewerTargetSrc]);

  const lastAutoOpenedPhotoKeyRef = React.useRef('');
  React.useEffect(() => {
    if (!initialOpenPhotoId) return;
    if (!Array.isArray(photoMetas) || !photoMetas.length) return;
    const targetPhotoId = String(initialOpenPhotoId).trim();
    if (!targetPhotoId) return;
    const key = `${String(projectId || '')}:${targetPhotoId}`;
    if (lastAutoOpenedPhotoKeyRef.current === key) return;
    const idx = photoMetas.findIndex((m) => String(getMetaPhotoId(m) || '') === targetPhotoId);
    if (idx < 0) return;
    lastAutoOpenedPhotoKeyRef.current = key;
    openViewerAt(idx, getViewerTargetSrc(idx, false));
    if (typeof onInitialOpenPhotoHandled === 'function') {
      onInitialOpenPhotoHandled(targetPhotoId);
    }
  }, [initialOpenPhotoId, photoMetas, projectId, getMetaPhotoId, openViewerAt, getViewerTargetSrc, onInitialOpenPhotoHandled]);

  const closeViewer = React.useCallback(() => {
    setViewerVisible(false);
    setViewerEnableOpenZoom(false);
    setViewerShowOriginal(false);
  }, []);

  // viewer keyboard navigation
  React.useEffect(() => {
    if (!viewerVisible) return undefined;
    const onKey = (e) => {
      if (e.key === 'ArrowRight') {
        navigateViewer(1);
      } else if (e.key === 'ArrowLeft') {
        navigateViewer(-1);
      } else if (e.key === 'Escape') {
        closeViewer();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [viewerVisible, closeViewer, navigateViewer]);

  const handleViewerPointerDown = React.useCallback((e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    viewerPointerRef.current = {
      active: true,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
    };
  }, []);

  const handleViewerPointerUp = React.useCallback((e) => {
    const state = viewerPointerRef.current;
    if (!state.active) return;
    const dx = e.clientX - state.startX;
    const dy = e.clientY - state.startY;
    viewerPointerRef.current = { active: false, pointerId: null, startX: 0, startY: 0 };
    if (Math.abs(dx) < 48 || Math.abs(dx) <= Math.abs(dy)) return;
    navigateViewer(dx < 0 ? 1 : -1);
  }, [navigateViewer]);

  const handleViewerPointerCancel = React.useCallback(() => {
    viewerPointerRef.current = { active: false, pointerId: null, startX: 0, startY: 0 };
  }, []);

  const hasPerm = React.useCallback((key) => userPermissions.includes(key) || canAny(key), [userPermissions]);
  const canUpdateProject = hasPerm('projects.update');
  const canUploadPhotos = !DISABLE_UPLOAD_FEATURE && (hasPerm('photos.upload') || hasPerm('upload.photo'));
  const canDeletePhotos = !DISABLE_DELETE_FEATURE && hasPerm('photos.delete');
  const canDeleteProject = !DISABLE_DELETE_FEATURE && hasPerm('projects.delete');
  const canEditTags = hasPerm('tags.edit');
  const canPackDownload = readOnly || hasPerm('photos.zip');
  const canEditFacePersonName = hasPerm('faces.label');

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
      getProjectById(projectId, { demo: readOnly }).then(detail => {
        setProject(detail);
        const built = buildImagesAndMetas(detail);
        setImages(built.images);
        setPhotoMetas(built.metas);
      }).catch(err => console.error('reload after photo edit failed', err));
    }
  }, [projectId, photoMetas, readOnly]);

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
        const detail = await getProjectById(projectId, { demo: readOnly });
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
  }, [viewerIndex, viewerEditTags, viewerEditDescription, projectId, photoMetas, readOnly]);

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
      const url = `/api/similarity/groups/simple?projectId=${projectId}${readOnly ? '&demo=1' : ''}`;
      const r = await fetch(url, { headers });
      const data = await r.json().catch(() => ({}));
      const groups = data && Array.isArray(data.groups) ? data.groups : [];
      setSimGroups(groups);
      const ids = Array.from(new Set((groups || []).flat()));
      if (ids.length) {
        if (readOnly) {
          const wanted = new Set(ids.map((x) => String(x)));
          const map = {};
          (photoMetas || []).forEach((m) => {
            if (!m) return;
            const pid = m.id || m.photoId || m.photo_id;
            const sid = pid !== undefined && pid !== null ? String(pid) : '';
            if (!sid || !wanted.has(sid)) return;
            map[sid] = {
              id: sid,
              title: m.title || m.name || `#${sid}`,
              thumbUrl: m.thumbSrc || m.thumbUrl || m.thumbnail || m.thumb || m.url || '',
              url: m.originalSrc || m.url || m.thumbSrc || '',
              projectId,
            };
          });
          setSimPhotos(map);
        } else {
          const metas = await Promise.all(ids.map(id => fetch(`/api/photos/${id}`, { headers }).then(rr => rr.ok ? rr.json() : null).catch(() => null)));
          const map = {};
          ids.forEach((id, i) => { if (metas[i]) map[id] = metas[i]; });
          setSimPhotos(map);
        }
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
  }, [projectId, simGroups, readOnly, photoMetas]);

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
    if (DISABLE_DELETE_FEATURE) {
      Toast.warning('删除功能已禁用');
      return;
    }
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
  }, [simSelectedMap, deletePhotos, photoMetas, setPhotoMetas, DISABLE_DELETE_FEATURE]);

  // 鎺ㄨ崘鏍囪锛氭坊鍔?鎺ㄨ崘"鏍囩
  const addRecommendationTag = React.useCallback(async () => {
    if (viewerIndex < 0 || !photoMetas || !photoMetas[viewerIndex]) return;

    const currentMeta = photoMetas[viewerIndex];
    const photoId = getPhotoRecordId(currentMeta);
    if (!photoId) {
      Toast.warning('无法获取照片 ID');
      return;
    }

    // 检查是否已有“推荐”标签
    const currentTags = photoTagsMap[photoId] || [];
    if (currentTags.includes('推荐')) {
      Toast.warning('该照片已有“推荐”标签');
      return;
    }

    try {
      const token = getToken();
      if (!token) {
        Toast.error('未登录，请先登录');
        return;
      }

      // 添加“推荐”标签到现有标签
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

  const masonryBuckets = React.useMemo(() => {
    const cols = Math.max(1, masonryColumns);
    const buckets = Array.from({ length: cols }, () => ({ h: 0, items: [] }));
    visibleImages.forEach((src, idx) => {
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
  }, [visibleImages, imageRatios, masonryColumns]);

  const getRippleStyle = React.useCallback((index) => {
    void index;
    return undefined;
  }, []);

  const buildTransferItem = React.useCallback((index) => {
    const meta = (photoMetas && photoMetas[index]) || {};
    const pid = meta.id || meta.photoId || meta.photo_id || null;
    const url = meta.originalSrc || meta.url || images[index] || '';
    const thumbSrc = meta.thumbSrc || images[index] || url;
    const description = photoDescMap[pid] || meta.description || '';
    const tags = Array.isArray(photoTagsMap[pid]) ? photoTagsMap[pid] : safeParseTags(meta.tags);
    const cachedFaces = pid ? (viewerFaceMap && viewerFaceMap[String(pid)]) : null;
    const faceNames = extractFaceNamesFromMeta(meta, cachedFaces);
    return {
      id: pid || url,
      url,
      thumbSrc,
      description,
      tags: Array.isArray(tags) ? tags : [],
      projectTitle: title || '',
      faceNames,
      personNames: faceNames,
      faces: Array.isArray(cachedFaces) ? cachedFaces : (Array.isArray(meta.faces) ? meta.faces : []),
    };
  }, [photoMetas, images, photoDescMap, photoTagsMap, title, viewerFaceMap]);

  const getDragSelectionIndexes = React.useCallback((index) => {
    const key = String(index);
    const isDraggedPhotoSelected = !!(selectedMap && selectedMap[key]);
    if (!isDraggedPhotoSelected) return [index];
    return Object.keys(selectedMap || {})
      .map((k) => Number(k))
      .filter((i) => Number.isInteger(i) && i >= 0 && i < images.length && !!selectedMap[String(i)])
      .sort((a, b) => a - b);
  }, [selectedMap, images.length]);

  const handlePhotoDragStart = React.useCallback((e, index) => {
    try {
      const dragIndexes = getDragSelectionIndexes(index);
      const items = dragIndexes.map((i) => buildTransferItem(i)).filter((it) => !!it && !!it.url);
      const payload = items.length <= 1 ? (items[0] || buildTransferItem(index)) : items;
      const lead = Array.isArray(payload) ? payload[0] : payload;
      const count = Array.isArray(payload) ? payload.length : 1;

      e.dataTransfer.effectAllowed = 'copy';
      e.dataTransfer.setData('application/x-mamage-photo', JSON.stringify(payload));
      e.dataTransfer.setData('application/json', JSON.stringify(payload));
      e.dataTransfer.setData('text/plain', Array.isArray(payload) ? payload.map((it) => it.url || '').filter(Boolean).join('\n') : (payload.url || ''));

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
      preview.style.position = 'relative';

      const img = document.createElement('img');
      img.src = lead.thumbSrc || lead.url || '';
      img.style.width = '100%';
      img.style.height = '100%';
      img.style.objectFit = 'cover';
      img.draggable = false;
      preview.appendChild(img);

      if (count > 1) {
        const badge = document.createElement('div');
        badge.textContent = `${count}`;
        badge.style.position = 'absolute';
        badge.style.right = '8px';
        badge.style.bottom = '8px';
        badge.style.minWidth = '28px';
        badge.style.height = '28px';
        badge.style.padding = '0 8px';
        badge.style.borderRadius = '14px';
        badge.style.display = 'flex';
        badge.style.alignItems = 'center';
        badge.style.justifyContent = 'center';
        badge.style.background = 'rgba(15, 23, 42, 0.9)';
        badge.style.color = '#fff';
        badge.style.fontSize = '12px';
        badge.style.fontWeight = '700';
        badge.style.boxShadow = '0 4px 10px rgba(0,0,0,0.3)';
        preview.appendChild(badge);
      }

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
  }, [buildTransferItem, getDragSelectionIndexes]);

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

  const renderPhotoItem = React.useCallback((src, overallIndex) => {
    const readyKey = `${overallIndex}|${src}`;
    const isReady = !!detailImageReadyMap[readyKey];
    const ratio = imageRatios[src] || 1.5;
    const meta = photoMetas?.[overallIndex] || {};
    const semanticState = getPhotoSemanticState(meta);
    const rippleStyle = getRippleStyle(overallIndex) || {};
    const itemStyle = galleryMode === 'grid'
      ? { ...rippleStyle, aspectRatio: '1 / 1' }
      : rippleStyle;
    return (
    <div className="detail-photo-item" key={overallIndex} style={itemStyle}>
      <div className="detail-photo">
        <div style={{ position: 'relative' }}>
          <img
            src={src}
            alt={`${title}-${overallIndex}`}
            loading="lazy"
            decoding="async"
            className={`detail-photo-img${isReady ? ' is-ready' : ''}`}
            draggable
            onDragStart={(e) => handlePhotoDragStart(e, overallIndex)}
            onDragEnd={handlePhotoDragEnd}
            onLoad={(event) => {
              handleImageLoad(src, event);
              setDetailImageReadyMap((prev) => (prev[readyKey] ? prev : { ...prev, [readyKey]: true }));
            }}
            style={{ display: 'block', cursor: deleteMode ? 'pointer' : 'zoom-in', aspectRatio: galleryMode === 'masonry' ? `${ratio}` : undefined }}
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
            onClick={(e) => {
              if (deleteMode) {
                toggleSelect(overallIndex);
              } else if (overallIndex >= 0) {
                openViewerAt(overallIndex, e.currentTarget.currentSrc || e.currentTarget.src || images[overallIndex] || '');
              }
            }}
          />
          {(() => {
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
          {semanticState.pending && !deleteMode && (
            <div className="detail-analysis-badge">
              <span className="detail-analysis-dot" />
              分析中
            </div>
          )}
          {deleteMode && (
            <div style={{ position: 'absolute', right: 8, top: 8, width: 32, height: 32, borderRadius: 16, background: selectedMap[String(overallIndex)] ? '#ff5252' : 'rgba(0,0,0,0.45)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }} onClick={(e) => { e.stopPropagation(); toggleSelect(overallIndex); }}>
              {selectedMap[String(overallIndex)] ? '✓' : ''}
            </div>
          )}
          {hoveredPhotoIdx === overallIndex && !deleteMode && (
            <div className="detail-tag-overlay">
              {(() => {
                const tags = semanticState.tags;
                return tags && tags.length > 0 ? (
                  <div className="detail-tag-strip">
                    {tags.slice(0, 5).map((tag, i) => (
                      <span key={i} className="detail-tag-chip">{tag}</span>
                    ))}
                  </div>
                ) : <span className="detail-tag-empty">{semanticState.pending ? '分析中' : '暂无标签'}</span>;
              })()}
            </div>
          )}
          {showAILabels && photoAILabelMap[photoMetas?.[overallIndex]?.id] && (() => {
            const label = photoAILabelMap[photoMetas?.[overallIndex]?.id];
            return (
              <div style={{ position: 'absolute', right: 8, top: 8, background: getAISelectionColor(label), color: '#fff', padding: '4px 8px', borderRadius: '3px', fontSize: '12px', fontWeight: 'bold', pointerEvents: 'none' }}>
                {getAISelectionLabel(label)}
              </div>
            );
          })()}
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
    );
  }, [title, handlePhotoDragStart, handleImageLoad, deleteMode, photoMetas, images, hoveredPhotoIdx, photoTagsMap, showAILabels, photoAILabelMap, selectedMap, toggleSelect, project, initialProject, getRippleStyle, openViewerAt, detailImageReadyMap, imageRatios, galleryMode, getPhotoSemanticState]);

  return (
    <div className="detail-page">
      {canUploadPhotos ? (
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
      ) : null}

      {detailSearchVisible ? (
        <div className="detail-header detail-header--search-only">
          <div className="detail-header-inner">
            <div className="detail-search-row">
              <Input
                className="detail-search-input"
                value={searchKeyword}
                onChange={(v) => setSearchKeyword(v)}
                placeholder="搜索照片 / 标签 / 摄影师"
                prefix={<IconSearch />}
                showClear
              />
              <div className="detail-search-status">
                {searching ? <Text type="tertiary">搜索中</Text> : null}
                {searchKeywordTrimmed ? (
                  <Text type="tertiary">{`${images.length} 张`}</Text>
                ) : null}
              </div>
              <Button
                className="detail-search-close"
                icon={<IconClose />}
                theme="borderless"
                onClick={() => {
                  if (searchKeywordTrimmed) setSearchKeyword('');
                  setSearchOpen(false);
                }}
                aria-label="收起搜索"
                title="收起搜索"
              />
            </div>
            {searchError ? (
              <Text type="danger" className="detail-search-error">{searchError}</Text>
            ) : null}
          </div>
        </div>
      ) : null}

      <button
        type="button"
        className={`detail-actions-fab${actionSheetOpen ? ' is-open' : ''}`}
        onClick={() => setActionSheetOpen(true)}
        aria-label="打开相册操作"
      >
        <IconMoreStroked />
        <span>操作</span>
      </button>

      {actionSheetOpen ? (
        <button
          type="button"
          className="detail-actions-backdrop"
          onClick={() => setActionSheetOpen(false)}
          aria-label="关闭相册操作"
        />
      ) : null}

      <div className={`detail-actions-sheet${actionSheetOpen ? ' is-open' : ''}`} role="dialog" aria-modal="true" aria-hidden={!actionSheetOpen}>
        <div className="detail-actions-grip" />
        <div className="detail-actions-head">
          <div>
            <div className="detail-actions-title">相册操作</div>
            <div className="detail-actions-subtitle">{compactCountText}</div>
          </div>
          <Button
            className="detail-sheet-close"
            icon={<IconClose />}
            theme="borderless"
            onClick={() => setActionSheetOpen(false)}
            aria-label="关闭"
          />
        </div>

        <div className="detail-actions-grid">
          {canUploadPhotos ? (
            <Button
              className={`detail-action-tile detail-action-tile--upload${dragActive ? ' is-drag-active' : ''}${uploadHover ? ' is-hovered' : ''}`}
              theme="borderless"
              onClick={() => {
                setActionSheetOpen(false);
                openUploadPicker();
              }}
              onMouseEnter={() => setUploadHover(true)}
              onMouseLeave={() => setUploadHover(false)}
              onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
              onDragEnter={(e) => { e.preventDefault(); setDragActive(true); }}
              onDragLeave={(e) => { e.preventDefault(); setDragActive(false); }}
              onDrop={(e) => {
                e.preventDefault();
                setDragActive(false);
                setActionSheetOpen(false);
                if (e.dataTransfer && e.dataTransfer.files) handleFilesSelected(e.dataTransfer.files);
              }}
              aria-label="补充照片"
            >
              <span className="detail-action-icon" aria-hidden="true"><IconCloudUploadStroked /></span>
              <span className="detail-action-copy">
                <span className="detail-action-title">补充照片</span>
                <span className="detail-action-desc">{stagingFiles && stagingFiles.length > 0 ? `${stagingFiles.length} 张待上传` : '点击或拖入图片'}</span>
              </span>
            </Button>
          ) : null}

          <Button
            className="detail-action-tile"
            theme="borderless"
            onClick={() => {
              handleGalleryModeChange(galleryMode === 'grid' ? 'masonry' : 'grid');
              setActionSheetOpen(false);
            }}
            aria-label="切换照片布局"
          >
            <span className="detail-action-icon" aria-hidden="true">{galleryMode === 'grid' ? <IconListView /> : <IconGridView />}</span>
            <span className="detail-action-copy">
              <span className="detail-action-title">{galleryMode === 'grid' ? '瀑布流' : '网格'}</span>
              <span className="detail-action-desc">切换排列</span>
            </span>
          </Button>

          <Button
            className={`detail-action-tile${showAILabels ? ' is-active' : ''}`}
            theme="borderless"
            onClick={() => {
              toggleAILabels();
              setActionSheetOpen(false);
            }}
            aria-label="AI 选片"
          >
            <span className="detail-action-icon" aria-hidden="true"><IconAIStrokedLevel1 /></span>
            <span className="detail-action-copy">
              <span className="detail-action-title">AI 选片</span>
              <span className="detail-action-desc">{aiSelectionStats.total ? `推荐 ${aiSelectionStats.recommended} / 中等 ${aiSelectionStats.medium} / 不推荐 ${aiSelectionStats.rejected}` : '等待分析结果'}</span>
            </span>
          </Button>

          <Button
            className="detail-action-tile"
            theme="borderless"
            onClick={() => {
              setActionSheetOpen(false);
              openSimilarityModal();
            }}
            aria-label="查看相似照片"
          >
            <span className="detail-action-icon" aria-hidden="true"><IconMoreStroked /></span>
            <span className="detail-action-copy">
              <span className="detail-action-title">相似照片</span>
              <span className="detail-action-desc">成组查看</span>
            </span>
          </Button>

          <Button
            className={`detail-action-tile${detailSearchVisible ? ' is-active' : ''}`}
            theme="borderless"
            onClick={() => {
              setSearchOpen(true);
              setActionSheetOpen(false);
            }}
            aria-label="搜索照片"
          >
            <span className="detail-action-icon" aria-hidden="true"><IconSearch /></span>
            <span className="detail-action-copy">
              <span className="detail-action-title">搜索</span>
              <span className="detail-action-desc">{searchKeywordTrimmed ? `${images.length} 张结果` : '照片/标签/人'}</span>
            </span>
          </Button>

          <IfCan perms={['projects.update']}>
            <Button
              className="detail-action-tile"
              theme="borderless"
              onClick={() => {
                setActionSheetOpen(false);
                openEdit();
              }}
              aria-label="修改相册信息"
            >
              <span className="detail-action-icon" aria-hidden="true"><IconEditStroked /></span>
              <span className="detail-action-copy">
                <span className="detail-action-title">修改信息</span>
                <span className="detail-action-desc">标题/日期/标签</span>
              </span>
            </Button>
          </IfCan>
        </div>

        {(description || (tags && tags.length > 0) || startText || createdText || date) ? (
          <div className="detail-actions-info">
            {(startText || createdText || date) ? (
              <div className="detail-actions-info-row">
                {startText ? <span>开始 {startText}</span> : null}
                {createdText ? <span>创建 {createdText}</span> : null}
                {!startText && !createdText && date ? <span>{date}</span> : null}
              </div>
            ) : null}
            {description ? <p>{description}</p> : null}
            {tags && tags.length > 0 ? (
              <div className="detail-actions-tags">
                {tags.map((t, idx) => (
                  <Tag key={idx} size="small" type="light" color="grey">
                    {t}
                  </Tag>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <div
        className={`detail-gallery ${galleryMode === 'masonry' ? 'detail-gallery--masonry' : 'detail-gallery--grid'} ${isGalleryPreparing ? 'is-preparing' : ''}`}
        ref={galleryRef}
      >
        {loading && (
          <div className="detail-loading-state">
            <div className="detail-loading-mark" />
            <div className="detail-loading-title">正在加载相册</div>
            <div className="detail-loading-subtitle">照片马上出现</div>
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

        {isGalleryPreparing && (
          galleryMode === 'masonry' ? (
            <div className="detail-masonry-columns detail-masonry-columns--placeholder" style={{ '--masonry-cols': masonryColumns }}>
              {masonryBuckets.map((bucket, colIdx) => (
                <div className="detail-masonry-column" key={`masonry-placeholder-col-${colIdx}`}>
                  {bucket.map(({ src, idx }) => (
                    <div className="detail-photo-item detail-photo-item--skeleton" key={`masonry-placeholder-${idx}`}>
                      <div className="detail-photo detail-photo--skeleton" style={{ aspectRatio: `${imageRatios[src] || 1.5}` }} />
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ) : (
            visibleImages.map((src, idx) => (
              <div className="detail-photo-item detail-photo-item--skeleton" key={`grid-placeholder-${idx}`}>
                <div className="detail-photo detail-photo--skeleton" />
              </div>
            ))
          )
        )}

        {!loading && !error && galleryPrepared && (
          galleryMode === 'masonry' ? (
            <div className="detail-masonry-columns" style={{ '--masonry-cols': masonryColumns }}>
              {masonryBuckets.map((bucket, colIdx) => (
                <div className="detail-masonry-column" key={`masonry-col-${colIdx}`}>
                  {bucket.map(({ src, idx }) => renderPhotoItem(src, idx))}
                </div>
              ))}
            </div>
          ) : (
            visibleImages.map((src, overallIndex) => renderPhotoItem(src, overallIndex))
          )
        )}
        {!loading && !error && galleryPrepared && hasMoreGalleryPhotos ? (
          <div className="detail-gallery-more" ref={galleryMoreRef}>
            <Button type="tertiary" onClick={loadMoreGalleryPhotos}>
              加载更多照片（已显示 {visiblePhotoCount} / {images.length}）
            </Button>
          </div>
        ) : null}
        {(canDeletePhotos || canPackDownload) ? (
          <div className={`detail-selection-inline ${deleteMode ? 'is-expanded' : ''}`}>
            <button
              type="button"
              className="detail-select-fab"
              onClick={toggleDeleteMode}
            >
              {deleteMode ? '完成选择' : '选择照片'}
            </button>

            {deleteMode ? (
              <div className="detail-selection-actions">
                <Button className="detail-selection-btn detail-selection-btn--select" onClick={toggleSelectAll}>{allSelected ? '取消全选' : '全选'}</Button>
                {canPackDownload ? <Button className="detail-selection-btn detail-selection-btn--download" onClick={packDownloadSelected} type="tertiary">直接下载</Button> : null}
                {canDeletePhotos ? (
                  <PermButton className="detail-selection-btn detail-selection-btn--danger" perms={['photos.delete']} onClick={confirmDelete} type="danger" loading={deletingPhotos} disabled={deletingPhotos}>删除 ({selectedCount})</PermButton>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

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
              {canDeleteProject ? (
                <Button className="detail-edit-delete-btn" type="danger" onClick={handleDeleteProject} loading={deletingProject} disabled={deletingProject}>删除项目</Button>
              ) : null}
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
            {canDeletePhotos ? (
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
            ) : null}
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
                                    openViewerAt(findIdx, thumb || url);
                                  }, 0);
                                } else {
                                  window.open(url, '_blank');
                                }
                              }} />
                            ) : (
                              <div style={{ width: '100%', height: 120, background: '#eee' }} />
                            )}
                            {canDeletePhotos && simDeleteMode && (
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
          width={isMobile ? 'calc(100vw - 12px)' : 720}
          bodyStyle={isMobile ? { maxHeight: '68vh', overflowY: 'auto', padding: '10px 0 0' } : undefined}
          className="detail-upload-modal"
        >
          <div className="detail-upload-preview-grid">
            {stagingPreviews.map((p, i) => (
              <div key={i} className="detail-upload-preview-item">
                <img src={p} alt={`preview-${i}`} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
              </div>
            ))}
          </div>
        </Modal>

        <Modal
          title="人物信息"
          visible={facePersonVisible}
          onCancel={closeFacePersonModal}
          footer={null}
          zIndex={10050}
          width={isMobile ? 'calc(100vw - 12px)' : 760}
          bodyStyle={{ maxHeight: isMobile ? '72vh' : '70vh', overflowY: 'auto' }}
        >
          {facePersonLoading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '24px 0' }}>
              <Spin size="large" tip="加载人物信息中..." />
            </div>
          ) : null}

          {facePersonError ? (
            <div style={{ marginBottom: 12 }}>
              <Text type="danger">{facePersonError}</Text>
            </div>
          ) : null}

          {facePersonData ? (
            (() => {
              const relatedPhotos = Array.isArray(facePersonData.relatedPhotos) ? facePersonData.relatedPhotos : [];
              const heroPhoto = facePersonHeroPhoto || relatedPhotos[0] || null;
              const heroSrc = heroPhoto ? (heroPhoto.url || heroPhoto.thumbUrl || '') : '';
              const heroImgStyle = getFaceHeroImageStyle(facePersonData, heroPhoto);

              return (
                <div className="person-sheet">
                  <div className="person-sheet-hero">
                    <div className="person-sheet-avatar">
                      {heroSrc ? (
                        <img src={heroSrc} alt={facePersonData.displayName} style={heroImgStyle} />
                      ) : (
                        <div className="person-sheet-avatar-empty">无头像</div>
                      )}
                    </div>
                    <div className="person-sheet-meta">
                      <div className="person-sheet-name-row">
                        <Tag size="large" type="solid" color="blue">
                          {facePersonData.displayName}
                        </Tag>
                        {facePersonData.personId ? (
                          <Tag size="small" type="light" color="grey">人物ID: {facePersonData.personId}</Tag>
                        ) : null}
                        {facePersonData.faceId ? (
                          <Tag size="small" type="light" color="grey">人脸ID: {facePersonData.faceId}</Tag>
                        ) : null}
                      </div>

                      {facePersonData.description ? (
                        <div className="person-sheet-desc">{facePersonData.description}</div>
                      ) : null}

                      <div className="person-sheet-stats">该组织下该人物照片：{relatedPhotos.length}</div>

                      <div className="person-sheet-edit-row">
                        <Input
                          value={facePersonEditName}
                          onChange={(v) => setFacePersonEditName(v)}
                          placeholder={facePersonData.personId ? '输入人物姓名' : '输入姓名并绑定到该人脸'}
                          disabled={!canEditFacePersonName || facePersonSaving}
                          maxLength={80}
                          style={{ flex: 1 }}
                        />
                        <Button
                          theme="solid"
                          type="primary"
                          onClick={saveFacePersonName}
                          loading={facePersonSaving}
                          disabled={!canEditFacePersonName || facePersonSaving}
                        >
                          保存姓名
                        </Button>
                      </div>
                      {!canEditFacePersonName ? (
                        <Text type="tertiary" size="small">你没有人物标注权限（faces.label）</Text>
                      ) : null}
                    </div>
                  </div>

                  {relatedPhotos.length > 0 ? (
                    <div className="person-sheet-grid">
                      {relatedPhotos.map((item, idx) => {
                        const thumb = item.thumbUrl || item.url || '';
                        const titleText = item.title || `照片 ${idx + 1}`;
                        const albumLabel = item.projectName || (item.projectId ? `相册 #${item.projectId}` : '原图');
                        return (
                          <article className="person-sheet-card" key={`${item.id || 'face-photo'}-${idx}`}>
                            <button
                              type="button"
                              className="person-sheet-thumb-btn"
                              onClick={() => openRelatedFacePhoto(item)}
                              title="点击预览照片"
                            >
                              {thumb ? (
                                <img
                                  src={thumb}
                                  alt={titleText}
                                  className="person-sheet-thumb"
                                />
                              ) : (
                                <div className="person-sheet-thumb person-sheet-thumb-empty">无图</div>
                              )}
                            </button>

                            <div className="person-sheet-card-body">
                              <div className="person-sheet-card-title" title={titleText}>{titleText}</div>
                              <button
                                type="button"
                                className="person-sheet-album-link"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (!item.projectId || typeof window === 'undefined') return;
                                  const target = `/?projectId=${encodeURIComponent(String(item.projectId))}`;
                                  window.open(target, '_blank', 'noopener,noreferrer');
                                }}
                                title="跳转相册"
                              >
                                {albumLabel}
                              </button>
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  ) : (
                    <Empty description="暂无关联照片" />
                  )}
                </div>
              );
            })()
          ) : null}
        </Modal>

        {/* Image viewer overlay (no container) */}
        {viewerVisible ? (
        <div className="viewer-overlay is-open" onClick={closeViewer} aria-hidden="false">
            <div className="viewer-wrap">
              <button
                type="button"
                className="viewer-close-btn"
                aria-label="关闭"
                onClick={(e) => { e.stopPropagation(); closeViewer(); }}
              >
                ×
              </button>
              <button
                className="viewer-nav viewer-nav-left"
                onClick={(e) => { e.stopPropagation(); navigateViewer(-1); }}
                aria-label="上一张"
              />

              <div
                className="viewer-img-wrap"
                style={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}
                onPointerDown={handleViewerPointerDown}
                onPointerUp={handleViewerPointerUp}
                onPointerCancel={handleViewerPointerCancel}
              >
                {photoMetas && photoMetas[viewerIndex] ? (
                  <>
                    <div className="viewer-img-stage" onClick={(e) => e.stopPropagation()}>
                      <div className="viewer-carousel" style={viewerTrackStyle}>
                        {images.map((_, idx) => {
                          const slideSrc = idx === viewerIndex && viewerShowOriginal
                            ? getViewerTargetSrc(idx, true)
                            : getViewerTargetSrc(idx, false);
                          const slideMeta = photoMetas?.[idx] || null;
                          const slidePhotoId = getMetaPhotoId(slideMeta);
                          const slideFaces = slidePhotoId ? (viewerFaceMap[slidePhotoId] || []) : [];
                          const showFaceBoxes = idx === viewerIndex && viewerFaceOverlayVisible && slideFaces.length > 0;
                          return (
                            <div className={`viewer-slide${idx === viewerIndex ? ' is-active' : ''}`} style={viewerSlideStyle} key={`viewer-slide-${idx}`}>
                              <div className="viewer-face-image-surface">
                                <img
                                  src={slideSrc}
                                  alt={`viewer-${idx}`}
                                  className={`viewer-carousel-img${idx === viewerIndex && viewerEnableOpenZoom ? ' viewer-img--open-zoom' : ''}`}
                                  onLoad={(e) => handleViewerImageLoad(slidePhotoId, e)}
                                />
                                {showFaceBoxes ? (
                                  <div className="viewer-face-layer">
                                    {slideFaces.map((face, fidx) => (
                                      <button
                                        key={`${face.faceId || 'face'}-${fidx}`}
                                        type="button"
                                        className="viewer-face-box"
                                        style={getViewerFaceBoxStyle(face, slidePhotoId)}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          openFacePersonModal(face);
                                        }}
                                        title={face.label || `人脸#${face.faceNo || (fidx + 1)}`}
                                      >
                                        <span className="viewer-face-box-label">
                                          {face.label || `人脸#${face.faceNo || (fidx + 1)}`}
                                        </span>
                                      </button>
                                    ))}
                                  </div>
                                ) : null}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
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
                        <div className="viewer-chip viewer-chip--left">
                          {label}
                        </div>
                      );
                    })()}
                    <div style={{ position: 'absolute', right: 16, bottom: 16 }}>
                      <button type="button" className="viewer-original-btn" onClick={(e) => { e.stopPropagation(); setViewerEnableOpenZoom(false); setViewerShowOriginal((v) => !v); }}>
                        {viewerShowOriginal ? '查看缩略图' : '查看原图'}
                      </button>
                    </div>
                    {showAILabels && photoAILabelMap[photoMetas[viewerIndex].id] && (() => {
                      const label = photoAILabelMap[photoMetas[viewerIndex].id];
                      return (
                        <div className={`viewer-chip ${getAISelectionChipClass(label)}`} style={{ right: 16, top: 16 }}>
                          {getAISelectionLabel(label)}
                        </div>
                      );
                    })()}
                    {(() => {
                      const pid = photoMetas[viewerIndex]?.id;
                      if (!pid) return null;
                      const hasRecommend = (photoTagsMap[pid] || []).includes('推荐');
                      if (!hasRecommend) return null;
                      const hasAI = showAILabels && photoAILabelMap[pid];
                      return (
                        <div className="viewer-chip viewer-chip--recommend" style={{ right: 16, top: hasAI ? 52 : 16 }}>
                          推荐
                        </div>
                      );
	                    })()}
	                    {(() => {
	                      const state = getPhotoSemanticState(photoMetas[viewerIndex] || {});
	                      const { description, tags, pending } = state;
	                      const hasDesc = !!description;
	                      const hasTags = tags.length > 0;
	                      if (!hasDesc && !hasTags && !pending && !viewerEditVisible) return null;
	                      return (
	                        <div
	                          className="viewer-info-card"
                          style={{
                            background: viewerEditVisible ? 'rgba(255,255,255,0.98)' : 'rgba(0,0,0,0.45)',
                            color: viewerEditVisible ? '#111' : '#fff',
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
	                              {pending && !hasDesc && !hasTags && (
	                                <div className="viewer-analysis-pending">
	                                  <span className="detail-analysis-dot" />
	                                  语义分析中
	                                </div>
	                              )}
	                              {hasDesc && (
	                                <div style={{ marginBottom: hasTags ? '8px' : 0, fontSize: '14px' }}>{description}</div>
	                              )}
	                              {hasTags && (
	                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
	                                  {tags.map((tag, i) => (
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
                    <div className="viewer-img-stage" onClick={(e) => e.stopPropagation()}>
                      <div className="viewer-carousel" style={viewerTrackStyle}>
                        {images.map((src, idx) => (
                          <div className={`viewer-slide${idx === viewerIndex ? ' is-active' : ''}`} style={viewerSlideStyle} key={`viewer-fallback-slide-${idx}`}>
                            <div className="viewer-face-image-surface">
                              <img
                                src={src}
                                alt={`viewer-${idx}`}
                                className={`viewer-carousel-img${idx === viewerIndex && viewerEnableOpenZoom ? ' viewer-img--open-zoom' : ''}`}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                ) : null}
              </div>

              <div className="viewer-action-bar">
                <button
                  type="button"
                  className="viewer-original-btn"
                  onClick={(e) => { e.stopPropagation(); downloadCurrentPhoto(); }}
                  style={{ padding: '10px 16px', minWidth: 140 }}
                >
                  下载该照片
                </button>

                {!readOnly && (photoMetas && photoMetas[viewerIndex]) && (
                  <button
                    type="button"
                    className="viewer-original-btn"
                    onClick={(e) => { e.stopPropagation(); handleDetectViewerFaces(); }}
                    style={{ padding: '10px 16px', minWidth: 120, background: '#0f766e', color: '#fff' }}
                  >
                    {viewerFaceOverlayVisible ? '隐藏人脸框' : '显示人脸框'}
                  </button>
                )}

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

                {currentViewerFaceError ? (
                  <span style={{ color: '#fecaca', fontSize: 12, maxWidth: 220, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={currentViewerFaceError}>
                    {currentViewerFaceError}
                  </span>
                ) : null}
              </div>

              <button
                className="viewer-nav viewer-nav-right"
                onClick={(e) => { e.stopPropagation(); navigateViewer(1); }}
                aria-label="下一张"
              />
            </div>
          </div>
        ) : null}

        {/* Inline viewer edit 鈥?replaced modal with inline editor under the photo */}

      </div>
    </div>
  );
}

export default ProjectDetail;
