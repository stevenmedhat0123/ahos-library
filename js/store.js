// IndexedDB storage + in-memory state. Everything lives on the device; nothing is uploaded.
import { uid } from './util.js';

const DB_NAME = 'ahos-library';
const DB_VER = 1;
let dbp;

function open() {
  return (dbp ||= new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, DB_VER);
    r.onupgradeneeded = () => {
      const db = r.result;
      db.createObjectStore('items', { keyPath: 'id' });
      db.createObjectStore('blobs', { keyPath: 'id' });
      db.createObjectStore('folders', { keyPath: 'id' });
      db.createObjectStore('meta', { keyPath: 'key' });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
}

const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

async function tx(stores, mode, fn) {
  const db = await open();
  const list = [].concat(stores);
  const t = db.transaction(list, mode);
  const done = new Promise((res, rej) => {
    t.oncomplete = () => res();
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error || new Error('Transaction aborted'));
  });
  const out = await fn(...list.map((s) => t.objectStore(s)));
  await done;
  return out;
}

const idb = {
  all: (s) => tx(s, 'readonly', (st) => req(st.getAll())),
  get: (s, k) => tx(s, 'readonly', (st) => req(st.get(k))),
  put: (s, v) => tx(s, 'readwrite', (st) => req(st.put(v))),
  del: (s, k) => tx(s, 'readwrite', (st) => req(st.delete(k))),
};

/* ---------------- state ---------------- */
export const DEFAULTS = {
  lang: 'ar',
  theme: 'dark', // dark | light | auto
  skin: 'lapis', // lapis | midnight | black | violet | emerald | ruby | ocean
  accent: 'gold', // gold | sky | rose | violet | mint | coral | red
  fx: false, // glass blur effects (heavier)
  playBtn: 'none', // circle behind the player's big play button: none | clear | glass
  bg: 'calm', // full (animated) | calm (static, follows scroll) | off
  view: 'grid', // grid | list
  sort: 'added-desc',
  autoNext: true,
  playMode: 'seq', // seq | all | one | n | once | shuffle
  repeatN: 2,
  keepAwake: true,
  bgAudio: true,
  autoPip: false,
  openMuted: false,
  subSize: 'm', subColor: 'white', subBg: true,
  pinHash: '',
  pinSalt: '',
  reader: { size: 19, theme: 'paper', font: 'serif', lh: 1.75 },
  pdfNight: false,
};

export const state = {
  items: new Map(),
  folders: new Map(),
  settings: { ...DEFAULTS },
  playlists: [], // [{id, name, ids:[], created}]
  pending: {}, // restored organisation data waiting for its file: { 'name|size': {...} }
  vaultOpen: false,
  ready: false,
};

const listeners = new Set();
let pending = false, lastCost = 0;
export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
/**
 * Asks every screen to redraw. Calls are merged, and the wait grows with how long the last redraw took
 * (about 3x), so a burst of changes (importing files, previews arriving) can never keep the phone busy redrawing.
 */
export function emit() {
  if (pending) return;
  pending = true;
  setTimeout(() => {
    pending = false;
    const t0 = performance.now();
    listeners.forEach((f) => { try { f(); } catch (e) { console.error(e); } });
    lastCost = performance.now() - t0;
  }, Math.min(1200, Math.max(30, Math.round(lastCost * 3))));
}

/** Small changes to one item (a preview arrived, a duration was read): only that item's card is rebuilt, not the whole screen. */
const patchListeners = new Set();
const patchIds = new Set();
let patchTimer = 0;
export function onItemPatch(fn) { patchListeners.add(fn); return () => patchListeners.delete(fn); }
export function emitItem(id) {
  patchIds.add(id);
  if (patchTimer) return;
  patchTimer = setTimeout(() => {
    patchTimer = 0;
    const ids = [...patchIds]; patchIds.clear();
    patchListeners.forEach((f) => { try { f(ids); } catch (e) { console.error(e); } });
  }, 80);
}

export async function loadAll() {
  const [items, folders, s, pl, pend] = await Promise.all([idb.all('items'), idb.all('folders'), idb.get('meta', 'settings'), idb.get('meta', 'playlists'), idb.get('meta', 'pending')]);
  items.forEach((i) => state.items.set(i.id, i));
  folders.forEach((f) => state.folders.set(f.id, f));
  state.playlists = Array.isArray(pl?.value) ? pl.value : [];
  state.pending = pend?.value && typeof pend.value === 'object' ? pend.value : {};
  state.settings = { ...DEFAULTS, ...(s?.value || {}), ...readLocalSettings() };
  state.ready = true;
}

function readLocalSettings() {
  try { return JSON.parse(localStorage.getItem('ahos.settings') || '{}'); } catch { return {}; }
}

export function bootSettings() {
  return { ...DEFAULTS, ...readLocalSettings() };
}

export function getSetting(k) { return state.settings[k]; }

export function setSetting(k, v) {
  state.settings[k] = v;
  persistSettings();
  emit();
}

