// Shared actions on items and folders: rename, move, tag, delete, export, hide with PIN...
import { h, fmtBytes, fmtDate, fmtDur, sha256, uid, ltr } from './util.js';
import { ic } from './icons.js';
import { t, lang } from './i18n.js';
import {
  state, updateItem, removeItems, moveItems, setItemTags, allTags, createFolder, updateFolder, deleteFolder, moveFolder,
  childFolders, folderPath, descendantFolderIds, countIn, getBlob, FOLDER_COLORS, setSetting, emit, isFolderHidden,
} from './store.js';
import { toast, actionSheet, openSheet, confirmDialog, promptDialog, infoDialog, progressCard } from './ui.js';
import { exportBlob } from './native.js';
import { addToPlaylistDialog } from './playlists.js';

/* ---------------- vault (PIN) ---------------- */
export const hasPin = () => !!state.settings.pinHash;

async function hashPin(pin, salt) { return sha256(salt + ':' + pin); }

export async function createPin() {
  const a = await promptDialog({ title: t('createPin'), message: t('createPinMsg'), type: 'password', inputmode: 'numeric', placeholder: '••••', ok: t('next'), maxlength: 12 });
  if (!a) return false;
  if (a.length < 4) { toast(t('pinTooShort')); return false; }
  const b = await promptDialog({ title: t('confirmPin'), type: 'password', inputmode: 'numeric', placeholder: '••••', ok: t('save'), maxlength: 12 });
  if (b == null) return false;
  if (a !== b) { toast(t('pinMismatch')); return false; }
  const salt = uid();
  setSetting('pinSalt', salt);
  setSetting('pinHash', await hashPin(a, salt));
  toast(t('pinSet'));
  return true;
}

export async function verifyPin(title = t('enterPin')) {
  const pin = await promptDialog({ title, type: 'password', inputmode: 'numeric', placeholder: '••••', ok: t('unlock'), maxlength: 12 });
  if (!pin) return false;
  const ok = (await hashPin(pin, state.settings.pinSalt)) === state.settings.pinHash;
  if (!ok) toast(t('wrongPin'));
  return ok;
}

export async function unlockVault() {
  if (state.vaultOpen) return true;
  if (!hasPin()) return false;
  if (await verifyPin(t('unlockHidden'))) { state.vaultOpen = true; emit(); toast(t('hiddenShown')); return true; }
  return false;
}

export function lockVault() { if (state.vaultOpen) { state.vaultOpen = false; emit(); } }

export async function removePin() {
  if (!(await verifyPin(t('enterPin')))) return;
  for (const f of state.folders.values()) if (f.locked) updateFolder(f.id, { locked: false });
  setSetting('pinHash', ''); setSetting('pinSalt', '');
  state.vaultOpen = false; emit();
  toast(t('pinRemoved'));
}

export async function toggleFolderHidden(f) {
  if (!f.locked) {
    if (!hasPin() && !(await createPin())) return;
    updateFolder(f.id, { locked: true });
    toast(t('folderHidden'));
  } else {
    if (!state.vaultOpen && !(await verifyPin())) return;
    updateFolder(f.id, { locked: false });
    toast(t('folderUnhidden'));
  }
}

/* ---------------- folder picker ---------------- */
/** Resolves to a folder id, null for the library root, or undefined if cancelled. */
export function pickFolder({ title = t('moveTo'), exclude = [], start = null } = {}) {
  return new Promise((resolve) => {
    let answered = false;
    const answer = (v) => { if (!answered) { answered = true; resolve(v); } };
    let cur = start && !exclude.includes(start) ? start : null;
    const s = openSheet({ title, tall: true, onClose: () => answer(undefined) });
    const crumbs = h('div', { class: 'pick-crumbs' });
    const list = h('div', { class: 'pick-list' });
    const foot = h('div', { class: 'pick-foot' });
    s.body.append(crumbs, list, foot);

    const render = () => {
      crumbs.replaceChildren(
        h('button', { class: 'crumb', onClick: () => { cur = null; render(); } }, t('library')),
        ...folderPath(cur).flatMap((f) => [h('span', { class: 'crumb-sep', html: ic('chev', 'flip-rtl') }), h('button', { class: 'crumb', onClick: () => { cur = f.id; render(); } }, f.name)]),
      );
      const subs = childFolders(cur).filter((f) => !exclude.includes(f.id) && !isFolderHidden(f));
      list.replaceChildren(
        ...(subs.length ? subs.map((f) => h('button', { class: 'pick-row', onClick: () => { cur = f.id; render(); } },
          h('span', { class: 'dot', style: { background: f.color } }), h('span', { class: 'pick-name' }, f.name), h('span', { class: 'pick-chev', html: ic('chev', 'flip-rtl') })))
          : [h('div', { class: 'pick-empty' }, t('noSubfolders'))]),
      );
      foot.replaceChildren(
        h('button', { class: 'btn ghost', onClick: async () => {
          const name = await promptDialog({ title: t('newFolder'), placeholder: t('folderName'), ok: t('create') });
          if (name) { const f = createFolder(name, cur); cur = f.id; render(); }
        } }, h('span', { html: ic('folderPlus') }), t('newFolder')),
        h('button', { class: 'btn primary', onClick: () => { answer(cur); s.close(); } }, t('moveHere')),
      );
    };
    render();
  });
}

