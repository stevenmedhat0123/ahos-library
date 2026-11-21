// AHOS Calc – the Table pane (TABLE mode): f(x) – and optionally g(x) – for x from Start to End in steps of Step.
import { h } from '../util.js';
import { t } from '../i18n.js';
import { toast } from '../ui.js';
import { evaluate, makeCtx, itemsFromText } from './expr.js';
import { compileText } from './fnx.js';
import { loadCalc } from './state.js';
import { fmtNum } from './units.js';

const KEY = 'ahos.calc.table';
const MAX = 100;
const AR = '٠١٢٣٤٥٦٧٨٩';
const latin = (s) => String(s).replace(/[٠-٩]/g, (d) => String(AR.indexOf(d))).replace(/٫/g, '.');

function load() { try { const r = JSON.parse(localStorage.getItem(KEY) || 'null'); if (r && typeof r === 'object') return r; } catch { /* ignore */ } return {}; }

export function tablePane() {
  const st = loadCalc();
  const cx = makeCtx({ ang: (st.setup && st.setup.ang) || 'deg', vars: { ...st.vars } });
  const mem = load();
  const S = { f: typeof mem.f === 'string' ? mem.f : 'x^2', g: typeof mem.g === 'string' ? mem.g : '', a: typeof mem.a === 'string' ? mem.a : '1', b: typeof mem.b === 'string' ? mem.b : '5', s: typeof mem.s === 'string' ? mem.s : '1', two: !!mem.two };
  const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch { /* ignore */ } };
  const num = (txt) => { const v = latin(txt).trim(); if (!v) throw new Error('empty'); if (/^-?\d+(\.\d+)?(e[+-]?\d+)?$/i.test(v)) return Number(v); const r = evaluate(itemsFromText(v.replace(/\*/g, '×').replace(/−/g, '-')), { ...cx, vars: { ...cx.vars } }); if (typeof r.value !== 'number') throw new Error('nan'); return r.value; };

  const field = (key, label, ph) => {
    const el = h('input', { class: 'ce-in cs-fld', type: 'text', inputmode: 'text', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', enterkeyhint: 'done', dir: 'ltr', placeholder: ph, 'aria-label': label });
    el.value = S[key];
    el.addEventListener('input', () => { S[key] = el.value; persist(); paint(); });
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') el.blur(); });
    return el;
  };
  const small = (key, label) => {
    const el = h('input', { class: 'ce-in tb-in', type: 'text', inputmode: 'decimal', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', enterkeyhint: 'done', dir: 'ltr', 'aria-label': label });
    el.value = S[key];
    el.addEventListener('input', () => { S[key] = el.value; persist(); paint(); });
    el.addEventListener('focus', () => el.select());
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') el.blur(); });
    return h('label', { class: 'tb-f' }, h('span', null, label), el);
  };
  const gRow = h('label', { class: 'tb-fn', dir: 'ltr' }, h('b', null, 'g(x) ='), field('g', 'g(x)', '2x + 1'));
  const addG = h('button', { class: 'cs-chip', type: 'button', onClick: () => { S.two = !S.two; persist(); sync(); paint(); } }, '');
  const body = h('div', { class: 'tb-body', dir: 'ltr' });
  const note = h('p', { class: 'ce-hint' });
  const tableBox = h('div', { class: 'tb-tab' });

  function sync() { gRow.hidden = !S.two; addG.textContent = S.two ? t('tb_noG') : t('tb_addG'); }
  const fmt = (v) => (Number.isFinite(v) ? fmtNum(v, false) : t('tb_err'));

  function paint() {
    tableBox.replaceChildren(); note.textContent = ''; note.hidden = true;
    let a, b, s;
    try { a = num(S.a); b = num(S.b); s = num(S.s); } catch { note.textContent = t('calc_err_syntax'); note.hidden = false; return; }
    if (s === 0 || (b - a) * s < 0) { note.textContent = t('tb_badStep'); note.hidden = false; return; }
    const fns = [];
    try { const f = compileText(S.f, { ang: cx.ang, vars: cx.vars }); if (!f) { note.textContent = t('tb_hint'); note.hidden = false; return; } fns.push(['f', f]); } catch { note.textContent = t('calc_err_syntax'); note.hidden = false; return; }
    if (S.two && S.g.trim()) { try { fns.push(['g', compileText(S.g, { ang: cx.ang, vars: cx.vars })]); } catch { note.textContent = t('calc_err_syntax') + ' (g)'; note.hidden = false; return; } }
    const count = Math.floor((b - a) / s + 1e-9) + 1;
    const n = Math.min(count, MAX);
    const head = h('div', { class: 'tb-row tb-head' + (fns.length > 1 ? ' two' : '') }, h('b', null, 'x'), ...fns.map(([k]) => h('b', null, k + '(x)')));
    const frag = [head];
    for (let i = 0; i < n; i++) {
      const x = parseFloat((a + i * s).toPrecision(12));
      const cells = fns.map(([, fn]) => { try { return fmt(fn(x)); } catch { return t('tb_err'); } });
      frag.push(h('div', { class: 'tb-row' + (fns.length > 1 ? ' two' : '') + (i % 2 ? ' odd' : '') }, h('span', null, fmt(x)), ...cells.map((c) => h('span', null, c))));
    }
    tableBox.append(...frag);
    if (count > MAX) { note.textContent = t('tb_cut', { n: MAX }); note.hidden = false; }
  }

  const el = h('div', { class: 'ce tb' },
    h('div', { class: 'ce-form tb-form' },
      h('label', { class: 'tb-fn', dir: 'ltr' }, h('b', null, 'f(x) ='), field('f', 'f(x)', 'x^2 − 3x')), gRow,
      h('div', { class: 'tb-rng', dir: 'ltr' }, small('a', t('tb_start')), small('b', t('tb_end')), small('s', t('tb_step'))),
      h('div', { class: 'ce-tools' }, addG)),
    note, tableBox);
  sync(); paint();
  return { el };
}