let settingsTimer;
function persistSettings() {
  clearTimeout(settingsTimer);
  settingsTimer = setTimeout(() => {
    idb.put('meta', { key: 'settings', value: state.settings }).catch(() => {});
    try {
      const { lang, theme, bg, skin, accent, fx } = state.settings;
      localStorage.setItem('ahos.settings', JSON.stringify({ lang, theme, bg, skin, accent, fx }));
    } catch { /* storage may be unavailable */ }
  }, 150);
}

/* ---------------- items ---------------- */
export async function addItem(item, blob) {
  await tx(['items', 'blobs'], 'readwrite', (i, b) => { b.put({ id: item.id, blob }); i.put(item); });
  state.items.set(item.id, item);
  emit();
}

export function updateItem(id, patch, { silent = false, card = false } = {}) {
  const it = state.items.get(id);
  if (!it) return;
  Object.assign(it, patch);
  idb.put('items', it).catch((e) => console.warn('save failed', e));
  if (card) emitItem(id);
  else if (!silent) emit();
}

export async function getBlob(id) {
  const r = await idb.get('blobs', id);
  return r?.blob || null;
}

export async function replaceBlob(id, blob) {
  await idb.put('blobs', { id, blob });
}

const removeHooks = new Set();
export const onRemove = (fn) => removeHooks.add(fn);

export async function removeItems(ids) {
  await tx(['items', 'blobs'], 'readwrite', (i, b) => { ids.forEach((id) => { i.delete(id); b.delete(id); }); });
  ids.forEach((id) => { state.items.delete(id); removeHooks.forEach((f) => f(id)); });
  const gone = new Set(ids);
  let touched = false;
  for (const p of state.playlists) {
    const n = p.ids.filter((x) => !gone.has(x));
    if (n.length !== p.ids.length) { p.ids = n; touched = true; }
  }
  if (touched) savePlaylists();
  emit();
}

/* ---------------- bookmarks (stored on the item) ---------------- */
export function addMark(id, mark) {
  const it = state.items.get(id);
  if (!it) return null;
  const m = { id: uid(), at: Date.now(), ...mark };
  updateItem(id, { marks: [...(it.marks || []), m] }, { silent: true });
  return m;
}
export function removeMark(id, markId) {
  const it = state.items.get(id);
  if (!it) return;
  updateItem(id, { marks: (it.marks || []).filter((m) => m.id !== markId) }, { silent: true });
}

/* ---------------- playlists ---------------- */
function savePlaylists() { idb.put('meta', { key: 'playlists', value: state.playlists }).catch(() => {}); }
export function createPlaylist(name, ids = []) {
  const p = { id: uid(), name: (name || '').trim() || 'Playlist', ids: [...new Set(ids)], created: Date.now() };
  state.playlists.push(p);
  savePlaylists(); emit();
  return p;
}
export function renamePlaylist(id, name) {
  const p = state.playlists.find((x) => x.id === id);
  if (p && name.trim()) { p.name = name.trim(); savePlaylists(); emit(); }
}
export function deletePlaylist(id) {
  state.playlists = state.playlists.filter((x) => x.id !== id);
  savePlaylists(); emit();
}
export function addToPlaylist(id, itemIds) {
  const p = state.playlists.find((x) => x.id === id);
  if (!p) return 0;
  let n = 0;
  for (const i of itemIds) if (!p.ids.includes(i)) { p.ids.push(i); n++; }
  savePlaylists(); emit();
  return n;
}
export function removeFromPlaylist(id, itemIds) {
  const p = state.playlists.find((x) => x.id === id);
  if (!p) return;
  p.ids = p.ids.filter((x) => !itemIds.includes(x));
  savePlaylists(); emit();
}
export function setPlaylistIds(id, ids) {
  const p = state.playlists.find((x) => x.id === id);
  if (p) { p.ids = [...new Set(ids)]; savePlaylists(); emit(); }
}
export const playlistByName = (name) => state.playlists.find((p) => p.name === name);

/* ---------------- restored organisation data waiting for files ---------------- */
let pendTimer;
function savePending() {
  clearTimeout(pendTimer);
  pendTimer = setTimeout(() => idb.put('meta', { key: 'pending', value: state.pending }).catch(() => {}), 200);
}
export const pendKey = (name, size) => `${name}|${size}`;
export function addPending(map) { Object.assign(state.pending, map); savePending(); }
export const peekPending = (key) => state.pending[key];
export function consumePending(key) { if (key in state.pending) { delete state.pending[key]; savePending(); } }
export const pendingCount = () => Object.keys(state.pending).length;
export function clearPending() { state.pending = {}; savePending(); }

export function moveItems(ids, folderId) {
  ids.forEach((id) => updateItem(id, { folderId: folderId || null }, { silent: true }));
  emit();
}

export function allTags() {
  const m = new Map();
  for (const it of state.items.values()) for (const t of it.tags || []) m.set(t, (m.get(t) || 0) + 1);
  return m;
}

