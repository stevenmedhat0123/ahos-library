// The living background. One light canvas, eight looks – all drawn in the theme colours so they follow the skin and accent:
//   topo    - topographic map (marching squares, every 3rd contour is an "index" line)
//   shapes  - drifting geometric shapes (triangles of every orientation, hexagons, diamonds, circles, squares, stars, crosses)
//   aurora  - slow glowing colour clouds
//   bubbles - bubbles rising with a highlight
//   stars   - twinkling points joined by faint lines, like a constellation
//   waves   - flowing contour waves
//   graph   - graph paper with function curves that slowly move (for the maths people)
//   image   - your own picture (a normal element behind the canvas, dimmed so the text stays readable)
// Motion: full = slowly moving (about 20 fps, paused while you scroll or tap, while a viewer is open and while the app is hidden),
// calm = a still picture that follows the scroll, off = plain colour. The canvas is a little taller than the screen and slid with a
// GPU transform while you scroll; it is only redrawn when the slide has used up the extra height (topo) or when something moves.

let canvas, ctx, imgEl, W = 0, H = 0, dpr = 1;
let raf = 0, last = 0, t0 = 0, band = 0, lastY = 0, lastTouchAt = 0, mode = 'calm', style = 'topo', paused = false;
let colA = '231,185,79', colB = '60,203,188', aMinor = 0.1, aMajor = 0.26;
let needDraw = false, cost = 0, prevNow = 0;   // cost: how long a redraw takes (smoothed), so a heavy look slows itself down
const PAD = 26 * 6;    // extra canvas height that the slide can use before a redraw (smaller = a lighter canvas)
const PAR = 0.4;       // the picture moves 0.4 px per px of scroll
export const BG_STYLES = ['topo', 'shapes', 'aurora', 'bubbles', 'stars', 'waves', 'graph', 'image'];
export const BG_SHAPES = ['mix', 'tri', 'hex', 'diamond', 'circle', 'square', 'star', 'cross'];
let shapeSet = 'mix';

/* ---------- small helpers ---------- */
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const wrap = (v, m) => ((v % m) + m) % m;
const col = (which, a) => `rgba(${which ? colB : colA},${a})`;

function readColors() {
  const cs = getComputedStyle(document.documentElement);
  colA = (cs.getPropertyValue('--c-line-a') || '231,185,79').trim();
  colB = (cs.getPropertyValue('--c-line-b') || '60,203,188').trim();
  aMinor = parseFloat(cs.getPropertyValue('--a-minor')) || 0.1;
  aMajor = parseFloat(cs.getPropertyValue('--a-major')) || 0.26;
}

/* ---------- 1. topographic map ---------- */
const CELL = 26;
const LEVELS = []; for (let i = -5; i <= 5; i++) LEVELS.push(i * 0.27);
let cols = 0, rows = 0, vals = new Float32Array(0), topoGrad = null;
function field(x, y, t) {
  return (Math.sin(x * 1.25 + t * 0.34) * 0.55 + Math.sin(y * 1.05 - t * 0.27 + Math.sin(x * 0.62 + t * 0.1) * 1.4) * 0.5
    + Math.sin((x + y) * 0.74 + t * 0.2) * 0.38 + Math.cos(x * 1.9 - y * 1.6 + t * 0.14) * 0.22);
}
const seg = (path, x1, y1, x2, y2) => { path.moveTo(x1, y1); path.lineTo(x2, y2); };
function marching(L, path) {
  for (let j = 0; j < rows - 1; j++) {
    const row = j * cols;
    for (let i = 0; i < cols - 1; i++) {
      const a = vals[row + i], b = vals[row + i + 1], c = vals[row + cols + i + 1], d = vals[row + cols + i];
      const idx = (a > L ? 8 : 0) | (b > L ? 4 : 0) | (c > L ? 2 : 0) | (d > L ? 1 : 0);
      if (idx === 0 || idx === 15) continue;
      const x0 = i * CELL, y0 = j * CELL, x1 = x0 + CELL, y1 = y0 + CELL;
      const tx = x0 + CELL * ((L - a) / (b - a)), ry = y0 + CELL * ((L - b) / (c - b)), bx = x0 + CELL * ((L - d) / (c - d)), ly = y0 + CELL * ((L - a) / (d - a));
      switch (idx) {
        case 1: case 14: seg(path, x0, ly, bx, y1); break;
        case 2: case 13: seg(path, bx, y1, x1, ry); break;
        case 3: case 12: seg(path, x0, ly, x1, ry); break;
        case 4: case 11: seg(path, tx, y0, x1, ry); break;
        case 5: seg(path, tx, y0, x0, ly); seg(path, bx, y1, x1, ry); break;
        case 6: case 9: seg(path, tx, y0, bx, y1); break;
        case 7: case 8: seg(path, tx, y0, x0, ly); break;
        case 10: seg(path, tx, y0, x1, ry); seg(path, x0, ly, bx, y1); break;
        default: break;
      }
    }
  }
}
function drawTopo(c, w, h, t, st, opts) {
  const cc = Math.ceil(w / CELL) + 2, rr = Math.ceil(h / CELL) + 2;
  if (!st.vals || st.cols !== cc || st.rows !== rr) { st.cols = cc; st.rows = rr; st.vals = new Float32Array(cc * rr); }
  cols = cc; rows = rr; vals = st.vals;
  const oy = (opts.band || 0) * PAD * 0.0105, k = CELL * 0.0105;
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) vals[j * cols + i] = field(i * k, j * k + oy, t);
  const g = c.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, `rgba(${colA},1)`); g.addColorStop(0.55, `rgba(${colA},1)`); g.addColorStop(1, `rgba(${colB},1)`);
  const minor = new Path2D(), major = new Path2D();
  for (let li = 0; li < LEVELS.length; li++) marching(LEVELS[li], li % 3 === 0 ? major : minor);
  c.strokeStyle = g;
  c.globalAlpha = aMinor; c.lineWidth = 0.9; c.stroke(minor);
  c.globalAlpha = aMajor; c.lineWidth = 1.4; c.stroke(major);
  c.globalAlpha = 1;
}

