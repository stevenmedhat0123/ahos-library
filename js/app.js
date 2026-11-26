// App shell: routing, dock, appearance, importing, install + update hooks.
import { h, isAndroid, isNative } from './util.js';
import { ic } from './icons.js';
import { mark } from './brand.js';
import { t, setLang, lang } from './i18n.js';
import { state, bootSettings, loadAll, onChange, onItemPatch, dataVersion, requestPersist, createFolder } from './store.js';
import { itemCard } from './views/shared.js';
import { startBackground, setMode, setScroll, refreshColors, setStyle } from './bg.js';
import { getBlob, replaceBlob, setSetting } from './store.js';
import { initNav, setViewBack, nativeBack, actionSheet, toast, handleBack } from './ui.js';
import { onHardwareBack, exitApp, setFullscreenSetting, reapplyFullscreen, setRotationMode, chromeSync } from './native.js';
import { primeSound, sfx } from './sound.js';
import { renderHub } from './views/hub.js';
import { renderSectionPage } from './views/section.js';
import { playIntro, stopIntro } from './intro.js';
import { sectionById } from './sections.js';
import { dayKey, isBoard } from './board/io.js';
import { pickFiles, importFiles } from './import.js';
import { folderPickerAvailable } from './native.js';
import { newFolderDialog, unlockVault, lockVault, itemActions } from './actions.js';
import { loadAppInfo, autoCheck } from './updater.js';
import { openUpdateSheet } from './views/update.js';
import { maybeShowWhatsNew, askNotificationsOnce } from './whatsnew.js';
import { ensureThumbs } from './covers.js';
import { initGate, whenGranted, startReminders } from './views/gate.js';
import { startFeed } from './feed.js';
import { renderHome } from './views/home.js';
import { bulkImportAvailable, openBulkImport } from './mediaimport.js';
import { renderLibrary, libraryBack, lib } from './views/library.js';
import { renderSearch } from './views/search.js';
import { renderSettings, settingsBack, openSettingsCategory } from './views/settings.js';
import { kindFolderUp, setKindFolder } from './views/kindstate.js';
import { openItem } from './viewers/index.js';

let route = 'home';
let secId = null;           // the section shown while route === 'sec'
let hubOrigin = false;      // the current page was opened from the Hub, so Back returns there
let secParent = null;     // the section this one was opened from (a media page inside the merged Player), so Back returns there instead of the Hub
let retSec = null;        // Library / Search opened from a section: { id, parent } – Back returns to that section
let view, dock;
let deferredInstall = null;
const scrollMemo = {};

const ROUTES = {
  hub: { render: (c) => renderHub(c) },
  sec: { render: (c) => renderSectionPage(c, sectionById(secId)) },
  home: { render: (c) => renderHome(c), icon: 'home', label: 'navHome' },
  library: { render: (c) => renderLibrary(c), icon: 'library', label: 'navLibrary' },
  search: { render: (c) => renderSearch(c), icon: 'search', label: 'navSearch' },
  settings: { render: (c) => renderSettings(c), icon: 'settings', label: 'navSettings' },
};

const currentFolder = () => (route === 'library' ? lib.folderId : null);

