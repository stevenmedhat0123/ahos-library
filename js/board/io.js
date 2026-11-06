// Saving, creating and exporting boards. A board is a library file (ext "board", shown with the books).
import { state, addItem, updateItem, getBlob, replaceBlob } from '../store.js';
import { uid, canvasToBlob, stripExt } from '../util.js';
import { t } from '../i18n.js';
import { Doc, parseDoc, blankData, pdfData } from './doc.js';
import { drawPaper, drawStroke, isDark } from './render.js';
import { unionBox, isObj } from './geom.js';
import { buildPdf } from './pdfout.js';
import { createAssets, refOf, resolveRef } from './assets.js';
import { exportBlob } from '../native.js';

export const BOARD_MIME = 'application/x-ahos-board';
export const isBoard = (it) => it && it.kind === 'book' && it.ext === 'board';

function nextName(base) {
  const names = new Set([...state.items.values()].map((i) => i.name));
  let n = 1, name = `${base}.board`;
  while (names.has(name)) { n++; name = `${base} ${n}.board`; }
  return name;
}

export async function createBoardItem(data, { title, folderId = null, src = null } = {}) {
  const doc = new Doc(data);
  const blob = new Blob([doc.toJSON()], { type: BOARD_MIME });
  const id = uid();
  const item = {
    id, name: nextName(title || t('boardName')), kind: 'book', ext: 'board', mime: BOARD_MIME, size: blob.size,
    folderId: folderId || null, tags: [], fav: false, added: Date.now(), opened: 0, progress: null, thumb: null,
    meta: { pages: doc.pages.length, strokes: 0, ...(src ? { src } : {}) },
  };
  await addItem(item, blob);
  try {
    const assets = createAssets(null);
    const cv = await renderPageCanvas(doc, 0, { width: 360, assets });
    assets.destroy();
    updateItem(id, { thumb: await canvasToBlob(cv, 'image/jpeg', 0.7) }, { card: true });
  } catch (e) { console.warn('board thumb', e); }
  return id;
}

export async function loadDoc(id) {
  const blob = await getBlob(id);
  if (!blob) throw new Error('missing');
  return new Doc(parseDoc(await blob.text()));
}

/** The board kept for a PDF (made the first time the person draws on it), if there is one. */
export function boardForPdf(pdf) {
  for (const it of state.items.values()) {
    if (!isBoard(it) || !it.meta?.src) continue;
    const r = resolveRef(it.meta.src);
    if (r && r.id === pdf.id) return it;
  }
  return null;
}

export async function openOrCreatePdfBoard(pdf) {
  const have = boardForPdf(pdf);
  if (have) return have.id;
  const assets = createAssets(null);
  let info;
  try { info = await assets.pdfInfo(refOf(pdf)); } finally { assets.destroy(); }
  const ref = refOf(pdf);
  return createBoardItem(pdfData(ref, info), { title: `${stripExt(pdf.meta?.title ? pdf.meta.title : pdf.name)} · ${t('notesSuffix')}`, folderId: pdf.folderId, src: ref });
}

/* ---------------- saving ---------------- */
export function makeSaver(id, doc, assets) {
  let timer = 0, savedRev = doc.rev, chain = Promise.resolve(), viewDirty = false;
  const run = (withThumb) => {
    chain = chain.then(async () => {
      const rev = doc.rev;
      if (rev === savedRev && !withThumb && !viewDirty) return;
      const blob = new Blob([doc.toJSON()], { type: BOARD_MIME });
      await replaceBlob(id, blob);
      savedRev = rev; viewDirty = false;
      const it = state.items.get(id);
      if (it) updateItem(id, { size: blob.size, meta: { ...it.meta, pages: doc.pages.length, strokes: doc.strokeCount() } }, { silent: true });
      if (withThumb) {
        try {
          const cv = await renderPageCanvas(doc, 0, { width: 360, assets });
          updateItem(id, { thumb: await canvasToBlob(cv, 'image/jpeg', 0.7) }, { card: true });
        } catch (e) { console.warn('board thumb', e); }
      }
    }).catch((e) => console.warn('board save failed', e));
    return chain;
  };
  return {
    schedule() { clearTimeout(timer); timer = setTimeout(() => run(false), 1500); },
    viewChanged() { viewDirty = true; },
    flush(withThumb = false) { clearTimeout(timer); return run(withThumb); },
  };
}

