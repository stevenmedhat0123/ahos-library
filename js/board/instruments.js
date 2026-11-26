// Drawing instruments laid over the board: a ruler, two set squares, a protractor and a compass (برجل).
// They are tools, not drawings: never saved, never exported, never erased. Each one lives in world units like the page (1 cm = 28.35), so it zooms with the page.
//   ruler / set squares / protractor: drag the body to move · two fingers to turn · the round handle turns it · the pen (or a finger with the pen tool) draws a straight line along an edge
//   protractor: the red arm is set with its handle and reads the angle (1° steps)
//   compass: the needle (blue) moves it · the pencil end (orange) draws a circle or an arc round the needle · the hinge sets the radius
export const CM = 28.35;
export const INSTRUMENTS = ['ruler', 'sq45', 'sq30', 'protractor', 'compass'];
const TAU = Math.PI * 2, DEG = Math.PI / 180;
export const SIZE = { ruler: { L: 15 * CM, H: 3.6 * CM }, sq45: { S: 11 * CM }, sq30: { Lg: 12.5 * CM, Sh: 7.2 * CM }, protractor: { R: 7 * CM }, compass: { Lh: 4.5 * CM, rmin: 0.3 * CM } };
const COL = { ruler: ['rgba(255,196,64,.45)', '#7a5200'], sq45: ['rgba(64,180,255,.36)', '#0b4a6e'], sq30: ['rgba(80,210,140,.36)', '#0d5a36'], protractor: ['rgba(120,170,255,.32)', '#1d3f8f'] };
const ACC = '#f59e0b', ARM = '#e11d48', NEEDLE = '#2563eb';
const r1 = (v) => Math.round(v * 10) / 10;
const rr = (m, x, y, w, h, r) => { if (m.roundRect) m.roundRect(x, y, w, h, r); else m.rect(x, y, w, h); };
const hyp = Math.hypot;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const wrap = (a) => { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; };
/** turning by hand: sticks to every 15° (within 2°) so a right angle or a 45° is easy to hit */
const snapAng = (a) => { const d = a / DEG, n = Math.round(d / 15) * 15; return Math.abs(d - n) < 2.2 ? n * DEG : a; };

/** distance from p to the segment a–b, and where along it (0..1) the nearest point is */
function segDist(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
  const t = l2 ? clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2, 0, 1) : 0;
  return { d: hyp(p[0] - (a[0] + dx * t), p[1] - (a[1] + dy * t)), t };
}
function inPoly(p, poly) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

const cs = (i) => [Math.cos(i.a), Math.sin(i.a)];
export function toWorld(i, lx, ly) { const [c, s] = cs(i), X = lx * i.f; return [i.x + X * c - ly * s, i.y + X * s + ly * c]; }
export function toLocal(i, wx, wy) { const [c, s] = cs(i), dx = wx - i.x, dy = wy - i.y; return [(dx * c + dy * s) * i.f, -dx * s + dy * c]; }

/** the compass in world coordinates: needle P, pencil Q, hinge H (the legs have equal length, so the hinge rises as the radius shrinks) */
export function compassGeo(i) {
  const L = SIZE.compass.Lh, r = i.r, c = Math.cos(i.a), s = Math.sin(i.a);
  const P = [i.x, i.y], Q = [i.x + r * c, i.y + r * s], hh = Math.sqrt(Math.max(1, L * L - (r / 2) * (r / 2)));
  return { P, Q, H: [(P[0] + Q[0]) / 2 + s * hh, (P[1] + Q[1]) / 2 - c * hh], L, n: [s, -c] };
}

