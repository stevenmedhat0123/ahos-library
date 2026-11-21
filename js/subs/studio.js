// Subtitle studio: make, time, style, place and save subtitles for a video – full screen, with the video itself in front of you.
//   openSubStudio(itemId, { at, onClose })
// The tracks live on the video item (item.subs = [track…], see model.js) and are saved as you work; "Save as file" writes SRT / WebVTT / ASS.
import { h, clamp, fmtDur, uid, readText } from '../util.js';
import { ic } from '../icons.js';
import { t } from '../i18n.js';
import { state, getBlob, mediaUrl, updateItem } from '../store.js';
import { actionSheet, toast, confirmDialog, promptDialog } from '../ui.js';
import { mountViewer } from '../viewers/common.js';
import { loadCss } from '../lazycss.js';
import { exportBlob } from '../native.js';
import { pickFiles, importFiles } from '../import.js';
import { pickFolder } from '../actions.js';
import { newTrack, normalizeTrack, resolveStyle, cleanStyle, sortCues, makeCue, splitCue, mergeCues, checkCues, activeAt, fmtTime, round3 } from './model.js';
import { ensureTrack, parseSubs, serialize } from './format.js';
import { createSubRenderer, defaultAnchor } from './render.js';
import { createLane } from './lane.js';
import { panelCues, panelText, panelStyle, panelPosition, panelTools } from './panels.js';

const TABS = [['cues', 'sub_tabCues', 'list'], ['text', 'sub_tabText', 'edit'], ['style', 'sub_tabStyle', 'bdPalette'], ['pos', 'sub_tabPos', 'crosshair'], ['tools', 'sub_tabTools', 'sliders']];
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];
const MIN_LEN = 0.1;

