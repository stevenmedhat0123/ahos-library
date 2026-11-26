// What the owner sends to everybody: notifications that land in the bell the next time the app is online.
// A member's phone asks the access server "anything new since…?" when the app opens, when it comes back to the screen,
// and every few minutes while it stays open. Nothing is asked of the owner's own phone (he writes the messages).
import { gateEnabled, isOwner, userApi, onAccess } from './auth.js';
import { addInbox } from './bell.js';
import { sfx } from './sound.js';

const K = 'ahos.feedSince';
const WEEK = 7 * 86400000;
const FRESH = 10 * 60 * 1000;        // a message older than this arrives silently (the phone was just off for a while)
const EVERY = 5 * 60 * 1000;
let busy = false, timer = 0, started = false;

const getSince = () => { try { return Number(localStorage.getItem(K)) || 0; } catch { return 0; } };
const setSince = (v) => { try { localStorage.setItem(K, String(v)); } catch { /* storage blocked */ } };

/** Asks the server for new notifications and puts them in the bell. Returns how many arrived. */
export async function syncFeed() {
  if (busy || !gateEnabled()) return 0;
  busy = true;
  try {
    let isOwnerNow = false; try { isOwnerNow = isOwner(); } catch { /* no session yet */ }
    if (isOwnerNow) return 0;
    const since = getSince() || Date.now() - WEEK;      // a brand-new install shows the last week, not the whole history
    const r = await userApi('feed', { since });
    if (!r || !Array.isArray(r.items)) return 0;
    let added = 0, loud = false, newest = since;
    for (const m of r.items.slice().reverse()) {        // oldest first, so the newest ends up on top of the bell
      newest = Math.max(newest, Number(m.time) || 0);
      if (addInbox({ id: 'a:' + m.id, title: m.title, text: m.text, time: m.time })) {
        added++;
        if (m.sound && r.now - m.time < FRESH) loud = true;
      }
    }
    if (newest > since) setSince(newest); else if (!getSince()) setSince(r.now || Date.now());
    if (loud) sfx('notify');
    return added;
  } finally { busy = false; }
}

/** Starts the checking (once). */
export function startFeed() {
  if (started) return;
  started = true;
  const tick = () => { if (!document.hidden) syncFeed(); };
  setTimeout(tick, 1800);
  timer = setInterval(tick, EVERY);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) setTimeout(tick, 400); });
  onAccess((a) => { if (a.ok) setTimeout(tick, 600); });   // signed in just now
}
export const stopFeed = () => { clearInterval(timer); started = false; };
