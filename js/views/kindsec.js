// The media sections: Videos, Photos, Audio and PDFs & files are four sections of the Hub (or, when merged in Settings, four pages inside one
// "Player" section). Each page is only about its own kind: an Add button, the things to continue / played last / favourites, and everything of
// that kind. Folders, selecting many and moving things stay in the Library ("Folders & manage").
import { h, fmtBytes } from '../util.js';
import { ic } from '../icons.js';
import { t } from '../i18n.js';
import { state, visibleItems, setSetting } from '../store.js';
import { itemCard, sectionHead, emptyState } from './shared.js';
import { mediaLists, stripNodes, wireMedia } from './mediastrips.js';
import { sortItems, sortSheet } from './library.js';
import { playlistCards } from '../playlists.js';
import { isBoard } from '../board/io.js';
import { tileArt } from '../hubart.js';
import { loadCss } from '../lazycss.js';
import { sfx } from '../sound.js';
import { MEDIA_IDS, sectionById } from '../sections.js';

const ACCEPT = { videos: 'video/*', photos: 'image/*', audio: 'audio/*', docs: '' };
let docFilter = 'all';                                   // PDFs & files page: all | book | file

const itemsOf = (kinds) => visibleItems().filter((i) => kinds.includes(i.kind) && !isBoard(i));
const sizeOf = (list) => fmtBytes(list.reduce((a, i) => a + (i.size || 0), 0));
const countOf = (list) => t('nItems', { n: list.length });
// search / view / sort are round icon buttons; the one that leads to the folders keeps its words
const toolBtn = (icon, label, onClick, words = false) => h('button', { class: 'ks-chip' + (words ? '' : ' ks-ic'), type: 'button', 'aria-label': label, title: label, onClick: () => { sfx('tab'); onClick(); } }, h('span', { html: ic(icon) }), words ? label : null);

export async function renderKindSection(ctx, def) {
  await loadCss('css/media.css');
  const kinds = def.kinds;
  const root = h('div', { class: 'ks', dataset: { ks: def.id } });
  const all = itemsOf(kinds);
  const shown = def.id === 'docs' && docFilter !== 'all' ? all.filter((i) => i.kind === docFilter) : all;
  const view = state.settings.view === 'list' ? 'list' : 'grid';

  const add = h('button', { class: 'btn primary ks-add', type: 'button', onClick: () => ctx.addFiles(ACCEPT[def.id] || '') }, h('span', { html: ic('plus') }), t('ks_add_' + def.id));
  root.append(h('div', { class: 'ks-hero' },
    h('span', { class: 'ks-ico', html: tileArt(def.id) }),
    h('div', { class: 'ks-info' }, h('b', null, all.length ? countOf(all) : t('ks_none')), all.length ? h('small', null, sizeOf(all)) : null),
    add));

  if (!all.length) {
    root.append(emptyState({ icon: def.icon, title: t('ks_empty_' + def.id), text: t('ks_emptyText') }));
    return root;
  }

  root.append(h('div', { class: 'ks-tools' },
    toolBtn('search', t('search'), () => ctx.openSearch(def.id)),
    toolBtn(view === 'grid' ? 'list' : 'grid', t('view'), () => setSetting('view', view === 'grid' ? 'list' : 'grid')),
    toolBtn('sort', t('sortBy'), sortSheet),
    toolBtn('folder', t('ks_manage'), () => ctx.openLibrary({ filter: kinds.length === 1 ? kinds[0] : 'all', from: def.id }), true)));

  if (def.id === 'docs') {
    root.append(h('div', { class: 'ks-seg', role: 'tablist' }, [['all', t('ks_f_all')], ['book', t('ks_f_book')], ['file', t('ks_f_file')]].map(([k, label]) =>
      h('button', { class: 'ks-segb' + (docFilter === k ? ' on' : ''), type: 'button', role: 'tab', 'aria-selected': String(docFilter === k), onClick: () => { docFilter = k; sfx('tab'); ctx.rerender(true); } }, label))));
  }

  const lists = mediaLists(shown);
  root.append(...stripNodes(lists));
  if (def.id === 'videos' || def.id === 'audio') root.append(sectionHead(t('playlists')), playlistCards(ctx));

  const ordered = sortItems([...shown]);
  const ids = ordered.map((i) => i.id);
  root.append(sectionHead(t('ks_all_' + def.id), { action: String(ordered.length) }));
  const grid = h('div', { class: view === 'list' ? 'list' : 'grid' });
  let limit = 60;
  const draw = (from, to) => ordered.slice(from, to).forEach((i) => grid.append(itemCard(i, { mode: view })));
  draw(0, limit);
  root.append(grid);
  if (ordered.length > limit) {
    const more = h('div', { class: 'sentinel' });
    root.append(more);
    const io = new IntersectionObserver((es) => {
      if (!es.some((e) => e.isIntersecting)) return;
      io.disconnect();
      const from = limit; limit += 60; draw(from, limit); more.remove();
      if (ordered.length > limit) { root.append(more); io.observe(more); }
    }, { rootMargin: '900px' });
    requestAnimationFrame(() => io.observe(more));
  }
  wireMedia(root, ctx, ids);
  return root;
}

/** The merged "Player" section: four big cards that open the four pages, then what was played last across all of them. */
export async function renderPlayerSection(ctx, def) {
  await loadCss('css/media.css');
  const root = h('div', { class: 'ks ks-player', dataset: { ks: def.id } });
  const everything = MEDIA_IDS.flatMap((id) => itemsOf(sectionById(id).kinds));
  root.append(h('div', { class: 'ks-cards' }, MEDIA_IDS.map((id) => {
    const d = sectionById(id);
    const mine = itemsOf(d.kinds);
    return h('button', { class: 'ks-card', type: 'button', dataset: { id }, style: { '--g1': d.g[0], '--g2': d.g[1] }, onClick: () => { sfx('open'); ctx.openSection(id, { from: def.id }); } },
      h('span', { class: 'ks-ico', html: tileArt(id) }),
      h('b', null, t('sec_' + id)),
      h('small', null, mine.length ? `${countOf(mine)} · ${sizeOf(mine)}` : t('ks_none')));
  })));
  if (!everything.length) { root.append(emptyState({ icon: 'player', title: t('ks_empty_player'), text: t('ks_emptyText') })); return root; }
  const lists = mediaLists(everything);
  root.append(...stripNodes(lists));
  wireMedia(root, ctx, lists.cont.concat(lists.played, lists.fav).map((i) => i.id));
  return root;
}
