// The timeline of the subtitle studio: a ruler, the subtitles as blocks (tap = select, drag the selected one = move, drag its ends = trim),
// a playhead, zoom (buttons, ctrl+wheel, two fingers), and only the blocks in view are drawn so a long film with thousands of lines stays smooth.
import { h } from '../util.js';
import { fmtTime, round3 } from './model.js';

const STEPS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600];
const ROWS = 2;
const ROW_H = 24;
export const MIN_PPS = 4, MAX_PPS = 480;
const MIN_LEN = 0.1;

/**
 * createLane({ get, onSeek, onSelect, onChange })
 *   get()                 -> { cues (sorted), dur, sel, now, warn: Map }
 *   onSeek(t)             the user tapped on the ruler / empty part
 *   onSelect(id)          a block was tapped
 *   onChange(id, {start,end}, final)  a block is being moved/trimmed (final = true on release)
 */
export function createLane({ get, onSeek, onSelect, onChange, onZoom }) {
  let pps = 40;
  let follow = true;
  let rowOf = new Map(), rowsFor = null;
  const ruler = h('div', { class: 'ss-ruler' });
  const blocks = h('div', { class: 'ss-blocks', style: { height: ROWS * ROW_H + 6 + 'px' } });
  const ph = h('div', { class: 'ss-ph' }, h('i'));
  const inner = h('div', { class: 'ss-lane-in' }, ruler, blocks, ph);
  const scroll = h('div', { class: 'ss-lane-scroll', dir: 'ltr' }, inner);
  const el = h('div', { class: 'ss-lane', dir: 'ltr' }, scroll);
  const PAD = 16;

  const dur = () => Math.max(1, get().dur || 1);
  const width = () => Math.ceil(dur() * pps) + PAD * 2 + 40;
  const xOf = (t) => PAD + t * pps;
  const tOf = (x) => Math.max(0, (x - PAD) / pps);

  /** which of the 3 rows each cue sits in (overlapping cues stack) */
  function layoutRows(cues) {
    if (rowsFor === cues) return;
    rowsFor = cues; rowOf = new Map();
    const ends = new Array(ROWS).fill(-1);
    for (const c of cues) {
      let r = ends.findIndex((e) => e <= c.start + 0.001);
      if (r < 0) r = ends.indexOf(Math.min(...ends));
      ends[r] = Math.max(ends[r], c.end); rowOf.set(c.id, r);
    }
  }
  const lowerBound = (cues, t) => { let lo = 0, hi = cues.length; while (lo < hi) { const m = (lo + hi) >> 1; if (cues[m].start < t) lo = m + 1; else hi = m; } return lo; };

  function tickStep() { for (const s of STEPS) if (s * pps >= 74) return s; return 3600; }

  /** draws what is in view (called after any scroll, zoom or data change) */
  function paint() {
    const { cues, sel, warn } = get();
    layoutRows(cues);
    inner.style.width = width() + 'px';
    const vw = scroll.clientWidth || 360;
    const x0 = scroll.scrollLeft - vw, x1 = scroll.scrollLeft + vw * 2;
    const t0 = Math.max(0, tOf(x0)), t1 = tOf(x1);
    // ruler
    const step = tickStep();
    const frag = document.createDocumentFragment();
    for (let k = Math.floor(t0 / step); k * step <= t1 && k * step <= dur() + step; k++) {
      const tt = round3(k * step);
      frag.append(h('span', { class: 'ss-tick' + (k % 2 === 0 ? ' maj' : ''), style: { left: xOf(tt) + 'px' } }, k % 2 === 0 || step >= 10 ? h('b', null, fmtTime(tt, step < 1)) : null));
    }
    ruler.replaceChildren(frag);
    // blocks: the cues that overlap [t0, t1]
    let maxLen = 1;
    for (const c of cues) if (c.end - c.start > maxLen) maxLen = c.end - c.start;
    const out = document.createDocumentFragment();
    for (let i = Math.max(0, lowerBound(cues, t0 - maxLen) - 1); i < cues.length && cues[i].start <= t1; i++) {
      const c = cues[i];
      if (c.end < t0) continue;
      out.append(block(c, c.id === sel, warn && warn.has(c.id)));
    }
    blocks.replaceChildren(out);
    movePlayhead();
  }

  function block(c, selected, warned) {
    const left = xOf(c.start), w = Math.max(5, (c.end - c.start) * pps);
    const b = h('div', { class: 'ss-b' + (selected ? ' sel' : '') + (warned ? ' warn' : ''), dataset: { id: c.id }, style: { left: left + 'px', width: w + 'px', top: 3 + (rowOf.get(c.id) || 0) * ROW_H + 'px' } },
      h('i', { class: 'h l', dataset: { grip: 'l' } }), h('span', { class: 'tx', dir: 'auto' }, c.text.replace(/\n/g, ' ')), h('i', { class: 'h r', dataset: { grip: 'r' } }));
    return b;
  }

  function movePlayhead() { ph.style.transform = `translateX(${xOf(get().now || 0)}px)`; }

  /** the playhead moved (the video played / was seeked) */
  function setPlayhead(playing) {
    movePlayhead();
    if (follow && playing) {
      const x = xOf(get().now || 0), vw = scroll.clientWidth;
      if (x > scroll.scrollLeft + vw - 40 || x < scroll.scrollLeft + 10) scroll.scrollLeft = Math.max(0, x - vw * 0.25);
    }
  }
  function ensureVisible(t, margin = 60) {
    const x = xOf(t), vw = scroll.clientWidth;
    if (x < scroll.scrollLeft + margin) scroll.scrollLeft = Math.max(0, x - vw * 0.3);
    else if (x > scroll.scrollLeft + vw - margin) scroll.scrollLeft = x - vw * 0.7;
  }

  function setZoom(next, anchorX = null) {
    const vw = scroll.clientWidth || 360;
    const ax = anchorX == null ? vw / 2 : anchorX;
    const tA = tOf(scroll.scrollLeft + ax);
    pps = Math.min(MAX_PPS, Math.max(MIN_PPS, next));
    paint();
    scroll.scrollLeft = Math.max(0, xOf(tA) - ax);
    paint();
    onZoom && onZoom(pps);
  }
  const fit = () => { const vw = scroll.clientWidth || 360; setZoom((vw - PAD * 2) / dur()); scroll.scrollLeft = 0; };

  let raf = 0;
  scroll.addEventListener('scroll', () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; paint(); }); }, { passive: true });
  scroll.addEventListener('wheel', (e) => { if (e.ctrlKey || e.metaKey) { e.preventDefault(); setZoom(pps * (e.deltaY < 0 ? 1.25 : 0.8), e.clientX - scroll.getBoundingClientRect().left); } }, { passive: false });

  /* ---- tap on the empty part = seek ---- */
  scroll.addEventListener('click', (e) => {
    if (e.target.closest('.ss-b')) return;
    const r = scroll.getBoundingClientRect();
    onSeek(Math.min(dur(), tOf(e.clientX - r.left + scroll.scrollLeft)));
  });

  /* ---- blocks: select / move / trim ---- */
  let g = null;
  const pointers = new Map();
  let pinch = null;
  scroll.addEventListener('pointerdown', (e) => {
    pointers.set(e.pointerId, e.clientX);
    if (pointers.size === 2) {                       // two fingers: zoom
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.abs(a - b) || 1, pps, cx: (a + b) / 2 };
      if (g) { g = null; }
      return;
    }
    const b = e.target.closest('.ss-b');
    if (!b) return;
    const id = b.dataset.id;
    const { sel, cues } = get();
    const c = cues.find((x) => x.id === id);
    if (!c) return;
    const wasSel = sel === id;
    if (!wasSel) onSelect(id, { seek: false });
    const grip = e.target.dataset && e.target.dataset.grip;
    g = { id, mode: !wasSel && e.pointerType === 'touch' ? 'tap' : grip === 'l' ? 'l' : grip === 'r' ? 'r' : 'move', x0: e.clientX, s0: c.start, e0: c.end, moved: false, node: b, pointer: e.pointerId, wasSel };
    if (g.mode !== 'tap') { try { b.setPointerCapture(e.pointerId); } catch { /* ignore */ } }
    if (wasSel || e.pointerType !== 'touch') { b.classList.add('sel'); }
  });
  scroll.addEventListener('pointermove', (e) => {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, e.clientX);
    if (pinch && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const r = scroll.getBoundingClientRect();
      setZoom(pinch.pps * (Math.abs(a - b) / pinch.d), (a + b) / 2 - r.left);
      return;
    }
    if (!g || g.mode === 'tap') return;
    const dt = (e.clientX - g.x0) / pps;
    if (!g.moved && Math.abs(e.clientX - g.x0) < 4) return;
    g.moved = true;
    const { cues, now } = get();
    const snapPx = 7 / pps;
    const edges = [now, ...cues.filter((c) => c.id !== g.id).flatMap((c) => [c.start, c.end])];
    const snap = (v) => { let best = v, bd = snapPx; for (const x of edges) { const d = Math.abs(x - v); if (d < bd) { bd = d; best = x; } } return best; };
    let s = g.s0, en = g.e0;
    if (g.mode === 'move') {
      const len = g.e0 - g.s0;
      let ns = Math.max(0, g.s0 + dt);
      const sA = snap(ns), sB = snap(ns + len) - len;
      ns = Math.abs(sA - ns) <= Math.abs(sB - ns) ? sA : sB;
      s = Math.max(0, ns); en = s + len;
    } else if (g.mode === 'l') { s = Math.min(Math.max(0, snap(g.s0 + dt)), g.e0 - MIN_LEN); }
    else { en = Math.max(snap(g.e0 + dt), g.s0 + MIN_LEN); }
    s = round3(s); en = round3(en);
    g.last = { start: s, end: en };
    g.node.style.left = xOf(s) + 'px'; g.node.style.width = Math.max(5, (en - s) * pps) + 'px';
    onChange(g.id, g.last, false);
  });
  const up = (e) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (!g || g.pointer !== e.pointerId) return;
    const d = g; g = null;
    if (d.moved && d.last) onChange(d.id, d.last, true);
    else if (e.type === 'pointerup') onSelect(d.id, { seek: true });
  };
  scroll.addEventListener('pointerup', up);
  scroll.addEventListener('pointercancel', (e) => { pointers.delete(e.pointerId); pinch = null; if (g && g.pointer === e.pointerId) g = null; });

  const api = {
    el, scroll, paint, setPlayhead, ensureVisible, setZoom, fit,
    zoomBy: (f) => setZoom(pps * f),
    get pps() { return pps; },
    setFollow(v) { follow = !!v; },
    markSel(id) { blocks.querySelectorAll('.ss-b').forEach((b) => b.classList.toggle('sel', b.dataset.id === id)); },
    /** a cue changed: forget the row layout */
    dirty() { rowsFor = null; },
  };
  return api;
}
