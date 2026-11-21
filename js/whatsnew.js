// "What's new" after an update, and the one-time question about notifications.
import { getAppInfo } from './updater.js';
import { lang, t } from './i18n.js';
import { state } from './store.js';
import { openWhatsNew } from './views/update.js';
import { playbackAvailable, notificationState, askNotifyPermission } from './native.js';
import { confirmDialog } from './ui.js';

const SEEN = 'ahos.seenVer', ASKED = 'ahos.notifAsked';
const get = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const put = (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };

/** The list for the user's language from update.json (written at build time from release.json). */
export function whatsNewItems() {
  const w = getAppInfo().whatsNew;
  if (!w) return [];
  const list = w[lang()] || w.en || [];
  return Array.isArray(list) ? list.filter((x) => typeof x === 'string' && x.trim()) : [];
}

/**
 * Shows the list once after the app version changed. A brand-new install sees nothing (there is nothing "new" to it):
 * `wasInstalled` says whether this phone already had data from an older version before this launch.
 */
export function maybeShowWhatsNew(wasInstalled) {
  const ver = String(getAppInfo().version || '');
  if (!ver) return false;
  const seen = get(SEEN);
  if (seen === ver) return false;
  put(SEEN, ver);
  if (seen === null && !wasInstalled && state.items.size === 0) return false;
  const items = whatsNewItems();
  if (!items.length) return false;
  openWhatsNew(items, ver);
  return true;
}

/** Android 13+ needs a yes before notifications show; ask once, in plain words first. */
export async function askNotificationsOnce() {
  if (!playbackAvailable() || get(ASKED)) return;
  const st = await notificationState();
  if (!st || !st.needsAsk) { put(ASKED, '1'); return; }
  put(ASKED, '1');
  if (await confirmDialog({ title: t('notifAskTitle'), message: t('notifAskMsg'), ok: t('allow') })) askNotifyPermission();
}