/* ---------- 2. shapes ---------- */
const UNIT = {};      // unit-size outlines (radius 1), built once
function polyPath(n, rot = -Math.PI / 2) { const p = new Path2D(); for (let i = 0; i < n; i++) { const a = rot + (i * Math.PI * 2) / n; const x = Math.cos(a), y = Math.sin(a); if (i) p.lineTo(x, y); else p.moveTo(x, y); } p.closePath(); return p; }
function buildUnits() {
  if (UNIT.tri) return;
  UNIT.tri = polyPath(3);                          // equilateral, point up – rotation makes it point down / sideways
  UNIT.hex = polyPath(6, 0);
  UNIT.diamond = (() => { const p = new Path2D(); p.moveTo(0, -1); p.lineTo(0.62, 0); p.lineTo(0, 1); p.lineTo(-0.62, 0); p.closePath(); return p; })();
  UNIT.circle = (() => { const p = new Path2D(); p.arc(0, 0, 1, 0, Math.PI * 2); return p; })();
  UNIT.square = (() => { const p = new Path2D(); p.rect(-0.78, -0.78, 1.56, 1.56); return p; })();
  UNIT.star = (() => { const p = new Path2D(); for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 5, r = i % 2 ? 0.45 : 1; const x = Math.cos(a) * r, y = Math.sin(a) * r; if (i) p.lineTo(x, y); else p.moveTo(x, y); } p.closePath(); return p; })();
  UNIT.cross = (() => { const p = new Path2D(); p.moveTo(-1, 0); p.lineTo(1, 0); p.moveTo(0, -1); p.lineTo(0, 1); return p; })();
  UNIT.ring = (() => { const p = new Path2D(); p.arc(0, 0, 1, 0, Math.PI * 2); p.moveTo(0.55, 0); p.arc(0, 0, 0.55, 0, Math.PI * 2); return p; })();
  UNIT.pent = polyPath(5);
}
const SET_KINDS = { mix: ['tri', 'hex', 'diamond', 'circle', 'square', 'star', 'cross', 'ring', 'pent', 'tri', 'hex'], tri: ['tri'], hex: ['hex'], diamond: ['diamond'], circle: ['circle', 'ring'], square: ['square'], star: ['star'], cross: ['cross'] };
function initShapes(st, w, h, set) {
  buildUnits();
  const r = rng(7 + BG_SHAPES.indexOf(set) * 31), kinds = SET_KINDS[set] || SET_KINDS.mix;
  const n = Math.max(10, Math.min(30, Math.round((w * h) / 20000)));
  st.set = set; st.w = w; st.h = h; st.items = [];
  for (let i = 0; i < n; i++) {
    const s = 14 + r() * 40;
    st.items.push({ k: kinds[Math.floor(r() * kinds.length)], x: r() * w, y: r() * h, s, rot: r() * Math.PI * 2, vr: (r() - 0.5) * 0.25, vx: (r() - 0.5) * 7, vy: (r() - 0.5) * 7, b: r() < 0.5 ? 0 : 1, fill: r() < 0.3, a: 0.1 + r() * 0.22 });
  }
}
function drawShapes(c, w, h, t, st, opts) {
  if (st.set !== opts.shapes || st.w !== w || st.h !== h) initShapes(st, w, h, opts.shapes);
  c.lineJoin = 'round'; c.lineCap = 'round';
  for (const s of st.items) {
    const m = s.s * 2;
    const x = wrap(s.x + s.vx * t + m, w + m * 2) - m, y = wrap(s.y + s.vy * t + m, h + m * 2) - m, a = s.rot + s.vr * t;
    const cs = Math.cos(a) * s.s, sn = Math.sin(a) * s.s;
    c.setTransform(dpr * cs, dpr * sn, -dpr * sn, dpr * cs, dpr * x, dpr * y);
    c.lineWidth = 1.3 / s.s;
    c.strokeStyle = col(s.b, s.a * 1.6);
    const p = UNIT[s.k];
    if (s.fill && s.k !== 'cross') { c.fillStyle = col(s.b, s.a * 0.35); c.fill(p); }
    c.stroke(p);
  }
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
}

