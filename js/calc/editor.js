// AHOS Calc – the expression editor model: a tree of items (strings and templates like fractions) with a cursor. No DOM here, so it can be
// tested in plain Node. The items it produces are exactly what expr.js evaluates.
export const SLOTS = { frac: ['n', 'd'], mix: ['w', 'n', 'd'], sqrt: ['a'], root: ['n', 'a'], abs: ['a'], logb: ['b', 'a'], int: ['f', 'a', 'b'], der: ['f', 'a'], sum: ['f', 'a', 'b'], pow: ['e'] };

const isTpl = (it) => it && typeof it === 'object' && !!SLOTS[it.k];
const isDigit = (it) => typeof it === 'string' && /^[0-9.]$/.test(it);
const isId = (it) => typeof it === 'string' && !isDigit(it) && !it.endsWith('(') && !/^[+\-−×÷*/(),→=!²³%°′″ʳᵍᴇ]$/.test(it) && it !== '⁻¹';
const OPS = new Set(['+', '-', '−', '×', '÷', '*', '/', '=', ',']);
const VERT = { frac: { n: { d: 'd' }, d: { u: 'n' } }, mix: { n: { d: 'd' }, d: { u: 'n' } }, int: { a: { u: 'b' }, b: { d: 'a' } }, sum: { a: { u: 'b' }, b: { d: 'a' } }, root: { a: { u: 'n' }, n: { d: 'a' } } };
const clone = (v) => JSON.parse(JSON.stringify(v));

export class Editor {
  constructor(items = []) { this.undoS = []; this.redoS = []; this.load(items, false); }

  /* ---------- structure ---------- */
  link() {                                    // every slot array → where it hangs (so the cursor can walk out of a template)
    this.par = new Map();
    const walk = (arr) => arr.forEach((it, i) => {
      if (!isTpl(it)) return;
      for (const s of SLOTS[it.k]) { if (!Array.isArray(it[s])) it[s] = []; this.par.set(it[s], { arr, i, tpl: it, slot: s }); walk(it[s]); }
    });
    walk(this.root);
  }
  load(items, keepUndo = true) {
    if (keepUndo) this.push();
    this.root = clone(items || []);
    this.cur = { arr: this.root, i: this.root.length };
    this.link();
  }
  get items() { return this.root; }
  get isEmpty() { return this.root.length === 0; }
  push() { this.undoS.push(JSON.stringify(this.root)); if (this.undoS.length > 60) this.undoS.shift(); this.redoS.length = 0; }
  undo() { if (!this.undoS.length) return false; this.redoS.push(JSON.stringify(this.root)); this.root = JSON.parse(this.undoS.pop()); this.cur = { arr: this.root, i: this.root.length }; this.link(); return true; }
  redo() { if (!this.redoS.length) return false; this.undoS.push(JSON.stringify(this.root)); this.root = JSON.parse(this.redoS.pop()); this.cur = { arr: this.root, i: this.root.length }; this.link(); return true; }
  clear() { if (this.root.length) this.push(); this.root = []; this.cur = { arr: this.root, i: 0 }; this.link(); }

  /* ---------- where the cursor is ---------- */
  inSlot(k) { const p = this.par.get(this.cur.arr); return !!p && (!k || p.tpl.k === k); }
  place(arr, i) { this.cur = { arr, i: Math.max(0, Math.min(arr.length, i)) }; }

  /* ---------- typing ---------- */
  insert(item) {
    this.push();
    const { arr, i } = this.cur;
    arr.splice(i, 0, item);
    this.cur.i = i + 1;
    this.link();
  }
  /** an operator typed at the end of an exponent steps out of it first (2^3+4 means 2^3, then +4) */
  op(item) {
    const p = this.par.get(this.cur.arr);
    if (p && p.tpl.k === 'pow' && this.cur.i === this.cur.arr.length && this.cur.arr.length > 0 && OPS.has(item)) this.place(p.arr, p.i + 1);
    this.insert(item);
  }
  /** `take` (fraction only): whatever was just typed becomes the numerator – like the Casio key. Without it the empty fraction simply sits beside what was typed. */
  insertTemplate(k, take = false) {
    this.push();
    const tpl = { k };
    for (const s of SLOTS[k]) tpl[s] = [];
    const { arr } = this.cur;
    let { i } = this.cur;
    let first = SLOTS[k][0];
    if (k === 'frac' && take && i > 0) {                   // a/b: whatever was just typed becomes the numerator
      const last = arr[i - 1];
      let from = -1;
      if (last === ')') {
        let depth = 0;
        for (let j = i - 1; j >= 0; j--) { const it = arr[j]; if (it === ')') depth++; else if (it === '(' || (typeof it === 'string' && it.endsWith('(') && it.length > 1)) { depth--; if (depth === 0) { from = j; break; } } }
      } else if (isDigit(last)) { from = i - 1; while (from > 0 && isDigit(arr[from - 1])) from--; }
      else if (isId(last) || isTpl(last)) from = i - 1;
      if (from >= 0) { tpl.n = arr.splice(from, i - from); i = from; first = 'd'; }
    }
    arr.splice(i, 0, tpl);
    this.link();
    this.place(tpl[first], 0);
    return tpl;
  }

