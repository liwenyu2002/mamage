// 苹果 Liquid Glass 边缘折射引擎。
// 位移图算法源自 shuding/liquid-glass（MIT，https://github.com/shuding/liquid-glass）：
// 圆角矩形 SDF → 逐像素位移编码进 R/G 通道 → feDisplacementMap 作用于 backdrop。
// 本移植改为沿 SDF 法线方向、振幅有界的边缘折射带，使任意尺寸的面板/胶囊
// 中心保持清晰、仅边缘产生透镜弯折；同 尺寸x圆角 的元素共享同一滤镜。
// 仅 Chromium 支持 backdrop-filter: url()；CSS 侧用 @supports 门控回退。

const LENS_SUFFIX = ' blur(1.1px) saturate(1.5) contrast(1.06) brightness(1.03)';
// 窄边带剖面（用户三轮校准定稿，对齐"折射仅限边缘、中间无变形"）：
// 位移沿 SDF 法线向内、幅度 = amp*(1-t)²——二次曲线在带内边界导数为零，
// 与平坦中心 C¹ 连续（过渡不生硬）；amp/band=0.4 低于 0.5 折返阈值，纯压缩无折痕。
const LENS_BAND_RATIO = 0.22; // 折射带宽 = min(w,h)*ratio，夹在 [8, 28] px
const LENS_AMPLITUDE_RATIO = 0.4; // 振幅 = band * ratio

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
  const band = Math.max(8, Math.min(28, Math.min(cw, ch) * LENS_BAND_RATIO));
  const amp = band * LENS_AMPLITUDE_RATIO;
  const hw = cw / 2 - 0.5;
  const hh = ch / 2 - 0.5;

  const sdf = (x, y) => roundedRectSDF(x, y, hw, hh, radius);

  const raw = new Float32Array(cw * ch * 2);
  let maxScale = 0;
  for (let y = 0; y < ch; y += 1) {
    const py = y - ch / 2 + 0.5;
    for (let x = 0; x < cw; x += 1) {
      const px = x - cw / 2 + 0.5;
      const d = sdf(px, py);
      // 贴边 t=0 → 带内边界 t=1；(1-t)² 在 t=1 处导数为零，平滑并入无变形的中心
      const t = Math.max(0, Math.min(1, -d / band));
      const e = (1 - t) * (1 - t);
      let dx = 0;
      let dy = 0;
      if (e > 0.001) {
        const nx = sdf(px + 1, py) - sdf(px - 1, py);
        const ny = sdf(px, py + 1) - sdf(px, py - 1);
        const len = Math.sqrt(nx * nx + ny * ny) || 1;
        dx = -(nx / len) * e * amp;
        dy = -(ny / len) * e * amp;
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
