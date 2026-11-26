// AHOS Calc – drawing items as maths: stacked fractions, superscripts, roots, integrals… The same drawing is used for the line being typed
// (with a caret) and for results/history (read-only). `reg` maps each drawn piece back to its place in the tree so a tap can move the caret.
import { SLOTS } from './editor.js';
import { CONSTS } from './consts.js';

const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
const SHOW = { '-': '−', '*': '×', '/': '÷', 'ᴇ': '×10', 'Ran#': 'Ran#', '→': '→' };
const isOp = (s) => s === '+' || s === '−' || s === '-' || s === '×' || s === '÷' || s === '→' || s === '=' || s === '∠';

/** draws one slot (an array of items). cur = {arr,i} or null. */
export function drawSlot(arr, cur, reg, cls = 'sl') {
  const box = el('span', cls);
  if (reg) reg.set(box, { arr, i: arr.length, slot: true });
  let caretAt = false;
  const put = (j) => { if (cur && cur.arr === arr && cur.i === j) { box.append(el('span', 'caret')); caretAt = true; } };
  for (let j = 0; j < arr.length; j++) { put(j); box.append(drawItem(arr[j], arr, j, cur, reg)); }
  put(arr.length);
  if (!arr.length && !caretAt) box.classList.add('e');
  else if (!arr.length) box.classList.add('e', 'c');
  return box;
}

function drawItem(it, arr, j, cur, reg) {
  let n;
  if (typeof it === 'string') {
    if (/^c#\d+$/.test(it)) { n = el('span', 'k', (CONSTS[+it.slice(2)] || {}).sym || it); }
    else if (/^cv#\d+\($/.test(it)) { n = el('span', 'f', 'conv' + it.slice(3)); }
    else if (it.length > 1 && it.endsWith('(')) n = el('span', 'f', it);
    else if (/^[0-9.]$/.test(it)) n = el('span', 'd', it);
    else if (isOp(it)) n = el('span', 'o', SHOW[it] || it);
    else if (it === 'ᴇ') n = el('span', 'o', '×10');
    else n = el('span', 't', SHOW[it] || it);
  } else {
    const q = (s, c) => drawSlot(it[s], cur, reg, c);
    switch (it.k) {
      case 'pow': n = el('sup', 'pw'); n.append(q('e')); break;
      case 'frac': n = el('span', 'fr'); n.append(q('n', 'sl nu'), q('d', 'sl de')); break;
      case 'mix': { n = el('span', 'mx'); const f = el('span', 'fr'); f.append(q('n', 'sl nu'), q('d', 'sl de')); n.append(q('w', 'sl wh'), f); break; }
      case 'sqrt': n = el('span', 'rd'); n.append(el('span', 'rs', '√'), q('a', 'sl ra')); break;
      case 'root': { n = el('span', 'rd'); const ix = el('sup', 'ri'); ix.append(q('n')); n.append(ix, el('span', 'rs', '√'), q('a', 'sl ra')); break; }
      case 'abs': n = el('span', 'ab'); n.append(el('span', 'br', '|'), q('a'), el('span', 'br', '|')); break;
      case 'logb': { n = el('span', 'lg'); const sb = el('sub', 'lb'); sb.append(q('b')); n.append(el('span', 'f', 'log'), sb, el('span', 'f', '('), q('a'), el('span', 'f', ')')); break; }
      case 'int': { n = el('span', 'in'); const lim = el('span', 'lim'); const up = el('span', 'up'); up.append(q('b')); const dn = el('span', 'dn'); dn.append(q('a')); lim.append(up, el('span', 'big', '∫'), dn); n.append(lim, q('f'), el('span', 'o', 'dx')); break; }
      case 'der': { n = el('span', 'dv'); const f = el('span', 'fr'); f.append(el('span', 'nu', 'd'), el('span', 'de', 'dx')); const at = el('span', 'at'); at.append(el('span', null, '|x='), q('a')); n.append(f, el('span', 'br', '('), q('f'), el('span', 'br', ')'), at); break; }
      case 'sum': { n = el('span', 'sm'); const lim = el('span', 'lim'); const up = el('span', 'up'); up.append(q('b')); const dn = el('span', 'dn'); dn.append(el('span', null, 'x='), q('a')); lim.append(up, el('span', 'big', 'Σ'), dn); n.append(lim, q('f')); break; }
      default: n = el('span', 't', '?');
    }
  }
  if (reg) reg.set(n, { arr, i: j });
  return n;
}

/** a read-only expression (results, history). Returns a span. */
export function drawItems(items, cls = 'cx') {
  const box = el('span', cls);
  box.dir = 'ltr';
  box.append(drawSlot(items, null, null, 'sl rt'));
  return box;
}

/** the value description from fmt.describe() → DOM */
export function drawDesc(d) {
  if (!d) return el('span');
  if (d.kind === 'num') {
    const box = el('span', 'cx res'); box.dir = 'ltr';
    if (d.note) box.append(el('span', 'o', d.note));
    box.append(drawSlot(d.items, null, null, 'sl rt'));
    return box;
  }
  if (d.kind === 'mat') {
    const t = el('div', 'cmat'); t.dir = 'ltr'; t.style.setProperty('--c', d.c);
    d.cells.forEach((c) => { const cell = el('span', 'cell'); cell.append(drawItems(c)); t.append(cell); });
    return t;
  }
  if (d.kind === 'vec') {
    const t = el('div', 'cmat vec'); t.dir = 'ltr'; t.style.setProperty('--c', 1);
    d.cells.forEach((c) => { const cell = el('span', 'cell'); cell.append(drawItems(c)); t.append(cell); });
    return t;
  }
  if (d.kind === 'multi') {
    const t = el('div', 'cmulti'); t.dir = 'ltr';
    d.rows.forEach((r) => { const row = el('div', 'mrow'); row.append(el('span', 'ml', (r.label || '') + ' ='), drawItems(r.items)); t.append(row); });
    return t;
  }
  return el('span');
}

