// What the media pages share: the "Continue / Recently played / Favourites" strips, and the taps on their cards
// (open · "more" menu · long press = take it off this list or delete it).
import { t } from '../i18n.js';
import { h } from '../util.js';
import { state } from '../store.js';
import { itemCard, wireCards, sectionHead, progressFrac } from './shared.js';
import { itemActions, removeFromList, deleteItems } from '../actions.js';
import { actionSheet } from '../ui.js';
import { isBoard } from '../board/io.js';

const PLAYS = ['video', 'audio', 'book'];

/** The items to continue (started, not finished), the ones played last (not repeated under "Continue") and the favourites. */
export function mediaLists(items, { favs = true } = {}) {
  const cont = items.filter((i) => { const f = progressFrac(i); return f > 0 && f < 0.98 && PLAYS.includes(i.kind) && !((i.contHide || 0) >= ((i.progress && i.progress.at) || 0)); })
    .sort((a, b) => (b.opened || 0) - (a.opened || 0)).slice(0, 10);
  const contIds = new Set(cont.map((i) => i.id));
  const played = items.filter((i) => i.opened && PLAYS.includes(i.kind) && !isBoard(i) && !contIds.has(i.id) && (i.playHide || 0) < i.opened)
    .sort((a, b) => b.opened - a.opened).slice(0, 12);
  const fav = favs ? items.filter((i) => i.fav).slice(0, 12) : [];
  return { cont, played, fav };
}

/** Strip elements for the lists above (each strip carries data-sec so a long press knows which list it is on). */
export function stripNodes({ cont, played, fav }) {
  const strip = (key, title, list, mode) => (list.length ? [sectionHead(title), h('div', { class: 'strip', dataset: { sec: key } }, list.map((i) => itemCard(i, { mode })))] : []);
  return [...strip('cont', t('continue'), cont, 'wide'), ...strip('played', t('recentlyPlayed'), played, 'mini'), ...strip('fav', t('favorites'), fav, 'mini')];
}

/** Wires every card inside root; `ids` is the play queue the opened item belongs to. */
export function wireMedia(root, ctx, ids) {
  wireCards(root, {
    open: (id) => ctx.openItem(id, ids),
    more: (id, card) => itemActions(id, { onOpen: () => ctx.openItem(id, [id]), sec: card?.closest('[data-sec]')?.dataset.sec }),
    longPress: (id, card) => {
      const it = state.items.get(id);
      if (!it) return;
      const sec = card?.closest('[data-sec]')?.dataset.sec;
      actionSheet(it.name.replace(/\.board$/i, ''), [
        sec === 'recent' || sec === 'cont' || sec === 'fav' || sec === 'played'
          ? { icon: 'close', label: sec === 'fav' ? t('removeFav') : t('removeFromList'), hint: sec === 'recent' ? t('removeRecentHint') : sec === 'cont' ? t('removeContHint') : sec === 'played' ? t('removePlayedHint') : '', onClick: () => removeFromList(id, sec) }
          : null,
        { icon: 'trash', label: it.ext === 'board' ? t('bd_deleteBoard') : t('delete'), danger: true, onClick: () => deleteItems([id]) },
      ]);
    },
    selecting: () => false,
  });
}
