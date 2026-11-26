// "Add files" in the Board and Notes sections – the same two ways as in the media sections (pick some files, or take them all from a folder),
// except that here each file becomes something of the section:
//   Boards: a PDF → a board over that PDF (the one you get when you draw on a PDF) · a picture → a board page with the picture · a .board file → the board it was
//   Notes:  a text file (.txt / .md) → a note, as many ruled pages as it needs · a .board file → the note it was
// PDFs and pictures also stay where they belong (PDFs & files, Photos): the board only points at them.
import { t } from './i18n.js';
import { state } from './store.js';
import { extOf, kindOf, stripExt } from './util.js';
import { actionSheet, toast, progressCard } from './ui.js';
import { importFiles, pickFiles } from './import.js';
import { blankData, parseDoc, newPage } from './board/doc.js';
import { createBoardItem, openOrCreatePdfBoard } from './board/io.js';
import { createAssets, refOf } from './board/assets.js';
import { NOTE_PAPER, notePage } from './board/note.js';
import { layoutText, refitText, inkFor, NOTE_PAD, NOTE_LINE0, NOTE_PITCH, A4 } from './board/render.js';
import { createTextNote, parseText, textToBlocks, plainText } from './notes/model.js';

const TEXT_EXT = new Set(['txt', 'md', 'markdown', 'text']);
const MAX_TEXT = 600 * 1024, MAX_PAGES = 120;
export const BOARD_ACCEPT = '.board,.pdf,application/pdf,image/*';
export const NOTE_ACCEPT = '.board,.txt,.md,.markdown,text/plain,text/markdown';

const isBoardFile = (f) => extOf(f.name) === 'board';
const isPdf = (f) => extOf(f.name) === 'pdf' || f.type === 'application/pdf';
const isPicture = (f) => kindOf(f) === 'image';
const isText = (f) => TEXT_EXT.has(extOf(f.name)) || /^text\/(plain|markdown)$/.test(f.type || '');
/** what each section can use */
export const canMakeBoard = (f) => isBoardFile(f) || isPdf(f) || isPicture(f);
export const canMakeNote = (f) => isBoardFile(f) || isText(f);

let scratch = null;
const ctx2d = () => (scratch ||= document.createElement('canvas').getContext('2d'));

/** The text of a file as the ruled pages of a note: every visual line sits on a ruled line, a page ends where the page does. */
export function notePagesFromText(text, paper = NOTE_PAPER) {
  const [W, H] = A4, size = 30 / 1.32, bw = W - NOTE_PAD * 2;
  const y0 = NOTE_LINE0 - 30 + 1, cap = Math.max(1, Math.floor((H - 26 - y0) / NOTE_PITCH));
  const clean = String(text || '').replace(/\r\n?/g, '\n').replace(/\t/g, '    ').replace(/\u0000/g, '');
  // wrap once, then cut the wrapped lines into pages (each line is already narrow enough, so the page's own wrapping leaves it alone)
  const probe = { t: 'text', c: inkFor(paper), x: NOTE_PAD, y: y0, s: clean, size, bw, bh: 0 };
  const lines = layoutText(ctx2d(), probe).lines.map((l) => l.t);
  while (lines.length && !lines[lines.length - 1]) lines.pop();
  const pages = [];
  for (let i = 0; i < lines.length && pages.length < MAX_PAGES; i += cap) {
    const pg = pages.length ? newPage(W, H, { strokes: [] }) : notePage(W, H, paper);
    const chunk = lines.slice(i, i + cap).join('\n');
    pg.strokes = [...pg.strokes, refitText(ctx2d(), { ...probe, s: chunk })];
    pages.push(pg);
  }
  const clipped = lines.length > cap * MAX_PAGES;
  if (!pages.length) pages.push(notePage(W, H, paper));
  return { pages, clipped };
}

/** a picture as a one-page board: the page has the picture's shape, the picture fills it */
async function pictureBoard(item, folderId) {
  const assets = createAssets(null);
  let b;
  try { b = await assets.imageAsync(refOf(item)); } finally { assets.destroy(); }
  if (!b || !(b.w > 0) || !(b.h > 0)) throw new Error('picture');
  const long = A4[1], k = long / Math.max(b.w, b.h);
  const W = Math.max(120, Math.round(b.w * k)), Hh = Math.max(120, Math.round(b.h * k));
  const data = blankData({ size: [W, Hh] });
  data.pages[0].strokes = [{ t: 'img', ref: refOf(item), x: 0, y: 0, w: W, h: Hh }];
  return createBoardItem(data, { title: stripExt(item.name), folderId });
}