export async function openSubStudio(itemId, { at = 0, onClose = null } = {}) {
  const item0 = state.items.get(itemId);
  if (!item0 || item0.kind !== 'video') return null;
  await loadCss('css/subs.css');

  /* ============================================================ state */
  let tracks = (item0.subs || []).map(ensureTrack);
  if (!tracks.length) { const nt = newTrack(t('sub_defaultName')); nt.auto = true; tracks = [nt]; }
  let activeId = tracks[0].id;
  let sel = null;
  let tab = 'cues';
  let past = [], future = [], lastKey = '', lastAt = 0;
  let saveTimer = 0, saved = true, leaving = false;
  let url = '', stopAt = null, rec = null, warnFor = null, warnMap = new Map(), lastNow = 0;
  const closeCbs = [];

  const S = {
    scope: 'cue', issuesOnly: false, listFrom: 0, stepSize: 0.1, nudge: 2, snap: true, shiftBy: '1', syncPts: [null, null], cps: 17,
    findText: '', replText: '', matchCase: false, exportFmt: 'srt', textarea: null, looping: false,
  };

  const cur = () => tracks.find((x) => x.id === activeId) || tracks[0];
  S.tr = cur;
  S.cues = () => cur().cues;
  S.cue = () => (sel ? cur().cues.find((c) => c.id === sel) || null : null);
  Object.defineProperty(S, 'sel', { get: () => sel });
  S.scopeNow = () => (S.scope === 'cue' && S.cue() ? 'cue' : 'track');
  S.styleNow = () => resolveStyle(S.scopeNow() === 'cue' ? S.cue() : null, cur());
  S.warnings = () => { const c = cur().cues; if (warnFor !== c) { warnFor = c; warnMap = checkCues(c); } return warnMap; };

  /* ============================================================ the screen */
  const V = mountViewer('ss', { onClose: cleanup });
  const root = V.el;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', t('sub_studio'));

  const video = h('video', { playsinline: '', preload: 'auto', crossorigin: 'anonymous' });
  video.setAttribute('webkit-playsinline', '');
  const stage = h('div', { class: 'ss-stage' }, video);
  const tap = h('div', { class: 'ss-tap' });
  stage.append(tap);
  const spin = h('div', { class: 'ss-spin show' });
  stage.append(spin);
  const rendr = createSubRenderer(stage, video, {
    interactive: true, getSnap: () => S.snap,
    onDrag: (id, pos) => editCue(id, (c) => ({ ...c, style: { ...(c.style || {}), pos } }), 'drag:' + id, { panel: false, lane: false }),
    onDragEnd: () => refresh({ lane: false }),
  });
  tap.addEventListener('click', () => toggle());

  /* ---- top bar ---- */
  const undoBtn = barBtn('undo', t('sub_undo'), () => undo());
  const redoBtn = barBtn('redo', t('sub_redo'), () => redo());
  const trackChip = h('button', { class: 'ss-chip-track', type: 'button', onClick: () => tracksSheet() });
  const saveDot = h('span', { class: 'ss-saved', role: 'status', 'aria-live': 'polite' });
  const top = h('header', { class: 'ss-top' },
    h('button', { class: 'vbtn', type: 'button', 'aria-label': t('back'), onClick: () => V.close(), html: ic('back', 'flip-rtl') }),
    trackChip, saveDot, h('span', { class: 'sp' }), undoBtn, redoBtn, barBtn('more', t('sub_menu'), () => menuSheet()));

  /* ---- transport ---- */
  const curT = h('span', { class: 'ss-now', dir: 'ltr' }, '0:00.000');
  const durT = h('span', { class: 'ss-dur-t', dir: 'ltr' }, '0:00');
  const seekBar = h('input', { class: 'ss-seek', type: 'range', min: 0, max: 1000, step: 1, value: 0, 'aria-label': t('seek'), dir: 'ltr' });
  const playBtn = h('button', { class: 'ss-play', type: 'button', 'aria-label': t('play'), onClick: () => toggle() });
  const speedBtn = h('button', { class: 'ss-btn sm speed', type: 'button', 'aria-label': t('speed'), onClick: () => cycleSpeed() }, '1×');
  const loopBtn = h('button', { class: 'ss-btn icon sm', type: 'button', 'aria-label': t('sub_loopCue'), 'aria-pressed': 'false', onClick: () => { S.looping = !S.looping; loopBtn.classList.toggle('on', S.looping); loopBtn.setAttribute('aria-pressed', String(S.looping)); } , html: ic('repeat') });
  const prevCueBtn = h('button', { class: 'ss-btn icon', type: 'button', 'aria-label': t('sub_prevCue'), onClick: () => stepCue(-1), html: ic('prev') });
  const nextCueBtn = h('button', { class: 'ss-btn icon', type: 'button', 'aria-label': t('sub_nextCue'), onClick: () => stepCue(1), html: ic('next') });
  const transport = h('div', { class: 'ss-transport', dir: 'ltr' },
    h('div', { class: 'ss-seekrow' }, curT, seekBar, durT),
    h('div', { class: 'ss-ctl' }, loopBtn, prevCueBtn,
      h('button', { class: 'ss-btn icon', type: 'button', 'aria-label': '-1s', onClick: () => seek(video.currentTime - 1) }, '−1'),
      playBtn,
      h('button', { class: 'ss-btn icon', type: 'button', 'aria-label': '+1s', onClick: () => seek(video.currentTime + 1) }, '+1'),
      nextCueBtn, speedBtn));

  /* ---- timeline ---- */
  const lane = createLane({
    get: () => ({ cues: cur().cues, dur: duration(), sel, now: video.currentTime || 0, warn: S.warnings() }),
    onSeek: (tm) => seek(tm),
    onSelect: (id, o) => select(id, { seek: !!(o && o.seek), fromLane: true }),
    onChange: (id, tm, final) => editCue(id, tm, 'lane:' + id, { panel: false, lane: final, list: false }),
  });
  const recBtn = h('button', { class: 'ss-btn rec', type: 'button', onClick: () => toggleRec() }, h('span', { class: 'dot' }), h('span', { class: 'lb' }, t('sub_mark')));
  const laneHead = h('div', { class: 'ss-lane-head' },
    h('div', { class: 'ss-zoom', dir: 'ltr' },
      h('button', { class: 'ss-btn icon sm', type: 'button', 'aria-label': t('zoomOut'), onClick: () => lane.zoomBy(0.7), html: ic('zoomOut') }),
      h('button', { class: 'ss-btn icon sm', type: 'button', 'aria-label': t('zoomIn'), onClick: () => lane.zoomBy(1.4), html: ic('zoomIn') }),
      h('button', { class: 'ss-btn sm', type: 'button', onClick: () => lane.fit() }, t('sub_fitAll'))),
    h('div', { class: 'ss-add' },
      h('button', { class: 'ss-btn sm primary', type: 'button', onClick: () => addCue(), html: ic('plus') + `<span>${t('sub_addHere')}</span>` }), recBtn));

  /* ---- tabs and panel ---- */
  const tabBtns = TABS.map(([id, key, icon]) => h('button', { class: 'ss-tab', type: 'button', role: 'tab', 'aria-selected': 'false', dataset: { tab: id }, onClick: () => go(id) }, h('span', { html: ic(icon) }), h('b', null, t(key))));
  const tabs = h('nav', { class: 'ss-tabs', role: 'tablist' }, tabBtns);
  const panel = h('div', { class: 'ss-panel', role: 'tabpanel' });
  const left = h('div', { class: 'ss-left' }, stage, transport, laneHead, lane.el);
  const right = h('div', { class: 'ss-right' }, tabs, panel);
  root.append(h('div', { class: 'ss' }, top, left, right));

  /* ============================================================ the video */
  async function loadVideo() {
    const direct = await mediaUrl(itemId);
    const blob = direct ? null : await getBlob(itemId);
    if (!direct && !blob) { toast(t('fileMissing')); V.close(); return; }
    url = direct ? '' : URL.createObjectURL(blob);
    video.src = direct || url;
    video.addEventListener('loadedmetadata', () => {
      spin.classList.remove('show');
      durT.textContent = fmtDur(video.duration || 0);
      if (at > 0 && isFinite(video.duration)) video.currentTime = Math.min(at, Math.max(0, video.duration - 0.2));
      rendr.layout(); lane.paint(); tickUI(true);
    }, { once: true });
    video.addEventListener('error', () => { spin.classList.remove('show'); toast(t('sub_videoErr')); });
  }
  const duration = () => {
    const d = video.duration;
    const last = cur().cues.reduce((m, c) => Math.max(m, c.end), 0);
    return Math.max(isFinite(d) ? d : 0, last + 5, 10);
  };
  const dur = () => (isFinite(video.duration) && video.duration > 0 ? video.duration : duration());
  S.now = () => round3(video.currentTime || 0);
  S.dur = dur;
  function seek(tm) { video.currentTime = clamp(tm, 0, dur()); tickUI(true); }
  S.seek = seek;
  function toggle() { if (video.paused) { stopAt = null; video.play().catch(() => {}); } else video.pause(); }
  function cycleSpeed() { const i = SPEEDS.indexOf(video.playbackRate); const n = SPEEDS[(i + 1) % SPEEDS.length]; video.playbackRate = n; speedBtn.textContent = n + '×'; }
  S.playCue = (c, loop) => { S.looping = !!loop; loopBtn.classList.toggle('on', S.looping); stopAt = loop ? null : c.end; seek(c.start); video.play().catch(() => {}); };
  function stepCue(d) {
    const cs = cur().cues;
    if (!cs.length) return;
    const tm = video.currentTime || 0;
    let c = null;
    if (d > 0) c = cs.find((x) => x.start > tm + 0.02);
    else for (let i = cs.length - 1; i >= 0; i--) if (cs[i].start < tm - 0.3) { c = cs[i]; break; }
    if (c) select(c.id, { seek: true });
  }

  /* ---- the clock: runs while the video plays, and after every seek ---- */
  let raf = 0;
  function tickUI(force = false) {
    const tm = video.currentTime || 0;
    curT.textContent = fmtTime(tm);
    if (isFinite(video.duration) && video.duration > 0) seekBar.value = String(Math.round((tm / video.duration) * 1000));
    lane.setPlayhead(!video.paused);
    const nowMs = performance.now();
    if (force || nowMs - lastNow > 140) {
      lastNow = nowMs;
      const act = new Set(activeAt(cur().cues, tm, 30).map((c) => c.id));
      root.querySelectorAll('.ss-b, .ss-row').forEach((n) => n.classList.toggle('now', act.has(n.dataset.id)));
    }
    if (rec) { const c = cur().cues.find((x) => x.id === rec.id); if (c && tm > c.start + MIN_LEN && Math.abs(c.end - tm) > 0.05) editCue(rec.id, { end: round3(tm) }, 'rec', { panel: false, lane: false, list: false }); }
    if (!video.paused) {
      if (stopAt != null && tm >= stopAt) { stopAt = null; video.pause(); }
      else if (S.looping) { const c = S.cue(); if (c && tm >= c.end) seek(c.start); }
    }
  }
  const loop = () => { raf = 0; tickUI(); if (!video.paused && !leaving) raf = requestAnimationFrame(loop); };
  video.addEventListener('play', () => { setPlayIcon(); if (!raf) raf = requestAnimationFrame(loop); });
  video.addEventListener('pause', () => { setPlayIcon(); tickUI(true); if (rec) finishRec(); });
  video.addEventListener('seeked', () => tickUI(true));
  video.addEventListener('timeupdate', () => { if (video.paused) tickUI(); });
  video.addEventListener('ended', () => { setPlayIcon(); if (rec) finishRec(); });
  function setPlayIcon() { playBtn.innerHTML = ic(video.paused ? 'play' : 'pause'); playBtn.setAttribute('aria-label', video.paused ? t('play') : t('pause')); root.classList.toggle('playing', !video.paused); }
  seekBar.addEventListener('input', () => { if (isFinite(video.duration)) seek((parseFloat(seekBar.value) / 1000) * video.duration); });

  /* ============================================================ edits (every change goes through commit) */
  function snapshot() { return { tracks, activeId, sel }; }
  function commit(next, key = '', opts = {}) {
    if (next === tracks) return false;
    const co = key && key === lastKey && performance.now() - lastAt < 1200 && past.length;
    if (!co) { past.push(snapshot()); if (past.length > 100) past.shift(); }
    future = [];
    lastKey = key; lastAt = performance.now();
    tracks = next;
    refresh(opts);
    return true;
  }
  const stamp = (tr, patch) => ({ ...tr, ...patch, updated: Date.now(), auto: false });
  /** fn(track) returns what to change (an object of fields) or the same track when nothing changes */
  function editTrack(fn, key, opts) {
    const tr = cur();
    const patch = fn(tr);
    if (patch === tr) return false;
    return commit(tracks.map((x) => (x.id === tr.id ? stamp(tr, patch) : x)), key, opts);
  }
  function editCues(fn, key, opts) { return editTrack((tr) => { const cues = fn(tr.cues); return cues === tr.cues ? tr : { cues: sortCues(cues.slice()) }; }, key, opts); }
  function editCue(id, patch, key, opts) {
    return editCues((cs) => {
      const i = cs.findIndex((c) => c.id === id);
      if (i < 0) return cs;
      const old = cs[i];
      let n = typeof patch === 'function' ? patch(old) : { ...old, ...patch };
      if (n.start !== old.start || n.end !== old.end || n.text !== old.text) { n = { ...n, start: Math.max(0, round3(n.start)), end: Math.max(round3(n.start) + MIN_LEN, round3(n.end)) }; }
      if (n.style) { n = { ...n, style: cleanStyle(n.style) }; if (!Object.keys(n.style).length) delete n.style; }
      const out = cs.slice(); out[i] = n; return out;
    }, key, opts);
  }
  S.editCue = editCue; S.editCues = editCues; S.editTrack = editTrack;

  function restore(snap) {
    tracks = snap.tracks; activeId = tracks.some((x) => x.id === snap.activeId) ? snap.activeId : tracks[0].id;
    sel = snap.sel && cur().cues.some((c) => c.id === snap.sel) ? snap.sel : null;
    rendr.setSelected(sel);
    lastKey = '';
    refresh({});
  }
  function undo() { if (!past.length) return; future.push(snapshot()); restore(past.pop()); }
  function redo() { if (!future.length) return; past.push(snapshot()); restore(future.pop()); }

  /* ---- what refresh redraws: the picture, the timeline, the open tab ---- */
  function refresh(o = {}) {
    const tr = cur();
    rendr.setTrack(tr);
    if (o.lane !== false) { lane.dirty(); lane.paint(); }
    if (o.panel !== false) renderPanel();
    updateChrome();
    saveSoon();
  }
  S.refresh = refresh;
  function updateChrome() {
    const tr = cur();
    trackChip.replaceChildren(h('span', { html: ic('cc') }), h('b', { dir: 'auto' }, tr.name || t('sub_defaultName')), h('small', null, String(tr.cues.length)), h('span', { class: 'chev', html: ic('chevDown') }));
    undoBtn.disabled = !past.length; redoBtn.disabled = !future.length;
    undoBtn.classList.toggle('off', !past.length); redoBtn.classList.toggle('off', !future.length);
    prevCueBtn.disabled = nextCueBtn.disabled = !tr.cues.length;
    saveDot.classList.toggle('on', saved);
    saveDot.textContent = saved ? t('sub_saved') : t('sub_saving');
    const issues = S.warnings().size;
    root.querySelector('[data-tab="cues"] b')?.classList.toggle('warn', issues > 0);
  }
  function go(id, focus) {
    tab = id;
    tabBtns.forEach((b) => { const on = b.dataset.tab === id; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); });
    renderPanel(true);
    if (focus === 'paste') setTimeout(() => { const p = panel.querySelector('#ss-paste'); p && p.scrollIntoView({ block: 'center' }); p && p.focus(); }, 60);
    if (id === 'text' && S.cue() && focus !== 'nofocus') setTimeout(() => { if (S.textarea && !S.cue().text) S.textarea.focus(); }, 80);
  }
  S.go = go;
  function renderPanel(reset = false) {
    const y = reset ? 0 : panel.scrollTop;
    S.textarea = null;
    const fn = { cues: panelCues, text: panelText, style: panelStyle, pos: panelPosition, tools: panelTools }[tab];
    panel.replaceChildren(fn(S));
    panel.scrollTop = y;
    if (tab === 'cues' && reset && sel) panel.querySelector('.ss-row.sel')?.scrollIntoView({ block: 'nearest' });
  }

  /* ---- selecting ---- */
  function select(id, { seek: doSeek = false, fromLane = false } = {}) {
    const c = id ? cur().cues.find((x) => x.id === id) : null;
    sel = c ? c.id : null;
    rendr.setSelected(sel);
    lane.markSel(sel);
    if (c && doSeek) seek(c.start);
    if (c && !fromLane) lane.ensureVisible(c.start);
    renderPanel();
    updateChrome();
    if (c) panel.querySelector('.ss-row.sel')?.scrollIntoView({ block: 'nearest' });
  }
  S.select = select;
  S.step = (d) => { const cs = cur().cues, i = cs.findIndex((c) => c.id === sel); const n = cs[i + d]; if (n) select(n.id, { seek: true }); };

  /* ---- cue operations ---- */
  S.addCue = (text = '') => {
    const c = makeCue(cur().cues, video.currentTime || 0, 2, text);
    editCues((cs) => [...cs, c], 'add');
    select(c.id, { seek: false });
    go('text');
    setTimeout(() => S.textarea && S.textarea.focus(), 90);
  };
  const addCue = () => S.addCue();
  S.setTimes = (p) => {
    const c = S.cue(); if (!c) return;
    let { start, end } = c;
    if ('start' in p) { start = Math.max(0, round3(p.start)); if (start > end - MIN_LEN) end = round3(start + (c.end - c.start)); }
    if ('end' in p) { end = round3(p.end); if (end < start + MIN_LEN) end = round3(start + MIN_LEN); }
    editCue(c.id, { start, end }, 'time:' + c.id + Object.keys(p).join());
    lane.ensureVisible(start);
  };
  S.moveCue = (d) => { const c = S.cue(); if (!c) return; const len = c.end - c.start; const s = Math.max(0, round3(c.start + d)); editCue(c.id, { start: s, end: round3(s + len) }, 'move:' + c.id); };
  S.splitSel = (caret) => {
    const c = S.cue(); if (!c) return;
    const at = video.currentTime || 0;
    const mid = at > c.start + 0.05 && at < c.end - 0.05 ? at : (c.start + c.end) / 2;
    const parts = splitCue(c, mid, caret > 0 && caret < c.text.length ? caret : -1);
    if (!parts) { toast(t('sub_splitFail')); return; }
    editCues((cs) => cs.flatMap((x) => (x.id === c.id ? parts : [x])), 'split');
    select(parts[1].id, { seek: false });
  };
  S.mergeNext = () => {
    const c = S.cue(); if (!c) return;
    const cs = cur().cues, i = cs.findIndex((x) => x.id === c.id), n = cs[i + 1];
    if (!n) return;
    const m = mergeCues(c, n);
    editCues((all) => all.filter((x) => x.id !== n.id).map((x) => (x.id === c.id ? m : x)), 'merge');
  };
  S.dupSel = () => {
    const c = S.cue(); if (!c) return;
    const len = c.end - c.start;
    const copy = { ...c, id: uid(), start: round3(c.end + 0.1), end: round3(c.end + 0.1 + len) };
    if (c.style) copy.style = { ...c.style };
    editCues((cs) => [...cs, copy], 'dup');
    select(copy.id, { seek: true });
  };
  S.delSel = () => {
    const c = S.cue(); if (!c) return;
    const cs = cur().cues, i = cs.findIndex((x) => x.id === c.id);
    const next = cs[i + 1] || cs[i - 1] || null;
    editCues((all) => all.filter((x) => x.id !== c.id), 'del');
    select(next ? next.id : null, { seek: false });
    toast(t('sub_deleted'), { action: t('sub_undo'), onAction: () => undo() });
  };
  S.fixOverlaps = () => {
    let n = 0;
    editCues((cs) => { const s = sortCues(cs.map((c) => ({ ...c }))); for (let i = 0; i < s.length - 1; i++) if (s[i].end > s[i + 1].start) { s[i].end = Math.max(s[i].start + MIN_LEN, round3(s[i + 1].start - 0.001)); n++; } return n ? s : cs; }, 'overlap');
    toast(n ? t('sub_fixedN', { n }) : t('sub_nothingToFix'));
  };
  S.dropEmpty = () => {
    const n = cur().cues.filter((c) => !c.text.trim()).length;
    if (!n) { toast(t('sub_nothingToFix')); return; }
    editCues((cs) => cs.filter((c) => c.text.trim()), 'dropempty'); toast(t('sub_removedN', { n }));
    if (sel && !S.cue()) select(null);
  };
  S.nextIssue = () => {
    const w = S.warnings(), cs = cur().cues;
    const tm = video.currentTime || 0;
    const c = cs.find((x) => w.has(x.id) && x.start > tm + 0.01) || cs.find((x) => w.has(x.id));
    if (c) select(c.id, { seek: true });
  };
  S.findNext = () => {
    if (!S.findText) { toast(t('sub_findNeeded')); return; }
    const needle = S.matchCase ? S.findText : S.findText.toLowerCase();
    const cs = cur().cues, from = sel ? cs.findIndex((c) => c.id === sel) + 1 : 0;
    const has = (c) => (S.matchCase ? c.text : c.text.toLowerCase()).includes(needle);
    const c = cs.slice(from).find(has) || cs.find(has);
    if (!c) { toast(t('sub_notFound')); return; }
    select(c.id, { seek: true });
  };

  /* ---- style and position (on the selected subtitle or on the whole track) ---- */
  S.setStyle = (patch, key, o = {}) => {
    const keyed = 'st:' + S.scopeNow() + ':' + (key || Object.keys(patch).join());
    const opts = { panel: !!o.panel, lane: false, list: false };
    if (S.scopeNow() === 'cue') {
      const id = sel;
      editCue(id, (c) => {
        const st = { ...(c.style || {}) };
        for (const [k, v] of Object.entries(patch)) { if (v === null && k === 'pos') st.pos = null; else st[k] = v; }
        return { ...c, style: st };
      }, keyed, opts);
    } else editTrack((tr) => ({ style: cleanStyle({ ...tr.style, ...patch }) }), keyed, opts);
  };
  S.setPos = (p, key, o = {}) => {
    const s = S.styleNow();
    const base = s.pos || defaultAnchor(s.an);
    const pos = { x: clamp(p.x != null ? p.x : base.x, 0, 100), y: clamp(p.y != null ? p.y : base.y, 0, 100) };
    S.setStyle({ pos: { x: round3(pos.x), y: round3(pos.y) } }, key, { panel: !!o.redraw });
  };
  /** copy the look (or the position) of the selected subtitle to the others */
  S.applyLook = (keys, which) => {
    const c = S.cue(); if (!c) return;
    const st = resolveStyle(c, cur());
    const patch = {}; keys.forEach((k) => { if (k in st) patch[k] = st[k]; });
    editCues((cs) => cs.map((x) => ((which === 'all' || x.start >= c.start) ? { ...x, style: cleanStyle({ ...(x.style || {}), ...patch }) } : x)), 'applylook');
    toast(t('sub_applied'));
  };
  /** put the default look back: for one subtitle, for all their own settings, or for the track's defaults */
  S.resetLook = (keys, which) => {
    const strip = (o) => { const n = { ...(o || {}) }; keys.forEach((k) => delete n[k]); return n; };
    if (which === 'cue') { const c = S.cue(); if (c) editCue(c.id, (x) => { const st = strip(x.style); const n = { ...x, style: st }; if (!Object.keys(st).length) delete n.style; return n; }, 'resetlook'); }
    else if (which === 'allcues') editCues((cs) => cs.map((x) => { if (!x.style) return x; const st = strip(x.style); const n = { ...x, style: st }; if (!Object.keys(st).length) delete n.style; return n; }), 'resetlook');
    else editTrack((tr) => ({ style: strip(tr.style) }), 'resetlook');
    toast(t('sub_resetDone'));
  };

  /* ---- mark the start and the end while the video plays ---- */
  function toggleRec() { if (rec) finishRec(true); else startRec(); }
  function startRec() {
    const c = makeCue(cur().cues, video.currentTime || 0, 0.5, '');
    editCues((cs) => [...cs, c], 'rec-start');
    rec = { id: c.id };
    select(c.id, { seek: false });
    recBtn.classList.add('on'); recBtn.querySelector('.lb').textContent = t('sub_markEnd');
    if (video.paused) video.play().catch(() => {});
  }
  function finishRec(manual) {
    if (!rec) return;
    const id = rec.id; rec = null;
    recBtn.classList.remove('on'); recBtn.querySelector('.lb').textContent = t('sub_mark');
    const c = cur().cues.find((x) => x.id === id);
    if (!c) return;
    const tm = video.currentTime || 0;
    if (manual && tm > c.start + MIN_LEN) editCue(id, { end: round3(tm) }, 'rec-end');
    if (manual && !video.paused) video.pause();
    go('text');
    setTimeout(() => S.textarea && S.textarea.focus(), 90);
  }

  /* ============================================================ tracks */
  S.newTrack = async () => {
    const name = await promptDialog({ title: t('sub_newTrack'), value: t('sub_defaultName') + (tracks.length ? ' ' + (tracks.length + 1) : ''), ok: t('create'), maxlength: 60 });
    if (!name) return;
    const nt = newTrack(name);
    past.push(snapshot()); future = [];
    tracks = [...tracks.filter((x) => !(x.auto && !x.cues.length)), nt]; activeId = nt.id; sel = null; rendr.setSelected(null);
    refresh({}); toast(t('sub_trackAdded'));
  };
  S.renameTrack = async () => {
    const name = await promptDialog({ title: t('sub_rename'), value: cur().name, ok: t('save'), maxlength: 60 });
    if (name) editTrack(() => ({ name }), 'rename');
  };
  S.dupTrack = () => {
    const tr = cur();
    const copy = { ...normalizeTrack({ ...tr, id: uid(), name: `${tr.name} ${t('sub_copySuffix')}`, cues: tr.cues.map((c) => ({ ...c, id: uid() })) }), auto: false };
    past.push(snapshot()); future = [];
    tracks = [...tracks, copy]; activeId = copy.id; sel = null; rendr.setSelected(null);
    refresh({}); toast(t('sub_trackAdded'));
  };
  S.deleteTrack = async () => {
    if (!(await confirmDialog({ title: t('sub_deleteTrack'), message: t('sub_deleteTrackMsg', { name: cur().name }), ok: t('delete'), danger: true }))) return;
    past.push(snapshot()); future = [];
    tracks = tracks.filter((x) => x.id !== activeId);
    if (!tracks.length) { const nt = newTrack(t('sub_defaultName')); nt.auto = true; tracks = [nt]; }
    activeId = tracks[0].id; sel = null; rendr.setSelected(null);
    refresh({});
  };
  S.clearCues = async () => {
    if (!(await confirmDialog({ title: t('sub_clearAll'), message: t('sub_clearAllMsg'), ok: t('delete'), danger: true }))) return;
    editCues(() => [], 'clear'); select(null);
  };
  function switchTrack(id) { if (id === activeId) return; activeId = id; sel = null; rendr.setSelected(null); lastKey = ''; refresh({}); }
  function tracksSheet() {
    actionSheet(t('sub_tracks'), [
      ...tracks.map((tr) => ({ icon: 'cc', label: tr.name || t('sub_defaultName'), hint: t('sub_count', { n: tr.cues.length }), checked: tr.id === activeId, onClick: () => switchTrack(tr.id) })),
      { icon: 'plus', label: t('sub_newTrack'), onClick: () => S.newTrack() },
      { icon: 'upload', label: t('sub_importFile'), onClick: () => S.importFile() },
    ]);
  }
  function menuSheet() {
    actionSheet(t('sub_menu'), [
      { icon: 'eye', label: t('sub_previewOn'), hint: t('sub_previewOnSub'), checked: rendr.enabled, onClick: () => rendr.setEnabled(!rendr.enabled) },
      { icon: 'share', label: t('sub_saveFile'), hint: S.exportFmt.toUpperCase(), onClick: () => S.exportFile() },
      { icon: 'folder', label: t('sub_saveLibrary'), onClick: () => S.saveToLibrary() },
      { icon: 'upload', label: t('sub_importFile'), onClick: () => S.importFile() },
      { icon: 'cc', label: t('sub_tracks'), onClick: () => setTimeout(tracksSheet, 200) },
      { icon: 'info', label: t('sub_shortcuts'), hint: t('sub_shortcutsSub'), onClick: () => toast(t('sub_shortcutsList'), { ms: 7000 }) },
    ]);
  }

  /* ============================================================ files */
  S.importFile = async () => {
    const files = await pickFiles({ accept: '.srt,.vtt,.ass,.ssa,text/vtt,application/x-subrip,text/plain', multiple: true });
    if (!files.length) return;
    let added = 0;
    const fresh = [];
    for (const f of files) {
      try {
        const tr = parseSubs(await readText(f), f.name);
        if (!tr.cues.length) continue;
        tr.name = tr.name || t('sub_defaultName');
        fresh.push(tr); added++;
      } catch (e) { console.warn('subtitle import failed', f.name, e); }
    }
    if (!fresh.length) { toast(t('sub_importFail')); return; }
    past.push(snapshot()); future = [];
    tracks = [...tracks.filter((x) => !(x.auto && !x.cues.length)), ...fresh];
    activeId = fresh[0].id; sel = null; rendr.setSelected(null);
    refresh({});
    go('cues');
    toast(t('sub_importedN', { n: added }));
  };
  function fileOf(fmt) {
    const out = serialize(cur(), fmt || S.exportFmt);
    const blob = new Blob(['﻿', out.text], { type: out.mime + ';charset=utf-8' });
    return { name: out.name, blob, mime: out.mime };
  }
  S.exportFile = async () => {
    if (!cur().cues.length) { toast(t('sub_nothingToSave')); return; }
    const f = fileOf();
    try { await exportBlob(f.name, f.blob); } catch (e) { console.warn(e); toast(t('sub_saveFail')); }
  };
  S.saveToLibrary = async () => {
    if (!cur().cues.length) { toast(t('sub_nothingToSave')); return; }
    const dest = await pickFolder({ title: t('sub_saveWhere'), ok: t('sub_saveHere') });
    if (dest === undefined) return;
    const f = fileOf();
    const file = new File([f.blob], f.name, { type: f.mime });
    const r = await importFiles([file], dest || null, { quiet: true, noSubs: true });
    toast(r.ok || (r.ids && r.ids.length) ? t('sub_savedToLibrary', { name: f.name }) : t('sub_saveFail'));
  };

  /* ============================================================ saving to the video */
  function persist() {
    clearTimeout(saveTimer);
    if (!state.items.get(itemId)) return;
    const keep = tracks.filter((x) => !(x.auto && !x.cues.length)).map((x) => { const { auto, ...rest } = x; void auto; return rest; });
    updateItem(itemId, { subs: keep }, { silent: true });
    saved = true;
    saveDot.classList.add('on'); saveDot.textContent = t('sub_saved');
  }
  function saveSoon() {
    saved = false;
    saveDot.classList.remove('on'); saveDot.textContent = t('sub_saving');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(persist, 700);
  }
  S.flush = persist;
  const onHide = () => { if (!saved) persist(); };
  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('pagehide', onHide);

  /* ============================================================ keyboard */
  function onKey(e) {
    const tag = (e.target && e.target.tagName) || '';
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(tag) && !(tag === 'INPUT' && e.target.type === 'range');
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z' && !(tag === 'TEXTAREA')) { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
    if (typing) return;
    if (e.key === ' ') { e.preventDefault(); toggle(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); seek(video.currentTime - (e.shiftKey ? 5 : 1)); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); seek(video.currentTime + (e.shiftKey ? 5 : 1)); }
    else if (e.key === '[') S.setTimes({ start: S.now() });
    else if (e.key === ']') S.setTimes({ end: S.now() });
    else if (e.key === 'Enter') { e.preventDefault(); addCue(); }
    else if (e.key === 'Delete' || e.key === 'Backspace') { if (sel) { e.preventDefault(); S.delSel(); } }
    else if (e.key === 'ArrowUp') { e.preventDefault(); S.step(-1); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); S.step(1); }
  }
  document.addEventListener('keydown', onKey);

  /* ============================================================ closing */
  function cleanup() {
    leaving = true;
    cancelAnimationFrame(raf);
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('visibilitychange', onHide);
    window.removeEventListener('pagehide', onHide);
    persist();
    try { video.pause(); } catch { /* ignore */ }
    rendr.destroy();
    video.removeAttribute('src'); video.load();
    if (url) URL.revokeObjectURL(url);
    closeCbs.forEach((f) => f());
    try { onClose && onClose({ subs: state.items.get(itemId)?.subs || [], activeId, at: video.currentTime || 0 }); } catch (e) { console.error(e); }
  }

  /* ============================================================ go */
  S.video = video; S.lane = lane; S.renderer = rendr; S.close = () => V.close();
  root.__studio = S;                       // for tests
  setPlayIcon();
  go('cues');
  refresh({});
  await loadVideo();
  return S;
}

function barBtn(icon, label, onClick) {
  return h('button', { class: 'vbtn', type: 'button', 'aria-label': label, title: label, onClick, html: ic(icon) });
}
