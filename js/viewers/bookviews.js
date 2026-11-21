// The views of an open book: the same book seen from different places, each with its own surface / light behind it.
// A view is only a name here; its camera angle and scene are CSS (.bv-<id> in app.css), so the picker's little previews and the real book share them.
import { h } from '../util.js';
import { t } from '../i18n.js';
import { openSheet } from '../ui.js';

export const VIEWS = ['classic', 'desk', 'angled', 'side', 'above', 'float', 'spot'];
export const validView = (v) => (VIEWS.includes(v) ? v : 'classic');

/** The picker: a grid of small scenes, each with a tilted two-page book. */
export function viewSheet({ current, onPick }) {
  const S = openSheet({ title: t('bv_title') });
  const cur = validView(current);
  S.body.append(
    h('div', { class: 'bv-grid' }, VIEWS.map((id) => h('button', { type: 'button', class: 'bv-tile' + (id === cur ? ' on' : ''), onClick: () => { onPick(id); S.close(); } },
      h('div', { class: 'bv-mini bv-' + id }, h('div', { class: 'bv-cam' }, h('div', { class: 'bv-bk' }, h('i'), h('i')))),
      h('span', null, t('bv_' + id))))),
    h('p', { class: 'bv-note' }, t('bv_hint')));
  return S;
}
