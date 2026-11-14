// Books on the board: the small controls under every book (turn page, page number), the page-turn animation and the settings panel.
// The book itself is drawn by the canvas (bookdraw.js). Here only the turning leaf is a DOM element, and only while it moves.
import { h } from '../util.js';
import { ic } from '../icons.js';
import { t } from '../i18n.js';
import { setStrokes } from './doc.js';
import { bookModel, clampSp } from './bookmath.js';
import { drawPage, trimCrop, COVER_COLORS } from './bookdraw.js';
import { drawStroke } from './render.js';
import { bbox } from './geom.js';
import { createLeaf, ease, createFlipBook } from '../viewers/flipbook.js';
import { viewSheet, validView } from '../viewers/bookviews.js';
import { pushLayer } from '../ui.js';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
/** x of the left edge of page n on the board (odd pages are on the right, even on the left; mirrored for right-to-left books) */
export const pageX = (b, n) => { const pw = b.w / 2; let x0 = n % 2 === 1 ? b.x + pw : b.x; if (b.rtl) x0 = 2 * b.x + b.w - (x0 + pw); return x0; };

export class BookLayer {
  constructor(cv) {
    this.cv = cv;
    this.root = h('div', { class: 'bk-layer' });
    cv.stage.append(this.root);
    this.ctl = new Map();
    this.sig = '';
    this.fly = null;
    this.want = null;          // a page turn asked for while another one is running: { id, sp }
    this.panel = null;
    this.dead = false;
  }
  destroy() { this.dead = true; this.closePanel(); this.root.remove(); this.ctl.clear(); }

  books() { return this.cv.page.strokes.filter((s) => s.t === 'book'); }
  byId(id) { return this.cv.page.strokes.find((s) => s.t === 'book' && s.id === id) || null; }
  /** screen rectangle (stage px) of a board box */
  screenBox(b) { const { s, x, y } = this.cv.view; return [x + b[0] * s, y + b[1] * s, x + b[2] * s, y + b[3] * s]; }

  /* ---------------- the small controls under each book ---------------- */
  sync(force = false) {
    if (this.dead) return;
    const cv = this.cv, v = cv.view;
    const sig = `${v.s.toFixed(4)}|${Math.round(v.x)}|${Math.round(v.y)}|${cv.doc.rev}|${cv.bookRev}|${cv.W}|${cv.H}|${this.fly ? 1 : 0}|${cv.crop ? 1 : 0}`;
    if (!force && sig === this.sig) return;
    this.sig = sig;
    const list = this.books(), seen = new Set();
    for (const b of list) {
      let c = this.ctl.get(b.id);
      const box = this.screenBox(bbox(b)), W = cv.W, H = cv.H, ins = cv.insets;
      const visible = !cv.crop && box[2] > 0 && box[0] < W && box[3] > ins.top && box[1] < H - ins.bottom && box[2] - box[0] > 56;
      if (!visible) { if (c) c.el.style.display = 'none'; seen.add(b.id); continue; }
      if (!c) { c = this.makeCtl(b.id); this.ctl.set(b.id, c); this.root.append(c.el); }
      seen.add(b.id);
      const m = bookModel(b.n), sp = clampSp(b), pg = m.pageOf(sp);
      c.el.style.display = '';
      c.el.classList.toggle('rtl', !!b.rtl);
      if (!c.editing) c.pill.textContent = `${pg} / ${b.n}`;
      c.prev.disabled = sp <= 0; c.next.disabled = sp >= m.last;
      c.el.classList.toggle('narrow', box[2] - box[0] < 150);
      const cw = c.el.offsetWidth || 150, ch = 38;
      let left = clamp((box[0] + box[2]) / 2 - cw / 2, 4, W - cw - 4);
      let top = box[3] + 6;
      if (top + ch > H - ins.bottom - 2) top = box[1] - ch - 6;                    // no room below: above the book
      if (top < ins.top + 2) top = Math.min(box[3] - ch - 8, H - ins.bottom - ch - 4);  // no room above either: inside its lower edge
      c.el.style.transform = `translate3d(${left.toFixed(1)}px,${top.toFixed(1)}px,0)`;
    }
    for (const [id, c] of this.ctl) if (!seen.has(id)) { c.el.remove(); this.ctl.delete(id); }
    this.placePanel();
    if (!cv.crop && !this.fly) { const vb = list.find((b) => this.ctl.get(b.id)?.el.style.display !== 'none'); if (vb) this.prefetch(vb); }
  }

