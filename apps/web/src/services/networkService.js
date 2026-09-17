// 公网/内网入口自动选择：内网地址由后端实时上报（服务跑在 Mini 上，最清楚自己的 IP），
// 并由后端比对访问者与 Mini 的公网出口 IP 判断是否同校园网。
// 命中 → 自动跳内网入口（带 token/路径，无感）；判不准 → 留在公网（安全方向：最多慢，不会断）。
//
// 防抖设计：
// - 冷却 6h：自动跳过去若内网挂了（打不开页面），浏览器返回公网后冷却期内不再弹，避免死循环
// - 偏好优先：公网 URL 带 ?entry=public 可永久停用自动跳（内网菜单「公网入口」即此链接）
// - 手动点「内网入口」会恢复自动策略（pref=auto）
import * as authService from './authService';

const PUBLIC_ORIGIN = 'https://mamage.wenyuli.site';
const PREF_KEY = 'mamage_entry_pref'; // 'auto' | 'public'

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

export function getEntryPref() {
  try {
    const v = String(localStorage.getItem(PREF_KEY) || 'auto');
    return v === 'public' ? 'public' : 'auto';
  } catch (e) {
    return 'auto';
  }
}

export function setEntryPref(v) {
  try {
    localStorage.setItem(PREF_KEY, v === 'public' ? 'public' : 'auto');
  } catch (e) { /* ignore */ }
}

// 带 token 交接（挂 fragment，不进服务器日志）：内网页面加载时自动落库，免二次登录
export function buildLanEntryUrl(info, token, path = '/') {
  const base = `https://${info.lanIp}:${info.lanPort || 3443}`;
  const cleanPath = String(path || '/').startsWith('/') ? String(path || '/') : `/${path || ''}`;
  return token ? `${base}${cleanPath}#mamage_token=${encodeURIComponent(token)}` : `${base}${cleanPath}`;
}

export function publicEntryUrl() {
  return PUBLIC_ORIGIN;
}

// 「回公网且别再自动跳」链接：公网端识别 ?entry=public 后写入偏好并清掉参数
export function publicStayUrl() {
  return `${PUBLIC_ORIGIN}/?entry=public`;
}

// App 挂载时调用一次：自动检测仍在（后端比对公网出口判定是否校园网），但不再
// 静默整页跳转——自签证书会让不知情的用户直接撞上浏览器证书错误页。改为返回
// 入口信息，由页面内提示条让用户知情后一键切换（token/路径交接逻辑不变）。
export async function checkLanEntryOffer() {
  try {
    if (typeof window === 'undefined') return null;
    if (isLanOrigin()) return null; // 已在内网入口，绝不反向自动跳（防回弹）
    if (getEntryPref() !== 'auto') return null; // 用户已表达"留在公网"
    try {
      if (sessionStorage.getItem('mamage_lan_banner_dismissed') === '1') return null;
    } catch (e) { /* ignore */ }

    const info = await fetchLanEntry();
    if (!info || !info.visitorOnIntranet) return null;
    return info;
  } catch (e) {
    return null;
  }
}

export function dismissLanEntryOffer() {
  try { sessionStorage.setItem('mamage_lan_banner_dismissed', '1'); } catch (e) { /* ignore */ }
}
