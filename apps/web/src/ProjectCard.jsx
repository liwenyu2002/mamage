// src/ProjectCard.jsx
import React from 'react';
import { Typography, Tag } from '@douyinfe/semi-ui';
import { fetchRandomByProject } from './services/photoService';
import { resolveAssetUrl } from './services/request';
import './ProjectCard.css';

const { Text } = Typography;
const truncateText = (text, maxLength = 30) => {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '...';
};

function ProjectCard({ id, title, subtitle, date, startDate, createdAt, description, count, images = [], cover = null, thumbnails = [], onClick }) {
  const main = cover || images[0];

  // 统一解析为绝对 URL，避免上游传入 id 或相对路径导致比较/去重错误
  const resolvedMain = main ? resolveAssetUrl(main) : null;

  const [fallbackThumbs, setFallbackThumbs] = React.useState([]);
  const [coverOverride, setCoverOverride] = React.useState(null);

  // 规范化 images/thumbnails 为绝对 url（提前计算供 effect 使用）
  const normalizedImages = (Array.isArray(images) ? images : []).map((i) => resolveAssetUrl(i)).filter(Boolean);
  const normalizedThumbnails = (Array.isArray(thumbnails) ? thumbnails.map((t) => resolveAssetUrl(t)).filter(Boolean) : []);

  React.useEffect(() => {
    let canceled = false;
    // fetch fallback if thumbnails empty or fewer than 3 and project has an id
    const need = (Array.isArray(thumbnails) ? thumbnails.length : 0);
    if (id && need < 3) {
      fetchRandomByProject(id, 6).then((res) => {
        const list = Array.isArray(res?.list) ? res.list : Array.isArray(res) ? res : [];
        // prefer thumbnail fields when choosing fallback thumbs to avoid returning full-size images
        const toSrc = (it) => {
          if (!it) return null;
          if (typeof it === 'string') return it;
          return it.thumbUrl || it.thumbnail || it.thumb || it.coverUrl || it.fullUrl || it.url || it.fileUrl || null;
        };

        const srcs = list.map(toSrc).filter(Boolean).map(resolveAssetUrl);
        const existing = new Set(normalizedThumbnails);
        const filtered = srcs.filter((s) => s && s !== resolvedMain && !existing.has(s));
        if (!canceled) setFallbackThumbs(filtered.slice(0, 3));
        // if current resolvedMain is a relative path (starts with '/uploads') and
        // we got at least one absolute URL from backend, use it to override cover
        if (!canceled) {
          try {
            const isRelative = resolvedMain && resolvedMain.startsWith('/') ;
            const firstAbs = srcs.find(s => /^https?:\/\//i.test(s));
            if (isRelative && firstAbs) {
              setCoverOverride(firstAbs);
            }
          } catch (e) {}
        }
      }).catch(() => { /* ignore */ });
    }
    return () => { canceled = true; };
  }, [id, thumbnails, resolvedMain]);

  // New rule: if any provided image objects include an `id`, choose the image (thumb/url)
  // whose `id` is largest. Otherwise fallback to existing ordering.
  const pickByMaxId = () => {
    const candidates = [];

    const pushFromItem = (it) => {
      if (!it) return;
      if (typeof it === 'object') {
        const id = it.id || it.photoId || it.photo_id || null;
        const src = it.thumbUrl || it.thumbnail || it.thumb || it.url || it.fileUrl || it.imageUrl || null;
        if (id && src) {
          candidates.push({ id: Number(id), src: resolveAssetUrl(src) });
        }
      }
    };

    // check supplied thumbnails (raw prop)
    if (Array.isArray(thumbnails)) thumbnails.forEach(pushFromItem);
    // check supplied images (raw prop)
    if (Array.isArray(images)) images.forEach(pushFromItem);
    // check cover prop if it's an object
    if (cover && typeof cover === 'object') pushFromItem(cover);

    if (candidates.length === 0) return null;
    candidates.sort((a, b) => (Number(b.id) - Number(a.id)));
    return candidates[0].src || null;
  };

  const byIdCover = pickByMaxId();
  const coverDisplayed = coverOverride || byIdCover || (normalizedThumbnails && normalizedThumbnails[0]) || (fallbackThumbs && fallbackThumbs[0]) || (normalizedImages && normalizedImages[0]) || resolvedMain;

  // 合并缩略图来源：优先使用后端提供的 thumbnails，但当数量不足时
  // 追加从 fetchRandomByProject 获取的 fallbackThumbs 和 images 的后续项，去重并排除当前用于显示的封面
  const combined = [];
  const pushIfUnique = (s) => {
    if (!s) return;
    if (s === coverDisplayed) return;
    if (combined.includes(s)) return;
    combined.push(s);
  };

  // prefer thumbnails first (these should be small/thumb URLs)
  (normalizedThumbnails || []).forEach((s) => pushIfUnique(s));
  (fallbackThumbs || []).forEach((s) => pushIfUnique(s));
  (normalizedImages || []).forEach((s) => pushIfUnique(s));
  const others = combined.slice(0, 3);

  const formatDay = (d) => {
    if (!d) return null;
    try {
      const dt = typeof d === 'string' ? new Date(d) : (d instanceof Date ? d : new Date(String(d)));
      if (isNaN(dt.getTime())) {
        // fallback: try substring
        const s = String(d || '');
        return s.length >= 10 ? s.slice(0, 10) : s;
      }
      const y = dt.getFullYear();
      const m = String(dt.getMonth() + 1).padStart(2, '0');
      const day = String(dt.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    } catch (e) {
      return String(d).slice(0, 10);
    }
  };

  let dateLabel = null;
  let dateText = null;
  if (startDate) {
    dateLabel = '开展于';
    dateText = formatDay(startDate);
  } else if (createdAt) {
    dateLabel = '创建于';
    dateText = formatDay(createdAt);
  } else if (date) {
    dateLabel = '';
    dateText = formatDay(date);
  }

  // 缺省描述文案处理：空或只包含空白时显示“暂无描述”
  const descText = (description && String(description).trim()) ? truncateText(description, 40) : '暂无描述';

  return (
    <div className="project-card" onClick={onClick}>
      {/* 顶部大图 */}
      <div className="project-card__cover-image">
        {/* Prefer thumbnail for cover when available to reduce payload */}
        { coverDisplayed ? (<img src={coverDisplayed} alt={title} />) : (resolvedMain && <img src={resolvedMain} alt={title} />) }
      </div>

      {/* 中间信息行：上部为日期+数量（靠右），下部为标题/标签/描述（等宽卡片） */}
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
              {count} 件作品
            </Text>
          </div>
        </div>
        <div className="project-card__meta-left">
            <div className="project-card__meta-middle">
                <Text strong className="project-card__title">
                    {"「" + title + "」"}
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

      {/* 底部小图网格 */}
      
      {/* 占位元素：占据中间可伸展空间，保证缩略图固定在卡片底部 */}
      <div className="project-card__spacer" />

      <div className="project-card__thumb-grid">
        {others.map((src, idx) => (
          <div className="project-card__thumb" key={idx}>
            <img src={src} alt="" />
          </div>
        ))}
      </div>
    </div>
  );
}

export default ProjectCard;
