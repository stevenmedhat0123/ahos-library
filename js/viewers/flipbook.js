// A real-looking book: two pages side by side, pages that bend and turn with soft shading, drag-to-turn, tap-to-turn,
// zoom to the left / right page, single-page mode, right-to-left binding. Used by the PDF reader and by the whiteboard.
//
// How a turning page works (kept cheap on purpose): the page is cut into 9 thin slices nested inside each other. Every slice is turned
// a little further than the one before it, so the page is a smooth curve, and the GPU does all the drawing (CSS 3D, no per-frame canvas work).
// Each slice has a front face, a back face (the next page, already turned the right way round) and a dark layer whose opacity follows the angle.
import { h } from '../util.js';

const K0 = 9;                         // slices per leaf (a cheap leaf for fast cascades uses 4): fewer slices = far fewer layers for the GPU, the bend still looks smooth
const D2R = Math.PI / 180;
export const ease = (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);          // easeInOutCubic
export const easeOut = (p) => 1 - Math.pow(1 - p, 3);
export function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16), f = (v) => Math.max(0, Math.min(255, v + amt));
  return '#' + [f(n >> 16), f((n >> 8) & 255), f(n & 255)].map((v) => v.toString(16).padStart(2, '0')).join('');
}

/** Copies a bitmap (canvas / image) into a canvas of exactly w×h (contain, white paper behind it). */
export function fitBitmap(src, w, h2, { night = false, paper = '#fbfaf6' } = {}) {
  const cv = document.createElement('canvas'); cv.width = Math.max(1, Math.round(w)); cv.height = Math.max(1, Math.round(h2));
  const c = cv.getContext('2d');
  c.fillStyle = paper; c.fillRect(0, 0, cv.width, cv.height);
  if (src) {
    const sw = src.width, sh = src.height, k = Math.min(cv.width / sw, cv.height / sh), dw = sw * k, dh = sh * k;
    c.drawImage(src, (cv.width - dw) / 2, (cv.height - dh) / 2, dw, dh);
  }
  if (night) { c.globalCompositeOperation = 'difference'; c.fillStyle = '#fff'; c.fillRect(0, 0, cv.width, cv.height); c.globalCompositeOperation = 'source-over'; c.fillStyle = 'rgba(0,0,0,.18)'; c.fillRect(0, 0, cv.width, cv.height); }
  return cv;
}

/**
 * One turning leaf. `front` is what you see first, `back` what you see once it has turned over (both canvases of the same size, or null = blank paper).
 * dir = +1: hinged on its left edge, turns to the left (the right page of a book turning over).  dir = −1: the mirror image.
 * Put `leaf.el` (and `leaf.shadow`, below it) inside an element with `perspective`, with the leaf's left edge on the spine.
 */
