// Library: folders, filters, sorting, grid/list, multi-select.
import { h } from '../util.js';
import { ic } from '../icons.js';
import { t } from '../i18n.js';
import {
  state, setSetting, visibleItems, childFolders, folderPath, descendantFolderIds, allTags, isFolderHidden, lockedFolderSet,
} from '../store.js';
import { actionSheet, toast } from '../ui.js';
import { itemCard, folderTile, wireCards, emptyState } from './shared.js';
import { addToPlaylistDialog } from '../playlists.js';
import { itemActions, folderActions, deleteItems, moveItemsDialog, tagDialog, toggleFav } from '../actions.js';

export const lib = { folderId: null, filter: 'all', selecting: null, limit: 60 };

const FILTERS = ['all', 'video', 'image', 'book', 'audio', 'file', 'fav'];

const SORTS = {
  'added-desc': (a, b) => (b.added || 0) - (a.added || 0),
  'added-asc': (a, b) => (a.added || 0) - (b.added || 0),
  'name-asc': (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }),
  'name-desc': (a, b) => b.name.localeCompare(a.name, undefined, { numeric: true, sensitivity: 'base' }),
  'size-desc': (a, b) => (b.size || 0) - (a.size || 0),
  'size-asc': (a, b) => (a.size || 0) - (b.size || 0),
  type: (a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name, undefined, { numeric: true }),
};

export function libraryBack(ctx) {
  if (lib.selecting) { lib.selecting = null; ctx.rerender(); return true; }
  if (lib.filter !== 'all' && lib.folderId == null) { lib.filter = 'all'; ctx.rerender(); return true; }
  if (lib.folderId) { lib.folderId = state.folders.get(lib.folderId)?.parentId || null; lib.limit = 60; ctx.rerender(true); return true; }
  return false;
}

function currentItems() {
  const vis = visibleItems();
  let pool;
  if (lib.filter === 'all' || lib.filter === 'fav' || lib.filter.startsWith('tag:')) {
    pool = lib.filter === 'all' ? vis.filter((i) => (i.folderId || null) === lib.folderId) : scope(vis);
  } else pool = scope(vis);
  if (lib.filter === 'fav') pool = pool.filter((i) => i.fav);
  else if (lib.filter.startsWith('tag:')) { const tg = lib.filter.slice(4).toLowerCase(); pool = pool.filter((i) => (i.tags || []).some((x) => x.toLowerCase() === tg)); }
  else if (lib.filter !== 'all') pool = pool.filter((i) => i.kind === lib.filter);
  return pool.sort(SORTS[state.settings.sort] || SORTS['added-desc']);
}

function scope(vis) {
  if (lib.folderId == null) return vis;
  const ids = new Set([lib.folderId, ...descendantFolderIds(lib.folderId)]);
  return vis.filter((i) => ids.has(i.folderId));
}

export function renderLibrary(ctx) {
  // If the folder we were in became hidden, go back to the root.
  if (lib.folderId && (!state.folders.get(lib.folderId) || (!state.vaultOpen && lockedFolderSet().has(lib.folderId)))) lib.folderId = null;
  if (lib.selecting) for (const id of [...lib.selecting]) if (!state.items.has(id)) lib.selecting.delete(id);

  const root = h('div', { class: 'screen library' });
  const folder = lib.folderId ? state.folders.get(lib.folderId) : null;
  const items = currentItems();
  const sel = lib.selecting;
  const listIds = items.map((i) => i.id);

  root.append(sel ? selectionBar(ctx, items) : header(ctx, folder));
  if (!sel) root.append(crumbs(ctx));
  root.append(chips(ctx));

  const body = h('div', { class: 'lib-body' });
  const showFolders = lib.filter === 'all';
  const folders = showFolders ? childFolders(lib.folderId).filter((f) => !isFolderHidden(f)) : [];

  if (folders.length) body.append(h('div', { class: 'folders' }, folders.map((f) => folderTile(f, { selecting: !!sel }))));

  if (!items.length && !folders.length) {
    body.append(emptyHere(ctx, folder));
  } else if (items.length) {
    const view = state.settings.view;
    const grid = h('div', { class: view === 'list' ? 'list' : 'grid' });
    const mode = view === 'list' ? 'list' : 'grid';
    const draw = (from, to) => items.slice(from, to).forEach((i) => grid.append(itemCard(i, { mode, selecting: !!sel, selected: !!sel && sel.has(i.id) })));
    draw(0, lib.limit);
    body.append(grid);
    if (items.length > lib.limit) {
      const more = h('div', { class: 'sentinel' });
      body.append(more);
      const io = new IntersectionObserver((es) => {
        if (!es.some((e) => e.isIntersecting)) return;
        io.disconnect();
        const from = lib.limit; lib.limit += 60; draw(from, lib.limit); more.remove();
        if (items.length > lib.limit) { body.append(more); io.observe(more); }
      }, { rootMargin: '900px' });
      requestAnimationFrame(() => io.observe(more));
    }
  }
  root.append(body);

  wireCards(root, {
    selecting: () => !!lib.selecting,
    toggle: (id) => { toggleSel(id); ctx.rerender(true); },
    longPress: (id) => { if (!lib.selecting) lib.selecting = new Set(); toggleSel(id, true); ctx.rerender(true); },
    open: (id) => ctx.openItem(id, listIds),
    more: (id) => itemActions(id, { onOpen: () => ctx.openItem(id, listIds) }),
    openFolder: (fid) => { if (lib.selecting) return; lib.folderId = fid; lib.filter = 'all'; lib.limit = 60; ctx.rerender(false, true); },
    folderMore: (fid) => folderActions(fid),
  });
  return root;
}

