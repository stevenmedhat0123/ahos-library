// Adding many things at once: a whole folder from the phone, or a whole folder / many files from Google Drive.
// On Android the folder is chosen with the system folder picker (the optional native layer "AhosFolder"), which also shows Google Drive
// and any other storage app on the phone, so nothing needs a sign-in here. Files are read one at a time while importing.
// On a computer the browser's own folder picker is used instead.
import { h, kindOf, fmtBytes } from './util.js';
import { t } from './i18n.js';
import { ic } from './icons.js';
import { openSheet, toast, progressCard } from './ui.js';
import { pickFiles, importFiles } from './import.js';
import { folderPickerAvailable, folderPick, folderScan, folderPickFiles, onFolderScan, contentUrl } from './native.js';

const KINDS = ['video', 'image', 'audio', 'book', 'file'];
const MEDIA = new Set(['video', 'image', 'audio', 'book']);
const GENERIC = new Set(['', 'application/octet-stream']);

/** A file the system picker found: looks like a File to the importer, but its bytes are only fetched when it is imported. */
export function nativeFile(e, root) {
  const type = GENERIC.has(e.m || '') ? '' : e.m;
  const rel = [root, e.p, e.n].filter(Boolean).join('/');
  return {
    name: e.n, size: e.s >= 0 ? e.s : 0, type, lastModified: e.d || 0,
    webkitRelativePath: root || e.p ? rel : '',
    __load: async () => {
      const r = await fetch(contentUrl(e.u));
      if (!r.ok) throw new Error('read ' + r.status);
      const b = await r.blob();
      return new File([b], e.n, { type: type || b.type || '', lastModified: e.d || Date.now() });
    },
  };
}

/** How many of each kind, and the total size. */
export function summarize(files) {
  const by = Object.fromEntries(KINDS.map((k) => [k, 0]));
  let bytes = 0;
  for (const f of files) { by[kindOf(f)]++; bytes += f.size > 0 ? f.size : 0; }
  return { by, bytes, total: files.length };
}

async function freeSpace() {
  try { const e = await navigator.storage.estimate(); return e && e.quota ? e.quota - (e.usage || 0) : Infinity; } catch { return Infinity; }
}

/** The "add this folder?" sheet. Resolves with the files to add, or null. */
export async function confirmFolder({ name, files, skipped = 0, truncated = false }) {
  const all = summarize(files);
  const media = files.filter((f) => MEDIA.has(kindOf(f)));
  const mediaSum = summarize(media);
  const free = await freeSpace();
  return new Promise((resolve) => {
    let answer = null;
    const S = openSheet({ title: t('fl_title', { name: name || t('fl_thisFolder') }), onClose: () => resolve(answer) });
    const chips = KINDS.filter((k) => all.by[k]).map((k) => h('span', { class: 'fl-chip k-' + k }, `${t('kind_' + k)} · ${all.by[k]}`));
    const need = all.bytes, tight = need > free * 0.9;
    const pick = (list) => { answer = list; S.close(); };
    S.body.append(...[
      h('div', { class: 'fl-sum' }, h('span', { class: 'fl-ic', html: ic('folder') }), h('div', null, h('b', null, t('fl_count', { n: all.total })), h('small', null, fmtBytes(all.bytes)))),
      h('div', { class: 'fl-chips' }, chips),
      tight ? h('p', { class: 'fl-warn' }, t('fl_space', { need: fmtBytes(need), free: fmtBytes(Math.max(0, free)) })) : null,
      skipped ? h('p', { class: 'fl-note' }, t('fl_virtual', { n: skipped })) : null,
      truncated ? h('p', { class: 'fl-note' }, t('fl_truncated')) : null,
      h('button', { type: 'button', class: 'btn primary lg fl-go', onClick: () => pick(files) }, t('fl_all', { n: all.total })),
      media.length && media.length < files.length ? h('button', { type: 'button', class: 'btn ghost lg fl-go fl-alt', onClick: () => pick(media) }, t('fl_media', { n: media.length, size: fmtBytes(mediaSum.bytes) })) : null,
      h('button', { type: 'button', class: 'btn lg fl-go fl-cancel', onClick: () => S.close() }, t('cancel'))].filter(Boolean));
  });
}

/** Add a whole folder. drive = Android's picker opens on Google Drive first. */
export async function addWholeFolder({ drive = false, folderId = null } = {}) {
  if (!folderPickerAvailable()) {                                     // a computer: the browser's own folder picker
    const files = await pickFiles({ directory: true });
    if (files.length) await importFiles(files, folderId);
    return;
  }
  let pick;
  try { pick = await folderPick(drive); } catch (e) { console.warn('folder pick', e); toast(t('fl_failed')); return; }
  if (!pick || pick.cancelled || !pick.uri) return;
  const card = progressCard(t('fl_scanning'));
  const off = onFolderScan((p) => card.update(t('fl_found', { n: p.files || 0 }), null));
  let res;
  try { res = await folderScan(pick.uri); } catch (e) { console.warn('folder scan', e); card.done(); off(); toast(t('fl_failed')); return; }
  card.done(); off();
  const root = (pick.name || '').replace(/[\\/]+/g, ' ').trim() || t('fl_thisFolder');
  const files = (res.files || []).map((e) => nativeFile(e, root));
  if (!files.length) { toast(t('fl_empty')); return; }
  const chosen = await confirmFolder({ name: root, files, skipped: res.skipped || 0, truncated: !!res.truncated });
  if (chosen && chosen.length) await importFiles(chosen, folderId);
}

/** Many files from the system picker (Google Drive first when asked). */
export async function addPickedFiles({ drive = false, folderId = null } = {}) {
  if (!folderPickerAvailable()) return;
  let res;
  try { res = await folderPickFiles(drive); } catch (e) { console.warn('file pick', e); toast(t('fl_failed')); return; }
  if (!res || res.cancelled || !(res.files || []).length) return;
  await importFiles(res.files.map((e) => nativeFile(e, '')), folderId);
}
