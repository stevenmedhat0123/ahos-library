// The drawing surface: page rendering with a cache, pan / zoom, and every tool. The viewer builds the buttons around it.
import { bbox, bboxHit, hitStroke, eraseFromStroke, eraseRegion, regionCovers, regionBox as regionBoxOf, cropOf, cropObject, uncrop, canCrop, recognize, mapStroke, moveStroke, scaleStroke, unionBox, isObj, isInk, outline } from './geom.js';
import { drawPaper, drawStroke, isDark, refitText, naturalWidth, rbPrepare, rbStable, rbPaint, rbJoinOk, isRainbow, inkCycle, lodBatch } from './render.js';
import { setStrokes, patchPage } from './doc.js';
import { uid } from '../util.js';
import { beautify, precisePath, inkPr } from './ink.js';
import { bookModel, clampSp, visibleStrokes } from './bookmath.js';
import { BookLayer } from './book.js';

const STAGE_BG = '#131725';
let CLIP = []; // copied strokes, shared by every board during this session

export const clipboardCount = () => CLIP.length;

const round1 = (v) => Math.round(v * 10) / 10;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

const SYMS = { m2: { r: 1, m: true }, m4: { r: 2, m: true }, r6: { r: 6, m: false }, r8: { r: 8, m: false }, k12: { r: 6, m: true } };

export class BoardCanvas {
  constructor({ doc, stage, assets, prefs }) {
    this.doc = doc; this.stage = stage; this.assets = assets;
    this.prefs = prefs; // { tool, pen:{c,w}, hl:{c,w}, eraser:{mode,size}, shape:{kind,c,w,f}, text:{c,size,bold,bg}, laser:{c}, penOnly, assist, snap }
    this.on = {};
    this.main = document.createElement('canvas');
    this.main.className = 'bd-main';
    stage.append(this.main);
    // desynchronized: the browser may paint this canvas without waiting for the page compositor (a frame less between pen and ink)
    this.mctx = this.main.getContext('2d', { desynchronized: true }) || this.main.getContext('2d');
    this.cache = document.createElement('canvas');
    this.cctx = this.cache.getContext('2d');
    this.view = { s: 1, x: 0, y: 0 };
    this.insets = { top: 56, bottom: 120, left: 0, right: 0 };
    this.views = new Map();
    this.pointers = new Map();
    this.op = null; this.gesture = null;
    this.sel = new Set();
    this.crop = null;   // crop mode: { st, full, f:[l,t,r,b] frame as fractions of `full`, bg, lift }
    this.hover = null;
    this.trail = [];
    this.activeMedia = null;
    this.costMs = 0; this.rasterMs = 0; this.lastPts = 0;
    this.raf = 0; this.fullDirty = true; this.dirty = null;
    this.gid = 0;
    this.lastPen = 0; this.penDown = 0; this.lastPenUp = 0;
    this.lastTap = null;
    this.dpr = this.pickDpr();
    this._self = false;

    this.bookOver = new Map();   // books whose leaf is turning right now: id -> [left, right] pages to show
    this.bookRev = 0;            // grows whenever the pages a book shows may have changed
    this.books = new BookLayer(this);
    this.pageId = doc.page.id;
    this.unDoc = doc.onChange((kind) => {
      if (this._self) return;
      if (kind === 'style' || kind === 'quiet') { this.invalidate(); return; }
      if (this.crop) this.cancelCrop();
      this.books?.closePanel();
      this.sel.clear(); this.emit('selection');
      if (this.page.id !== this.pageId) this.pageChanged();
      this.invalidate();
      this.emit('history');
    });
    assets.onPdfSize = (ref, n, w, h) => this.pdfSize(ref, n, w, h);
    this.bind();
    this.resize();
  }

  emit(name, data) { try { this.on[name]?.(data); } catch (e) { console.error(e); } }
  get page() { return this.doc.page; }
  get tool() { return this.prefs.tool; }
  newGroup() { return 'g' + (++this.gid); }

  destroy() {
    this.unDoc?.();
    this.books?.destroy();
    this.ro?.disconnect();
    clearTimeout(this.holdT);
    cancelAnimationFrame(this.raf);
    this.stage.removeEventListener('pointerdown', this.onDown);
    this.stage.removeEventListener('touchstart', this.onTouch);
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    window.removeEventListener('pointercancel', this.onUp);
    this.main.remove();
    this.cache.width = this.cache.height = 1;
  }

  /* ---------------- size, view ---------------- */
  /** Pixel density of the drawing canvases: as sharp as the screen allows (3× phones too), but capped so big screens stay fast. */
  pickDpr() {
    const want = Math.min(window.devicePixelRatio || 1, 3);
    const area = Math.max(1, (this.W || 390) * (this.H || 800));
    return Math.max(1, Math.min(want, Math.sqrt(7e6 / area)));
  }

  resize() {
    const r = this.stage.getBoundingClientRect();
    this.rect = r;
    this.W = Math.max(1, Math.round(r.width)); this.H = Math.max(1, Math.round(r.height));
    this.dpr = this.pickDpr();
    for (const c of [this.main, this.cache]) { c.width = Math.round(this.W * this.dpr); c.height = Math.round(this.H * this.dpr); }
    this.main.style.width = this.W + 'px'; this.main.style.height = this.H + 'px';
    this.clampView();
    this.invalidate();
    this.emit('resize');
    this.emit('view');
  }
  setInsets(top, bottom, left = 0, right = 0) { this.insets = { top, bottom, left, right }; }
  /** Centre (screen px) of the part of the stage that is not covered by the toolbars. */
  centerPx() { const i = this.insets; return [(i.left + this.W - i.right) / 2, (i.top + this.H - i.bottom) / 2]; }

  fitView() {
    const p = this.page, { top, bottom, left, right } = this.insets;
    const availH = Math.max(100, this.H - top - bottom), availW = Math.max(120, this.W - left - right);
    if (p.w) {
      const s = (availW - 16) / p.w;
      this.view = { s, x: left + 8, y: top + 6 };
      if (p.h * s < availH) this.view.y = top + (availH - p.h * s) / 2;
    } else {
      this.view = { s: 1, x: left + availW / 2, y: top + availH / 2 };
    }
    this.afterView();
  }
  fitWhole() {
    const p = this.page, { top, bottom, left, right } = this.insets;
    if (!p.w) { this.fitView(); return; }
    const availH = Math.max(100, this.H - top - bottom) - 12, availW = Math.max(120, this.W - left - right);
    const s = Math.min((availW - 16) / p.w, availH / p.h);
    this.view = { s, x: left + (availW - p.w * s) / 2, y: top + 6 + Math.max(0, (availH - p.h * s) / 2) };
    this.afterView();
  }
  /** Zoom as a 0..1 fraction on a log scale between the limits (for the move-pen slider). */
  zoomFrac() { const [a, b] = this.limits(); return clamp(Math.log(this.view.s / a) / Math.log(b / a), 0, 1); }
  setZoomFrac(f) {
    const [a, b] = this.limits();
    this.zoomBy(a * Math.pow(b / a, clamp(f, 0, 1)) / this.view.s, ...this.centerPx());
  }
  /** Zoom as shown to the person: 100% = the page fits the screen width. */
  zoomPct() { const p = this.page, i = this.insets; return Math.round(this.view.s / (p.w ? (Math.max(120, this.W - i.left - i.right) - 16) / p.w : 1) * 100); }
  limits() {
    const p = this.page;
    if (p.w) { const fit = (this.W - 16) / p.w; return [fit * 0.5, Math.max(fit * 14, 8)]; }
    return [0.04, 10];
  }
  clampView() {
    const v = this.view, p = this.page;
    [this.minS, this.maxS] = this.limits();
    v.s = clamp(v.s, this.minS, this.maxS);
    if (p.w) {
      const keep = 90, pw = p.w * v.s, ph = p.h * v.s;
      v.x = clamp(v.x, keep - pw, this.W - keep);
      v.y = clamp(v.y, keep - ph + this.insets.top, this.H - keep);
    } else {
      v.x = clamp(v.x, -1e6, 1e6); v.y = clamp(v.y, -1e6, 1e6);
    }
  }
  afterView() {
    this.clampView();
    this.views.set(this.page.id, { ...this.view });
    this.doc.view = { page: this.doc.cur, ...this.view };
    this.emit('view');
    this.invalidate();
  }
  restoreView(v) {
    if (v && v.s > 0 && Number.isFinite(v.x) && Number.isFinite(v.y)) { this.view = { s: v.s, x: v.x, y: v.y }; this.clampView(); this.views.set(this.page.id, { ...this.view }); this.invalidate(); this.emit('view'); }
    else this.fitView();
  }
  toWorld(cx, cy) { return [(cx - this.rect.left - this.view.x) / this.view.s, (cy - this.rect.top - this.view.y) / this.view.s]; }
  toScreen(x, y) { return [this.view.x + x * this.view.s, this.view.y + y * this.view.s]; }
  viewCenter() { const [cx, cy] = this.centerPx(); return [(cx - this.view.x) / this.view.s, (cy - this.view.y) / this.view.s]; }
  zoomBy(f, cx = this.W / 2, cy = this.H / 2) {
    const v = this.view, ns = clamp(v.s * f, this.minS, this.maxS), k = ns / v.s;
    v.x = cx - (cx - v.x) * k; v.y = cy - (cy - v.y) * k; v.s = ns;
    this.afterView();
  }
  setPage(i) {
    i = clamp(i, 0, this.doc.pages.length - 1);
    if (i === this.doc.cur) return;
    this.cancelOp();
    if (this.crop) this.cancelCrop();
    this.sel.clear(); this.emit('selection');
    this.doc.cur = i;
    this.pageChanged();
    this.invalidate();
    this.emit('history');
  }
  pageChanged() {
    this.pageId = this.page.id;
    const saved = this.views.get(this.page.id);
    if (saved) { this.view = { ...saved }; this.clampView(); this.emit('view'); } else this.fitView();
    this.emit('page');
  }
  pdfSize(ref, n, w, h) {
    const idx = this.doc.pages.findIndex((p) => p.bg && p.bg.page === n && (p.bg.ref.id === ref.id || (p.bg.ref.name === ref.name && p.bg.ref.size === ref.size)));
    if (idx < 0) return;
    const p = this.doc.pages[idx];
    if (Math.abs(p.w - w) < 1 && Math.abs(p.h - h) < 1) return;
    this.doc.quiet((pages) => patchPage(pages, idx, { w: round1(w), h: round1(h) }));
    if (idx === this.doc.cur) this.fitView();
  }