function toggleSel(id, forceOn) {
  if (!lib.selecting) return;
  if (forceOn || !lib.selecting.has(id)) lib.selecting.add(id); else lib.selecting.delete(id);
}

function header(ctx, folder) {
  return h('header', { class: 'top' },
    folder ? h('button', { class: 'icon-btn', 'aria-label': t('back'), onClick: () => libraryBack(ctx), html: ic('back', 'flip-rtl') }) : null,
    h('h1', { class: 'top-title', dir: 'auto' }, folder ? folder.name : t('library')),
    h('div', { class: 'top-actions' },
      h('button', { class: 'icon-btn', 'aria-label': t('selectItems'), onClick: () => { lib.selecting = new Set(); ctx.rerender(true); }, html: ic('select') }),
      h('button', { class: 'icon-btn', 'aria-label': t('view'), onClick: () => { setSetting('view', state.settings.view === 'grid' ? 'list' : 'grid'); }, html: ic(state.settings.view === 'grid' ? 'list' : 'grid') }),
      h('button', { class: 'icon-btn', 'aria-label': t('sortBy'), onClick: () => sortSheet(), html: ic('sort') })));
}

function crumbs(ctx) {
  const path = folderPath(lib.folderId);
  if (!path.length) return h('div', { class: 'crumbs-spacer' });
  return h('nav', { class: 'crumbs', 'aria-label': 'Breadcrumb' },
    h('button', { class: 'crumb', onClick: () => { lib.folderId = null; lib.filter = 'all'; ctx.rerender(true); } }, t('library')),
    path.flatMap((f, i) => [h('span', { class: 'crumb-sep', html: ic('chev', 'flip-rtl') }),
      h('button', { class: 'crumb' + (i === path.length - 1 ? ' cur' : ''), dir: 'auto', onClick: () => { lib.folderId = f.id; lib.filter = 'all'; ctx.rerender(true); } }, f.name)]));
}

function chips(ctx) {
  const tags = [...allTags().keys()].sort((a, b) => a.localeCompare(b));
  const mk = (id, label, icon) => h('button', { class: 'chip' + (lib.filter === id ? ' on' : ''), onClick: () => { lib.filter = id; lib.limit = 60; ctx.rerender(true); } },
    icon ? h('span', { html: ic(icon) }) : null, label);
  return h('div', { class: 'chips', role: 'tablist' },
    FILTERS.map((f) => mk(f, f === 'all' ? t('all') : f === 'fav' ? t('favorites') : t('kinds_' + f), f === 'fav' ? 'star' : f === 'all' ? null : f)),
    tags.map((tg) => mk('tag:' + tg, '#' + tg)));
}

function selectionBar(ctx, items) {
  const sel = lib.selecting;
  const ids = () => [...sel];
  const after = () => { lib.selecting = null; ctx.rerender(true); };
  const need = (fn) => () => { if (!sel.size) { toast(t('selectFirst')); return; } fn(); };
  return h('header', { class: 'top selbar' },
    h('button', { class: 'icon-btn', 'aria-label': t('cancel'), onClick: () => { lib.selecting = null; ctx.rerender(true); }, html: ic('close') }),
    h('div', { class: 'sel-count' }, t('selectedN', { n: sel.size })),
    h('div', { class: 'top-actions' },
      h('button', { class: 'icon-btn', 'aria-label': t('selectAll'), onClick: () => { items.forEach((i) => sel.add(i.id)); ctx.rerender(true); }, html: ic('checkCircle') }),
      h('button', { class: 'icon-btn', 'aria-label': t('favorite'), onClick: need(() => { toggleFav(ids()); after(); }), html: ic('star') }),
      h('button', { class: 'icon-btn', 'aria-label': t('tags'), onClick: need(() => tagDialog(ids())), html: ic('tag') }),
      h('button', { class: 'icon-btn', 'aria-label': t('addToPlaylist'), onClick: need(() => { addToPlaylistDialog(ids()); after(); }), html: ic('playlist') }),
      h('button', { class: 'icon-btn', 'aria-label': t('moveTo'), onClick: need(async () => { if (await moveItemsDialog(ids())) after(); }), html: ic('move') }),
      h('button', { class: 'icon-btn danger', 'aria-label': t('delete'), onClick: need(async () => { if (await deleteItems(ids())) after(); }), html: ic('trash') })));
}

function sortSheet() {
  const cur = state.settings.sort;
  const opt = (id, label) => ({ icon: 'sort', label, checked: cur === id, onClick: () => setSetting('sort', id) });
  actionSheet(t('sortBy'), [
    opt('added-desc', t('sortNewest')), opt('added-asc', t('sortOldest')),
    opt('name-asc', t('sortNameAZ')), opt('name-desc', t('sortNameZA')),
    opt('size-desc', t('sortLargest')), opt('size-asc', t('sortSmallest')), opt('type', t('sortType')),
  ]);
}

function emptyHere(ctx, folder) {
  if (lib.filter !== 'all') return emptyState({ icon: 'search', title: t('nothingHere'), text: t('nothingFilter') });
  return emptyState({
    icon: folder ? 'folder' : 'sparkle',
    title: folder ? t('folderEmpty') : t('libraryEmpty'),
    text: t('folderEmptyText'),
    action: h('div', { class: 'hero-actions' },
      h('button', { class: 'btn primary', onClick: () => ctx.addFiles() }, h('span', { html: ic('plus') }), t('addFiles')),
      h('button', { class: 'btn ghost', onClick: () => ctx.newFolder() }, h('span', { html: ic('folderPlus') }), t('newFolder'))),
  });
}