/** Turns the files into boards (notes = false) or notes (notes = true). Returns the ids of what was made. */
export async function addToBoards(files, { notes = false, folderId = null } = {}) {
  const ok = notes ? canMakeNote : canMakeBoard;
  const use = files.filter((f) => f && ok(f)), skipped = files.length - use.length;
  if (!use.length) { toast(t(notes ? 'bda_noneNote' : 'bda_noneBoard')); return []; }
  const card = progressCard(t('importing'));
  const made = []; let failed = 0, clipped = 0;
  for (let i = 0; i < use.length; i++) {
    const f = use[i];
    card.update(`${i + 1} / ${use.length}  ·  ${f.name}`, i / use.length);
    try {
      const real = typeof f.__load === 'function' ? await f.__load() : f;
      if (isBoardFile(f)) {
        const raw = await real.text();
        const tx = parseText(raw);
        // a text note file comes back as a text note; a board / handwriting note file as what it was
        if (tx) made.push(await createTextNote({ folderId, title: tx.title, blocks: tx.blocks }));
        else made.push(await createBoardItem(parseDoc(raw), { title: stripExt(f.name), folderId }));
      } else if (isPdf(f)) {
        const r = await importFiles([real.name === f.name ? real : new File([real], f.name, { type: 'application/pdf' })], folderId, { quiet: true });
        const it = state.items.get(r.ids[0]);
        if (!it) throw new Error('pdf');
        made.push(await openOrCreatePdfBoard(it));
      } else if (isPicture(f)) {
        const r = await importFiles([real.name === f.name ? real : new File([real], f.name, { type: real.type })], folderId, { quiet: true });
        const it = state.items.get(r.ids[0]);
        if (!it) throw new Error('picture');
        made.push(await pictureBoard(it, folderId));
      } else {
        // a text file becomes a text note you can edit (what you type in it, the same way)
        const text = await real.text();
        if (text.length > MAX_TEXT) clipped++;
        made.push(await createTextNote({ folderId, title: stripExt(f.name), blocks: textToBlocks(text.slice(0, MAX_TEXT)) }));
      }
    } catch (e) { failed++; console.warn('could not add', f.name, e); }
  }
  card.update(t('done'), 1); setTimeout(() => card.done(), 450);
  const parts = [];
  if (made.length) parts.push(t(notes ? 'bda_madeNotes' : 'bda_madeBoards', { n: made.length }));
  if (skipped) parts.push(t('skippedN', { n: skipped }));
  if (failed) parts.push(t('failedN', { n: failed }));
  if (clipped) parts.push(t('bda_clipped'));
  toast(parts.join(' · ') || t('nothingImported'), clipped ? { ms: 6000 } : undefined);
  return made;
}

/** The Add button of the Board / Notes sections. */
export function boardAddSheet({ notes = false, folderId = null, onDone } = {}) {
  const done = async (files) => { const ids = await addToBoards(files, { notes, folderId }); if (ids.length) onDone?.(ids); };
  actionSheet(t(notes ? 'bda_titleNote' : 'bda_titleBoard'), [
    { icon: 'upload', label: t('ks_pickSome'), hint: t(notes ? 'bda_pickHintNote' : 'bda_pickHintBoard'),
      onClick: async () => { const files = await pickFiles({ accept: notes ? NOTE_ACCEPT : BOARD_ACCEPT }); if (files.length) await done(files); } },
    { icon: 'folder', label: t(notes ? 'bda_allNote' : 'bda_allBoard'), hint: t('ks_addAllHint'),
      onClick: async () => { const m = await import('./folderadd.js'); await m.addWholeFolder({ folderId, accept: notes ? canMakeNote : canMakeBoard, handler: done }); } },
  ]);
}


/** A text note as a handwriting note: its words on ruled pages (the note stays as it is). */
export async function noteFromText(tn, { folderId = null } = {}) {
  const { pages } = notePagesFromText([tn.title && tn.title.trim(), plainText(tn, { title: false })].filter(Boolean).join('\n\n').slice(0, MAX_TEXT));
  return createBoardItem({ paper: NOTE_PAPER, pattern: 'notes', night: false, note: true, cur: 0, view: null, src: null, pages }, { title: (tn.title || '').trim() || t('note_name'), folderId });
}
