// AHOS Calc – the Equations pane: two or three simultaneous linear equations, and quadratic / cubic polynomials (complex roots too).
// Coefficients can be written as expressions (1/2, √3, 2π…); the answer appears as you type, with exact forms when they exist.
import { h } from '../util.js';
import { t } from '../i18n.js';
import { toast } from '../ui.js';
import { evaluate, makeCtx, itemsFromText } from './expr.js';
import { describe, DEFAULT_SETUP, decimalText } from './fmt.js';
import { drawDesc } from './display.js';
import { solveLinear, solvePoly } from './eqn.js';
import { isC } from './core.js';
import { loadCalc } from './state.js';

const TYPES = [
  { id: 'l2', n: 2, k: 'calc_eq_l2' },
  { id: 'l3', n: 3, k: 'calc_eq_l3' },
  { id: 'q', deg: 2, k: 'calc_eq_q' },
  { id: 'c', deg: 3, k: 'calc_eq_c' },
];
const SUB = ['₁', '₂', '₃'];
const VARS = ['x', 'y', 'z'];

export function eqnPane() {
  const st = loadCalc();
  const setup = { ...DEFAULT_SETUP, ...st.setup };
  const cx = makeCtx({ ang: setup.ang, vars: { ...st.vars } });
  let type = TYPES[0];
  const vals = {};                      // typed text per type: vals[typeId] = array of strings
  const out = h('div', { class: 'ce-out', 'aria-live': 'polite' });
  const form = h('div', { class: 'ce-form' });
  const chips = h('div', { class: 'ce-types', role: 'tablist' }, TYPES.map((tp) => h('button', { class: 'ce-chip', type: 'button', dataset: { id: tp.id }, onClick: () => pick(tp) }, t(tp.k))));

  const need = () => (type.n ? type.n * (type.n + 1) : type.deg + 1);
  const store = () => (vals[type.id] = vals[type.id] || Array(need()).fill(''));

  function number(txt) {                  // text → number (an expression is fine); '' counts as 0
    const s = String(txt).trim();
    if (!s) return 0;
    const r = evaluate(itemsFromText(s), { ...cx, vars: { ...cx.vars } });
    if (typeof r.value !== 'number') throw new Error('nan');
    return r.value;
  }

  const input = (idx, ph) => {
    const el = h('input', { class: 'ce-in', type: 'text', inputmode: 'text', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', enterkeyhint: 'next', placeholder: ph || '0', dir: 'ltr', 'aria-label': ph || '' });
    el.value = store()[idx] || '';
    el.addEventListener('input', () => { store()[idx] = el.value; solve(); });
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); const all = [...form.querySelectorAll('.ce-in')]; const i = all.indexOf(el); (all[i + 1] || el).focus(); } });
    el.addEventListener('focus', () => el.select());
    return el;
  };

  function build() {
    form.replaceChildren();
    if (type.n) {
      const n = type.n;
      for (let r = 0; r < n; r++) {
        const row = h('div', { class: 'ce-row', dir: 'ltr' });
        for (let c = 0; c < n; c++) {
          if (c) row.append(h('span', { class: 'ce-op' }, '+'));
          row.append(input(r * (n + 1) + c, 'a' + SUB[r]), h('span', { class: 'ce-var' }, VARS[c]));
        }
        row.append(h('span', { class: 'ce-op' }, '='), input(r * (n + 1) + n, 'k' + SUB[r]));
        form.append(row);
      }
    } else {
      const deg = type.deg;
      const row = h('div', { class: 'ce-row poly', dir: 'ltr' });
      const names = ['a', 'b', 'c', 'd'];
      for (let i = 0; i <= deg; i++) {
        if (i) row.append(h('span', { class: 'ce-op' }, '+'));
        const p = deg - i;
        row.append(input(i, names[i]));
        if (p) row.append(h('span', { class: 'ce-var' }, h('span', null, 'x'), p > 1 ? h('sup', null, String(p)) : null));
      }
      row.append(h('span', { class: 'ce-op' }, '= 0'));
      form.append(row);
    }
  }

  const card = (label, value, extra) => {
    const d = describe(value, setup, {});
    const body = h('button', { class: 'ce-card', type: 'button', dir: 'ltr', title: t('calc_copy'), onClick: async () => { try { await navigator.clipboard.writeText(typeof value === 'number' ? decimalText(value, { ...setup, sep: false }) : ''); toast(t('calc_copied')); } catch { /* ignore */ } } },
      h('b', { class: 'ce-lab' }, label), h('span', { class: 'ce-val' }, drawDesc(d)), extra ? h('small', null, extra) : null);
    return body;
  };
  const note = (k, v) => h('div', { class: 'ce-note', dir: 'ltr' }, h('span', null, t(k)), h('span', null, v));

  function solve() {
    out.replaceChildren();
    const raw = store();
    if (raw.every((s) => !String(s).trim())) { out.append(h('p', { class: 'ce-hint' }, t('calc_eq_hint'))); return; }
    let nums;
    try { nums = raw.map(number); } catch { out.append(h('p', { class: 'ce-bad' }, t('calc_err_syntax'))); return; }
    try {
      if (type.n) {
        const n = type.n;
        const rows = Array.from({ length: n }, (_, r) => nums.slice(r * (n + 1), (r + 1) * (n + 1)));
        const sol = solveLinear(n, rows);
        sol.forEach((v, i) => out.append(card(VARS[i] + ' =', v)));
      } else {
        const roots = solvePoly(nums);
        if (type.deg === 2) {
          const [a, b, c] = nums, D = b * b - 4 * a * c;
          out.append(note('calc_eq_disc', 'Δ = ' + decimalText(D, { ...setup, sep: false }) + (D > 0 ? ' · ' + t('calc_eq_two') : D === 0 ? ' · ' + t('calc_eq_one') : ' · ' + t('calc_eq_cx'))));
        }
        roots.forEach((v, i) => out.append(card((roots.length > 1 ? 'x' + SUB[i] : 'x') + ' =', v)));
        if (type.deg === 2) {
          const [a, b, c] = nums, vx = -b / (2 * a), vy = a * vx * vx + b * vx + c;
          out.append(note('calc_eq_vertex', '(' + decimalText(vx, { ...setup, sep: false }) + ' , ' + decimalText(vy, { ...setup, sep: false }) + ')'));
          if (roots.every((r) => !isC(r)) && roots.length === 2) out.append(note('calc_eq_sum', decimalText(roots[0] + roots[1], { ...setup, sep: false }) + ' · ' + t('calc_eq_prod') + ' ' + decimalText(roots[0] * roots[1], { ...setup, sep: false })));
        }
      }
    } catch (e) {
      out.append(h('p', { class: 'ce-bad' }, e && e.code === 'math' ? t('calc_eq_none') : t('calc_err_' + (e && ['arg', 'syntax'].includes(e.code) ? e.code : 'math'))));
    }
  }

  function pick(tp) {
    type = tp;
    [...chips.children].forEach((c) => { const on = c.dataset.id === tp.id; c.classList.toggle('on', on); c.setAttribute('aria-selected', String(on)); });
    build(); solve();
  }

  const clear = h('button', { class: 'cs-chip', type: 'button', onClick: () => { vals[type.id] = Array(need()).fill(''); build(); solve(); } }, t('calc_eq_clear'));
  const el = h('div', { class: 'ce' }, chips, h('div', { class: 'ce-body' }, form, h('div', { class: 'ce-tools' }, clear), out));
  pick(TYPES[0]);
  return { el };
}