/** body polygon, straight edges, pivot (what turns) and the turning handle of a flat instrument – all in its own coordinates */
export function shapeOf(i, s = 1) {
  const g = 18 / s;
  switch (i.k) {
    case 'ruler': { const { L, H } = SIZE.ruler; return { body: [[0, 0], [L, 0], [L, H], [0, H]], edges: [[[0, 0], [L, 0]], [[0, H], [L, H]]], pv: [L / 2, H / 2], rot: [L + g, H / 2] }; }
    case 'sq45': { const S = SIZE.sq45.S; return { body: [[0, 0], [S, 0], [0, S]], edges: [[[0, 0], [S, 0]], [[S, 0], [0, S]], [[0, S], [0, 0]]], pv: [S / 3, S / 3], rot: [S / 2 + g * 0.7071, S / 2 + g * 0.7071] }; }
    case 'sq30': {
      const { Lg, Sh } = SIZE.sq30, hy = hyp(Lg, Sh);
      return { body: [[0, 0], [Lg, 0], [0, Sh]], edges: [[[0, 0], [Lg, 0]], [[Lg, 0], [0, Sh]], [[0, Sh], [0, 0]]], pv: [Lg / 3, Sh / 3], rot: [Lg / 2 + (g * Sh) / hy, Sh / 2 + (g * Lg) / hy] };
    }
    case 'protractor': {
      const R = SIZE.protractor.R, body = [];
      for (let k = 0; k <= 36; k++) { const t = (k * 5) * DEG; body.push([R * Math.cos(t), -R * Math.sin(t)]); }
      const th = (i.arm || 0) * DEG, len = R + 10;
      return { body, edges: [[[-R, 0], [R, 0]], [[0, 0], [len * Math.cos(th), -len * Math.sin(th)]]], pv: [0, 0], rot: [0, g * 1.3], arm: [len * Math.cos(th), -len * Math.sin(th)] };
    }
    default: return null;
  }
}

export class Instruments {
  constructor(cv) { this.cv = cv; this.list = []; this.active = null; this.nid = 0; }
  get on() { return this.list.length > 0; }
  has(k) { return this.list.some((i) => i.k === k); }
  changed() { this.cv.repaint(); this.cv.emit('ins'); }

  add(k) {
    let i = this.list.find((q) => q.k === k);
    const [cx, cy] = this.cv.viewCenter();
    if (!i) {
      i = { id: ++this.nid, k, x: 0, y: 0, a: 0, f: 1, r: 3 * CM, arm: 60 };
      this.list.push(i);
    }
    // it appears in the middle of what is on screen (a compass is centred on its radius)
    if (k === 'ruler') { i.x = cx - SIZE.ruler.L / 2; i.y = cy - SIZE.ruler.H / 2; i.a = 0; }
    else if (k === 'sq45') { i.x = cx - SIZE.sq45.S / 3; i.y = cy - SIZE.sq45.S / 3; i.a = 0; }
    else if (k === 'sq30') { i.x = cx - SIZE.sq30.Lg / 3; i.y = cy - SIZE.sq30.Sh / 3; i.a = 0; }
    else if (k === 'protractor') { i.x = cx; i.y = cy + SIZE.protractor.R / 2; i.a = 0; }
    else { i.x = cx - i.r / 2; i.y = cy + SIZE.compass.Lh * 0.5; i.a = 0; }   // low enough that the hinge stays in view when it is closed
    this.activate(i);
    return i;
  }
  remove(i) {
    this.list = this.list.filter((q) => q !== i);
    if (this.active === i) this.active = this.list[this.list.length - 1] || null;
    this.changed();
  }
  clear() { this.list = []; this.active = null; this.changed(); }
  /** the one you touched comes to the front */
  activate(i) {
    this.active = i;
    const k = this.list.indexOf(i);
    if (k >= 0 && k !== this.list.length - 1) { this.list.splice(k, 1); this.list.push(i); }
    this.changed();
  }
  /** turns about its pivot (the needle of the compass) */
  turn(i, deg) { const pv = i.k === 'compass' ? [0, 0] : shapeOf(i).pv, w = toWorld(i, pv[0], pv[1]); i.a += deg * DEG; this.place(i, pv, w); this.changed(); }
  flip(i) { if (i.k !== 'sq45' && i.k !== 'sq30') return; const pv = shapeOf(i).pv, w = toWorld(i, pv[0], pv[1]); i.f = -i.f; this.place(i, pv, w); this.changed(); }
  setRadius(i, r) { i.r = clamp(Math.round(r / (CM / 10)) * (CM / 10), SIZE.compass.rmin, SIZE.compass.Lh * 1.94); this.changed(); }
  setArm(i, deg) { i.arm = clamp(Math.round(deg), 0, 180); this.changed(); }
  /** puts the instrument so that its local point `pv` is at the world point `w` (turning about a point) */
  place(i, pv, w) { const q = toWorld({ ...i, x: 0, y: 0 }, pv[0], pv[1]); i.x = w[0] - q[0]; i.y = w[1] - q[1]; }

