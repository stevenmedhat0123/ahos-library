// The sections of the app: the tiles on the Hub, in the order the person chose. Later work (comments, AHOS Tube, the owner's pages…)
// plugs in with registerSection(id, { page }) – a section without a page yet shows a calm "being prepared" panel instead of a broken screen.
import { state, setSetting } from './store.js';
import { gateEnabled, isOwner } from './auth.js';
import { SHAPES } from './hubart.js';

/*  id        icon (icons.js)  gradient             go: an existing route     page: loader of the module that draws it     owner: only for the signed-in owner */
export const SECTIONS = [
  { id: 'comments', icon: 'chat', g: ['#FF8A5B', '#FF4F81'] },
  { id: 'alarm', icon: 'alarm', g: ['#FF9F43', '#EE5A6F'], page: () => import('./views/alarm.js').then((m) => m.renderAlarm) },
  { id: 'calc', icon: 'calc', g: ['#22D3EE', '#3B82F6'], page: () => import('./views/calc.js').then((m) => m.renderCalc) },
  // the media: four sections of their own (videos, photos, audio, PDFs & files) – or, when the person merges them in Settings, one "Player" section that holds the four
  { id: 'videos', icon: 'video', g: ['#FF5C7A', '#8B5CF6'], kinds: ['video'], page: () => import('./views/kindsec.js').then((m) => m.renderKindSection) },
  { id: 'photos', icon: 'image', g: ['#4FA8FF', '#22D3EE'], kinds: ['image'], page: () => import('./views/kindsec.js').then((m) => m.renderKindSection) },
  { id: 'audio', icon: 'audio', g: ['#A78BFA', '#EC4899'], kinds: ['audio'], page: () => import('./views/kindsec.js').then((m) => m.renderKindSection) },
  { id: 'docs', icon: 'file', g: ['#FFB84F', '#F97316'], kinds: ['book', 'file'], page: () => import('./views/kindsec.js').then((m) => m.renderKindSection) },
  { id: 'player', icon: 'player', g: ['#7C5CF0', '#FF5C7A'], merged: true, page: () => import('./views/kindsec.js').then((m) => m.renderPlayerSection) },
  { id: 'board', icon: 'bdPen', g: ['#FBBF24', '#F43F5E'], page: () => import('./views/boards.js').then((m) => m.renderBoards) },
  { id: 'note', icon: 'daily', g: ['#A3E635', '#14B8A6'], page: () => import('./views/boards.js').then((m) => m.renderNotes) },
  { id: 'tube', icon: 'tube', g: ['#FF6B6B', '#E11D48'] },
  { id: 'ownComments', icon: 'chat', g: ['#F472B6', '#A855F7'], owner: true },
  { id: 'subs', icon: 'key', g: ['#FCD34D', '#F59E0B'], gate: true, page: () => import('./views/subs.js').then((m) => m.renderSubs) },   // for everybody (when the build has an access server)
  { id: 'recovery', icon: 'recover', g: ['#60A5FA', '#6366F1'], owner: true },
  { id: 'devices', icon: 'devices', g: ['#34D399', '#0EA5E9'], owner: true },
  { id: 'release', icon: 'rocket', g: ['#2DD4BF', '#6366F1'], owner: true, page: () => import('./views/publish.js').then((m) => m.renderPublish) },
  { id: 'settings', icon: 'settings', g: ['#94A3B8', '#475569'], go: 'settings' },   // always the last tile, at the far right end of the row
];

const byId = new Map(SECTIONS.map((s) => [s.id, s]));

/** The four media sections, in the order they appear (inside the merged Player section too). */
export const MEDIA_IDS = ['videos', 'photos', 'audio', 'docs'];
const mediaMerged = () => !!(state.settings && state.settings.playerMerged);
/** Is this section part of the Hub's row right now? (the four media sections, or the one merged "Player" – never both) */
const inRow = (s) => (MEDIA_IDS.includes(s.id) ? !mediaMerged() : s.id === 'player' ? mediaMerged() : true);
export const sectionById = (id) => byId.get(id) || null;

/** A later module gives a section its page (or any other field): registerSection('comments', { page: () => import('./views/comments.js').then(m => m.renderComments) }) */
export function registerSection(id, fields) {
  const s = byId.get(id);
  if (s) Object.assign(s, fields);
  else { const n = { id, icon: 'file', g: ['#94A3B8', '#475569'], ...fields }; SECTIONS.push(n); byId.set(id, n); }
}

const gateNow = () => { try { return gateEnabled(); } catch { return false; } };
const ownerNow = () => { try { return gateEnabled() && isOwner(); } catch { return false; } };

/** Sections to show now: the person's order first (new ones after), the hidden ones left out, owner-only ones only for the owner. */
export function visibleSections() {
  const pref = state.settings.sections || {};
  const order = Array.isArray(pref.order) ? pref.order : [];
  const hidden = new Set(Array.isArray(pref.hidden) ? pref.hidden : []);
  const rank = (s) => { const i = order.indexOf(s.id); return i < 0 ? 1000 + SECTIONS.indexOf(s) : i; };
  const owner = ownerNow();
  // the owner sees every section – one he hid on this phone (or never found) still shows, with a small marker (see isHiddenHere)
  return SECTIONS.filter((s) => inRow(s) && (!s.owner || owner) && (!s.gate || gateNow()) && (owner || !hidden.has(s.id))).sort((a, b) => rank(a) - rank(b));
}

/** True when this section is hidden in the person's own settings (the owner still sees it on the Hub, marked). */
export function isHiddenHere(id) {
  const pref = state.settings.sections || {};
  return Array.isArray(pref.hidden) && pref.hidden.includes(id);
}
export const ownerSeesAll = () => ownerNow();

/** Every section the person can reorder / hide (owner ones only for the owner), in their order, hidden ones included. */
export function manageableSections() {
  const pref = state.settings.sections || {};
  const order = Array.isArray(pref.order) ? pref.order : [];
  const rank = (s) => { const i = order.indexOf(s.id); return i < 0 ? 1000 + SECTIONS.indexOf(s) : i; };
  const owner = ownerNow();
  return SECTIONS.filter((s) => inRow(s) && (!s.owner || owner) && (!s.gate || gateNow())).sort((a, b) => rank(a) - rank(b));
}

/** Swaps a section with the visible one next to it (dir -1 = one place towards the start, +1 = towards the end) and keeps the new order. */
export function moveSection(id, dir) {
  const vis = visibleSections().map((s) => s.id);
  const i = vis.indexOf(id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= vis.length) return false;
  [vis[i], vis[j]] = [vis[j], vis[i]];
  const pref = state.settings.sections || {};
  const all = manageableSections().map((s) => s.id);
  const shown = new Set(vis);
  let k = 0;
  const order = all.map((x) => (shown.has(x) ? vis[k++] : x));      // hidden sections keep their own places between the visible ones
  setSetting('sections', { order, hidden: Array.isArray(pref.hidden) ? pref.hidden : [] });
  return true;
}

/** The outline of a section's tile: the person's own pick for it, else the one shape they chose for all, else the section's own. */
export function shapeFor(id) {
  const st = state.settings;
  const own = st.tileShapes && st.tileShapes[id];
  if (own) return own;
  if (st.tileShape && st.tileShape !== 'mixed') return st.tileShape;
  return SHAPES[id] || 'squircle';
}
