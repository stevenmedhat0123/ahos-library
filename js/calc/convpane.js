// AHOS Calc – the Converter pane: length, area (with the Egyptian feddan / qirat / sahm), volume, mass, temperature, speed, time, data, energy,
// pressure, power and angle. Type a value (an expression such as 3/4 is fine), pick the units – the answer, and the value in every other unit
// of the category, update as you type.
import { h } from '../util.js';
import { ic } from '../icons.js';
import { t } from '../i18n.js';
import { toast } from '../ui.js';
import { evaluate, makeCtx, itemsFromText } from './expr.js';
import { CATS, catOf, convert, fmtNum } from './units.js';
import { sfx } from '../sound.js';

const KEY = 'ahos.calc.conv';
const AR = '٠١٢٣٤٥٦٧٨٩';
const latin = (s) => String(s).replace(/[٠-٩]/g, (d) => String(AR.indexOf(d))).replace(/٫/g, '.').replace(/[،؛]/g, ',').replace(/٬/g, '');

function load() {
  try { const r = JSON.parse(localStorage.getItem(KEY) || 'null'); if (r && typeof r === 'object') return r; } catch { /* ignore */ }
  return {};
}
function save(o) { try { localStorage.setItem(KEY, JSON.stringify(o)); } catch { /* ignore */ } }

export function convPane() {
  const mem = load();
  let cat = catOf(mem.cat);
  const sel = mem.sel && typeof mem.sel === 'object' ? mem.sel : {};         // per category: [from, to]
  let txt = typeof mem.val === 'string' ? mem.val : '1';
  const pair = () => {
    const p = sel[cat.id];
    const ok = (id) => cat.units.some((u) => u[0] === id);
    if (Array.isArray(p) && ok(p[0]) && ok(p[1])) return p;
    const d = [cat.units[0][0], (cat.units[1] || cat.units[0])[0]];
    sel[cat.id] = d;
    return d;
  };
  const persist = () => save({ cat: cat.id, sel, val: txt });

  const name = (u) => t('u_' + u[0]);
  const chips = h('div', { class: 'ce-types cv-cats', role: 'tablist' }, CATS.map((c) => h('button', { class: 'ce-chip', type: 'button', dataset: { id: c.id }, onClick: () => pickCat(c) }, t(c.k))));
  const input = h('input', { class: 'cv-in', type: 'text', inputmode: 'decimal', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', enterkeyhint: 'done', dir: 'ltr', 'aria-label': t('cv_from'), placeholder: '0' });
  const outEl = h('button', { class: 'cv-out', type: 'button', dir: 'ltr', title: t('calc_copy'), onClick: async () => { const v = outEl.dataset.v; if (!v) return; try { await navigator.clipboard.writeText(v); toast(t('calc_copied')); } catch { toast(t('calc_copyFail')); } } }, '—');
  const mkSel = (which) => {
    const s = h('select', { class: 'cv-sel', 'aria-label': t(which === 0 ? 'cv_from' : 'cv_to'), onChange: () => { pair()[which] = s.value; sfx('tab'); persist(); paint(); } });
    return s;
  };
  const selA = mkSel(0), selB = mkSel(1);
  const fillSel = () => {
    const p = pair();
    [selA, selB].forEach((s, i) => { s.replaceChildren(...cat.units.map((u) => h('option', { value: u[0] }, name(u) + ' (' + u[1] + ')'))); s.value = p[i]; });
  };
  const swap = h('button', { class: 'cv-swap', type: 'button', 'aria-label': t('cv_swap'), onClick: () => {
    const p = pair(), v = value();
    if (v != null) { const r = convert(cat, p[0], p[1], v); if (Number.isFinite(r)) txt = String(parseFloat(r.toPrecision(10))); }   // the answer becomes the value to convert back
    [p[0], p[1]] = [p[1], p[0]];
    input.value = txt; sfx('tab'); persist(); fillSel(); paint();
  }, html: ic('swap') });
  const list = h('div', { class: 'cv-list', role: 'list' });
  const hint = h('p', { class: 'ce-hint', hidden: true }, t('calc_err_syntax'));

  function value() {
    const s = latin(txt).trim();
    if (!s) return null;
    if (/^-?\d+(\.\d+)?(e[+-]?\d+)?$/i.test(s)) return Number(s);
    try {
      const r = evaluate(itemsFromText(s.replace(/\*/g, '×')), makeCtx({}));
      return typeof r.value === 'number' ? r.value : null;
    } catch { return null; }
  }

  function paint() {
    const p = pair(), v = value();
    const bad = !!txt.trim() && v == null;
    hint.hidden = !bad;
    input.classList.toggle('bad', bad);
    if (v == null) { outEl.textContent = '—'; outEl.dataset.v = ''; } else {
      const r = convert(cat, p[0], p[1], v);
      outEl.textContent = fmtNum(r); outEl.dataset.v = fmtNum(r, false);
    }
    const to = cat.units.find((u) => u[0] === p[1]);
    outEl.setAttribute('aria-label', (to ? name(to) : '') + ' ' + outEl.textContent);
    list.replaceChildren(...cat.units.map((u) => {
      const on = u[0] === p[1];
      const row = h('button', { class: 'cv-row' + (on ? ' on' : ''), type: 'button', role: 'listitem', dir: 'ltr', onClick: () => { pair()[1] = u[0]; sfx('tab'); persist(); fillSel(); paint(); } },
        h('span', { class: 'cv-n' }, h('b', null, name(u)), h('small', null, u[1])), h('span', { class: 'cv-v' }, v == null ? '—' : fmtNum(convert(cat, p[0], u[0], v))));
      return row;
    }));
  }

  function pickCat(c) {
    cat = c;
    [...chips.children].forEach((b) => { const on = b.dataset.id === c.id; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); });
    fillSel(); persist(); paint();
  }

  input.value = txt;
  input.addEventListener('input', () => { txt = input.value; persist(); paint(); });
  input.addEventListener('focus', () => input.select());
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });

  const card = h('div', { class: 'cv-card' },
    h('div', { class: 'cv-line' }, h('label', { class: 'cv-lab' }, t('cv_from')), input, selA),
    h('div', { class: 'cv-mid' }, h('span', { class: 'cv-eq' }, '='), swap),
    h('div', { class: 'cv-line' }, h('label', { class: 'cv-lab' }, t('cv_to')), outEl, selB));
  const el = h('div', { class: 'ce cv' }, chips, card, hint, h('h4', { class: 'cv-h' }, t('cv_all')), list);
  pickCat(cat);
  return { el };
}