/* ---------- 3. aurora ---------- */
function drawAurora(c, w, h, t) {
  const R = Math.max(w, 420) * 0.8;
  for (let k = 0; k < 4; k++) {
    const x = w * (0.5 + 0.42 * Math.sin(t * 0.045 + k * 1.7)), y = h * (0.5 + 0.4 * Math.cos(t * 0.037 + k * 2.3)), r = R * (0.55 + 0.25 * Math.sin(t * 0.05 + k));
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    const rgb = k % 2 ? colB : colA;
    g.addColorStop(0, `rgba(${rgb},${0.2 - k * 0.02})`); g.addColorStop(0.55, `rgba(${rgb},${0.07})`); g.addColorStop(1, `rgba(${rgb},0)`);
    c.fillStyle = g; c.fillRect(0, 0, w, h);
  }
}

/* ---------- 4. bubbles ---------- */
function drawBubbles(c, w, h, t, st) {
  if (!st.items || st.w !== w || st.h !== h) { const r = rng(11); st.w = w; st.h = h; st.items = Array.from({ length: Math.max(14, Math.min(30, Math.round((w * h) / 24000))) }, () => ({ x: r() * w, y: r() * h, r: 6 + r() * 26, v: 6 + r() * 14, ph: r() * 6.3, b: r() < 0.5 ? 0 : 1 })); }
  for (const b of st.items) {
    const m = b.r * 2, y = h + m - wrap(h + m - b.y + b.v * t, h + m * 2), x = b.x + Math.sin(t * 0.4 + b.ph) * 12;
    c.beginPath(); c.arc(x, y, b.r, 0, Math.PI * 2);
    c.strokeStyle = col(b.b, 0.22); c.lineWidth = 1.2; c.stroke();
    c.fillStyle = col(b.b, 0.035); c.fill();
    c.beginPath(); c.arc(x, y, b.r * 0.72, Math.PI * 1.1, Math.PI * 1.45);
    c.strokeStyle = col(b.b, 0.28); c.lineWidth = 1.4; c.stroke();
  }
}

/* ---------- 5. stars / network ---------- */
function drawStars(c, w, h, t, st) {
  if (!st.items || st.w !== w || st.h !== h) { const r = rng(5); st.w = w; st.h = h; st.items = Array.from({ length: Math.max(26, Math.min(56, Math.round((w * h) / 9000))) }, () => ({ x: r() * w, y: r() * h, vx: (r() - 0.5) * 8, vy: (r() - 0.5) * 8, ph: r() * 6.3, s: 1 + r() * 1.6 })); }
  const P = st.items, L = 120;
  const pos = P.map((p) => [wrap(p.x + p.vx * t, w), wrap(p.y + p.vy * t, h)]);
  c.lineWidth = 0.9;
  for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) {
    const dx = pos[i][0] - pos[j][0], dy = pos[i][1] - pos[j][1], d2 = dx * dx + dy * dy;
    if (d2 < L * L) { c.strokeStyle = col(i & 1, (1 - Math.sqrt(d2) / L) * 0.28); c.beginPath(); c.moveTo(pos[i][0], pos[i][1]); c.lineTo(pos[j][0], pos[j][1]); c.stroke(); }
  }
  for (let i = 0; i < P.length; i++) { const tw = 0.55 + 0.45 * Math.sin(t * 1.3 + P[i].ph); c.fillStyle = col(i & 1, 0.25 + 0.4 * tw); c.beginPath(); c.arc(pos[i][0], pos[i][1], P[i].s, 0, Math.PI * 2); c.fill(); }
}

