import React from 'react';
import { IconGridView, IconListView } from '../ui/icons';
import { FOLDER_STYLE_EVENT, folderStyleKey, readFolderStyle, writeFolderStyle } from '../services/folderStyleStore';
import './folderStyleMenu.css';

export function useFolderStyle(userId) {
  const subscribe = React.useCallback(listener => {
    const onStorage = event => { if (!event.key || event.key === folderStyleKey(userId)) listener(); };
    window.addEventListener(FOLDER_STYLE_EVENT, listener);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(FOLDER_STYLE_EVENT, listener);
      window.removeEventListener('storage', onStorage);
    };
  }, [userId]);
  const getSnapshot = React.useCallback(() => readFolderStyle(userId), [userId]);
  const value = React.useSyncExternalStore(subscribe, getSnapshot, () => 'glass');
  return [value, React.useCallback(style => writeFolderStyle(userId, style), [userId])];
}

export default function FolderStyleMenu({ value, onChange }) {
  const name = React.useId();
  return <fieldset className="folder-style-menu">
    <legend>文件夹样式</legend>
    {[["glass", "玻璃堆叠", IconGridView], ["classic", "经典分栏", IconListView]].map(([key, label, Icon]) =>
      <label key={key} className={value === key ? 'is-selected' : ''}>
        <input type="radio" name={name} checked={value === key} onChange={() => onChange(key)} aria-label={label} />
        <Icon /><span>{label}</span>
      </label>)}
  </fieldset>;
}
