// The Calculator section: tabs along the top (Scientific, Base-N, Equations, Graph, Converter…) – each pane is loaded the first time it is
// opened and then kept alive, so switching back finds the calculation where it was left.
import { h } from '../util.js';
import { t } from '../i18n.js';
import { loadCss } from '../lazycss.js';
import { sfx } from '../sound.js';
import { applyPrefs, loadPrefs } from '../calc/prefs.js';

const TABS = [
  { id: 'sci', k: 'calc_t_sci', load: () => import('../calc/sci.js').then((m) => m.sciPane) },
  { id: 'base', k: 'calc_t_base', load: () => import('../calc/basepane.js').then((m) => m.basePane) },
  { id: 'eq', k: 'calc_t_eq', load: () => import('../calc/eqnpane.js').then((m) => m.eqnPane) },
  { id: 'stat', k: 'calc_t_stat', load: () => import('../calc/statpane.js').then((m) => m.statPane) },
  { id: 'mat', k: 'calc_t_mat', load: () => import('../calc/mvpane.js').then((m) => m.matPane) },
  { id: 'vec', k: 'calc_t_vec', load: () => import('../calc/mvpane.js').then((m) => m.vecPane) },
  { id: 'table', k: 'calc_t_table', load: () => import('../calc/tablepane.js').then((m) => m.tablePane) },
  { id: 'graph', k: 'calc_t_graph', load: () => import('../calc/graphpane.js').then((m) => m.graphPane) },
  { id: 'conv', k: 'calc_t_conv', load: () => import('../calc/convpane.js').then((m) => m.convPane) },
];

export async function renderCalc(ctx, opts = {}) {
  await loadCss('css/calc.css');
  const root = h('div', { class: 'calc', tabindex: '-1' });
  const panes = new Map();
  const host = h('div', { class: 'calc-pane' });
  let cur = null;
  const bar = h('div', { class: 'calc-tabs', role: 'tablist', hidden: TABS.length < 2 }, TABS.map((tb) => h('button', { class: 'calc-tab', type: 'button', role: 'tab', dataset: { id: tb.id }, onClick: () => show(tb.id) }, t(tb.k))));
  root.append(bar, host);
  applyPrefs(root);
  const onUi = (e) => { if (!root.isConnected) { removeEventListener('ahos-calc-ui', onUi); return; } applyPrefs(root, (e && e.detail) || loadPrefs()); };
  addEventListener('ahos-calc-ui', onUi);
  const hostApi = { go: (id) => show(id), has: (id) => TABS.some((x) => x.id === id) };

  async function show(id, quiet) {
    const tb = TABS.find((x) => x.id === id) || TABS[0];
    if (cur === tb.id) return;
    if (!quiet) sfx('tab');
    cur = tb.id;
    [...bar.children].forEach((b) => { const on = b.dataset.id === tb.id; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); });
    let p = panes.get(tb.id);
    if (!p) {
      const make = await tb.load();
      p = make(ctx, hostApi);
      panes.set(tb.id, p);
      host.append(p.el);
    }
    if (cur !== tb.id) return;
    panes.forEach((q, k) => q.el.classList.toggle('hid', k !== tb.id));
    p.refit && requestAnimationFrame(() => p.refit());
  }

  const onKey = (e) => {
    if (!root.isConnected) { removeEventListener('keydown', onKey, true); return; }
    if (document.querySelector('.layer')) return;                       // a sheet is open
    if (opts.keys && !opts.keys(e)) return;                             // inside the Board: only while its window has the focus
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    const p = panes.get(cur);
    if (p && p.onKey) p.onKey(e);
  };
  addEventListener('keydown', onKey, true);

  await show('sci', true);
  return root;
}
