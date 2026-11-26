// The text note editor: a title and a body made of blocks (paragraph, heading, checklist item, bullet, divider, drawing). Every block is its own
// little text field, so Arabic and English lines each run in their own direction. Enter splits a block, Backspace at the start joins it to the one
// before, a pasted text becomes blocks, "- " / "[] " / "# " at the start of a line turn it into a bullet / checklist item / heading.
// Everything is saved by itself; an empty note is not kept.
import { h, debounce } from '../util.js';
import { ic } from '../icons.js';
import { t, lang } from '../i18n.js';
import { state, updateItem, removeItems, onItemPatch } from '../store.js';
import { toast, actionSheet, confirmDialog } from '../ui.js';
import { mountViewer, touchOpened } from './common.js';
import { loadCss } from '../lazycss.js';
import { thumbURL } from '../covers.js';
import { exportBlob, shareText, copyText } from '../native.js';
import { loadText, saveTextNote, mkBlock, isTexty, plainText, charCount, isEmpty, dirOf, cleanText, lineKind, MARKER } from '../notes/model.js';

const HIST_MAX = 120;
const locale = () => (lang() === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB');
const when = (ms) => { try { return new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(ms)); } catch { return ''; } };

export async function openTextNote(id, { fresh = false } = {}) {
  const item = state.items.get(id);
  if (!item) return;
  await loadCss('css/notes.css');
  let tn;
  try { tn = await loadText(id); } catch { toast(t('viewerFailed')); return; }
  touchOpened(id);

  let dirty = false, closed = false, focusedId = null;
  const rows = new Map();                                   // block id → { el, ta }
  const V = mountViewer('tnv', { onClose: () => { closed = true; offPatch(); window.removeEventListener('pagehide', flushNow); document.removeEventListener('visibilitychange', onVis); vv && vv.removeEventListener('resize', kb); void finish(); } });
  const root = V.el;
  root.dataset.id = id;

  /* ---------- history (undo / redo) ---------- */
  const snap = () => JSON.stringify({ title: tn.title, blocks: tn.blocks });
  let hist = [{ s: snap(), f: null, c: 0 }], hi = 0;
  const caretOf = () => { const a = document.activeElement; return a && a.classList?.contains('tn-ta') ? [a.dataset.id, a.selectionStart] : a === titleEl ? ['title', a.selectionStart] : [null, 0]; };
  const pushHist = () => {
    const s = snap();
    if (s === hist[hi].s) return;
    hist = hist.slice(0, hi + 1);
    const [f, c] = caretOf();
    hist.push({ s, f, c }); if (hist.length > HIST_MAX) hist.shift();
    hi = hist.length - 1;
    syncUndo();
  };
  const softHist = debounce(pushHist, 450);
  const restore = (e) => {
    const d = JSON.parse(e.s);
    tn = cleanText(d);
    titleEl.value = tn.title; fitTa(titleEl);
    renderAll();
    const fid = e.f && (e.f === 'title' || tn.blocks.some((b) => b.id === e.f)) ? e.f : null;
    if (fid === 'title') { titleEl.focus(); titleEl.setSelectionRange(e.c, e.c); }
    else if (fid) focusBlock(fid, e.c);
    changed(); syncUndo();
  };
  const undo = () => { softHist.cancel?.(); pushHist(); if (hi <= 0) return; hi--; restore(hist[hi]); };
  const redo = () => { if (hi >= hist.length - 1) return; hi++; restore(hist[hi]); };

  /* ---------- saving ---------- */
  const doSave = async () => { if (!dirty) return; dirty = false; setStatus('saving'); try { await saveTextNote(id, tn); setStatus('saved'); } catch (e) { console.warn('save note', e); dirty = true; setStatus('failed'); } };
  const saveSoon = debounce(doSave, 700);
  const changed = () => { dirty = true; setStatus('edit'); saveSoon(); updateMeta(); };
  const flushNow = () => { softHist.cancel?.(); pushHist(); saveSoon.cancel?.(); void doSave(); };
  const onVis = () => { if (document.visibilityState === 'hidden') flushNow(); };
  window.addEventListener('pagehide', flushNow);
  document.addEventListener('visibilitychange', onVis);
  async function finish() {
    softHist.cancel?.(); saveSoon.cancel?.();
    if (isEmpty(tn)) { try { await removeItems([id]); } catch { /* ignore */ } return; }
    dirty = true; await doSave();
    if (state.items.has(id)) updateItem(id, { opened: Date.now() });      // the lists behind this page redraw with what was written
  }

  /* ---------- the page ---------- */
  const titleEl = h('textarea', { class: 'tn-title', rows: 1, dir: 'auto', placeholder: t('tn_title'), 'aria-label': t('tn_title'), enterkeyhint: 'next', maxlength: 300, spellcheck: true });
  titleEl.value = tn.title;
  const metaEl = h('div', { class: 'tn-meta' });
  const stat = h('span', { class: 'tn-stat' });
  const list = h('div', { class: 'tn-blocks' });
  const tail = h('div', { class: 'tn-tail', 'aria-hidden': 'true' });                 // tapping the empty space under the last line writes there
  const scroller = h('div', { class: 'tn-scroll' }, h('div', { class: 'tn-page' }, metaEl, titleEl, list, tail));
  const undoB = h('button', { class: 'vbtn', type: 'button', 'aria-label': t('bd_undo'), title: t('bd_undo'), onClick: undo, html: ic('undo') });
  const redoB = h('button', { class: 'vbtn', type: 'button', 'aria-label': t('bd_redo'), title: t('bd_redo'), onClick: redo, html: ic('redo') });
  const doneB = h('button', { class: 'vbtn tn-done', type: 'button', 'aria-label': t('done'), title: t('done'), onClick: () => { document.activeElement?.blur?.(); }, html: ic('check') });
  const top = h('div', { class: 'rv-top tn-top' },
    h('button', { class: 'vbtn', type: 'button', 'aria-label': t('back'), title: t('back'), onClick: () => V.close(), html: ic('back', 'flip-rtl') }),
    h('span', { class: 'tn-grow' }), undoB, redoB, doneB,
    h('button', { class: 'vbtn', type: 'button', 'aria-label': t('share'), title: t('share'), onClick: () => shareNote(), html: ic('share') }),
    h('button', { class: 'vbtn', type: 'button', 'aria-label': t('more'), title: t('more'), onClick: () => moreMenu(), html: ic('more') }));
  const barBtn = (cls, icon, label, fn) => h('button', { class: 'tn-bb ' + cls, type: 'button', 'aria-label': label, title: label, onPointerDown: (e) => e.preventDefault(), onClick: fn, html: ic(icon) });
  const todoB = barBtn('tn-todo', 'todo', t('tn_checklist'), () => toggleType('todo'));
  const bar = h('div', { class: 'tn-bar bd-ui' }, barBtn('tn-pen', 'penLine', t('tn_draw'), () => drawMenu()), todoB, barBtn('tn-plus', 'plus', t('tn_insert'), () => insertMenu()));
  root.append(scroller, top, bar);

  function setStatus(s) { stat.textContent = s === 'saved' ? t('tn_saved') : s === 'saving' ? '…' : s === 'failed' ? t('tn_notSaved') : ''; stat.dataset.s = s; }
  function updateMeta() {
    const n = charCount(tn);
    metaEl.replaceChildren(h('span', null, when(item.added ? (state.items.get(id)?.meta?.edited || item.added) : Date.now())), h('i'), h('span', null, t('tn_chars', { n })), h('i'), stat);
  }
  function syncUndo() { undoB.disabled = hi <= 0; redoB.disabled = hi >= hist.length - 1; undoB.classList.toggle('off', undoB.disabled); redoB.classList.toggle('off', redoB.disabled); }

  /* ---------- text fields ---------- */
  function fitTa(ta) { ta.style.height = '0px'; ta.style.height = Math.max(ta.scrollHeight, 24) + 'px'; }
  const find = (bid) => tn.blocks.findIndex((b) => b.id === bid);
  function focusBlock(bid, caret = null) {
    const r = rows.get(bid);
    if (!r || !r.ta) return;
    r.ta.focus({ preventScroll: false });
    const c = caret == null ? r.ta.value.length : Math.max(0, Math.min(caret, r.ta.value.length));
    try { r.ta.setSelectionRange(c, c); } catch { /* ignore */ }
  }

  function leadFor(b) {
    if (b.t === 'todo') {
      const box = h('button', { class: 'tn-box' + (b.done ? ' on' : ''), type: 'button', role: 'checkbox', 'aria-checked': String(!!b.done), 'aria-label': t('tn_check'), onPointerDown: (e) => e.preventDefault(),
        onClick: () => { b.done = !b.done; const r = rows.get(b.id); r.el.classList.toggle('done', b.done); box.classList.toggle('on', b.done); box.setAttribute('aria-checked', String(b.done)); pushHist(); changed(); } }, h('span', { html: ic('check') }));
      return box;
    }
    if (b.t === 'bullet') return h('span', { class: 'tn-dot', 'aria-hidden': 'true' });
    return null;
  }

  function buildRow(b) {
    if (b.t === 'hr') {
      const el = h('div', { class: 'tn-b hr', dataset: { id: b.id } }, h('hr'), h('button', { class: 'tn-x', type: 'button', 'aria-label': t('delete'), onClick: () => removeBlock(b.id), html: ic('close') }));
      rows.set(b.id, { el, ta: null }); return el;
    }
    if (b.t === 'board') {
      const it = state.items.get(b.ref);
      const img = it && thumbURL(it) ? h('img', { src: thumbURL(it), alt: '', draggable: false }) : h('span', { class: 'tn-noimg', html: ic('bdPen') });
      const card = h('button', { class: 'tn-draw-c', type: 'button', onClick: () => openDrawing(b), 'aria-label': t('tn_openDrawing') }, img, h('span', { class: 'tn-cap' }, h('span', { html: ic('penLine') }), it ? t('tn_openDrawing') : t('tn_drawingGone')));
      const el = h('div', { class: 'tn-b draw', dataset: { id: b.id, ref: b.ref } }, card, h('button', { class: 'tn-x', type: 'button', 'aria-label': t('tn_removeDrawing'), onClick: () => removeBlock(b.id), html: ic('close') }));
      rows.set(b.id, { el, ta: null }); return el;
    }
    const ta = h('textarea', { class: 'tn-ta', rows: 1, dir: 'auto', dataset: { id: b.id }, 'aria-label': t('tn_body'), placeholder: '', enterkeyhint: 'enter', autocapitalize: 'sentences', spellcheck: true });
    ta.value = b.s;
    const lead = leadFor(b);
    const el = h('div', { class: `tn-b ${b.t}` + (b.t === 'todo' && b.done ? ' done' : ''), dataset: { id: b.id }, dir: dirOf(b.s) === 'rtl' ? 'rtl' : null }, lead, ta);
    rows.set(b.id, { el, ta });
    wireTa(ta, b, el);
    return el;
  }

  let lastShift = false, lastDelWord = false;
  function wireTa(ta, b, el) {
    ta.addEventListener('keydown', (e) => { lastShift = e.shiftKey; lastDelWord = e.ctrlKey || e.altKey; if (e.isComposing) return; edgeKeys(e, ta, b); });
    ta.addEventListener('focus', () => { focusedId = b.id; root.classList.add('editing'); syncBar(); });
    ta.addEventListener('blur', () => { setTimeout(() => { if (!document.activeElement?.classList?.contains('tn-ta') && document.activeElement !== titleEl) { root.classList.remove('editing'); focusedId = null; syncBar(); } }, 60); flushNow(); });
    ta.addEventListener('input', () => {
      const cur = tn.blocks[find(b.id)]; if (!cur) return;
      cur.s = ta.value;
      // markdown-like starts: "- " bullet, "[] " checklist item, "# " heading – only at the moment the marker is typed at the start of a paragraph
      if (cur.t === 'p' && !ta.value.includes('\n')) {
        const m = MARKER.exec(ta.value);
        if (m && ta.selectionStart === m[0].length && m[0].length === ta.value.length) { const k = lineKind(ta.value + 'x'); retype(cur, k.t, { s: '', done: k.done }); pushHist(); changed(); return; }
      }
      const rtl = dirOf(ta.value) === 'rtl'; if ((el.dir === 'rtl') !== rtl) el.dir = rtl ? 'rtl' : '';
      fitTa(ta); softHist(); changed();
    });
    ta.addEventListener('beforeinput', (e) => {
      const cur = tn.blocks[find(b.id)]; if (!cur) return;
      if ((e.inputType === 'insertParagraph' || e.inputType === 'insertLineBreak') && !lastShift) { e.preventDefault(); splitAt(cur, ta.selectionStart, ta.selectionEnd); return; }
      if (e.inputType === 'deleteContentBackward' && ta.selectionStart === 0 && ta.selectionEnd === 0 && !lastDelWord) { e.preventDefault(); backAtStart(cur); }
    });
    ta.addEventListener('paste', (e) => {
      const text = (e.clipboardData || window.clipboardData)?.getData('text');
      if (!text || !/\n/.test(text.replace(/\r\n?/g, '\n').replace(/\n+$/, ''))) return;
      e.preventDefault();
      pasteLines(tn.blocks[find(b.id)], ta, text);
    });
  }

  /** Up / Down at the first / last line moves to the neighbouring block (desktop keyboards) */
  function edgeKeys(e, ta, b) {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    if (e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return;
    const i = find(b.id), up = e.key === 'ArrowUp';
    const before = ta.selectionStart;
    requestAnimationFrame(() => {
      if (document.activeElement !== ta || ta.selectionStart !== before || ta.selectionStart !== ta.selectionEnd) return;      // the caret moved inside the block
      const j = up ? i - 1 : i + 1, nb = tn.blocks[j];
      if (up && !nb) { titleEl.focus(); titleEl.setSelectionRange(titleEl.value.length, titleEl.value.length); return; }
      for (let k = j; k >= 0 && k < tn.blocks.length; k += up ? -1 : 1) if (isTexty(tn.blocks[k])) { focusBlock(tn.blocks[k].id, up ? null : 0); return; }
    });
  }

  /* ---------- the structure ---------- */
  function renderAll() {
    rows.clear();
    list.replaceChildren(...tn.blocks.map(buildRow));
    requestAnimationFrame(() => { for (const r of rows.values()) if (r.ta) fitTa(r.ta); });
    syncBar();
  }
  function insertAfter(idx, nb) {
    tn.blocks.splice(idx + 1, 0, nb);
    const el = buildRow(nb);
    const prev = tn.blocks[idx] && rows.get(tn.blocks[idx].id);
    if (prev) prev.el.after(el); else list.prepend(el);
    const r = rows.get(nb.id); if (r?.ta) fitTa(r.ta);
    return nb;
  }
  function removeBlock(bid, { keepOne = true } = {}) {
    const i = find(bid); if (i < 0) return;
    tn.blocks.splice(i, 1);
    rows.get(bid)?.el.remove(); rows.delete(bid);
    if (keepOne && !tn.blocks.length) { const nb = mkBlock('p', ''); tn.blocks.push(nb); list.append(buildRow(nb)); focusBlock(nb.id, 0); }
    pushHist(); changed();
  }
  /** a block becomes another kind (the text stays); the row is rebuilt in place and keeps the caret */
  function retype(b, type, over = {}) {
    const i = find(b.id); if (i < 0) return;
    const old = rows.get(b.id), pos = old?.ta ? old.ta.selectionStart : 0;
    const nb = { id: b.id, t: type, s: over.s != null ? over.s : b.s, ...(type === 'todo' ? { done: !!over.done } : {}) };
    tn.blocks[i] = nb;
    const el = buildRow(nb);
    old?.el.replaceWith(el);
    const r = rows.get(nb.id); if (r?.ta) { fitTa(r.ta); r.ta.focus(); const c = over.s != null && over.s !== b.s ? r.ta.value.length : pos; try { r.ta.setSelectionRange(c, c); } catch { /* ignore */ } }
    syncBar();
  }
  function splitAt(b, from, to) {
    const i = find(b.id), r = rows.get(b.id), val = r.ta.value;
    const keep = val.slice(0, from), rest = val.slice(to);
    if ((b.t === 'todo' || b.t === 'bullet') && !val.trim()) { retype(b, 'p', { s: '' }); pushHist(); changed(); return; }       // Enter on an empty list line ends the list
    b.s = keep; r.ta.value = keep; fitTa(r.ta); r.el.dir = dirOf(keep) === 'rtl' ? 'rtl' : '';
    const nb = insertAfter(i, b.t === 'todo' ? mkBlock('todo', rest) : b.t === 'bullet' ? mkBlock('bullet', rest) : mkBlock('p', rest));
    focusBlock(nb.id, 0);
    pushHist(); changed();
  }
  function backAtStart(b) {
    const i = find(b.id), r = rows.get(b.id);
    if (b.t !== 'p') { retype(b, 'p'); pushHist(); changed(); return; }
    const prev = tn.blocks[i - 1];
    if (!prev) { if (!b.s && tn.blocks.length > 1) { removeBlock(b.id); const nx = tn.blocks[0]; if (nx) focusBlock(nx.id, 0); } return; }
    if (prev.t === 'hr' || prev.t === 'board') { removeBlock(prev.id, { keepOne: false }); pushHist(); changed(); return; }
    const pr = rows.get(prev.id), at = prev.s.length;
    prev.s += r.ta.value; pr.ta.value = prev.s; fitTa(pr.ta);
    tn.blocks.splice(i, 1); r.el.remove(); rows.delete(b.id);
    focusBlock(prev.id, at);
    pushHist(); changed();
  }
  function pasteLines(b, ta, text) {
    if (!b) return;
    const lines = text.replace(/\r\n?/g, '\n').replace(/\n+$/, '').split('\n');
    const i = find(b.id), val = ta.value, from = ta.selectionStart, to = ta.selectionEnd;
    const head = val.slice(0, from), tailTxt = val.slice(to);
    const kinds = lines.map((l, k) => (k === 0 && b.t !== 'p' ? { t: b.t, s: l.replace(MARKER, ''), done: false } : lineKind(l)));
    // the first line joins what is before the caret; the last one is followed by what was after it
    const first = kinds[0];
    b.s = head + first.s;
    if (b.t === 'p' && !head.trim() && first.t !== 'p') retypeSilent(b, first); else { ta.value = b.s; fitTa(ta); }
    let at = i, last = b;
    for (let k = 1; k < kinds.length; k++) {
      const kd = kinds[k], nb = mkBlock(kd.t, kd.s, kd.t === 'todo' ? { done: !!kd.done } : null);
      at++; insertAfter(at - 1, nb); last = nb;
    }
    const caret = last.s.length;
    last.s += tailTxt; const lr = rows.get(last.id); if (lr?.ta) { lr.ta.value = last.s; fitTa(lr.ta); }
    focusBlock(last.id, caret);
    pushHist(); changed();
  }
  function retypeSilent(b, kd) { const i = find(b.id); const nb = { id: b.id, t: kd.t, s: b.s, ...(kd.t === 'todo' ? { done: !!kd.done } : {}) }; tn.blocks[i] = nb; const old = rows.get(b.id); old.el.replaceWith(buildRow(nb)); const r = rows.get(nb.id); if (r?.ta) fitTa(r.ta); }

  /* ---------- the bar at the bottom ---------- */
  const current = () => tn.blocks.find((b) => b.id === focusedId) || null;
  function syncBar() { const c = current(); todoB.classList.toggle('on', !!c && c.t === 'todo'); }
  function toggleType(type) {
    let c = current();
    if (!c) {                                                  // nothing is being written: continue at the end of the note
      const last = tn.blocks[tn.blocks.length - 1];
      if (last && isTexty(last) && !last.s.trim()) c = last;
      else { c = insertAfter(tn.blocks.length - 1, mkBlock('p', '')); }
    }
    if (!isTexty(c)) return;
    retype(c, c.t === type ? 'p' : type, { s: c.s, done: c.done });
    pushHist(); changed();
  }
  function addAtCaret(nb) {
    const c = current();
    let idx = c ? find(c.id) : tn.blocks.length - 1;
    if (c && isTexty(c) && !c.s.trim() && nb.t !== 'p') { const cid = c.id; tn.blocks.splice(find(cid), 1, nb); const old = rows.get(cid); old?.el.replaceWith(buildRow(nb)); rows.delete(cid); idx = find(nb.id); }
    else insertAfter(idx, nb);
    // always leave an empty paragraph after a divider / drawing, so the next thing can be typed
    const after = tn.blocks[find(nb.id) + 1];
    if (!isTexty(after)) { const p = insertAfter(find(nb.id), mkBlock('p', '')); focusBlock(p.id, 0); } else if (isTexty(after)) focusBlock(after.id, 0);
    pushHist(); changed();
  }

  function insertMenu() {
    const c = current();
    actionSheet(t('tn_insert'), [
      { icon: 'heading', label: t('tn_heading'), onClick: () => { const k = c || (tn.blocks.length ? tn.blocks[tn.blocks.length - 1] : null); if (k && isTexty(k)) { retype(k, k.t === 'h' ? 'p' : 'h'); pushHist(); changed(); } } },
      { icon: 'bullets', label: t('tn_bullets'), onClick: () => toggleType('bullet') },
      { icon: 'todo', label: t('tn_checklist'), onClick: () => toggleType('todo') },
      { icon: 'divider', label: t('tn_divider'), onClick: () => addAtCaret(mkBlock('hr', '')) },
      { icon: 'calendarDay', label: t('tn_date'), onClick: () => insertText(when(Date.now())) },
    ]);
  }
  function insertText(s) {
    const c = current() || tn.blocks[tn.blocks.length - 1];
    if (!c || !isTexty(c)) return;
    const r = rows.get(c.id), a = r.ta.selectionStart ?? r.ta.value.length;
    const v = r.ta.value.slice(0, a) + s + r.ta.value.slice(r.ta.selectionEnd ?? a);
    r.ta.value = v; c.s = v; fitTa(r.ta); focusBlock(c.id, a + s.length);
    pushHist(); changed();
  }

  /* ---------- drawings from the whiteboard ---------- */
  async function drawMenu() {
    actionSheet(t('tn_draw'), [
      { icon: 'penLine', label: t('tn_newDrawing'), hint: t('tn_newDrawingHint'), onClick: async () => {
        try {
          const [{ blankData }, { createBoardItem }] = await Promise.all([import('../board/doc.js'), import('../board/io.js')]);
          const base = tn.title.trim() || t('note_name');
          const bid = await createBoardItem(blankData({ pattern: 'none', size: [595, 420] }), { title: `${base} · ${t('tn_drawing')}`, folderId: state.items.get(id)?.folderId || null });
          addAtCaret(mkBlock('board', '', { ref: bid }));
          flushNow();
          const { openItem } = await import('./index.js'); openItem(bid);
        } catch (e) { console.warn('new drawing', e); toast(t('bd_failed')); }
      } },
      { icon: 'bdPen', label: t('tn_pickBoard'), hint: t('tn_pickBoardHint'), onClick: async () => {
        const { pickItem } = await import('../board/sheets.js');
        const { isBoard } = await import('../board/io.js');
        const it = await pickItem({ title: t('tn_pickBoard'), filter: (x) => isBoard(x) && !x.meta?.text && x.id !== id && !x.meta?.note });
        if (it) { addAtCaret(mkBlock('board', '', { ref: it.id })); flushNow(); }
      } },
    ]);
  }
  async function openDrawing(b) {
    if (!state.items.get(b.ref)) { toast(t('tn_drawingGone')); return; }
    flushNow();
    const { openItem } = await import('./index.js'); openItem(b.ref);
  }
  // when the drawing was changed in the board, its picture here follows
  const offPatch = onItemPatch((ids) => {
    if (closed) return;
    for (const b of tn.blocks) {
      if (b.t !== 'board' || !ids.includes(b.ref)) continue;
      const r = rows.get(b.id); if (!r) continue;
      const it = state.items.get(b.ref), u = it && thumbURL(it), im = r.el.querySelector('img');
      if (u && im) im.src = u; else if (u && !im) r.el.querySelector('.tn-noimg')?.replaceWith(h('img', { src: u, alt: '', draggable: false }));
    }
  });

  /* ---------- share / menu ---------- */
  async function shareNote() {
    flushNow();
    const text = plainText(tn);
    if (!text) { toast(t('tn_nothingToShare')); return; }
    if (!(await shareText(text))) { await copyText(text); toast(t('tn_copied')); }
  }
  function moreMenu() {
    const it = state.items.get(id);
    actionSheet(t('tn_options'), [
      { icon: 'pin', label: it?.pin ? t('nt_unpin') : t('nt_pin'), onClick: () => { updateItem(id, { pin: it?.pin ? 0 : Date.now() }); toast(it?.pin ? t('nt_unpinned') : t('nt_pinned')); } },
      { icon: 'copy', label: t('tn_copy'), onClick: async () => { const s = plainText(tn); if (!s) return; await copyText(s); toast(t('tn_copied')); } },
      { icon: 'download', label: t('tn_saveTxt'), onClick: async () => { const s = plainText(tn); if (!s) return; try { await exportBlob(`${(tn.title.trim() || t('note_name')).slice(0, 60)}.txt`, new Blob([s], { type: 'text/plain' })); } catch { toast(t('exportFailed')); } } },
      { icon: 'penLine', label: t('tn_toHand'), hint: t('tn_toHandHint'), onClick: async () => {
        try { const { noteFromText } = await import('../boardadd.js'); const nid = await noteFromText(tn, { folderId: it?.folderId || null }); toast(t('tn_madeHand')); const { openItem } = await import('./index.js'); flushNow(); openItem(nid); } catch (e) { console.warn(e); toast(t('bd_failed')); }
      } },
      { icon: 'move', label: t('moveTo'), onClick: async () => { const { moveItemsDialog } = await import('../actions.js'); await moveItemsDialog([id]); } },
      { icon: 'trash', label: t('delete'), danger: true, onClick: async () => {
        const ok = await confirmDialog({ title: t('tn_deleteQ'), message: t('tn_deleteMsg'), ok: t('delete'), danger: true });
        if (!ok) return;
        tn = { title: '', blocks: [mkBlock('p', '')] }; dirty = false; saveSoon.cancel?.(); softHist.cancel?.();
        V.close(); toast(t('deletedN', { n: 1 }));
      } },
    ]);
  }

  /* ---------- the title ---------- */
  titleEl.addEventListener('input', () => { tn.title = titleEl.value.replace(/\n/g, ' '); if (titleEl.value !== tn.title) titleEl.value = tn.title; fitTa(titleEl); softHist(); changed(); });
  titleEl.addEventListener('beforeinput', (e) => { if (e.inputType === 'insertParagraph' || e.inputType === 'insertLineBreak') { e.preventDefault(); const f = tn.blocks.find(isTexty); if (f) focusBlock(f.id, 0); } });
  titleEl.addEventListener('focus', () => { focusedId = null; root.classList.add('editing'); syncBar(); });
  titleEl.addEventListener('blur', () => { setTimeout(() => { if (!document.activeElement?.classList?.contains('tn-ta') && document.activeElement !== titleEl) root.classList.remove('editing'); }, 60); flushNow(); });
  // the empty space under the last line: write there (a new line when the last one is not empty)
  tail.addEventListener('click', () => {
    const last = tn.blocks[tn.blocks.length - 1];
    if (last && isTexty(last) && !last.s.trim()) { focusBlock(last.id); return; }
    const nb = insertAfter(tn.blocks.length - 1, mkBlock('p', '')); focusBlock(nb.id, 0); pushHist(); changed();
  });

  /* ---------- the keyboard (the bar rides above it) ---------- */
  const vv = window.visualViewport || null;
  function kb() { if (!vv) return; const off = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)); root.style.setProperty('--kb', off + 'px'); }
  vv && vv.addEventListener('resize', kb);

  /* ---------- go ---------- */
  renderAll(); updateMeta(); syncUndo(); setStatus('');
  requestAnimationFrame(() => fitTa(titleEl));
  if (fresh || isEmpty(tn)) setTimeout(() => { if (!closed) titleEl.focus(); }, 380);
  // for tests and callers
  root.__tn = { get data() { return tn; }, flush: flushNow, undo, redo, focusBlock, id };
}
