// AHOS Calc – the key table of the Casio fx-991ES PLUS (2nd edition), key for key, in the order of the real calculator:
//   TOP  – SHIFT, ALPHA, [the arrow keys], MODE, ON  /  CALC, ∫, x⁻¹, log▫
//   MID  – three rows of six  (a/b √ x² x▫ log ln / (–) °′″ hyp sin cos tan / RCL ENG ( ) S⇔D M+)
//   NUM  – four rows of five  (7 8 9 DEL AC / 4 5 6 × ÷ / 1 2 3 + − / 0 . ×10ˣ Ans =)
// Each key has what it does on its own (p), after SHIFT (s, yellow label) and after ALPHA (a, red label). k = i insert an item, f a function
// name, t a template, p items then a power, a an action handled by sci.js.
const A = (k, v) => ({ k, v });
const I = (v) => A('i', v);
const F = (v) => A('f', v);
const T = (v) => A('t', v);
const Z = (v) => A('a', v);
const FR = '<i class="mf"><b></b><b></b></i>';
const key = (id, c, lab, p, o = {}) => ({ id, c, h: lab, p, s: o.s || null, a: o.a || null, sl: o.sl || '', al: o.al || '' });

export const CZ_TOP = [
  key('shift', 'ctl sh', 'SHIFT', Z('shift')),
  key('alpha', 'ctl al', 'ALPHA', Z('alpha')),
  key('mode', 'ctl', 'MODE', Z('mode'), { s: Z('setup'), sl: 'SETUP' }),
  key('on', 'ctl on', 'ON', Z('on')),
  key('calc', 'fk', 'CALC', Z('calc'), { s: Z('solve'), sl: 'SOLVE', a: I('='), al: '=' }),
  key('int', 'fk', '∫<sup>▫</sup><sub>▫</sub>', T('int'), { s: T('der'), sl: 'd⁄dx' }),
  key('inv', 'fk', 'x<sup>−1</sup>', I('⁻¹'), { s: I('!'), sl: 'x!' }),
  key('logb', 'fk', 'log<sub>▫</sub>▫', T('logb'), { s: T('sum'), sl: 'Σ' }),
];

export const CZ_MID = [
  key('frac', 'fk', FR, T('frac'), { s: T('mix'), sl: '▪<i class="mf s"><b></b><b></b></i>' }),
  key('sqrt', 'fk', '√▫', T('sqrt'), { s: F('cbrt('), sl: '∛▫' }),
  key('sq', 'fk', 'x<sup>2</sup>', I('²'), { s: I('³'), sl: 'x<sup>3</sup>' }),
  key('pow', 'fk', 'x<sup>▫</sup>', Z('pow'), { s: T('root'), sl: '<sup>▫</sup>√▫' }),
  key('log', 'fk', 'log', F('log('), { s: A('p', ['1', '0']), sl: '10<sup>▫</sup>' }),
  key('ln', 'fk', 'ln', F('ln('), { s: A('p', ['e']), sl: 'e<sup>▫</sup>' }),

  key('neg', 'fk', '(−)', I('-'), { s: I('∠'), sl: '∠', a: I('A'), al: 'A' }),
  key('dms', 'fk', '° ′ ″', Z('dms'), { s: F('dms('), sl: '←', a: I('B'), al: 'B' }),
  key('hyp', 'fk', 'hyp', Z('hyp'), { s: T('abs'), sl: 'Abs', a: I('C'), al: 'C' }),
  key('sin', 'fk', 'sin', F('sin('), { s: F('asin('), sl: 'sin<sup>−1</sup>', a: I('D'), al: 'D' }),
  key('cos', 'fk', 'cos', F('cos('), { s: F('acos('), sl: 'cos<sup>−1</sup>', a: I('E'), al: 'E' }),
  key('tan', 'fk', 'tan', F('tan('), { s: F('atan('), sl: 'tan<sup>−1</sup>', a: I('F'), al: 'F' }),

  key('rcl', 'fk', 'RCL', Z('rcl'), { s: Z('sto'), sl: 'STO' }),
  key('eng', 'fk', 'ENG', Z('eng'), { s: Z('engl'), sl: '←', a: I('i'), al: 'i' }),
  key('lp', 'fk', '(', I('('), { s: I('%'), sl: '%' }),
  key('rp', 'fk', ')', I(')'), { s: I(','), sl: ',', a: I('X'), al: 'X' }),
  key('sd', 'fk', 'S⇔D', Z('sd'), { s: Z('abc'), sl: 'a<sup>b</sup>⁄<sub>c</sub>⇔<sup>d</sup>⁄<sub>c</sub>', a: I('Y'), al: 'Y' }),
  key('mp', 'fk', 'M+', Z('mplus'), { s: Z('mminus'), sl: 'M−', a: I('M'), al: 'M' }),
];

export const CZ_NUM = [
  key('7', 'nk', '7', I('7'), { s: Z('consts'), sl: 'CONST' }),
  key('8', 'nk', '8', I('8'), { s: Z('convs'), sl: 'CONV' }),
  key('9', 'nk', '9', I('9'), { s: Z('clr'), sl: 'CLR' }),
  key('del', 'dl', '', Z('del'), { s: Z('ins'), sl: 'INS' }),
  key('ac', 'ac', 'AC', Z('ac'), { s: Z('off'), sl: 'OFF' }),

  key('4', 'nk', '4', I('4'), { s: Z('matrix'), sl: 'MATRIX' }),
  key('5', 'nk', '5', I('5'), { s: Z('vector'), sl: 'VECTOR' }),
  key('6', 'nk', '6', I('6')),
  key('mul', 'nk ok', '×', I('×'), { s: I('nPr'), sl: 'nPr' }),
  key('div', 'nk ok', '÷', I('÷'), { s: I('nCr'), sl: 'nCr' }),

  key('1', 'nk', '1', I('1'), { s: Z('stat'), sl: 'STAT' }),
  key('2', 'nk', '2', I('2'), { s: Z('cmplx'), sl: 'CMPLX' }),
  key('3', 'nk', '3', I('3'), { s: Z('base'), sl: 'BASE' }),
  key('add', 'nk ok', '+', I('+'), { s: F('Pol('), sl: 'Pol' }),
  key('sub', 'nk ok', '−', I('-'), { s: F('Rec('), sl: 'Rec' }),

  key('0', 'nk', '0', I('0'), { s: F('Rnd('), sl: 'Rnd' }),
  key('dot', 'nk', '•', I('.'), { s: I('Ran#'), sl: 'Ran#', a: F('RanInt('), al: 'RanInt' }),
  key('exp', 'nk', '×10<sup>x</sup>', I('ᴇ'), { s: I('π'), sl: 'π', a: I('e'), al: 'e' }),
  key('ans', 'nk', 'Ans', I('Ans'), { s: Z('drg'), sl: 'DRG▶' }),
  key('eq', 'nk eqz', '=', Z('eq')),
];

/** what hyp turns sin / cos / tan into (and what SHIFT does to it) */
export const HYP = { 'sin(': 'sinh(', 'cos(': 'cosh(', 'tan(': 'tanh(', 'asin(': 'asinh(', 'acos(': 'acosh(', 'atan(': 'atanh(' };

/** the four arrow keys: name → path of a small triangle (24 × 24) */
export const ARROWS = { up: 'M12 6l8 12H4z', down: 'M12 18L4 6h16z', left: 'M6 12l12-8v16z', right: 'M18 12L6 4v16z' };
