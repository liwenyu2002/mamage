// src/ProjectDetail.jsx
import React from 'react';
import { Typography, Button, Tag } from '@douyinfe/semi-ui';
import './ProjectDetail.css';

const { Title, Text } = Typography;

function ProjectDetail({ project, onBack }) {
  if (!project) return null;

  const { title, subtitle, description, date, count, images = [] } = project;

  const galleryRef = React.useRef(null);
  const [galleryWidth, setGalleryWidth] = React.useState(0);
  const [imageRatios, setImageRatios] = React.useState({});

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

  return (
    <div className="detail-page">
      {/* 顶部信息栏 */}
      <div className="detail-header">
        <div>
          <Button
            theme="borderless"
            type="tertiary"
            onClick={onBack}
            className="detail-back-btn"
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

          <div className="detail-meta">
            {date && <Text type="tertiary">{date}</Text>}
            <Text type="tertiary" style={{ marginLeft: 16 }}>
              共 {count} 张照片
            </Text>
          </div>

          {description && (
            <Text type="secondary" className="detail-desc">
              {description}
            </Text>
          )}
        </div>
      </div>

      <div className="detail-gallery" ref={galleryRef}>
        {rows.map((r, rowIndex) => (
          <div className="detail-gallery-row" key={rowIndex} style={{ height: r.height }}>
            {r.images.map((src, idx) => {
              const w = Math.round((r.ratios[idx] || 1) * r.height);
              return (
                <div
                  className="detail-photo"
                  key={`${rowIndex}-${idx}`}
                  style={{ width: w }}
                >
                  <img
                    src={src}
                    alt={`${title}-${rowIndex}-${idx}`}
                    width={w}
                    height={r.height}
                    onLoad={(event) => handleImageLoad(src, event)}
                  />
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

export default ProjectDetail;