/* ---------- 6. waves ---------- */
function drawWaves(c, w, h, t) {
  const n = Math.max(8, Math.round(h / 70)), step = 8;
  c.lineWidth = 1.1;
  for (let k = 0; k < n; k++) {
    const y0 = ((k + 0.5) / n) * h, A = 10 + 16 * Math.sin(k * 1.3) ** 2, f = 0.006 + 0.0025 * (k % 3), sp = 0.25 + 0.07 * (k % 4), ph = k * 1.9;
    c.beginPath();
    for (let x = 0; x <= w + step; x += step) { const y = y0 + A * Math.sin(x * f + t * sp + ph) + A * 0.5 * Math.sin(x * f * 2.3 - t * sp * 0.7); if (x) c.lineTo(x, y); else c.moveTo(x, y); }
    c.strokeStyle = col(k % 2 ? 1 : 0, k % 3 === 0 ? aMajor * 0.7 : aMinor * 1.1); c.stroke();
  }
}

/* ---------- 7. graph paper with moving curves ---------- */
function drawGraph(c, w, h, t, st) {
  const G = 26;
  if (!st.grid || st.w !== w || st.h !== h) {
    const minor = new Path2D(), major = new Path2D();
    for (let x = 0; x <= w; x += G) { const p = Math.round(x / G) % 5 === 0 ? major : minor; p.moveTo(x, 0); p.lineTo(x, h); }
    for (let y = 0; y <= h; y += G) { const p = Math.round(y / G) % 5 === 0 ? major : minor; p.moveTo(0, y); p.lineTo(w, y); }
    st.grid = { minor, major }; st.w = w; st.h = h;
  }
  c.strokeStyle = col(0, aMinor * 0.55); c.lineWidth = 0.7; c.stroke(st.grid.minor);
  c.strokeStyle = col(0, aMinor * 1.2); c.lineWidth = 1; c.stroke(st.grid.major);
  const cx = Math.round(w / 2 / G) * G, cy = Math.round(h / 2 / G) * G;
  c.strokeStyle = col(1, aMajor * 0.9); c.lineWidth = 1.3; c.beginPath(); c.moveTo(0, cy); c.lineTo(w, cy); c.moveTo(cx, 0); c.lineTo(cx, h); c.stroke();
  const curve = (f, rgb, a) => { c.beginPath(); for (let x = 0; x <= w; x += 6) { const u = (x - cx) / (G * 5), y = cy - f(u) * G * 5; if (x) c.lineTo(x, y); else c.moveTo(x, y); } c.strokeStyle = col(rgb, a); c.lineWidth = 1.8; c.stroke(); };
  curve((u) => 0.9 * Math.sin(u * 2 + t * 0.35), 0, aMajor * 1.5);
  curve((u) => 0.6 * Math.cos(u * 3 - t * 0.25), 1, aMajor * 1.3);
  curve((u) => 0.12 * (u * u) * Math.cos(t * 0.12) * 4 - 0.8, 0, aMajor);
}

const DRAW = { topo: drawTopo, shapes: drawShapes, aurora: drawAurora, bubbles: drawBubbles, stars: drawStars, waves: drawWaves, graph: drawGraph };
const STATE = {};
const MOVING = new Set(['shapes', 'aurora', 'bubbles', 'stars', 'waves', 'graph', 'topo']);

