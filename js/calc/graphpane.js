// AHOS Calc – the Graph pane: up to three functions y = f(x) on a canvas. Drag to pan, pinch / wheel / ± to zoom, tap (or switch to Trace and
// slide) to read x and y on a curve, and Find roots, minima, maxima, intersections and the y-intercept inside the visible window.
import { h } from '../util.js';
import { t } from '../i18n.js';
import { sfx } from '../sound.js';
import { compileText } from './fnx.js';
import { loadCalc } from './state.js';
import { fmtNum } from './units.js';

const KEY = 'ahos.calc.graph';
const COLORS = ['#22D3EE', '#FB923C', '#F472B6'];
const MAXF = 3;
const HOME = { cx: 0, cy: 0, sx: 44, sy: 44 };
const clampS = (v) => Math.max(1e-4, Math.min(1e7, v));
const clean = (v) => (Math.abs(v) < 1e-9 ? 0 : parseFloat(v.toPrecision(12)));
const short = (v) => fmtNum(clean(+v.toPrecision(7)), false);

function load() { try { const r = JSON.parse(localStorage.getItem(KEY) || 'null'); if (r && typeof r === 'object') return r; } catch { /* ignore */ } return {}; }
const nice = (v) => { const p = 10 ** Math.floor(Math.log10(v)), m = v / p; return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p; };

