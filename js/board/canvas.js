// The drawing surface: page rendering with a cache, pan / zoom, and every tool. The viewer builds the buttons around it.
import { bbox, bboxHit, hitStroke, eraseFromStroke, recognize, mapStroke, moveStroke, scaleStroke, unionBox, isObj, isInk, outline } from './geom.js';
import { drawPaper, drawStroke, isDark, refitText, naturalWidth } from './render.js';
import { setStrokes, patchPage } from './doc.js';

const STAGE_BG = '#131725';
let CLIP = []; // copied strokes, shared by every board during this session

export const clipboardCount = () => CLIP.length;

const round1 = (v) => Math.round(v * 10) / 10;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export class BoardCanvas {
  constructor({ doc, stage, assets, prefs }) {
    this.doc = doc; this.stage = stage; this.assets = assets;
    this.prefs = prefs; // { tool, pen:{c,w}, hl:{c,w}, eraser:{mode,size}, shape:{kind,c,w,f}, text:{c,size,bold,bg}, laser:{c}, penOnly, assist, snap }
    this.on = {};
    this.main = document.createElement('canvas');
    this.main.className = 'bd-main';
    stage.append(this.main);
    this.mctx = this.main.getContext('2d');
    this.cache = document.createElement('canvas');
    this.cctx = this.cache.getContext('2d');
    this.view = { s: 1, x: 0, y: 0 };
    this.insets = { top: 56, bottom: 120 };
    this.views = new Map();
    this.pointers = new Map();
    this.op = null; this.gesture = null;
    this.sel = new Set();
    this.hover = null;
    this.trail = [];
    this.activeMedia = null;
    this.costMs = 0; this.rasterMs = 0; this.lastPts = 0;
    this.raf = 0; this.fullDirty = true; this.dirty = null;
    this.gid = 0;
    this.lastPen = 0; this.penDown = 0; this.lastPenUp = 0;
    this.lastTap = null;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this._self = false;

    this.pageId = doc.page.id;
    this.unDoc = doc.onChange((kind) => {
      if (this._self) return;
      if (kind === 'style' || kind === 'quiet') { this.invalidate(); return; }
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
    this.ro?.disconnect();
    clearTimeout(this.holdT);
    cancelAnimationFrame(this.raf);
    this.stage.removeEventListener('pointerdown', this.onDown);
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    window.removeEventListener('pointercancel', this.onUp);
    this.main.remove();
    this.cache.width = this.cache.height = 1;
  }

  /* ---------------- size, view ---------------- */
  resize() {
    const r = this.stage.getBoundingClientRect();
    this.rect = r;
    this.W = Math.max(1, Math.round(r.width)); this.H = Math.max(1, Math.round(r.height));
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    for (const c of [this.main, this.cache]) { c.width = Math.round(this.W * this.dpr); c.height = Math.round(this.H * this.dpr); }
    this.main.style.width = this.W + 'px'; this.main.style.height = this.H + 'px';
    this.clampView();
    this.invalidate();
    this.emit('view');
  }
  setInsets(top, bottom) { this.insets = { top, bottom }; }

  fitView() {
    const p = this.page, { top, bottom } = this.insets;
    const availH = Math.max(100, this.H - top - bottom);
    if (p.w) {
      const s = (this.W - 16) / p.w;
      this.view = { s, x: 8, y: top + 6 };
      if (p.h * s < availH) this.view.y = top + (availH - p.h * s) / 2;
    } else {
      this.view = { s: 1, x: this.W / 2, y: top + availH / 2 };
    }
    this.afterView();
  }
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
  viewCenter() { return [(this.W / 2 - this.view.x) / this.view.s, ((this.insets.top + (this.H - this.insets.bottom)) / 2 - this.view.y) / this.view.s]; }
  zoomBy(f, cx = this.W / 2, cy = this.H / 2) {
    const v = this.view, ns = clamp(v.s * f, this.minS, this.maxS), k = ns / v.s;
    v.x = cx - (cx - v.x) * k; v.y = cy - (cy - v.y) * k; v.s = ns;
    this.afterView();
  }
  setPage(i) {
    i = clamp(i, 0, this.doc.pages.length - 1);
    if (i === this.doc.cur) return;
    this.cancelOp();
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
    if (this.cssMode) return;
    let full = false;
    if (this.fullDirty) { this.renderCache(); this.fullDirty = false; this.dirty = null; full = true; }
    else if (this.dirty) { this.renderCache(this.dirty); this.dirty = null; full = true; }
    this.present();
    if (full) this.measureRaster();
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
    const env = { dark, assets: this.assets, scale: s, dpr: d, hideMedia: this.activeMedia, lift: this.op?.lift };
    const lift = this.op?.lift;
    const list = p.strokes;
    const clipPage = () => { if (p.w) { ctx.beginPath(); ctx.rect(0, 0, p.w, p.h); ctx.clip(); } };
    ctx.save(); clipPage();
    for (const st of list) if (isObj(st) && !lift?.has(st) && bboxHit(bbox(st), cull[0], cull[1], cull[2], cull[3])) drawStroke(ctx, st, env);
    if (this.activeMedia) { const m = this.activeMedia; ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(Math.floor((m.x * s + x) * d), Math.floor((m.y * s + y) * d), Math.ceil(m.w * s * d), Math.ceil(m.h * s * d)); ctx.restore(); }
    let pts = 0;
    for (const st of list) if (!isObj(st) && !lift?.has(st) && bboxHit(bbox(st), cull[0], cull[1], cull[2], cull[3])) { drawStroke(ctx, st, env); pts += st.pts ? st.pts.length >> 1 : 2; }
    if (!rect) this.lastPts = pts;
    ctx.restore(); // page clip
    ctx.restore();
    const dt = performance.now() - t0;
    this.costMs = this.costMs ? this.costMs * 0.7 + dt * 0.3 : dt;
  }

  present() {
    const m = this.mctx, d = this.dpr, { s, x, y } = this.view;
    m.setTransform(1, 0, 0, 1, 0, 0);
    m.clearRect(0, 0, this.main.width, this.main.height);
    m.drawImage(this.cache, 0, 0);
    m.setTransform(d * s, 0, 0, d * s, d * x, d * y);
    const env = { dark: this.isDarkPaper(), assets: this.assets, scale: s, dpr: d, live: true };
    const op = this.op;
    m.save();
    if (this.page.w) { m.beginPath(); m.rect(0, 0, this.page.w, this.page.h); m.clip(); }
    if (op) {
      if (op.type === 'draw') {
        const live = op.snapped || { t: this.tool === 'hl' ? 'hl' : 'pen', c: this.prefs[this.tool === 'hl' ? 'hl' : 'pen'].c, w: this.prefs[this.tool === 'hl' ? 'hl' : 'pen'].w, pts: op.pts, ...(op.hasPr ? { pr: op.pr } : {}) };
        drawStroke(m, live, env);
      } else if (op.type === 'shape' && op.preview) drawStroke(m, op.preview, env);
      else if ((op.type === 'move' || op.type === 'scale') && op.moved) for (const st of op.moved) drawStroke(m, st, env);
      else if (op.type === 'marquee') {
        const [a, b] = [op.a, op.b];
        m.save(); m.fillStyle = 'rgba(80,140,255,.14)'; m.strokeStyle = 'rgba(80,140,255,.9)'; m.lineWidth = 1.2 / s; m.setLineDash([5 / s, 4 / s]);
        m.fillRect(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
        m.strokeRect(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
        m.restore();
      }
    }
    m.restore();
    if (this.sel.size) this.drawSelection(m);
    if (this.tool === 'eraser' && this.hover && !(this.op && this.op.type !== 'erase')) {
      const r = this.eraserR();
      m.save(); m.beginPath(); m.arc(this.hover[0], this.hover[1], r, 0, 6.2832);
      m.fillStyle = 'rgba(255,255,255,.12)'; m.fill(); m.lineWidth = 1.4 / s; m.strokeStyle = this.isDarkPaper() ? 'rgba(255,255,255,.8)' : 'rgba(0,0,0,.65)'; m.stroke(); m.restore();
    }
    if (this.trail.length) this.drawLaser(m);
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
    if (this.pointers.size >= 2) { this.cancelOp(); this.startGesture(); return; }
    this.startOp(e);
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
    const type = e.pointerType;
    let tool = this.tool;
    if (type === 'pen' && (e.buttons & 32)) tool = 'eraser';
    if (e.pointerType === 'mouse' && e.button === 1) tool = 'hand';
    if (this.touchBlocked(e) && tool !== 'hand') tool = 'hand';
    this.activeTool = tool;
    const [x, y] = this.toWorld(e.clientX, e.clientY);
    const p = this.page;
    const outside = p.w && (x < -6 || y < -6 || x > p.w + 6 || y > p.h + 6);
    if (outside && ['pen', 'hl', 'shape', 'text'].includes(tool)) tool = 'hand';
    switch (tool) {
      case 'hand': this.op = this.panOp(e); break;
      case 'pen': case 'hl': this.op = this.drawOp(e, tool, x, y); break;
      case 'eraser': this.op = this.eraseOp(e, x, y); break;
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
    if (op) { this.cssMode = false; this.main.style.transform = ''; this.invalidate(); }
  }

  /* ---------- pan (one pointer) ---------- */
  panOp(e) {
    const base = { ...this.view }, sx = e.clientX, sy = e.clientY;
    this.beginMove();
    return {
      type: 'pan',
      move: (ev) => { this.view.x = base.x + ev.clientX - sx; this.view.y = base.y + ev.clientY - sy; this.moveView(base); },
      up: () => this.endMove(),
      cancel: () => this.endMove(),
    };
  }
  beginMove() { this.cssMode = Math.max(this.costMs, this.rasterMs || 0) > 22 || this.lastPts > 70000; this.cssBase = { ...this.view }; }
  moveView(base) {
    this.clampView();
    if (this.cssMode) {
      const v = this.view, k = v.s / base.s;
      this.main.style.transformOrigin = '0 0';
      this.main.style.transform = `translate(${v.x - k * base.x}px, ${v.y - k * base.y}px) scale(${k})`;
      this.emit('view');
    } else { this.invalidate(); this.emit('view'); }
  }
  endMove() {
    if (this.cssMode) { this.cssMode = false; this.main.style.transform = ''; }
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
  curStrokes() { return this.doc.page.strokes; }
  /** Adds strokes to the page: ink goes on top, placed things (pictures, PDF pages, media) go under the ink. */
  addStrokes(list, group = this.newGroup(), { select = false } = {}) {
    const i = this.doc.cur;
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
  replaceStrokes(map, remove = [], group = this.newGroup()) {
    const i = this.doc.cur, gone = new Set(remove);
    this.edit((pages) => setStrokes(pages, i, pages[i].strokes.flatMap((s) => (gone.has(s) ? [] : map.has(s) ? [map.get(s)] : [s]))), group);
    this.doc.endGroup();
    this.invalidate();
    this.emit('history');
  }

  /* ---------- pen / highlighter ---------- */
  drawOp(e, tool, x, y) {
    const o = { type: 'draw', pts: [round1(x), round1(y)], pr: [this.press(e)], hasPr: false, snapped: null };
    const pref = this.prefs[tool];
    const start = performance.now();
    const arm = () => {
      clearTimeout(this.holdT);
      if (this.prefs.assist !== 'hold') return;
      this.holdT = setTimeout(() => {
        if (o.pts.length < 6 || o.snapped) return;
        const r = recognize(o.pts);
        if (r) { o.snapped = { ...r, c: pref.c, w: pref.w, ...(tool === 'hl' ? { t: r.t } : {}) }; this.present(); this.emit('snapped'); }
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
        if (Math.hypot(wx - o.pts[n - 2], wy - o.pts[n - 1]) * s < 0.9) continue;
        o.pts.push(round1(wx), round1(wy));
        const p = this.press(q);
        o.pr.push(p);
        if (q.pointerType === 'pen' && Math.abs(p - 0.5) > 0.03) o.hasPr = true;
      }
      arm();
      this.repaint();
    };
    o.up = () => {
      clearTimeout(this.holdT);
      let stroke = o.snapped;
      if (!stroke && this.prefs.assist === 'auto' && o.pts.length >= 6) {
        const r = recognize(o.pts);
        if (r) stroke = { ...r, c: pref.c, w: pref.w };
      }
      if (stroke) { stroke = this.stripShape(stroke, tool); }
      else {
        const pts = o.pts.slice(), pr = o.pr.slice();
        const stroke0 = { t: tool === 'hl' ? 'hl' : 'pen', c: pref.c, w: pref.w, pts };
        if (o.hasPr && tool !== 'hl') stroke0.pr = pr.map((v) => Math.round(v * 100) / 100);
        stroke = stroke0;
      }
      this.commitLive(stroke);
      void start;
    };
    o.cancel = () => clearTimeout(this.holdT);
    arm();
    this.repaint();
    return o;
  }
  stripShape(s) { const { t, c, w } = s; if (t === 'poly') return { t, c, w, closed: true, pts: s.pts }; return s; }
  press(ev) { return ev.pointerType === 'pen' && ev.pressure > 0 ? ev.pressure : 0.5; }

  /** Puts a finished stroke on the page and paints it into the cache without redrawing everything. */
  commitLive(stroke) {
    this.op = null;
    this.edit((pages) => setStrokes(pages, this.doc.cur, [...pages[this.doc.cur].strokes, stroke]), this.newGroup());
    this.doc.endGroup();
    const ctx = this.cctx, { s, x, y } = this.view, d = this.dpr;
    ctx.save(); ctx.setTransform(d * s, 0, 0, d * s, d * x, d * y);
    const pg = this.page;
    if (pg.w) { ctx.beginPath(); ctx.rect(0, 0, pg.w, pg.h); ctx.clip(); }
    drawStroke(ctx, stroke, { dark: this.isDarkPaper(), assets: this.assets, scale: s, dpr: d });
    ctx.restore();
    this.present();
    this.emit('history');
  }

  /* ---------- eraser ---------- */
  eraserR() { return (this.prefs.eraser.size / 2) / this.view.s; }
  eraseOp(e, x, y) {
    const o = { type: 'erase', last: null, group: this.newGroup() };
    const r = this.eraserR();
    const part = this.prefs.eraser.mode === 'part';
    let strokes = null, dirty = null, changed = false;
    const base = this.curStrokes();
    const stepAt = (px, py) => {
      const cur = strokes || base;
      let out = null;
      for (let i = 0; i < cur.length; i++) {
        const st = cur[i];
        if (isObj(st)) { if (out) out.push(st); continue; }
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
      o.preview = { t: kind, c: pref.c, w: pref.w, a, b: b.map(round1), ...(pref.f && kind !== 'line' && kind !== 'arrow' ? { f: true } : {}) };
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
    const items = [...this.sel];
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
      this.sel = new Set(o.moved); this.emit('selection');
    };
    o.cancel = () => { o.lift = null; };
    return o;
  }
  scaleOp(box, x, y) {
    const items = [...this.sel];
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
      this.sel = new Set(o.moved); this.emit('selection');
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

  setTool(tool) {
    if (tool === this.prefs.tool) return;
    this.cancelOp();
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
