// Backup & restore.
//  - Organisation only (.json): folders, tags, favourites, progress, bookmarks, subtitles, playlists, settings. Tiny.
//  - Full (.zip): the same manifest plus the original files.
// Restoring never overwrites the current library: folders are merged by name, files are matched by name + size,
// and organisation data for files that aren't here yet waits ("pending") until the file is imported.
import { state, createFolder, childFolders, updateFolder, updateItem, setSetting, addPending, pendKey, pendingCount, clearPending, createPlaylist, playlistByName, setPlaylistIds, getBlob } from './store.js';
import { fmtBytes } from './util.js';
import { loadJSZip } from './epub-core.js';
import { exportBlob } from './native.js';
import { importFiles, pickFiles, applyPending, joinPlaylists } from './import.js';
import { progressCard, toast, confirmDialog } from './ui.js';
import { t } from './i18n.js';

const FORMAT = 'ahos-library-backup';
const SETTING_KEYS = ['lang', 'theme', 'skin', 'accent', 'fx', 'playBtn', 'bg', 'view', 'sort', 'playMode', 'repeatN', 'keepAwake', 'bgAudio', 'autoPip', 'openMuted', 'subSize', 'subColor', 'subBg', 'reader', 'pdfNight', 'channel'];
const BIG = 700 * 1024 * 1024;

const stamp = () => new Date().toISOString().slice(0, 10);

function manifest(withFiles) {
  const items = [...state.items.values()].map((it) => ({
    id: it.id, name: it.name, size: it.size, kind: it.kind, mime: it.mime || '', folderId: it.folderId || null,
    tags: it.tags || [], fav: !!it.fav, added: it.added || 0, opened: it.opened || 0,
    progress: it.progress || null, marks: it.marks || [], subs: it.subs || [],
  }));
  const settings = {};
  for (const k of SETTING_KEYS) if (state.settings[k] !== undefined) settings[k] = state.settings[k];
  return {
    format: FORMAT, version: 1, created: Date.now(), withFiles,
    folders: [...state.folders.values()].map((f) => ({ id: f.id, name: f.name, parentId: f.parentId || null, color: f.color, locked: !!f.locked, created: f.created || 0 })),
    items,
    playlists: state.playlists.map((p) => ({ name: p.name, ids: p.ids })),
    settings,
    pin: state.settings.pinHash ? { hash: state.settings.pinHash, salt: state.settings.pinSalt } : null,
  };
}

export function totalBytes() {
  let n = 0;
  for (const it of state.items.values()) n += it.size || 0;
  return n;
}

export async function createBackup({ withFiles }) {
  if (!state.items.size && !state.folders.size) { toast(t('backupEmpty')); return; }
  const total = totalBytes();
  if (withFiles && total > BIG) {
    const go = await confirmDialog({ title: t('backupFull'), message: t('backupBig', { size: fmtBytes(total) }), ok: t('proceed') });
    if (!go) return;
  }
  const card = progressCard(t('backupWorking'));
  try {
    const man = manifest(withFiles);
    let blob, name;
    if (!withFiles) {
      blob = new Blob([JSON.stringify(man)], { type: 'application/json' });
      name = `AHOS-organization-${stamp()}.json`;
    } else {
      const JSZip = await loadJSZip();
      const zip = new JSZip();
      zip.file('manifest.json', JSON.stringify(man));
      let i = 0;
      for (const it of state.items.values()) {
        card.update(`${++i} / ${state.items.size}  ·  ${it.name}`, (i / state.items.size) * 0.6);
        const b = await getBlob(it.id);
        if (b) zip.file('files/' + it.id, b, { binary: true });
      }
      blob = await zip.generateAsync({ type: 'blob', compression: 'STORE', streamFiles: true }, (m) => card.update(t('backupWorking'), 0.6 + (m.percent / 100) * 0.4));
      name = `AHOS-backup-${stamp()}.zip`;
    }
    card.update(t('backupSharing'), 1);
    await exportBlob(name, blob, (f) => card.update(t('backupSharing'), f));
    toast(t('backupMade', { size: fmtBytes(blob.size) }));
  } catch (e) {
    console.error(e);
    toast(t('backupFailed'));
  } finally {
    card.done();
  }
}

/** Finds or creates the folder chain for the backup's folders; returns Map(oldId -> newId). */
function restoreFolders(man) {
  const byId = new Map(man.folders.map((f) => [f.id, f]));
  const map = new Map();
  const resolve = (f, depth = 0) => {
    if (map.has(f.id)) return map.get(f.id);
    if (depth > 40) return null;
    const parentOld = f.parentId ? byId.get(f.parentId) : null;
    const parentNew = parentOld ? resolve(parentOld, depth + 1) : null;
    const existing = childFolders(parentNew).find((x) => x.name === f.name);
    const nf = existing || createFolder(f.name, parentNew, f.color);
    map.set(f.id, nf.id);
    return nf.id;
  };
  man.folders.forEach((f) => resolve(f));
  return map;
}