  /* ---------- what is under the finger ---------- */
  /** { i, part } for a touch at world point (wx, wy), or null: the page below is then drawn on as usual. */
  hit(wx, wy, tool, shapeKind) {
    const s = this.cv.view.s, T = (px) => px / s, w = [wx, wy];
    const edgeTool = tool === 'pen' || tool === 'hl' || (tool === 'shape' && (shapeKind === 'line' || shapeKind === 'arrow'));
    for (let n = this.list.length - 1; n >= 0; n--) {
      const i = this.list[n];
      if (i.k === 'compass') {
        const g = compassGeo(i);
        if (hyp(wx - g.Q[0], wy - g.Q[1]) <= T(26)) return { i, part: 'tip' };
        if (hyp(wx - g.H[0], wy - g.H[1]) <= T(28)) return { i, part: 'hinge' };
        if (hyp(wx - g.P[0], wy - g.P[1]) <= T(26) || segDist(w, g.H, g.P).d <= T(12) || segDist(w, g.H, g.Q).d <= T(12)) return { i, part: 'move' };
        continue;
      }
      const sh = shapeOf(i, s), L = toLocal(i, wx, wy);
      if (i.k === 'protractor' && hyp(L[0] - sh.arm[0], L[1] - sh.arm[1]) <= T(26)) return { i, part: 'arm' };
      if (i === this.active && hyp(L[0] - sh.rot[0], L[1] - sh.rot[1]) <= T(26)) return { i, part: 'rot' };
      const inside = inPoly(L, sh.body);
      if (edgeTool) {
        for (let e = 0; e < sh.edges.length; e++) {
          const d = segDist(L, sh.edges[e][0], sh.edges[e][1]).d;
          if (d <= (inside ? T(7) : T(16))) return { i, part: 'edge', edge: e };
        }
      }
      if (inside) return { i, part: 'move' };
    }
    return null;
  }

  /* ---------- gestures ---------- */
  op(e, h, tool) {
    this.activate(h.i);
    switch (h.part) {
      case 'rot': return this.rotOp(e, h.i);
      case 'arm': return this.armOp(e, h.i);
      case 'tip': return this.tipOp(e, h.i, tool);
      case 'hinge': return this.radiusOp(e, h.i);
      case 'edge': return this.edgeOp(e, h.i, h.edge, tool);
      default: return this.moveOp(e, h.i);
    }
  }
  pt(ev) { return this.cv.toWorld(ev.clientX, ev.clientY); }

