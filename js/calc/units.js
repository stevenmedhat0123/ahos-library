// AHOS Calc – the units of the Converter pane. Every category has a base unit; a unit is [id, symbol, how many base units it is].
// Temperature is the one category that is not a plain factor (Celsius / Fahrenheit / Kelvin / Rankine go through Kelvin).
// The Egyptian land units follow the official feddan: 1 feddan = 24 qirat = 24 × 24 sahm = 4200.833… m².

const FEDDAN = 4200 + 5 / 6;
const QIRAT = FEDDAN / 24;
const SAHM = QIRAT / 24;

export const CATS = [
  { id: 'len', k: 'cv_len', base: 'm', units: [
    ['m', 'm', 1], ['km', 'km', 1000], ['cm', 'cm', 0.01], ['mm', 'mm', 0.001], ['um', 'µm', 1e-6], ['nm', 'nm', 1e-9],
    ['mi', 'mi', 1609.344], ['yd', 'yd', 0.9144], ['ft', 'ft', 0.3048], ['in', 'in', 0.0254], ['nmi', 'nmi', 1852],
    ['qasab', 'qasab', 3.55], ['dhira', 'dhira', 0.58],
  ] },
  { id: 'area', k: 'cv_area', base: 'm²', units: [
    ['m2', 'm²', 1], ['km2', 'km²', 1e6], ['cm2', 'cm²', 1e-4], ['mm2', 'mm²', 1e-6], ['ha', 'ha', 1e4], ['acre', 'ac', 4046.8564224],
    ['ft2', 'ft²', 0.09290304], ['in2', 'in²', 0.00064516], ['yd2', 'yd²', 0.83612736], ['mi2', 'mi²', 2589988.110336],
    ['feddan', 'feddan', FEDDAN], ['qirat', 'qirat', QIRAT], ['sahm', 'sahm', SAHM],
  ] },
  { id: 'vol', k: 'cv_vol', base: 'L', units: [
    ['L', 'L', 1], ['mL', 'mL', 0.001], ['m3', 'm³', 1000], ['cm3', 'cm³', 0.001], ['ft3', 'ft³', 28.316846592], ['in3', 'in³', 0.016387064],
    ['gal', 'gal (US)', 3.785411784], ['qt', 'qt', 0.946352946], ['pt', 'pt', 0.473176473], ['cup', 'cup', 0.2365882365], ['floz', 'fl oz', 0.0295735295625],
    ['tbsp', 'tbsp', 0.01478676478125], ['tsp', 'tsp', 0.00492892159375], ['galuk', 'gal (UK)', 4.54609],
  ] },
  { id: 'mass', k: 'cv_mass', base: 'kg', units: [
    ['kg', 'kg', 1], ['g', 'g', 0.001], ['mg', 'mg', 1e-6], ['t', 't', 1000], ['lb', 'lb', 0.45359237], ['oz', 'oz', 0.028349523125], ['st', 'st', 6.35029318], ['ct', 'ct', 0.0002],
  ] },
  { id: 'temp', k: 'cv_temp', base: 'K', temp: true, units: [['C', '°C'], ['F', '°F'], ['K', 'K'], ['R', '°R']] },
  { id: 'speed', k: 'cv_speed', base: 'm/s', units: [
    ['ms', 'm/s', 1], ['kmh', 'km/h', 1 / 3.6], ['mph', 'mph', 0.44704], ['kn', 'kn', 1852 / 3600], ['fts', 'ft/s', 0.3048], ['mach', 'Mach', 340.29],
  ] },
  { id: 'time', k: 'cv_time', base: 's', units: [
    ['s', 's', 1], ['msec', 'ms', 0.001], ['us', 'µs', 1e-6], ['min', 'min', 60], ['hr', 'h', 3600], ['day', 'd', 86400], ['wk', 'wk', 604800],
    ['mon', 'mo', 86400 * 30.436875], ['yr', 'yr', 86400 * 365.2425],
  ] },
  { id: 'data', k: 'cv_data', base: 'B', units: [
    ['bit', 'bit', 0.125], ['B', 'B', 1], ['KB', 'KB', 1e3], ['MB', 'MB', 1e6], ['GB', 'GB', 1e9], ['TB', 'TB', 1e12],
    ['KiB', 'KiB', 1024], ['MiB', 'MiB', 1048576], ['GiB', 'GiB', 1073741824], ['TiB', 'TiB', 1099511627776],
  ] },
  { id: 'energy', k: 'cv_energy', base: 'J', units: [
    ['J', 'J', 1], ['kJ', 'kJ', 1000], ['cal', 'cal', 4.184], ['kcal', 'kcal', 4184], ['Wh', 'Wh', 3600], ['kWh', 'kWh', 3.6e6], ['eV', 'eV', 1.602176634e-19],
    ['BTU', 'BTU', 1055.05585262], ['ftlb', 'ft·lbf', 1.3558179483314004],
  ] },
  { id: 'press', k: 'cv_press', base: 'Pa', units: [
    ['Pa', 'Pa', 1], ['kPa', 'kPa', 1000], ['bar', 'bar', 1e5], ['atm', 'atm', 101325], ['psi', 'psi', 6894.757293168], ['mmHg', 'mmHg', 133.322387415], ['torr', 'Torr', 101325 / 760],
  ] },
  { id: 'power', k: 'cv_power', base: 'W', units: [
    ['W', 'W', 1], ['kW', 'kW', 1000], ['MW', 'MW', 1e6], ['hp', 'hp', 745.69987158227], ['PS', 'PS', 735.49875], ['BTUh', 'BTU/h', 0.29307107],
  ] },
  { id: 'angle', k: 'cv_angle', base: '°', units: [
    ['deg', '°', 1], ['rad', 'rad', 180 / Math.PI], ['grad', 'grad', 0.9], ['turn', 'turn', 360], ['amin', '′', 1 / 60], ['asec', '″', 1 / 3600],
  ] },
];

const toK = { C: (v) => v + 273.15, F: (v) => ((v - 32) * 5) / 9 + 273.15, K: (v) => v, R: (v) => (v * 5) / 9 };
const fromK = { C: (k) => k - 273.15, F: (k) => ((k - 273.15) * 9) / 5 + 32, K: (k) => k, R: (k) => (k * 9) / 5 };

export const catOf = (id) => CATS.find((c) => c.id === id) || CATS[0];

/** value `v` of unit `from` → unit `to` inside category `cat` */
export function convert(cat, from, to, v) {
  if (cat.temp) return fromK[to](toK[from](v));
  const f = cat.units.find((u) => u[0] === from), g = cat.units.find((u) => u[0] === to);
  if (!f || !g) return NaN;
  return (v * f[2]) / g[2];
}

/** a number the way a person writes it: up to 10 significant digits, no trailing zeros, ×10ⁿ at the extremes */
export function fmtNum(v, group = true) {
  if (!Number.isFinite(v)) return '—';
  if (v === 0) return '0';
  const a = Math.abs(v);
  if (a >= 1e15 || a < 1e-7) {
    const [m, e] = v.toExponential(9).split('e');
    return parseFloat(m) + '×10' + String(+e).replace(/\d/g, (d) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[d]).replace('-', '⁻');
  }
  let s = parseFloat(v.toPrecision(10)).toString();
  if (/e/.test(s)) s = Number(s).toFixed(12).replace(/\.?0+$/, '');
  if (group) { const [i, d] = s.split('.'); s = i.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (d ? '.' + d : ''); }
  return s;
}
