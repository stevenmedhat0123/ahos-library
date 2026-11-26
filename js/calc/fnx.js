// AHOS Calc – a function typed as text (the Graph and Table panes): x is the variable, "y =" in front is optional, ^ makes a power, the
// usual names (sin, ln, √ as sqrt( …) work. Returns a plain JS function x → number, or throws a CalcError for text that is not a function.
import { compileFn, itemsFromText, makeCtx } from './expr.js';

const AR = '٠١٢٣٤٥٦٧٨٩';

/** what the user typed → the text the engine reads (X is its variable) */
export function normFn(s) {
  return String(s)
    .replace(/[٠-٩]/g, (d) => String(AR.indexOf(d))).replace(/٫/g, '.').replace(/٬/g, '')
    .replace(/^\s*y\s*=/i, '').replace(/\*/g, '×').replace(/−/g, '-').replace(/√\s*\(/g, 'sqrt(').replace(/\babs\(/gi, 'Abs(')
    .replace(/(?<![A-Za-zΣσ])x(?![a-zA-Z̄̂])/g, 'X');
}

/** text → (x) => number. `vars` are the memory variables (A–F, M …) that may appear in the formula. */
export function compileText(text, { ang = 'deg', vars = {} } = {}) {
  const s = normFn(text);
  if (!s.trim()) return null;
  return compileFn(itemsFromText(s), makeCtx({ ang, vars: { ...vars } }));
}
