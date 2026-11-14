// Files handed to the app by other apps: "Share" -> AHOS Library, or "Open with" -> AHOS Library (Android).
// The native part (AhosShare) only reports what arrived; each file is read from its content address while it is imported.
import { t } from './i18n.js';
import { toast } from './ui.js';
import { extOf } from './util.js';
import { importFiles } from './import.js';
import { shareAvailable, takeShared, onShared } from './native.js';
import { nativeFile } from './folderadd.js';
import { whenGranted } from './views/gate.js';
import { openItem } from './viewers/index.js';

const MIME_EXT = {
  'video/mp4': 'mp4', 'video/x-matroska': 'mkv', 'video/webm': 'webm', 'video/3gpp': '3gp', 'video/quicktime': 'mov',
  'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aac': 'aac', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/flac': 'flac', 'audio/opus': 'opus',
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
  'application/pdf': 'pdf', 'application/epub+zip': 'epub', 'text/plain': 'txt',
};
/** Some apps share a file without an extension in its name: the type they declare gives it one. */
export const nameWithExt = (name, mime) => (extOf(name) || !MIME_EXT[mime || ''] ? name : `${name}.${MIME_EXT[mime]}`);

function textFile(text) {
  const first = text.trim().split(/\r?\n/)[0].replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 40);
  return new File([text], `${first || t('sh_text')}.txt`, { type: 'text/plain' });
}

let busy = false, again = false;

async function pull(go) {
  if (busy) { again = true; return; }
  busy = true;
  try {
    do {
      again = false;
      let p = null;
      try { p = await takeShared(); } catch (e) { console.warn('shared', e); }
      const entries = (p && p.items) || [];
      if (!entries.length && !(p && p.text)) continue;
      const files = entries.map((e) => nativeFile({ u: e.u, n: nameWithExt(e.n || 'file', e.m), s: e.s, m: e.m, d: Date.now(), p: '' }, ''));
      if (!files.length) files.push(textFile(p.text));
      const r = await importFiles(files, null);
      if (!r.ids.length) continue;
      if (r.ids.length === 1) {
        if (!r.ok && r.skipped) toast(t('sh_already'));
        await openItem(r.ids[0], []);
      } else go?.('library');
    } while (again);
  } finally { busy = false; }
}

/** Starts listening. go(route) is used to show the library after several files arrive. */
export function startIntake({ go } = {}) {
  if (!shareAvailable()) return;
  const run = () => whenGranted(() => { pull(go).catch((e) => console.warn('shared', e)); });
  onShared(run);
  run();
}
