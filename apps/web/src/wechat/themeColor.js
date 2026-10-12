// src/wechat/themeColor.js
// 秀米式「主题色联动」核心（零依赖）。逆向自秀米 v5 的 tn-theme-color-mask：
//   每个可随主题变色的元素带 data-mm-theme="cssProp:role;cssProp:role"，
//   role ∈ MM_ROLES（primary/tint/softTint/shade/accent）。换主题色时，
//   由主色派生一套【协调调色板】，遍历所有 [data-mm-theme] 把对应 CSS 属性写成 palette[role]。
// 与秀米差异：秀米存「渲染色 @ 基准色」靠关系反推；我们直接存 role，派生更可控。
// 详见 ~/Documents/秀米编辑器逆向分析_2026-07-12.md。

export const MM_ROLES = ['primary', 'tint', 'softTint', 'shade', 'accent'];
// 可被主题接管的 CSS 属性（camelCase，对应 el.style[prop]）
export const MM_THEME_PROPS = ['color', 'backgroundColor', 'borderColor', 'borderTopColor', 'borderBottomColor', 'borderLeftColor', 'borderRightColor'];

// ── 颜色基础换算 ────────────────────────────────────────────────
function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }

export function hexToRgb(hex) {
  const s = String(hex || '').trim().replace(/^#/, '');
  const full = s.length === 3 ? s.split('').map((c) => c + c).join('') : s;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  return { r: parseInt(full.slice(0, 2), 16), g: parseInt(full.slice(2, 4), 16), b: parseInt(full.slice(4, 6), 16) };
}

export function rgbToHex(r, g, b) {
  const h = (n) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

// 解析任意 CSS 颜色串（#hex / rgb() / rgba()）为 {r,g,b}；解析不出返回 null
export function parseCssColor(str) {
  const s = String(str || '').trim();
  if (!s) return null;
  if (s[0] === '#') return hexToRgb(s);
  const m = s.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
  if (m) return { r: +m[1], g: +m[2], b: +m[3] };
  return null;
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b); const min = Math.min(r, g, b);
  let h = 0; const l = (max + min) / 2; const d = max - min;
  let s = 0;
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  return { h, s, l };
}

function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0; let g = 0; let b = 0;
  if (h < 60) { r = c; g = x; } else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; } else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; } else { r = c; b = x; }
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
}

// 把颜色向白色混合 ratio（0=原色 1=纯白）
function mixWhite(rgb, ratio) {
  return { r: rgb.r + (255 - rgb.r) * ratio, g: rgb.g + (255 - rgb.g) * ratio, b: rgb.b + (255 - rgb.b) * ratio };
}

// ── 由主色派生协调调色板 ────────────────────────────────────────
// primary=主色本身；tint=浅色底带(混白82%)；softTint=极浅卡片底(混白92%)；
// shade=压暗到 L≈0.30 的深色(正文字/深描边)；accent=固定色相偏移的辅助装饰色。
// 全部由同一主色派生，改一处全套联动——这是秀米"改一色全套变"的本质。
export function derivePalette(primaryHex) {
  const base = hexToRgb(primaryHex) || { r: 31, g: 78, b: 140 };
  const hsl = rgbToHsl(base.r, base.g, base.b);
  const tint = mixWhite(base, 0.82);
  const softTint = mixWhite(base, 0.92);
  // shade：保留色相/饱和度，压低明度；太浅的主色 shade 也要够深以保证正文可读
  const shade = hslToRgb(hsl.h, clamp(hsl.s * 0.9, 0.25, 1), 0.30);
  // accent：色相 +145°（近互补的暖侧），适度提亮/降饱和，避免刺眼
  const accent = hslToRgb(hsl.h + 145, clamp(hsl.s * 0.85, 0.35, 0.9), clamp(hsl.l + 0.08, 0.55, 0.82));
  const toHex = (c) => rgbToHex(c.r, c.g, c.b);
  return {
    primary: toHex(base),
    tint: toHex(tint),
    softTint: toHex(softTint),
    shade: toHex(shade),
    accent: toHex(accent),
  };
}

// ── mask 解析/应用 ──────────────────────────────────────────────
// 解析 "color:shade;backgroundColor:tint" → [{prop,role}]
export function parseThemeMask(str) {
  return String(str || '')
    .split(';')
    .map((seg) => seg.trim())
    .filter(Boolean)
    .map((seg) => {
      const i = seg.indexOf(':');
      if (i < 0) return null;
      const prop = seg.slice(0, i).trim();
      const role = seg.slice(i + 1).trim();
      if (!MM_THEME_PROPS.includes(prop) || !MM_ROLES.includes(role)) return null;
      return { prop, role };
    })
    .filter(Boolean);
}

// 就地给一个 DOM 根下所有 [data-mm-theme] 元素按调色板刷色（画布渲染用）
export function applyThemeMasksToEl(rootEl, palette) {
  if (!rootEl || !palette) return;
  const nodes = rootEl.querySelectorAll('[data-mm-theme]');
  nodes.forEach((el) => {
    parseThemeMask(el.getAttribute('data-mm-theme')).forEach(({ prop, role }) => {
      const hex = palette[role];
      if (!hex) return;
      try { el.style[prop] = hex; } catch (e) { /* 非法属性名忽略 */ }
    });
  });
}

