// Importing files into the library (file picker, folder picker, drag & drop, backup restore).
import { uid, kindOf, extOf, stripExt, readText, toVtt, fmtBytes } from './util.js';
import { state, addItem, updateItem, createFolder, childFolders, pendKey, peekPending, consumePending, playlistByName, createPlaylist, addToPlaylist } from './store.js';
import { analyze } from './covers.js';
import { progressCard, toast } from './ui.js';
import { t } from './i18n.js';

export function pickFiles({ accept = '', multiple = true, directory = false } = {}) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = multiple;
    if (accept) input.accept = accept;
    if (directory) { input.setAttribute('webkitdirectory', ''); input.setAttribute('directory', ''); }
    input.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
    document.body.append(input);
    const done = (files) => { input.remove(); resolve(files); };
    input.addEventListener('change', () => done(Array.from(input.files || [])));
    input.addEventListener('cancel', () => done([]));
    input.click();
  });
}

/** Creates (or reuses) the folder chain for a path like ["Course","Week 1"]. */
export function ensureFolderPath(parts, rootId, cache = new Map()) {
  let parent = rootId || null;
  let key = '';
  for (const name of parts) {
    key += '/' + name;
    if (!cache.has(key)) {
      const existing = childFolders(parent).find((f) => f.name === name);
      cache.set(key, (existing || createFolder(name, parent)).id);
    }
    parent = cache.get(key);
  }
  return parent;
}

const SUB_EXT = new Set(['srt', 'vtt']);
const dirOf = (f) => { const r = f.webkitRelativePath; return r && r.includes('/') ? r.slice(0, r.lastIndexOf('/')) : ''; };
const SEP = /^[\s._\-]/;

/** Subtitle "movie.ar.srt" belongs to video "movie.mp4". Returns the language/label or null if it doesn't match. */
function subMatch(subBase, vidBase) {
  const a = subBase.toLowerCase(), b = vidBase.toLowerCase();
  if (a === b) return subBase;
  if (a.startsWith(b) && SEP.test(a.slice(b.length))) return subBase.slice(vidBase.length).replace(/^[\s._\-]+/, '') || subBase;
  return null;
}

async function loadSub(f, label) {
  const text = toVtt(await readText(f));
  return { name: label || stripExt(f.name), vtt: text };
}

export function applyPending(item, pend) {
  if (Array.isArray(pend.tags) && pend.tags.length) item.tags = [...new Set([...(item.tags || []), ...pend.tags])];
  if (pend.fav) item.fav = true;
  if (pend.progress) item.progress = pend.progress;
  if (Array.isArray(pend.marks) && pend.marks.length) item.marks = pend.marks;
  if (Array.isArray(pend.subs) && pend.subs.length) item.subs = pend.subs;
  if (pend.added) item.added = pend.added;
  if (pend.opened) item.opened = pend.opened;
}

export function joinPlaylists(itemId, names) {
  for (const n of names || []) {
    const p = playlistByName(n) || createPlaylist(n);
    addToPlaylist(p.id, [itemId]);
  }
}

/**
 * files: File[]; folderId: destination folder or null.
 * opts.quiet: no progress card / toast (used by restore); opts.card: reuse a progress card.
 */
