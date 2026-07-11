import React from 'react';

function IconBase({ children, ...rest }) {
  return (
    <svg
      {...rest}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export function IconSearch(props) {
  return (
    <IconBase {...props}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-4-4" />
    </IconBase>
  );
}

export function IconClose(props) {
  return (
    <IconBase {...props}>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </IconBase>
  );
}

export function IconPlus(props) {
  return (
    <IconBase {...props}>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </IconBase>
  );
}

export function IconGridView(props) {
  return (
    <IconBase {...props}>
      <rect x="4" y="4" width="6" height="6" rx="1.5" />
      <rect x="14" y="4" width="6" height="6" rx="1.5" />
      <rect x="4" y="14" width="6" height="6" rx="1.5" />
      <rect x="14" y="14" width="6" height="6" rx="1.5" />
    </IconBase>
  );
}

export function IconListView(props) {
  return (
    <IconBase {...props}>
      <path d="M8 6h13" />
      <path d="M8 12h13" />
      <path d="M8 18h13" />
      <path d="M3 6h.01" />
      <path d="M3 12h.01" />
      <path d="M3 18h.01" />
    </IconBase>
  );
}

export function IconMoreStroked(props) {
  return (
    <IconBase {...props}>
      <circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="1" fill="currentColor" stroke="none" />
    </IconBase>
  );
}

export function IconEditStroked(props) {
  return (
    <IconBase {...props}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </IconBase>
  );
}

export function IconAIStrokedLevel1(props) {
  return (
    <IconBase {...props}>
      <path d="M12 3 13.8 8.2 19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8Z" />
      <path d="M5 15 5.8 17.2 8 18l-2.2.8L5 21l-.8-2.2L2 18l2.2-.8Z" />
      <path d="M19 3 19.6 4.4 21 5l-1.4.6L19 7l-.6-1.4L17 5l1.4-.6Z" />
    </IconBase>
  );
}

// ===== 功能面板专属图标（24 网格，描边+实心点缀） =====

// 瀑布流：错落双列
export function IconMasonryView(props) {
  return (
    <IconBase {...props}>
      <rect x="4" y="4" width="7" height="9" rx="2" />
      <rect x="4" y="16" width="7" height="4" rx="1.5" />
      <rect x="14" y="4" width="6" height="5" rx="1.5" />
      <rect x="14" y="12" width="6" height="8" rx="2" />
    </IconBase>
  );
}

// AI 选片：主星 + 实心小星
export function IconSparkleAI(props) {
  return (
    <IconBase {...props}>
      <path d="M10 4l1.7 4.3L16 10l-4.3 1.7L10 16l-1.7-4.3L4 10l4.3-1.7Z" />
      <path d="M18 13.6l.9 2.2 2.1.9-2.1.9-.9 2.2-.9-2.2-2.1-.9 2.1-.9Z" fill="currentColor" stroke="none" />
    </IconBase>
  );
}

// 相似照片：双层照片叠放 + 山形
export function IconSimilarStack(props) {
  return (
    <IconBase {...props}>
      <path d="M4 15V6.5A2.5 2.5 0 0 1 6.5 4H15" />
      <rect x="7.5" y="7.5" width="12.5" height="12.5" rx="2.5" />
      <circle cx="11.6" cy="11.4" r="1.3" fill="currentColor" stroke="none" />
      <path d="M8.5 17.5l2.8-2.8a1.4 1.4 0 0 1 2 0l4.2 4.2" />
    </IconBase>
  );
}

// 编辑时间线：竖轴节点 + 分支行
export function IconTimelineFlow(props) {
  return (
    <IconBase {...props}>
      <path d="M6.5 4v16" />
      <circle cx="6.5" cy="7" r="1.7" fill="currentColor" stroke="none" />
      <circle cx="6.5" cy="12" r="1.7" fill="currentColor" stroke="none" />
      <circle cx="6.5" cy="17" r="1.7" fill="currentColor" stroke="none" />
      <path d="M11.5 7h8" />
      <path d="M11.5 12h5.5" />
      <path d="M11.5 17h8" />
    </IconBase>
  );
}

// 下载：托盘落箭头
export function IconDownload(props) {
  return (
    <IconBase {...props}>
      <path d="M12 4v10" />
      <path d="m8 10 4 4 4-4" />
      <path d="M5 19h14" />
    </IconBase>
  );
}

// 调色：竖排滑杆
export function IconSliders(props) {
  return (
    <IconBase {...props}>
      <path d="M6 5v14" />
      <path d="M12 5v14" />
      <path d="M18 5v14" />
      <circle cx="6" cy="15" r="2.2" fill="currentColor" stroke="none" />
      <circle cx="12" cy="9" r="2.2" fill="currentColor" stroke="none" />
      <circle cx="18" cy="13" r="2.2" fill="currentColor" stroke="none" />
    </IconBase>
  );
}

// 人脸框：取景角+脸
export function IconFaceScan(props) {
  return (
    <IconBase {...props}>
      <path d="M4 8V6a2 2 0 0 1 2-2h2" />
      <path d="M16 4h2a2 2 0 0 1 2 2v2" />
      <path d="M20 16v2a2 2 0 0 1-2 2h-2" />
      <path d="M8 20H6a2 2 0 0 1-2-2v-2" />
      <circle cx="9.6" cy="10.4" r="0.6" fill="currentColor" stroke="none" />
      <circle cx="14.4" cy="10.4" r="0.6" fill="currentColor" stroke="none" />
      <path d="M9.5 14.2c.7.8 1.5 1.2 2.5 1.2s1.8-.4 2.5-1.2" />
    </IconBase>
  );
}

// 左右切换箭头
export function IconChevronLeft(props) {
  return (
    <IconBase {...props}>
      <path d="m14.5 5.5-6.5 6.5 6.5 6.5" />
    </IconBase>
  );
}

export function IconChevronRight(props) {
  return (
    <IconBase {...props}>
      <path d="m9.5 5.5 6.5 6.5-6.5 6.5" />
    </IconBase>
  );
}

// 星标：推荐
export function IconStar(props) {
  return (
    <IconBase {...props}>
      <path d="m12 4.6 2.2 4.5 4.9.7-3.6 3.5.9 4.9-4.4-2.3-4.4 2.3.9-4.9-3.6-3.5 4.9-.7Z" />
    </IconBase>
  );
}

// 垃圾桶：删除
export function IconTrash(props) {
  return (
    <IconBase {...props}>
      <path d="M4 7h16" />
      <path d="M9.5 7V5.2A1.2 1.2 0 0 1 10.7 4h2.6a1.2 1.2 0 0 1 1.2 1.2V7" />
      <path d="M6.5 7l.8 12a1.6 1.6 0 0 0 1.6 1.5h6.2a1.6 1.6 0 0 0 1.6-1.5l.8-12" />
      <path d="M10 11v5.5" />
      <path d="M14 11v5.5" />
    </IconBase>
  );
}

// 信息卡编辑：卡片 + 笔
export function IconInfoEdit(props) {
  return (
    <IconBase {...props}>
      <path d="M12.5 5H5.5A1.5 1.5 0 0 0 4 6.5v11A1.5 1.5 0 0 0 5.5 19H16a1.5 1.5 0 0 0 1.5-1.5v-4" />
      <path d="M7.5 9.5h4" />
      <path d="M7.5 13h2.5" />
      <path d="M18.2 4.3a1.9 1.9 0 0 1 2.7 2.7L14.5 13.5l-3.3.8.8-3.3Z" />
    </IconBase>
  );
}
