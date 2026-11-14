// AHOS Calc – error type shared by every calculator module.
// code: 'math' (Math ERROR) · 'syntax' (Syntax ERROR) · 'arg' (Argument ERROR) · 'dim' (Dimension ERROR)
//       'cant' (Can't Solve) · 'nosol' (No solution) · 'stack' (Stack ERROR) · 'time' (Time Out)
export class CalcError extends Error {
  constructor(code, detail) { super(code + (detail ? ': ' + detail : '')); this.code = code; this.detail = detail || ''; }
}
export const mathErr = (d) => new CalcError('math', d);
