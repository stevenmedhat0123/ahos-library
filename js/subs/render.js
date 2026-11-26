// Draws subtitles over a <video> by itself (not the browser's built-in cue box), so every setting is honoured:
// size, colour, box, outline, font, alignment, exact position and fade, the same on every screen.
// Sizes are a percentage of the picture's height, positions a percentage of its width/height (see model.js).
import { activeAt, resolveStyle } from './model.js';

const FONT_CSS = {
  sans: 'system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", "Noto Naskh Arabic", Arial, sans-serif',
  serif: 'Georgia, "Times New Roman", "Noto Naskh Arabic", "Noto Serif", serif',
  mono: 'ui-monospace, "Courier New", Consolas, monospace',
  hand: '"Comic Sans MS", "Segoe Print", "Bradley Hand", "Noto Sans", cursive',
};
const DIRS = Array.from({ length: 16 }, (_, i) => [Math.cos((i * Math.PI) / 8), Math.sin((i * Math.PI) / 8)]);
export const MARGIN_X = 4, MARGIN_Y = 6;           // % of the picture: where an automatic subtitle sits from the edge

const rgba = (hex, a) => { const n = parseInt(String(hex).slice(1), 16) || 0; return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.round(a * 1000) / 1000})`; };

/** text-shadow list: the outline is a ring of copies around the letters, then the soft drop shadow. */
export function shadowCss(s) {
  const parts = [];
  if (s.ol > 0) {
    const r = s.ol / 100;
    for (const [dx, dy] of DIRS) parts.push(`${(dx * r).toFixed(3)}em ${(dy * r).toFixed(3)}em 0 ${s.olc}`);
    if (s.ol > 6) for (const [dx, dy] of DIRS) parts.push(`${(dx * r * 0.55).toFixed(3)}em ${(dy * r * 0.55).toFixed(3)}em 0 ${s.olc}`);
  }
  if (s.shadow) parts.push('0 .06em .14em rgba(0,0,0,.75)');
  return parts.length ? parts.join(',') : 'none';
}

/** Where the anchor point of a cue is by default for alignment `an` (percent of the picture). */
export function defaultAnchor(an) {
  const col = (an - 1) % 3, row = Math.floor((an - 1) / 3);
  return { x: col === 0 ? MARGIN_X : col === 2 ? 100 - MARGIN_X : 50, y: row === 0 ? 100 - MARGIN_Y : row === 1 ? 50 : MARGIN_Y };
}

/** The rectangle of the real picture inside `host` for a <video> (object-fit aware, clipped to the host). */
export function frameRect(video, host) {
  const W = video.offsetWidth || host.clientWidth, H = video.offsetHeight || host.clientHeight;
  const vw = video.videoWidth, vh = video.videoHeight;
  let fw = W, fh = H;
  if (vw && vh && W && H) {
    const fit = getComputedStyle(video).objectFit;
    if (fit !== 'fill') { const k = fit === 'cover' ? Math.max(W / vw, H / vh) : Math.min(W / vw, H / vh); fw = vw * k; fh = vh * k; }
  }
  const left = (video.offsetLeft || 0) + (W - fw) / 2, top = (video.offsetTop || 0) + (H - fh) / 2;
  const hw = host.clientWidth || W, hh = host.clientHeight || H;
  const l = Math.max(0, left), t = Math.max(0, top), r = Math.min(hw, left + fw), b = Math.min(hh, top + fh);
  return { left: l, top: t, width: Math.max(1, r - l), height: Math.max(1, b - t) };
}

/** Builds one cue box. */
function buildCue(cue, s) {
  const box = document.createElement('div');
  box.className = 'sbr-c';
  box.dataset.id = cue.id;
  box.setAttribute('dir', 'auto');
  const col = (s.an - 1) % 3, row = Math.floor((s.an - 1) / 3);
  box.style.textAlign = col === 0 ? 'left' : col === 2 ? 'right' : 'center';
  box.style.fontSize = `calc(var(--u) * ${s.size})`;
  box.style.fontFamily = FONT_CSS[s.font] || FONT_CSS.sans;
  if (s.op < 1) box.style.opacity = String(s.op);
  const span = document.createElement('span');
  span.className = 'sbr-t';
  span.textContent = cue.text;
  span.style.color = s.color;
  span.style.textShadow = shadowCss(s);
  if (s.b) span.style.fontWeight = '700';
  if (s.i) span.style.fontStyle = 'italic';
  if (s.u) span.style.textDecoration = 'underline';
  if (s.bgOp > 0) { span.style.backgroundColor = rgba(s.bg, s.bgOp); span.classList.add('boxed'); }
  box.append(span);
  if (s.pos) {
    box.classList.add('pos');
    box.style.left = s.pos.x + '%';
    box.style.top = s.pos.y + '%';
    box.style.transform = `translate(${col === 0 ? '0' : col === 1 ? '-50%' : '-100%'}, ${row === 0 ? '-100%' : row === 1 ? '-50%' : '0'})`;
    const room = col === 0 ? 100 - s.pos.x : col === 2 ? s.pos.x : 2 * Math.min(s.pos.x, 100 - s.pos.x);
    box.style.maxWidth = Math.max(12, Math.min(96, room)) + '%';
  }
  if (s.fade > 0) box.style.setProperty('--fade', s.fade + 'ms');
  return { box, col, row };
}

/**
 * createSubRenderer(host, video, { interactive, onDrag, onDragEnd })
 *   host   the element that holds the video (the overlay is added to it and follows the picture's real rectangle)
 *   video  the <video> whose clock drives the subtitles
 *   frame  optional () => {left, top, width, height} | null: the area subtitles are placed in instead of the picture's own rectangle (the player uses the whole screen when the picture is zoomed to fill it; the text size stays the one of the normal picture)
 * returns { setTrack, setBase, setSelected, setEnabled, touch, layout, update, frame, destroy, el }
 */
export function createSubRenderer(host, video, { interactive = false, onDrag = null, onDragEnd = null, getSnap = () => true, frame = null } = {}) {
  const el = document.createElement('div');
  el.className = 'sbr' + (interactive ? ' live' : '');
  el.setAttribute('aria-hidden', 'true');
  const regions = [];
  for (let an = 1; an <= 9; an++) { const r = document.createElement('div'); r.className = `sbr-r a${an}`; el.append(r); regions[an] = r; }
  const guideV = document.createElement('i'); guideV.className = 'sbr-g v';
  const guideH = document.createElement('i'); guideH.className = 'sbr-g h';
  el.append(guideV, guideH);
  host.append(el);

  let track = null, base = null, sorted = [], maxLen = 10, selected = null, enabled = true, version = 0, drawn = '';
  let rect = { left: 0, top: 0, width: 1, height: 1 };
  let raf = 0, destroyed = false;
  const els = new Map();

  function layout() {
    if (destroyed) return;
    const natural = frameRect(video, host);
    rect = (frame && frame()) || natural;
    el.style.left = rect.left + 'px'; el.style.top = rect.top + 'px'; el.style.width = rect.width + 'px'; el.style.height = rect.height + 'px';
    el.style.setProperty('--u', natural.height / 100 + 'px');   // text size follows the picture as it normally sits, even when positions use the whole screen
  }

  function wanted() {
    if (!enabled || !track) return [];
    const t = video.currentTime || 0;
    const list = activeAt(sorted, t, maxLen).map((c) => ({ c, ghost: false }));
    if (selected) {
      const sc = sorted.find((c) => c.id === selected);
      if (sc && !list.some((x) => x.c.id === sc.id)) list.push({ c: sc, ghost: true });
    }
    return list;
  }

  function update(force = false) {
    if (destroyed) return;
    const list = wanted();
    const key = list.map((x) => x.c.id + (x.ghost ? 'g' : '') + (x.c.id === selected ? 's' : '')).join('|') + '#' + version;
    if (!force && key === drawn) return;
    const rebuild = drawn.split('#')[1] !== String(version) || force;
    drawn = key;
    const keep = new Set(list.map((x) => x.c.id));
    for (const [id, node] of els) if (!keep.has(id) || rebuild) { node.remove(); els.delete(id); }
    for (const { c, ghost } of list) {
      let node = els.get(c.id);
      if (!node) {
        const s = resolveStyle(c, track, base);
        const built = buildCue(c, s);
        node = built.box;
        node.__an = s.an;
        (s.pos ? el : regions[s.an]).append(node);
        if (s.fade > 0 && !rebuild && !ghost) node.classList.add('fadein');
        els.set(c.id, node);
      }
      node.classList.toggle('ghost', ghost);
      node.classList.toggle('sel', c.id === selected);
    }
  }

  const tick = () => { raf = 0; if (destroyed) return; update(); if (!video.paused && !video.ended) raf = requestAnimationFrame(tick); };
  const kick = () => { if (!raf && !destroyed) raf = requestAnimationFrame(tick); };
  const evs = ['play', 'playing', 'seeking', 'seeked', 'timeupdate', 'pause', 'loadedmetadata', 'resize', 'ratechange', 'emptied'];
  const onEv = (e) => { if (e.type === 'loadedmetadata' || e.type === 'resize' || e.type === 'emptied') layout(); update(); if (!video.paused) kick(); };
  evs.forEach((n) => video.addEventListener(n, onEv));
  let ro = null;
  if (typeof ResizeObserver !== 'undefined') { ro = new ResizeObserver(() => { layout(); update(true); }); ro.observe(host); }
  window.addEventListener('resize', layout);

  /* ---- dragging the selected cue on the picture ---- */
  let drag = null;
  const pct = (e) => ({ x: ((e.clientX - el.getBoundingClientRect().left) / rect.width) * 100, y: ((e.clientY - el.getBoundingClientRect().top) / rect.height) * 100 });
  function snapTo(v, targets, within) { for (const t of targets) if (Math.abs(v - t) <= within) return { v: t, hit: true }; return { v, hit: false }; }
  if (interactive) {
    el.addEventListener('pointerdown', (e) => {
      const box = e.target.closest && e.target.closest('.sbr-c');
      if (!box || box.dataset.id !== selected) return;
      const c = sorted.find((x) => x.id === selected);
      if (!c) return;
      const s = resolveStyle(c, track, base);
      const col = (s.an - 1) % 3, row = Math.floor((s.an - 1) / 3);
      const br = box.getBoundingClientRect(), er = el.getBoundingClientRect();
      const ax = (col === 0 ? br.left : col === 1 ? br.left + br.width / 2 : br.right) - er.left;
      const ay = (row === 2 ? br.top : row === 1 ? br.top + br.height / 2 : br.bottom) - er.top;
      const start = s.pos || { x: (ax / rect.width) * 100, y: (ay / rect.height) * 100 };
      drag = { id: c.id, p0: pct(e), start, moved: false, pointer: e.pointerId };
      try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      e.preventDefault();
    });
    el.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const p = pct(e);
      let x = drag.start.x + (p.x - drag.p0.x), y = drag.start.y + (p.y - drag.p0.y);
      if (!drag.moved && Math.hypot(p.x - drag.p0.x, p.y - drag.p0.y) < 0.8) return;
      drag.moved = true;
      x = Math.min(100, Math.max(0, x)); y = Math.min(100, Math.max(0, y));
      let gx = false, gy = false;
      if (getSnap()) {
        const sx = snapTo(x, [50, MARGIN_X, 100 - MARGIN_X], 1.6), sy = snapTo(y, [50, MARGIN_Y, 100 - MARGIN_Y], 1.6);
        x = sx.v; y = sy.v; gx = sx.hit; gy = sy.hit;
      }
      guideV.classList.toggle('on', gx); guideV.style.left = x + '%';
      guideH.classList.toggle('on', gy); guideH.style.top = y + '%';
      onDrag && onDrag(drag.id, { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 });
    });
    const end = () => { if (!drag) return; const d = drag; drag = null; guideV.classList.remove('on'); guideH.classList.remove('on'); if (d.moved) onDragEnd && onDragEnd(d.id); };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }

  layout();

  return {
    el,
    /** The track to draw (v2 track; `base` = look for tracks that carry no style of their own). */
    setTrack(tr) { track = tr; sorted = tr ? tr.cues.slice().sort((a, b) => a.start - b.start) : []; maxLen = sorted.reduce((m, c) => Math.max(m, c.end - c.start), 1); version++; update(true); },
    setBase(b) { base = b; version++; update(true); },
    setSelected(id) { selected = id || null; update(true); },
    setEnabled(on) { enabled = !!on; el.style.display = enabled ? '' : 'none'; update(true); },
    get enabled() { return enabled; },
    /** the cue styles changed (not the list): draw again. */
    touch() { version++; update(true); },
    layout() { layout(); update(true); },
    update,
    frame: () => ({ ...rect }),
    destroy() {
      destroyed = true;
      cancelAnimationFrame(raf);
      evs.forEach((n) => video.removeEventListener(n, onEv));
      window.removeEventListener('resize', layout);
      if (ro) ro.disconnect();
      el.remove();
    },
  };
}