export function graphPane() {
  const st = loadCalc();
  const mem = load();
  let ang = mem.ang === 'deg' ? 'deg' : 'rad';              // curves are drawn in radians unless asked otherwise (sin x would look flat in degrees)
  const fns = (Array.isArray(mem.fns) && mem.fns.length ? mem.fns.slice(0, MAXF) : ['x^2 − 2', 'sin(x)']).map((s) => ({ text: String(s), on: true, f: null, bad: false }));
  const view = { ...HOME, ...(mem.view && ['cx', 'cy', 'sx', 'sy'].every((k) => Number.isFinite(mem.view[k])) ? { cx: mem.view.cx, cy: mem.view.cy, sx: clampS(mem.view.sx), sy: clampS(mem.view.sy) } : {}) };
  let mode = 'pan';
  let trace = null;                                   // { i, x }
  let marks = [];                                     // { x, y, k, i }
  let raf = 0;
  const persist = () => { try { localStorage.setItem(KEY, JSON.stringify({ fns: fns.map((f) => f.text), view, ang })); } catch { /* ignore */ } };

  const canvas = h('canvas', { class: 'gp-cv', role: 'img', 'aria-label': t('gp_graph') });
  const read = h('div', { class: 'gp-read', dir: 'ltr', 'aria-live': 'polite' });
  const wrap = h('div', { class: 'gp-wrap' }, canvas, read);
  const list = h('div', { class: 'gp-fns', dir: 'ltr' });
  const chipsEl = h('div', { class: 'gp-marks', dir: 'ltr' });
  const ctx2 = canvas.getContext('2d');

  /* ---------- functions ---------- */
  function compile(f) {
    f.bad = false; f.f = null;
    if (!f.text.trim()) return;
    try { f.f = compileText(f.text, { ang, vars: st.vars }); } catch { f.bad = true; }
  }
  const ev = (f, x) => { try { const v = f.f(x); return Number.isFinite(v) ? v : NaN; } catch { return NaN; } };
  const live = () => fns.map((f, i) => ({ f, i })).filter(({ f }) => f.on && f.f);

  function buildList() {
    list.replaceChildren(...fns.map((f, i) => {
      const dot = h('button', { class: 'gp-dot' + (f.on ? '' : ' off'), type: 'button', style: { '--c': COLORS[i] }, 'aria-label': t('gp_toggle'), 'aria-pressed': String(f.on), onClick: () => { f.on = !f.on; dot.classList.toggle('off', !f.on); dot.setAttribute('aria-pressed', String(f.on)); marks = []; trace = null; paintMarks(); draw(); } });
      const inp = h('input', { class: 'ce-in cs-fld gp-in', type: 'text', inputmode: 'text', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', enterkeyhint: 'done', dir: 'ltr', placeholder: i === 0 ? 'x^2 − 2' : 'sin(x)', 'aria-label': 'f' + (i + 1) });
      inp.value = f.text;
      inp.addEventListener('input', () => { f.text = inp.value; compile(f); inp.classList.toggle('bad', f.bad); marks = []; trace = null; paintMarks(); persist(); draw(); });
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') inp.blur(); });
      return h('div', { class: 'gp-fn' }, dot, h('b', { class: 'gp-lab' }, 'y' + (fns.length > 1 ? ['₁', '₂', '₃'][i] : '') + ' ='), inp,
        fns.length > 1 ? h('button', { class: 'cs-ib', type: 'button', 'aria-label': t('delete'), onClick: () => { fns.splice(i, 1); marks = []; trace = null; buildList(); paintMarks(); persist(); draw(); } }, '×') : null);
    }), fns.length < MAXF ? h('button', { class: 'cs-chip gp-add', type: 'button', onClick: () => { fns.push({ text: '', on: true, f: null, bad: false }); buildList(); list.querySelectorAll('.gp-in')[fns.length - 1].focus(); } }, '+ y' + ['₁', '₂', '₃'][fns.length]) : null);
  }

  /* ---------- drawing ---------- */
  let W = 0, H = 0;
  function size() {
    const r = wrap.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width)), hh = Math.max(1, Math.round(r.height)), dpr = Math.min(3, window.devicePixelRatio || 1);
    if (w === W && hh === H && canvas.width === Math.round(w * dpr)) return W > 1;
    W = w; H = hh;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    return true;
  }
  const X = (x) => W / 2 + (x - view.cx) * view.sx;
  const Y = (y) => H / 2 - (y - view.cy) * view.sy;
  const wx = (px) => view.cx + (px - W / 2) / view.sx;
  const wy = (py) => view.cy - (py - H / 2) / view.sy;

  function draw() { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; render(); }); }
  function render() {
    if (!canvas.isConnected || !size()) return;
    const dpr = canvas.width / W, c = ctx2;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, W, H);
    const fg = getComputedStyle(canvas).color || '#fff';
    c.font = '11px system-ui, sans-serif'; c.textBaseline = 'top';
    // grid
    const gx = nice(70 / view.sx), gy = nice(70 / view.sy);
    c.lineWidth = 1; c.strokeStyle = fg; c.fillStyle = fg;
    const x0 = wx(0), x1 = wx(W), y1 = wy(0), y0 = wy(H);
    const axY = Math.min(Math.max(Y(0), 14), H - 16), axX = Math.min(Math.max(X(0), 4), W - 34);
    c.globalAlpha = 0.09;
    c.beginPath();
    for (let v = Math.ceil(x0 / gx) * gx; v <= x1; v += gx) { const px = Math.round(X(v)) + 0.5; c.moveTo(px, 0); c.lineTo(px, H); }
    for (let v = Math.ceil(y0 / gy) * gy; v <= y1; v += gy) { const py = Math.round(Y(v)) + 0.5; c.moveTo(0, py); c.lineTo(W, py); }
    c.stroke();
    c.globalAlpha = 0.5; c.beginPath();
    if (X(0) >= 0 && X(0) <= W) { c.moveTo(Math.round(X(0)) + 0.5, 0); c.lineTo(Math.round(X(0)) + 0.5, H); }
    if (Y(0) >= 0 && Y(0) <= H) { c.moveTo(0, Math.round(Y(0)) + 0.5); c.lineTo(W, Math.round(Y(0)) + 0.5); }
    c.stroke();
    c.globalAlpha = 0.62;
    c.textAlign = 'center';
    for (let v = Math.ceil(x0 / gx) * gx; v <= x1; v += gx) { if (Math.abs(v) < gx / 2) continue; c.fillText(short(v), X(v), axY + 3); }
    c.textAlign = 'left';
    for (let v = Math.ceil(y0 / gy) * gy; v <= y1; v += gy) { if (Math.abs(v) < gy / 2) continue; c.fillText(short(v), axX + 4, Y(v) - 6); }
    c.globalAlpha = 1;
    // curves
    c.lineWidth = 2.2; c.lineJoin = 'round'; c.lineCap = 'round';
    for (const { f, i } of live()) {
      c.strokeStyle = COLORS[i]; c.beginPath();
      let pen = false, py0 = 0;
      for (let px = -1; px <= W + 1; px += 1) {
        const y = ev(f, wx(px));
        if (Number.isNaN(y)) { pen = false; continue; }
        const py = Y(y);
        if (pen && Math.abs(py - py0) > H * 2.5) pen = false;            // a jump (1/x, tan x): do not join the two sides
        if (py < -3e4 || py > 3e4) { pen = false; py0 = py; continue; }
        if (pen) c.lineTo(px, py); else c.moveTo(px, py);
        pen = true; py0 = py;
      }
      c.stroke();
    }
    // found points
    for (const m of marks) {
      const px = X(m.x), py = Y(m.y);
      if (px < -10 || px > W + 10 || py < -10 || py > H + 10) continue;
      c.fillStyle = COLORS[m.i] || fg; c.beginPath(); c.arc(px, py, 4.5, 0, 7); c.fill();
      c.strokeStyle = '#fff'; c.lineWidth = 1.5; c.stroke();
    }
    // trace
    if (trace && fns[trace.i] && fns[trace.i].f) {
      const f = fns[trace.i], y = ev(f, trace.x), px = X(trace.x);
      if (!Number.isNaN(y)) {
        const py = Y(y);
        c.globalAlpha = 0.3; c.strokeStyle = fg; c.lineWidth = 1; c.setLineDash([4, 4]); c.beginPath(); c.moveTo(px, 0); c.lineTo(px, H); c.moveTo(0, py); c.lineTo(W, py); c.stroke(); c.setLineDash([]); c.globalAlpha = 1;
        c.fillStyle = COLORS[trace.i]; c.beginPath(); c.arc(px, py, 6, 0, 7); c.fill(); c.strokeStyle = '#fff'; c.lineWidth = 2; c.stroke();
        read.textContent = 'y' + (fns.length > 1 ? ['₁', '₂', '₃'][trace.i] : '') + ':  x = ' + short(trace.x) + '   y = ' + short(y);
        read.style.setProperty('--c', COLORS[trace.i]); read.classList.add('on');
      } else { read.textContent = 'x = ' + short(trace.x) + '   y = —'; read.classList.add('on'); }
    } else read.classList.remove('on');
  }

  /* ---------- finding points ---------- */
  function rootsOf(fn, a, b) {
    const N = 900, out = [];
    let px = a, py = fn(a);
    for (let k = 1; k <= N; k++) {
      const x = a + ((b - a) * k) / N, y = fn(x);
      if (Number.isFinite(py) && Number.isFinite(y) && (py === 0 || py * y < 0)) {
        let lo = px, hi = x, flo = py;
        if (py !== 0) for (let q = 0; q < 70; q++) { const mid = (lo + hi) / 2, fm = fn(mid); if (!Number.isFinite(fm)) break; if (flo * fm <= 0) hi = mid; else { lo = mid; flo = fm; } }
        const r = py === 0 ? px : (lo + hi) / 2, fr = fn(r);
        if (Number.isFinite(fr) && Math.abs(fr) <= 1e-6 * Math.max(1, Math.abs(py), Math.abs(y)) && !out.some((o) => Math.abs(o - r) < (b - a) * 1e-5)) out.push(r);
      }
      px = x; py = y;
    }
    return out;
  }
  function extremaOf(fn, a, b, kind) {
    const N = 900, xs = [], ys = [], out = [];
    for (let k = 0; k <= N; k++) { const x = a + ((b - a) * k) / N; xs.push(x); ys.push(fn(x)); }
    const s = kind === 'min' ? 1 : -1;                    // work on s·f so both are minima
    for (let k = 1; k < N; k++) {
      const p = ys[k - 1] * s, q = ys[k] * s, r = ys[k + 1] * s;
      if (!(Number.isFinite(p) && Number.isFinite(q) && Number.isFinite(r))) continue;
      if (q <= p && q < r) {
        let lo = xs[k - 1], hi = xs[k + 1];
        const g = (x) => fn(x) * s;
        const phi = (Math.sqrt(5) - 1) / 2;
        let c1 = hi - phi * (hi - lo), c2 = lo + phi * (hi - lo), f1 = g(c1), f2 = g(c2);
        for (let q2 = 0; q2 < 80; q2++) { if (f1 < f2) { hi = c2; c2 = c1; f2 = f1; c1 = hi - phi * (hi - lo); f1 = g(c1); } else { lo = c1; c1 = c2; f1 = f2; c2 = lo + phi * (hi - lo); f2 = g(c2); } }
        const q2s = (b - a) * 1e-7, x = Math.round((lo + hi) / 2 / q2s) * q2s, y = fn(x);       // the search is only good to ~√ε: snap to the precision the screen can show (1e-8 → 0)
        if (Number.isFinite(y) && !out.some((o) => Math.abs(o.x - x) < (b - a) * 1e-4)) out.push({ x, y });
      }
    }
    return out;
  }
  function find(kind) {
    const L = live();
    const a = wx(0), b = wx(W);
    const res = [];
    if (kind === 'root') L.forEach(({ f, i }) => rootsOf((x) => ev(f, x), a, b).forEach((x) => res.push({ x, y: 0, k: kind, i })));
    else if (kind === 'min' || kind === 'max') L.forEach(({ f, i }) => extremaOf((x) => ev(f, x), a, b, kind).forEach((p) => res.push({ ...p, k: kind, i })));
    else if (kind === 'yint') L.forEach(({ f, i }) => { const y = ev(f, 0); if (!Number.isNaN(y)) res.push({ x: 0, y, k: kind, i }); });
    else if (kind === 'cross') for (let p = 0; p < L.length; p++) for (let q = p + 1; q < L.length; q++) rootsOf((x) => ev(L[p].f, x) - ev(L[q].f, x), a, b).forEach((x) => res.push({ x, y: ev(L[p].f, x), k: kind, i: L[p].i }));
    marks = res.slice(0, 24);
    trace = null; read.classList.remove('on');
    paintMarks(true);
    draw();
    sfx('tab');
  }
  const KIND = { root: 'gp_root', min: 'gp_min', max: 'gp_max', yint: 'gp_yint', cross: 'gp_cross' };
  function paintMarks(said) {
    chipsEl.replaceChildren();
    if (!marks.length) { if (said) chipsEl.append(h('span', { class: 'gp-none' }, t('gp_none'))); return; }
    marks.forEach((m) => chipsEl.append(h('button', { class: 'gp-mk', type: 'button', style: { '--c': COLORS[m.i] || '#fff' }, onClick: () => { view.cx = m.x; view.cy = m.y; persist(); draw(); } }, h('b', null, t(KIND[m.k])), ' (' + short(m.x) + ', ' + short(m.y) + ')')));
  }

  /* ---------- gestures ---------- */
  const ptr = new Map();
  let moved = false, t0 = 0, pinch = null, start = { x: 0, y: 0 };
  const local = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  function pickCurve(px, py) {
    const x = wx(px); let best = null;
    for (const { f, i } of live()) { const y = ev(f, x); if (Number.isNaN(y)) continue; const d = Math.abs(Y(y) - py); if (!best || d < best.d) best = { i, d }; }
    return best ? { i: best.i, x } : null;
  }
  function zoom(k, ax = W / 2, ay = H / 2) {
    const wxa = wx(ax), wya = wy(ay);
    view.sx = clampS(view.sx * k); view.sy = clampS(view.sy * k);
    view.cx = wxa - (ax - W / 2) / view.sx; view.cy = wya + (ay - H / 2) / view.sy;
    persist(); draw();
  }
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    ptr.set(e.pointerId, local(e));
    if (ptr.size === 1) { moved = false; t0 = performance.now(); start = local(e); } else { moved = true; const [p, q] = [...ptr.values()]; pinch = { d: Math.hypot(p.x - q.x, p.y - q.y) || 1 }; }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!ptr.has(e.pointerId)) return;
    const prev = ptr.get(e.pointerId), cur = local(e);
    ptr.set(e.pointerId, cur);
    if (ptr.size >= 2 && pinch) {
      const [p, q] = [...ptr.values()], d = Math.hypot(p.x - q.x, p.y - q.y) || 1;
      zoom(d / pinch.d, (p.x + q.x) / 2, (p.y + q.y) / 2); pinch.d = d; return;
    }
    if (!moved && Math.hypot(cur.x - start.x, cur.y - start.y) < 6) return;       // a small wobble is still a tap
    moved = true;
    if (mode === 'trace') {
      const tr = trace ? { i: trace.i, x: wx(cur.x) } : pickCurve(cur.x, cur.y);
      if (tr) { trace = tr; draw(); }
      return;
    }
    view.cx -= (cur.x - prev.x) / view.sx; view.cy += (cur.y - prev.y) / view.sy;
    draw();
  });
  const up = (e) => {
    const was = ptr.has(e.pointerId), p = ptr.get(e.pointerId);
    ptr.delete(e.pointerId);
    if (ptr.size < 2) pinch = null;
    if (!was) return;
    if (ptr.size === 0) {
      if (!moved && performance.now() - t0 < 400 && p) { const tr = pickCurve(p.x, p.y); trace = tr; if (!tr) { read.classList.remove('on'); } draw(); }
      persist();
    }
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); const p = local(e); zoom(Math.exp(-e.deltaY * 0.0016), p.x, p.y); }, { passive: false });
  canvas.addEventListener('dblclick', (e) => { const p = local(e); zoom(1.8, p.x, p.y); });

  /* ---------- toolbar ---------- */
  function fit() {
    const a = wx(0), b = wx(W), vals = [];
    for (const { f } of live()) for (let k = 0; k <= 300; k++) { const y = ev(f, a + ((b - a) * k) / 300); if (!Number.isNaN(y) && Math.abs(y) < 1e9) vals.push(y); }
    if (!vals.length) return;
    vals.sort((p, q) => p - q);
    const lo = vals[Math.floor(vals.length * 0.02)], hi = vals[Math.ceil(vals.length * 0.98) - 1];
    const span = hi - lo || Math.max(1, Math.abs(hi)) * 0.5;
    view.cy = (lo + hi) / 2; view.sy = clampS((H * 0.78) / span);
    persist(); draw(); sfx('tab');
  }
  const tool = (cls, label, icon, fn) => h('button', { class: 'gp-tool ' + cls, type: 'button', 'aria-label': label, title: label, onClick: fn, html: icon });
  const modeBtn = h('button', { class: 'gp-tool gp-mode', type: 'button', 'aria-pressed': 'false', onClick: () => { mode = mode === 'pan' ? 'trace' : 'pan'; modeBtn.setAttribute('aria-pressed', String(mode === 'trace')); modeBtn.classList.toggle('on', mode === 'trace'); modeBtn.querySelector('span').textContent = mode === 'trace' ? t('gp_trace') : t('gp_pan'); sfx('tab'); } }, h('span', null, t('gp_pan')));
  const bar = h('div', { class: 'gp-bar', dir: 'ltr' }, modeBtn,
    tool('', t('gp_zin'), '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>', () => zoom(1.5)),
    tool('', t('gp_zout'), '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M5 12h14"/></svg>', () => zoom(1 / 1.5)),
    tool('', t('gp_fit'), '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v18M8 7l4-4 4 4M8 17l4 4 4-4"/></svg>', fit),
    tool('', t('gp_home'), '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10"/></svg>', () => { Object.assign(view, HOME); marks = []; trace = null; paintMarks(); persist(); draw(); sfx('tab'); }));
  const finds = h('div', { class: 'gp-find', dir: 'ltr' }, Object.keys(KIND).map((k) => h('button', { class: 'ce-chip', type: 'button', onClick: () => find(k) }, t(KIND[k]))));

  const angBtn = h('button', { class: 'gp-tool gp-ang', type: 'button', 'aria-label': t('gp_angle'), title: t('gp_angle'), onClick: () => { ang = ang === 'rad' ? 'deg' : 'rad'; angBtn.textContent = ang.toUpperCase(); fns.forEach(compile); marks = []; trace = null; paintMarks(); persist(); draw(); sfx('tab'); } }, ang.toUpperCase());
  bar.insertBefore(angBtn, bar.children[1]);
  const el = h('div', { class: 'gp' }, list, wrap, bar, finds, chipsEl);
  fns.forEach(compile);
  buildList();
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => draw()) : null;
  if (ro) ro.observe(wrap);
  requestAnimationFrame(draw);
  return { el, refit: () => draw() };
}
