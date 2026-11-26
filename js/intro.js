// The little opening scene of a section, like the logo when a game starts on a console: the section's own picture zooms in on a soft glow,
// its name rises under it, a chime plays, and it all fades away in about a second. A tap skips it. Settings → Home & sections can turn it off
// (it also stays off when "Moving pictures" is off or the device asks for reduced motion).
import { h } from './util.js';
import { t, lang } from './i18n.js';
import { artFor } from './hubart.js';
import { sfx } from './sound.js';
import { state } from './store.js';

let cur = null;
const rnd = (seed) => { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let x = a; x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; }; };

export const introWanted = () => state.settings.sectionIntro !== false && state.settings.hubMotion !== false && !(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);

/** How long the opening picture stays (Settings, 1 – 5 s; a tap ends it sooner). */
export const introMs = () => { const v = Number(state.settings.introSec); return Math.round((Number.isFinite(v) ? Math.min(5, Math.max(1, v)) : 1) * 1000) + 50; };

export function stopIntro() { if (cur) { cur.remove(); cur = null; } }

export function playIntro(def) {
  stopIntro();
  if (!def || !introWanted()) return null;
  const r = rnd(def.id.length * 977 + def.id.charCodeAt(0));
  const sparks = Array.from({ length: 12 }, (_, i) => h('i', { class: 'in-sp', style: { '--x': Math.round(r() * 100) + '%', '--y': Math.round(10 + r() * 80) + '%', '--s': (6 + r() * 12).toFixed(1) + 'px', '--d': (0.12 + r() * 0.5).toFixed(2) + 's' } }));
  const words = String(t('sec_' + def.id)).split(' ');
  const el = h('div', { class: 'sec-intro', dataset: { sec: def.id }, style: { '--g1': def.g[0], '--g2': def.g[1] }, 'aria-hidden': 'true' },
    h('i', { class: 'in-glow' }), h('i', { class: 'in-halo' }), ...sparks,
    h('div', { class: 'in-art hub-art-in in', html: artFor(def.id) }),
    h('div', { class: 'in-title', dir: lang() === 'ar' ? 'rtl' : 'ltr' }, words.map((w, i) => h('span', { style: { '--i': i } }, w))),
    h('div', { class: 'in-sub' }, t('sec_' + def.id + '_s')));
  let done = false;
  const end = () => { if (done) return; done = true; el.classList.add('bye'); setTimeout(() => { el.remove(); if (cur === el) cur = null; }, 260); };
  el.addEventListener('pointerdown', end);
  document.body.append(el);
  cur = el;
  sfx('intro');
  setTimeout(end, introMs());
  return el;
}