export async function importFiles(files, folderId = null, opts = {}) {
  files = files.filter((f) => f && f.size >= 0);
  if (!files.length) return { ok: 0, skipped: 0, failed: 0, bytes: 0 };
  const quiet = !!opts.quiet;
  const card = quiet ? null : progressCard(t('importing'));
  let ok = 0, skipped = 0, failed = 0, subsAttached = 0, bytes = 0;
  const folderCache = new Map();

  // subtitles that sit next to a video are attached to it instead of becoming library items
  const subFiles = opts.noSubs ? [] : files.filter((f) => SUB_EXT.has(extOf(f.name)));
  const media = opts.noSubs ? files : files.filter((f) => !SUB_EXT.has(extOf(f.name)));
  const made = []; // {file, id}

  for (let i = 0; i < media.length; i++) {
    const f = media[i];
    card?.update(`${i + 1} / ${media.length}  ·  ${f.name}`, i / media.length);
    const key = pendKey(f.name, f.size);
    const pend = peekPending(key);

    let target = folderId || null;
    const rel = f.webkitRelativePath;
    if (rel && rel.includes('/')) target = ensureFolderPath(rel.split('/').slice(0, -1), folderId, folderCache);
    else if (pend && Array.isArray(pend.path) && pend.path.length && !folderId) target = ensureFolderPath(pend.path, null, folderCache);

    const dup = [...state.items.values()].some((x) => x.name === f.name && x.size === f.size && (x.folderId || null) === target);
    if (dup) { skipped++; continue; }

    const kind = kindOf(f), ext = extOf(f.name);
    const id = uid();
    const item = {
      id, name: f.name, kind, ext, mime: f.type || '', size: f.size,
      folderId: target, tags: [], fav: false, added: Date.now() + i, opened: 0, progress: null, thumb: null, meta: {},
    };
    if (pend) applyPending(item, pend);
    try {
      await addItem(item, f);
      ok++; bytes += f.size;
      made.push({ file: f, id });
      if (pend) { joinPlaylists(id, pend.pl); consumePending(key); }
    } catch (e) {
      failed++;
      console.warn('import failed', f.name, e);
      if (e && e.name === 'QuotaExceededError') { if (!quiet) toast(t('storageFull')); break; }
      continue;
    }
    const { thumb, meta } = await analyze(f, kind, ext);
    updateItem(id, { thumb, meta: { ...(state.items.get(id)?.meta || {}), ...(meta || {}) } }, { card: true });
  }

  // attach subtitle files to their videos; the ones without a video are imported as plain files
  const leftovers = [];
  for (const sf of subFiles) {
    const base = stripExt(sf.name);
    let video = null, label = null;
    const sameDir = made.filter((m) => dirOf(m.file) === dirOf(sf));
    for (const m of sameDir) {
      if (state.items.get(m.id)?.kind !== 'video') continue;
      const lb = subMatch(base, stripExt(m.file.name));
      if (lb != null) { video = state.items.get(m.id); label = lb; break; }
    }
    if (!video) {
      const dest = folderId || null;
      const cands = [...state.items.values()].filter((it) => it.kind === 'video' && subMatch(base, stripExt(it.name)) != null);
      const pick = cands.find((it) => (it.folderId || null) === dest) || (cands.length === 1 ? cands[0] : null);
      if (pick) { video = pick; label = subMatch(base, stripExt(pick.name)); }
    }
    if (!video) { leftovers.push(sf); continue; }
    try {
      const entry = await loadSub(sf, label);
      const have = (video.subs || []).some((x) => x.name === entry.name);
      if (!have) { updateItem(video.id, { subs: [...(video.subs || []), entry] }); subsAttached++; }
    } catch (e) { console.warn('subtitle failed', sf.name, e); leftovers.push(sf); }
  }
  if (leftovers.length) {
    const r = await importFiles(leftovers, folderId, { quiet: true, noSubs: true });
    ok += r.ok; skipped += r.skipped; failed += r.failed; bytes += r.bytes;
  }

  card?.update(t('done'), 1);
  if (card) setTimeout(() => card.done(), 450);
  if (!quiet) {
    const parts = [];
    if (ok) parts.push(t('importedN', { n: ok }));
    if (subsAttached) parts.push(t('subsAttachedN', { n: subsAttached }));
    if (skipped) parts.push(t('skippedN', { n: skipped }));
    if (failed) parts.push(t('failedN', { n: failed }));
    toast(parts.join(' · ') || t('nothingImported'));
    if (bytes > 300 * 1024 * 1024) setTimeout(() => toast(t('originalsStay', { size: fmtBytes(bytes) }), { ms: 7000 }), 3200);
  }
  return { ok, skipped, failed, bytes };
}