function pathOf(man, folderId) {
  const byId = new Map(man.folders.map((f) => [f.id, f]));
  const out = [];
  let cur = folderId ? byId.get(folderId) : null;
  let g = 0;
  while (cur && g++ < 40) { out.unshift(cur.name); cur = cur.parentId ? byId.get(cur.parentId) : null; }
  return out;
}

export async function parseBackup(file) {
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  if (head[0] === 0x50 && head[1] === 0x4b) {
    const JSZip = await loadJSZip();
    const zip = await JSZip.loadAsync(file);
    const m = zip.file('manifest.json');
    if (!m) throw new Error('no manifest');
    return { man: JSON.parse(await m.async('string')), zip };
  }
  return { man: JSON.parse(await file.text()), zip: null };
}

export async function restoreBackup(file) {
  const card = progressCard(t('restoreWorking'));
  try {
    const { man, zip } = await parseBackup(file);
    if (man.format !== FORMAT || !Array.isArray(man.items) || !Array.isArray(man.folders)) throw new Error('not an AHOS backup');

    // 1) folders (merged by name)
    card.update(t('restoreFolders'), 0.05);
    const fmap = restoreFolders(man);

    // 2) playlists exist even if empty
    for (const p of man.playlists || []) if (!playlistByName(p.name)) createPlaylist(p.name);
    const plNames = new Map(); // old item id -> [playlist names]
    for (const p of man.playlists || []) for (const id of p.ids) { (plNames.get(id) || plNames.set(id, []).get(id)).push(p.name); }

    // 3) organisation data: attach to files already here, queue the rest until their file arrives
    const here = new Map();
    for (const it of state.items.values()) here.set(pendKey(it.name, it.size), it);
    const queue = {};
    let applied = 0;
    for (const bi of man.items) {
      const rec = {
        path: pathOf(man, bi.folderId), tags: bi.tags, fav: bi.fav, progress: bi.progress,
        marks: bi.marks, subs: bi.subs, added: bi.added, opened: bi.opened, pl: plNames.get(bi.id) || [],
      };
      const key = pendKey(bi.name, bi.size);
      const ex = here.get(key);
      if (ex) {
        const patch = {};
        const probe = { tags: ex.tags || [], fav: ex.fav, progress: ex.progress, marks: ex.marks, subs: ex.subs };
        applyPending(probe, { tags: rec.tags, fav: rec.fav, progress: ex.progress ? null : rec.progress, marks: ex.marks?.length ? null : rec.marks, subs: ex.subs?.length ? null : rec.subs });
        Object.assign(patch, probe);
        updateItem(ex.id, patch, { silent: true });
        joinPlaylists(ex.id, rec.pl);
        applied++;
      } else queue[key] = rec;
    }
    addPending(queue);

    // 4) the files themselves (full backups)
    let imported = 0;
    if (zip) {
      const files = [];
      let i = 0;
      for (const bi of man.items) {
        if (!queue[pendKey(bi.name, bi.size)]) continue;
        const entry = zip.file('files/' + bi.id);
        if (!entry) continue;
        card.update(`${++i}  ·  ${bi.name}`, 0.1 + Math.min(0.5, i / Math.max(1, man.items.length) * 0.5));
        const blob = await entry.async('blob');
        files.push(new File([blob], bi.name, { type: bi.mime || blob.type || '' }));
        if (files.length >= 25) { const r = await importFiles(files.splice(0), null, { quiet: true, noSubs: true }); imported += r.ok; }
      }
      if (files.length) { const r = await importFiles(files, null, { quiet: true, noSubs: true }); imported += r.ok; }
    }

    // 5) playlist order, hidden-folder flags, settings
    const idFor = new Map();
    for (const it of state.items.values()) idFor.set(pendKey(it.name, it.size), it.id);
    const oldItem = new Map(man.items.map((x) => [x.id, x]));
    for (const p of man.playlists || []) {
      const local = playlistByName(p.name);
      if (!local) continue;
      const ordered = p.ids.map((id) => { const o = oldItem.get(id); return o ? idFor.get(pendKey(o.name, o.size)) : null; }).filter(Boolean);
      if (ordered.length) setPlaylistIds(local.id, [...ordered, ...local.ids.filter((x) => !ordered.includes(x))]);
    }
    if (man.pin && !state.settings.pinHash) { setSetting('pinHash', man.pin.hash); setSetting('pinSalt', man.pin.salt); }
    if (state.settings.pinHash) {
      for (const bf of man.folders) if (bf.locked) { const nid = fmap.get(bf.id); if (nid) updateFolder(nid, { locked: true }); }
    }
    for (const [k, v] of Object.entries(man.settings || {})) if (SETTING_KEYS.includes(k)) setSetting(k, v);

    card.update(t('done'), 1);
    toast(t('restoreDone', { files: imported, applied, waiting: Object.keys(queue).length - imported }), { ms: 6000 });
    return { imported, applied, waiting: pendingCount() };
  } catch (e) {
    console.error(e);
    toast(t('restoreBad'));
    return null;
  } finally {
    setTimeout(() => card.done(), 400);
  }
}

export async function pickAndRestore() {
  const [file] = await pickFiles({ accept: '.zip,.json,application/zip,application/json', multiple: false });
  if (!file) return null;
  return restoreBackup(file);
}

export { pendingCount, clearPending };
