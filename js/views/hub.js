// The Hub – the first screen: a row of big section tiles you swipe through like a console's home menu. The tile in the middle is the
// chosen one: it grows, the background takes its colour, an animated picture and a short description of the section appear behind it.
import { h } from '../util.js';
import { ic } from '../icons.js';
import { mark } from '../brand.js';
import { t } from '../i18n.js';
import { state, visibleItems } from '../store.js';
import { visibleSections, shapeFor, moveSection, isHiddenHere, sectionById } from '../sections.js';
import { toast } from '../ui.js';
import { artFor, tileArt, ensureShapeDefs } from '../hubart.js';
import { inboxUnread, onInbox, openInbox } from '../bell.js';
import { rotationMode, toggleRotation, rotationAvailable } from '../native.js';
import { sfx } from '../sound.js';
import { isBoard, dayKey } from '../board/io.js';

let lastId = '';              // the tile the Hub was on, so coming back lands on it (empty: the first one)
let arranging = false;        // "move the tiles" mode (press and hold a tile): the arrows swap it with its neighbour
let rearm = false;            // a move re-draws the Hub; this keeps the mode on through that one re-draw only
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/* ---------- the little panel under the description: what is useful for the chosen section ---------- */
const chip = (icon, label, onClick) => h(onClick ? 'button' : 'span', { class: 'hub-chip', type: onClick ? 'button' : null, onClick }, h('span', { html: ic(icon) }), label);

const emptyHint = () => h('p', { class: 'hub-hint' }, t('hub_empty'));

function panelFor(id, ctx) {
  const items = visibleItems();
  // The Hub only shows a few facts about a section; the files themselves (recent videos, boards, notes) are inside the section.
  const count = (f) => items.filter(f).length;
  const def = sectionById(id);
  if (def && def.kinds) {                       // Videos / Photos / Audio / PDFs & files: how many there are
    const chips = def.kinds.map((k) => [k, count((i) => i.kind === k && !isBoard(i))]).filter(([, n]) => n);
    return chips.length ? h('div', { class: 'hub-chips' }, chips.map(([k, n]) => chip(k, `${t('kinds_' + k)} · ${n}`))) : emptyHint();
  }
  if (id === 'player') {
    const kinds = ['video', 'audio', 'book', 'image'].map((k) => [k, count((i) => i.kind === k && !isBoard(i))]).filter(([, n]) => n);
    return kinds.length ? h('div', { class: 'hub-chips' }, kinds.map(([k, n]) => chip(k, `${t('kinds_' + k)} · ${n}`))) : emptyHint();
  }
  if (id === 'board') { const n = count((i) => isBoard(i) && !i.meta?.note); return n ? h('div', { class: 'hub-chips' }, chip('bdPen', t('hub_cnt_boards', { n }))) : emptyHint(); }
  if (id === 'note') { const n = count((i) => isBoard(i) && i.meta?.note); return n ? h('div', { class: 'hub-chips' }, chip('daily', t('hub_cnt_notes', { n }))) : emptyHint(); }
  if (id === 'calc') return h('div', { class: 'hub-chips' }, ['calc_t_sci', 'calc_t_base', 'calc_t_eq', 'calc_t_graph', 'calc_t_conv'].map((k) => chip('calc', t(k))));
  if (id === 'settings') return h('div', { class: 'hub-chips' }, [['sun', 'hub_set_look'], ['speaker', 'hub_set_sound'], ['rotate', 'hub_set_rotate']].map(([i, k]) => chip(i, t(k), () => ctx.openSection('settings', { fromHub: true }))));
  return null;
}

