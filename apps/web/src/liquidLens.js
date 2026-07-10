// 苹果 Liquid Glass 边缘折射引擎。
// 位移图算法源自 shuding/liquid-glass（MIT，https://github.com/shuding/liquid-glass）：
// 圆角矩形 SDF → 逐像素位移编码进 R/G 通道 → feDisplacementMap 作用于 backdrop。
// 本移植改为沿 SDF 法线方向、振幅有界的边缘折射带，使任意尺寸的面板/胶囊
// 中心保持清晰、仅边缘产生透镜弯折；同 尺寸x圆角 的元素共享同一滤镜。
// 仅 Chromium 支持 backdrop-filter: url()；CSS 侧用 @supports 门控回退。

const LENS_SUFFIX = ' blur(1.1px) saturate(1.5) contrast(1.06) brightness(1.03)';
// 圆顶透镜剖面（对齐 shuding/liquid-glass 原版观感，按 min(w,h) 归一以适配任意尺寸）：
// 采样系数 k 从核心 1（原样）平滑降到贴边 K_MIN（向心放大），位移沿径向、
// 幅度以 MAG_CAP*min(w,h) 封顶——宽横条两端不会爆炸。
const LENS_K_MIN = 0.55; // 贴边处采样系数（越小弯折越强）
const LENS_DEPTH = 0.5; // 透镜深度 = min(w,h) * DEPTH（从边缘向内的渐变区）
const LENS_MAG_CAP = 0.45; // 最大位移 = min(w,h) * CAP

// 需要透镜化的玻璃控件层（与 liquidGlass.css @supports 富模糊列表保持一致）
const LENS_SELECTORS = [
  '.mamage-header',
  '.mamage-mobile-nav-panel',
  '.mamage-modal-content',
  '.mamage-popover-content',
  '.mamage-sidesheet-content',
  '.detail-bottom-nav',
  '.detail-bottom-upload',
  '.detail-actions-sheet',
  '.detail-selection-inline',
  '.viewer-tone-panel',
  '.detail-select-fab',
  '.detail-actions-fab',
];

function smoothStep(a, b, t) {
  const x = Math.max(0, Math.min(1, (t - a) / (b - a)));
  return x * x * (3 - 2 * x);
}

function roundedRectSDF(x, y, hw, hh, r) {
  const qx = Math.abs(x) - hw + r;
  const qy = Math.abs(y) - hh + r;
  const ox = Math.max(qx, 0);
  const oy = Math.max(qy, 0);
  return Math.min(Math.max(qx, qy), 0) + Math.sqrt(ox * ox + oy * oy) - r;
}

