// 公网/内网入口选择：内网地址由后端实时上报（服务跑在 Mini 上，最清楚自己的 IP），
// DHCP 轮换后前端拿到的永远是当下值，使用者不需要再问管理员。
const PUBLIC_ORIGIN = 'https://mamage.wenyuli.site';

export async function fetchLanEntry() {
  try {
    const r = await fetch('/api/network/lan');
    if (!r.ok) return null;
    const d = await r.json().catch(() => null);
    return d && d.ok && d.lanIp ? d : null;
  } catch (e) {
    return null;
  }
}

export function isLanOrigin() {
  try {
    const h = String(window.location.hostname || '');
    if (!h) return false;
    if (/^10\./.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
    return /\.local$/i.test(h);
  } catch (e) {
    return false;
  }
}

// 带 token 交接（挂 fragment，不进服务器日志）：内网页面加载时自动落库，免二次登录
export function buildLanEntryUrl(info, token) {
  const base = `https://${info.lanIp}:${info.lanPort || 3443}`;
  return token ? `${base}/#mamage_token=${encodeURIComponent(token)}` : `${base}/`;
}

export function publicEntryUrl() {
  return PUBLIC_ORIGIN;
}
