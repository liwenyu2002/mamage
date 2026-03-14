// src/ProjectCard.jsx
import React from 'react';
import { Typography, Tag } from '@douyinfe/semi-ui';
import { fetchRandomByProject } from './services/photoService';
import { resolveAssetUrl } from './services/request';
import './ProjectCard.css';

const { Text } = Typography;

const truncateText = (text, maxLength = 30) => {
  const safe = String(text || '');
  if (safe.length <= maxLength) return safe;
  return safe.substring(0, maxLength) + '...';
};

const sameStringList = (a, b) => {
  if (a === b) return true;
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
};

const pickThumbSrc = (item) => {
  if (!item) return null;
  if (typeof item === 'string') return item;
  return item.thumbSrc || item.thumbUrl || item.thumbnail || item.thumb || item.coverUrl || item.url || item.fileUrl || item.imageUrl || null;
};

function ProjectCard({
  id,
  title,
  subtitle,
  date,
  startDate,
  createdAt,
  description,
  count,
  images = [],
  cover = null,
  thumbnails = [],
  onClick,
}) {
  const main = cover || images[0];
  const resolvedMain = main ? resolveAssetUrl(pickThumbSrc(main) || main) : null;

  const normalizedImages = React.useMemo(() => (
    (Array.isArray(images) ? images : [])
      .map((it) => resolveAssetUrl(pickThumbSrc(it) || it))
      .filter(Boolean)
  ), [images]);
  const normalizedThumbnails = React.useMemo(() => (
    (Array.isArray(thumbnails) ? thumbnails : [])
      .map((it) => resolveAssetUrl(pickThumbSrc(it) || it))
      .filter(Boolean)
  ), [thumbnails]);

  const [fallbackThumbs, setFallbackThumbs] = React.useState([]);
  const [coverOverride, setCoverOverride] = React.useState(null);
  const [loadedMap, setLoadedMap] = React.useState({});

  React.useEffect(() => {
    let canceled = false;
    const need = normalizedThumbnails.length;
    if (id && need < 3) {
      fetchRandomByProject(id, 6)
        .then((res) => {
          if (canceled) return;
          const list = Array.isArray(res?.list) ? res.list : (Array.isArray(res) ? res : []);
          const srcs = list.map((it) => resolveAssetUrl(pickThumbSrc(it) || it)).filter(Boolean);
          const existing = new Set(normalizedThumbnails);
          const filtered = srcs.filter((s) => s && s !== resolvedMain && !existing.has(s));
          const nextFallbacks = filtered.slice(0, 3);
          setFallbackThumbs((prev) => (sameStringList(prev, nextFallbacks) ? prev : nextFallbacks));
          const firstAbs = srcs.find((s) => /^https?:\/\//i.test(s));
          const isRelativeMain = !!(resolvedMain && resolvedMain.startsWith('/'));
          if (isRelativeMain && firstAbs) {
            setCoverOverride((prev) => (prev === firstAbs ? prev : firstAbs));
          }
        })
        .catch(() => {});
    }
    return () => {
      canceled = true;
    };
  }, [id, normalizedThumbnails.length, resolvedMain]);

  const pickByMaxId = () => {
    const candidates = [];
    const pushFromItem = (it) => {
      if (!it || typeof it !== 'object') return;
      const rawId = it.id || it.photoId || it.photo_id;
      const src = pickThumbSrc(it);
      const numId = Number(rawId);
      if (!Number.isFinite(numId) || !src) return;
      candidates.push({ id: numId, src: resolveAssetUrl(src) });
    };
    if (Array.isArray(thumbnails)) thumbnails.forEach(pushFromItem);
    if (Array.isArray(images)) images.forEach(pushFromItem);
    if (cover && typeof cover === 'object') pushFromItem(cover);
    if (!candidates.length) return null;
    candidates.sort((a, b) => b.id - a.id);
    return candidates[0].src || null;
  };

  const byIdCover = pickByMaxId();
  const coverDisplayed = coverOverride
    || byIdCover
    || normalizedThumbnails[0]
    || fallbackThumbs[0]
    || normalizedImages[0]
    || resolvedMain;

  const combined = [];
  const pushIfUnique = (s) => {
    if (!s || s === coverDisplayed || combined.includes(s)) return;
    combined.push(s);
  };
  normalizedThumbnails.forEach(pushIfUnique);
  fallbackThumbs.forEach(pushIfUnique);
  normalizedImages.forEach(pushIfUnique);
  const others = combined.slice(0, 3);

  const mobileMain = coverDisplayed || resolvedMain || others[0] || null;
  const mobileSmalls = [...others.slice(0, 2)];
  if (mobileSmalls.length < 2 && mobileMain) {
    while (mobileSmalls.length < 2) mobileSmalls.push(mobileMain);
  }

  const formatDay = (d) => {
    if (!d) return null;
    try {
      const dt = typeof d === 'string' ? new Date(d) : (d instanceof Date ? d : new Date(String(d)));
      if (Number.isNaN(dt.getTime())) {
        const s = String(d || '');
        return s.length >= 10 ? s.slice(0, 10) : s;
      }
      const y = dt.getFullYear();
      const m = String(dt.getMonth() + 1).padStart(2, '0');
      const day = String(dt.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    } catch (e) {
      return String(d || '').slice(0, 10);
    }
  };

  let dateLabel = '';
  let dateText = null;
  if (startDate) {
    dateLabel = '开展于';
    dateText = formatDay(startDate);
  } else if (createdAt) {
    dateLabel = '创建于';
    dateText = formatDay(createdAt);
  } else if (date) {
    dateText = formatDay(date);
  }

  const descText = (description && String(description).trim())
    ? truncateText(description, 40)
    : '暂无描述';

  const desktopCoverSrc = coverDisplayed || resolvedMain || '';
  const markLoaded = (src) => {
    if (!src) return;
    setLoadedMap((prev) => (prev[src] ? prev : { ...prev, [src]: true }));
  };

  return (
    <div className="project-card" onClick={onClick}>
      <div className="project-card__mobile-layout">
        <div className="project-card__mobile-main">
          {mobileMain ? (
            <img
              src={mobileMain}
              alt={title}
              loading="lazy"
              decoding="async"
              className={`project-card__img ${loadedMap[mobileMain] ? 'is-ready' : ''}`}
              onLoad={() => markLoaded(mobileMain)}
            />
          ) : null}
        </div>
        <div className="project-card__mobile-side">
          <div className="project-card__mobile-small-row">
            {mobileSmalls.map((src, idx) => (
              <div className="project-card__mobile-small" key={`mobile-small-${idx}`}>
                <img
                  src={src}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className={`project-card__img ${loadedMap[src] ? 'is-ready' : ''}`}
                  onLoad={() => markLoaded(src)}
                />
              </div>
            ))}
          </div>
          <div className="project-card__mobile-info">
            <div className="project-card__mobile-meta">
              {dateText ? (
                <span className="project-card__mobile-date">{dateLabel ? `${dateLabel} ${dateText}` : dateText}</span>
              ) : null}
              <span className="project-card__mobile-count">{count} 作品</span>
            </div>
            <Text strong className="project-card__mobile-title">
              {`《${title}》`}
            </Text>
            <Text size="small" className="project-card__mobile-description">
              {descText}
            </Text>
          </div>
        </div>
      </div>

      <div className="project-card__desktop-layout">
        <div className="project-card__cover-image">
          {desktopCoverSrc ? (
            <img
              src={desktopCoverSrc}
              alt={title}
              loading="lazy"
              decoding="async"
              className={`project-card__img ${loadedMap[desktopCoverSrc] ? 'is-ready' : ''}`}
              onLoad={() => markLoaded(desktopCoverSrc)}
            />
          ) : null}
        </div>

        <div className="project-card__meta-row">
          <div className="project-card__meta-top">
            <div className="project-card__meta-top-left">
              {dateText && (
                <div className="project-card__date-pill">
                  {dateLabel ? (
                    <>
                      <span className={`project-card__date-label ${dateLabel === '开展于' ? 'start' : 'create'}`}>{dateLabel}</span>
                      <span style={{ width: 6 }} />
                      <span className="project-card__date-value">{dateText}</span>
                    </>
                  ) : (
                    <span className="project-card__date-value">{dateText}</span>
                  )}
                </div>
              )}
            </div>
            <div className="project-card__meta-top-right">
              <Text size="small" className="project-card__count">
                {count} 作品
              </Text>
            </div>
          </div>
          <div className="project-card__meta-left">
            <div className="project-card__meta-middle">
              <Text strong className="project-card__title">
                {`《${title}》`}
              </Text>

              {subtitle && (
                <Tag size="small" type="solid" className="project-card__tag">
                  {subtitle}
                </Tag>
              )}
            </div>
            <div className="project-card__meta-down">
              <Text size="small" className="project-card__description">
                {descText}
              </Text>
            </div>
          </div>
        </div>

        <div className="project-card__spacer" />

        <div className="project-card__thumb-grid">
          {others.map((src, idx) => (
            <div className="project-card__thumb" key={idx}>
              <img
                src={src}
                alt=""
                loading="lazy"
                decoding="async"
                className={`project-card__img ${loadedMap[src] ? 'is-ready' : ''}`}
                onLoad={() => markLoaded(src)}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default ProjectCard;
