// src/ProjectCard.jsx
import React from 'react';
import { Typography, Tag } from '@douyinfe/semi-ui';
import './ProjectCard.css';

const { Text } = Typography;
const truncateText = (text, maxLength = 30) => {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '...';
};

function ProjectCard({ title, subtitle, date, description, count, images = [], onClick }) {
  const main = images[0];
  const others = images.slice(1, 4);

  return (
    <div className="project-card" onClick={onClick}>
      {/* 顶部大图 */}
      <div className="project-card__cover-image">
        {main && <img src={main} alt={title} />}
      </div>

      {/* 中间信息行：日期 + 标题 + 标签 + 数量 */}
      <div className="project-card__meta-row">
        <div className="project-card__meta-left">
            <div className="project-card__meta-up">
                {date && (
                    <Text
                    size="small"
                    
                    className="project-card__date"
                    >
                    {date}
                    </Text>
                )}


            </div>
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
                    {truncateText(description, 20)}
                </Text>
                </div>
            </div>

        <Text size="small" className="project-card__count">
          {count} 件作品
        </Text>
      </div>

      {/* 底部小图网格 */}
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