export function setItemTags(id, tags) {
  const seen = new Set();
  const clean = [];
  for (const t of tags.map((x) => x.trim()).filter(Boolean)) {
    const k = t.toLowerCase();
    if (!seen.has(k)) { seen.add(k); clean.push(t); }
  }
  updateItem(id, { tags: clean });
}

/* ---------------- folders ---------------- */
export const FOLDER_COLORS = ['#E7B94F', '#3CCBBC', '#8C7BFF', '#FF8FA3', '#6FB4FF', '#C9A27A'];

export function createFolder(name, parentId = null, color) {
  const f = { id: uid(), name: name.trim() || 'Folder', parentId: parentId || null, color: color || FOLDER_COLORS[state.folders.size % FOLDER_COLORS.length], locked: false, created: Date.now() };
  state.folders.set(f.id, f);
  idb.put('folders', f).catch(() => {});
  emit();
  return f;
}

export function updateFolder(id, patch) {
  const f = state.folders.get(id);
  if (!f) return;
  Object.assign(f, patch);
  idb.put('folders', f).catch(() => {});
  emit();
}

export function childFolders(parentId) {
  const out = [];
  for (const f of state.folders.values()) if ((f.parentId || null) === (parentId || null)) out.push(f);
  return out.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
}

export function folderPath(id) {
  const out = [];
  let cur = id ? state.folders.get(id) : null;
  let guard = 0;
  while (cur && guard++ < 50) { out.unshift(cur); cur = cur.parentId ? state.folders.get(cur.parentId) : null; }
  return out;
}

export function descendantFolderIds(id) {
  const out = [];
  const walk = (pid) => { for (const f of state.folders.values()) if (f.parentId === pid) { out.push(f.id); walk(f.id); } };
  walk(id);
  return out;
}

export function itemsIn(folderId) {
  const out = [];
  for (const it of state.items.values()) if ((it.folderId || null) === (folderId || null)) out.push(it);
  return out;
}

export function countIn(folderId, deep = true) {
  const ids = new Set([folderId, ...(deep ? descendantFolderIds(folderId) : [])]);
  let n = 0, size = 0;
  for (const it of state.items.values()) if (ids.has(it.folderId)) { n++; size += it.size || 0; }
  return { n, size };
}

export function moveFolder(id, parentId) {
  if (id === parentId) return false;
  if (parentId && descendantFolderIds(id).includes(parentId)) return false;
  updateFolder(id, { parentId: parentId || null });
  return true;
}

export async function deleteFolder(id, { keepItems }) {
  const f = state.folders.get(id);
  if (!f) return;
  if (keepItems) {
    for (const it of itemsIn(id)) updateItem(it.id, { folderId: f.parentId || null }, { silent: true });
    for (const c of childFolders(id)) updateFolder(c.id, { parentId: f.parentId || null });
  } else {
    const ids = [id, ...descendantFolderIds(id)];
    const doomed = [...state.items.values()].filter((it) => ids.includes(it.folderId)).map((it) => it.id);
    if (doomed.length) await removeItems(doomed);
    for (const fid of ids.slice(1)) { state.folders.delete(fid); idb.del('folders', fid).catch(() => {}); }
  }
  state.folders.delete(id);
  idb.del('folders', id).catch(() => {});
  emit();
}

/* ---------------- vault (PIN-hidden folders) ---------------- */
export function lockedFolderSet() {
  const s = new Set();
  for (const f of state.folders.values()) if (f.locked) { s.add(f.id); descendantFolderIds(f.id).forEach((d) => s.add(d)); }
  return s;
}

/** Items visible right now, honouring the vault. */
export function visibleItems() {
  if (state.vaultOpen) return [...state.items.values()];
  const locked = lockedFolderSet();
  if (!locked.size) return [...state.items.values()];
  return [...state.items.values()].filter((it) => !locked.has(it.folderId));
}

export function isFolderHidden(f) {
  if (state.vaultOpen) return false;
  return lockedFolderSet().has(f.id);
}

export function hasVault() {
  for (const f of state.folders.values()) if (f.locked) return true;
  return false;
}

/* ---------------- misc ---------------- */
export async function storageInfo() {
  let used = 0;
  for (const it of state.items.values()) used += it.size || 0;
  let quota = 0, usage = 0, persisted = false;
  try {
    const e = await navigator.storage.estimate();
    quota = e.quota || 0; usage = e.usage || 0;
    persisted = await navigator.storage.persisted();
  } catch { /* not supported */ }
  return { files: used, usage, quota, persisted };
}

export async function requestPersist() {
  try { return await navigator.storage.persist(); } catch { return false; }
}

export async function wipeAll() {
  const db = await open();
  await new Promise((res, rej) => {
    const t = db.transaction(['items', 'blobs', 'folders', 'meta'], 'readwrite');
    ['items', 'blobs', 'folders'].forEach((s) => t.objectStore(s).clear());
    t.objectStore('meta').delete('playlists'); t.objectStore('meta').delete('pending');
    t.oncomplete = res; t.onerror = () => rej(t.error);
  });
  state.items.clear(); state.folders.clear(); state.playlists = []; state.pending = {};
  emit();
}