/* ---------------- items ---------------- */
export async function renameItem(id) {
  const it = state.items.get(id);
  if (!it) return;
  const v = await promptDialog({ title: t('rename'), value: it.name, ok: t('save') });
  if (!v || v === it.name) return;
  let name = v;
  if (it.ext && !name.toLowerCase().endsWith('.' + it.ext)) name += '.' + it.ext;
  updateItem(id, { name });
}

export async function deleteItems(ids) {
  const n = ids.length;
  const size = ids.reduce((a, id) => a + (state.items.get(id)?.size || 0), 0);
  const ok = await confirmDialog({
    title: n === 1 ? t('deleteOne') : t('deleteN', { n }),
    message: t('deleteMsg', { size: fmtBytes(size) }),
    ok: t('delete'), danger: true,
  });
  if (!ok) return false;
  await removeItems(ids);
  toast(t('deletedN', { n }));
  return true;
}

export async function moveItemsDialog(ids) {
  const start = state.items.get(ids[0])?.folderId || null;
  const dest = await pickFolder({ title: t('moveTo'), start });
  if (dest === undefined) return false;
  moveItems(ids, dest);
  toast(t('movedN', { n: ids.length }));
  return true;
}

export function toggleFav(ids) {
  const items = ids.map((i) => state.items.get(i)).filter(Boolean);
  const makeFav = items.some((i) => !i.fav);
  items.forEach((i) => updateItem(i.id, { fav: makeFav }, { silent: true }));
  emit();
  toast(makeFav ? t('addedFav') : t('removedFav'));
}

