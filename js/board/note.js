// The daily note: a board with a notebook look. Every page starts with a place for the date (already filled in with today's date,
// as an ordinary text that can be changed or deleted) and ruled lines. Everything else works exactly like a board.
import { t, lang } from '../i18n.js';
import { A4, naturalWidth, refitText, inkFor, NOTE_PAD, NOTE_DATE_Y } from './render.js';
import { newPage } from './doc.js';
import { createBoardItem } from './io.js';

export const NOTE_PAPER = '#fffdf4';
const locale = () => (lang() === 'ar' ? 'ar-EG' : 'en-GB');
export const longDate = (d = new Date()) => d.toLocaleDateString(locale(), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
export const shortDate = (d = new Date()) => d.toLocaleDateString(locale(), { day: 'numeric', month: 'short', year: 'numeric' });

let scratch = null;
const ctx2d = () => (scratch ||= document.createElement('canvas').getContext('2d'));

/** today's date as a text on the page, sitting on the date line */
export function dateStroke(pageW, d = new Date(), paper = NOTE_PAPER) {
  const bw = Math.max(120, pageW - NOTE_PAD * 2);
  const base = { t: 'text', c: inkFor(paper), x: NOTE_PAD, y: NOTE_DATE_Y - 2, s: longDate(d), size: 22, bold: true, bw };
  void naturalWidth;
  return refitText(ctx2d(), { ...base, bh: 0 });
}

export const notePage = (w = A4[0], h = A4[1], paper = NOTE_PAPER) => newPage(w, h, { strokes: [dateStroke(w, new Date(), paper)] });

export function noteData(paper = NOTE_PAPER) {
  return { paper, pattern: 'notes', night: false, note: true, cur: 0, view: null, src: null, pages: [notePage(A4[0], A4[1], paper)] };
}

export async function createNote({ folderId = null, paper = NOTE_PAPER } = {}) {
  return createBoardItem(noteData(paper), { title: `${t('note_name')} ${shortDate()}`, folderId });
}