// 生成 w x h、圆角 r 的位移图；返回 { url, scale }
function buildDisplacementMap(w, h, r) {
  const cw = Math.max(4, Math.round(w));
  const ch = Math.max(4, Math.round(h));
  const radius = Math.max(0, Math.min(r, Math.min(cw, ch) / 2));
  const minDim = Math.min(cw, ch);
  const depth = LENS_DEPTH * minDim;
  const magCap = LENS_MAG_CAP * minDim;
  const hw = cw / 2 - 0.5;
  const hh = ch / 2 - 0.5;

  const raw = new Float32Array(cw * ch * 2);
  let maxScale = 0;
  for (let y = 0; y < ch; y += 1) {
    const py = y - ch / 2 + 0.5;
    for (let x = 0; x < cw; x += 1) {
      const px = x - cw / 2 + 0.5;
      const d = roundedRectSDF(px, py, hw, hh, radius);
      // 深度剖面：贴边 t=0 → 向内 depth 处 t=1，双重 smoothstep 缓动
      const t = Math.max(0, Math.min(1, -d / depth));
      const s1 = smoothStep(0, 1, t);
      const s2 = s1 * s1 * (3 - 2 * s1);
      const k = LENS_K_MIN + (1 - LENS_K_MIN) * s2;
      let dx = 0;
      let dy = 0;
      if (k < 0.999) {
        // 向心径向采样（圆顶放大），幅度封顶防宽条两端爆炸
        const dist = Math.sqrt(px * px + py * py) || 1;
        const mag = Math.min((1 - k) * dist, magCap);
        dx = -(px / dist) * mag;
        dy = -(py / dist) * mag;
      }
      const i = (y * cw + x) * 2;
      raw[i] = dx;
      raw[i + 1] = dy;
      const m = Math.max(Math.abs(dx), Math.abs(dy));
      if (m > maxScale) maxScale = m;
    }
  }
  if (!maxScale) maxScale = 1;

  const data = new Uint8ClampedArray(cw * ch * 4);
  for (let p = 0, i = 0; p < raw.length; p += 2, i += 4) {
    data[i] = (raw[p] / maxScale + 0.5) * 255;
    data[i + 1] = (raw[p + 1] / maxScale + 0.5) * 255;
    data[i + 2] = 0;
    data[i + 3] = 255;
  }

  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  canvas.getContext('2d').putImageData(new ImageData(data, cw, ch), 0, 0);
  return { url: canvas.toDataURL(), scale: maxScale, w: cw, h: ch };
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';

let defsHost = null;
const filterCache = new Map(); // key → filterId

function ensureDefsHost() {
  if (defsHost && defsHost.isConnected) return defsHost;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width', '0');
  svg.setAttribute('height', '0');
  svg.setAttribute('aria-hidden', 'true');
  svg.style.cssText = 'position:fixed;top:0;left:0;pointer-events:none;';
  const defs = document.createElementNS(SVG_NS, 'defs');
  svg.appendChild(defs);
  document.body.appendChild(svg);
  defsHost = defs;
  return defs;
}

function lensFilterId(w, h, r) {
  const key = `${w}x${h}x${r}`;
  if (filterCache.has(key)) return filterCache.get(key);
  const map = buildDisplacementMap(w, h, r);
  const id = `mamage-lens-${key.replace(/[^0-9x]/g, '')}`;

  const filter = document.createElementNS(SVG_NS, 'filter');
  filter.setAttribute('id', id);
  filter.setAttribute('filterUnits', 'userSpaceOnUse');
  filter.setAttribute('colorInterpolationFilters', 'sRGB');
  filter.setAttribute('x', '0');
  filter.setAttribute('y', '0');
  filter.setAttribute('width', String(map.w));
  filter.setAttribute('height', String(map.h));

  const feImage = document.createElementNS(SVG_NS, 'feImage');
  feImage.setAttribute('width', String(map.w));
  feImage.setAttribute('height', String(map.h));
  feImage.setAttribute('result', `${id}-map`);
  feImage.setAttribute('href', map.url);
  feImage.setAttributeNS(XLINK_NS, 'xlink:href', map.url);

  const feDisp = document.createElementNS(SVG_NS, 'feDisplacementMap');
  feDisp.setAttribute('in', 'SourceGraphic');
  feDisp.setAttribute('in2', `${id}-map`);
  feDisp.setAttribute('xChannelSelector', 'R');
  feDisp.setAttribute('yChannelSelector', 'G');
  feDisp.setAttribute('scale', String(map.scale));

  filter.appendChild(feImage);
  filter.appendChild(feDisp);
  ensureDefsHost().appendChild(filter);
  filterCache.set(key, id);
  return id;
}

function parseRadius(el, w, h) {
  const raw = getComputedStyle(el).borderTopLeftRadius || '0';
  let r = parseFloat(raw) || 0;
  if (raw.includes('%')) r = (r / 100) * Math.min(w, h);
  return Math.min(r, Math.min(w, h) / 2);
}

const tracked = new WeakMap(); // el → { ro, key }

function applyLens(el) {
  // offsetWidth/Height 是布局尺寸：不受开场 transform 缩放动画污染
  // （backdrop-filter 的 userSpaceOnUse 区域也是按未变换的局部坐标算的）。
  // 向上取整到 4px 桶：滤镜区域宁大勿小，偏小会硬裁玻璃边缘。
  const w = Math.ceil(el.offsetWidth / 4) * 4;
  const h = Math.ceil(el.offsetHeight / 4) * 4;
  if (w < 24 || h < 16) return;
  const r = Math.round(parseRadius(el, w, h));
  const state = tracked.get(el);
  const key = `${w}x${h}x${r}`;
  if (state && state.key === key) return;
  const id = lensFilterId(w, h, r);
  el.style.setProperty('--mamage-lens', `url(#${id})${LENS_SUFFIX}`);
  if (state) state.key = key;
}

function attach(el) {
  if (tracked.has(el)) return;
  const state = { key: '', raf: 0 };
  const ro = new ResizeObserver(() => {
    if (state.raf) return;
    state.raf = requestAnimationFrame(() => {
      state.raf = 0;
      if (el.isConnected) applyLens(el);
    });
  });
  state.ro = ro;
  tracked.set(el, state);
  ro.observe(el);
  applyLens(el);
}

function scan(root) {
  if (!(root instanceof Element)) return;
  const selector = LENS_SELECTORS.join(',');
  if (root.matches && root.matches(selector)) attach(root);
  root.querySelectorAll(selector).forEach(attach);
}

// 启动引擎；返回停止函数
export function initLiquidLens() {
  if (typeof window === 'undefined') return () => {};
  if (!CSS.supports('backdrop-filter', 'url("#x")') && !CSS.supports('-webkit-backdrop-filter', 'url("#x")')) {
    return () => {};
  }
  scan(document.body);
  const mo = new MutationObserver((mutations) => {
    mutations.forEach((m) => m.addedNodes.forEach((node) => scan(node)));
  });
  mo.observe(document.body, { childList: true, subtree: true });
  return () => mo.disconnect();
}
