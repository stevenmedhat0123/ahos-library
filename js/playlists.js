// Custom playlists: cards on Home, a playlist sheet (play / shuffle / remove), and "add to playlist".
import { h, hashStr } from './util.js';
import { ic } from './icons.js';
import { t } from './i18n.js';
import { state, visibleItems, createPlaylist, renamePlaylist, deletePlaylist, addToPlaylist, removeFromPlaylist } from './store.js';
import { openSheet, actionSheet, promptDialog, confirmDialog, toast } from './ui.js';

const PALETTE = [['#6D4BDB', '#FF5C7A'], ['#1F6FEA', '#22D3EE'], ['#E11D48', '#F59E0B'], ['#0EA5E9', '#8B5CF6'], ['#059669', '#3B82F6'], ['#C026D3', '#F97316']];
const colorsFor = (name) => PALETTE[Math.abs(hashStr(name)) % PALETTE.length];

/** Playlist entries that exist and are visible right now (the vault may hide some). */
function entries(p) {
  const vis = new Set(visibleItems().map((i) => i.id));
  return p.ids.map((id) => state.items.get(id)).filter((it) => it && vis.has(it.id));
}

export async function newPlaylistDialog(ids = []) {
  const name = await promptDialog({ title: t('newPlaylist'), placeholder: t('playlistName'), ok: t('create') });
  if (!name) return null;
  const p = createPlaylist(name, ids);
  if (ids.length) toast(t('addedToPlaylist', { n: ids.length, name: p.name }));
  return p;
}

export function addToPlaylistDialog(itemIds) {
  const acts = state.playlists.map((p) => ({
    icon: 'playlist', label: p.name, hint: String(p.ids.length),
    onClick: () => { const n = addToPlaylist(p.id, itemIds); toast(n ? t('addedToPlaylist', { n, name: p.name }) : t('alreadyInPlaylist')); },
  }));
  return actionSheet(t('addToPlaylist'), [{ icon: 'plus', label: t('newPlaylist'), onClick: () => newPlaylistDialog(itemIds) }, ...acts]);
}

export function playlistCards(ctx) {
  const cards = state.playlists.map((p) => {
    const [a, b] = colorsFor(p.name);
    const n = entries(p).length;
    return h('button', { class: 'pl-card', style: { '--pc1': a, '--pc2': b }, onClick: () => playlistSheet(ctx, p.id) },
      h('span', { class: 'ic', html: ic('playlist') }),
      h('span', null, h('b', { dir: 'auto' }, p.name), h('small', null, t('nItems', { n }))));
  });
  cards.push(h('button', { class: 'pl-card pl-new', onClick: () => newPlaylistDialog() },
    h('span', { class: 'ic', html: ic('plus') }), h('b', null, t('newPlaylist'))));
  return h('div', { class: 'pl-grid' }, cards);
}

function shuffled(a) {
  const x = [...a];
  for (let i = x.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [x[i], x[j]] = [x[j], x[i]]; }
  return x;
}

export function playlistSheet(ctx, id) {
  const first = state.playlists.find((x) => x.id === id);
  if (!first) return null;
  const s = openSheet({ title: first.name, tall: true });
  const list = h('div', { class: 'marks' });
  const play = (shuffle) => {
    const p = state.playlists.find((x) => x.id === id);
    const its = p ? entries(p) : [];
    if (!its.length) { toast(t('playlistEmpty')); return; }
    const order = shuffle ? shuffled(its) : its;
    const startKind = order[0].kind;
    const ids = order.filter((i) => i.kind === startKind).map((i) => i.id);
    s.close();
    setTimeout(() => ctx.openItem(ids[0], ids), 140);
  };
  const more = () => actionSheet(first.name, [
    { icon: 'edit', label: t('rename'), onClick: async () => {
      const p = state.playlists.find((x) => x.id === id);
      const v = await promptDialog({ title: t('rename'), value: p?.name || '', ok: t('save') });
      if (v) renamePlaylist(id, v);
    } },
    { icon: 'trash', label: t('delete'), danger: true, onClick: async () => {
      if (await confirmDialog({ title: t('deletePlaylistQ', { name: first.name }), message: t('deletePlaylistMsg'), ok: t('delete'), danger: true })) { deletePlaylist(id); toast(t('playlistDeleted')); }
    } },
  ]);
  s.body.append(
    h('div', { class: 'pl-actions' },
      h('button', { class: 'btn primary', onClick: () => play(false) }, h('span', { html: ic('play') }), t('playAll')),
      h('button', { class: 'btn ghost', onClick: () => play(true) }, h('span', { html: ic('shuffle') }), t('shuffle')),
      h('button', { class: 'icon-btn', 'aria-label': t('more'), onClick: more, html: ic('more') })),
    list);

  function draw() {
    const p = state.playlists.find((x) => x.id === id);
    if (!p) { s.close(); return; }
    const its = entries(p);
    if (!its.length) { list.replaceChildren(h('div', { class: 'pick-empty' }, t('playlistEmpty'))); return; }
    list.replaceChildren(...its.map((it) =>
      h('div', { class: 'mark-row' },
        h('button', { class: 'mark-go', onClick: () => { const ids = its.filter((x) => x.kind === it.kind).map((x) => x.id); s.close(); setTimeout(() => ctx.openItem(it.id, ids), 140); } },
          h('span', { class: 'mark-ic', style: { color: `var(--c-${it.kind})` }, html: ic(it.kind) }),
          h('span', { class: 'mark-tx' }, h('b', { dir: 'auto', class: 'pl-name' }, it.name))),
        h('button', { class: 'icon-btn sm', 'aria-label': t('removeFromPlaylist'), onClick: () => { removeFromPlaylist(id, [it.id]); draw(); }, html: ic('close') }))));
  }
  draw();
  return s;
}
