// Page layout of a book on the board: which page is on which side for every "spread" (what you see when the book is open at one place).
// A book starts CLOSED on its front cover (page 1 alone on the right) and ends CLOSED on its back cover (a virtual page, drawn by the book itself).
// A blank pad page is added when the last page would otherwise be left without a partner.
const cache = new Map();

export function bookModel(n) {
  n = Math.max(1, n | 0);
  let m = cache.get(n);
  if (m) return m;
  const padded = n % 2 === 0, M = padded ? n + 1 : n, BK = M + 1;
  const count = Math.floor(M / 2) + 2;
  const pagesOf = (sp) => {
    if (sp < 0 || sp >= count) return [0, 0];
    if (sp === 0) return [0, 1];
    if (sp === count - 1) return [BK, 0];
    const l = sp * 2, r = l + 1;
    return [l, r <= M ? r : 0];
  };
  const spreadOf = (p) => { p = Math.max(1, Math.min(n, p | 0)); return p === 1 ? 0 : Math.floor(p / 2); };
  const pageOf = (sp) => { const [l, r] = pagesOf(sp); return Math.min(n, r || l || 1); };
  m = { n, M, BK, count, padded, pagesOf, spreadOf, pageOf, last: count - 1 };
  if (cache.size > 40) cache.clear();
  cache.set(n, m);
  return m;
}

/** Where a page is drawn on the page-size grid: 'L' left, 'R' right. pw = width of one page. */
export const clampSp = (b) => { const m = bookModel(b.n); const sp = Number.isFinite(b.sp) ? b.sp | 0 : 0; return Math.max(0, Math.min(m.last, sp)); };

/** The visible part of a book as a box: closed on the front cover = right half, closed on the back cover = left half, otherwise both pages. */
export function bookBox(b, sp = clampSp(b)) {
  const m = bookModel(b.n), [l, r] = m.pagesOf(sp), pw = b.w / 2;
  const left = l ? b.x : b.x + pw, right = r ? b.x + b.w : b.x + pw;
  let x0 = left, x1 = right;
  if (b.rtl) { x0 = 2 * b.x + b.w - right; x1 = 2 * b.x + b.w - left; }
  // a hardcover sticks out a little and its pages' edges show on the sides and below
  if (b.st === '2d') return [x0, b.y, x1, b.y + b.h];
  return [x0 - pw * 0.09, b.y - pw * 0.07, x1 + pw * 0.09, b.y + b.h + pw * 0.12];
}

/** The strokes that can be seen: ink written on a book's page only shows while the book shows that page. `over` = books whose leaf is turning (id -> [l, r]). */
export function visibleStrokes(all, over = null) {
  let tagged = false;
  for (const s of all) if (s.bk) { tagged = true; break; }
  if (!tagged) return all;
  const shown = new Map();
  for (const s of all) if (s.t === 'book') shown.set(s.id, (over && over.get(s.id)) || bookModel(s.n).pagesOf(clampSp(s)));
  return all.filter((s) => { if (!s.bk) return true; const sh = shown.get(s.bk); return !!sh && (sh[0] === s.pg || sh[1] === s.pg); });
}
