// Search across names, tags, authors and titles.
import { h } from '../util.js';
import { ic } from '../icons.js';
import { t } from '../i18n.js';
import { visibleItems, folderPath } from '../store.js';
import { itemCard, wireCards, emptyState } from './shared.js';
import { itemActions } from '../actions.js';

const S = { q: '', kind: 'all' };
/** Lets the Home search bar hand its text over to this screen. */
export function setSearchQuery(q) { S.q = String(q || ''); S.kind = 'all'; }
const KINDS = ['all', 'video', 'image', 'book', 'audio', 'file'];

const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[ً-ٰٟ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه');

function run() {
  const q = norm(S.q.trim());
  if (!q) return [];
  const words = q.split(/\s+/).filter(Boolean);
  const out = [];
  for (const it of visibleItems()) {
    if (S.kind !== 'all' && it.kind !== S.kind) continue;
    const hay = norm([it.name, it.meta?.title, it.meta?.author, (it.tags || []).join(' '), it.ext, folderPath(it.folderId).map((f) => f.name).join(' ')].join(' '));
    if (!words.every((w) => hay.includes(w))) continue;
    const nm = norm(it.name);
    out.push({ it, score: (nm.startsWith(q) ? 3 : nm.includes(q) ? 2 : 1) });
  }
  return out.sort((a, b) => b.score - a.score || (b.it.added || 0) - (a.it.added || 0)).slice(0, 200).map((x) => x.it);
}

export function renderSearch(ctx) {
  const root = h('div', { class: 'screen search' });
  const input = h('input', { class: 'search-input', type: 'search', placeholder: t('searchPlaceholder'), value: S.q, enterkeyhint: 'search', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', dir: 'auto' });
  const results = h('div', { class: 'results' });
  const chipsEl = h('div', { class: 'chips' });
  let ids = [];

  const drawChips = () => chipsEl.replaceChildren(...KINDS.map((k) =>
    h('button', { class: 'chip' + (S.kind === k ? ' on' : ''), onClick: () => { S.kind = k; drawChips(); draw(); } }, k === 'all' ? t('all') : t('kinds_' + k))));

  const draw = () => {
    const found = run();
    ids = found.map((i) => i.id);
    results.replaceChildren();
    if (!S.q.trim()) { results.append(emptyState({ icon: 'search', title: t('searchTitle'), text: t('searchHint') })); return; }
    if (!found.length) { results.append(emptyState({ icon: 'search', title: t('noResults'), text: t('noResultsText', { q: S.q.trim() }) })); return; }
    results.append(h('div', { class: 'res-count' }, t('nResults', { n: found.length })), h('div', { class: 'list' }, found.map((i) => itemCard(i, { mode: 'list' }))));
  };

  input.addEventListener('input', () => { S.q = input.value; draw(); });
  root.append(
    h('header', { class: 'top search-top' },
      h('button', { class: 'icon-btn', 'aria-label': t('back'), onClick: () => ctx.go('home'), html: ic('back', 'flip-rtl') }),
      h('div', { class: 'search-box' }, h('span', { html: ic('search') }), input,
        h('button', { class: 'icon-btn sm', 'aria-label': t('clear'), onClick: () => { S.q = ''; input.value = ''; draw(); input.focus(); }, html: ic('close') }))),
    chipsEl, results);
  drawChips(); draw();

  wireCards(root, {
    selecting: () => false,
    open: (id) => ctx.openItem(id, ids),
    more: (id) => itemActions(id, { onOpen: () => ctx.openItem(id, ids) }),
  });
  root.refresh = draw;
  return root;
}