/* ---------------- appearance ---------------- */
// The background picture the person chose lives in the same IndexedDB as the library (key '__bgimg'); an object URL points the page at it.
let bgUrl = null;
async function loadBgPicture() {
  try { const b = await getBlob('__bgimg'); if (b) bgUrl = URL.createObjectURL(b); } catch { /* no picture */ }
}
/** Takes a picture file, scales it to at most 1600 px and keeps it as the app background. Returns true when it worked. */
export async function setBgPicture(file) {
  try {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const cv = document.createElement('canvas'); cv.width = Math.max(1, Math.round(bmp.width * k)); cv.height = Math.max(1, Math.round(bmp.height * k));
    cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height); bmp.close?.();
    const blob = await new Promise((res) => cv.toBlob(res, 'image/jpeg', 0.86));
    if (!blob) return false;
    await replaceBlob('__bgimg', blob);
    if (bgUrl) URL.revokeObjectURL(bgUrl);
    bgUrl = URL.createObjectURL(blob);
    return true;
  } catch (e) { console.warn('background picture', e); return false; }
}
export async function removeBgPicture() {
  try { await replaceBlob('__bgimg', null); } catch { /* ignore */ }
  if (bgUrl) URL.revokeObjectURL(bgUrl);
  bgUrl = null;
}
export const hasBgPicture = () => !!bgUrl;
export function applyAppearance() {
  const s = state.settings;
  const root = document.documentElement;
  const dark = s.theme === 'dark' || (s.theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  root.dataset.theme = dark ? 'dark' : 'light';
  root.dataset.skin = s.skin || 'lapis'; root.dataset.accent = s.accent || 'gold'; root.dataset.fx = 'off';
  root.dataset.pb = ['none', 'clear', 'glass'].includes(s.playBtn) ? s.playBtn : 'none';
  root.dataset.hubmotion = s.hubMotion === false ? 'off' : 'on';
  setRotationMode(s.rotation);
  const sk = { lapis: '#0B1233', midnight: '#060A1C', black: '#000000', violet: '#120A2E', emerald: '#061F1B', ruby: '#1F0914', ocean: '#04202E' };
  const skl = { lapis: '#F4EEDF', midnight: '#EEF1F7', black: '#FAFAFB', violet: '#F3EFFC', emerald: '#ECF6F2', ruby: '#FBEFF2', ocean: '#E9F4FA' };
  const pageBg = dark ? (sk[s.skin] || '#0B1233') : (skl[s.skin] || '#F4EEDF');
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', pageBg);
  chromeSync({ bg: pageBg, light: !dark, cutout: s.cutout });   // the window around the page wears the page's colour (also the bar the phone keeps around the camera)
  setMode(s.bg);
  refreshColors();
  setStyle(s.bgStyle || 'shine', { shapes: s.bgShapes || 'mix', image: bgUrl, dim: typeof s.bgDim === 'number' ? s.bgDim : 0.55 });
  document.title = 'AHOS Library';
  setFullscreenSetting(!!s.fullscreen);
  render();
}

/* ---------------- rendering ---------------- */
export function render({ keep = true, top = false } = {}) {
  drawn = dataVersion();
  if (!view) return;
  const prev = view.scrollTop;
  const el = ROUTES[route].render(ctx);
  const changed = view.dataset.route !== route;
  if (changed && el.classList) el.classList.add('enter');
  view.replaceChildren(el);
  view.dataset.route = route;
  document.documentElement.dataset.view = route;
  if (top) view.scrollTop = 0;
  else if (keep) view.scrollTop = prev;
  else view.scrollTop = scrollMemo[route] || 0;
  dock.querySelectorAll('[data-route]').forEach((b) => { const on = b.dataset.route === route; b.classList.toggle('on', on); b.setAttribute('aria-current', on ? 'page' : 'false'); });
  el.focusInput?.();
  syncTop();
}
/** The screen titles are see-through at rest; they only get a solid backing once the list scrolls underneath them (no shaded band). */
function syncTop() {
  const tp = view?.querySelector('.top:not(.home-top)');
  if (tp) tp.classList.toggle('stuck', view.scrollTop > 4);
}

let drawn = 0;        // the library version the screen was drawn at
function refresh() {
  const cur = view.firstElementChild;
  drawn = dataVersion();
  if (cur && typeof cur.refresh === 'function') cur.refresh(); else render({ keep: true });
}
/** If the library changed while nothing was redrawing (the phone paused the page behind a file picker, say), the first touch or return to the app brings the screen up to date. */
function catchUp() { if (dataVersion() !== drawn) refresh(); }

export function go(r) {
  if (!ROUTES[r]) return;
  if (r !== 'sec') secId = null;
  if (r === route) { if (r === 'library' && (lib.folderId || lib.filter !== 'all')) { lib.folderId = null; lib.filter = 'all'; render({ top: true }); } else view.scrollTo({ top: 0, behavior: 'smooth' }); return; }
  scrollMemo[route] = view.scrollTop;
  route = r;
  render({ keep: false });
}

/** Back to the Hub (the first screen). */
function goHub() {
  hubOrigin = false;
  if (route === 'hub') return;
  scrollMemo[route] = view.scrollTop;
  route = 'hub'; secId = null;
  render({ keep: false, top: true });
}
/** Opens a section from the Hub: a route of the app (Player, Settings) or a page of its own. */
function openSection(id, { fromHub = false, from = null } = {}) {
  const def = sectionById(id);
  if (!def) return;
  hubOrigin = !!fromHub;
  secParent = from || null; retSec = null; lib.from = null;
  setKindFolder(id, null);
  if (id === 'settings') openSettingsCategory(null);            // Settings always opens on its list of categories
  const intro = fromHub ? playIntro(def) : (stopIntro(), null);
  const enter = () => {
    if (def.go) { go(def.go); return; }
    scrollMemo[route] = view.scrollTop;
    route = 'sec'; secId = id;
    render({ keep: false, top: true });
  };
  // The opening picture is up first (opaque from its very first frame); the section is built underneath while it plays, so the person sees
  // the picture and then the finished section – never the section, then the picture, then the section again.
  if (intro) requestAnimationFrame(() => requestAnimationFrame(enter)); else enter();
}

/** One step back out of a section: to the section it was opened from (media page → Player), else to the Hub. */
function sectionBack() {
  if (route === 'sec' && kindFolderUp(secId)) { render({ keep: false, top: true }); return; }     // inside a folder of a media page: one step up
  if (secParent) { const p = secParent; openSection(p, { fromHub: false }); return; }
  goHub();
}
/** Back out of Library / Search when they were opened from a section; false when they were not. */
function backToSection() {
  if (!retSec) return false;
  const r = retSec; retSec = null; lib.from = null;
  openSection(r.id, { fromHub: false, from: r.parent });
  return true;
}
/** Search opened from a section: Back returns to that section. */
function openSearch(from = null) {
  retSec = from ? { id: from, parent: secParent } : null;
  scrollMemo[route] = view.scrollTop;
  route = 'search'; secId = null;
  render({ keep: false, top: true });
}

function openLibrary({ filter = 'all', sort, folderId = null, from = null } = {}) {
  lib.filter = filter; lib.folderId = folderId; lib.selecting = null; lib.limit = 60;
  retSec = from ? { id: from, parent: secParent } : null; lib.from = from;
  if (sort) state.settings.sort = sort;
  scrollMemo.library = 0;
  scrollMemo[route] = view.scrollTop;
  route = 'library';
  render({ keep: false });
}

/* ---------------- adding ---------------- */
async function addFiles(accept, folderId) {
  const files = await pickFiles(typeof accept === 'string' && accept ? { accept } : {});      // a media section asks for its own kind (an event from a plain button is ignored)
  if (files.length) await importFiles(files, typeof folderId === 'string' ? folderId : currentFolder());     // a media page that is inside a folder passes that folder
}
async function addFolderFromDisk() {
  const { addWholeFolder } = await import('./folderadd.js');
  await addWholeFolder({ folderId: currentFolder() });
}
/** Google Drive: the system picker opens on Drive, for a whole folder or for several files. */
function addFromDrive() {
  actionSheet(t('addDrive'), [
    { icon: 'folder', label: t('driveFolder'), hint: t('driveFolderHint'), onClick: async () => { const { addWholeFolder } = await import('./folderadd.js'); await addWholeFolder({ drive: true, folderId: currentFolder() }); } },
    { icon: 'upload', label: t('driveFiles'), hint: t('driveFilesHint'), onClick: async () => { const { addPickedFiles } = await import('./folderadd.js'); await addPickedFiles({ drive: true, folderId: currentFolder() }); } },
  ]);
}
async function newFolder() {
  const f = await newFolderDialog(currentFolder());
  if (f) toast(t('folderCreated'));
}

async function newBoard() {
  const { newBoardSheet } = await import('./board/sheets.js');
  newBoardSheet({ folderId: currentFolder(), onCreate: (id) => openItem(id) });
}
/** Today's daily note: opens it if it already exists, otherwise starts it (asking for the paper). */
async function openTodayNote() {
  const today = dayKey();
  const found = [...state.items.values()].find((i) => isBoard(i) && i.meta?.note && i.meta.noteDay === today && !i.deletedAt);
  if (found) { openItem(found.id); return; }
  newNote();
}
async function newNote() {
  try { (await import('./notes/chooser.js')).newNoteChooser({ folderId: currentFolder(), openItem: (id) => openItem(id) }); } catch (e) { console.warn('new note', e); toast(t('bd_failed')); }
}
async function newTextNote() { (await import('./notes/chooser.js')).newTextNote({ folderId: currentFolder(), openItem: (id) => openItem(id) }); }
async function newHandNote() { (await import('./notes/chooser.js')).newHandNote({ folderId: currentFolder(), openItem: (id) => openItem(id) }); }

function addMenu() {
  actionSheet(t('addToLibrary'), [
    { icon: 'upload', label: t('addFiles'), hint: t('addFilesHint'), onClick: addFiles },
    !isAndroid() || folderPickerAvailable() ? { icon: 'folder', label: t('addFolder'), hint: t('addFolderHint'), onClick: addFolderFromDisk } : null,
    bulkImportAvailable() ? { icon: 'storage', label: t('bulk_title'), hint: t('bulk_hint'), onClick: () => openBulkImport({ folderId: currentFolder() }) } : null,
    folderPickerAvailable() ? { icon: 'drive', label: t('addDrive'), hint: t('addDriveHint'), onClick: addFromDrive } : null,
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
  go, goHub, openSection, sectionBack, sectionParent: () => secParent, openSearch, openLibrary, addFiles, newFolder, newBoard, newNote, newTextNote, newHandNote, openTodayNote, applyAppearance,
  itemMenu: (id) => itemActions(id, { onOpen: () => openItem(id, [id]) }),
  bgPicture: { set: setBgPicture, remove: removeBgPicture, has: hasBgPicture, url: () => bgUrl },
  rerender: (keep = true, top = false) => render({ keep, top }),
  back: () => handleBack(),
  openItem: (id, list) => openItem(id, list),
  toggleVault: async () => { if (state.vaultOpen) lockVault(); else await unlockVault(); },
  canInstall: () => !!deferredInstall && !window.matchMedia('(display-mode: standalone)').matches,
  install: async () => { if (!deferredInstall) return; deferredInstall.prompt(); await deferredInstall.userChoice.catch(() => {}); deferredInstall = null; render(); },
};

// the automated tests (simulated Chrome) drive the app through this; it is only there when the test flag is set in localStorage
try { if (localStorage.getItem('ahos.test')) window.__ahos = Object.assign(ctx, { setSetting }); } catch { /* storage blocked */ }

/* ---------------- shell ---------------- */
function buildShell() {
  const canvas = h('canvas', { id: 'bg', 'aria-hidden': 'true' });
  view = h('main', { id: 'view', tabindex: '-1' });
  const navBtn = (r) => h('button', { class: 'dock-btn', dataset: { route: r }, onClick: () => { hubOrigin = false; retSec = null; lib.from = null; go(r); }, 'aria-label': t(ROUTES[r].label) },
    h('span', { class: 'dock-ic', html: ic(ROUTES[r].icon) }), h('span', { class: 'dock-lb' }, t(ROUTES[r].label)));
  dock = h('nav', { class: 'dock', 'aria-label': 'Main' },
    navBtn('home'), navBtn('library'),
    h('button', { class: 'dock-add', 'aria-label': t('add'), onClick: addMenu, html: ic('plus') }),
    navBtn('search'),
    h('button', { class: 'dock-btn dock-menu', dataset: { hub: '1' }, 'aria-label': t('navMenu'), onClick: () => { sfx('back'); goHub(); } },
      h('span', { class: 'dock-ic', html: ic('hub') }), h('span', { class: 'dock-lb' }, t('navMenu'))));
  const splash = h('div', { class: 'splash', 'aria-hidden': 'true' },
    h('div', { class: 'splash-mark', html: mark() }),
    h('div', { class: 'splash-name' }, 'AHOS', h('small', null, 'Library')));
  const drop = h('div', { class: 'drop-hint' }, h('div', { html: ic('upload') }), h('b', null, t('dropHere')));
  view.addEventListener('scroll', syncTop, { passive: true });
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
  route = boot0.startOn === 'player' ? 'home' : 'hub';
  primeSound();
  setViewBack(() => {
    if (route === 'library' && libraryBack(ctx)) return true;
    if (route === 'hub') return false;
    if (route === 'sec') { sectionBack(); return true; }
    if (route === 'settings') { if (!settingsBack(ctx)) goHub(); return true; }
    if (retSec && backToSection()) return true;
    if (route !== 'home') { if (hubOrigin) goHub(); else go('home'); return true; }
    if (state.settings.startOn !== 'player') { goHub(); return true; }
    return false;
  });
  onHardwareBack(() => nativeBack(exitApp));

  await Promise.all([loadAll(), loadAppInfo(), loadBgPicture()]);
  setLang(state.settings.lang);
  // rebuild shell labels in the final language, then apply the saved look
  buildDockLabels();
  applyAppearance();

  document.addEventListener('visibilitychange', () => { document.documentElement.classList.toggle('app-hidden', document.hidden); if (!document.hidden) reapplyFullscreen(); });
  addEventListener('focus', () => reapplyFullscreen());
  await initGate(ctx);

  onChange(refresh);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) catchUp(); });
  window.addEventListener('focus', catchUp); window.addEventListener('pageshow', catchUp);
  view.addEventListener('touchstart', catchUp, { passive: true });
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
  // files other apps share / open with this app (Android)
  import('./intake.js').then((m) => m.startIntake({ go })).catch((e) => console.warn('intake', e));
  autoCheck((release) => openUpdateSheet(release));
  // pictures for anything that came out without one (retries quietly, a couple of times at most)
  whenGranted(() => setTimeout(() => { ensureThumbs().catch((e) => console.warn('previews', e)); }, 5000));
  whenGranted(startReminders);
  whenGranted(startFeed);
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
