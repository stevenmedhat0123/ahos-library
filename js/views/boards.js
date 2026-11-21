// The Board and Daily-note sections: a big "new" button and your boards / notes as a grid.
import { h } from '../util.js';
import { ic } from '../icons.js';
import { t } from '../i18n.js';
import { visibleItems } from '../store.js';
import { isBoard, dayKey } from '../board/io.js';
import { itemCard, wireCards, emptyState, sectionHead } from './shared.js';

function grid(list, ctx) {
  const g = h('div', { class: 'grid' }, list.map((i) => itemCard(i, { mode: 'grid' })));
  wireCards(g, { open: (id) => ctx.openItem(id, list.map((i) => i.id)), more: (id) => ctx.itemMenu?.(id), selecting: () => false });
  return g;
}
const byRecent = (a, b) => (b.opened || b.added || 0) - (a.opened || a.added || 0);

export function renderBoards(ctx) {
  const boards = visibleItems().filter((i) => isBoard(i) && !i.meta?.note).sort(byRecent);
  const el = h('div', { class: 'sec-boards' },
    h('div', { class: 'sec-actions' },
      h('button', { class: 'btn primary', type: 'button', onClick: () => ctx.newBoard() }, h('span', { html: ic('plus') }), t('bd_new'))));
  if (!boards.length) el.append(emptyState({ icon: 'bdPen', title: t('hub_noBoards'), text: t('hub_noBoardsSub') }));
  else el.append(sectionHead(t('hub_yourBoards')), grid(boards, ctx));
  return el;
}

export function renderNotes(ctx) {
  const notes = visibleItems().filter((i) => isBoard(i) && i.meta?.note).sort((a, b) => (b.added || 0) - (a.added || 0));
  const today = notes.find((i) => i.meta.noteDay === dayKey());
  const el = h('div', { class: 'sec-boards' },
    h('div', { class: 'sec-actions' },
      h('button', { class: 'btn primary', type: 'button', onClick: () => ctx.openTodayNote() }, h('span', { html: ic('daily') }), today ? t('hub_openToday') : t('hub_startToday')),
      today ? h('button', { class: 'btn ghost', type: 'button', onClick: () => ctx.newNote() }, h('span', { html: ic('plus') }), t('hub_anotherNote')) : null));
  if (!notes.length) el.append(emptyState({ icon: 'daily', title: t('hub_noNotes'), text: t('hub_noNotesSub') }));
  else el.append(sectionHead(t('hub_recentNotes')), grid(notes, ctx));
  return el;
}