  /** one finger moves it; a second finger on it turns it (and the two together carry it) */
  moveOp(e, i) {
    const cv = this.cv;
    let pid = e.pointerId, base = { x: i.x, y: i.y }, s0 = this.pt(e), two = null;
    const pv = i.k === 'compass' ? [0, 0] : shapeOf(i).pv;
    const op = { type: 'ins' };
    const rebase = () => { const p = cv.pointers.get(pid); base = { x: i.x, y: i.y }; s0 = p ? cv.toWorld(p.x, p.y) : s0; };
    op.second = (ev) => {
      if (two) return true;
      const L = toLocal(i, ...this.pt(ev)), sh = i.k === 'compass' ? null : shapeOf(i, cv.view.s);
      const g = i.k === 'compass' ? compassGeo(i) : null, w = this.pt(ev);
      const onIt = g ? (hyp(w[0] - g.P[0], w[1] - g.P[1]) <= i.r * 1.5 + 40) : inPoly(L, sh.body) || segDist(L, ...(sh.edges[0])).d < 40;
      if (!onIt) return false;
      const p1 = cv.pointers.get(pid), p2 = cv.pointers.get(ev.pointerId);
      if (!p1 || !p2) return false;
      const a = cv.toWorld(p1.x, p1.y), b = cv.toWorld(p2.x, p2.y);
      two = { id: ev.pointerId, ang: Math.atan2(b[1] - a[1], b[0] - a[0]), a0: i.a, mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], pvw: toWorld(i, pv[0], pv[1]) };
      return true;
    };
    op.move = (ev) => {
      if (two) {
        const p1 = cv.pointers.get(pid), p2 = cv.pointers.get(two.id);
        if (!p1 || !p2) return;
        const a = cv.toWorld(p1.x, p1.y), b = cv.toWorld(p2.x, p2.y), mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        i.a = snapAng(two.a0 + wrap(Math.atan2(b[1] - a[1], b[0] - a[0]) - two.ang));
        this.place(i, pv, [two.pvw[0] + mid[0] - two.mid[0], two.pvw[1] + mid[1] - two.mid[1]]);
      } else if (ev.pointerId === pid) {
        const w = this.pt(ev); i.x = base.x + w[0] - s0[0]; i.y = base.y + w[1] - s0[1];
      } else return;
      this.changed();
    };
    op.up = (ev) => {
      if (two) { pid = ev.pointerId === pid ? two.id : pid; two = null; rebase(); cv.op = op; return; }   // one finger is left: it carries on moving
      this.changed();
    };
    return op;
  }
  /** the round handle: turns about the instrument's pivot */
  rotOp(e, i) {
    const pv = shapeOf(i).pv, pw = toWorld(i, pv[0], pv[1]), w0 = this.pt(e), ang0 = Math.atan2(w0[1] - pw[1], w0[0] - pw[0]), a0 = i.a;
    return {
      type: 'ins',
      move: (ev) => { const w = this.pt(ev); i.a = snapAng(a0 + wrap(Math.atan2(w[1] - pw[1], w[0] - pw[0]) - ang0)); this.place(i, pv, pw); this.changed(); },
      up: () => this.changed(),
    };
  }
  /** the protractor's red arm: 1° steps from the baseline */
  armOp(e, i) {
    const set = (ev) => {
      const [lx, ly] = toLocal(i, ...this.pt(ev));
      let th = Math.atan2(-ly, lx) / DEG;
      if (ly > 0 && th < 0) th = lx >= 0 ? 0 : 180;   // below the baseline: the nearer end
      this.setArm(i, th);
    };
    set(e);
    return { type: 'ins', move: set, up: () => this.changed() };
  }
  /** the compass hinge: pulled away from the legs' line the compass closes, pushed towards it it opens */
  radiusOp(e, i) {
    const set = (ev) => {
      const w = this.pt(ev), [c, s] = cs(i);
      const hp = Math.abs(-(w[0] - i.x) * s + (w[1] - i.y) * c), L = SIZE.compass.Lh;   // distance of the finger from the line needle→pencil
      this.setRadius(i, 2 * Math.sqrt(Math.max(0, L * L - hp * hp)));
    };
    set(e);
    return { type: 'ins', move: set, up: () => this.changed() };
  }

  /** pencil end: draws the circle (or the part of it) it is swept through */
  tipOp(e, i, tool) {
    const cv = this.cv, drawTool = tool === 'hl' ? 'hl' : 'pen';
    const a0 = i.a;
    let prev = Math.atan2(this.pt(e)[1] - i.y, this.pt(e)[0] - i.x), acc = 0, moved = false;
    const o = { type: 'shape', preview: null };
    const build = () => {
      const r = i.r, n = Math.max(2, Math.ceil((Math.abs(acc) * r) / 4)), pts = [];
      for (let k = 0; k <= n; k++) { const t = a0 + (acc * k) / n; pts.push(r1(i.x + r * Math.cos(t)), r1(i.y + r * Math.sin(t))); }
      o.preview = cv.inkStroke(drawTool, pts);
    };
    o.move = (ev) => {
      const w = this.pt(ev), a = Math.atan2(w[1] - i.y, w[0] - i.x);
      acc += wrap(a - prev); prev = a;
      if (Math.abs(acc) > TAU - 0.04) acc = Math.sign(acc) * TAU;   // a whole turn closes the circle exactly
      i.a = a0 + acc; moved = true;
      build(); this.changed();
    };
    o.up = () => {
      if (!moved || !o.preview || Math.abs(acc) * i.r * cv.view.s < 5) { i.a = a0; this.changed(); return; }
      cv.commitLive(o.preview);
      this.changed();
    };
    return o;
  }

  /** a straight line along an edge of the instrument */
  edgeOp(e, i, edge, tool) {
    const cv = this.cv, sh = shapeOf(i, cv.view.s), [A, B] = sh.edges[edge].map((p) => toWorld(i, p[0], p[1]));
    const len = hyp(B[0] - A[0], B[1] - A[1]) || 1, u = [(B[0] - A[0]) / len, (B[1] - A[1]) / len];
    const proj = (w) => { const t = clamp((w[0] - A[0]) * u[0] + (w[1] - A[1]) * u[1], 0, len); return [A[0] + u[0] * t, A[1] + u[1] * t]; };
    const a = proj(this.pt(e));
    let b = a;
    const o = { type: 'shape', preview: null };
    const build = () => {
      const pref = cv.prefs.shape;
      if (tool === 'shape') o.preview = { t: pref.kind, c: pref.c, w: cv.penW(pref.w), a: a.map(r1), b: b.map(r1) };
      else {
        const l = hyp(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.ceil(l / 6)), pts = [];
        for (let k = 0; k <= n; k++) pts.push(r1(a[0] + ((b[0] - a[0]) * k) / n), r1(a[1] + ((b[1] - a[1]) * k) / n));
        o.preview = cv.inkStroke(tool === 'hl' ? 'hl' : 'pen', pts);
      }
    };
    o.move = (ev) => { b = proj(this.pt(ev)); build(); cv.repaint(); };
    o.up = () => {
      if (!o.preview || hyp(b[0] - a[0], b[1] - a[1]) * cv.view.s < 4) { cv.repaint(); return; }
      cv.commitLive(o.preview);
    };
    return o;
  }

  /* ---------- painting ---------- */
  draw(m, dark) {
    const cv = this.cv, { s, x, y } = cv.view, d = cv.dpr;
    m.save();
    m.setTransform(d * s, 0, 0, d * s, d * x, d * y);
    for (const i of this.list) {
      if (i.k === 'compass') this.drawCompass(m, i, s, dark);
      else this.drawFlat(m, i, s, dark);
    }
    m.restore();
  }
  drawFlat(m, i, s, dark) {
    const [fill, line] = COL[i.k], ink = dark ? '#f1f5f9' : line, sh = shapeOf(i, s), act = i === this.active;
    m.save();
    m.translate(i.x, i.y); m.rotate(i.a); m.scale(i.f, 1);
    m.lineJoin = 'round'; m.lineCap = 'round';
    const hair = 0.9 / s, text = (str, tx, ty, size, align = 'center', col = ink, base = 'middle') => {
      m.save(); m.translate(tx, ty); m.scale(i.f, 1); m.font = `${size}px system-ui, sans-serif`; m.textAlign = align; m.textBaseline = base; m.fillStyle = col; m.fillText(str, 0, 0); m.restore();
    };
    const fs = Math.max(10, 9 / s);
    m.fillStyle = fill; m.strokeStyle = ink; m.lineWidth = 1.3 / s;
    if (i.k === 'ruler') {
      const { L, H } = SIZE.ruler;
      m.beginPath(); rr(m, 0, 0, L, H, 5); m.fill(); m.stroke();
      m.beginPath(); m.lineWidth = hair;
      const mm = CM / 10, fine = mm * s >= 2.2;
      for (let k = 0; k <= 150; k++) {
        if (!fine && k % 5) continue;
        const x0 = k * mm, len = k % 10 === 0 ? 15 : k % 5 === 0 ? 10.5 : 6.5;
        m.moveTo(x0, 0); m.lineTo(x0, len);
        if (k % 5 === 0) { const ln = k % 10 === 0 ? 11 : 7; m.moveTo(x0, H); m.lineTo(x0, H - ln); }
      }
      m.stroke();
      for (let k = 0; k <= 15; k++) text(String(k), clamp(k * CM, 7, L - 7), 15 + fs * 0.9, fs);
      text('cm', L - 14, H - 17, fs * 0.9);
    } else if (i.k === 'sq45' || i.k === 'sq30') {
      const [A, B, C] = sh.body, cen = [(A[0] + B[0] + C[0]) / 3, (A[1] + B[1] + C[1]) / 3];
      const inner = sh.body.map((p) => [cen[0] + (p[0] - cen[0]) * 0.46, cen[1] + (p[1] - cen[1]) * 0.46]);
      m.beginPath(); m.moveTo(...A); m.lineTo(...B); m.lineTo(...C); m.closePath();
      m.moveTo(...inner[0]); m.lineTo(...inner[1]); m.lineTo(...inner[2]); m.closePath();
      m.fill('evenodd'); m.stroke();
      const len = i.k === 'sq45' ? SIZE.sq45.S : SIZE.sq30.Lg, mm = CM / 10, fine = mm * s >= 2.2;
      m.beginPath(); m.lineWidth = hair;
      for (let k = 0; k * mm <= len - 2; k++) { if (!fine && k % 5) continue; m.moveTo(k * mm, 0); m.lineTo(k * mm, k % 10 === 0 ? 13 : k % 5 === 0 ? 9.5 : 6); }
      m.stroke();
      for (let k = 1; k * CM <= len - 8; k++) text(String(k), k * CM, 13 + fs * 0.8, fs);
      // the corner mark, and the size of the other two angles
      m.beginPath(); m.lineWidth = hair; m.moveTo(11, 0); m.lineTo(11, 11); m.lineTo(0, 11); m.stroke();
      const angs = i.k === 'sq45' ? [45, 45] : [30, 60];
      [B, C].forEach((v, k) => text(angs[k] + '°', v[0] + (cen[0] - v[0]) * 0.5, v[1] + (cen[1] - v[1]) * 0.5 + (v[1] === 0 ? 10 : 0), fs, 'center', ink));   // (a little lower where the scale is)
    } else if (i.k === 'protractor') {
      const R = SIZE.protractor.R;
      m.beginPath(); m.arc(0, 0, R, Math.PI, TAU); m.closePath(); m.fill(); m.stroke();
      m.beginPath(); m.lineWidth = hair;
      m.arc(0, 0, R * 0.58, Math.PI, TAU); m.moveTo(-R * 0.58, 0); m.lineTo(R * 0.58, 0);
      const fine = R * DEG * s >= 1.4;
      for (let k = 0; k <= 180; k++) {
        if (!fine && k % 5) continue;
        const t = k * DEG, len = k % 10 === 0 ? 17 : k % 5 === 0 ? 12 : 7, c = Math.cos(t), sn = -Math.sin(t);
        m.moveTo(R * c, R * sn); m.lineTo((R - len) * c, (R - len) * sn);
      }
      m.stroke();
      for (let k = 0; k <= 180; k += 10) {
        const t = k * DEG, c = Math.cos(t), sn = -Math.sin(t);
        text(String(k), R * 0.8 * c, R * 0.8 * sn, fs, 'center', ink);
        if (k % 30 === 0 || R * s > 120) text(String(180 - k), R * 0.67 * c, R * 0.67 * sn, fs * 0.82, 'center', dark ? 'rgba(241,245,249,.7)' : 'rgba(29,63,143,.75)');
      }
      m.beginPath(); m.lineWidth = hair * 1.4; m.moveTo(-7, 0); m.lineTo(7, 0); m.moveTo(0, -7); m.lineTo(0, 7); m.stroke();
      // the arm and its reading
      const th = i.arm * DEG, c = Math.cos(th), sn = -Math.sin(th), len = R + 10;
      m.beginPath(); m.strokeStyle = ARM; m.lineWidth = 1.7 / s; m.moveTo(0, 0); m.lineTo(len * c, len * sn); m.stroke();
      m.beginPath(); m.arc(len * c, len * sn, 11 / s, 0, TAU); m.fillStyle = 'rgba(225,29,72,.28)'; m.fill(); m.strokeStyle = ARM; m.lineWidth = 1.6 / s; m.stroke();
      const lab = i.arm + '°', lw = fs * 2.6, lx = R * 0.38 * c, ly = R * 0.38 * sn;
      m.beginPath(); rr(m, lx - lw / 2, ly - fs * 0.85, lw, fs * 1.7, fs * 0.85); m.fillStyle = dark ? 'rgba(15,23,42,.85)' : 'rgba(255,255,255,.9)'; m.fill(); m.strokeStyle = ARM; m.lineWidth = hair; m.stroke();
      text(lab, lx, ly + 0.5, fs * 1.1, 'center', ARM);
    }
    if (act) {
      const [rx, ry] = sh.rot;
      m.beginPath(); m.arc(rx, ry, 11 / s, 0, TAU); m.fillStyle = 'rgba(245,158,11,.30)'; m.fill(); m.strokeStyle = ACC; m.lineWidth = 1.8 / s; m.stroke();
      const q = 4.6 / s;
      m.beginPath(); m.arc(rx, ry, q, -2.4, 0.9); m.lineWidth = 1.5 / s; m.stroke();
      m.beginPath(); m.moveTo(rx + q * Math.cos(0.9) + 2.4 / s, ry + q * Math.sin(0.9) - 1.8 / s); m.lineTo(rx + q * Math.cos(0.9), ry + q * Math.sin(0.9)); m.lineTo(rx + q * Math.cos(0.9) - 2.8 / s, ry + q * Math.sin(0.9) - 1.2 / s); m.stroke();
    }
    m.restore();
  }
  drawCompass(m, i, s, dark) {
    const g = compassGeo(i), ink = dark ? '#e2e8f0' : '#334155', metal = dark ? '#94a3b8' : '#cbd5e1';
    m.save();
    m.lineCap = 'round'; m.lineJoin = 'round';
    // the circle it would draw
    m.beginPath(); m.setLineDash([6 / s, 6 / s]); m.arc(g.P[0], g.P[1], i.r, 0, TAU); m.strokeStyle = dark ? 'rgba(226,232,240,.38)' : 'rgba(51,65,85,.32)'; m.lineWidth = 1 / s; m.stroke(); m.setLineDash([]);
    const leg = (X, lead) => {
      const dx = X[0] - g.H[0], dy = X[1] - g.H[1], l = hyp(dx, dy) || 1, nx = -dy / l, ny = dx / l, w0 = 5, w1 = 1.6;
      m.beginPath(); m.moveTo(g.H[0] + nx * w0, g.H[1] + ny * w0); m.lineTo(X[0] + nx * w1, X[1] + ny * w1); m.lineTo(X[0] - nx * w1, X[1] - ny * w1); m.lineTo(g.H[0] - nx * w0, g.H[1] - ny * w0); m.closePath();
      m.fillStyle = metal; m.fill(); m.strokeStyle = ink; m.lineWidth = 1 / s; m.stroke();
      if (lead) { const k = 26 / l; m.beginPath(); m.moveTo(X[0] - dx * k, X[1] - dy * k); m.lineTo(X[0], X[1]); m.strokeStyle = '#475569'; m.lineWidth = 3.4; m.stroke(); }
    };
    leg(g.P, false); leg(g.Q, true);
    // the hinge and its knob
    const ox = g.H[0] - (g.P[0] + g.Q[0]) / 2, oy = g.H[1] - (g.P[1] + g.Q[1]) / 2, ol = hyp(ox, oy) || 1;
    m.beginPath(); m.moveTo(g.H[0], g.H[1]); m.lineTo(g.H[0] + (ox / ol) * 22, g.H[1] + (oy / ol) * 22); m.lineWidth = 4; m.strokeStyle = ink; m.stroke();
    m.beginPath(); m.arc(g.H[0], g.H[1], 8.5, 0, TAU); m.fillStyle = metal; m.fill(); m.lineWidth = 1.2 / s; m.stroke();
    // the three things to take hold of
    const ring = (p, col) => { m.beginPath(); m.arc(p[0], p[1], 12 / s, 0, TAU); m.fillStyle = col.replace(')', ',.25)').replace('rgb', 'rgba'); m.fill(); m.strokeStyle = col; m.lineWidth = 1.7 / s; m.stroke(); };
    ring(g.P, 'rgb(37,99,235)'); ring(g.Q, 'rgb(245,158,11)'); ring(g.H, 'rgb(245,158,11)');
    const fs = Math.max(10, 10 / s), lab = 'r = ' + (Math.round((i.r / CM) * 10) / 10) + ' cm', lw = fs * 6.4;
    const lx = g.H[0] + (ox / ol) * 40, ly = g.H[1] + (oy / ol) * 40;
    m.beginPath(); rr(m, lx - lw / 2, ly - fs, lw, fs * 2, fs); m.fillStyle = dark ? 'rgba(15,23,42,.85)' : 'rgba(255,255,255,.92)'; m.fill(); m.strokeStyle = ink; m.lineWidth = 0.9 / s; m.stroke();
    m.fillStyle = ink; m.font = `${fs}px system-ui, sans-serif`; m.textAlign = 'center'; m.textBaseline = 'middle'; m.fillText(lab, lx, ly + 0.5);
    m.restore();
  }
}
