// Photo viewer: swipe between photos, pinch / double-tap zoom, swipe down to close, slideshow.
import { h, clamp } from '../util.js';
import { ic } from '../icons.js';
import { t } from '../i18n.js';
import { state, getBlob } from '../store.js';
import { mountViewer, touchOpened, barBtn } from './common.js';
import { exportItem, itemDetails, toggleFav, deleteItems } from '../actions.js';

export function openImages(startId, listIds = []) {
  const start = state.items.get(startId);
  if (!start) return;
  const items = listIds.map((i) => state.items.get(i)).filter((it) => it && it.kind === 'image');
  let idx = items.findIndex((i) => i.id === startId);
  if (idx < 0) { items.unshift(start); idx = 0; }

  const urls = new Map(); // id -> object url (kept for idx-2..idx+2)
  let scale = 1, tx = 0, ty = 0;
  let slideshow = 0;
  let uiVisible = true;
  const ptrs = new Map();
  let mode = null; // 'swipe' | 'pan' | 'pinch' | 'dismiss'
  let sx = 0, sy = 0, dx = 0, dy = 0, t0 = 0, moved = false;
  let pinch = null;
  let lastTap = 0, lastTapX = 0, lastTapY = 0;

  const V = mountViewer('imgv', { onClose: cleanup });
  const root = V.el;

  const slides = [0, 1, 2].map(() => h('div', { class: 'iv-slide' }, h('img', { alt: '', draggable: 'false' })));
  const track = h('div', { class: 'iv-track' }, slides);
  const stage = h('div', { class: 'iv-stage' }, track);
  const counter = h('div', { class: 'iv-count' });
  const nameEl = h('div', { class: 'iv-name', dir: 'auto' });
  const favBtn = barBtn('star', t('favorite'), () => { toggleFav([items[idx].id]); setTimeout(updateBar, 60); });
  const playBtn = barBtn('play', t('slideshow'), () => toggleSlideshow());
  const top = h('div', { class: 'iv-top' },
    h('button', { class: 'vbtn', 'aria-label': t('back'), onClick: () => V.close(), html: ic('back', 'flip-rtl') }),
    h('div', { class: 'iv-titles' }, counter, nameEl),
    playBtn, favBtn,
    barBtn('info', t('details'), () => itemDetails(items[idx].id)),
    barBtn('share', t('exportOpenWith'), () => exportItem(items[idx].id)),
    barBtn('trash', t('delete'), async () => {
      const id = items[idx].id;
      if (await deleteItems([id])) {
        items.splice(idx, 1);
        if (!items.length) { V.close(); return; }
        idx = Math.min(idx, items.length - 1);
        render();
      }
    }));
  root.append(stage, top);

  /* ---------- image loading ---------- */
  async function urlFor(i) {
    const it = items[i];
    if (!it) return '';
    if (urls.has(it.id)) return urls.get(it.id);
    const b = await getBlob(it.id);
    if (!b) return '';
    const u = URL.createObjectURL(b);
    urls.set(it.id, u);
    return u;
  }
  function trim() {
    const keep = new Set([idx - 2, idx - 1, idx, idx + 1, idx + 2].filter((i) => items[i]).map((i) => items[i].id));
    for (const [id, u] of urls) if (!keep.has(id)) { URL.revokeObjectURL(u); urls.delete(id); }
  }

  async function render() {
    resetZoom(false);
    setTrack(0, false);
    const tok = (render.tok = (render.tok || 0) + 1);
    const want = [idx - 1, idx, idx + 1];
    for (let n = 0; n < 3; n++) {
      const img = slides[n].firstChild;
      const i = want[n];
      if (!items[i]) { img.removeAttribute('src'); img.style.visibility = 'hidden'; continue; }
      urlFor(i).then((u) => { if (tok !== render.tok) return; img.src = u; img.style.visibility = ''; });
    }
    updateBar();
    touchOpened(items[idx].id);
    trim();
  }
  function updateBar() {
    const it = items[idx];
    if (!it) return;
    counter.textContent = `${idx + 1} / ${items.length}`;
    nameEl.textContent = it.name;
    favBtn.classList.toggle('on', !!it.fav);
  }

  /* ---------- transforms ---------- */
  const imgEl = () => slides[1].firstChild;
  function applyZoom(animate = false) {
    const img = imgEl();
    img.style.transition = animate ? 'transform .22s cubic-bezier(.2,.8,.2,1)' : 'none';
    img.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
  }
  function resetZoom(animate = true) { scale = 1; tx = 0; ty = 0; applyZoom(animate); }
  function setTrack(px, animate) {
    track.style.transition = animate ? 'transform .28s cubic-bezier(.2,.8,.2,1)' : 'none';
    track.style.transform = `translate3d(${px}px,0,0)`;
  }
  function bounds() {
    const img = imgEl();
    const r = stage.getBoundingClientRect();
    const iw = img.naturalWidth || r.width, ih = img.naturalHeight || r.height;
    const fit = Math.min(r.width / iw, r.height / ih);
    const w = iw * fit * scale, hgt = ih * fit * scale;
    return { mx: Math.max(0, (w - r.width) / 2), my: Math.max(0, (hgt - r.height) / 2) };
  }
  function clampPan() { const b = bounds(); tx = clamp(tx, -b.mx, b.mx); ty = clamp(ty, -b.my, b.my); }

  function zoomAt(newScale, fx, fy, animate) {
    const r = stage.getBoundingClientRect();
    const px = fx - r.left - r.width / 2, py = fy - r.top - r.height / 2;
    const ratio = newScale / scale;
    tx = px - (px - tx) * ratio; ty = py - (py - ty) * ratio;
    scale = newScale;
    if (scale <= 1.001) { scale = 1; tx = 0; ty = 0; } else clampPan();
    applyZoom(animate);
  }

  /* ---------- pointer gestures ---------- */
  const W = () => stage.clientWidth;

  stage.addEventListener('pointerdown', (e) => {
    stage.setPointerCapture(e.pointerId);
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.size === 1) { sx = e.clientX; sy = e.clientY; dx = dy = 0; t0 = performance.now(); moved = false; mode = null; }
    if (ptrs.size === 2) {
      const [a, b] = [...ptrs.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), s: scale, tx, ty, fx: (a.x + b.x) / 2, fy: (a.y + b.y) / 2 };
      mode = 'pinch'; moved = true;
      setTrack(0, false);
    }
  });

  stage.addEventListener('pointermove', (e) => {
    if (!ptrs.has(e.pointerId)) return;
    const p = ptrs.get(e.pointerId);
    const px = p.x, py = p.y;
    p.x = e.clientX; p.y = e.clientY;

    if (mode === 'pinch' && ptrs.size >= 2 && pinch) {
      const [a, b] = [...ptrs.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const fx = (a.x + b.x) / 2, fy = (a.y + b.y) / 2;
      const ns = clamp(pinch.s * (d / pinch.d), 1, 8);
      const r = stage.getBoundingClientRect();
      const qx = (pinch.fx - r.left - r.width / 2 - pinch.tx) / pinch.s;
      const qy = (pinch.fy - r.top - r.height / 2 - pinch.ty) / pinch.s;
      scale = ns;
      tx = (fx - r.left - r.width / 2) - ns * qx;
      ty = (fy - r.top - r.height / 2) - ns * qy;
      applyZoom(false);
      return;
    }
    if (ptrs.size !== 1) return;
    dx = e.clientX - sx; dy = e.clientY - sy;
    if (!mode && Math.hypot(dx, dy) > 8) {
      moved = true;
      if (scale > 1.01) mode = 'pan';
      else mode = Math.abs(dx) > Math.abs(dy) ? 'swipe' : 'dismiss';
    }
    if (mode === 'pan') {
      tx += e.clientX - px; ty += e.clientY - py;
      const b = bounds();
      // let a horizontal drag past the edge turn into a swipe to the next photo
      tx = clamp(tx, -b.mx, b.mx); ty = clamp(ty, -b.my, b.my);
      applyZoom(false);
    } else if (mode === 'swipe') {
      const atStart = idx === 0 && dx > 0, atEnd = idx === items.length - 1 && dx < 0;
      setTrack(atStart || atEnd ? dx * 0.25 : dx, false);
    } else if (mode === 'dismiss') {
      const img = imgEl();
      img.style.transition = 'none';
      img.style.transform = `translate(0px, ${dy}px) scale(${clamp(1 - Math.abs(dy) / 900, 0.7, 1)})`;
      root.style.setProperty('--dim', String(clamp(1 - Math.abs(dy) / 380, 0.15, 1)));
    }
  });

  const finish = (e) => {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.delete(e.pointerId);
    if (mode === 'pinch') {
      if (ptrs.size < 2) { pinch = null; if (scale < 1.05) resetZoom(true); else { clampPan(); applyZoom(true); } mode = ptrs.size ? 'pan' : null; }
      return;
    }
    if (ptrs.size) return;
    const dt = performance.now() - t0;
    const vx = dx / Math.max(dt, 1);
    if (mode === 'swipe') {
      const goNext = dx < -W() * 0.2 || vx < -0.5;
      const goPrev = dx > W() * 0.2 || vx > 0.5;
      if (goNext && idx < items.length - 1) slide(1);
      else if (goPrev && idx > 0) slide(-1);
      else setTrack(0, true);
    } else if (mode === 'dismiss') {
      if (Math.abs(dy) > 120) { V.close(); return; }
      applyZoom(true); root.style.setProperty('--dim', '1');
    } else if (mode === 'pan') {
      clampPan(); applyZoom(true);
    } else if (!moved && dt < 350) {
      const now = performance.now();
      if (now - lastTap < 300 && Math.hypot(e.clientX - lastTapX, e.clientY - lastTapY) < 50) {
        lastTap = 0;
        if (scale > 1.05) resetZoom(true); else zoomAt(2.6, e.clientX, e.clientY, true);
      } else {
        lastTap = now; lastTapX = e.clientX; lastTapY = e.clientY;
        setTimeout(() => { if (lastTap === now) toggleUI(); }, 300);
      }
    }
    mode = null;
  };
  stage.addEventListener('pointerup', finish);
  stage.addEventListener('pointercancel', finish);

  stage.addEventListener('wheel', (e) => {
    e.preventDefault();
    const ns = clamp(scale * (e.deltaY < 0 ? 1.18 : 1 / 1.18), 1, 8);
    zoomAt(ns, e.clientX, e.clientY, false);
  }, { passive: false });

  function slide(dir) {
    setTrack(-dir * W(), true);
    const tok = ++slide.tok || (slide.tok = 1);
    setTimeout(() => {
      if (slide.tok !== tok) return;
      idx += dir;
      render();
    }, 270);
  }

  function toggleUI() { uiVisible = !uiVisible; root.classList.toggle('chrome-off', !uiVisible); }

  function toggleSlideshow() {
    if (slideshow) { clearInterval(slideshow); slideshow = 0; playBtn.innerHTML = ic('play'); root.classList.remove('chrome-off'); uiVisible = true; return; }
    playBtn.innerHTML = ic('pause');
    uiVisible = false; root.classList.add('chrome-off');
    slideshow = setInterval(() => {
      if (idx < items.length - 1) slide(1);
      else { idx = 0; render(); }
    }, 3600);
  }

  const onKey = (e) => {
    if (e.key === 'ArrowRight') { if (idx < items.length - 1) slide(1); }
    else if (e.key === 'ArrowLeft') { if (idx > 0) slide(-1); }
    else if (e.key === 'Escape') V.close();
    else if (e.key === '+') zoomAt(clamp(scale * 1.3, 1, 8), innerWidth / 2, innerHeight / 2, true);
    else if (e.key === '-') zoomAt(clamp(scale / 1.3, 1, 8), innerWidth / 2, innerHeight / 2, true);
  };
  document.addEventListener('keydown', onKey);

  function cleanup() {
    clearInterval(slideshow);
    document.removeEventListener('keydown', onKey);
    urls.forEach((u) => URL.revokeObjectURL(u));
    urls.clear();
  }

  render();
}