  makeCtl(id) {
    const prev = h('button', { class: 'bk-b', type: 'button', 'aria-label': t('bk_prev'), html: ic('back'), onClick: () => this.step(id, -1) });
    const next = h('button', { class: 'bk-b', type: 'button', 'aria-label': t('bk_next'), html: ic('chev'), onClick: () => this.step(id, 1) });
    const pill = h('button', { class: 'bk-pill', type: 'button', 'aria-label': t('bk_goto'), onClick: () => this.editPage(id) });
    const v3 = h('button', { class: 'bk-b bk-3d', type: 'button', 'aria-label': t('bk_view'), title: t('bk_view'), html: ic('bookView'), onClick: () => this.viewScene(id) });
    const el = h('div', { class: 'bk-ctl bd-ui' }, prev, pill, next, v3);
    const c = { el, prev, next, pill, editing: false };
    return c;
  }

  /** the pill turns into a field where a page number can be typed */
  editPage(id) {
    const c = this.ctl.get(id), b = this.byId(id);
    if (!c || !b || c.editing) return;
    c.editing = true;
    const inp = h('input', { class: 'bk-in', type: 'number', inputmode: 'numeric', min: '1', max: String(b.n), value: '', placeholder: `1–${b.n}` });
    c.pill.textContent = ''; c.pill.append(inp);
    let done = false;
    const end = (go) => {
      if (done) return; done = true; c.editing = false;
      const v = parseInt(inp.value, 10);
      inp.remove(); this.sig = ''; this.sync(true);
      if (go && Number.isFinite(v)) this.goPage(id, v);
    };
    inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') end(true); else if (e.key === 'Escape') end(false); });
    inp.addEventListener('blur', () => end(inp.value !== ''));
    inp.addEventListener('pointerdown', (e) => e.stopPropagation());
    setTimeout(() => { inp.focus(); inp.select?.(); }, 30);
  }

  /** how a far jump looks: 'fan' = a few quick leaves, 'flip' = one single page turn straight to the page (like the next page) */
  jumpMode() { try { return localStorage.getItem('ahos.book.jump') === 'flip' ? 'flip' : 'fan'; } catch { return 'fan'; } }
  setJumpMode(v) { try { localStorage.setItem('ahos.book.jump', v); } catch { /* storage blocked */ } }

  /** gets the pages next to the one shown ready in the background, so the next turn does not wait for the PDF */
  prefetch(b) {
    const cv = this.cv, m = bookModel(b.n), sp = clampSp(b);
    if (!b.ref || this.fly) return;
    const k = b.id + ':' + sp + ':' + Math.round(cv.view.s * 4);
    if (this._pf === k) return;
    this._pf = k;
    const px = Math.ceil((b.w / 2) * cv.view.s * cv.dpr), crop = trimCrop(b.trim);
    for (const to of [sp + 1, sp - 1]) {
      if (to < 0 || to > m.last) continue;
      for (const p of m.pagesOf(to)) if (p >= 1 && p <= b.n) cv.assets.pdfPage(b.ref, p, px, false, crop, true);
    }
  }

  goPage(id, page) {
    const b = this.byId(id); if (!b) return;
    this.turn(id, bookModel(b.n).spreadOf(clamp(page, 1, b.n)));
  }
  step(id, d) {
    const b = this.byId(id); if (!b) return;
    const m = bookModel(b.n), base = this.want && this.want.id === id ? this.want.sp : clampSp(b);
    this.turn(id, clamp(base + d, 0, m.last));
  }