  /* ---------------- rendering ---------------- */
  invalidate(rect) {
    if (rect && !this.fullDirty) {
      this.dirty = this.dirty ? [Math.min(this.dirty[0], rect[0]), Math.min(this.dirty[1], rect[1]), Math.max(this.dirty[2], rect[2]), Math.max(this.dirty[3], rect[3])] : rect.slice();
    } else { this.fullDirty = true; this.dirty = null; }
    if (!this.raf) this.raf = requestAnimationFrame(() => { this.raf = 0; this.frame(); });
  }
  /** Redraws only the top layer (live stroke, selection, cursor, laser); the cached page is just copied. */
  repaint() {
    if (!this.raf) this.raf = requestAnimationFrame(() => { this.raf = 0; this.frame(); });
  }
  frame() {
    let full = false;
    // while the view moves on a heavy board: how long frames really take (drawing is finished later by the browser, so the time spent in JS alone says little)
    if (this.lod) { const now = performance.now(); if (this.lodT && now - this.lodT < 500) this.lodIv = this.lodIv ? this.lodIv * 0.6 + (now - this.lodT) * 0.4 : now - this.lodT; this.lodT = now; }
    if (this.fullDirty) { this.renderCache(); this.fullDirty = false; this.dirty = null; full = true; }
    else if (this.dirty) { this.renderCache(this.dirty); this.dirty = null; full = true; }
    if (full && this.op) this.op.pbox = null;
    this.present();
    if (full && !this.lod) this.measureRaster();
    if (this.trail.length) this.repaint();
  }
  /** The time JavaScript spends issuing draw calls says little about the real cost (the browser rasterises later),
   *  so the time until the next frame after a redraw is measured as well. */
  measureRaster() {
    if (this._measuring) return;
    this._measuring = true;
    const t1 = performance.now();
    requestAnimationFrame(() => {
      this._measuring = false;
      const real = Math.max(0, performance.now() - t1 - 17);
      this.rasterMs = this.rasterMs ? this.rasterMs * 0.5 + real * 0.5 : real;
    });
  }
  isDarkPaper() { return this.page.bg ? this.doc.night : isDark(this.doc.paperOf()); }

  renderCache(rect) {
    const t0 = performance.now();
    const ctx = this.cctx, { s, x, y } = this.view, d = this.dpr, p = this.page;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.save();
    let cull;
    const vis = [(-x) / s, (-y) / s, (this.W - x) / s, (this.H - y) / s];
    if (rect) {
      const pad = 3 / s;
      cull = [rect[0] - pad, rect[1] - pad, rect[2] + pad, rect[3] + pad];
      ctx.beginPath();
      ctx.rect(Math.floor((cull[0] * s + x) * d), Math.floor((cull[1] * s + y) * d), Math.ceil((cull[2] - cull[0]) * s * d) + 1, Math.ceil((cull[3] - cull[1]) * s * d) + 1);
      ctx.clip();
      ctx.clearRect(0, 0, this.cache.width, this.cache.height);
    } else {
      cull = vis;
      ctx.clearRect(0, 0, this.cache.width, this.cache.height);
    }
    ctx.fillStyle = STAGE_BG; ctx.fillRect(0, 0, this.cache.width, this.cache.height);
    ctx.setTransform(d * s, 0, 0, d * s, d * x, d * y);
    const paper = this.doc.paperOf(p), pattern = this.doc.patternOf(p);
    const dark = this.isDarkPaper();
    drawPaper(ctx, p, p.bg ? '#ffffff' : paper, p.bg ? 'none' : pattern, { x, y, s, W: this.W, H: this.H });
    if (p.bg) {
      const b = this.assets.pdfPage(p.bg.ref, p.bg.page, p.w * s * d, this.doc.night);
      if (b) ctx.drawImage(b.src, 0, 0, p.w, p.h);
      else if (this.assets.missing(p.bg.ref)) { ctx.fillStyle = 'rgba(0,0,0,.4)'; ctx.font = '20px sans-serif'; ctx.fillText('PDF ⚠', 20, 40); }
      if (this.doc.night && !b) { ctx.fillStyle = '#1a1a1a'; ctx.fillRect(0, 0, p.w, p.h); }
      if (p.bg && this.doc.patternOf(p) !== 'none') drawPaper(ctx, { w: 0 }, 'rgba(0,0,0,0)', this.doc.patternOf(p), { x, y, s, W: this.W, H: this.H });
    }
    const env = { dark, assets: this.assets, scale: s, dpr: d, hideMedia: this.activeMedia, lift: this.op?.lift, bookOver: this.bookOver, lod: !!this.lod };
    const lift = this.op?.lift || this.crop?.lift;
    const list = this.visStrokes();
    const clipPage = () => { if (p.w) { ctx.beginPath(); ctx.rect(0, 0, p.w, p.h); ctx.clip(); } };
    ctx.save(); clipPage();
    for (const st of list) if (isObj(st) && !lift?.has(st) && bboxHit(bbox(st), cull[0], cull[1], cull[2], cull[3])) drawStroke(ctx, st, env);
    if (this.activeMedia) { const m = this.activeMedia; ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(Math.floor((m.x * s + x) * d), Math.floor((m.y * s + y) * d), Math.ceil(m.w * s * d), Math.ceil(m.h * s * d)); ctx.restore(); }
    let pts = 0;
    const B = this.lod ? lodBatch(ctx, env, this.lodLevel) : null;
    for (const st of list) {
      if (isObj(st) || lift?.has(st)) continue;
      const bb = bbox(st);
      if (!bboxHit(bb, cull[0], cull[1], cull[2], cull[3])) continue;
      pts += st.pts ? st.pts.length >> 1 : 2;
      if (B && st.pts && (st.t === 'pen' || st.t === 'hl')) B.add(st, bb);
      else { B?.flush(); drawStroke(ctx, st, env); }
    }
    B?.flush();
    if (!rect && !this.lod) this.lastPts = pts;
    ctx.restore(); // page clip
    ctx.restore();
    const dt = performance.now() - t0;
    if (this.lod) {
      // the thin drawing has its own cost: it must not make a heavy board look light to the next gesture
      this.lodMs = this.lodMs ? this.lodMs * 0.6 + dt * 0.4 : dt;
      const iv = this.lodIv || 0;
      this.lodLevel = this.lodMs > 20 || iv > 45 ? (iv > 90 ? 3 : 2) : this.lodMs < 9 && iv < 28 ? 1 : this.lodLevel;
    } else this.costMs = this.costMs ? this.costMs * 0.7 + dt * 0.3 : dt;
  }

