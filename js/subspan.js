// How much of the current subscription has passed – for the ring on the Subscription card.
// The server only tells the app when a subscription ENDS, so the app remembers when it saw it BEGIN:
//   • a first code / a new code after the old one ran out  → the span starts now
//   • a code that arrives while one is still running (or the owner extends / shortens it) → same start, new end
//   • a subscription this phone has never seen before (an account that was already running when this version arrived,
//     or a new phone) → the start is guessed from the usual lengths (a week, a month, 2, 3, 6 months, a year…)
const KEY = 'ahos.subspan';
const DAY = 86400000;
const USUAL = [7, 30, 60, 90, 180, 365]; // days
const FOREVER_MS = Date.UTC(2900, 0, 1);

const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } };
const write = (v) => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* storage unavailable */ } };

/** When a subscription that is already running and ends at `end` most likely began. */
export function guessStart(now, end) {
  const left = (end - now) / DAY;
  if (!(left > 0)) return now;
  const total = USUAL.find((d) => d >= left) || Math.ceil(left / 365) * 365;
  return Math.min(now, end - total * DAY);
}

/** Records what the session says now. Call whenever the signed-in member's end date is read. */
export function track(name, end, now) {
  end = Number(end) || 0;
  let rec = read();
  if (rec && rec.n !== name) rec = null;
  if (rec && rec.end === end) return rec;
  let start;
  if (!end) start = now;                       // nothing bought yet
  else if (!rec) start = guessStart(now, end); // never seen before
  else if (rec.end > now) start = rec.start;   // still running: extended (or cut)
  else start = now;                            // it had run out: a new one begins
  if (end && start >= end) start = end - DAY;
  rec = { n: name, start, end };
  write(rec);
  return rec;
}

/** The part of the subscription that has passed, 0…1 (0 for "forever" and for nothing bought). */
export function elapsed(name, end, now) {
  end = Number(end) || 0;
  if (!end || end >= FOREVER_MS) return 0;
  const rec = track(name, end, now);
  const span = rec.end - rec.start;
  if (!(span > 0)) return 0;
  return Math.max(0, Math.min(1, (now - rec.start) / span));
}