// ── 自动标注：让"整文复现/偷样式"导入的推文变得可换色 ──────────
// 逆向秀米思路：给导入 HTML 的每个内联彩色 CSS 属性，按它与"主色"的【关系】判定 role：
//   同色系(色相接近) → 按明度分 softTint/tint/primary/shade；异色系 → accent。
//   中性色(黑/白/灰，max-min<12)一律不标——它们不该跟主题变（正文黑字、纯白底保持固定）。
// 换色时这些标注就让整篇推文一键联动，无需逐处手改。
function hueDist(a, b) { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; }

function isNeutral(rgb) { return (Math.max(rgb.r, rgb.g, rgb.b) - Math.min(rgb.r, rgb.g, rgb.b)) < 12; }

function classifyRole(rgb, primaryHsl) {
  const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
  if (hueDist(hsl.h, primaryHsl.h) > 45 && hsl.s > 0.15) return 'accent';
  if (hsl.l >= 0.80) return 'softTint';
  if (hsl.l >= 0.62) return 'tint';
  if (hsl.l <= 0.40) return 'shade';
  return 'primary';
}

// 从内联样式里挑主色：出现最多的"彩色"（非中性），按使用次数加权
function detectPrimary(colors) {
  const tally = new Map();
  colors.forEach((rgb) => {
    if (isNeutral(rgb)) return;
    const key = rgbToHex(rgb.r, rgb.g, rgb.b);
    tally.set(key, (tally.get(key) || 0) + 1);
  });
  let best = null; let bestN = 0;
  tally.forEach((n, key) => { if (n > bestN) { bestN = n; best = key; } });
  return best;
}

// 从一段/多段 HTML 里探测主色（出现最多的彩色），供导入时"采纳原文主题色"。无彩色返回 null。
export function detectThemePrimary(html) {
  if (typeof DOMParser === 'undefined') return null;
  const doc = new DOMParser().parseFromString(`<div>${String(html || '')}</div>`, 'text/html');
  const colors = [];
  [...doc.querySelectorAll('*')].forEach((el) => MM_THEME_PROPS.forEach((prop) => {
    const c = parseCssColor(el.style[prop]);
    if (c) colors.push(c);
  }));
  return detectPrimary(colors);
}

// autoTagThemeColors(html, {primary?}) → { html, primary, count }
// 不传 primary 则自动探测。给命中元素写/合并 data-mm-theme。
export function autoTagThemeColors(html, options) {
  const input = String(html == null ? '' : html);
  if (typeof DOMParser === 'undefined') return { html: input, primary: null, count: 0 };
  const opts = options || {};
  const doc = new DOMParser().parseFromString(`<div id="__mm_root__">${input}</div>`, 'text/html');
  const root = doc.getElementById('__mm_root__');
  const els = [...root.querySelectorAll('*')];
  // 先扫一遍收集颜色以探测主色
  let primary = opts.primary || null;
  if (!primary) {
    const colors = [];
    els.forEach((el) => MM_THEME_PROPS.forEach((prop) => {
      const c = parseCssColor(el.style[prop]);
      if (c) colors.push(c);
    }));
    primary = detectPrimary(colors);
  }
  if (!primary) return { html: input, primary: null, count: 0 }; // 通篇无彩色，无从换色
  const primaryRgb = hexToRgb(primary) || { r: 31, g: 78, b: 140 };
  const primaryHsl = rgbToHsl(primaryRgb.r, primaryRgb.g, primaryRgb.b);
  let count = 0;
  els.forEach((el) => {
    const existing = parseThemeMask(el.getAttribute('data-mm-theme'));
    const byProp = new Map(existing.map((m) => [m.prop, m.role]));
    MM_THEME_PROPS.forEach((prop) => {
      const c = parseCssColor(el.style[prop]);
      if (!c || isNeutral(c)) return;
      byProp.set(prop, classifyRole(c, primaryHsl));
    });
    if (byProp.size) {
      const mask = [...byProp.entries()].map(([p, r]) => `${p}:${r}`).join(';');
      el.setAttribute('data-mm-theme', mask);
      count += byProp.size;
    }
  });
  return { html: root.innerHTML, primary, count };
}

// 字符串版：给 raw HTML 应用调色板（导出/手机预览用）。浏览器走 DOMParser；
// 无 DOMParser 的 Node 自测环境原样返回（真正的应用路径都在浏览器）。
export function applyThemeMasksToHtml(html, palette) {
  const input = String(html == null ? '' : html);
  if (!palette || typeof DOMParser === 'undefined') return input;
  if (input.indexOf('data-mm-theme') < 0) return input; // 无 mask 直接跳过，省一次解析
  const doc = new DOMParser().parseFromString(`<div id="__mm_root__">${input}</div>`, 'text/html');
  const root = doc.getElementById('__mm_root__');
  applyThemeMasksToEl(root, palette);
  return root.innerHTML;
}