  /** What the pen has written so far, as it is drawn on the top layer (the stored stroke is made from the same pieces when the pen lifts). */
  liveStroke(op) {
    const pf = this.prefs[this.tool === 'hl' ? 'hl' : 'pen'];
    if (op.snapped) return op.snapped;
    let pts = op.cur ? op.cur.pts : op.pts;
    let pr = this.uniformW() ? null : op.cur?.pr ? op.cur.pr : op.hasPr ? op.pr : null;
    if (op.pred && op.pred.length) {   // where the pen is about to be (the browser's guess): drawn ahead of the real tip, never stored
      pts = pts.concat(op.pred);
      if (pr) pr = pr.concat(new Array(op.pred.length >> 1).fill(pr[pr.length - 1]));
    }
    return { t: this.tool === 'hl' ? 'hl' : 'pen', c: pf.c, w: this.penW(pf.w), pts, ...(pr ? { pr } : {}), ...(this.tool !== 'hl' && (pf.k === 'ink' || pf.k === 'neon' || pf.k === 'pencil') ? { k: pf.k } : {}), ...(op.u ? { u: op.u } : {}) };
  }
  /**
   * While writing, only the patch of the screen the stroke touches is redone (the rest is already what the page cache holds).
   * On a big tablet this is a few hundred pixels instead of millions per frame. Returns false when the whole layer has to be painted
   * (first frame of a stroke, selection / symmetry / laser on screen, a colour-cycling ink).
   */
  presentDraw() {
    const op = this.op;
    if (!op || op.type !== 'draw' || op.snapped || this.crop || this.sel.size || this.trail.length || this.symSpec() || this.bookOver.size) return false;
    const pf = this.prefs[this.tool === 'hl' ? 'hl' : 'pen'];
    if (isRainbow(pf.c)) return false;
    const live = this.liveStroke(op), p = live.pts, { s, x, y } = this.view, d = this.dpr;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < p.length; i += 2) { if (p[i] < x0) x0 = p[i]; if (p[i] > x1) x1 = p[i]; if (p[i + 1] < y0) y0 = p[i + 1]; if (p[i + 1] > y1) y1 = p[i + 1]; }
    const pad = live.w * 3.4 + 4 / s;
    const W = this.main.width, H = this.main.height;
    const box = [Math.max(0, Math.floor(((x0 - pad) * s + x) * d) - 2), Math.max(0, Math.floor(((y0 - pad) * s + y) * d) - 2), Math.min(W, Math.ceil(((x1 + pad) * s + x) * d) + 2), Math.min(H, Math.ceil(((y1 + pad) * s + y) * d) + 2)];
    const prev = op.pbox;
    op.pbox = box;
    if (!prev) return false;                                 // the first frame repaints everything (clears whatever the last tool left)
    const R = [Math.min(prev[0], box[0]), Math.min(prev[1], box[1]), Math.max(prev[2], box[2]), Math.max(prev[3], box[3])];
    const w = R[2] - R[0], h = R[3] - R[1];
    if (w <= 0 || h <= 0) return true;
    const m = this.mctx;
    m.setTransform(1, 0, 0, 1, 0, 0);
    m.save();
    m.beginPath(); m.rect(R[0], R[1], w, h); m.clip();
    m.clearRect(R[0], R[1], w, h);
    m.drawImage(this.cache, R[0], R[1], w, h, R[0], R[1], w, h);
    m.setTransform(d * s, 0, 0, d * s, d * x, d * y);
    const env = { dark: this.isDarkPaper(), assets: this.assets, scale: s, dpr: d, live: true, bookOver: this.bookOver };
    if (this.page.w) { m.beginPath(); m.rect(0, 0, this.page.w, this.page.h); m.clip(); }
    drawStroke(m, live, env);
    m.restore();
    return true;
  }

  present() {
    if (this.presentDraw()) return;
    const m = this.mctx, d = this.dpr, { s, x, y } = this.view;
    m.setTransform(1, 0, 0, 1, 0, 0);
    m.clearRect(0, 0, this.main.width, this.main.height);
    m.drawImage(this.cache, 0, 0);
    m.setTransform(d * s, 0, 0, d * s, d * x, d * y);
    const env = { dark: this.isDarkPaper(), assets: this.assets, scale: s, dpr: d, live: true, bookOver: this.bookOver };
    const op = this.op;
    m.save();
    if (this.page.w) { m.beginPath(); m.rect(0, 0, this.page.w, this.page.h); m.clip(); }
    if (op) {
      if (op.type === 'draw') {
        const live = this.liveStroke(op);
        if (op.snapped || !this.liveRainbow(m, op, live, env)) drawStroke(m, live, env);
        if (!op.snapped) for (const c of this.symCopies(live)) drawStroke(m, c, env);
      } else if (op.type === 'shape' && op.preview) drawStroke(m, op.preview, env);
      else if ((op.type === 'move' || op.type === 'scale') && op.moved) for (const st of op.moved) drawStroke(m, st, env);
      else if (op.type === 'area' && op.reg) this.drawArea(m, op);
      else if (op.type === 'marquee') {
        const [a, b] = [op.a, op.b];
        m.save(); m.fillStyle = 'rgba(80,140,255,.14)'; m.strokeStyle = 'rgba(80,140,255,.9)'; m.lineWidth = 1.2 / s; m.setLineDash([5 / s, 4 / s]);
        m.fillRect(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
        m.strokeRect(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
        m.restore();
      }
    }
    if (this.crop) this.drawCropObject(m, env);
    m.restore();
    if (this.crop) this.drawCropFrame(m);
    this.drawSymGuide(m);
    if (this.sel.size) this.drawSelection(m);
    if (this.tool === 'eraser' && this.prefs.eraser.mode !== 'area' && this.hover && !(this.op && this.op.type !== 'erase')) {
      const r = this.eraserR();
      m.save(); m.beginPath(); m.arc(this.hover[0], this.hover[1], r, 0, 6.2832);
      m.fillStyle = 'rgba(255,255,255,.12)'; m.fill(); m.lineWidth = 1.4 / s; m.strokeStyle = this.isDarkPaper() ? 'rgba(255,255,255,.8)' : 'rgba(0,0,0,.65)'; m.stroke(); m.restore();
    }
    if (this.trail.length) this.drawLaser(m);
    this.books?.sync();
  }

  /** The shaded preview of the area eraser: everything under the red is what goes when the finger or pen is lifted. */
  drawArea(m, op) {
    const s = this.view.s, reg = op.reg;
    m.save();
    m.beginPath();
    if (reg.box) m.rect(reg.box[0], reg.box[1], reg.box[2] - reg.box[0], reg.box[3] - reg.box[1]);
    else { const p = reg.poly; m.moveTo(p[0], p[1]); for (let i = 2; i < p.length; i += 2) m.lineTo(p[i], p[i + 1]); m.closePath(); }
    m.fillStyle = 'rgba(239,68,68,.22)'; m.fill();
    m.lineWidth = 1.6 / s; m.strokeStyle = 'rgba(239,68,68,.95)'; m.setLineDash([7 / s, 5 / s]); m.stroke();
    m.setLineDash([]);
    for (const st of op.doomed) {   // whole things that will go (a text box, a picture): outlined
      const b = bbox(st);
      m.fillStyle = 'rgba(239,68,68,.22)'; m.fillRect(b[0], b[1], b[2] - b[0], b[3] - b[1]);
      m.lineWidth = 2.4 / s; m.strokeStyle = 'rgba(220,38,38,1)'; m.strokeRect(b[0], b[1], b[2] - b[0], b[3] - b[1]);
    }
    m.restore();
  }

  drawLaser(m) {
    const now = performance.now(), s = this.view.s;
    this.trail = this.trail.filter((q) => now - q.t < 900);
    const col = this.prefs.laser.c;
    m.save(); m.lineCap = 'round'; m.lineJoin = 'round';
    for (let i = 1; i < this.trail.length; i++) {
      const a = this.trail[i - 1], b = this.trail[i], age = (now - b.t) / 900;
      if (b.brk) continue;
      m.globalAlpha = Math.max(0, 1 - age); m.strokeStyle = col; m.lineWidth = (5 * (1 - age * 0.6)) / s;
      m.beginPath(); m.moveTo(a.x, a.y); m.lineTo(b.x, b.y); m.stroke();
    }
    const last = this.trail[this.trail.length - 1];
    if (last && now - last.t < 250) {
      m.globalAlpha = 1; m.fillStyle = col; m.shadowColor = col; m.shadowBlur = 14;
      m.beginPath(); m.arc(last.x, last.y, 7 / s, 0, 6.2832); m.fill();
    }
    m.restore();
  }

  drawSelection(m) {
    const op = this.op, s = this.view.s;
    const box = this.selBox();
    if (!box) return;
    let [x1, y1, x2, y2] = box;
    if (op && op.moved && op.type === 'move') { x1 += op.dx; x2 += op.dx; y1 += op.dy; y2 += op.dy; }
    if (op && op.type === 'scale' && op.k) { x2 = x1 + (x2 - x1) * op.k; y2 = y1 + (y2 - y1) * op.k; }
    m.save();
    m.lineWidth = 1.4 / s; m.strokeStyle = '#5b9dff'; m.setLineDash([6 / s, 4 / s]);
    m.strokeRect(x1, y1, x2 - x1, y2 - y1);
    m.setLineDash([]); m.fillStyle = '#fff'; m.lineWidth = 2 / s;
    m.beginPath(); m.arc(x2, y2, 9 / s, 0, 6.2832); m.fill(); m.stroke();
    m.restore();
  }

  selBox() {
    if (!this.sel.size) return null;
    if (this._selBox && this._selBoxFor === this.sel) return this._selBox;
    this._selBox = unionBox([...this.sel]); this._selBoxFor = this.sel;
    return this._selBox;
  }
  selectionScreen() {
    const b = this.selBox();
    if (!b) return null;
    const [x1, y1] = this.toScreen(b[0], b[1]), [x2, y2] = this.toScreen(b[2], b[3]);
    return [x1, y1, x2, y2];
  }

  /* ---------------- input ---------------- */
  bind() {
    this.main.style.touchAction = 'none';
    this.stage.style.touchAction = 'none';
    this.onDown = (e) => this.pointerDown(e);
    this.onMove = (e) => this.pointerMove(e);
    this.onUp = (e) => this.pointerUp(e);
    this.stage.addEventListener('pointerdown', this.onDown);
    // Android holds back a finger's / pen's first movements (the "touch slop", ~8 px) until the page has said whether it wants the touch;
    // answering the touchstart at once (the canvas always does) lets the ink follow from the very first pixel.
    this.onTouch = (e) => { if (e.target === this.main || e.target === this.stage) e.preventDefault(); };
    this.stage.addEventListener('touchstart', this.onTouch, { passive: false });
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('pointercancel', this.onUp);
    this.stage.addEventListener('contextmenu', (e) => e.preventDefault());
    this.stage.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) this.zoomBy(Math.exp(-e.deltaY * 0.0022), e.clientX - this.rect.left, e.clientY - this.rect.top);
      else { this.view.x -= e.shiftKey ? e.deltaY : e.deltaX; this.view.y -= e.shiftKey ? 0 : e.deltaY; this.afterView(); }
    }, { passive: false });
    this.ro = new ResizeObserver(() => { clearTimeout(this.rzT); this.rzT = setTimeout(() => this.resize(), 60); });
    this.ro.observe(this.stage);
  }

  pointerDown(e) {
    if (e.target.closest?.('.bd-ui')) return;
    if (e.pointerType === 'mouse' && e.button === 2) return;
    e.preventDefault();
    const now = performance.now();
    // a hand resting on the screen while the pen is writing is ignored completely
    if (e.pointerType === 'touch' && (this.penDown > 0 || now - this.lastPenUp < 600)) return;
    if (e.pointerType === 'pen') { this.lastPen = now; this.penDown++; }
    try { this.stage.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType, t0: performance.now(), x0: e.clientX, y0: e.clientY, moved: false });
    clearTimeout(this.bookHoldT);
    if (this.pointers.size >= 2) { this.cancelOp(); this.startGesture(); return; }
    this.startOp(e);
    if (this.op && this.op.type === 'draw') this.present();   // the dot is there in the very same moment, not at the next frame
    // a long press without moving on a book opens its settings (what the pen would have drawn is dropped)
    if (this.op && !this.crop && this.page.strokes.some((st) => st.t === 'book')) {
      const [wx, wy] = this.toWorld(e.clientX, e.clientY), hit = this.bookAt(wx, wy), id = e.pointerId;
      if (hit) this.bookHoldT = setTimeout(() => this.bookHold(id, hit.book.id), 560);
    }
  }
  bookHold(pid, bookId) {
    const p = this.pointers.get(pid);
    if (!p || p.moved || this.pointers.size !== 1 || this.gesture) return;
    if (!this.doc.page.strokes.some((s) => s.t === 'book' && s.id === bookId)) return;
    this.cancelOp();
    this.emit('bookHold', { id: bookId });
  }

  pointerMove(e) {
    const p = this.pointers.get(e.pointerId);
    if (!p) {
      if (e.pointerType !== 'touch' && this.stage.contains(e.target)) {
        if (this.tool === 'eraser') { this.hover = this.toWorld(e.clientX, e.clientY); this.repaint(); }
      }
      return;
    }
    if (e.pointerType === 'pen') this.lastPen = performance.now();
    p.x = e.clientX; p.y = e.clientY;
    if (!p.moved && Math.hypot(p.x - p.x0, p.y - p.y0) > 6) p.moved = true;
    if (this.gesture) { this.updateGesture(); return; }
    if (this.op) this.op.move?.(e);
  }

  pointerUp(e) {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    clearTimeout(this.bookHoldT);
    const wasGesture = !!this.gesture;
    this.pointers.delete(e.pointerId);
    if (p.type === 'pen') { this.penDown = Math.max(0, this.penDown - 1); this.lastPenUp = performance.now(); }
    if (wasGesture) {
      const g = this.gesture;
      if (this.pointers.size < 2) {
        // two quick finger taps without moving = undo
        if (g.tap && performance.now() - g.t0 < 260 && !g.moved) { this.cancelOp(); this.endGesture(); if (this.doc.undo()) this.emit('undone'); return; }
        this.endGesture();
      }
      return;
    }
    if (this.op) { const op = this.op; this.op = null; op.up?.(e, p); this.repaint(); }
  }

  touchBlocked(e) {
    // palm rejection: a hand resting on the screen while writing with a pen, or "pen only" mode
    if (e.pointerType !== 'touch') return false;
    if (this.prefs.penOnly) return true;
    return performance.now() - this.lastPen < 2500;
  }

  startOp(e) {
    this.stopFling();
    const type = e.pointerType;
    let tool = this.tool;
    if (type === 'pen' && (e.buttons & 32)) tool = 'eraser';
    if (e.pointerType === 'mouse' && e.button === 1) tool = 'hand';
    if (this.touchBlocked(e) && tool !== 'hand') tool = 'hand';
    this.activeTool = tool;
    const [x, y] = this.toWorld(e.clientX, e.clientY);
    const p = this.page;
    if (this.crop && !this.touchBlocked(e)) { this.op = this.cropOp(e, x, y); return; }
    const outside = p.w && (x < -6 || y < -6 || x > p.w + 6 || y > p.h + 6);
    if (outside && ['pen', 'hl', 'shape', 'text'].includes(tool)) tool = 'hand';
    switch (tool) {
      case 'hand': this.op = this.panOp(e); break;
      case 'pen': case 'hl': this.op = this.drawOp(e, tool, x, y); break;
      case 'eraser': this.op = this.prefs.eraser.mode === 'area' && !(type === 'pen' && (e.buttons & 32)) ? this.areaOp(e, x, y) : this.eraseOp(e, x, y); break;
      case 'shape': this.op = this.shapeOp(e, x, y); break;
      case 'text': this.op = this.tapOp(e, (wx, wy) => this.textTap(wx, wy)); break;
      case 'select': this.op = this.selectOp(e, x, y); break;
      case 'laser': this.op = this.laserOp(e, x, y); break;
      default: this.op = null;
    }
  }

  cancelOp() {
    clearTimeout(this.holdT);
    const op = this.op;
    this.op = null;
    if (op?.cancel) op.cancel();
    this.doc.endGroup();
    if (op) { this.lod = false; this.main.style.transform = ''; this.invalidate(); }
  }

  /* ---------- pan (one pointer) ---------- */
  panOp(e) {
    const base = { ...this.view }, sx = e.clientX, sy = e.clientY;
    const trail = [[performance.now(), e.clientX, e.clientY]];
    this.stopFling();
    this.beginMove();
    return {
      type: 'pan',
      move: (ev) => {
        this.view.x = base.x + ev.clientX - sx; this.view.y = base.y + ev.clientY - sy; this.moveView(base);
        trail.push([performance.now(), ev.clientX, ev.clientY]); if (trail.length > 6) trail.shift();
      },
      up: () => {
        // a flick keeps gliding and slows down, like a phone list
        const now = performance.now(), a = trail.find((q) => now - q[0] < 90) || trail[trail.length - 1], b = trail[trail.length - 1];
        const dt = Math.max(1, b[0] - a[0]);
        const vx = (b[1] - a[1]) / dt, vy = (b[2] - a[2]) / dt;
        if (now - b[0] < 60 && Math.hypot(vx, vy) > 0.45 && this.activeTool === 'hand') this.fling(vx, vy);
        else this.endMove();
      },
      cancel: () => this.endMove(),
    };
  }
  fling(vx, vy) {
    let last = performance.now();
    const step = (now) => {
      const dt = Math.min(40, now - last); last = now;
      const f = Math.pow(0.0025, dt / 1000);   // ~1s of glide
      vx *= f; vy *= f;
      const before = { x: this.view.x, y: this.view.y };
      this.view.x += vx * dt; this.view.y += vy * dt;
      this.moveView(this.cssBase);
      const moved = Math.hypot(this.view.x - before.x, this.view.y - before.y);
      if (Math.hypot(vx, vy) < 0.03 || moved < 0.05) { this.flingRaf = 0; this.endMove(); return; }
      this.flingRaf = requestAnimationFrame(step);
    };
    this.flingRaf = requestAnimationFrame(step);
  }
  stopFling() { if (this.flingRaf) { cancelAnimationFrame(this.flingRaf); this.flingRaf = 0; this.endMove(); } }
  /** A heavy board is drawn thin while it moves (see lodBatch) instead of stretching the last picture, so no part of the page is ever left blank. */
  beginMove() {
    this.lod = Math.max(this.costMs || 0, this.rasterMs || 0) > 12 || this.lastPts > 40000;
    if (this.lod) { this.lodLevel = this.lodLevel || 1; this.lodMs = 0; this.lodIv = 0; this.lodT = 0; }
    this.cssBase = { ...this.view };
  }
  moveView() {
    this.clampView();
    this.invalidate(); this.emit('view');
  }
  endMove() {
    if (this.lod) { this.lod = false; this.main.style.transform = ''; }
    this.views.set(this.page.id, { ...this.view });
    this.doc.view = { page: this.doc.cur, ...this.view };
    this.emit('viewEnd');
    this.fullDirty = true; this.invalidate();
  }

  /* ---------- pinch + two-finger pan ---------- */
  startGesture() {
    const pts = [...this.pointers.values()].slice(0, 2);
    const cx = (pts[0].x + pts[1].x) / 2 - this.rect.left, cy = (pts[0].y + pts[1].y) / 2 - this.rect.top;
    const d = Math.max(10, Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y));
    const base = { ...this.view };
    this.gesture = { d0: d, cx, cy, base, wx: (cx - base.x) / base.s, wy: (cy - base.y) / base.s, t0: performance.now(), moved: false, tap: true };
    this.beginMove();
  }
  updateGesture() {
    const g = this.gesture;
    const pts = [...this.pointers.values()].slice(0, 2);
    if (pts.length < 2) return;
    const cx = (pts[0].x + pts[1].x) / 2 - this.rect.left, cy = (pts[0].y + pts[1].y) / 2 - this.rect.top;
    const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    const s = clamp(g.base.s * (d / g.d0), this.minS || 0.05, this.maxS || 10);
    this.view = { s, x: cx - g.wx * s, y: cy - g.wy * s };
    if (Math.abs(d - g.d0) > 10 || Math.hypot(cx - g.cx, cy - g.cy) > 10) g.moved = true;
    this.moveView(g.base);
  }
  endGesture() {
    this.gesture = null;
    this.endMove();
    // fingers still down after one lifted: wait until all are up before drawing again
    this.pointers.forEach((p) => { p.moved = true; p.dead = true; });
  }

  /* ---------- helpers for ops ---------- */
  snapPt(x, y) {
    if (!this.prefs.snap) return [x, y];
    const g = 12;
    return [Math.round(x / g) * g, Math.round(y / g) * g];
  }
  edit(fn, group) {
    this._self = true;
    try { return this.doc.edit(fn, group); } finally { this._self = false; }
  }
  /** Everything on the page that can be seen and touched: ink written on a book's page is only there while the book shows that page. */
  curStrokes() { return this.visStrokes(); }
  visStrokes() {
    const all = this.doc.page.strokes;
    const c = this._vis;
    if (c && c.src === all && c.rev === this.bookRev) return c.list;
    const list = visibleStrokes(all, this.bookOver);
    this._vis = { src: all, rev: this.bookRev, list };
    return list;
  }
  /** a test for "this ink belongs to a page that is turned away": such ink is never touched by the erasers */
  hiddenTest() {
    const shown = new Map();
    for (const s of this.doc.page.strokes) if (s.t === 'book') shown.set(s.id, this.pagesNow(s));
    return (st) => { if (!st.bk) return false; const sh = shown.get(st.bk); return !sh || (sh[0] !== st.pg && sh[1] !== st.pg); };
  }
  pagesNow(b) { return this.bookOver.get(b.id) || bookModel(b.n).pagesOf(clampSp(b)); }
  bookRevise() { this.bookRev++; this.invalidate(); }
  /** The book page under a point: { book, pg, rect } (topmost book first). */
  bookAt(x, y) {
    const all = this.doc.page.strokes;
    for (let i = all.length - 1; i >= 0; i--) {
      const b = all[i];
      if (b.t !== 'book') continue;
      const sh = this.pagesNow(b), pw = b.w / 2;
      for (let k = 0; k < 2; k++) {
        const pg = sh[k];
        if (!pg) continue;
        let x0 = k === 0 ? b.x : b.x + pw;
        if (b.rtl) x0 = 2 * b.x + b.w - (x0 + pw);
        if (x >= x0 && x <= x0 + pw && y >= b.y && y <= b.y + b.h) return { book: b, pg, rect: [x0, b.y, x0 + pw, b.y + b.h] };
      }
    }
    return null;
  }
  /** Ink that starts on a book's page becomes part of that page. */
  tagInk(st) {
    if (isObj(st)) return st;
    const { bk, pg, ...rest } = st; void bk; void pg;
    const b = bbox(rest), hit = this.bookAt((b[0] + b[2]) / 2, (b[1] + b[3]) / 2);
    return hit ? { ...rest, bk: hit.book.id, pg: hit.pg } : rest;
  }
  /** the selection plus the ink written on the pages of the books in it, so ink moves with its book */
  withInk(items) {
    const ids = new Set(items.filter((s) => s.t === 'book').map((s) => s.id));
    if (!ids.size) return { items, added: new Set() };
    const have = new Set(items), added = new Set(), out = items.slice();
    for (const s of this.curStrokes()) if (s.bk && ids.has(s.bk) && !have.has(s)) { out.push(s); added.add(s); }
    return { items: out, added };
  }
  /** Adds strokes to the page: ink goes on top, placed things (pictures, PDF pages, media) go under the ink. */
  addStrokes(list, group = this.newGroup(), { select = false } = {}) {
    const i = this.doc.cur;
    const ids = new Set(this.doc.page.strokes.filter((b) => b.t === 'book').map((b) => b.id));
    list = list.map((st) => {
      if (st.t === 'book') { if (!st.id || ids.has(st.id)) st = { ...st, id: uid() }; ids.add(st.id); return st; }   // a copied book is a new book
      return this.tagInk(st);
    });
    this.edit((pages) => {
      let strokes = pages[i].strokes;
      for (const s of list) {
        if (isObj(s)) { let k = strokes.length; while (k > 0 && !isObj(strokes[k - 1])) k--; strokes = [...strokes.slice(0, k), s, ...strokes.slice(k)]; } else strokes = [...strokes, s];
      }
      return setStrokes(pages, i, strokes);
    }, group);
    this.doc.endGroup();
    if (select) { this.sel = new Set(list); this.emit('selection'); }
    this.invalidate();
    this.emit('history');
  }
  /** Ink that was replaced (beautified…) stays on its book's page, and a book that moved or changed size takes the ink on its pages (even hidden) with it. */
  expandMap(map, gone) {
    const all = this.doc.page.strokes;
    for (const [o, n] of map) if (o.bk && !n.bk && !isObj(n)) map.set(o, { ...n, bk: o.bk, pg: o.pg });
    for (const [o, n] of [...map]) {
      if (o.t !== 'book' || n.t !== 'book' || (o.x === n.x && o.y === n.y && o.w === n.w && o.h === n.h)) continue;
      const kx = n.w / o.w, ky = n.h / o.h;
      for (const s of all) if (s.bk === o.id && !map.has(s) && !gone.has(s)) map.set(s, mapStroke(s, (x, y) => [n.x + (x - o.x) * kx, n.y + (y - o.y) * ky], (kx + ky) / 2));
    }
  }
  uid() { return uid(); }
  /** Changes a book's properties. `live`: a slider is being dragged, so no undo step per tick (the caller makes one step at the end). */
  updateBook(id, patch, live = false) {
    const b = this.doc.page.strokes.find((s) => s.t === 'book' && s.id === id);
    if (!b) return;
    const nb = { ...b, ...patch }, map = new Map([[b, nb]]);
    this.expandMap(map, new Set());
    if (live) {
      const i = this.doc.cur;
      this.doc.quiet((pages) => setStrokes(pages, i, pages[i].strokes.map((s) => map.get(s) || s)));
      if (this.sel.has(b)) { this.sel = new Set([...this.sel].map((s) => map.get(s) || s)); this.emit('selection'); }
      this.bookRevise();
    } else {
      this.replaceStrokes(map);
      if (this.sel.has(b)) { this.sel = new Set([nb]); this.emit('selection'); }
    }
  }
  removeBook(id) {
    const b = this.doc.page.strokes.find((s) => s.t === 'book' && s.id === id);
    if (b) { this.replaceStrokes(new Map(), [b]); this.clearSelection(); }
  }
  replaceStrokes(map, remove = [], group = this.newGroup()) {
    const i = this.doc.cur, gone = new Set(remove);
    const all = this.doc.page.strokes;
    this.expandMap(map, gone);
    for (const b of remove) if (b.t === 'book') for (const s of all) if (s.bk === b.id) gone.add(s);   // a deleted book takes its writing with it
    this.edit((pages) => setStrokes(pages, i, pages[i].strokes.flatMap((s) => (gone.has(s) ? [] : map.has(s) ? [map.get(s)] : [s]))), group);
    this.doc.endGroup();
    this.invalidate();
    this.emit('history');
  }

  /* ---------- pen / highlighter ---------- */
  drawOp(e, tool, x, y) {
    const o = { type: 'draw', pts: [round1(x), round1(y)], pr: [this.press(e)], ts: [e.timeStamp || performance.now()], hasPr: false, snapped: null, cur: null };
    const pref = this.prefs[tool];
    const start = performance.now();
    const level = this.prefs.smart || 'precise', smartOn = level !== 'off';
    const inkNib = tool === 'pen' && pref.k === 'ink';
    const nibK = tool === 'pen' && (pref.k === 'ink' || pref.k === 'neon' || pref.k === 'pencil') ? pref.k : null;
    // a magic ink starts at a random point of its colours every time, then keeps changing as you write
    if (isRainbow(pref.c)) o.u = Math.round(Math.random() * inkCycle(pref.c) * 10) / 10;
    /** The cleaned-up version of what has been drawn so far (what you see while writing is what you get). */
    const clean = () => {
      const len = o.pts.length;
      if (inkNib) {
        // ink pen: your exact path, and the width follows the speed of your hand
        if (len < 4) return null;
        const r = precisePath(o.pts, o.hasPr ? o.pr : null, o.ts, this.view.s);
        return r ? { pts: r.pts, pr: inkPr(r.pts, r.ts, o.hasPr ? r.pr : null, this.view.s) } : null;
      }
      if (!smartOn || len < (level === 'precise' ? 4 : 8) || len >= (level === 'precise' ? 60000 : 9000)) return null;
      return beautify(o.pts, o.ts, o.hasPr && tool !== 'hl' ? o.pr : null, { level, s: this.view.s, w: pref.w, hl: tool === 'hl' });
    };
    const arm = () => {
      clearTimeout(this.holdT);
      if (this.prefs.assist !== 'hold') return;
      this.holdT = setTimeout(() => {
        if (o.pts.length < 6 || o.snapped) return;
        const r = recognize(o.pts);
        if (r) { o.snapped = { ...r, c: pref.c, w: this.penW(pref.w), ...(tool === 'hl' ? { t: r.t } : {}) }; this.present(); this.emit('snapped'); }
      }, 480);
    };
    o.move = (ev) => {
      const list = ev.getCoalescedEvents?.() || [];
      const evs = list.length ? list : [ev];
      const s = this.view.s;
      for (const q of evs) {
        const [wx, wy] = this.toWorld(q.clientX, q.clientY);
        if (o.snapped) {
          if (o.snapped.t === 'line') { o.snapped = { ...o.snapped, b: [round1(wx), round1(wy)] }; }
          continue;
        }
        const n = o.pts.length;
        if (Math.hypot(wx - o.pts[n - 2], wy - o.pts[n - 1]) * s < (smartOn ? 0.45 : 0.9)) continue;
        o.pts.push(round1(wx), round1(wy));
        o.ts.push(q.timeStamp || performance.now());
        const p = this.press(q);
        o.pr.push(p);
        if (q.pointerType === 'pen' && Math.abs(p - 0.5) > 0.03) o.hasPr = true;
      }
      arm();
      if (!o.snapped) o.cur = clean();
      // the browser's guess of the next few positions: shown ahead of the real tip so the ink is not a frame behind the pen
      o.pred = null;
      if (!o.snapped && ev.getPredictedEvents && !isRainbow(pref.c)) {
        const pe = ev.getPredictedEvents(), n = o.pts.length, out = [];
        for (let i = 0; pe && i < Math.min(pe.length, 3); i++) {
          const [wx, wy] = this.toWorld(pe[i].clientX, pe[i].clientY);
          if (Math.hypot(wx - o.pts[n - 2], wy - o.pts[n - 1]) * s > 40) break;
          out.push(round1(wx), round1(wy));
        }
        if (out.length) o.pred = out;
      }
      this.repaint();
    };
    o.up = () => {
      clearTimeout(this.holdT);
      let stroke = o.snapped;
      if (!stroke && this.prefs.assist === 'auto' && o.pts.length >= 6) {
        const r = recognize(o.pts);
        if (r) stroke = { ...r, c: pref.c, w: this.penW(pref.w) };
      }
      if (stroke) { stroke = this.stripShape(stroke, tool); }
      else {
        const fin = clean();
        const pts = fin ? fin.pts : o.pts.slice(), pr = o.pr.slice();
        const stroke0 = { t: tool === 'hl' ? 'hl' : 'pen', c: pref.c, w: this.penW(pref.w), pts };
        if (nibK) stroke0.k = nibK;
        if (o.u) stroke0.u = o.u;
        if (this.uniformW()) { /* the same width all along */ }
        else if (fin?.pr && tool !== 'hl') stroke0.pr = fin.pr;
        else if (o.hasPr && tool !== 'hl') stroke0.pr = pr.map((v) => Math.round(v * 100) / 100);
        stroke = stroke0;
      }
      this.commitLive(stroke, o);
      void start;
    };
    o.cancel = () => clearTimeout(this.holdT);
    arm();
    this.repaint();
    return o;
  }
  stripShape(s) { const { t, c, w } = s; if (t === 'poly') return { t, c, w, closed: true, pts: s.pts }; return s; }
  /** 'natural': width follows pressure / speed · 'exact': the line is exactly as wide as the pen size · 'screen': exactly as wide on screen, whatever the zoom */
  uniformW() { return this.prefs.width === 'exact' || this.prefs.width === 'screen'; }
  penW(w) { return this.prefs.width === 'screen' ? Math.max(0.2, Math.round((w / this.view.s) * 100) / 100) : w; }
  press(ev) { return ev.pointerType === 'pen' && ev.pressure > 0 ? ev.pressure : 0.5; }

  /**
   * A rainbow / gradient stroke that is being written: the part that can no longer change is painted ONCE onto a private layer
   * (in the same pass order as the finished stroke, so it looks exactly the same), and only the newest bit is painted again each frame.
   * Returns false when this stroke has to be drawn the ordinary way (short, snapped, or the writing level reshapes older points).
   */
  liveRainbow(m, op, live, env) {
    const lv = this.prefs.smart || 'precise';
    if (op.snapped || live.t === 'hl' || live.k || !isRainbow(live.c) || (lv !== 'precise' && lv !== 'off')) return false;
    if (live.pts.length < 80) return false;
    const s = this.view.s, d = this.dpr;
    const plan = rbPrepare(live);
    if (plan.dot || plan.chunks.length < 20) return false;
    const st = op.rb || (op.rb = { cv: null, kf: 0, plan: null });
    const jr = live.w * 0.9 + 4;
    let want = rbStable(plan, live.pts, Math.max(14 / s, 8) + jr + 2);
    while (want - st.kf >= 14 && !rbJoinOk(plan, want, jr, live.w)) want--;   // freeze at a calm spot of the path, never in the middle of a corner
    if (want - st.kf >= 14) {
      if (!st.cv) { st.cv = document.createElement('canvas'); st.cv.width = this.main.width; st.cv.height = this.main.height; }
      const c = st.cv.getContext('2d');
      c.save();
      c.setTransform(d * s, 0, 0, d * s, d * this.view.x, d * this.view.y);
      if (this.page.w) { c.beginPath(); c.rect(0, 0, this.page.w, this.page.h); c.clip(); }
      rbPaint(c, live, { ...env, live: false }, plan, st.kf, want, { junction: st.kf > 0, ext: true });
      c.restore();
      st.kf = want;
    }
    if (st.kf && st.cv) { m.save(); m.setTransform(1, 0, 0, 1, 0, 0); m.drawImage(st.cv, 0, 0); m.restore(); }
    rbPaint(m, live, env, plan, st.kf, plan.chunks.length, { junction: st.kf > 0 });
    return true;
  }

  /* ---------- symmetry: everything you draw is repeated around a centre (mirror / flower / kaleidoscope) ---------- */
  symSpec() { return this.prefs.tool !== 'pen' && this.prefs.tool !== 'hl' ? null : SYMS[this.prefs.sym] || null; }
  symCenter() {
    const pg = this.page;
    if (pg && pg.w) return { x: pg.w / 2, y: pg.h / 2 };
    if (!this.symC) { const r = this.rect; this.symC = this.toWorld(r.left + r.width / 2, r.top + r.height / 2); }
    return this.symC;
  }
  setSym(mode) { this.prefs.sym = mode; this.symC = null; this.repaint(); }
  /** the transformed copies of a pen stroke (not the stroke itself) */
  symCopies(st) {
    const sp = this.symSpec();
    if (!sp || !st || st.t !== 'pen' && st.t !== 'hl' || !st.pts) return [];
    const { x: cx, y: cy } = this.symCenter(), out = [], p = st.pts, n = p.length >> 1;
    for (let f = 0; f < (sp.m ? 2 : 1); f++) for (let i = 0; i < sp.r; i++) {
      if (!f && !i) continue;
      const a = (i * 2 * Math.PI) / sp.r, ca = Math.cos(a), sa = Math.sin(a), q = new Array(n * 2);
      for (let k = 0; k < n; k++) {
        let dx = p[2 * k] - cx; const dy = p[2 * k + 1] - cy;
        if (f) dx = -dx;
        q[2 * k] = Math.round((cx + dx * ca - dy * sa) * 100) / 100;
        q[2 * k + 1] = Math.round((cy + dx * sa + dy * ca) * 100) / 100;
      }
      out.push({ ...st, pts: q });
    }
    return out;
  }
  /** faint guide lines while symmetry is on */
  drawSymGuide(m) {
    const sp = this.symSpec();
    if (!sp) return;
    const c = this.symCenter(), { s, x, y } = this.view, d = this.dpr;
    const X = (c.x * s + x) * d, Y = (c.y * s + y) * d, R = Math.hypot(this.main.width, this.main.height);
    m.save(); m.setTransform(1, 0, 0, 1, 0, 0);
    m.strokeStyle = 'rgba(250,204,21,.55)'; m.lineWidth = Math.max(1, d); m.setLineDash([6 * d, 7 * d]);
    const axes = [];
    if (sp.m) for (let i = 0; i < sp.r; i++) axes.push((i * Math.PI) / sp.r + Math.PI / 2);
    else for (let i = 0; i < sp.r; i++) axes.push((i * 2 * Math.PI) / sp.r - Math.PI / 2);
    m.beginPath();
    for (const a of axes) { const ex = Math.cos(a) * R, ey = Math.sin(a) * R; m.moveTo(sp.m ? X - ex : X, sp.m ? Y - ey : Y); m.lineTo(X + ex, Y + ey); }
    m.stroke(); m.setLineDash([]);
    m.fillStyle = 'rgba(250,204,21,.9)'; m.beginPath(); m.arc(X, Y, 4 * d, 0, 6.2832); m.fill();
    m.restore();
  }

  /** Puts a finished stroke on the page and paints it into the cache without redrawing everything. */
  commitLive(stroke, op) {
    this.op = null;
    stroke = this.tagInk(stroke);
    const copies = this.symCopies(stroke);
    this.edit((pages) => setStrokes(pages, this.doc.cur, [...pages[this.doc.cur].strokes, stroke, ...copies]), this.newGroup());
    this.doc.endGroup();
    const ctx = this.cctx, { s, x, y } = this.view, d = this.dpr;
    ctx.save(); ctx.setTransform(d * s, 0, 0, d * s, d * x, d * y);
    const pg = this.page;
    if (pg.w) { ctx.beginPath(); ctx.rect(0, 0, pg.w, pg.h); ctx.clip(); }
    const env = { dark: this.isDarkPaper(), assets: this.assets, scale: s, dpr: d };
    const rb = op && op.rb && op.rb.cv && op.rb.kf ? op.rb : null;
    if (rb && stroke.t === 'pen' && isRainbow(stroke.c) && !stroke.k) {
      // the head of the stroke is already painted on the live layer: copy it over and paint only what is left
      const plan = rbPrepare(stroke);
      if (plan.chunks.length > rb.kf) {
        ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(rb.cv, 0, 0); ctx.restore();
        rbPaint(ctx, stroke, env, plan, rb.kf, plan.chunks.length, { junction: true });
      } else drawStroke(ctx, stroke, env);
    } else drawStroke(ctx, stroke, env);
    for (const c of copies) drawStroke(ctx, c, env);
    ctx.restore();
    if (op && op.rb && op.rb.cv) { op.rb.cv.width = 0; op.rb.cv.height = 0; op.rb.cv = null; }
    this.present();
    this.emit('history');
  }

  /* ---------- eraser ---------- */
  eraserR() { return (this.prefs.eraser.size / 2) / this.view.s; }
  eraseOp(e, x, y) {
    const o = { type: 'erase', last: null, group: this.newGroup() };
    const r = this.eraserR();
    const part = this.prefs.eraser.mode !== 'stroke';   // (the area eraser has its own op; a stylus button in that mode rubs out parts)
    let strokes = null, dirty = null, changed = false;
    const base = this.doc.page.strokes, hid = this.hiddenTest();
    const stepAt = (px, py) => {
      const cur = strokes || base;
      let out = null;
      for (let i = 0; i < cur.length; i++) {
        const st = cur[i];
        if (isObj(st) || (st.bk && hid(st))) { if (out) out.push(st); continue; }
        const b = bbox(st);
        if (px < b[0] - r || px > b[2] + r || py < b[1] - r || py > b[3] + r) { if (out) out.push(st); continue; }
        let res;
        if (part) res = eraseFromStroke(st, px, py, r);
        else res = st.t === 'text' ? (hitStroke(st, px, py, 0) ? [] : null) : (hitStroke(st, px, py, r * 0.8) ? [] : null);
        if (res === null) { if (out) out.push(st); continue; }
        if (!out) out = cur.slice(0, i);
        out.push(...res);
        dirty = dirty ? [Math.min(dirty[0], b[0]), Math.min(dirty[1], b[1]), Math.max(dirty[2], b[2]), Math.max(dirty[3], b[3])] : b.slice();
        changed = true;
      }
      if (out) strokes = out;
    };
    const run = (px, py) => {
      if (o.last) {
        const dx = px - o.last[0], dy = py - o.last[1], dist = Math.hypot(dx, dy), step = Math.max(r * 0.5, 0.5);
        const n = Math.ceil(dist / step);
        for (let k = 1; k <= n; k++) stepAt(o.last[0] + (dx * k) / n, o.last[1] + (dy * k) / n);
      } else stepAt(px, py);
      o.last = [px, py];
      this.hover = [px, py];
      if (changed) {
        const next = strokes, i = this.doc.cur;
        this.edit((pages) => setStrokes(pages, i, next), o.group);
        changed = false;
        const rect = dirty; dirty = null;
        this.invalidate(rect);
      } else this.repaint();
    };
    o.move = (ev) => { const list = ev.getCoalescedEvents?.() || []; for (const q of list.length ? list : [ev]) { const [wx, wy] = this.toWorld(q.clientX, q.clientY); run(wx, wy); } };
    o.up = () => { this.doc.endGroup(); this.emit('history'); this.repaint(); };
    run(x, y);
    return o;
  }

  /* ---------- crop (pictures, PDF pages, video cards) ---------- */
  /** Starts cropping. The whole original is shown with what will be cut away dimmed; drag the frame's edges and corners, drag inside to move it. */
  startCrop(st, { bg = false } = {}) {
    if (!st || !canCrop(st)) return false;
    this.cancelOp();
    const c = cropOf(st);
    this.crop = { st, full: uncrop(st), f: bg ? [0, 0, 1, 1] : [c[0], c[1], c[2], c[3]], bg, lift: new Set(bg ? [] : [st]) };
    if (this.sel.size) { this.sel = new Set(); this.emit('selection'); }
    this.invalidate();
    this.emit('crop', { on: true });
    return true;
  }
  cancelCrop() {
    if (!this.crop) return;
    this.crop = null;
    this.invalidate();
    this.emit('crop', { on: false });
  }
  cropReset() { if (this.crop) { this.crop.f = [0, 0, 1, 1]; this.repaint(); this.emit('cropmove'); } }
  /** The frame in page units. */
  cropFrame() {
    const C = this.crop, F = C.full;
    return [F.x + C.f[0] * F.w, F.y + C.f[1] * F.h, F.x + C.f[2] * F.w, F.y + C.f[3] * F.h];
  }
  cropScreen() {
    if (!this.crop) return null;
    const b = this.cropFrame(), [x1, y1] = this.toScreen(b[0], b[1]), [x2, y2] = this.toScreen(b[2], b[3]);
    return [x1, y1, x2, y2];
  }
  cropWhole() { return this.crop && this.crop.f[0] <= 0 && this.crop.f[1] <= 0 && this.crop.f[2] >= 1 && this.crop.f[3] >= 1; }
  /** Cuts. For a picture / PDF page / video card the cut-away part stays in the file and can be brought back by cropping again. */
  applyCrop() {
    const C = this.crop;
    if (!C) return null;
    const out = cropObject(C.full, C.f);
    this.crop = null;
    this.emit('crop', { on: false });
    if (C.bg) { this.emit('cropdone', { obj: out }); this.invalidate(); return out; }
    if (out.x !== C.st.x || out.y !== C.st.y || out.w !== C.st.w || out.h !== C.st.h || JSON.stringify(out.crop) !== JSON.stringify(C.st.crop)) {
      this.replaceStrokes(new Map([[C.st, out]]));
      this.sel = new Set([out]); this.emit('selection');
    } else { this.invalidate(); this.sel = new Set([C.st]); this.emit('selection'); }
    return out;
  }
  cropOp(e, x, y) {
    const C = this.crop, F = C.full, s = this.view.s;
    const [X1, Y1, X2, Y2] = this.cropFrame();
    const R = 26 / s;
    const inX = x > X1 - R && x < X2 + R, inY = y > Y1 - R && y < Y2 + R;
    let l = Math.abs(x - X1) <= R && inY, r = Math.abs(x - X2) <= R && inY, t = Math.abs(y - Y1) <= R && inX, b = Math.abs(y - Y2) <= R && inX;
    if (l && r) { if (Math.abs(x - X1) <= Math.abs(x - X2)) r = false; else l = false; }
    if (t && b) { if (Math.abs(y - Y1) <= Math.abs(y - Y2)) b = false; else t = false; }
    const move = !(l || r || t || b) && x > X1 && x < X2 && y > Y1 && y < Y2;
    if (!(l || r || t || b || move)) return this.panOp(e);   // empty space: move the view
    const f0 = C.f.slice();
    const minW = Math.max(0.03, 30 / s / F.w), minH = Math.max(0.03, 30 / s / F.h);
    const clamp1 = (v, a, z) => Math.max(a, Math.min(z, v));
    const o = { type: 'crop' };
    o.move = (ev) => {
      const [wx, wy] = this.toWorld(ev.clientX, ev.clientY);
      const dx = (wx - x) / F.w, dy = (wy - y) / F.h;
      const f = f0.slice();
      if (move) {
        const w = f0[2] - f0[0], h = f0[3] - f0[1];
        f[0] = clamp1(f0[0] + dx, 0, 1 - w); f[2] = f[0] + w;
        f[1] = clamp1(f0[1] + dy, 0, 1 - h); f[3] = f[1] + h;
      } else {
        if (l) f[0] = clamp1(f0[0] + dx, 0, f0[2] - minW);
        if (r) f[2] = clamp1(f0[2] + dx, f0[0] + minW, 1);
        if (t) f[1] = clamp1(f0[1] + dy, 0, f0[3] - minH);
        if (b) f[3] = clamp1(f0[3] + dy, f0[1] + minH, 1);
      }
      C.f = f;
      this.repaint();
      this.emit('cropmove');
    };
    o.up = () => { this.emit('cropmove'); };
    return o;
  }
  /** The whole original under the frame, with everything that will be cut away dimmed. */
  drawCropObject(m, env) {
    const C = this.crop, F = C.full;
    drawStroke(m, F, { ...env, live: false });
    const [x1, y1, x2, y2] = this.cropFrame();
    m.save();
    m.fillStyle = 'rgba(8,12,24,.62)';
    m.fillRect(F.x, F.y, F.w, y1 - F.y);
    m.fillRect(F.x, y2, F.w, F.y + F.h - y2);
    m.fillRect(F.x, y1, x1 - F.x, y2 - y1);
    m.fillRect(x2, y1, F.x + F.w - x2, y2 - y1);
    m.restore();
  }
  drawCropFrame(m) {
    const s = this.view.s, [x1, y1, x2, y2] = this.cropFrame();
    m.save();
    m.lineWidth = 1.6 / s; m.strokeStyle = '#ffffff';
    m.strokeRect(x1, y1, x2 - x1, y2 - y1);
    m.lineWidth = 1 / s; m.strokeStyle = 'rgba(255,255,255,.4)';
    m.beginPath();
    for (let i = 1; i <= 2; i++) {
      m.moveTo(x1 + ((x2 - x1) * i) / 3, y1); m.lineTo(x1 + ((x2 - x1) * i) / 3, y2);
      m.moveTo(x1, y1 + ((y2 - y1) * i) / 3); m.lineTo(x2, y1 + ((y2 - y1) * i) / 3);
    }
    m.stroke();
    // grips: thick corner brackets and a short bar in the middle of each edge
    const L = Math.min(22 / s, (x2 - x1) / 3, (y2 - y1) / 3), th = 4.5 / s, mx = (x1 + x2) / 2, my = (y1 + y2) / 2, bar = Math.min(18 / s, (x2 - x1) / 4, (y2 - y1) / 4);
    m.lineCap = 'round'; m.lineJoin = 'round'; m.strokeStyle = '#ffffff'; m.shadowColor = 'rgba(0,0,0,.55)'; m.shadowBlur = 4;
    m.lineWidth = th;
    m.beginPath();
    m.moveTo(x1, y1 + L); m.lineTo(x1, y1); m.lineTo(x1 + L, y1);
    m.moveTo(x2 - L, y1); m.lineTo(x2, y1); m.lineTo(x2, y1 + L);
    m.moveTo(x2, y2 - L); m.lineTo(x2, y2); m.lineTo(x2 - L, y2);
    m.moveTo(x1 + L, y2); m.lineTo(x1, y2); m.lineTo(x1, y2 - L);
    m.moveTo(mx - bar, y1); m.lineTo(mx + bar, y1);
    m.moveTo(mx - bar, y2); m.lineTo(mx + bar, y2);
    m.moveTo(x1, my - bar); m.lineTo(x1, my + bar);
    m.moveTo(x2, my - bar); m.lineTo(x2, my + bar);
    m.stroke();
    m.restore();
  }

  /* ---------- area eraser ---------- */
  /** Things that go as a whole when an area is erased: text boxes, and pictures / PDF pages / video cards that are (nearly) all inside. */
  areaDoomed(reg) {
    const out = [], rb = regionBoxOf(reg);
    for (const st of this.curStrokes()) {
      if (st.t !== 'text' && !isObj(st)) continue;
      const b = bbox(st);
      if (b[2] < rb[0] || b[0] > rb[2] || b[3] < rb[1] || b[1] > rb[3]) continue;
      if (regionCovers(st, reg) >= (st.t === 'text' ? 0.5 : st.t === 'pdfp' ? 0.9 : 0.75)) out.push(st);
    }
    return out;
  }
  /** Erases an area. Drag any way: a box (straight down or across = whole rows / columns) or, with "free", any shape you draw. */
  areaOp(e, x, y) {
    const free = this.prefs.eraser.shape === 'free';
    const o = { type: 'area', a: [x, y], b: [x, y], path: [[x, y]], reg: null, doomed: [], group: this.newGroup() };
    const sc = () => this.view.s;
    const build = () => {
      const s = sc();
      if (free) {
        const xs = o.path.map((q) => q[0]), ys = o.path.map((q) => q[1]);
        const big = o.path.length >= 3 && (Math.max(...xs) - Math.min(...xs)) * s > 8 && (Math.max(...ys) - Math.min(...ys)) * s > 8;
        o.reg = big ? { poly: o.path.flat() } : null;
      } else {
        const { x: vx, y: vy } = this.view, pg = this.page;
        const dx = (o.b[0] - o.a[0]) * s, dy = (o.b[1] - o.a[1]) * s, adx = Math.abs(dx), ady = Math.abs(dy);
        let x1 = Math.min(o.a[0], o.b[0]), x2 = Math.max(o.a[0], o.b[0]), y1 = Math.min(o.a[1], o.b[1]), y2 = Math.max(o.a[1], o.b[1]);
        // smart: a straight drag down (or up) takes whole rows across the page, a straight drag sideways takes whole columns
        if (ady >= 36 && adx <= ady * 0.3) { x1 = pg.w ? 0 : -vx / s; x2 = pg.w ? pg.w : (this.W - vx) / s; }
        else if (adx >= 36 && ady <= adx * 0.3) { y1 = pg.h ? 0 : -vy / s; y2 = pg.h ? pg.h : (this.H - vy) / s; }
        o.reg = (x2 - x1) * s >= 5 && (y2 - y1) * s >= 5 ? { box: [x1, y1, x2, y2] } : null;
      }
      o.doomed = o.reg ? this.areaDoomed(o.reg) : [];
      this.repaint();
    };
    o.move = (ev) => {
      const list = ev.getCoalescedEvents?.() || [];
      for (const q of list.length ? list : [ev]) {
        const [wx, wy] = this.toWorld(q.clientX, q.clientY);
        o.b = [wx, wy];
        const last = o.path[o.path.length - 1];
        if (Math.hypot(wx - last[0], wy - last[1]) * sc() >= 2) o.path.push([wx, wy]);
      }
      build();
    };
    o.up = () => {
      this.hover = null;
      const reg = o.reg;
      if (!reg) { this.repaint(); return; }
      const i = this.doc.cur, out = [], hid = this.hiddenTest();
      let changed = false;
      for (const st of this.doc.page.strokes) {
        if (st.bk && hid(st)) { out.push(st); continue; }
        if (st.t === 'text' || isObj(st)) { if (o.doomed.includes(st)) changed = true; else out.push(st); continue; }
        const res = eraseRegion(st, reg);
        if (res === null) out.push(st); else { changed = true; out.push(...res); }
      }
      if (changed) {
        this.edit((pages) => setStrokes(pages, i, out), o.group);
        const keep = new Set(out);
        if ([...this.sel].some((st) => !keep.has(st))) { this.sel = new Set([...this.sel].filter((st) => keep.has(st))); this.emit('selection'); }
        this.invalidate();
      }
      this.doc.endGroup();
      this.emit('history');
      this.repaint();
    };
    o.cancel = () => { o.reg = null; this.repaint(); };
    return o;
  }

  /* ---------- shapes ---------- */
  shapeOp(e, x, y) {
    const kind = this.prefs.shape.kind, pref = this.prefs.shape;
    const a = this.snapPt(x, y);
    const o = { type: 'shape', a, b: a, preview: null };
    const build = () => {
      let b = o.b;
      if (o.constrain) {
        const dx = b[0] - a[0], dy = b[1] - a[1];
        if (kind === 'line' || kind === 'arrow') { const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 12)) * (Math.PI / 12), l = Math.hypot(dx, dy); b = [a[0] + l * Math.cos(ang), a[1] + l * Math.sin(ang)]; }
        else { const m = Math.max(Math.abs(dx), Math.abs(dy)); b = [a[0] + Math.sign(dx || 1) * m, a[1] + Math.sign(dy || 1) * m]; }
      }
      o.final = b;
      o.preview = { t: kind, c: pref.c, w: this.penW(pref.w), a, b: b.map(round1), ...(pref.f && kind !== 'line' && kind !== 'arrow' ? { f: true } : {}) };
      o.preview.a = a.map(round1);
    };
    o.move = (ev) => {
      const [wx, wy] = this.toWorld(ev.clientX, ev.clientY);
      o.b = this.snapPt(wx, wy);
      o.constrain = false;
      clearTimeout(this.holdT);
      this.holdT = setTimeout(() => { o.constrain = true; build(); this.present(); this.emit('snapped'); }, 520);
      build(); this.repaint();
    };
    o.up = () => {
      clearTimeout(this.holdT);
      if (!o.preview || Math.hypot(o.b[0] - a[0], o.b[1] - a[1]) * this.view.s < 4) { this.repaint(); return; }
      this.commitLive(o.preview);
    };
    o.cancel = () => clearTimeout(this.holdT);
    return o;
  }

  /* ---------- taps (text) ---------- */
  tapOp(e, fn) {
    const t0 = performance.now();
    return { type: 'tap', move() {}, up: (ev, p) => { if (!p.moved && performance.now() - t0 < 600) fn(...this.toWorld(ev.clientX, ev.clientY), ev); } };
  }
  topAt(x, y, r, pred = () => true) {
    const list = this.curStrokes();
    for (let i = list.length - 1; i >= 0; i--) if (pred(list[i]) && hitStroke(list[i], x, y, r)) return list[i];
    return null;
  }
  textTap(x, y) {
    const hit = this.topAt(x, y, 4 / this.view.s, (s) => s.t === 'text');
    if (hit) { this.sel = new Set([hit]); this.emit('selection'); this.emit('text', { stroke: hit }); }
    else { const [sx, sy] = this.snapPt(x, y); this.emit('text', { stroke: null, x: sx, y: sy }); }
    this.invalidate();
  }
  /** Creates / updates / removes a text box. Called by the viewer's text editor. */
  commitText(orig, p) {
    const ctx = this.cctx;
    const txt = String(p.s || '');
    if (!txt.trim()) { if (orig) this.replaceStrokes(new Map(), [orig]); return null; }
    const pageW = this.page.w || 900;
    const base = { t: 'text', c: p.c, x: orig ? orig.x : p.x, y: orig ? orig.y : p.y, s: txt, size: p.size, ...(p.bold ? { bold: true } : {}), ...(p.bg ? { bg: p.bg } : {}) };
    const maxW = Math.max(120, Math.min(420, pageW - base.x - 10 + (this.page.w ? 0 : 400)));
    base.bw = orig ? orig.bw : (p.bw || naturalWidth(ctx, txt, p.size, p.bold, p.bg, maxW));
    base.bh = 0;
    const stroke = refitText(ctx, base);
    if (orig) this.replaceStrokes(new Map([[orig, stroke]]));
    else this.addStrokes([stroke], this.newGroup());
    this.sel = new Set([stroke]); this.emit('selection');
    return stroke;
  }

  /* ---------- laser ---------- */
  laserOp(e, x, y) {
    this.trail.push({ x, y, t: performance.now(), brk: true });
    const o = { type: 'laser', move: (ev) => { const [wx, wy] = this.toWorld(ev.clientX, ev.clientY); this.trail.push({ x: wx, y: wy, t: performance.now() }); this.repaint(); }, up: () => this.repaint() };
    this.repaint();
    return o;
  }

  /* ---------- selection ---------- */
  selectOp(e, x, y) {
    const s = this.view.s;
    const t0 = performance.now();
    const box = this.selBox();
    // grab the resize handle
    if (box) {
      const [hx, hy] = this.toScreen(box[2], box[3]);
      const cx = e.clientX - this.rect.left, cy = e.clientY - this.rect.top;
      if (Math.hypot(cx - hx, cy - hy) < 26) return this.scaleOp(box, x, y);
      if (x >= box[0] - 6 / s && x <= box[2] + 6 / s && y >= box[1] - 6 / s && y <= box[3] + 6 / s) return this.moveOp(e, x, y);
    }
    const hit = this.topAt(x, y, 8 / s);
    if (hit) {
      this.sel = new Set([hit]); this.emit('selection');
      const op = this.moveOp(e, x, y);
      op.tapSelect = hit;
      return op;
    }
    // empty space: marquee (or a tap that clears the selection)
    const o = { type: 'marquee', a: [x, y], b: [x, y] };
    o.move = (ev) => { o.b = this.toWorld(ev.clientX, ev.clientY); this.repaint(); };
    o.up = (ev, p) => {
      const small = Math.hypot((o.b[0] - o.a[0]) * s, (o.b[1] - o.a[1]) * s) < 8;
      if (small) { if (this.sel.size) { this.sel = new Set(); this.emit('selection'); } return; }
      const r = [Math.min(o.a[0], o.b[0]), Math.min(o.a[1], o.b[1]), Math.max(o.a[0], o.b[0]), Math.max(o.a[1], o.b[1])];
      const got = this.curStrokes().filter((st) => inRect(st, r));
      this.sel = new Set(got); this.emit('selection');
      void t0; void p;
    };
    return o;
  }
  moveOp(e, x, y) {
    const { items, added } = this.withInk([...this.sel]);
    const o = { type: 'move', dx: 0, dy: 0, moved: null, lift: null, started: false };
    const s = this.view.s;
    o.move = (ev) => {
      const [wx, wy] = this.toWorld(ev.clientX, ev.clientY);
      let dx = wx - x, dy = wy - y;
      if (!o.started && Math.hypot(dx * s, dy * s) < 5) return;
      if (!o.started) { o.started = true; o.lift = new Set(items); this.invalidate(); }
      if (this.prefs.snap) { const b = this.selBox(); dx = Math.round((b[0] + dx) / 12) * 12 - b[0]; dy = Math.round((b[1] + dy) / 12) * 12 - b[1]; }
      o.dx = dx; o.dy = dy;
      o.moved = items.map((st) => moveStroke(st, dx, dy));
      this.repaint();
    };
    o.up = () => {
      if (!o.started) {
        // a tap: a second tap on the same media card plays it, on text edits it
        const now = performance.now();
        const sole = items.length === 1 ? items[0] : null;
        const prev = this.lastTap;
        if (sole && prev && prev.s === sole && now - prev.t < 420) {
          this.lastTap = null;
          if (sole.t === 'media') this.emit('media', { stroke: sole });
          else if (sole.t === 'text') this.emit('text', { stroke: sole });
          else if (sole.t === 'pdfp') this.emit('openFile', { stroke: sole });
          else if (sole.t === 'img') this.emit('openFile', { stroke: sole });
        } else this.lastTap = sole ? { s: sole, t: now } : null;
        o.lift = null; this.invalidate(); return;
      }
      const map = new Map(items.map((st, i) => [st, o.moved[i]]));
      o.lift = null;
      this.replaceStrokes(map);
      this.sel = new Set(o.moved.filter((_, i) => !added.has(items[i]))); this.emit('selection');
    };
    o.cancel = () => { o.lift = null; };
    return o;
  }
  scaleOp(box, x, y) {
    const { items, added } = this.withInk([...this.sel]);
    const ax = box[0], ay = box[1];
    const d0 = Math.max(1, Math.hypot(box[2] - ax, box[3] - ay));
    const o = { type: 'scale', k: 1, moved: null, lift: new Set(items) };
    o.move = (ev) => {
      const [wx, wy] = this.toWorld(ev.clientX, ev.clientY);
      o.k = clamp(Math.hypot(wx - ax, wy - ay) / d0, 0.1, 12);
      o.moved = items.map((st) => scaleStroke(st, ax, ay, o.k));
      this.repaint();
    };
    o.up = () => {
      if (!o.moved) { o.lift = null; this.invalidate(); return; }
      const map = new Map(items.map((st, i) => [st, o.moved[i]]));
      o.lift = null;
      this.replaceStrokes(map);
      this.sel = new Set(o.moved.filter((_, i) => !added.has(items[i]))); this.emit('selection');
    };
    o.cancel = () => { o.lift = null; };
    this.invalidate();
    return o;
  }

  /* ---------- selection actions (called by the viewer) ---------- */
  setSelection(list) { this.sel = new Set(list); this.emit('selection'); this.invalidate(); }
  clearSelection() { if (this.sel.size) { this.sel = new Set(); this.emit('selection'); this.invalidate(); } }
  selectAll() { this.sel = new Set(this.curStrokes()); this.emit('selection'); this.invalidate(); }
  selected() { return [...this.sel]; }
  deleteSelection() {
    if (!this.sel.size) return;
    const gone = [...this.sel];
    this.sel = new Set(); this.emit('selection');
    this.replaceStrokes(new Map(), gone);
  }
  duplicateSelection() {
    if (!this.sel.size) return;
    const copies = [...this.sel].map((st) => moveStroke(st, 22, 22));
    this.addStrokes(copies, this.newGroup(), { select: true });
  }
  copySelection() { CLIP = [...this.sel]; this.emit('clip'); return CLIP.length; }
  paste() {
    if (!CLIP.length) return 0;
    const b = unionBox(CLIP), [cx, cy] = this.viewCenter();
    const dx = cx - (b[0] + b[2]) / 2, dy = cy - (b[1] + b[3]) / 2;
    this.addStrokes(CLIP.map((st) => moveStroke(st, dx, dy)), this.newGroup(), { select: true });
    return CLIP.length;
  }
  applyToSelection(patch) {
    if (!this.sel.size) return;
    const map = new Map();
    for (const st of this.sel) {
      if (isObj(st)) continue;
      const n = { ...st };
      if (patch.c != null) { if (st.t === 'text' && st.bg) n.bg = patch.c; else n.c = patch.c; }
      if (patch.w != null && st.t !== 'text') n.w = patch.w;
      if (patch.size != null && st.t === 'text') n.size = patch.size;
      if (patch.f != null && st.t !== 'text') { if (patch.f) n.f = true; else delete n.f; }
      map.set(st, st.t === 'text' && patch.size != null ? refitText(this.cctx, { ...n, bh: 0 }) : n);
    }
    if (!map.size) return;
    this.replaceStrokes(map);
    this.sel = new Set(map.values()); this.emit('selection');
  }
  reorder(front) {
    if (!this.sel.size) return;
    const chosen = new Set(this.sel), i = this.doc.cur;
    this.edit((pages) => {
      const all = pages[i].strokes;
      const split = (obj) => all.filter((st) => isObj(st) === obj);
      const out = [];
      for (const obj of [true, false]) { const seg = split(obj), pick = seg.filter((st) => chosen.has(st)), rest = seg.filter((st) => !chosen.has(st)); out.push(...(front ? [...rest, ...pick] : [...pick, ...rest])); }
      return setStrokes(pages, i, out);
    }, this.newGroup());
    this.doc.endGroup(); this.invalidate(); this.emit('history');
  }

  /* ---------- placing things ---------- */
  /** Adds a picture / PDF page / media card in the middle of what is on screen. */
  placeObject(obj, { fitW = 360 } = {}) {
    const [cx, cy] = this.viewCenter();
    const fixed = !!this.page.w;
    const k = Math.min(1, (fixed ? this.page.w * 0.8 : fitW * 1.6) / obj.w, (fixed ? this.page.h * 0.7 : 900) / obj.h);
    const w = obj.w * k, h = obj.h * k;
    let x = cx - w / 2, y = cy - h / 2;
    // cascade: an object dropped on top of another one is nudged so both stay reachable
    for (let i = 0; i < 8; i++) {
      if (!this.curStrokes().some((o) => isObj(o) && Math.abs(o.x - x) < 10 && Math.abs(o.y - y) < 10)) break;
      x += 28; y += 28;
    }
    if (fixed) { x = clamp(x, 0, Math.max(0, this.page.w - w)); y = clamp(y, 0, Math.max(0, this.page.h - h)); }
    const s = { ...obj, w: round1(w), h: round1(h), x: round1(x), y: round1(y) };
    this.addStrokes([s], this.newGroup(), { select: true });
    return s;
  }

  /** Puts a book on the board, closed on its front cover, with the cover in the middle of what you see. */
  placeBook({ ref, n, pr, cc }) {
    const [cx, cy] = this.viewCenter();
    const fixed = !!this.page.w;
    let W = fixed ? this.page.w * 0.8 : 520, ph = (W / 2) / pr;
    if (fixed && ph > this.page.h * 0.75) { ph = this.page.h * 0.75; W = ph * pr * 2; }
    const w = round1(W), h = round1(ph);
    let x = cx - w / 2, y = cy - h / 2;                                   // the open book would be centred; closed it shows its cover on the right half
    if (fixed) { x = clamp(x, 0, Math.max(0, this.page.w - w)); y = clamp(y, 0, Math.max(0, this.page.h - h)); }
    const b = { t: 'book', id: uid(), ref, n, pr: Math.round(pr * 10000) / 10000, x: round1(x), y: round1(y), w, h, sp: 0, st: '3d', cc: cc || '#2b3d6b' };
    this.addStrokes([b], this.newGroup(), { select: false });
    return b;
  }

  setTool(tool) {
    if (tool === this.prefs.tool) return;
    this.cancelOp();
    if (this.crop) this.cancelCrop();
    this.prefs.tool = tool;
    if (tool !== 'select' && tool !== 'text') this.clearSelection();
    this.hover = null;
    this.invalidate();
    this.emit('tool');
  }
  setActiveMedia(st) { this.activeMedia = st; this.invalidate(); }
}

function inRect(st, r) {
  const b = bbox(st);
  if (b[0] >= r[0] && b[2] <= r[2] && b[1] >= r[1] && b[3] <= r[3]) return true;
  if (!bboxHit(b, r[0], r[1], r[2], r[3])) return false;
  if (st.t === 'text' || isObj(st)) return true;
  const o = outline(st);
  for (let i = 0; i < o.pts.length; i += 2) if (o.pts[i] >= r[0] && o.pts[i] <= r[2] && o.pts[i + 1] >= r[1] && o.pts[i + 1] <= r[3]) return true;
  return false;
}
