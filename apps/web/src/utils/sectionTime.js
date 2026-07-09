// 环节时间存 'YYYY-MM-DD HH:mm'（VARCHAR），与 datetime-local 的
// 'YYYY-MM-DDTHH:mm' 互转；旧的自由文本（如 '09:30'）解析不了则返回空串，
// 选择器置空但原值保留展示。
export function sectionTimeToInputValue(raw) {
  const m = String(raw || '').match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/);
  return m ? `${m[1]}T${m[2]}` : '';
}

export function inputValueToSectionTime(v) {
  return v ? String(v).replace('T', ' ').slice(0, 16) : '';
}