export function tagDialog(ids) {
  const items = ids.map((i) => state.items.get(i)).filter(Boolean);
  if (!items.length) return;
  const s = openSheet({ title: t('tags'), tall: true });
  const chips = h('div', { class: 'tag-chips' });
  const input = h('input', { class: 'field', placeholder: t('addTag'), maxlength: 30, enterkeyhint: 'done' });
  const hasTag = (tag) => items.every((it) => (it.tags || []).some((x) => x.toLowerCase() === tag.toLowerCase()));
  const some = (tag) => items.some((it) => (it.tags || []).some((x) => x.toLowerCase() === tag.toLowerCase()));
  const toggle = (tag) => {
    const on = hasTag(tag);
    items.forEach((it) => {
      const cur = it.tags || [];
      setItemTags(it.id, on ? cur.filter((x) => x.toLowerCase() !== tag.toLowerCase()) : [...cur, tag]);
    });
    render();
  };
  const render = () => {
    const known = new Map([...allTags()].map(([k, v]) => [k, v]));
    chips.replaceChildren(...[...known.keys()].sort((a, b) => a.localeCompare(b)).map((tag) =>
      h('button', { class: 'chip' + (hasTag(tag) ? ' on' : some(tag) ? ' part' : ''), onClick: () => toggle(tag) }, '#' + tag)));
    if (!known.size) chips.append(h('div', { class: 'pick-empty' }, t('noTagsYet')));
  };
  const add = () => {
    const v = input.value.trim().replace(/^#/, '');
    if (!v) return;
    items.forEach((it) => setItemTags(it.id, [...(it.tags || []), v]));
    input.value = '';
    render();
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
  s.body.append(
    h('div', { class: 'tag-add' }, input, h('button', { class: 'btn primary', onClick: add }, t('add'))),
    chips,
  );
  render();
}

export async function exportItem(id) {
  const it = state.items.get(id);
  if (!it) return;
  if (it.kind === 'book' && it.ext === 'board') {
    // a board is shared as a PDF of its pages
    const card = progressCard(t('bd_exporting'));
    try { const { exportBoardPdf } = await import('./board/io.js'); await exportBoardPdf(id, (f) => card.update(Math.round(f * 100) + '%', f)); }
    catch (e) { console.warn(e); toast(t('exportFailed')); } finally { card.done(); }
    return;
  }
  const blob = await getBlob(id);
  if (!blob) { toast(t('fileMissing')); return; }
  const card = it.size > 20 * 1024 * 1024 ? progressCard(t('preparing')) : null;
  try {
    await exportBlob(it.name, new Blob([blob], { type: it.mime || blob.type }), (f) => card?.update(Math.round(f * 100) + '%', f));
  } catch (e) {
    console.warn(e);
    toast(t('exportFailed'));
  } finally { card?.done(); }
}

export function itemDetails(id) {
  const it = state.items.get(id);
  if (!it) return;
  const m = it.meta || {};
  const path = folderPath(it.folderId).map((f) => f.name).join(' / ') || t('library');
  infoDialog({
    title: t('details'),
    rows: [
      [t('name'), it.name],
      [t('type'), t('kind_' + it.kind) + (it.ext ? ' · .' + it.ext : '')],
      [t('size'), fmtBytes(it.size)],
      m.duration ? [t('duration'), fmtDur(m.duration)] : null,
      m.w ? [t('dimensions'), ltr(`${m.w} × ${m.h}`)] : null,
      m.pages ? [t('pages'), String(m.pages)] : null,
      m.author ? [t('author'), m.author] : null,
      !it.thumb && m.thumbWhy ? [t('noPreview2'), t('thumbWhy_' + m.thumbWhy)] : null,
      [t('location'), path],
      [t('added'), fmtDate(it.added, lang())],
      (it.tags || []).length ? [t('tags'), it.tags.map((x) => '#' + x).join('  ')] : null,
    ],
  });
}

export function itemActions(id, { onOpen, afterDelete } = {}) {
  const it = state.items.get(id);
  if (!it) return;
  actionSheet(it.name, [
    onOpen ? { icon: 'play', label: t('open'), onClick: onOpen } : null,
    { icon: 'star', label: it.fav ? t('removeFav') : t('addFav'), onClick: () => toggleFav([id]) },
    { icon: 'edit', label: t('rename'), onClick: () => renameItem(id) },
    { icon: 'move', label: t('moveTo'), onClick: () => moveItemsDialog([id]) },
    { icon: 'tag', label: t('tags'), onClick: () => tagDialog([id]) },
    { icon: 'playlist', label: t('addToPlaylist'), onClick: () => addToPlaylistDialog([id]) },
    { icon: 'share', label: t('exportOpenWith'), onClick: () => exportItem(id) },
    { icon: 'info', label: t('details'), onClick: () => itemDetails(id) },
    { icon: 'trash', label: t('delete'), danger: true, onClick: async () => { if (await deleteItems([id])) afterDelete?.(); } },
  ]);
}

/* ---------------- folders ---------------- */
export async function newFolderDialog(parentId) {
  const name = await promptDialog({ title: t('newFolder'), placeholder: t('folderName'), ok: t('create') });
  if (name) return createFolder(name, parentId);
  return null;
}

export function colorSheet(f) {
  const s = openSheet({ title: t('folderColor') });
  s.body.append(h('div', { class: 'swatches' }, FOLDER_COLORS.map((c) =>
    h('button', { class: 'swatch' + (f.color === c ? ' on' : ''), style: { background: c }, 'aria-label': c, onClick: () => { updateFolder(f.id, { color: c }); s.close(); } }))));
}

export function folderActions(id) {
  const f = state.folders.get(id);
  if (!f) return;
  const { n } = countIn(id);
  actionSheet(f.name, [
    { icon: 'edit', label: t('rename'), onClick: async () => {
      const v = await promptDialog({ title: t('rename'), value: f.name, ok: t('save') });
      if (v) updateFolder(id, { name: v });
    } },
    { icon: 'sparkle', label: t('folderColor'), onClick: () => colorSheet(f) },
    { icon: 'move', label: t('moveTo'), onClick: async () => {
      const dest = await pickFolder({ title: t('moveTo'), exclude: [id, ...descendantFolderIds(id)], start: f.parentId });
      if (dest !== undefined) moveFolder(id, dest);
    } },
    { icon: f.locked ? 'unlock' : 'lock', label: f.locked ? t('unhideFolder') : t('hideFolder'), hint: f.locked ? '' : t('pinHint'), onClick: () => toggleFolderHidden(f) },
    { icon: 'trash', label: t('delete'), danger: true, onClick: async () => {
      if (!n && !childFolders(id).length) { await deleteFolder(id, { keepItems: true }); toast(t('folderDeleted')); return; }
      const s = actionSheet(t('deleteFolderQ', { name: f.name }), [
        { icon: 'folder', label: t('deleteKeep'), hint: t('deleteKeepHint'), onClick: async () => { await deleteFolder(id, { keepItems: true }); toast(t('folderDeleted')); } },
        { icon: 'trash', label: t('deleteAll', { n }), danger: true, onClick: async () => {
          if (await confirmDialog({ title: t('deleteAll', { n }), message: t('cannotUndo'), ok: t('delete'), danger: true })) { await deleteFolder(id, { keepItems: false }); toast(t('folderDeleted')); }
        } },
      ]);
      return s;
    } },
  ]);
}
