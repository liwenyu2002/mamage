import React from 'react';
import { IconShare } from './ui/icons';
import { cardSharingStatus, cardSharingLabel, sharingStatusText } from './utils/sharingStatus';
import './cardSharingStatus.css';

export default function CardSharingStatus({ item, type = '相册', className = '', context }) {
  const sharing = cardSharingStatus(item);
  const text = sharingStatusText(sharing);
  if (!text) return null;
  return <span className={`card-sharing-status ${className}`} aria-label={`${type}共享状态：${text}`} title={context ? `${context}\n${text}` : text}>
    <IconShare aria-hidden="true" /><span>{cardSharingLabel(sharing)}</span>
  </span>;
}