export function createLeaf({ pw, ph, front, back, dir = 1, mirror = false, paper = '#fbfaf6', cheap = false }) {
  const K = cheap ? 4 : K0;
  const sw = pw / K;
  const wrap = h('div', { class: 'fb-leaf', style: { width: '0', height: ph + 'px', transform: dir < 0 ? 'scaleX(-1)' : 'none' } });
  const shadow = h('div', { class: 'fb-leaf-shadow', style: { height: ph + 'px' } });
  const shadowWrap = h('div', { class: 'fb-leaf-shw', style: { height: ph + 'px', transform: dir < 0 ? 'scaleX(-1)' : 'none' } }, shadow);
  const slices = [];
  const flipF = dir < 0 !== mirror, flipB = dir < 0 !== mirror;
  let parent = wrap;
  for (let i = 0; i < K; i++) {
    const s = h('div', { class: 'fb-sl', style: { left: (i ? sw : 0) + 'px', width: sw + 0.8 + 'px', height: ph + 'px' } });
    const mk = (bm, srcRange, flip, isBack) => {
      const face = h('div', { class: 'fb-face' + (isBack ? ' back' : '') });
      if (cheap && !bm) { const shade = h('i', { class: 'fb-sh' }); face.append(shade); return { face, shade }; }
      const cv = document.createElement('canvas');
      const res = bm ? bm.width / pw : 2;
      cv.width = Math.max(1, Math.round((sw + 0.8) * res)); cv.height = Math.max(1, Math.round(ph * res));
      const c = cv.getContext('2d');
      if (!bm) { c.fillStyle = paper; c.fillRect(0, 0, cv.width, cv.height); }
      else {
        const sx = srcRange * res, sWidth = Math.min(bm.width - sx, (sw + 0.8) * res);
        if (flip) { c.translate(cv.width, 0); c.scale(-1, 1); }
        c.drawImage(bm, Math.max(0, sx), 0, Math.max(1, sWidth), bm.height, 0, 0, flip ? cv.width : cv.width, cv.height);
      }
      cv.className = 'fb-cv';
      const shade = h('i', { class: 'fb-sh' });
      face.append(cv, shade);
      return { face, shade };
    };
    // see the notes in the design: dir=+1  front[i·sw…] back[pw−(i+1)·sw…]; dir=−1  front[pw−(i+1)·sw…] back[i·sw…]
    const fSrc = dir > 0 ? i * sw : pw - (i + 1) * sw, bSrc = dir > 0 ? pw - (i + 1) * sw : i * sw;
    const F = mk(front, fSrc, flipF, false), B = mk(back, bSrc, flipB, true);
    s.append(F.face, B.face);
    parent.append(s); parent = s;
    slices.push({ el: s, fs: F.shade, bs: B.shade });
  }
  /** p: 0 (lying flat, front up) … 1 (turned over, back up). Returns the horizontal reach of the free edge in px (+ = on the starting side). */
  function set(p) {
    const th = 180 * p, d = (cheap ? 14 : 8.4) * Math.sin(Math.PI * p);
    const a0 = th - ((K - 1) * d) / 2;
    let x = 0;
    for (let i = 0; i < K; i++) {
      const sl = slices[i], g = a0 + i * d;                // global angle of this slice
      sl.el.style.transform = `rotateY(${(i ? -d : -a0).toFixed(2)}deg)`;
      const r = g * D2R, s = Math.sin(r), cs = Math.cos(r);
      sl.fs.style.opacity = (0.5 * Math.pow(Math.abs(s), 1.15) * (cs > 0 ? 1 : 0.4)).toFixed(3);
      sl.bs.style.opacity = (0.5 * Math.pow(Math.abs(s), 1.15) * (cs < 0 ? 1 : 0.4)).toFixed(3);
      x += sw * cs;
    }
    const k = Math.sin(Math.PI * p);
    const lo = Math.min(0, x), hi = Math.max(0, x), soft = pw * 0.16 * k;
    shadow.style.left = (lo - (x < 0 ? soft : 0)) + 'px';
    shadow.style.width = (hi - lo + soft) + 'px';
    shadow.style.opacity = (0.55 * Math.pow(k, 0.7)).toFixed(3);
    shadow.style.background = x >= 0
      ? `linear-gradient(to right, rgba(0,0,0,.55), rgba(0,0,0,.18) ${Math.round(100 * (hi - lo) / Math.max(1, hi - lo + soft))}%, rgba(0,0,0,0))`
      : `linear-gradient(to left, rgba(0,0,0,.55) ${Math.round(100 * soft / Math.max(1, hi - lo + soft))}%, rgba(0,0,0,.2), rgba(0,0,0,0))`;
    return x;
  }
  set(0);
  return { el: wrap, shadow: shadowWrap, set, destroy() { wrap.remove(); shadowWrap.remove(); } };
}

/* ============================== the whole book ============================== */
/**
 * opts: { host, N, ratio (page width / height), getBitmap(n, widthPx) → Promise<canvas|image|null>, onPage(n), rtl, cover, mode:'spread'|'single',
 *         focus:'both'|'left'|'right', night, page }
 * Pages are 1-based. With cover = true page 1 sits alone on the right (the book is closed); spreads are 2|3, 4|5 …
 */
