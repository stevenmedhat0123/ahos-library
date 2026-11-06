// App shell: routing, dock, appearance, importing, install + update hooks.
import { h, isAndroid, isNative } from './util.js';
import { ic } from './icons.js';
import { mark } from './brand.js';
import { t, setLang, lang } from './i18n.js';
import { state, bootSettings, loadAll, onChange, onItemPatch, requestPersist, createFolder } from './store.js';
import { itemCard } from './views/shared.js';
import { startBackground, setMode, setScroll, refreshColors } from './bg.js';
import { initNav, setViewBack, nativeBack, actionSheet, toast, handleBack } from './ui.js';
import { onHardwareBack, exitApp } from './native.js';
import { pickFiles, importFiles } from './import.js';
import { newFolderDialog, unlockVault, lockVault } from './actions.js';
import { loadAppInfo, autoCheck } from './updater.js';
import { openUpdateSheet } from './views/update.js';
import { maybeShowWhatsNew, askNotificationsOnce } from './whatsnew.js';
import { ensureThumbs } from './covers.js';
import { initGate, whenGranted, startReminders } from './views/gate.js';
import { renderHome } from './views/home.js';
import { renderLibrary, libraryBack, lib } from './views/library.js';
import { renderSearch } from './views/search.js';
import { renderSettings } from './views/settings.js';
import { openItem } from './viewers/index.js';

let route = 'home';
let view, dock;
let deferredInstall = null;
const scrollMemo = {};

const ROUTES = {
  home: { render: (c) => renderHome(c), icon: 'home', label: 'navHome' },
  library: { render: (c) => renderLibrary(c), icon: 'library', label: 'navLibrary' },
  search: { render: (c) => renderSearch(c), icon: 'search', label: 'navSearch' },
  settings: { render: (c) => renderSettings(c), icon: 'settings', label: 'navSettings' },
};

const currentFolder = () => (route === 'library' ? lib.folderId : null);

/* ---------------- appearance ---------------- */
export function applyAppearance() {
  const s = state.settings;
  const root = document.documentElement;
  const dark = s.theme === 'dark' || (s.theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  root.dataset.theme = dark ? 'dark' : 'light';
  root.dataset.skin = s.skin || 'lapis'; root.dataset.accent = s.accent || 'gold'; root.dataset.fx = 'off';
  root.dataset.pb = ['none', 'clear', 'glass'].includes(s.playBtn) ? s.playBtn : 'none';
  const sk = { lapis: '#0B1233', midnight: '#060A1C', black: '#000000', violet: '#120A2E', emerald: '#061F1B', ruby: '#1F0914', ocean: '#04202E' };
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? (sk[s.skin] || '#0B1233') : '#F4EEDF');
  setMode(s.bg);
  refreshColors();
  document.title = 'AHOS Library';
  render();
}

/* ---------------- rendering ---------------- */
export function render({ keep = true, top = false } = {}) {
  if (!view) return;
  const prev = view.scrollTop;
  const el = ROUTES[route].render(ctx);
  view.replaceChildren(el);
  view.dataset.route = route;
  if (top) view.scrollTop = 0;
  else if (keep) view.scrollTop = prev;
  else view.scrollTop = scrollMemo[route] || 0;
  dock.querySelectorAll('[data-route]').forEach((b) => { const on = b.dataset.route === route; b.classList.toggle('on', on); b.setAttribute('aria-current', on ? 'page' : 'false'); });
  el.focusInput?.();
}

function refresh() {
  const cur = view.firstElementChild;
  if (cur && typeof cur.refresh === 'function') cur.refresh(); else render({ keep: true });
}

export function go(r) {
  if (!ROUTES[r]) return;
  if (r === route) { if (r === 'library' && (lib.folderId || lib.filter !== 'all')) { lib.folderId = null; lib.filter = 'all'; render({ top: true }); } else view.scrollTo({ top: 0, behavior: 'smooth' }); return; }
  scrollMemo[route] = view.scrollTop;
  route = r;
  render({ keep: false });
}

function openLibrary({ filter = 'all', sort, folderId = null } = {}) {
  lib.filter = filter; lib.folderId = folderId; lib.selecting = null; lib.limit = 60;
  if (sort) state.settings.sort = sort;
  scrollMemo.library = 0;
  scrollMemo[route] = view.scrollTop;
  route = 'library';
  render({ keep: false });
}

