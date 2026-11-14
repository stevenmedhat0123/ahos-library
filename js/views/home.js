// Home: continue where you left off, jump by type, recent and favourite items.
import { h, fmtBytes } from '../util.js';
import { ic } from '../icons.js';
import { mark } from '../brand.js';
import { t } from '../i18n.js';
import { state, visibleItems, hasVault } from '../store.js';
import { itemCard, wireCards, sectionHead, progressFrac } from './shared.js';
import { itemActions, removeFromList, deleteItems } from '../actions.js';
import { actionSheet } from '../ui.js';
import { playlistCards } from '../playlists.js';
import { gateEnabled, isOwner } from '../auth.js';
import { pushLayer } from '../ui.js';
import { setSearchQuery } from './search.js';

// A shield button in the header, only for the signed-in owner.
const ownerEntry = () => (gateEnabled() && isOwner()
  ? h('button', { class: 'icon-btn', 'aria-label': t('o_title'), onClick: () => import('./owner.js').then((m) => m.openOwnerPanel()), html: ic('shield') })
  : null);

const KINDS = ['video', 'image', 'book', 'audio', 'file'];

/** Brand + icons with no band behind them. The search icon turns the header into a long search bar (covering the brand); Enter opens the results. */
function homeHeader(ctx) {
  const input = h('input', { class: 'hs-input', type: 'search', placeholder: t('searchPlaceholder'), enterkeyhint: 'search', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', 'aria-label': t('search') });
  let layer = null;
  const head = h('header', { class: 'top home-top' });
  const shut = () => { head.classList.remove('searching'); input.blur(); };
  const close = () => { if (layer && !layer.closed) layer.close(); else shut(); };
  const openBar = () => {
    head.classList.add('searching');
    if (!layer || layer.closed) layer = pushLayer(() => { layer = null; shut(); });
    setTimeout(() => input.focus(), 40);
  };
  const form = h('form', { class: 'hs', role: 'search', onSubmit: (e) => {
    e.preventDefault();
    const q = input.value.trim();
    if (q) setSearchQuery(q);
    if (layer && !layer.closed) layer.close();
    ctx.go('search');
  } },
  h('span', { class: 'hs-ic', html: ic('search') }), input,
  h('button', { type: 'button', class: 'icon-btn sm', 'aria-label': t('cancel'), onClick: close, html: ic('close') }));
  head.append(
    h('div', { class: 'brand' }, h('span', { class: 'brand-mark', html: mark() }),
      h('span', { class: 'brand-name' }, 'AHOS', h('small', null, 'Library'))),
    h('div', { class: 'top-actions' },
      ownerEntry(),
      hasVault() ? h('button', { class: 'icon-btn', 'aria-label': state.vaultOpen ? t('hideAgain') : t('unlockHidden'), onClick: () => ctx.toggleVault(), html: ic(state.vaultOpen ? 'unlock' : 'lock') }) : null,
      h('button', { class: 'icon-btn', 'aria-label': t('search'), onClick: openBar, html: ic('search') })),
    form);
  return head;
}

export function renderHome(ctx) {
  const items = visibleItems();
  const root = h('div', { class: 'screen home' });

  root.append(homeHeader(ctx));

  if (!items.length && !state.folders.size) {
    root.append(h('section', { class: 'hero-empty' },
      h('div', { class: 'hero-mark', html: mark() }),
      h('h1', null, t('emptyTitle')),
      h('p', null, t('emptyText')),
      h('div', { class: 'hero-actions' },
        h('button', { class: 'btn primary lg', onClick: () => ctx.addFiles() }, h('span', { html: ic('plus') }), t('addFiles')),
        h('button', { class: 'btn ghost lg', onClick: () => ctx.newFolder() }, h('span', { html: ic('folderPlus') }), t('newFolder'))),
      h('ul', { class: 'hero-points' },
        h('li', null, h('span', { html: ic('cloud') }), t('pointOffline')),
        h('li', null, h('span', { html: ic('shield') }), t('pointPrivate')))));
    return root;
  }

  const total = items.reduce((a, i) => a + (i.size || 0), 0);
  root.append(h('div', { class: 'greet' },
    h('h1', null, t('homeTitle')),
    h('p', null, t('homeStats', { n: items.length, size: fmtBytes(total) }))));

  const cont = items.filter((i) => { const f = progressFrac(i); return f > 0 && f < 0.98 && ['video', 'book', 'audio'].includes(i.kind) && !((i.contHide || 0) >= ((i.progress && i.progress.at) || 0)); })
    .sort((a, b) => (b.opened || 0) - (a.opened || 0)).slice(0, 10);
  if (cont.length) {
    root.append(sectionHead(t('continue')),
      h('div', { class: 'strip', dataset: { sec: 'cont' } }, cont.map((i) => itemCard(i, { mode: 'wide' }))));
  }

  const counts = Object.fromEntries(KINDS.map((k) => [k, 0]));
  items.forEach((i) => counts[i.kind]++);
  root.append(sectionHead(t('browse')),
    h('div', { class: 'kinds' }, KINDS.map((k) =>
      h('button', { class: `kind-tile k-${k}`, onClick: () => ctx.openLibrary({ filter: k }) },
        h('span', { class: 'kt-ic', html: ic(k) }),
        h('span', { class: 'kt-nm' }, t('kinds_' + k)),
        h('span', { class: 'kt-n' }, String(counts[k]))))));

  root.append(sectionHead(t('playlists')), playlistCards(ctx));

  const recent = items.filter((i) => !i.noRecent).sort((a, b) => (b.added || 0) - (a.added || 0)).slice(0, 12);
  if (recent.length) {
    root.append(sectionHead(t('recent'), { action: t('seeAll'), onAction: () => ctx.openLibrary({ filter: 'all', sort: 'added-desc' }) }),
      h('div', { class: 'strip', dataset: { sec: 'recent' } }, recent.map((i) => itemCard(i, { mode: 'mini' }))));
  }

  const favs = items.filter((i) => i.fav).slice(0, 12);
  if (favs.length) {
    root.append(sectionHead(t('favorites'), { action: t('seeAll'), onAction: () => ctx.openLibrary({ filter: 'fav' }) }),
      h('div', { class: 'strip', dataset: { sec: 'fav' } }, favs.map((i) => itemCard(i, { mode: 'mini' }))));
  }

  wireCards(root, {
    open: (id) => ctx.openItem(id, cont.concat(recent, favs).map((i) => i.id)),
    more: (id, card) => itemActions(id, { onOpen: () => ctx.openItem(id, [id]), sec: card?.closest('[data-sec]')?.dataset.sec }),
    // long press = quick menu: take it off this list, or delete it completely
    longPress: (id, card) => {
      const it = state.items.get(id);
      if (!it) return;
      const sec = card?.closest('[data-sec]')?.dataset.sec;
      actionSheet(it.name.replace(/\.board$/i, ''), [
        sec === 'recent' || sec === 'cont' || sec === 'fav'
          ? { icon: 'close', label: sec === 'fav' ? t('removeFav') : t('removeFromList'), hint: sec === 'recent' ? t('removeRecentHint') : sec === 'cont' ? t('removeContHint') : '', onClick: () => removeFromList(id, sec) }
          : null,
        { icon: 'trash', label: it.ext === 'board' ? t('bd_deleteBoard') : t('delete'), danger: true, onClick: () => deleteItems([id]) },
      ]);
    },
    selecting: () => false,
  });
  return root;
}
