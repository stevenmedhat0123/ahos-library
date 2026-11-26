// Text notes: a note you type (title + paragraphs, headings, checklists, bullets, dividers and drawings from the whiteboard).
// A text note is a library item of the Notes section like a handwriting note: it is kept in a ".board" file (so backups, trash, folders and
// sharing treat it the same) whose JSON has one blank page (older readers see an empty board) and a `text` part with the content.
import { addItem, updateItem, getBlob, replaceBlob, state } from '../store.js';
import { uid, canvasToBlob } from '../util.js';
import { t, lang } from '../i18n.js';
import { BOARD_MIME, dayKey, nextName } from '../board/io.js';
import { newPage } from '../board/doc.js';
import { A4 } from '../board/render.js';
import { NOTE_PAPER, shortDate } from '../board/note.js';

export const TYPES = ['p', 'h', 'todo', 'bullet', 'hr', 'board'];
const TEXTY = new Set(['p', 'h', 'todo', 'bullet']);
export const isTexty = (b) => !!b && TEXTY.has(b.t);
const MAX_BLOCKS = 4000, MAX_CHARS = 400000;

export const mkBlock = (type = 'p', s = '', extra = null) => ({ id: uid().slice(0, 8), t: type, s, ...(type === 'todo' ? { done: false } : {}), ...(extra || {}) });

