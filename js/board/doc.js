// The board document: pages of strokes with undo / redo. Every edit makes new arrays (strokes are never changed in place),
// so a history entry is just a reference to the earlier pages array: cheap in memory and instant to restore.
import { uid } from '../util.js';
import { A4 } from './render.js';

export const newPage = (w, h, extra = {}) => ({ id: uid(), w: w || 0, h: h || 0, strokes: [], ...extra });

const TYPES = new Set(['pen', 'hl', 'line', 'arrow', 'rect', 'ellipse', 'tri', 'diamond', 'poly', 'text', 'img', 'pdfp', 'media']);
const num = (v, d = 0) => (Number.isFinite(v) ? v : d);

/** Takes whatever was saved and returns a safe document (unknown or broken strokes are dropped). */
export function parseDoc(raw) {
  const d = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!d || typeof d !== 'object' || !Array.isArray(d.pages)) throw new Error('not a board');
  const pages = d.pages.slice(0, 2000).map((p) => {
    const strokes = [];
    for (const s of Array.isArray(p.strokes) ? p.strokes : []) {
      if (!s || !TYPES.has(s.t)) continue;
      if ((s.t === 'pen' || s.t === 'hl' || s.t === 'poly') && !(Array.isArray(s.pts) && s.pts.length >= 2)) continue;
      if (['line', 'arrow', 'rect', 'ellipse', 'tri', 'diamond'].includes(s.t) && !(Array.isArray(s.a) && Array.isArray(s.b))) continue;
      if (s.t === 'text' && (typeof s.s !== 'string' || !num(s.bw))) continue;
      if ((s.t === 'img' || s.t === 'pdfp' || s.t === 'media') && !(s.ref && num(s.w) > 0 && num(s.h) > 0)) continue;
      strokes.push(s);
    }
    const out = { id: p.id || uid(), w: num(p.w), h: num(p.h), strokes };
    if (p.bg && p.bg.ref) out.bg = { ref: p.bg.ref, page: num(p.bg.page, 1) };
    if (typeof p.paper === 'string') out.paper = p.paper;
    if (typeof p.pattern === 'string') out.pattern = p.pattern;
    return out;
  });
  if (!pages.length) pages.push(newPage(A4[0], A4[1]));
  return {
    paper: typeof d.paper === 'string' ? d.paper : '#ffffff',
    pattern: typeof d.pattern === 'string' ? d.pattern : 'none',
    night: !!d.night,
    cur: Math.max(0, Math.min(pages.length - 1, num(d.cur))),
    view: d.view && typeof d.view === 'object' ? d.view : null,
    src: d.src || null,
    pages,
  };
}

export class Doc {
  constructor(data) {
    this.paper = data.paper; this.pattern = data.pattern; this.night = !!data.night;
    this.pages = data.pages; this.cur = data.cur || 0; this.view = data.view || null; this.src = data.src || null;
    this.undoStack = []; this.redoStack = []; this.group = null;
    this.rev = 0; // grows with every change, so savers and thumbnails know when to refresh
    this.listeners = new Set();
  }

  get page() { return this.pages[this.cur]; }
  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  changed(kind = 'edit') { this.rev++; this.listeners.forEach((f) => { try { f(kind); } catch (e) { console.error(e); } }); }

  /**
   * Applies fn(pages) -> newPages as one undoable step. Edits sharing a `group` (one pen gesture, one eraser drag)
   * are merged into a single step.
   */
  edit(fn, group = null, cur = this.cur) {
    const next = fn(this.pages);
    if (next === this.pages && cur === this.cur) return false;
    if (!(group && group === this.group && this.undoStack.length)) {
      this.undoStack.push({ pages: this.pages, cur: this.cur });
      if (this.undoStack.length > 120) this.undoStack.shift();
    }
    this.group = group;
    this.redoStack.length = 0;
    this.pages = next; this.cur = Math.max(0, Math.min(next.length - 1, cur));
    this.changed('edit');
    return true;
  }
  /** Changes that shouldn't be undoable (a PDF page turned out to have another size). */
  quiet(fn) { const n = fn(this.pages); if (n !== this.pages) { this.pages = n; this.changed('quiet'); } }

  endGroup() { this.group = null; }
  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }
  undo() {
    const e = this.undoStack.pop();
    if (!e) return false;
    this.redoStack.push({ pages: this.pages, cur: this.cur });
    this.pages = e.pages; this.cur = Math.min(e.cur, e.pages.length - 1); this.group = null;
    this.changed('undo');
    return true;
  }
  redo() {
    const e = this.redoStack.pop();
    if (!e) return false;
    this.undoStack.push({ pages: this.pages, cur: this.cur });
    this.pages = e.pages; this.cur = Math.min(e.cur, e.pages.length - 1); this.group = null;
    this.changed('redo');
    return true;
  }

  paperOf(p = this.page) { return p.paper || this.paper; }
  patternOf(p = this.page) { return p.pattern || this.pattern; }

  toJSON() {
    return JSON.stringify({
      v: 1, paper: this.paper, pattern: this.pattern, night: this.night, cur: this.cur, view: this.view, src: this.src,
      pages: this.pages.map((p) => ({ id: p.id, w: p.w, h: p.h, bg: p.bg, paper: p.paper, pattern: p.pattern, strokes: p.strokes })),
    });
  }
  strokeCount() { let n = 0; for (const p of this.pages) n += p.strokes.length; return n; }
}

/* ---------------- page helpers (pure) ---------------- */
export const setStrokes = (pages, i, strokes) => pages.map((p, k) => (k === i ? { ...p, strokes } : p));
export const patchPage = (pages, i, patch) => pages.map((p, k) => (k === i ? { ...p, ...patch } : p));
export const insertPage = (pages, i, page) => [...pages.slice(0, i), page, ...pages.slice(i)];
export const removePage = (pages, i) => (pages.length > 1 ? pages.filter((_, k) => k !== i) : pages);
export const movePage = (pages, i, j) => { const a = pages.slice(); const [p] = a.splice(i, 1); a.splice(j, 0, p); return a; };
export const clonePage = (p) => ({ ...p, id: uid(), strokes: p.strokes.slice() });

export function blankData({ paper = '#ffffff', pattern = 'none', infinite = false, landscape = false } = {}) {
  const [w, h] = infinite ? [0, 0] : landscape ? [A4[1], A4[0]] : A4;
  return { paper, pattern, night: false, cur: 0, view: null, src: null, pages: [newPage(w, h)] };
}

/** A board that sits on top of a PDF: one page per PDF page, each showing that page underneath. */
export function pdfData(ref, info, { paper = '#ffffff' } = {}) {
  const pages = [];
  for (let n = 1; n <= info.n; n++) pages.push(newPage(info.w, info.h, { bg: { ref, page: n } }));
  return { paper, pattern: 'none', night: false, cur: 0, view: null, src: ref, pages };
}