/* ---------------- adding ---------------- */
async function addFiles() {
  const files = await pickFiles();
  if (files.length) await importFiles(files, currentFolder());
}
async function addFolderFromDisk() {
  const files = await pickFiles({ directory: true });
  if (files.length) await importFiles(files, currentFolder());
}
async function newFolder() {
  const f = await newFolderDialog(currentFolder());
  if (f) toast(t('folderCreated'));
}

async function newBoard() {
  const { newBoardSheet } = await import('./board/sheets.js');
  newBoardSheet({ folderId: currentFolder(), onCreate: (id) => openItem(id) });
}

function addMenu() {
  actionSheet(t('addToLibrary'), [
    { icon: 'upload', label: t('addFiles'), hint: t('addFilesHint'), onClick: addFiles },
    !isAndroid() ? { icon: 'folder', label: t('addFolder'), hint: t('addFolderHint'), onClick: addFolderFromDisk } : null,
    { icon: 'bdPen', label: t('bd_new'), hint: t('bd_newSub'), onClick: newBoard },
    { icon: 'folderPlus', label: t('newFolder'), onClick: newFolder },
  ]);
}

async function filesFromDrop(dt) {
  const out = [];
  const walk = async (entry, path) => {
    if (entry.isFile) {
      const f = await new Promise((r) => entry.file(r));
      if (path) Object.defineProperty(f, 'webkitRelativePath', { value: path + f.name });
      out.push(f);
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      let batch;
      do {
        batch = await new Promise((r) => reader.readEntries(r));
        for (const e of batch) await walk(e, path + entry.name + '/');
      } while (batch.length);
    }
  };
  const entries = [...(dt.items || [])].map((i) => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean);
  for (const e of entries) await walk(e, '');
  return out.length ? out : [...dt.files];
}

/* ---------------- context handed to views ---------------- */
const ctx = {
  go, openLibrary, addFiles, newFolder, applyAppearance,
  rerender: (keep = true, top = false) => render({ keep, top }),
  openItem: (id, list) => openItem(id, list),
  toggleVault: async () => { if (state.vaultOpen) lockVault(); else await unlockVault(); },
  canInstall: () => !!deferredInstall && !window.matchMedia('(display-mode: standalone)').matches,
  install: async () => { if (!deferredInstall) return; deferredInstall.prompt(); await deferredInstall.userChoice.catch(() => {}); deferredInstall = null; render(); },
};

/* ---------------- shell ---------------- */
function buildShell() {
  const canvas = h('canvas', { id: 'bg', 'aria-hidden': 'true' });
  view = h('main', { id: 'view', tabindex: '-1' });
  const navBtn = (r) => h('button', { class: 'dock-btn', dataset: { route: r }, onClick: () => go(r), 'aria-label': t(ROUTES[r].label) },
    h('span', { class: 'dock-ic', html: ic(ROUTES[r].icon) }), h('span', { class: 'dock-lb' }, t(ROUTES[r].label)));
  dock = h('nav', { class: 'dock', 'aria-label': 'Main' },
    navBtn('home'), navBtn('library'),
    h('button', { class: 'dock-add', 'aria-label': t('add'), onClick: addMenu, html: ic('plus') }),
    navBtn('search'), navBtn('settings'));
  const splash = h('div', { class: 'splash', 'aria-hidden': 'true' },
    h('div', { class: 'splash-mark', html: mark() }),
    h('div', { class: 'splash-name' }, 'AHOS', h('small', null, 'Library')));
  const drop = h('div', { class: 'drop-hint' }, h('div', { html: ic('upload') }), h('b', null, t('dropHere')));
  document.getElementById('app').replaceChildren(canvas, view, dock, drop, splash);
  return { canvas, splash, drop };
}