/* ---------- the screen ---------- */
export function renderHub(ctx) {
  arranging = rearm; rearm = false;
  const list = visibleSections();
  // the row always runs left → right, like a console's menu, in Arabic too: the first section is at the left end, Settings is the last one at the right end
  const rtl = false;
  const sign = 1;
  const textDir = document.documentElement.dir || 'ltr';
  const root = h('div', { class: 'screen hub' + (arranging ? ' arranging' : '') });
  let idx = Math.max(0, list.findIndex((s) => s.id === lastId));
  let pitch = 0;
  let opening = false;
  let swallow = false;          // the click that ends a long press must not also open the section

  // header: brand on one side; bell (red badge), the rotate button (rotation mode "button") on the other
  const badge = h('span', { class: 'hub-badge', hidden: true });
  let shown = false;            // the first paint happens before the Hub is on the page; only stop listening once it has been shown and then removed
  const paintBell = () => {
    if (root.isConnected) shown = true; else if (shown) { off(); return; }
    const n = inboxUnread();
    badge.textContent = n > 99 ? '99+' : String(n);
    badge.hidden = !n;
  };
  const off = onInbox(paintBell);
  const header = h('header', { class: 'hub-top' },
    h('div', { class: 'brand' }, h('span', { class: 'brand-mark', html: mark() }), h('span', { class: 'brand-name' }, 'AHOS', h('small', null, 'Library'))),
    h('div', { class: 'top-actions' },
      rotationAvailable() && rotationMode() === 'button' ? h('button', { class: 'icon-btn', 'aria-label': t('rot_button'), onClick: () => { sfx('tab'); toggleRotation(); }, html: ic('rotate') }) : null,
      h('button', { class: 'icon-btn hub-bell', 'aria-label': t('bell_title'), onClick: () => { sfx('open'); openInbox(); } }, h('span', { html: ic('bell') }), badge)));

  // the row of tiles (each: its own colour and outline, its name written under it)
  const row = h('div', { class: 'hub-row', role: 'listbox', 'aria-label': t('hub_sections'), dir: 'ltr' });
  const tiles = list.map((s, i) => h('button', {
    class: 'hub-tile' + (isHiddenHere(s.id) ? ' was-hidden' : ''), type: 'button', role: 'option', 'aria-selected': 'false', tabindex: '-1', dir: textDir,
    dataset: { id: s.id }, style: { '--g1': s.g[0], '--g2': s.g[1] },
    onClick: () => { if (swallow) { swallow = false; return; } if (arranging) { centre(i, true); setFocus(i, { focus: true }); } else pick(i); },
  },
  h('span', { class: 'hub-box' }, h('span', { class: 'hub-shape', dataset: { sh: shapeFor(s.id) } }, h('span', { class: 'hub-ic', html: tileArt(s.id) }))),
  h('span', { class: 'hub-name' }, t('sec_' + s.id)),
  isHiddenHere(s.id) ? h('span', { class: 'hub-hid' }, t('sm_hiddenTag')) : null));
  row.append(...tiles);

  // the stage under the row: glow, animated picture, description, and the section's own little panel
  const glows = [h('div', { class: 'hub-glow' }), h('div', { class: 'hub-glow' })];
  let gi = 0;
  const art = h('div', { class: 'hub-art' });
  const sub = h('p', { class: 'hub-sub' });
  const panel = h('section', { class: 'hub-panel' });
  const mvL = h('button', { class: 'icon-btn arr-mv', type: 'button', 'aria-label': t('hub_arrLeft'), onClick: () => move(-1), html: ic('back') });
  const mvR = h('button', { class: 'icon-btn arr-mv', type: 'button', 'aria-label': t('hub_arrRight'), onClick: () => move(1), html: ic('chev') });
  const arrBar = h('div', { class: 'hub-arrange', hidden: !arranging },
    h('p', { class: 'hub-arr-hint' }, t('hub_arrHint')),
    h('div', { class: 'hub-arr-btns' }, mvL, h('button', { class: 'btn primary', type: 'button', onClick: () => doneArrange() }, t('hub_arrDone')), mvR),
    h('button', { class: 'hub-chip', type: 'button', onClick: () => import('./hubui.js').then((m) => m.openSectionsManager(ctx)) }, h('span', { html: ic('grid') }), t('sm_title')));
  const stage = h('div', { class: 'hub-stage' }, h('div', { class: 'hub-desc' }, sub, arrBar), art, panel);
  ensureShapeDefs();
  root.append(...glows, header, row, stage);

  const showGlow = (s) => {
    gi ^= 1;
    glows[gi].style.background = `radial-gradient(80% 52% at 50% 18%, color-mix(in srgb, ${s.g[0]} 42%, transparent), transparent 72%), radial-gradient(70% 46% at 88% 96%, color-mix(in srgb, ${s.g[1]} 32%, transparent), transparent 70%)`;
    glows[gi].classList.add('on'); glows[gi ^ 1].classList.remove('on');
  };
  const showArt = (s) => {
    const el = h('div', { class: 'hub-art-in', style: { '--g1': s.g[0], '--g2': s.g[1] }, html: artFor(s.id) });
    [...art.children].forEach((c) => { c.classList.remove('in'); c.classList.add('out'); setTimeout(() => c.remove(), 420); });
    art.append(el);
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('in')));
  };
  let tArt = 0; let tPanel = 0;
  const showPanel = () => {
    const s = list[idx]; if (!s) return;
    const el = panelFor(s.id, ctx);
    panel.replaceChildren(...(el ? [el] : []));
    panel.classList.toggle('empty', !el);
    panel.classList.remove('in'); void panel.offsetWidth; panel.classList.add('in');
  };

  const paintArr = (i = idx) => { mvL.disabled = i <= 0; mvR.disabled = i >= list.length - 1; };
  function move(d) {
    const id = list[idx].id;
    if (!moveSection(id, d)) { sfx('error'); return; }
    sfx('tab'); lastId = id; rearm = true; ctx.rerender();
  }
  function startArrange(i) {
    if (arranging) return;
    arranging = true;
    if (i !== idx) setFocus(i, { silent: true });
    centre(i, true);
    root.classList.add('arranging'); arrBar.hidden = false; paintArr(i);
    sfx('on');
    try { navigator.vibrate && navigator.vibrate(12); } catch { /* no vibration here */ }
  }
  function doneArrange() { arranging = false; root.classList.remove('arranging'); arrBar.hidden = true; sfx('off'); }

  // press and hold a tile → move mode
  let lp = 0; let lpX = 0; let lpY = 0;
  row.addEventListener('pointerdown', (e) => {
    const tl = e.target.closest && e.target.closest('.hub-tile');
    if (!tl || arranging) return;
    lpX = e.clientX; lpY = e.clientY; swallow = false;
    clearTimeout(lp);
    lp = setTimeout(() => { swallow = true; startArrange(tiles.indexOf(tl)); }, 520);
  }, { passive: true });
  row.addEventListener('pointermove', (e) => { if (Math.abs(e.clientX - lpX) > 9 || Math.abs(e.clientY - lpY) > 9) clearTimeout(lp); }, { passive: true });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach((ev) => row.addEventListener(ev, () => clearTimeout(lp), { passive: true }));
  row.addEventListener('contextmenu', (e) => e.preventDefault());

  function setFocus(i, { silent = false, focus = false } = {}) {
    if (i < 0 || i >= list.length) return;
    const same = i === idx && tiles[i].classList.contains('on');
    tiles.forEach((el, k) => { const on = k === i; el.classList.toggle('on', on); el.setAttribute('aria-selected', String(on)); el.tabIndex = on ? 0 : -1; });
    paintArr(i);
    if (focus) tiles[i].focus({ preventScroll: true });
    if (same) return;
    const moved = i !== idx;
    idx = i; lastId = list[i].id;
    if (moved && !silent) sfx('move');
    const s = list[i];
    sub.textContent = t('sec_' + s.id + '_s');
    sub.classList.remove('in'); void sub.offsetWidth; sub.classList.add('in');
    showGlow(s);
    clearTimeout(tArt); tArt = setTimeout(() => showArt(s), silent ? 0 : 70);
    clearTimeout(tPanel); tPanel = setTimeout(showPanel, silent ? 0 : 200);
  }

  const measure = () => { if (tiles.length > 1) pitch = Math.abs(tiles[1].offsetLeft - tiles[0].offsetLeft); else pitch = tiles[0]?.offsetWidth || 1; return pitch; };
  const centre = (i, smooth) => row.scrollTo({ left: sign * i * (pitch || measure()), behavior: smooth ? 'smooth' : 'auto' });

  let ticking = false;
  row.addEventListener('scroll', () => {
    clearTimeout(lp);
    if (ticking) return; ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      const p = pitch || measure();
      setFocus(clamp(Math.round(Math.abs(row.scrollLeft) / p), 0, list.length - 1));
    });
  }, { passive: true });
  row.addEventListener('keydown', (e) => {
    const k = e.key;
    if (arranging) {
      if (k === 'ArrowLeft') { e.preventDefault(); move(-1); } else if (k === 'ArrowRight') { e.preventDefault(); move(1); } else if (k === 'Escape' || k === 'Enter') { e.preventDefault(); doneArrange(); }
      return;
    }
    let to = idx;
    if (k === 'ArrowRight') to = idx + (rtl ? -1 : 1);
    else if (k === 'ArrowLeft') to = idx + (rtl ? 1 : -1);
    else if (k === 'Home') to = 0; else if (k === 'End') to = list.length - 1;
    else return;
    e.preventDefault();
    to = clamp(to, 0, list.length - 1);
    if (to !== idx) { centre(to, true); setFocus(to, { focus: true }); }
  });

  function pick(i) {
    if (opening) return;
    opening = true;
    sfx('open');
    if (i !== idx) { setFocus(i, { silent: true }); }
    centre(i, true);
    root.classList.add('opening'); tiles[i].classList.add('go');
    setTimeout(() => { opening = false; root.classList.remove('opening'); tiles[i].classList.remove('go'); }, 700);
    setTimeout(() => ctx.openSection(list[i].id, { fromHub: true }), 190);
  }

  // first paint: land on the remembered tile without animating
  requestAnimationFrame(() => { measure(); centre(idx, false); setFocus(idx, { silent: true, focus: arranging }); });
  try {                                                                    // once: how to move the tiles around
    if (!arranging && !localStorage.getItem('ahos.hubTip')) { localStorage.setItem('ahos.hubTip', '1'); setTimeout(() => { if (root.isConnected) toast(t('hub_tip'), { ms: 4200 }); }, 2600); }
  } catch { /* storage may be blocked */ }
  if (typeof ResizeObserver === 'function') new ResizeObserver(() => { if (root.isConnected) { measure(); centre(idx, false); } }).observe(row);
  const sig = list.map((s) => s.id).join();
  // a setting changed what the row holds (the merged Player, a hidden section…): draw the row again; otherwise only the bell and the panel
  root.refresh = () => { if (visibleSections().map((s) => s.id).join() !== sig) { ctx.rerender(true); return; } paintBell(); if (!opening) showPanel(); };
  paintBell();
  return root;
}