  /* ---------------- bitmaps for the leaf: the page with its own writing on it ---------------- */
  async pageBitmap(b, n, pxW) {
    const cv = this.cv, m = bookModel(b.n), pw = b.w / 2, ph = b.h, k = pxW / pw;
    const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(pxW)); c.height = Math.max(1, Math.round(ph * k));
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    if (n > b.n) drawPage(ctx, n === m.BK ? 'back' : 'blank', 0, 0, c.width, c.height, false, b.cc || COVER_COLORS[0], false);
    else {
      ctx.fillStyle = '#fbfaf6'; ctx.fillRect(0, 0, c.width, c.height);
      const bm = await cv.assets.pdfPageAsync(b.ref, n, c.width, false, trimCrop(b.trim));
      if (bm) ctx.drawImage(bm.src, 0, 0, c.width, c.height);
    }
    const ink = cv.page.strokes.filter((s) => s.bk === b.id && s.pg === n);
    if (ink.length) {
      ctx.save(); ctx.setTransform(k, 0, 0, k, -pageX(b, n) * k, -b.y * k);
      for (const s of ink) drawStroke(ctx, s, { dark: false, assets: cv.assets, scale: k, dpr: 1 });
      ctx.restore();
    }
    return c;
  }

  /* ---------------- the book as a 3D scene: the same book, with your writing on its pages, seen from different places ---------------- */
  viewScene(id) {
    const b = this.byId(id); if (!b || this.dead) return;
    this.closePanel();
    const cv = this.cv, m = bookModel(b.n), KEY = 'ahos.book.view';
    let view = 'classic';
    try { view = validView(localStorage.getItem(KEY) || 'desk'); } catch { view = 'desk'; }
    const host = h('div', { class: 'bk-sc-host' });
    const pill = h('span', { class: 'bk-sc-pill' }, `${m.pageOf(clampSp(b))} / ${b.n}`);
    let book = null, layer = null;
    const bar = h('div', { class: 'bk-sc-bar', dir: 'ltr' },
      h('button', { type: 'button', class: 'vbtn', 'aria-label': t('close'), html: ic('close'), onClick: () => layer.close() }), pill,
      h('button', { type: 'button', class: 'vbtn', 'aria-label': t('bv_title'), title: t('bv_title'), html: ic('bookView'), onClick: () => viewSheet({ current: view, onPick: (v) => { view = v; book?.setView(v); try { localStorage.setItem(KEY, v); } catch { /* storage blocked */ } } }) }));
    const el = h('div', { class: 'bk-scene' }, host, bar);
    document.body.append(el);
    book = createFlipBook({
      host, N: b.n, ratio: (b.w / 2) / b.h, page: m.pageOf(clampSp(b)), rtl: !!b.rtl, cover: true, backCover: true, mode: 'spread', view,
      coverColor: b.cc || COVER_COLORS[0], getBitmap: (n, w) => this.pageBitmap(b, n, w),
      onPage: (n) => { pill.textContent = `${n} / ${b.n}`; },
    });
    el.__book = book;
    requestAnimationFrame(() => el.classList.add('in'));
    layer = pushLayer(() => {                                       // the book on the board is left open at the page you stopped at
      const sp = book ? book.spread : null;
      el.classList.remove('in');
      try { book?.destroy(); } catch { /* already gone */ }
      setTimeout(() => el.remove(), 260);
      const cur = this.byId(id);
      if (cur && sp !== null && sp !== clampSp(cur)) cv.updateBook(id, { sp });
    });
  }

  /* ---------------- turning pages ---------------- */
  /** Goes to spread `to` with a turning page (one page turns once; a jump turns many pages quickly). */
  async turn(id, to) {
    if (this.dead) return false;
    if (this.fly) { this.want = { id, sp: to }; return false; }
    const cv = this.cv, b = this.byId(id);
    if (!b) return false;
    const m = bookModel(b.n), from = clampSp(b);
    to = clamp(to, 0, m.last);
    if (to === from) return false;
    const dir = to > from ? 1 : -1, cnt = Math.abs(to - from);
    const [l0, r0] = m.pagesOf(from), [lt, rt] = m.pagesOf(to);
    const { s: zs, x: vx, y: vy } = cv.view, pw = b.w / 2, ph = b.h;
    const pxW = Math.round(clamp(pw * zs * Math.min(cv.dpr, 2.5), 200, 1200));      // the leaf is as sharp as the page it turns
    const mode = this.jumpMode();
    const L = cnt === 1 || mode === 'flip' ? 1 : Math.min(cnt, 4);               // leaves in the air: never more than four, whatever the distance
    this.fly = { id };
    // the page that stays keeps its place, the one that is revealed shows already; the turning page is the leaf
    cv.bookOver.set(id, dir > 0 ? [l0, rt] : [lt, r0]); cv.bookRevise();
    // the pictures of the two sides of the leaf: what is ready is used at once, a page still being drawn is waited for only a moment
    const soon = (n) => Promise.race([this.pageBitmap(b, n, pxW), new Promise((r) => setTimeout(() => r(null), 260))]).catch(() => null);
    const [fb, bb] = await Promise.all([soon(dir > 0 ? r0 : l0), soon(dir > 0 ? lt : rt)]);
    if (this.dead) return false;

    const W = pw * zs, Hh = ph * zs;
    const box = h('div', { class: 'bk-fly', style: { left: vx + b.x * zs + 'px', top: vy + b.y * zs + 'px', width: b.w * zs + 'px', height: Hh + 'px', perspective: Math.round(Math.max(900, W * 7)) + 'px', transform: b.rtl ? 'scaleX(-1)' : 'none' } });
    this.root.append(box);
    const live = [];
    const mk = (first, last) => {
      const leaf = createLeaf({ pw: W, ph: Hh, front: first ? fb : null, back: last ? bb : null, dir, mirror: !!b.rtl, cheap: !first && !last });
      const hinge = h('div', { class: 'fb-hinge', style: { left: W + 'px', height: Hh + 'px' } }, leaf.shadow, leaf.el);
      box.append(hinge); leaf.set(0);
      return { leaf, hinge };
    };
    const dur = L === 1 ? (cnt === 1 ? 460 : 520) : 330, stagger = 80;
    await new Promise((res) => {
      let t0 = 0, made = 0;
      const frame = (now) => {
        if (this.dead) { res(); return; }
        if (!t0) t0 = now;
        const el = now - t0;
        while (made < L && el >= made * stagger) { const o = mk(made === 0, made === L - 1); o.start = made * stagger; live.push(o); made++; }
        for (let i = live.length - 1; i >= 0; i--) {
          const o = live[i], u = Math.min(1, (el - o.start) / dur);
          o.leaf.set(ease(u));
          if (u >= 1) { o.leaf.destroy(); o.hinge.remove(); live.splice(i, 1); }
        }
        if (made < L || live.length) requestAnimationFrame(frame); else res();
      };
      requestAnimationFrame(frame);
    });
    box.remove();
    if (this.dead) return false;
    // the book now really is at the new place (a quiet change: turning a page is not something to undo)
    const cur = this.byId(id);
    cv.bookOver.delete(id);
    if (cur) this.setSp(cur, to);
    this.fly = null;
    cv.bookRevise();
    const w = this.want; this.want = null;
    if (w && w.id === id && w.sp !== to) return this.turn(id, w.sp);
    return true;
  }

  /** changes which page a book shows without making an undo step */
  setSp(b, sp) {
    const cv = this.cv, i = cv.doc.cur, nb = { ...b, sp };
    cv.doc.quiet((pages) => setStrokes(pages, i, pages[i].strokes.map((s) => (s === b ? nb : s))));
    if (cv.sel.has(b)) { cv.sel = new Set([...cv.sel].map((s) => (s === b ? nb : s))); cv.emit('selection'); }
    return nb;
  }

  /* ---------------- the settings panel (long press on a book) ---------------- */
  closePanel() { if (this.panel) { this.panel.el.remove(); this.panel = null; this.cv.emit('bookPanel', { open: false }); } }
  openPanel(id) {
    this.closePanel();
    const b = this.byId(id); if (!b) return;
    const cv = this.cv;
    const base = { w: b.w, h: b.h };            // the size at the moment the panel opened = 100%
    let orig = null;                            // pages before a slider drag started (the whole drag is one undo step)
    const live = (patch) => { if (!orig) orig = cv.doc.pages; cv.updateBook(id, patch, true); };
    const done = () => { if (orig) { cv.doc.commitFrom(orig); orig = null; cv.emit('history'); } };
    const cur = () => this.byId(id) || b;

    const seg = (opts, val, on) => h('div', { class: 'bk-seg' }, opts.map(([v, label]) => h('button', { type: 'button', class: val === v ? 'on' : '', onClick: () => { on(v); this.sync(true); this.openPanel(id); } }, label)));
    const slider = (label, min, max, step, val, fmt, onInput) => {
      const out = h('b', { class: 'bk-val' }, fmt(val));
      const inp = h('input', { type: 'range', min, max, step, value: val, class: 'bk-rng' });
      inp.addEventListener('input', () => { const v = parseFloat(inp.value); out.textContent = fmt(v); onInput(v); });
      inp.addEventListener('change', done); inp.addEventListener('pointerup', done);
      return h('label', { class: 'bk-row' }, h('span', null, label), inp, out);
    };
    const sizeNow = () => Math.round((cur().w / base.w) * 100);
    const trim = () => cur().trim || [0, 0, 0, 0];
    const setTrim = (i, v) => { const tr = trim().slice(); tr[i] = v / 100; live({ trim: tr, ...this.trimGeometry(cur(), tr) }); };

    const size = slider(t('bk_size'), 30, 300, 1, sizeNow(), (v) => v + '%', (v) => {
      const c = cur(), k = (base.w * v) / 100 / c.w;
      const cx = c.x + c.w / 2, cy = c.y + c.h / 2, w = c.w * k, hh = c.h * k;
      live({ w, h: hh, x: cx - w / 2, y: cy - hh / 2 });
    });
    const tr = trim();
    const trimBox = h('div', { class: 'bk-trim' },
      slider(t('bk_trimL'), 0, 30, 0.5, tr[0] * 100, (v) => v + '%', (v) => setTrim(0, v)),
      slider(t('bk_trimR'), 0, 30, 0.5, tr[2] * 100, (v) => v + '%', (v) => setTrim(2, v)),
      slider(t('bk_trimT'), 0, 30, 0.5, tr[1] * 100, (v) => v + '%', (v) => setTrim(1, v)),
      slider(t('bk_trimB'), 0, 30, 0.5, tr[3] * 100, (v) => v + '%', (v) => setTrim(3, v)));
    const sw = h('div', { class: 'bk-sw' }, COVER_COLORS.map((c) => h('button', { type: 'button', class: (cur().cc || COVER_COLORS[0]) === c ? 'on' : '', style: { background: c }, 'aria-label': c, onClick: () => { cv.updateBook(id, { cc: c }); this.openPanel(id); } })));

    const ib = (icon, label, fn, cls = '') => h('button', { type: 'button', class: 'bk-ib ' + cls, title: label, 'aria-label': label, html: ic(icon), onClick: fn });
    let open = !!this.trimOpen;
    const tgl = h('button', { type: 'button', class: 'bk-chip bk-tg' + (open ? ' on' : ''), 'aria-label': t('bk_trim'), html: ic('chevDown'), onClick: () => { open = !open; this.trimOpen = open; trimBox.hidden = !open; tgl.classList.toggle('on', open); this.placePanel(); } });
    trimBox.hidden = !open;
    const el = h('div', { class: 'bk-panel bd-ui' },
      h('div', { class: 'bk-ph' }, h('b', null, t('bk_settings')),
        h('span', { class: 'bk-ibs' },
          ib('bookOpen', t('bk_front'), () => this.turn(id, 0)),
          ib('bookOpen', t('bk_back'), () => this.turn(id, bookModel(cur().n).last), 'flip'),
          ib('bdCopy', t('bk_dup'), () => this.duplicate(id)),
          ib('trash', t('delete'), () => { this.closePanel(); cv.removeBook(id); }, 'danger'),
          ib('close', t('close'), () => this.closePanel()))),
      h('div', { class: 'bk-two' },
        seg([['3d', '3D'], ['2d', '2D']], cur().st === '2d' ? '2d' : '3d', (v) => cv.updateBook(id, { st: v })),
        seg([[false, 'LTR'], [true, 'RTL']], !!cur().rtl, (v) => cv.updateBook(id, { rtl: v }))),
      h('button', { type: 'button', class: 'bk-view', onClick: () => this.viewScene(id) }, h('span', { html: ic('bookView') }), t('bk_view')),
      h('div', { class: 'bk-jump' }, h('span', null, t('bk_jump')), seg([['fan', t('bk_jFan')], ['flip', t('bk_jFlip')]], this.jumpMode(), (v) => this.setJumpMode(v))),
      size,
      h('div', { class: 'bk-trimh' },
        h('span', null, t('bk_trim')),
        h('span', { class: 'bk-trimb' },
          h('button', { type: 'button', class: 'bk-chip', onClick: async () => { await this.autoTrim(id); this.openPanel(id); } }, t('bk_auto')),
          h('button', { type: 'button', class: 'bk-chip', onClick: () => { cv.updateBook(id, { trim: [0, 0, 0, 0], ...this.trimGeometry(cur(), [0, 0, 0, 0]) }); this.openPanel(id); } }, t('bk_reset')),
          tgl)),
      trimBox, sw);
    this.root.append(el);
    this.panel = { el, id };
    cv.emit('bookPanel', { open: true, id });
    this.placePanel();
  }
  placePanel() {
    const p = this.panel; if (!p) return;
    const b = this.byId(p.id);
    if (!b) { this.closePanel(); return; }
    const cv = this.cv, box = this.screenBox(bbox(b)), W = cv.W, H = cv.H, ins = cv.insets;
    const pw = p.el.offsetWidth || 300, ph = p.el.offsetHeight || 300;
    const left = clamp((box[0] + box[2]) / 2 - pw / 2, 6, Math.max(6, W - pw - 6));
    const lim = H - ins.bottom - 6;
    let top = box[1] - ph - 10;                                   // above the book
    if (top < ins.top + 4) {
      top = box[3] + 10;                                          // no room above: below it
      if (top + ph > lim) top = Math.max(ins.top + 4, lim - ph);  // no room there either: over the lower part of the book
    }
    p.el.style.transform = `translate3d(${left.toFixed(1)}px,${top.toFixed(1)}px,0)`;
  }

  /** the new size of a book whose pages are trimmed: the width stays, the height follows the shape of the trimmed page */
  trimGeometry(b, tr) {
    const pr = b.pr || (b.w / 2) / b.h;                         // shape of the untrimmed page (width / height)
    const ratio = pr * (1 - tr[0] - tr[2]) / Math.max(0.05, 1 - tr[1] - tr[3]);
    const h2 = b.w / 2 / ratio, cy = b.y + b.h / 2;
    return { h: h2, y: cy - h2 / 2, pr };
  }

  /** finds the empty margins of the pages and trims them (the same for every page, so nothing is cut off anywhere) */
  async autoTrim(id) {
    const cv = this.cv, b = this.byId(id); if (!b) return;
    const picks = new Set([1, b.n]);
    for (let i = 1; i <= 8; i++) picks.add(Math.max(1, Math.min(b.n, Math.round((b.n * i) / 9))));
    let m = null;
    for (const n of picks) {
      const bm = await cv.assets.pdfPageAsync(b.ref, n, 220, false, null);
      if (!bm) continue;
      const c = document.createElement('canvas'); c.width = bm.w; c.height = bm.h;
      const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(bm.src, 0, 0);
      const d = x.getImageData(0, 0, c.width, c.height).data;
      let l = c.width, r = -1, tp = c.height, bt = -1;
      for (let yy = 0; yy < c.height; yy++) for (let xx = 0; xx < c.width; xx++) {
        const o = (yy * c.width + xx) * 4;
        if (d[o + 3] > 40 && (d[o] < 235 || d[o + 1] < 235 || d[o + 2] < 235)) { if (xx < l) l = xx; if (xx > r) r = xx; if (yy < tp) tp = yy; if (yy > bt) bt = yy; }
      }
      if (r < 0) continue;                                         // a blank page tells nothing
      const q = [l / c.width, tp / c.height, 1 - (r + 1) / c.width, 1 - (bt + 1) / c.height];
      m = m ? m.map((v, i) => Math.min(v, q[i])) : q;
    }
    if (!m) return;
    const pad = 0.012, tr = m.map((v) => Math.max(0, Math.min(0.3, v - pad)));
    cv.updateBook(id, { trim: tr, ...this.trimGeometry(this.byId(id), tr) });
  }

  duplicate(id) {
    const cv = this.cv, b = this.byId(id); if (!b) return;
    const { sp, ...rest } = b; void sp;
    const copy = { ...rest, id: cv.uid(), sp: clampSp(b), x: b.x + b.w * 0.12, y: b.y + b.h * 0.1 };
    this.closePanel();
    cv.addStrokes([copy], cv.newGroup(), { select: true });
  }
}