export async function boot() {
  let wasInstalled = false;
  try { wasInstalled = !!localStorage.getItem('ahos.settings'); } catch { /* ignore */ }
  const boot0 = bootSettings();
  setLang(boot0.lang);
  state.settings = { ...state.settings, ...boot0 };
  document.documentElement.dataset.theme = boot0.theme === 'light' || (boot0.theme === 'auto' && !matchMedia('(prefers-color-scheme: dark)').matches) ? 'light' : 'dark';

  const { canvas, splash, drop } = buildShell();
  startBackground(canvas);
  setMode(boot0.bg);

  initNav();
  setViewBack(() => {
    if (route === 'library' && libraryBack(ctx)) return true;
    if (route !== 'home') { go('home'); return true; }
    return false;
  });
  onHardwareBack(() => nativeBack(exitApp));

  await Promise.all([loadAll(), loadAppInfo()]);
  setLang(state.settings.lang);
  // rebuild shell labels in the final language, then apply the saved look
  buildDockLabels();
  applyAppearance();

  await initGate(ctx);

  onChange(refresh);
  // a preview or duration arrived for some items: rebuild just those cards where they are on screen
  onItemPatch((ids) => {
    for (const id of ids) {
      const it = state.items.get(id);
      if (!it) continue;
      view.querySelectorAll(`.card[data-id="${CSS.escape(id)}"]`).forEach((el) => {
        const mode = ['grid', 'list', 'wide', 'mini'].find((m) => el.classList.contains('m-' + m)) || 'grid';
        el.replaceWith(itemCard(it, { mode, selecting: el.classList.contains('selecting'), selected: el.classList.contains('selected') }));
      });
    }
  });
  let sTick = false;
  view.addEventListener('scroll', () => { if (sTick) return; sTick = true; requestAnimationFrame(() => { sTick = false; setScroll(view.scrollTop); }); }, { passive: true });

  // splash
  setTimeout(() => splash.classList.add('out'), 450);
  setTimeout(() => splash.remove(), 950);

  // drag & drop (desktop)
  let dragDepth = 0;
  window.addEventListener('dragenter', (e) => { if (e.dataTransfer?.types?.includes('Files')) { dragDepth++; document.documentElement.classList.add('dragging'); } });
  window.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) document.documentElement.classList.remove('dragging'); });
  window.addEventListener('dragover', (e) => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault(); });
  window.addEventListener('drop', async (e) => {
    if (!e.dataTransfer?.files?.length) return;
    e.preventDefault(); dragDepth = 0; document.documentElement.classList.remove('dragging');
    const files = await filesFromDrop(e.dataTransfer);
    if (files.length) importFiles(files, currentFolder());
  });
  void drop;

  // hidden folders lock again after being away
  let hiddenAt = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) hiddenAt = Date.now();
    else if (state.vaultOpen && hiddenAt && Date.now() - hiddenAt > 90000) lockVault();
  });

  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredInstall = e; if (route === 'settings') render(); });
  window.addEventListener('appinstalled', () => { deferredInstall = null; toast(t('installed')); });

  requestPersist();
  registerSW();
  autoCheck((release) => openUpdateSheet(release));
  // pictures for anything that came out without one (retries quietly, a couple of times at most)
  whenGranted(() => setTimeout(() => { ensureThumbs().catch((e) => console.warn('previews', e)); }, 5000));
  whenGranted(startReminders);
  // after an update: what changed, once; otherwise (once only) the question about notifications
  whenGranted(() => setTimeout(() => { if (!maybeShowWhatsNew(wasInstalled)) askNotificationsOnce(); }, 1600));
}

function buildDockLabels() {
  dock.querySelectorAll('[data-route]').forEach((b) => {
    const r = b.dataset.route;
    b.setAttribute('aria-label', t(ROUTES[r].label));
    b.querySelector('.dock-lb').textContent = t(ROUTES[r].label);
  });
  dock.querySelector('.dock-add')?.setAttribute('aria-label', t('add'));
  document.querySelector('.drop-hint b').textContent = t('dropHere');
}

function registerSW() {
  if (!('serviceWorker' in navigator) || isNative() || !/^https?:$/.test(location.protocol)) return;
  navigator.serviceWorker.register('sw.js').then((reg) => {
    if (!reg) return;
    reg.addEventListener('updatefound', () => {
      const nw = reg.installing;
      nw?.addEventListener('statechange', () => {
        if (nw.state === 'installed' && navigator.serviceWorker.controller) {
          toast(t('newVersionReady'), { action: t('reload'), onAction: () => { nw.postMessage('skip'); }, ms: 12000 });
        }
      });
    });
  }).catch((e) => console.warn('SW failed', e));
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (reloaded || !hadController) return; reloaded = true; location.reload(); });
}

export { lang, createFolder, handleBack };