export function createFlipBook(opts) {
  const o = { rtl: false, cover: true, backCover: true, mode: 'spread', focus: 'both', night: false, page: 1, view: 'classic', ...opts };
  const N = o.N;
  const host = o.host;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const el = h('div', { class: 'fb bv-' + (opts.view || 'classic') });
  const cam = h('div', { class: 'fb-cam' });                  // the "camera": tilts the whole open book (see the views in bookviews.js)
  const floor = h('div', { class: 'fb-floor' });              // the soft shadow the book casts on the surface it lies on
  const zoomEl = h('div', { class: 'fb-zoom' });
  const book = h('div', { class: 'fb-book' });
  const pgL = h('div', { class: 'fb-pg l' }, h('canvas', { class: 'fb-cv' })), pgR = h('div', { class: 'fb-pg r' }, h('canvas', { class: 'fb-cv' }));
  const gutter = h('div', { class: 'fb-gutter' });
  const loadL = h('div', { class: 'fb-wait' }), loadR = h('div', { class: 'fb-wait' });
  pgL.append(loadL); pgR.append(loadR);
  book.append(floor, pgL, pgR, gutter);
  zoomEl.append(book); cam.append(zoomEl); el.append(cam); host.append(el);

  let S = 1, s = 0, pw = 100, ph = 140, bw = 200, destroyed = false, busy = false, drag = null, pxW = 600;
  const cache = new Map();                 // `${n}:${pxW}:${night}` → canvas
  const pending = new Map();

  /* ----- which pages are on which side ----- */
  // With a cover the book starts closed (page 1 alone on the right). With backCover it also ends closed: the last real spread is followed by one
  // more "closed" spread that shows the back cover (a virtual page). A blank pad page is added when the last page would be left without a partner.
  const single = () => o.mode === 'single';
  const padded = () => !single() && o.cover && o.backCover && N % 2 === 0;
  const Mx = () => (padded() ? N + 1 : N);
  const BK = () => Mx() + 1;                                  // virtual back cover page number
  const spreadCount = () => (single() ? N : o.cover ? (o.backCover ? Math.floor(Mx() / 2) + 2 : Math.floor(N / 2) + 1) : Math.ceil(N / 2));
  const pagesOf = (sp) => {
    if (sp < 0 || sp >= spreadCount()) return [0, 0];
    if (single()) return [0, sp + 1];
    if (o.cover) {
      if (sp === 0) return [0, 1];
      if (o.backCover && sp === spreadCount() - 1) return [BK(), 0];
      const lim = o.backCover ? Mx() : N, l = sp * 2, r = l + 1;
      return [l <= lim ? l : 0, r <= lim ? r : 0];
    }
    const l = sp * 2 + 1, r = l + 1; return [l <= N ? l : 0, r <= N ? r : 0];
  };
  const spreadOf = (p) => { p = Math.max(1, Math.min(N, p)); return single() ? p - 1 : o.cover ? (p === 1 ? 0 : Math.floor(p / 2)) : Math.floor((p - 1) / 2); };
  const curPage = () => { const [l, r] = pagesOf(s); return Math.min(N, r || l || 1); };

  /* ----- geometry ----- */
  function measure() {
    const W = host.clientWidth || 360, Hh = host.clientHeight || 520, padX = 10, padY = 12;
    const aw = Math.max(80, W - padX * 2), ah = Math.max(80, Hh - padY * 2);
    pw = Math.min(aw / 2, ah * o.ratio); ph = pw / o.ratio; bw = pw * 2;
    // the biggest a page is ever shown (zoomed onto one page)
    const kMax = Math.min(aw / pw, ah / ph);
    pxW = Math.round(Math.min(1100, Math.max(360, pw * kMax * dpr)));
    book.style.width = bw + 'px'; book.style.height = ph + 'px';
    pgL.style.cssText = `left:0;width:${pw}px;height:${ph}px`; pgR.style.cssText = `left:${pw}px;width:${pw}px;height:${ph}px`;
    gutter.style.cssText = `left:${pw - pw * 0.06}px;width:${pw * 0.12}px;height:${ph}px`;
    return { aw, ah, kMax };
  }
  function applyFocus(animate = true) {
    const { aw, ah } = measure1();
    let f = single() ? 'right' : o.focus;
    const kOne = Math.min(aw / pw, ah / ph);
    let k = 1, tx = 0;
    if (f === 'left') { k = kOne; tx = (pw / 2) * k; }       // bring the left page's centre to the middle
    else if (f === 'right') { k = kOne; tx = (-pw / 2) * k; }
    zoomEl.style.transition = animate ? 'transform .42s cubic-bezier(.2,.8,.2,1)' : 'none';
    zoomEl.style.transform = `translate3d(${tx.toFixed(1)}px,0,0) scale(${k.toFixed(4)})`;
    // a closed book (just the cover) sits in the middle; so does the back cover
    applyShift(animate);
  }
  const measure1 = () => { const W = host.clientWidth || 360, Hh = host.clientHeight || 520; return { aw: Math.max(80, W - 20), ah: Math.max(80, Hh - 24) }; };
  function shiftFor(sp) {
    if (single()) return 0;
    const [l, r] = pagesOf(sp);
    return !l && r ? -pw / 2 : l && !r ? pw / 2 : 0;
  }
  function applyShift(animate = true, value = shiftFor(s)) {
    book.classList.toggle('rtl', !!o.rtl);
    book.style.transition = animate ? 'transform .5s cubic-bezier(.2,.8,.2,1)' : 'none';
    book.style.transform = `translate3d(${(o.rtl ? -value : value).toFixed(1)}px,0,0)${o.rtl ? ' scaleX(-1)' : ''}`;
  }

  /* ----- bitmaps ----- */
  const keyOf = (n) => `${n}:${pxW}:${o.night ? 1 : 0}`;
  function coverCanvas() {
    const w = pxW, hh = Math.round(pxW / o.ratio), cv = document.createElement('canvas'); cv.width = w; cv.height = hh;
    const c = cv.getContext('2d'), g = c.createLinearGradient(0, 0, w, hh);
    g.addColorStop(0, o.coverColor || '#2f3f66'); g.addColorStop(1, shade(o.coverColor || '#2f3f66', -34));
    c.fillStyle = g; c.fillRect(0, 0, w, hh);
    c.strokeStyle = 'rgba(255,255,255,.22)'; c.lineWidth = Math.max(2, w * 0.006); c.strokeRect(w * 0.07, w * 0.07, w * 0.86, hh - w * 0.14);
    const gl = c.createLinearGradient(0, 0, w, 0); gl.addColorStop(0, 'rgba(0,0,0,.35)'); gl.addColorStop(0.06, 'rgba(255,255,255,.07)'); gl.addColorStop(0.12, 'rgba(0,0,0,0)');
    c.fillStyle = gl; c.fillRect(0, 0, w, hh);
    return cv;
  }
  function bitmap(n) {
    if (n < 1) return Promise.resolve(null);
    if (n > N) {                                              // virtual pages: the blank pad page and the back cover
      const k = keyOf(n);
      if (!cache.has(k)) cache.set(k, n === BK() && o.backCover ? coverCanvas() : fitBitmap(null, pxW, Math.round(pxW / o.ratio), { night: o.night }));
      return Promise.resolve(cache.get(k));
    }
    const k = keyOf(n);
    if (cache.has(k)) { const v = cache.get(k); cache.delete(k); cache.set(k, v); return Promise.resolve(v); }
    if (pending.has(k)) return pending.get(k);
    const hh = Math.round(pxW / o.ratio);
    const pr = Promise.resolve(o.getBitmap(n, pxW)).then((src) => {
      const cv = fitBitmap(src, pxW, hh, { night: o.night });
      if (!destroyed) { cache.set(k, cv); while (cache.size > 10) cache.delete(cache.keys().next().value); }
      return cv;
    }).catch(() => fitBitmap(null, pxW, hh, { night: o.night })).finally(() => pending.delete(k));
    pending.set(k, pr);
    return pr;
  }
  const ready = (n) => cache.has(keyOf(n));
  function paint(pgEl, wait, n) {
    const cv = pgEl.querySelector('canvas');
    if (!n) { pgEl.classList.add('none'); wait.classList.remove('on'); cv.getContext('2d').clearRect(0, 0, cv.width, cv.height); delete pgEl.dataset.n; return Promise.resolve(); }
    pgEl.classList.remove('none');
    if (pgEl.dataset.n === String(n) + ':' + pxW + ':' + (o.night ? 1 : 0)) return Promise.resolve();
    pgEl.dataset.n = String(n) + ':' + pxW + ':' + (o.night ? 1 : 0);
    if (!ready(n)) wait.classList.add('on');
    return bitmap(n).then((b) => {
      if (destroyed || pgEl.dataset.n !== String(n) + ':' + pxW + ':' + (o.night ? 1 : 0)) return;
      cv.width = b.width; cv.height = b.height; cv.getContext('2d').drawImage(b, 0, 0);
      wait.classList.remove('on');
    });
  }
  function prefetch(sp) { for (const q of [sp + 1, sp - 1, sp + 2]) { const [l, r] = pagesOf(q); if (l) bitmap(l); if (r) bitmap(r); } }

  /* ----- showing a spread ----- */
  /** the shadow under the book covers the pages that are showing (one page while the book is closed) */
  function updateFloor(full = false) {
    const [l, r] = pagesOf(s), pad = pw * 0.05;
    const x0 = full || l || single() ? 0 : pw, x1 = full || r || single() ? bw : pw;
    const a = single() ? pw : x0, b2 = single() ? bw : x1;
    floor.style.cssText = `left:${a - pad}px;top:${-pad * 0.15}px;width:${b2 - a + pad * 2}px;height:${ph + pad * 1.5}px`;
  }
  const floorFull = () => updateFloor(true);
  function thickness() {
    updateFloor();
    const [l, r] = pagesOf(s);
    const left = Math.max(0, Math.min(N, l || r || 1) - 1), right = Math.max(0, N - Math.min(N, r || l || 1));
    const mk = (cnt, dx) => { const t = Math.min(9, Math.round(cnt / Math.max(1, N) * 11)); const out = []; for (let i = 1; i <= t; i++) out.push(`${dx * i}px ${i * 0.5}px 0 ${i % 2 ? '#e6e0d1' : '#d6cfbc'}`); out.push('0 10px 26px rgba(0,0,0,.38)'); return out.join(','); };
    pgL.style.boxShadow = mk(left, -1); pgR.style.boxShadow = mk(right, 1);
  }
  function show(sp, { animate = false } = {}) {
    s = Math.max(0, Math.min(spreadCount() - 1, sp));
    const [l, r] = pagesOf(s);
    paint(pgL, loadL, l); paint(pgR, loadR, r);
    thickness(); applyShift(animate);
    prefetch(s);
    o.onPage && o.onPage(curPage(), N);
  }

  /* ----- turning ----- */
  let anim = null;                                  // { leaf, dir, to, p }
  async function begin(dir) {
    if (busy || destroyed) return null;
    const to = s + dir;
    if (to < 0 || to >= spreadCount()) return null;
    busy = true;
    const [l, r] = pagesOf(s), [l2, r2] = pagesOf(to);
    // forward: the right page turns over onto the left; backward: the left page turns over onto the right
    const frontN = dir > 0 ? r : l, backN = dir > 0 ? l2 : r2;
    const [fb, bb, , ] = await Promise.all([bitmap(frontN), bitmap(backN), bitmap(dir > 0 ? r2 : l2), bitmap(dir > 0 ? l : r)]);
    if (destroyed) return null;
    // what is revealed underneath: forward → the new right page; backward → the new left page
    if (dir > 0) paint(pgR, loadR, r2); else paint(pgL, loadL, l2);
    const leaf = createLeaf({ pw, ph, front: frontN ? fb : null, back: backN ? bb : null, dir, mirror: o.rtl });
    const hinge = h('div', { class: 'fb-hinge', style: { left: pw + 'px', height: ph + 'px' } }, leaf.shadow, leaf.el);
    book.append(hinge); floorFull();
    // the page being turned leaves its own place at once (it is the leaf now)
    // the book slides to its next position while the page turns
    anim = { leaf, hinge, dir, to, p: 0, lifted: dir > 0 ? pgR : pgL };
    // when the leaf starts on the right half we keep the right page visible under it until the revealed page is painted (done above)
    return anim;
  }
  function setP(a, p) {
    a.p = p;
    a.leaf.set(p);
    const sh = shiftFor(a.to), s0 = shiftFor(s);
    applyShiftRaw(s0 + (sh - s0) * Math.min(1, p * 1.0));
  }
  function applyShiftRaw(v) { book.style.transition = 'none'; book.style.transform = `translate3d(${(o.rtl ? -v : v).toFixed(1)}px,0,0)${o.rtl ? ' scaleX(-1)' : ''}`; }
  function finish(a) {
    s = a.to;
    a.leaf.destroy(); a.hinge.remove();
    pgL.classList.remove('lift'); pgR.classList.remove('lift');
    anim = null; busy = false;
    const [l, r] = pagesOf(s);
    paint(pgL, loadL, l); paint(pgR, loadR, r);
    thickness(); applyShift(false); prefetch(s);
    o.onPage && o.onPage(curPage(), N);
  }
  function cancel(a) {
    a.leaf.destroy(); a.hinge.remove();
    pgL.classList.remove('lift'); pgR.classList.remove('lift');
    const [l, r] = pagesOf(s);
    paint(pgL, loadL, l); paint(pgR, loadR, r);
    anim = null; busy = false; applyShift(false);
  }
  /** animates the turn from its current progress to `target` (1 = turn, 0 = put back) */
  function run(a, target, ms = 640) {
    return new Promise((res) => {
      const p0 = a.p, t0 = performance.now(), dur = Math.max(160, ms * Math.abs(target - p0));
      const step = (now) => {
        if (destroyed) { res(); return; }
        const u = Math.min(1, (now - t0) / dur), e = p0 + (target - p0) * (target > p0 ? ease(u) : easeOut(u));
        setP(a, e);
        if (u < 1) requestAnimationFrame(step); else { target >= 1 ? finish(a) : cancel(a); res(); }
      };
      requestAnimationFrame(step);
    });
  }
  async function flip(dir) {
    const a = await begin(dir);
    if (!a) return false;
    setP(a, 0);
    await run(a, 1, 700);
    return true;
  }

  /** Several spreads at once: a quick flurry of cheap leaves, the first one showing the page you leave and the last one the page you arrive at. */
  async function cascade(to) {
    if (busy || destroyed || to === s) return false;
    busy = true;
    const dir = to > s ? 1 : -1, m = Math.abs(to - s);
    floorFull();
    const [l0, r0] = pagesOf(s), [lt, rt] = pagesOf(to);
    const [fb, bb, rb, lb] = await Promise.all([bitmap(dir > 0 ? r0 : l0), bitmap(dir > 0 ? lt : rt), bitmap(rt), bitmap(lt)]);
    if (destroyed) return false;
    const dur = m > 6 ? 360 : 460;
    const stagger = Math.max(18, Math.min(110, 1500 / m));
    const sh0 = shiftFor(s), sh1 = shiftFor(to);
    const live = [], t0 = performance.now();
    let made = 0, revealed = false;
    return new Promise((res) => {
      const step = (now) => {
        if (destroyed) { res(false); return; }
        const el_ = now - t0;
        while (made < m && el_ >= made * stagger) {                // start the next leaf
          const first = made === 0, last = made === m - 1;
          const leaf = createLeaf({ pw, ph, front: first ? (dir > 0 ? r0 : l0) ? fb : null : null, back: last ? ((dir > 0 ? lt : rt) ? bb : null) : null, dir, mirror: o.rtl, cheap: !first && !last });
          const hinge = h('div', { class: 'fb-hinge', style: { left: pw + 'px', height: ph + 'px' } }, leaf.shadow, leaf.el);
          book.append(hinge); leaf.set(0);
          live.push({ leaf, hinge, start: made * stagger });
          if (last && !revealed) { revealed = true; if (dir > 0) paint(pgR, loadR, rt); else paint(pgL, loadL, lt); }
          made++;
        }
        for (let i = live.length - 1; i >= 0; i--) {
          const x = live[i], u = Math.min(1, (el_ - x.start) / (x.start === (m - 1) * stagger ? dur * 1.5 : dur));
          x.leaf.set(ease(u));
          if (u >= 1) { x.leaf.destroy(); x.hinge.remove(); live.splice(i, 1); }
        }
        applyShiftRaw(sh0 + (sh1 - sh0) * Math.min(1, el_ / Math.max(1, (m - 1) * stagger + dur * 1.2)));
        if (made < m || live.length) requestAnimationFrame(step);
        else {
          s = to; paint(pgL, loadL, lt); paint(pgR, loadR, rt); thickness(); applyShift(false); prefetch(s);
          busy = false; o.onPage && o.onPage(curPage(), N); res(true);
        }
      };
      requestAnimationFrame(step);
    });
  }
  const turnTo = (sp) => (sp === s ? Promise.resolve(false) : Math.abs(sp - s) === 1 ? flip(sp > s ? 1 : -1) : cascade(sp));

  /* ----- touch: tap to turn, drag to turn ----- */
  const side = (clientX) => { const r = book.getBoundingClientRect(); const x = (clientX - r.left) / Math.max(1, r.width); const modelLeft = o.rtl ? x > 0.5 : x < 0.5; return modelLeft ? -1 : 1; };   // −1 left half of the model, +1 right half
  el.addEventListener('pointerdown', (e) => {
    if (busy && !drag) return;
    if (e.button && e.button !== 0) return;
    drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, t0: performance.now(), side: side(e.clientX), a: null, last: e.clientX, lastT: performance.now(), v: 0, starting: false };
    try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  });
  el.addEventListener('pointermove', async (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x0;
    if (!drag.a && !drag.starting && Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(e.clientY - drag.y0)) {
      // start turning in the direction the finger goes (model direction: forward = pages turn towards the left of the model)
      const screenLeft = dx < 0;
      const forward = o.rtl ? !screenLeft : screenLeft;
      drag.starting = true; drag.dir = forward ? 1 : -1; drag.x0 = e.clientX;
      const a = await begin(drag.dir);
      if (a && drag) { drag.a = a; drag.rectW = book.getBoundingClientRect().width / 2; setP(a, 0); } else if (drag) drag = null;
    }
    if (drag && drag.a) {
      const sign = (drag.dir > 0) !== o.rtl ? -1 : 1;        // finger direction on screen that increases progress
      const p = Math.max(0, Math.min(1, ((e.clientX - drag.x0) * sign) / Math.max(40, drag.rectW * 1.0)));
      const now = performance.now(); drag.v = ((e.clientX - drag.last) * sign) / Math.max(1, now - drag.lastT); drag.last = e.clientX; drag.lastT = now;
      setP(drag.a, p);
    }
  });
  const endDrag = (e) => {
    if (!drag || (e && e.pointerId !== drag.id)) return;
    const d = drag; drag = null;
    try { el.releasePointerCapture(d.id); } catch { /* ignore */ }
    if (d.a) { const go = d.a.p > 0.4 || d.v > 0.45; if (d.v < -0.45) run(d.a, 0, 380); else run(d.a, go ? 1 : 0, go ? 560 : 320); return; }
    if (d.starting) return;
    const moved = Math.abs((e ? e.clientX : d.x0) - d.x0);
    if (performance.now() - d.t0 < 450 && moved < 10) {
      const forward = d.side > 0; flip(forward ? 1 : -1);
    }
  };
  el.addEventListener('pointerup', endDrag);
  el.addEventListener('pointercancel', (e) => { if (drag && drag.a) endDrag(e); else drag = null; });

  /* ----- public ----- */
  const api = {
    el,
    get page() { return curPage(); },
    get spread() { return s; },
    get count() { return spreadCount(); },
    next: () => flip(1), prev: () => flip(-1),
    goto(p, animate = false) { const sp = spreadOf(p); if (animate && sp !== s && !busy) return turnTo(sp); if (busy) return Promise.resolve(false); show(sp); applyFocus(false); return Promise.resolve(); },
    /** goes to a spread by index (used for the closed front / back cover) */
    gotoSpread(sp, animate = true) { sp = Math.max(0, Math.min(spreadCount() - 1, sp)); if (busy) return Promise.resolve(false); if (animate) return turnTo(sp); show(sp); applyFocus(false); return Promise.resolve(); },
    get last() { return spreadCount() - 1; },
    setFocus(f) { o.focus = f; applyFocus(true); },
    setView(v) { o.view = v; el.className = 'fb bv-' + v; },
    setMode(m) { const p = curPage(); o.mode = m; s = spreadOf(p); cache.clear(); pgL.dataset.n = ''; pgR.dataset.n = ''; show(s); applyFocus(false); },
    setRtl(v) { o.rtl = !!v; show(s); applyFocus(false); },
    setCover(v) { const p = curPage(); o.cover = !!v; s = spreadOf(p); cache.clear(); pgL.dataset.n = ''; pgR.dataset.n = ''; show(s); applyFocus(false); },
    setBackCover(v) { const p = curPage(); o.backCover = !!v; s = spreadOf(p); cache.clear(); pgL.dataset.n = ''; pgR.dataset.n = ''; show(s); applyFocus(false); },
    setNight(v) { o.night = !!v; cache.clear(); pgL.dataset.n = ''; pgR.dataset.n = ''; show(s); },
    get opts() { return o; },
    relayout() { if (busy) return; measure(); cache.clear(); pgL.dataset.n = ''; pgR.dataset.n = ''; show(s); applyFocus(false); },
    destroy() { destroyed = true; el.remove(); cache.clear(); },
  };
  measure();
  show(spreadOf(o.page));
  applyFocus(false);
  const ro = new ResizeObserver(() => { clearTimeout(ro.t); ro.t = setTimeout(() => api.relayout(), 120); });
  ro.observe(host);
  const oldDestroy = api.destroy;
  api.destroy = () => { ro.disconnect(); oldDestroy(); };
  return api;
}
