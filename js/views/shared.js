// Cards, grids and interaction wiring shared by Home, Library and Search.
import { h, fmtBytes, fmtDur, stripExt, ltr } from '../util.js';
import { ic, kindIcon } from '../icons.js';
import { coverEl, folderArt } from '../covers.js';
import { t } from '../i18n.js';
import { state, countIn, childFolders } from '../store.js';

export function subLine(it) {
  const m = it.meta || {};
  const parts = [];
  if ((it.kind === 'video' || it.kind === 'audio') && m.duration && isFinite(m.duration)) parts.push(fmtDur(m.duration));
  else if (it.kind === 'book' && m.pages) parts.push(t('nPages', { n: m.pages }));
  else if (it.kind === 'book' && m.author) parts.push(m.author);
  else if (it.kind === 'image' && m.w) parts.push(ltr(`${m.w}×${m.h}`));
  parts.push(fmtBytes(it.size));
  return parts.join(' · ');
}

export function progressFrac(it) {
  const f = it.progress?.f;
  return typeof f === 'number' && f > 0.004 ? Math.min(1, f) : 0;
}

export function displayName(it) {
  return it.kind === 'book' && it.meta?.title ? it.meta.title : stripExt(it.name);
}

/**
 * mode: 'grid' | 'list' | 'wide' | 'mini'
 */
export function itemCard(it, { mode = 'grid', selecting = false, selected = false } = {}) {
  const frac = progressFrac(it);
  const card = h('div', {
    class: `card m-${mode}` + (selected ? ' selected' : '') + (selecting ? ' selecting' : ''),
    dataset: { id: it.id, kind: it.kind }, tabindex: '0', role: 'button', 'aria-label': it.name,
  });
  const cover = coverEl(it);
  const badges = h('div', { class: 'badges' });
  if (mode !== 'list') badges.append(h('span', { class: 'kind-badge', html: ic(kindIcon[it.kind] || 'file') }));
  if (frac >= 0.98) badges.append(h('span', { class: 'done-badge', html: ic('check') }));
  if (it.fav) badges.append(h('i', { class: 'fav-dot', html: ic('star') }));
  cover.append(badges);
  if ((it.kind === 'video' || it.kind === 'audio') && it.meta?.duration && isFinite(it.meta.duration) && mode !== 'list') {
    cover.append(h('span', { class: 'dur' }, fmtDur(it.meta.duration)));
  }
  if (frac && frac < 0.98) cover.append(h('div', { class: 'prog' }, h('i', { style: { width: Math.round(frac * 100) + '%' } })));
  card.append(cover);

  const cap = h('div', { class: 'cap' },
    h('div', { class: 'nm', dir: 'auto' }, displayName(it)),
    h('div', { class: 'sub' }, subLine(it)));
  card.append(cap);
  card.append(h('button', { class: 'more', 'aria-label': t('more'), html: ic('more') }));
  card.append(h('span', { class: 'check', html: ic('check') }));
  return card;
}

export function folderTile(f, { selecting = false } = {}) {
  const { n } = countIn(f.id);
  const subs = childFolders(f.id).length;
  const tile = h('div', { class: 'ftile', dataset: { fid: f.id }, tabindex: '0', role: 'button', style: { '--fc': f.color } },
    h('div', { class: 'f-art', html: folderArt(f) }),
    h('div', { class: 'f-ic', html: ic(f.locked ? 'lock' : 'folder') }),
    h('div', { class: 'f-txt' },
      h('div', { class: 'f-nm', dir: 'auto' }, f.name),
      h('div', { class: 'f-sub' }, subs ? `${t('nItems', { n })} · ${t('nFolders', { n: subs })}` : t('nItems', { n }))),
    h('button', { class: 'more f-more', 'aria-label': t('more'), html: ic('more') }));
  if (selecting) tile.classList.add('dim');
  return tile;
}

/** Wire tap / long-press / "more" on every .card inside root. */
export function wireCards(root, api) {
  let timer = 0, sx = 0, sy = 0, fired = false;
  const cancel = () => clearTimeout(timer);
  root.addEventListener('pointerdown', (e) => {
    const c = e.target.closest('.card');
    if (!c || e.target.closest('.more')) return;
    fired = false; sx = e.clientX; sy = e.clientY;
    timer = setTimeout(() => { fired = true; try { navigator.vibrate?.(14); } catch { /* ignore */ } api.longPress?.(c.dataset.id, c); }, 460);
  });
  root.addEventListener('pointermove', (e) => { if (Math.abs(e.clientX - sx) > 9 || Math.abs(e.clientY - sy) > 9) cancel(); });
  root.addEventListener('pointerup', cancel);
  root.addEventListener('pointercancel', cancel);
  root.addEventListener('contextmenu', (e) => { if (e.target.closest('.card')) e.preventDefault(); });
  root.addEventListener('click', (e) => {
    const more = e.target.closest('.more');
    const fTile = e.target.closest('.ftile');
    if (fTile) {
      e.stopPropagation();
      if (more) api.folderMore?.(fTile.dataset.fid); else api.openFolder?.(fTile.dataset.fid);
      return;
    }
    if (more) { e.stopPropagation(); const mc = more.closest('.card'); api.more?.(mc.dataset.id, mc); return; }
    const c = e.target.closest('.card');
    if (!c) return;
    if (fired) { fired = false; return; }
    if (api.selecting?.()) api.toggle?.(c.dataset.id); else api.open?.(c.dataset.id);
  });
  root.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const el = e.target.closest('.card, .ftile');
    if (el && e.target === el) { e.preventDefault(); el.click(); }
  });
}

export function emptyState({ icon = 'sparkle', title, text, action }) {
  return h('div', { class: 'empty' },
    h('div', { class: 'empty-art', html: ic(icon) }),
    h('h3', null, title),
    text ? h('p', null, text) : null,
    action || null);
}

export function sectionHead(title, { action, onAction } = {}) {
  return h('div', { class: 'sec-head' }, h('h2', null, title),
    action ? h('button', { class: 'link', onClick: onAction }, action) : null);
}

export const anyItems = () => state.items.size > 0;
