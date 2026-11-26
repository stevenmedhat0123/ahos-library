// Bookmarks with optional notes (video/audio time, PDF page, EPUB position). Stored on the item.
import { h, fmtDur } from './util.js';
import { ic } from './icons.js';
import { t } from './i18n.js';
import { state, addMark, removeMark } from './store.js';
import { openSheet, promptDialog, toast } from './ui.js';

export function markLabel(item, m) {
  if (item.kind === 'video' || item.kind === 'audio') return fmtDur(m.pos);
  if (item.ext === 'pdf') return t('pageN', { n: m.pos });
  const c = m.pos && typeof m.pos === 'object' ? m.pos.c : 0;
  return `${t('chapterShort', { n: (c || 0) + 1 })} · ${Math.round((m.pct || 0) * 100)}%`;
}

const sortKey = (m) => (typeof m.pos === 'number' ? m.pos : (m.pct || 0));

/** Adds a bookmark, optionally asking for a note first. Returns the mark or null if cancelled. */
export async function addBookmark(item, pos, extra = {}, { ask = true } = {}) {
  let note = '';
  if (ask) {
    note = await promptDialog({ title: t('addBookmark'), message: t('bookmarkNoteHint'), placeholder: t('noteOptional'), ok: t('save'), allowEmpty: true, maxlength: 200 });
    if (note === null) return null;
  }
  const m = addMark(item.id, { pos, note, ...extra });
  toast(t('bookmarkAdded'));
  return m;
}

/** Lists the bookmarks of an item. `getHere()` -> {pos, extra} for the current spot; `onGo(mark)` jumps. */
export function marksSheet(item, { getHere, onGo }) {
  const s = openSheet({ title: t('bookmarks'), tall: true });
  const list = h('div', { class: 'marks' });
  const add = h('button', { class: 'btn primary', onClick: async () => {
    const here = getHere();
    if (here && (await addBookmark(item, here.pos, here.extra || {}))) draw();
  } }, h('span', { html: ic('plus') }), t('addBookmarkHere'));
  s.body.append(h('div', { class: 'marks-add' }, add), list);
  function draw() {
    const it = state.items.get(item.id);
    const marks = [...(it?.marks || [])].sort((a, b) => sortKey(a) - sortKey(b));
    if (!marks.length) { list.replaceChildren(h('div', { class: 'pick-empty' }, t('noBookmarks'))); return; }
    list.replaceChildren(...marks.map((m) =>
      h('div', { class: 'mark-row' },
        h('button', { class: 'mark-go', onClick: () => { s.close(); setTimeout(() => onGo(m), 120); } },
          h('span', { class: 'mark-ic', html: ic('bookmark') }),
          h('span', { class: 'mark-tx' }, h('b', null, markLabel(it, m)), m.note ? h('small', { dir: 'auto' }, m.note) : null)),
        h('button', { class: 'icon-btn sm', 'aria-label': t('delete'), onClick: () => { removeMark(item.id, m.id); draw(); }, html: ic('trash') }))));
  }
  draw();
  return s;
}