  /* ---------- moving ---------- */
  right() {
    const { arr, i } = this.cur;
    if (i < arr.length) { const it = arr[i]; if (isTpl(it)) this.place(it[SLOTS[it.k][0]], 0); else this.cur.i = i + 1; return true; }
    const p = this.par.get(arr);
    if (!p) return false;
    const slots = SLOTS[p.tpl.k], at = slots.indexOf(p.slot);
    if (at < slots.length - 1) this.place(p.tpl[slots[at + 1]], 0); else this.place(p.arr, p.i + 1);
    return true;
  }
  left() {
    const { arr, i } = this.cur;
    if (i > 0) { const it = arr[i - 1]; if (isTpl(it)) { const sl = SLOTS[it.k]; const a = it[sl[sl.length - 1]]; this.place(a, a.length); } else this.cur.i = i - 1; return true; }
    const p = this.par.get(arr);
    if (!p) return false;
    const slots = SLOTS[p.tpl.k], at = slots.indexOf(p.slot);
    if (at > 0) { const a = p.tpl[slots[at - 1]]; this.place(a, a.length); } else this.place(p.arr, p.i);
    return true;
  }
  home() { this.place(this.root, 0); }
  end() { this.place(this.root, this.root.length); }
  /** ▲ / ▼: to the slot above or below (numerator ⇄ denominator, limits, a power's exponent). false = nowhere to go (the caller may replay history). */
  vert(dir) {
    const { arr, i } = this.cur;
    const p = this.par.get(arr);
    if (p) {
      if (p.tpl.k === 'pow' && dir > 0) { this.place(p.arr, p.i + 1); return true; }
      const to = VERT[p.tpl.k] && VERT[p.tpl.k][p.slot] && VERT[p.tpl.k][p.slot][dir < 0 ? 'u' : 'd'];
      if (to) { const a = p.tpl[to]; this.place(a, Math.min(a.length, i)); return true; }
    }
    if (dir < 0) {                                         // beside a power: ▲ climbs into the exponent
      const here = arr[i], before = arr[i - 1];
      const pw = here && here.k === 'pow' ? here : before && before.k === 'pow' ? before : null;
      if (pw) { this.place(pw.e, pw.e.length); return true; }
    }
    return false;
  }
  up() { return this.vert(-1); }
  down() { return this.vert(1); }
  /** overwrite mode: drop the plain item right after the caret before something is typed over it */
  delNext() {
    const { arr, i } = this.cur;
    if (i < arr.length && typeof arr[i] === 'string') { this.push(); arr.splice(i, 1); this.link(); return true; }
    return false;
  }

  /* ---------- deleting ---------- */
  static empty(tpl) { return SLOTS[tpl.k].every((s) => !tpl[s].length); }
  /** DEL always takes something away that you can see:
   *  – right after a template it steps in and removes the last thing in it (an empty template goes whole)
   *  – at the start of a fraction's denominator it removes the fraction bar (numerator and denominator run together)
   *  – at the start of a fraction's numerator it removes whatever stands before the fraction
   *  – other templates (powers, roots…) are left without deleting, as before */
  backspace() {
    const { arr, i } = this.cur;
    if (i > 0) {
      const it = arr[i - 1];
      if (isTpl(it)) {
        if (Editor.empty(it)) { this.push(); arr.splice(i - 1, 1); this.cur.i = i - 1; this.link(); return true; }
        const sl = SLOTS[it.k]; const a = it[sl[sl.length - 1]]; this.place(a, a.length);
        return this.backspace();
      }
      this.push(); arr.splice(i - 1, 1); this.cur.i = i - 1; this.link(); return true;
    }
    const p = this.par.get(arr);
    if (!p) return false;
    if (Editor.empty(p.tpl)) { this.push(); p.arr.splice(p.i, 1); this.place(p.arr, p.i); this.link(); return true; }
    if (p.tpl.k === 'frac' || p.tpl.k === 'mix') {
      const slots = SLOTS[p.tpl.k], at = slots.indexOf(p.slot);
      if (at > 0) {                                                  // the bar goes: the parts run together, the caret stays at the join
        const flat = []; let pos = 0;
        slots.forEach((s, n) => { if (n === at) pos = flat.length; flat.push(...p.tpl[s]); });
        this.push(); p.arr.splice(p.i, 1, ...flat); this.link(); this.place(p.arr, p.i + pos); return true;
      }
      this.place(p.arr, p.i);
      return p.i > 0 || this.par.has(p.arr) ? this.backspace() : true;
    }
    this.place(p.arr, p.i);                                          // leaves the template without deleting anything
    return true;
  }
}