/* ---------------- rendering a page to a canvas (thumbnails, PNG, PDF) ---------------- */
async function warm(page, assets, scale) {
  const jobs = [];
  for (const s of page.strokes) {
    if (s.t === 'img') jobs.push(assets.imageAsync(s.ref));
    else if (s.t === 'pdfp') jobs.push(assets.pdfPageAsync(s.ref, s.page, s.w * scale));
    else if (s.t === 'media') { assets.thumb(s.ref); }
  }
  if (jobs.length) await Promise.all(jobs);
  if (page.strokes.some((s) => s.t === 'media')) await new Promise((r) => setTimeout(r, 120));
}

/** Content box of an endless page, with some air around it. */
export function contentBox(page) {
  if (!page.strokes.length) return [0, 0, 800, 600];
  const b = unionBox(page.strokes);
  const m = 40;
  let [x1, y1, x2, y2] = [b[0] - m, b[1] - m, b[2] + m, b[3] + m];
  if (x2 - x1 < 400) { const c = (x1 + x2) / 2; x1 = c - 200; x2 = c + 200; }
  if (y2 - y1 < 300) { const c = (y1 + y2) / 2; y1 = c - 150; y2 = c + 150; }
  return [x1, y1, x2, y2];
}

export async function renderPageCanvas(doc, idx, { width = 1400, assets, maxPx = 4096 } = {}) {
  const page = doc.pages[idx];
  const paper = doc.paperOf(page), pattern = doc.patternOf(page);
  let ox = 0, oy = 0, ww = page.w, hh = page.h;
  if (!page.w) { const b = contentBox(page); ox = b[0]; oy = b[1]; ww = b[2] - b[0]; hh = b[3] - b[1]; }
  const k = Math.min(width / ww, maxPx / hh);
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.round(ww * k)); cv.height = Math.max(1, Math.round(hh * k));
  const ctx = cv.getContext('2d');
  ctx.setTransform(k, 0, 0, k, -ox * k, -oy * k);
  const vp = { x: -ox * k, y: -oy * k, s: k, W: cv.width, H: cv.height };
  drawPaper(ctx, page.w ? page : { w: 0, h: 0 }, paper, pattern, vp);
  await warm(page, assets, k);
  if (page.bg) {
    const b = await assets.pdfPageAsync(page.bg.ref, page.bg.page, page.w * k, doc.night);
    if (b) ctx.drawImage(b.src, 0, 0, page.w, page.h);
  }
  const env = { dark: isDark(paper) && !(page.bg && !doc.night), assets, scale: k, dpr: 1 };
  for (const s of page.strokes) if (isObj(s)) drawStroke(ctx, s, env);
  for (const s of page.strokes) if (!isObj(s)) drawStroke(ctx, s, env);
  return cv;
}

export async function exportPng(doc, idx, assets) {
  const cv = await renderPageCanvas(doc, idx, { width: 1800, assets });
  return new Promise((res) => cv.toBlob(res, 'image/png'));
}

export async function exportPdf(doc, indices, assets, onProgress) {
  const pages = [];
  for (let n = 0; n < indices.length; n++) {
    onProgress?.(n / indices.length);
    const idx = indices[n];
    const page = doc.pages[idx];
    const cv = await renderPageCanvas(doc, idx, { width: 1400, assets, maxPx: 3000 });
    const blob = await canvasToBlob(cv, 'image/jpeg', 0.86);
    const jpeg = new Uint8Array(await blob.arrayBuffer());
    let w = page.w, h = page.h;
    if (!w) { const b = contentBox(page); w = b[2] - b[0]; h = b[3] - b[1]; }
    pages.push({ w, h, pw: cv.width, ph: cv.height, jpeg });
    cv.width = cv.height = 1;
    await new Promise((r) => setTimeout(r, 0));
  }
  onProgress?.(1);
  return buildPdf(pages);
}

/** Thumbnail + facts for a board file that has none yet (restored from a backup, say). */
export async function boardThumb(file) {
  const doc = new Doc(parseDoc(await file.text()));
  const assets = createAssets(null);
  try {
    const cv = await renderPageCanvas(doc, 0, { width: 360, assets });
    return { thumb: await canvasToBlob(cv, 'image/jpeg', 0.7), meta: { pages: doc.pages.length, strokes: doc.strokeCount() } };
  } finally { assets.destroy(); }
}

/** Shares a whole board as one PDF. */
export async function exportBoardPdf(id, onProgress) {
  const it = state.items.get(id);
  const doc = await loadDoc(id);
  const assets = createAssets(null);
  try {
    const blob = await exportPdf(doc, doc.pages.map((_, i) => i), assets, onProgress);
    await exportBlob(`${stripExt(it?.name || 'board')}.pdf`, blob);
  } finally { assets.destroy(); }
}