/** "- text", "[ ] text", "# text" … → what the line is */
export function lineKind(line) {
  let m;
  if ((m = /^\s*(?:\[\s?\]|☐)\s+(.*)$/.exec(line))) return { t: 'todo', s: m[1], done: false };
  if ((m = /^\s*(?:\[[xX]\]|☑|✓)\s+(.*)$/.exec(line))) return { t: 'todo', s: m[1], done: true };
  if ((m = /^\s*(?:[-*•–])\s+(.*)$/.exec(line))) return { t: 'bullet', s: m[1] };
  if ((m = /^#{1,3}\s+(.*)$/.exec(line))) return { t: 'h', s: m[1] };
  return { t: 'p', s: line };
}
/** the characters a typed marker leaves at the start of a line ("- ", "[] ", "# ") */
export const MARKER = /^\s*(?:\[\s?\]|\[[xX]\]|[-*•–]|#{1,3})\s/;

/** a text file's content as note blocks (lists and headings recognised, runs of empty lines kept as one) */
export function textToBlocks(text) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').replace(/\t/g, '    ').replace(/\u0000/g, '').split('\n');
  const out = [];
  let blank = 0;
  for (const raw of lines) {
    if (!raw.trim()) { blank++; if (blank === 1 && out.length) out.push(mkBlock('p', '')); continue; }
    blank = 0;
    const k = lineKind(raw.replace(/\s+$/, ''));
    out.push(mkBlock(k.t, k.t === 'p' ? raw.replace(/\s+$/, '') : k.s, k.t === 'todo' ? { done: !!k.done } : null));
    if (out.length >= MAX_BLOCKS) break;
  }
  while (out.length && out[out.length - 1].t === 'p' && !out[out.length - 1].s) out.pop();
  return out.length ? out : [mkBlock('p', '')];
}

export const blankText = () => ({ title: '', blocks: [mkBlock('p', '')] });

/** accepts whatever was stored (or typed by a damaged file) and returns a clean {title, blocks} */
export function cleanText(x) {
  const title = typeof x?.title === 'string' ? x.title.slice(0, 300) : '';
  const out = [];
  let chars = 0;
  for (const b of Array.isArray(x?.blocks) ? x.blocks : []) {
    if (!b || !TYPES.includes(b.t) || out.length >= MAX_BLOCKS) continue;
    if (b.t === 'hr') { out.push({ id: String(b.id || uid().slice(0, 8)), t: 'hr', s: '' }); continue; }
    if (b.t === 'board') { if (typeof b.ref === 'string' && b.ref) out.push({ id: String(b.id || uid().slice(0, 8)), t: 'board', s: '', ref: b.ref }); continue; }
    const s = typeof b.s === 'string' ? b.s.slice(0, Math.max(0, MAX_CHARS - chars)) : '';
    chars += s.length;
    out.push({ id: String(b.id || uid().slice(0, 8)), t: b.t, s, ...(b.t === 'todo' ? { done: !!b.done } : {}) });
  }
  if (!out.length) out.push(mkBlock('p', ''));
  return { title, blocks: out };
}

/** the file's content: a board file with one empty page (so nothing that only knows boards breaks) and the text */
export function fileJson(tn) {
  const c = cleanText(tn);
  return JSON.stringify({ paper: NOTE_PAPER, pattern: 'notes', night: false, note: true, cur: 0, view: null, src: null, pages: [newPage(A4[0], A4[1], { strokes: [] })], text: { v: 1, ...c } });
}

export function parseText(raw) {
  let d;
  try { d = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return null; }
  if (!d || typeof d !== 'object' || !d.text || typeof d.text !== 'object') return null;
  return cleanText(d.text);
}
export const isTextNote = (it) => !!it && it.kind === 'book' && it.ext === 'board' && !!it.meta?.text;

export async function loadText(id) {
  const blob = await getBlob(id);
  if (!blob) throw new Error('missing');
  return parseText(await blob.text()) || blankText();
}

/* ---------- plain text out of a note ---------- */
export function plainText(tn, { title = true } = {}) {
  const lines = [];
  if (title && tn.title.trim()) lines.push(tn.title.trim(), '');
  let n = 0;
  for (const b of tn.blocks) {
    if (b.t === 'todo') lines.push((b.done ? '[x] ' : '[ ] ') + b.s);
    else if (b.t === 'bullet') lines.push('• ' + b.s);
    else if (b.t === 'hr') lines.push('—————');
    else if (b.t === 'board') { n++; lines.push(`(${t('tn_drawing')} ${n})`); }
    else lines.push(b.s);
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
export const charCount = (tn) => tn.blocks.reduce((a, b) => a + (b.s ? b.s.length : 0), 0) + tn.title.length;
export const isEmpty = (tn) => !tn.title.trim() && tn.blocks.every((b) => (b.t === 'p' || b.t === 'h' || b.t === 'todo' || b.t === 'bullet') && !b.s.trim());

/** a line for the list: the first words of the body */
export function snippetOf(tn, max = 140) {
  const parts = [];
  let len = 0;
  for (const b of tn.blocks) {
    if (!isTexty(b) || !b.s.trim()) continue;
    const s = b.s.replace(/\s+/g, ' ').trim();
    parts.push(s); len += s.length + 1;
    if (len >= max) break;
  }
  return parts.join(' ').slice(0, max);
}
export function todoCount(tn) {
  let done = 0, total = 0;
  for (const b of tn.blocks) if (b.t === 'todo' && b.s.trim()) { total++; if (b.done) done++; }
  return { done, total };
}
export const hasDrawings = (tn) => tn.blocks.some((b) => b.t === 'board');

const nameFor = (title) => {
  const s = String(title || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
  return s || `${t('note_name')} ${shortDate()}`;
};
const metaOf = (tn) => {
  const { done, total } = todoCount(tn);
  return { pages: 1, strokes: 0, note: true, text: true, title: tn.title.trim(), snippet: snippetOf(tn), chars: charCount(tn), todoDone: done, todoTotal: total, draw: hasDrawings(tn) ? 1 : 0 };
};

/* ---------- the little picture of a note (cards in other lists, search, trash) ---------- */
const RTL = /[֐-ࣿ]/;
export async function noteThumb(tn, { w = 360, h = 480 } = {}) {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const g = cv.getContext('2d');
  g.fillStyle = NOTE_PAPER; g.fillRect(0, 0, w, h);
  const pad = 26, maxW = w - pad * 2;
  const wrap = (str, font) => {
    g.font = font;
    const words = String(str).split(/\s+/).filter(Boolean), lines = [];
    let cur = '';
    for (const wd of words) {
      const test = cur ? cur + ' ' + wd : wd;
      if (g.measureText(test).width > maxW && cur) { lines.push(cur); cur = wd; } else cur = test;
    }
    if (cur) lines.push(cur);
    return lines;
  };
  let y = pad + 6;
  const put = (line, font, color, step) => {
    g.font = font; g.fillStyle = color;
    const rtl = RTL.test(line);
    g.direction = rtl ? 'rtl' : 'ltr'; g.textAlign = rtl ? 'right' : 'left';
    g.fillText(line, rtl ? w - pad : pad, y);
    y += step;
  };
  const sans = '"Inter","Noto Sans Arabic",system-ui,sans-serif';
  const title = tn.title.trim();
  if (title) for (const l of wrap(title, `800 30px ${sans}`).slice(0, 3)) put(l, `800 30px ${sans}`, '#1a1a1f', 38);
  if (title) y += 8;
  for (const b of tn.blocks) {
    if (y > h - pad) break;
    if (b.t === 'hr') { g.fillStyle = '#c9c4b0'; g.fillRect(pad, y - 10, maxW, 2); y += 16; continue; }
    if (b.t === 'board') { g.fillStyle = '#e8e2cc'; g.fillRect(pad, y - 14, maxW, 56); y += 64; continue; }
    if (!b.s.trim()) { y += 12; continue; }
    const mark = b.t === 'todo' ? (b.done ? '☑ ' : '☐ ') : b.t === 'bullet' ? '• ' : '';
    const font = b.t === 'h' ? `800 24px ${sans}` : `500 21px ${sans}`;
    for (const l of wrap(mark + b.s, font).slice(0, 3)) { if (y > h - pad) break; put(l, font, b.t === 'todo' && b.done ? '#8a8672' : '#2a2a31', b.t === 'h' ? 32 : 28); }
  }
  return canvasToBlob(cv, 'image/jpeg', 0.72);
}

/* ---------- create / save ---------- */
export async function createTextNote({ folderId = null, title = '', blocks = null } = {}) {
  const tn = cleanText({ title, blocks: blocks && blocks.length ? blocks : [mkBlock('p', '')] });
  const blob = new Blob([fileJson(tn)], { type: BOARD_MIME });
  const id = uid();
  const item = {
    id, name: nextName(nameFor(tn.title)), kind: 'book', ext: 'board', mime: BOARD_MIME, size: blob.size,
    folderId: folderId || null, tags: [], fav: false, added: Date.now(), opened: 0, progress: null, thumb: null,
    meta: { ...metaOf(tn), noteDay: dayKey() },
  };
  await addItem(item, blob);
  if (!isEmpty(tn)) { try { updateItem(id, { thumb: await noteThumb(tn) }, { card: true }); } catch { /* ignore */ } }
  return id;
}

/** Writes the note. The name follows the title (an empty title keeps a dated name); the little picture is renewed. */
export async function saveTextNote(id, tn, { thumb = true } = {}) {
  const it = state.items.get(id);
  if (!it) return false;
  const c = cleanText(tn);
  const blob = new Blob([fileJson(c)], { type: BOARD_MIME });
  await replaceBlob(id, blob);
  const patch = { size: blob.size, meta: { ...it.meta, ...metaOf(c), edited: Date.now() } };
  const wanted = c.title.trim();
  if (wanted && (it.meta?.title || '') !== wanted) patch.name = nextName(nameFor(wanted));
  else if (!wanted && it.meta?.title) patch.name = nextName(nameFor(''));
  if (thumb) { try { patch.thumb = isEmpty(c) ? null : await noteThumb(c); } catch { /* keep the old one */ } }
  updateItem(id, patch, { card: true });
  return true;
}

/** the time a text note was last changed is its "added" date for ordering: touching it is saving it, so we keep a separate stamp */
export const stampOf = (it) => it.meta?.edited || it.added || 0;
export function touchStamp(id) { const it = state.items.get(id); if (it) updateItem(id, { meta: { ...it.meta, edited: Date.now() } }, { silent: true }); }

export const dirOf = (s) => (RTL.test(s || '') ? 'rtl' : 'ltr');
export { lang };
