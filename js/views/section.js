// The page of a section opened from the Hub: a header with the way back, then whatever the section draws (or a calm placeholder
// while its page is loading or has not been written yet).
import { h } from '../util.js';
import { ic } from '../icons.js';
import { t } from '../i18n.js';
import { artFor } from '../hubart.js';
import { sfx } from '../sound.js';

function placeholder(def) {
  return h('div', { class: 'sec-soon' },
    h('div', { class: 'hub-art-in in sec-art', style: { '--g1': def.g[0], '--g2': def.g[1] }, html: artFor(def.id) }),
    h('h2', null, t('sec_' + def.id)),
    h('p', null, t('sec_' + def.id + '_s')),
    h('p', { class: 'sec-soon-note' }, t('hub_soon')));
}

export function renderSectionPage(ctx, def) {
  const root = h('div', { class: 'screen sec-page enter', dataset: { sec: def.id }, style: { '--g1': def.g[0], '--g2': def.g[1] } });
  const body = h('div', { class: 'sec-body' });
  const nested = ctx.sectionParent && ctx.sectionParent();          // opened from inside another section (a media page inside the merged Player)
  const back = h('button', { class: 'icon-btn', type: 'button', 'aria-label': nested ? t('back') : t('hub_back'), onClick: () => { sfx('back'); ctx.sectionBack(); } }, h('span', { class: 'flip-rtl', html: ic('back') }));
  // inside another section the arrow goes one step back, so a second button takes you straight to the Hub
  const hubBtn = nested ? h('div', { class: 'top-actions' }, h('button', { class: 'icon-btn hub-back', type: 'button', 'aria-label': t('hub_back'), onClick: () => { sfx('back'); ctx.goHub(); }, html: ic('hub') })) : null;
  root.append(h('header', { class: 'top sec-top' }, back, h('span', { class: 'sec-badge', html: ic(def.icon) }), h('h1', { class: 'top-title' }, t('sec_' + def.id)), hubBtn), body);
  body.append(placeholder(def));
  if (def.page) {
    Promise.resolve().then(() => def.page()).then((fn) => fn(ctx, def)).then((el) => { if (el && root.isConnected !== false) body.replaceChildren(el); })
      .catch((e) => { console.warn('section page', def.id, e); });
  }
  return root;
}
