// Video + audio player with gestures, resume, subtitles, playlist and speed control.
import { h, fmtDur, clamp, readText, isNative, toVtt, stripExt } from '../util.js';
import { ic } from '../icons.js';
import { t } from '../i18n.js';
import { state, getBlob, mediaUrl, updateItem, setSetting } from '../store.js';
import { actionSheet, openSheet, toast } from '../ui.js';
import { mountViewer, touchOpened, saveProgress, barBtn } from './common.js';
import { thumbURL, genSVG } from '../covers.js';
import { lockOrientation, immersive, keepAwake, mediaNotify, mediaStop, setMediaHandler, playbackAvailable, askNotifyPermission } from '../native.js';
import { pickFiles } from '../import.js';
import { exportItem, itemActions, itemDetails } from '../actions.js';
import { marksSheet, addBookmark } from '../marks.js';

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];
const SUB_SIZES = { s: 15, m: 19, l: 25, xl: 32 };
const SUB_COLORS = { white: '#FFFFFF', yellow: '#FFE066', mint: '#7CF2C0', cyan: '#7FDBFF' };
let askedNotify = false;

export function openMedia(startId, listIds = []) {
  const start = state.items.get(startId);
  if (!start) return;
  const kind = start.kind;
  const items = listIds.map((i) => state.items.get(i)).filter((it) => it && it.kind === kind);
  let idx = items.findIndex((i) => i.id === startId);
  if (idx < 0) { items.unshift(start); idx = 0; }
  let cur = items[idx];
  let url = '', usingDirect = false;
  let landscape = false;
  let uiTimer = 0, saveTimer = 0, raf = 0, holdTimer = 0, holding = false, lastTap = 0, lastX = 0, tapTimer = 0, uiBeforeTap = true;
  let speed = state.settings.speed || 1;
  let fit = 'contain';
  let dragging = false;
  const subUrls = [];
  let repeatLeft = state.settings.repeatN || 2;
  let audioOnly = false, userPaused = false, leaving = false, lastCurTxt = '', lastDurTxt = '';
  let sleepTimer = 0, sleepEnd = false, autoResumeAt = [];
  const hist = [];
  const bgOn = () => state.settings.bgAudio !== false;

  const V = mountViewer(`media k-${kind}`, { onClose: cleanup });
  const root = V.el;
  root.classList.add('ui-on');

  const video = h('video', { playsinline: '', preload: 'auto', crossorigin: 'anonymous' });
  video.setAttribute('webkit-playsinline', '');
  const art = h('div', { class: 'a-art' });
  const tapZone = h('div', { class: 'v-tap' });
  const indicator = h('div', { class: 'v-ind' });
  const err = h('div', { class: 'v-err' });
  const spinner = h('div', { class: 'v-spin' });
  const aoName = h('div', { class: 'v-ao-name', dir: 'auto' });
  const aoPane = h('div', { class: 'v-ao' }, h('div', { class: 'v-ao-ic', html: ic('headphones') }), aoName, h('div', { class: 'v-ao-tx' }, t('playingAudio')));
  const subStyle = h('style');

  /* ---------- controls ---------- */
  const title = h('div', { class: 'v-title', dir: 'auto' });
  const sub = h('div', { class: 'v-subtitle', dir: 'auto' });
  const playBtn = h('button', { class: 'v-play', 'aria-label': t('play'), onClick: () => toggle() });
  const prevBtn = barBtn('prev', t('previous'), () => go(-1), 'v-prev');
  const nextBtn = barBtn('next', t('next'), () => go(1), 'v-next');
  const rewBtn = barBtn('rew10', '-10', () => seekBy(-10), 'v-rew');
  const fwdBtn = barBtn('fwd10', '+10', () => seekBy(10), 'v-fwd');
  const curT = h('span', { class: 'v-time' }, '0:00');
  const durT = h('span', { class: 'v-time' }, '0:00');
  const buf = h('i', { class: 'sb-buf' });
  const fill = h('i', { class: 'sb-fill' });
  const knob = h('i', { class: 'sb-knob' });
  const bubble = h('span', { class: 'sb-bubble' });
  const bar = h('div', { class: 'sb', role: 'slider', tabindex: '0', 'aria-label': t('seek') }, h('div', { class: 'sb-track' }, buf, fill, knob), bubble);

  const ccBtn = barBtn('cc', t('subtitles'), () => subsMenu());
  const speedBtn = h('button', { class: 'vbtn txt', 'aria-label': t('speed'), onClick: () => speedMenu() }, '1×');
  const fitBtn = barBtn('fit', t('fitFill'), () => { setFill(fit === 'contain', true); flash(fit === 'cover' ? t('fill') : t('fit')); });
  const pipBtn = barBtn('pip', t('pip'), async () => { try { if (document.pictureInPictureElement) await document.exitPictureInPicture(); else await video.requestPictureInPicture(); } catch { toast(t('pipUnavailable')); } });
  const rotBtn = barBtn('rotate', t('rotate'), () => toggleLandscape());
  const moreBtn = barBtn('more', t('playbackSettings'), () => playbackSheet());
  const markBtn = barBtn('bookmark', t('bookmarks'), () => openMarks());
  const sleepBtn = barBtn('clock', t('sleepTimer'), () => sleepSheet());
  const aoBtn = barBtn('headphones', t('audioOnly'), () => setAudioOnly(!audioOnly));

  const top = h('div', { class: 'v-top' },
    h('button', { class: 'vbtn', 'aria-label': t('back'), onClick: () => V.close(), html: ic('back', 'flip-rtl') }),
    h('div', { class: 'v-titles' }, title, sub),
    kind === 'video' ? ccBtn : null, speedBtn, moreBtn);
  const mid = h('div', { class: 'v-mid' }, prevBtn, rewBtn, playBtn, fwdBtn, nextBtn);
  const bottom = h('div', { class: 'v-bot', dir: 'ltr' },
    h('div', { class: 'v-seekrow' }, curT, bar, durT),
    h('div', { class: 'v-tools' }, markBtn, sleepBtn, kind === 'video' ? aoBtn : null, kind === 'video' ? fitBtn : null, kind === 'video' && document.pictureInPictureEnabled ? pipBtn : null, kind === 'video' ? rotBtn : null));
  const ui = h('div', { class: 'v-ui' }, top, mid, bottom);

  root.append(h('div', { class: 'v-stage' }, video, art, aoPane, tapZone, spinner, indicator, err), ui, subStyle);
  video.style.objectFit = 'contain';

  /* ---------- stable safe-area insets ----------
   * While a video plays the system bars are hidden. Pulling the notification shade (or swiping from an edge) shows them for a
   * while, and the page's safe-area insets jump up by the status-bar height: the title and buttons were pushed down and a strip
   * appeared at the top, as if the screen had shrunk. So the viewer measures the insets once they have settled (after the bars hid,
   * and again after a rotation) and keeps using those numbers until the next rotation. */
  const freezeInsets = (() => {
    const probe = h('div', { 'aria-hidden': 'true', style: { position: 'fixed', left: '0', top: '0', width: '0', height: '0', visibility: 'hidden', pointerEvents: 'none', paddingTop: 'env(safe-area-inset-top, 0px)', paddingBottom: 'env(safe-area-inset-bottom, 0px)' } });
    root.append(probe);
    let land = innerWidth > innerHeight, gen = 0, timer = 0;
    const read = () => { const cs = getComputedStyle(probe); return [Math.round(parseFloat(cs.paddingTop) || 0), Math.round(parseFloat(cs.paddingBottom) || 0)]; };
    const put = ([a, b]) => { root.style.setProperty('--safe-t', a + 'px'); root.style.setProperty('--safe-b', b + 'px'); };
    function settle() {
      const my = ++gen; clearTimeout(timer);
      let last = '', same = 0, tries = 0;
      const tick = () => {
        if (my !== gen || leaving) return;
        const cur = read(), key = cur.join();
        put(cur);
        same = key === last ? same + 1 : 0; last = key; tries++;
        if (same >= 2 || tries > 14) return;   // two equal readings in a row: settled, keep them
        timer = setTimeout(tick, 350);
      };
      put(read());
      timer = setTimeout(tick, 400);
    }
    const onResize = () => { const nl = innerWidth > innerHeight; if (nl !== land) { land = nl; settle(); } };
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', settle);
    settle();
    return () => { gen++; clearTimeout(timer); window.removeEventListener('resize', onResize); window.removeEventListener('orientationchange', settle); probe.remove(); };
  })();

  /* ---------- helpers ---------- */
  function setPlayIcon() { playBtn.innerHTML = ic(video.paused ? 'play' : 'pause'); playBtn.setAttribute('aria-label', video.paused ? t('play') : t('pause')); root.classList.toggle('paused', video.paused); }
  function flash(text, pos) {
    indicator.textContent = text;
    indicator.className = 'v-ind show ' + (pos || '');
    clearTimeout(flash.t); flash.t = setTimeout(() => { indicator.className = 'v-ind'; }, 650);
  }
  function showUI() {
    const wasHidden = !root.classList.contains('ui-on');
    root.classList.add('ui-on');
    if (wasHidden && typeof snapPaint === 'function') snapPaint();
    clearTimeout(uiTimer);
    if (kind === 'video' && !video.paused && !dragging && !audioOnly) uiTimer = setTimeout(() => root.classList.remove('ui-on'), 3200);
  }
  // One tap shows the controls at once, the next tap hides them at once, playing or paused (like YouTube).
  function setUI(on) { if (on) showUI(); else { root.classList.remove('ui-on'); clearTimeout(uiTimer); } }
  function toggleUI() { if (kind !== 'video' || audioOnly) { showUI(); return; } setUI(!root.classList.contains('ui-on')); }
  function toggle() { if (video.paused) { userPaused = false; video.play().catch(() => {}); } else { userPaused = true; video.pause(); } }
  function seekBy(d, quiet) {
    if (!isFinite(video.duration)) return;
    video.currentTime = clamp(video.currentTime + d, 0, video.duration);
    flash((d > 0 ? '+' : '−') + Math.abs(d) + ' ' + t('sec'), d > 0 ? 'right' : 'left');
    if (!quiet) showUI();   // a double-tap seek leaves the controls exactly as they were, like YouTube
  }

  // The seek bar only needs a few updates per second, and only while it can be seen. Redrawing it on every
  // screen frame (as before) made the page do layout 60 times a second under the video.
  function paint() {
    const d = video.duration;
    const c = video.currentTime;
    if (isFinite(d) && d > 0) {
      const p = (c / d) * 100;
      fill.style.width = p + '%'; knob.style.left = p + '%';
      if (video.buffered.length) { buf.style.width = (video.buffered.end(video.buffered.length - 1) / d) * 100 + '%'; }
      const dt = fmtDur(d);
      if (dt !== lastDurTxt) { lastDurTxt = dt; durT.textContent = dt; }
    }
    if (!dragging) { const ct = fmtDur(c); if (ct !== lastCurTxt) { lastCurTxt = ct; curT.textContent = ct; } }
  }
  const barVisible = () => root.classList.contains('ui-on') || audioOnly;
  // Once a second is plenty: the bar glides between updates with a CSS transition, so it still looks continuous.
  function snapPaint() {
    bar.classList.add('snap'); paint();
    requestAnimationFrame(() => requestAnimationFrame(() => bar.classList.remove('snap')));
  }
  function loop() {
    if (barVisible()) paint();
    if (!video.paused) raf = setTimeout(loop, 1000);
  }

  function persist() {
    const d = video.duration;
    if (!isFinite(d) || d <= 0 || !cur) return;
    const c = video.currentTime;
    if (c < 3 && !(cur.progress && cur.progress.f > 0)) return;
    const done = c > d - Math.min(8, d * 0.04);
    saveProgress(cur.id, done ? 1 : c / d, done ? 0 : c);
    if (!cur.meta?.duration) updateItem(cur.id, { meta: { ...cur.meta, duration: d, w: video.videoWidth, h: video.videoHeight } }, { silent: true });
  }

  /* ---------- loading items ---------- */
  async function load(i, { autoplay = true } = {}) {
    persist();
    idx = clamp(i, 0, items.length - 1);
    cur = items[idx];
    touchOpened(cur.id);
    err.classList.remove('show');
    spinner.classList.add('show');
    title.textContent = cur.meta?.title || stripExt(cur.name);
    aoName.textContent = title.textContent;
    repeatLeft = state.settings.repeatN || 2;
    if (kind === 'video' && state.settings.openMuted) video.muted = true;
    sub.textContent = kind === 'audio' ? (cur.meta?.author || '') : (items.length > 1 ? `${idx + 1} / ${items.length}` : '');
    updateNav();
    drawArt();
    // a file kept on the phone streams straight from there (no copy into memory); anything else is read from storage
    const direct = await mediaUrl(cur.id);
    const blob = direct ? null : await getBlob(cur.id);
    if (!direct && !blob) { showError(t('fileMissing')); return; }
    if (url) URL.revokeObjectURL(url);
    video.querySelectorAll('track').forEach((tr) => tr.remove());
    subUrls.splice(0).forEach((u) => URL.revokeObjectURL(u));
    usingDirect = !!direct;
    url = direct ? '' : URL.createObjectURL(blob);
    video.src = direct || url;
    video.defaultPlaybackRate = speed; video.playbackRate = speed;
    (cur.subs || []).forEach((s, n) => addTrack(s, n === 0));
    applySubStyle();
    const resume = cur.progress && cur.progress.f > 0 && cur.progress.f < 0.97 ? cur.progress.pos : 0;
    video.addEventListener('loadedmetadata', () => { if (resume > 2 && isFinite(video.duration)) video.currentTime = Math.min(resume, video.duration - 2); }, { once: true });
    if (autoplay) video.play().catch(() => { setPlayIcon(); });
    updateMediaSession();
    notify();
  }

  function updateNav() {
    const m = state.settings.playMode || 'seq';
    const shuffle = m === 'shuffle' && items.length > 1;
    prevBtn.disabled = shuffle ? hist.length === 0 : idx <= 0;
    nextBtn.disabled = shuffle ? false : (idx >= items.length - 1 && !(m === 'all' && items.length > 1));
    prevBtn.classList.toggle('off', prevBtn.disabled); nextBtn.classList.toggle('off', nextBtn.disabled);
  }

  function drawArt() {
    art.replaceChildren();
    if (kind !== 'audio') return;
    const u = thumbURL(cur);
    const cover = h('div', { class: 'a-cover' });
    if (u) cover.append(h('img', { src: u, alt: '' })); else cover.innerHTML = genSVG(cur.id + cur.name, 'audio') + `<div class="gen-ic">${ic('audio')}</div>`;
    art.append(cover, h('div', { class: 'a-name', dir: 'auto' }, cur.meta?.title || cur.name.replace(/\.[^.]+$/, '')), h('div', { class: 'a-by', dir: 'auto' }, cur.meta?.author || ''));
  }

  function showError(msg) {
    spinner.classList.remove('show');
    err.replaceChildren(h('div', { class: 've-ic', html: ic('info') }), h('p', null, msg),
      h('button', { class: 'btn primary', onClick: () => exportItem(cur.id) }, h('span', { html: ic('share') }), t('exportOpenWith')));
    err.classList.add('show');
    root.classList.add('ui-on');
  }

  function goRandom() {
    if (items.length < 2) return;
    let n; do { n = Math.floor(Math.random() * items.length); } while (n === idx);
    hist.push(idx); load(n);
  }
  function go(d) {
    const m = state.settings.playMode || 'seq';
    if (m === 'shuffle' && items.length > 1) {
      if (d > 0) return goRandom();
      const p = hist.pop();
      if (p != null) load(p);
      return;
    }
    let n = idx + d;
    if (m === 'all' && items.length > 1) n = (n + items.length) % items.length;
    if (n < 0 || n >= items.length) return;
    load(n);
  }
  function restart() { video.currentTime = 0; video.play().catch(() => {}); }

  /* ---------- subtitles ---------- */
  function addTrack(s, show) {
    const u = URL.createObjectURL(new Blob([s.vtt], { type: 'text/vtt' }));
    subUrls.push(u);
    const tr = h('track', { kind: 'subtitles', label: s.name, srclang: 'und', src: u });
    video.append(tr);
    tr.track.mode = show ? 'showing' : 'disabled';
  }
  function subsMenu() {
    const tracks = Array.from(video.textTracks);
    actionSheet(t('subtitles'), [
      { icon: 'close', label: t('subsOff'), checked: !tracks.some((x) => x.mode === 'showing'), onClick: () => tracks.forEach((x) => { x.mode = 'disabled'; }) },
      ...tracks.map((tr) => ({ icon: 'cc', label: tr.label || 'Subtitles', checked: tr.mode === 'showing', onClick: () => tracks.forEach((x) => { x.mode = x === tr ? 'showing' : 'disabled'; }) })),
      { icon: 'edit', label: t('subStyle'), onClick: () => subStyleSheet() },
      { icon: 'plus', label: t('addSubs'), onClick: async () => {
        const [f] = await pickFiles({ accept: '.srt,.vtt,text/vtt,application/x-subrip', multiple: false });
        if (!f) return;
        let text = await readText(f);
        text = toVtt(text);
        const entry = { name: f.name.replace(/\.[^.]+$/, ''), vtt: text };
        updateItem(cur.id, { subs: [...(cur.subs || []), entry] }, { silent: true });
        Array.from(video.textTracks).forEach((x) => { x.mode = 'disabled'; });
        addTrack(entry, true);
        toast(t('subsAdded'));
      } },
    ]);
  }

  function applySubStyle() {
    const st = state.settings;
    const size = SUB_SIZES[st.subSize] || 19;
    const col = SUB_COLORS[st.subColor] || '#fff';
    const bg = st.subBg === false ? 'transparent' : 'rgba(0, 0, 0, .68)';
    subStyle.textContent = `.media video::cue { font-size: ${size}px; color: ${col}; background-color: ${bg}; ${st.subBg === false ? 'text-shadow: 0 1px 3px #000, 0 0 6px #000;' : ''} }`;
  }
  function subStyleSheet() {
    const s = openSheet({ title: t('subStyle') });
    const draw = () => {
      const st = state.settings;
      s.body.replaceChildren(
        h('div', { class: 'set-row' }, h('span', null, t('subSize')), h('div', { class: 'seg' }, ['s', 'm', 'l', 'xl'].map((k) =>
          h('button', { class: 'seg-b' + (st.subSize === k ? ' on' : ''), onClick: () => { setSetting('subSize', k); applySubStyle(); draw(); } }, { s: 'A−', m: 'A', l: 'A+', xl: 'A++' }[k])))),
        h('div', { class: 'set-row' }, h('span', null, t('subColor')), h('div', { class: 'pick-row' }, Object.entries(SUB_COLORS).map(([k, c]) =>
          h('button', { class: 'pick' + (st.subColor === k ? ' on' : ''), style: { background: c }, 'aria-label': k, onClick: () => { setSetting('subColor', k); applySubStyle(); draw(); } })))),
        h('div', { class: 'set-row' }, h('span', null, t('subBg')), makeSwitch(st.subBg !== false, (v) => { setSetting('subBg', v); applySubStyle(); draw(); })));
    };
    draw();
  }

  function speedMenu() {
    actionSheet(t('speed'), SPEEDS.map((s) => ({ icon: 'speed', label: s + '×', checked: s === speed, onClick: () => setSpeed(s) })));
  }
  function setSpeed(s) { speed = s; video.defaultPlaybackRate = s; video.playbackRate = s; speedBtn.textContent = s + '×'; setSetting('speed', s); notify(); }

  /* ---------- orientation / fullscreen ---------- */
  async function toggleLandscape() {
    landscape = !landscape;
    if (landscape) {
      await lockOrientation('landscape');
      if (!isNative() && root.requestFullscreen) { try { await root.requestFullscreen(); } catch { /* ignore */ } }
    } else {
      await lockOrientation(null);
      if (document.fullscreenElement) { try { await document.exitFullscreen(); } catch { /* ignore */ } }
    }
  }

  /* ---------- seek bar ---------- */
  function seekFromEvent(e, commit) {
    const r = bar.getBoundingClientRect();
    const p = clamp((e.clientX - r.left) / r.width, 0, 1);
    const d = video.duration || 0;
    const time = p * d;
    fill.style.width = p * 100 + '%'; knob.style.left = p * 100 + '%';
    curT.textContent = fmtDur(time);
    bubble.textContent = fmtDur(time); bubble.style.left = p * 100 + '%';
    if (commit && isFinite(d)) video.currentTime = time;
  }
  bar.addEventListener('pointerdown', (e) => { dragging = true; bar.classList.add('drag'); bar.setPointerCapture(e.pointerId); clearTimeout(uiTimer); seekFromEvent(e, false); });
  bar.addEventListener('pointermove', (e) => { if (dragging) seekFromEvent(e, false); });
  const endDrag = (e) => { if (!dragging) return; seekFromEvent(e, true); dragging = false; bar.classList.remove('drag'); showUI(); };
  bar.addEventListener('pointerup', endDrag);
  bar.addEventListener('pointercancel', () => { dragging = false; bar.classList.remove('drag'); });
  bar.addEventListener('keydown', (e) => { if (e.key === 'ArrowRight') seekBy(5); if (e.key === 'ArrowLeft') seekBy(-5); });

  /* ---------- fill the screen: pinch out = the picture fills the screen exactly, pinch in = back to the normal fit ---------- */
  // The picture keeps object-fit: contain and is scaled up from its centre by exactly the factor that makes it cover the screen
  // (so if the width already fits, only the height grows to the screen). No re-layout, so it stays smooth.
  let fillZ = 1;
  const fillK = () => {
    const W = video.clientWidth, H = video.clientHeight, vw = video.videoWidth, vh = video.videoHeight;
    if (!vw || !vh || !W || !H) return 1;
    return Math.max(W / vw, H / vh) / Math.min(W / vw, H / vh);
  };
  const applyZ = (z, animate) => {
    fillZ = z;
    video.classList.toggle('v-snap', !!animate);
    video.style.transform = Math.abs(z - 1) < 0.0005 ? '' : `scale(${z.toFixed(4)})`;
  };
  function setFill(on, animate) {
    fit = on ? 'cover' : 'contain';
    applyZ(on ? fillK() : 1, animate);
  }
  const refit = () => { if (fit === 'cover') applyZ(fillK(), false); };
  video.addEventListener('loadedmetadata', refit);
  window.addEventListener('resize', refit);
  const ptrs = new Map();
  let pinch = null, pinched = false, guard = false, guardT = 0;
  const dist = () => { const [a, b] = [...ptrs.values()]; return Math.hypot(a.x - b.x, a.y - b.y) || 1; };
  const pinchEnd = () => {
    if (!pinch) return;
    const K = fillK(), z = fillZ, span = K - 1;
    const goFill = span > 0.02 && (pinch.z0 > 1.001 ? z > K - span * 0.35 : z > 1 + span * 0.35);
    setFill(goFill, true);
    if (goFill !== pinch.was) flash(goFill ? t('fill') : t('fit'));
    pinch = null;
  };
  // two fingers anywhere on the picture (also on top of the buttons) = pinch; it never counts as a tap
  root.addEventListener('pointerdown', (e) => {
    if (kind !== 'video' || e.target.closest('.sb, input')) return;
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.size === 2) {
      pinched = true; guard = true; clearTimeout(guardT);
      clearTimeout(holdTimer); clearTimeout(tapTimer); lastTap = 0; endHold();
      pinch = { d0: dist(), z0: fillZ, was: fit === 'cover' };
      video.classList.remove('v-snap');
    }
  }, true);
  root.addEventListener('pointermove', (e) => {
    const p = ptrs.get(e.pointerId);
    if (!p) return;
    p.x = e.clientX; p.y = e.clientY;
    if (!pinch || ptrs.size !== 2) return;
    const K = fillK();
    if (K < 1.02) return;                                       // the picture already has the shape of the screen
    applyZ(Math.max(0.94, Math.min(K * 1.05, pinch.z0 * (dist() / pinch.d0))), false);
  }, true);
  const lift = (e) => {
    if (!ptrs.delete(e.pointerId)) return;
    if (pinch && ptrs.size < 2) pinchEnd();
    if (!ptrs.size) { pinched = false; clearTimeout(guardT); guardT = setTimeout(() => { guard = false; }, 380); }
  };
  root.addEventListener('pointerup', lift, true);
  root.addEventListener('pointercancel', lift, true);
  root.addEventListener('click', (e) => { if (guard) { e.stopPropagation(); e.preventDefault(); } }, true);

  /* ---------- gestures: tap, double-tap, hold for 2x ---------- */
  tapZone.addEventListener('pointerdown', (e) => {
    if (pinched) return;
    holding = false;
    clearTimeout(holdTimer);
    holdTimer = setTimeout(() => {
      if (video.paused || kind !== 'video') return;
      holding = true; video.playbackRate = 2; flash('2×', 'center');
    }, 520);
    lastX = e.clientX;
  });
  const endHold = () => { clearTimeout(holdTimer); if (holding) { holding = false; video.playbackRate = speed; indicator.className = 'v-ind'; return true; } return false; };
  tapZone.addEventListener('pointercancel', endHold);
  tapZone.addEventListener('pointerup', (e) => {
    if (guard) return;
    if (endHold()) return;
    const now = performance.now();
    const r = tapZone.getBoundingClientRect();
    const rel = (e.clientX - r.left) / r.width;
    if (now - lastTap < 300 && Math.abs(e.clientX - lastX) < 90) {
      // second tap of a double tap: undo what the first tap just did to the controls, then seek / play-pause
      clearTimeout(tapTimer); lastTap = 0;
      setUI(uiBeforeTap);
      if (kind !== 'video') { toggle(); return; }
      if (rel < 0.34) seekBy(-10, true); else if (rel > 0.66) seekBy(10, true); else toggle();
    } else {
      // single tap: react immediately, no waiting to see whether a second tap follows
      lastTap = now; lastX = e.clientX;
      uiBeforeTap = root.classList.contains('ui-on');
      toggleUI();
    }
  });

  /* ---------- keyboard ---------- */
  const onKey = (e) => {
    if (e.target.matches('input, textarea')) return;
    const k = e.key;
    if (k === ' ' || k === 'k') { e.preventDefault(); toggle(); }
    else if (k === 'ArrowRight') seekBy(10);
    else if (k === 'ArrowLeft') seekBy(-10);
    else if (k === 'ArrowUp') { video.volume = clamp(video.volume + 0.1, 0, 1); flash(Math.round(video.volume * 100) + '%', 'center'); }
    else if (k === 'ArrowDown') { video.volume = clamp(video.volume - 0.1, 0, 1); flash(Math.round(video.volume * 100) + '%', 'center'); }
    else if (k === 'm') { video.muted = !video.muted; flash(video.muted ? t('muted') : t('unmuted'), 'center'); }
    else if (k === 'f') toggleLandscape();
    else if (k === 'n') go(1);
    else if (k === 'p') go(-1);
    else if (k === 'Escape' && !document.fullscreenElement) V.close();
    showUI();
  };
  document.addEventListener('keydown', onKey);

  /* ---------- video events ---------- */
  video.addEventListener('play', () => {
    setPlayIcon(); clearTimeout(raf); loop();
    if (kind === 'video' && !audioOnly && state.settings.keepAwake !== false) keepAwake(true);
    if (bgOn() && !askedNotify) { askedNotify = true; askNotifyPermission(); }
    showUI(); notify();
  });
  video.addEventListener('pause', () => {
    // The system sometimes pauses a hidden WebView by itself. Carry straight on (no 250 ms gap, no "paused" flash in the
    // notification); retry shortly after if the first attempt did not stick. At most a few times, and never after the user paused.
    const bySystem = document.hidden && bgOn() && !userPaused && !video.ended && !leaving;
    if (bySystem) {
      const now = Date.now();
      autoResumeAt = autoResumeAt.filter((x) => now - x < 10000);
      if (autoResumeAt.length < 3) {
        autoResumeAt.push(now);
        video.play().catch(() => {});
        setTimeout(() => { if (video.paused && !userPaused && !leaving) video.play().catch(() => {}); }, 250);
        persist();
        return;
      }
    }
    setPlayIcon(); paint(); keepAwake(false); persist(); showUI(); notify();
  });
  video.addEventListener('seeking', () => { if (barVisible()) snapPaint(); });
  video.addEventListener('seeked', () => notify());
  video.addEventListener('ratechange', () => notify());
  video.addEventListener('waiting', () => spinner.classList.add('show'));
  video.addEventListener('canplay', () => spinner.classList.remove('show'));
  video.addEventListener('playing', () => spinner.classList.remove('show'));
  video.addEventListener('loadedmetadata', () => { paint(); setPlayIcon(); notify(); });
  video.addEventListener('timeupdate', () => { if (video.paused) paint(); });
  video.addEventListener('ended', () => {
    if (sleepEnd) { clearSleep(); saveProgress(cur.id, 1, 0); setPlayIcon(); showUI(); notify(); toast(t('sleepStopped')); return; }
    const m = state.settings.playMode || 'seq';
    if (m === 'one') { restart(); return; }
    if (m === 'n') {
      repeatLeft--;
      if (repeatLeft > 0) { flash(`${(state.settings.repeatN || 2) - repeatLeft + 1} / ${state.settings.repeatN || 2}`, 'center'); restart(); return; }
      repeatLeft = state.settings.repeatN || 2;
    }
    saveProgress(cur.id, 1, 0);
    if (m === 'once') { setPlayIcon(); showUI(); notify(); return; }
    if (m === 'shuffle' && items.length > 1) { goRandom(); return; }
    if (idx < items.length - 1) go(1);
    else if (m === 'all') load(0);
    else { setPlayIcon(); showUI(); notify(); }
  });
  video.addEventListener('error', () => {
    const code = video.error?.code;
    if (code === 1) return;
    if (usingDirect) {   // streaming from the phone's file did not work here: load the file the ordinary way instead
      usingDirect = false;
      const id = cur.id, at = video.currentTime || 0;
      getBlob(id).then((b) => {
        if (!b || cur.id !== id) { showError(t('fileMissing')); return; }
        url = URL.createObjectURL(b);
        video.addEventListener('loadedmetadata', () => { if (at > 1 && isFinite(video.duration)) video.currentTime = Math.min(at, video.duration - 1); }, { once: true });
        video.src = url;
        video.play().catch(() => { setPlayIcon(); });
      });
      return;
    }
    showError(kind === 'video' ? t('cannotPlayVideo') : t('cannotPlayAudio'));
  });
  saveTimer = setInterval(() => { if (!video.paused) { persist(); notify(); } }, 5000);

  function updateMediaSession() {
    if (!('mediaSession' in navigator)) return;
    try {
      const u = thumbURL(cur);
      navigator.mediaSession.metadata = new MediaMetadata({ title: cur.meta?.title || cur.name, artist: cur.meta?.author || 'AHOS Library', artwork: u ? [{ src: u, sizes: '420x420', type: 'image/jpeg' }] : [] });
      navigator.mediaSession.setActionHandler('play', () => { userPaused = false; video.play(); });
      navigator.mediaSession.setActionHandler('pause', () => { userPaused = true; video.pause(); });
      navigator.mediaSession.setActionHandler('previoustrack', items.length > 1 ? () => go(-1) : null);
      navigator.mediaSession.setActionHandler('nexttrack', items.length > 1 ? () => go(1) : null);
      navigator.mediaSession.setActionHandler('seekbackward', () => seekBy(-10));
      navigator.mediaSession.setActionHandler('seekforward', () => seekBy(10));
    } catch { /* optional */ }
  }

  /* ---------- background playback: notification + lock-screen controls (Android) ---------- */
  function notify() {
    if (!bgOn() || leaving || !cur) return;
    const m = state.settings.playMode || 'seq';
    mediaNotify({
      title: cur.meta?.title || stripExt(cur.name), artist: cur.meta?.author || 'AHOS Library', playing: !video.paused,
      position: video.currentTime || 0, duration: isFinite(video.duration) ? video.duration : 0, speed: video.playbackRate || 1,
      hasPrev: m === 'shuffle' ? hist.length > 0 : idx > 0, hasNext: m === 'shuffle' ? items.length > 1 : (idx < items.length - 1 || (m === 'all' && items.length > 1)),
    });
  }
  setMediaHandler((e) => {
    if (leaving) return;
    if (e.action === 'play') { userPaused = false; video.play().catch(() => {}); }
    else if (e.action === 'pause') { userPaused = true; video.pause(); }
    else if (e.action === 'next') go(1);
    else if (e.action === 'prev') go(-1);
    else if (e.action === 'seek' && isFinite(e.position)) video.currentTime = clamp(e.position, 0, video.duration || e.position);
    else if (e.action === 'stop') { userPaused = true; video.pause(); mediaStop(); }
  });
  const onVis = () => {
    if (!document.hidden || video.paused) return;
    if (kind === 'video' && !audioOnly && state.settings.autoPip && document.pictureInPictureEnabled) { video.requestPictureInPicture().catch(() => {}); return; }
    if (!bgOn()) { userPaused = true; video.pause(); }
  };
  document.addEventListener('visibilitychange', onVis);

  /* ---------- audio only / bookmarks / sleep timer / repeat ---------- */
  function setAudioOnly(on) {
    audioOnly = on;
    root.classList.toggle('audio-only', on);
    aoBtn.classList.toggle('on', on);
    if (on) { root.classList.add('ui-on'); clearTimeout(uiTimer); keepAwake(false); immersive(false); }
    else { if (!video.paused && state.settings.keepAwake !== false) keepAwake(true); if (kind === 'video') immersive(true); showUI(); }
    toast(on ? t('audioOnlyOn') : t('audioOnlyOff'));
  }
  function openMarks() {
    marksSheet(cur, {
      getHere: () => ({ pos: Math.floor(video.currentTime || 0) }),
      onGo: (m) => { video.currentTime = clamp(m.pos, 0, video.duration || m.pos); video.play().catch(() => {}); showUI(); },
    });
  }
  function clearSleep() { clearTimeout(sleepTimer); sleepTimer = 0; sleepEnd = false; sleepBtn.classList.remove('on'); }
  function setSleep(min) {
    clearSleep();
    if (min === 'end') { sleepEnd = true; sleepBtn.classList.add('on'); toast(t('sleepEnd')); return; }
    if (!min) { toast(t('sleepOff')); return; }
    sleepBtn.classList.add('on');
    sleepTimer = setTimeout(fireSleep, min * 60000);
    toast(t('sleepIn', { n: min }));
  }
  function fireSleep() {
    const v0 = video.volume; let k = 0;
    const iv = setInterval(() => {
      k++; try { video.volume = Math.max(0, v0 * (1 - k / 10)); } catch { /* read-only on some devices */ }
      if (k >= 10) { clearInterval(iv); userPaused = true; video.pause(); try { video.volume = v0; } catch { /* ignore */ } clearSleep(); toast(t('sleepStopped')); }
    }, 300);
  }
  function sleepSheet() {
    actionSheet(t('sleepTimer'), [
      { icon: 'close', label: t('sleepOff'), onClick: () => setSleep(0) },
      ...[15, 30, 45, 60, 90].map((m) => ({ icon: 'clock', label: t('nMinutes', { n: m }), onClick: () => setSleep(m) })),
      { icon: 'pauseAfter', label: t('sleepEndItem'), onClick: () => setSleep('end') },
    ]);
  }
  const makeSwitch = (on, onChange) => {
    const b = h('button', { class: 'switch' + (on ? ' on' : ''), role: 'switch', 'aria-checked': String(!!on) });
    b.addEventListener('click', (e) => { e.stopPropagation(); const v = !b.classList.contains('on'); b.classList.toggle('on', v); b.setAttribute('aria-checked', String(v)); onChange(v); });
    return b;
  };

  /* ---------- the playback settings sheet ---------- */
  function playbackSheet() {
    const s = openSheet({ title: t('playbackSettings'), tall: true });
    const sec = (title, ...nodes) => h('section', { class: 'ps-sec' }, title ? h('div', { class: 'ps-h' }, title) : null, ...nodes);
    const q = (icon, label, onClick, on = false) => h('button', { class: 'ps-q' + (on ? ' on' : ''), onClick }, h('span', { html: ic(icon) }), h('span', null, label));
    const swRow = (label, sub, on, onChange) => h('div', { class: 'ps-row' }, h('span', null, label, sub ? h('small', null, sub) : null), makeSwitch(on, onChange));
    const linkRow = (label, value, onClick) => h('button', { class: 'ps-row', onClick }, h('span', null, label), h('span', { class: 'ps-val' }, value || '', h('span', { class: 'flip-rtl', html: ic('chevron') })));
    const draw = () => {
      const st = state.settings;
      const mode = st.playMode || 'seq';
      const N = st.repeatN || 2;
      const modes = [['seq', 'seq', t('pm_seq')], ['all', 'repeat', t('pm_all')], ['one', 'repeat1', t('pm_one')], ['n', null, t('pm_n')], ['once', 'pauseAfter', t('pm_once')], ['shuffle', 'shuffle', t('pm_shuffle')]];
      const setMode = (m) => { setSetting('playMode', m); repeatLeft = N; updateNav(); notify(); draw(); };
      const tracks = Array.from(video.textTracks || []);
      const showing = tracks.find((x) => x.mode === 'showing');
      const aTracks = video.audioTracks && video.audioTracks.length > 1 ? Array.from(video.audioTracks) : null;
      s.body.replaceChildren(
        h('div', { class: 'ps-quick-wrap' }, sec(null, h('div', { class: 'ps-quick' },
          q('share', t('share'), () => { s.close(); exportItem(cur.id); }),
          kind === 'video' ? q('headphones', t('audioOnly'), () => { setAudioOnly(!audioOnly); draw(); }, audioOnly) : null,
          q('info', t('details'), () => itemDetails(cur.id)),
          q('bookmark', t('bookmarks'), () => openMarks()),
          q('clock', t('sleepTimer'), () => sleepSheet())))),
        sec(t('playMode'),
          h('div', { class: 'ps-modes' }, modes.map(([id, icon, label]) =>
            h('button', { class: 'ps-m' + (mode === id ? ' on' : ''), onClick: () => setMode(id) },
              icon ? h('span', { html: ic(icon) }) : h('span', { class: 'ps-n' }, '×' + N), h('span', null, label)))),
          mode === 'n' ? h('div', { class: 'ps-repeat' }, h('span', null, t('repeatTimes')),
            h('div', { class: 'stepper' },
              h('button', { class: 'btn ghost', 'aria-label': '-', onClick: () => { setSetting('repeatN', clamp(N - 1, 2, 30)); repeatLeft = state.settings.repeatN; draw(); } }, '−'),
              h('b', null, String(N)),
              h('button', { class: 'btn ghost', 'aria-label': '+', onClick: () => { setSetting('repeatN', clamp(N + 1, 2, 30)); repeatLeft = state.settings.repeatN; draw(); } }, '+'))) : null),
        sec(t('speed'), h('div', { class: 'ps-chips' }, SPEEDS.map((v) => h('button', { class: 'ps-chip' + (v === speed ? ' on' : ''), onClick: () => { setSpeed(v); draw(); } }, v + '×')))),
        sec(null,
          kind === 'video' ? swRow(t('keepAwake'), t('keepAwakeShort'), st.keepAwake !== false, (v) => { setSetting('keepAwake', v); if (!video.paused) keepAwake(v && !audioOnly); }) : null,
          kind === 'video' ? swRow(t('openMuted'), '', !!st.openMuted, (v) => setSetting('openMuted', v)) : null,
          swRow(t('bgAudio'), t('bgAudioShort'), bgOn(), (v) => { setSetting('bgAudio', v); if (!v) mediaStop(); else notify(); }),
          kind === 'video' && document.pictureInPictureEnabled ? swRow(t('autoPip'), '', !!st.autoPip, (v) => setSetting('autoPip', v)) : null),
        sec(null,
          kind === 'video' ? linkRow(t('subtitles'), showing ? showing.label : t('subsOff'), () => subsMenu()) : null,
          aTracks ? linkRow(t('audioTrack'), (aTracks.find((x) => x.enabled) || {}).label || '', () => actionSheet(t('audioTrack'), aTracks.map((x, i) => ({ icon: 'audio', label: x.label || `${t('audioTrack')} ${i + 1}`, checked: x.enabled, onClick: () => aTracks.forEach((y) => { y.enabled = y === x; }) })))) : null,
          linkRow(t('moreActions'), '', () => { s.close(); setTimeout(() => itemActions(cur.id, { afterDelete: () => V.close() }), 150); })));
    };
    draw();
  }

  function cleanup() {
    leaving = true;
    setMediaHandler(null); mediaStop(); clearSleep();
    document.removeEventListener('visibilitychange', onVis);
    persist();
    clearInterval(saveTimer); clearTimeout(uiTimer); clearTimeout(holdTimer); clearTimeout(tapTimer); clearTimeout(raf);
    try { freezeInsets(); } catch { /* ignore */ }
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('resize', refit);
    try { video.pause(); } catch { /* ignore */ }
    video.removeAttribute('src'); video.load();
    if (url) URL.revokeObjectURL(url);
    subUrls.forEach((u) => URL.revokeObjectURL(u));
    keepAwake(false);
    if (landscape) lockOrientation(null);
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    immersive(false);
    if ('mediaSession' in navigator) { try { navigator.mediaSession.metadata = null; } catch { /* ignore */ } }
  }

  speedBtn.textContent = speed + '×';
  setPlayIcon();
  if (kind === 'video') immersive(true);
  load(idx);
}
