// The living background: a topographic map drawn with marching squares.
// Every 3rd contour is an "index" line, like a real survey map.
//   full  - slowly drifting (about 10 fps, paused while you scroll) and follows the scroll
//   calm  - still picture that follows the scroll
//   off   - plain colour, nothing drawn
// The map is drawn on a canvas a little taller than the screen and slid with a GPU transform while you scroll.
// It is only redrawn when the slide has used up the extra height (about every 300 px of drift), never on every frame.

let canvas, ctx, W = 0, H = 0, dpr = 1;
let cols = 0, rows = 0, vals = new Float32Array(0);
let raf = 0, last = 0, t0 = 0, band = 0, lastY = 0, lastScrollAt = 0, mode = 'calm', paused = false, grad = null;
let colA = '231,185,79', colB = '60,203,188', aMinor = 0.1, aMajor = 0.26;
let needDraw = false;
const CELL = 26;
const PAD = CELL * 12; // extra canvas height that the slide can use before a redraw
const PAR = 0.4; // the map moves 0.4 px per px of scroll
const LEVELS = [];
for (let i = -5; i <= 5; i++) LEVELS.push(i * 0.27);

function field(x, y, t) {
  return (
    Math.sin(x * 1.25 + t * 0.34) * 0.55 +
    Math.sin(y * 1.05 - t * 0.27 + Math.sin(x * 0.62 + t * 0.1) * 1.4) * 0.5 +
    Math.sin((x + y) * 0.74 + t * 0.2) * 0.38 +
    Math.cos(x * 1.9 - y * 1.6 + t * 0.14) * 0.22
  );
}

function readColors() {
  const cs = getComputedStyle(document.documentElement);
  colA = (cs.getPropertyValue('--c-line-a') || '231,185,79').trim();
  colB = (cs.getPropertyValue('--c-line-b') || '60,203,188').trim();
  aMinor = parseFloat(cs.getPropertyValue('--a-minor')) || 0.1;
  aMajor = parseFloat(cs.getPropertyValue('--a-major')) || 0.26;
  grad = null;
}

function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 1.25);
  W = window.innerWidth; H = window.innerHeight;
  canvas.width = Math.round(W * dpr); canvas.height = Math.round((H + PAD) * dpr);
  canvas.style.height = (H + PAD) + 'px';
  cols = Math.ceil(W / CELL) + 2; rows = Math.ceil((H + PAD) / CELL) + 2;
  vals = new Float32Array(cols * rows);
  grad = null;
  needDraw = true;
}

function seg(path, x1, y1, x2, y2) { path.moveTo(x1, y1); path.lineTo(x2, y2); }

function marching(L, path) {
  for (let j = 0; j < rows - 1; j++) {
    const row = j * cols;
    for (let i = 0; i < cols - 1; i++) {
      const a = vals[row + i], b = vals[row + i + 1], c = vals[row + cols + i + 1], d = vals[row + cols + i];
      const idx = (a > L ? 8 : 0) | (b > L ? 4 : 0) | (c > L ? 2 : 0) | (d > L ? 1 : 0);
      if (idx === 0 || idx === 15) continue;
      const x0 = i * CELL, y0 = j * CELL, x1 = x0 + CELL, y1 = y0 + CELL;
      const tx = x0 + CELL * ((L - a) / (b - a));
      const ry = y0 + CELL * ((L - b) / (c - b));
      const bx = x0 + CELL * ((L - d) / (c - d));
      const ly = y0 + CELL * ((L - a) / (d - a));
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

function draw(now) {
  needDraw = false;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H + PAD);
  if (mode === 'off') return;
  const t = mode === 'full' ? ((now - t0) / 1000) * 0.8 : 3.7;
  const oy = band * PAD * 0.0105; // 0.0105 = field units per px
  const k = CELL * 0.0105;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) vals[j * cols + i] = field(i * k, j * k + oy, t);
  }
  if (!grad) {
    grad = ctx.createLinearGradient(0, 0, W, H);
    grad.addColorStop(0, `rgba(${colA},1)`);
    grad.addColorStop(0.55, `rgba(${colA},1)`);
    grad.addColorStop(1, `rgba(${colB},1)`);
  }
  const minor = new Path2D(), major = new Path2D();
  for (let li = 0; li < LEVELS.length; li++) marching(LEVELS[li], li % 3 === 0 ? major : minor);
  ctx.strokeStyle = grad;
  ctx.globalAlpha = aMinor; ctx.lineWidth = 0.9; ctx.stroke(minor);
  ctx.globalAlpha = aMajor; ctx.lineWidth = 1.4; ctx.stroke(major);
  ctx.globalAlpha = 1;
}

function loop(now) {
  raf = requestAnimationFrame(loop);
  if (now - last < 100) return; // ~10 fps
  if (now - lastScrollAt < 350) return; // never compete with a scroll
  last = now;
  draw(now);
}

function frameOnce() {
  if (raf) return;
  raf = requestAnimationFrame((now) => { raf = 0; if (needDraw && !paused && !document.hidden) draw(now); });
}

function run() {
  cancelAnimationFrame(raf); raf = 0;
  if (!ctx) return;
  const still = paused || document.hidden || mode !== 'full' || matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!still) { raf = requestAnimationFrame(loop); return; }
  if (!paused && !document.hidden) { needDraw = true; frameOnce(); }
}

export function startBackground(el) {
  canvas = el; ctx = canvas.getContext('2d');
  t0 = performance.now() - 14000;
  readColors(); resize(); run();
  let rz;
  window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { resize(); run(); }, 120); });
  document.addEventListener('visibilitychange', run);
}

export const setScroll = (y) => {
  lastY = y;
  if (mode === 'off' || !canvas) return;
  lastScrollAt = performance.now();
  const s = Math.max(0, y) * PAR;
  const b = Math.floor(s / PAD);
  canvas.style.transform = `translate3d(0, ${-(s - b * PAD).toFixed(1)}px, 0)`;
  if (b !== band) { band = b; if (!paused) { needDraw = true; frameOnce(); } }
};
export function setMode(m) {
  mode = m; document.documentElement.dataset.bg = m;
  if (canvas) { if (m === 'off') canvas.style.transform = ''; else setScroll(lastY); }
  run();
}
export function setPaused(p) { paused = p; run(); }
export function refreshColors() { readColors(); needDraw = true; run(); }