/* ---------- frame loop ---------- */
function draw(now) {
  needDraw = false;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H + PAD);
  if (mode === 'off' || style === 'image' || !DRAW[style]) return;
  const t = mode === 'full' ? ((now - t0) / 1000) * (style === 'topo' ? 0.8 : 1) : 3.7;
  DRAW[style](ctx, W, H + PAD, t, (STATE[style] ||= {}), { band, shapes: shapeSet });
}
function loop(now) {
  raf = requestAnimationFrame(loop);
  const slow = prevNow && now - prevNow > 70;        // the page was busy (a scroll, a viewer opening, a heavy screen): stay out of the way
  prevNow = now;
  if (slow) lastTouchAt = now + 600;
  const base = style === 'topo' ? 110 : 55;          // ~9 fps for the map, ~18 fps for the others
  const gap = Math.max(base, cost * 9);              // a redraw may use at most ~10% of the time
  if (now - last < gap) return;
  if (now - lastTouchAt < 450) return;              // never compete with a scroll or a tap
  last = now;
  const t1 = performance.now();
  draw(now);
  cost = cost * 0.6 + (performance.now() - t1) * 0.4;
}
function frameOnce() { if (raf) return; raf = requestAnimationFrame((now) => { raf = 0; if (needDraw && !paused && !document.hidden) draw(now); }); }
function run() {
  cancelAnimationFrame(raf); raf = 0;
  if (!ctx) return;
  const still = paused || document.hidden || mode !== 'full' || style === 'image' || matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!still) { raf = requestAnimationFrame(loop); return; }
  if (!paused && !document.hidden) { needDraw = true; frameOnce(); }
}
function resize() {
  dpr = 1;                                             // a faint decorative picture needs no more pixels than the screen has in CSS px
  W = window.innerWidth; H = window.innerHeight;
  canvas.width = Math.round(W * dpr); canvas.height = Math.round((H + PAD) * dpr);
  canvas.style.height = (H + PAD) + 'px';
  needDraw = true;
}

/* ---------- public ---------- */
export function startBackground(el) {
  canvas = el; ctx = canvas.getContext('2d');
  imgEl = document.createElement('div'); imgEl.id = 'bgimg'; imgEl.setAttribute('aria-hidden', 'true');
  canvas.parentNode.insertBefore(imgEl, canvas);
  t0 = performance.now() - 14000;
  readColors(); resize(); run();
  let rz;
  window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { resize(); run(); }, 120); });
  document.addEventListener('visibilitychange', run);
  window.addEventListener('pointerdown', () => { lastTouchAt = performance.now(); }, { passive: true, capture: true });
}
export const setScroll = (y) => {
  lastY = y;
  if (mode === 'off' || !canvas || style === 'image') return;
  lastTouchAt = performance.now();
  const s = Math.max(0, y) * PAR, b = Math.floor(s / PAD);
  canvas.style.transform = `translate3d(0, ${-(s - b * PAD).toFixed(1)}px, 0)`;
  if (b !== band) { band = b; if (style === 'topo' && !paused) { needDraw = true; frameOnce(); } }
};
export function setMode(m) {
  mode = m; document.documentElement.dataset.bg = m;
  if (canvas) { if (m === 'off') canvas.style.transform = ''; else setScroll(lastY); }
  run();
}
/** style: one of BG_STYLES; shapes: one of BG_SHAPES; image: object URL (or null); dim: 0.2 … 0.9 (how much the colour covers the picture) */
export function setStyle(s, { shapes = 'mix', image = null, dim = 0.55 } = {}) {
  style = BG_STYLES.includes(s) ? s : 'topo';
  shapeSet = BG_SHAPES.includes(shapes) ? shapes : 'mix';
  document.documentElement.dataset.bgstyle = style;
  if (imgEl) {
    imgEl.style.backgroundImage = image ? `url("${image}")` : '';
    imgEl.style.setProperty('--bgimg-dim', String(dim));
    imgEl.classList.toggle('on', style === 'image' && !!image);
  }
  if (style === 'image' && canvas) { canvas.style.transform = ''; }
  if (canvas) { needDraw = true; if (style !== 'image') setScroll(lastY); }
  run();
}
export function setPaused(p) { paused = p; run(); }
export function refreshColors() { readColors(); needDraw = true; run(); }
/** a small still picture of a look for the picker (does not touch the real background) */
export function previewStyle(cv, s, { shapes = 'mix' } = {}) {
  const c = cv.getContext('2d'), w = cv.clientWidth || 96, h = cv.clientHeight || 64, d = Math.min(window.devicePixelRatio || 1, 2);
  cv.width = Math.round(w * d); cv.height = Math.round(h * d);
  const keep = dpr; dpr = d;
  c.setTransform(d, 0, 0, d, 0, 0); c.clearRect(0, 0, w, h);
  readColors();
  const fn = DRAW[s];
  if (fn) {
    const st = {}; let k = 0.62;
    // previews use bolder lines than the real thing so a tiny picture still reads
    const A = aMinor, B = aMajor; aMinor = Math.min(0.5, aMinor * 2.4); aMajor = Math.min(0.8, aMajor * 2.4);
    try { fn(c, w, h, 3.7 * k + 2, st, { band: 0, shapes }); } finally { aMinor = A; aMajor = B; }
  }
  dpr = keep;
}
