// The shape gallery sheet: every figure drawn by geoshapes.js, shown as a small picture made from the very same drawing code.
import { h } from '../util.js';
import { t } from '../i18n.js';
import { openSheet } from '../ui.js';
import { geoItems, GEO_GROUPS } from './geoshapes.js';

const num = (v) => Math.round(v * 10) / 10;
/** An inline <svg> picture of a gallery shape (no text labels: too small to read). */
export function geoThumb(kind, w = 64, hgt = 46) {
  const pad = 5, a = [pad, pad], b = [w - pad, hgt - pad];
  const items = geoItems(kind, a, b, { pos: 'far', rays: true });
  const d = (pts, closed) => { let s = ''; for (let i = 0; i < pts.length; i += 2) s += (i ? 'L' : 'M') + num(pts[i]) + ' ' + num(pts[i + 1]); return s + (closed ? 'Z' : ''); };
  const out = [];
  for (const it of items) {
    const col = it.c || 'currentColor', sw = Math.max(0.7, 1.6 * (it.k || 1)), dash = it.d ? ' stroke-dasharray="3 2.4"' : '';
    if (it.t === 'poly') out.push(`<path d="${d(it.pts, it.closed)}" fill="none" stroke="${col}" stroke-width="${sw}" stroke-linejoin="round" stroke-linecap="round"${dash}/>`);
    else if (it.t === 'line' || it.t === 'arrow') {
      out.push(`<path d="M${num(it.a[0])} ${num(it.a[1])}L${num(it.b[0])} ${num(it.b[1])}" fill="none" stroke="${col}" stroke-width="${sw}" stroke-linecap="round"${dash}/>`);
      if (it.t === 'arrow') {
        const ang = Math.atan2(it.b[1] - it.a[1], it.b[0] - it.a[0]), L = 4.5;
        out.push(`<path d="M${num(it.b[0] - L * Math.cos(ang - 0.5))} ${num(it.b[1] - L * Math.sin(ang - 0.5))}L${num(it.b[0])} ${num(it.b[1])}L${num(it.b[0] - L * Math.cos(ang + 0.5))} ${num(it.b[1] - L * Math.sin(ang + 0.5))}" fill="none" stroke="${col}" stroke-width="${sw}" stroke-linecap="round"/>`);
      }
    }
  }
  return `<svg viewBox="0 0 ${w} ${hgt}" width="${w}" height="${hgt}" aria-hidden="true">${out.join('')}</svg>`;
}

/** Opens the gallery; onPick(kind) is called with the chosen shape. */
export function geoGallery({ current, onPick }) {
  const S = openSheet({ title: t('bd_gMore'), tall: true, className: 'bd-gal' });
  for (const [group, kinds] of GEO_GROUPS) {
    S.body.append(h('div', { class: 'bd-lab' }, t('bd_gg_' + group)),
      h('div', { class: 'bd-gtiles' }, ...kinds.map((k) => h('button', { class: 'bd-gt' + (k === current ? ' on' : ''), 'aria-label': t('bd_g_' + k), dataset: { geo: k }, onClick: () => { onPick(k); S.close(); } },
        h('span', { class: 'bd-gth', html: geoThumb(k) }), h('span', { class: 'bd-gtn' }, t('bd_g_' + k))))));
  }
  return S;
}
