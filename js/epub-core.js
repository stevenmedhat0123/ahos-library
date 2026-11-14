// A small, dependency-free EPUB reader core (uses the bundled JSZip).
// Parses container/OPF/TOC and prepares chapters with their images, CSS and fonts inlined as blob: URLs.

export async function loadJSZip() {
  if (window.JSZip) return window.JSZip;
  await new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = new URL('../lib/jszip/jszip.min.js', import.meta.url).href;
    s.onload = res; s.onerror = () => rej(new Error('JSZip failed to load'));
    document.head.append(s);
  });
  return window.JSZip;
}

const parseXml = (t) => new DOMParser().parseFromString(t, 'application/xml');
const parseHtml = (t) => new DOMParser().parseFromString(t, 'text/html');
const tags = (doc, name) => Array.from(doc.getElementsByTagName(name));
const textOf = (doc, name) => (tags(doc, name)[0]?.textContent || '').trim();

function resolvePath(fromPath, rel) {
  if (!rel) return '';
  rel = rel.split('#')[0].split('?')[0];
  if (!rel) return fromPath;
  if (/^[a-z][a-z0-9+.-]*:/i.test(rel)) return '';
  try {
    const u = new URL(rel, 'http://epub/' + fromPath);
    return decodeURIComponent(u.pathname.slice(1));
  } catch { return rel; }
}

const MIME = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp',
  ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2', css: 'text/css',
};
const mimeFor = (path, declared) => declared || MIME[(path.split('.').pop() || '').toLowerCase()] || 'application/octet-stream';

export async function openEpub(blob) {
  const JSZip = await loadJSZip();
  const zip = await JSZip.loadAsync(blob);
  const find = (p) => zip.file(p) || zip.file(p.replace(/^\.\//, '')) || zip.file(new RegExp('^' + p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i'))[0] || null;

  const cont = find('META-INF/container.xml');
  if (!cont) throw new Error('Not a valid EPUB (container.xml missing)');
  const rootPath = tags(parseXml(await cont.async('string')), 'rootfile')[0]?.getAttribute('full-path');
  if (!rootPath || !find(rootPath)) throw new Error('Not a valid EPUB (package missing)');
  const opf = parseXml(await find(rootPath).async('string'));

  const manifest = new Map();
  for (const it of tags(opf, 'item')) {
    manifest.set(it.getAttribute('id'), {
      id: it.getAttribute('id'),
      path: resolvePath(rootPath, it.getAttribute('href')),
      type: it.getAttribute('media-type') || '',
      props: it.getAttribute('properties') || '',
    });
  }

  const spineEl = tags(opf, 'spine')[0];
  const spine = [];
  for (const ref of tags(opf, 'itemref')) {
    if (ref.getAttribute('linear') === 'no') continue;
    const m = manifest.get(ref.getAttribute('idref'));
    if (m && /x?html|xml/i.test(m.type)) {
      let size = 1;
      try { size = zip.file(m.path)._data.uncompressedSize || 1; } catch { /* internal API may change */ }
      spine.push({ ...m, size });
    }
  }
  if (!spine.length) throw new Error('This EPUB has no readable chapters');

  const title = textOf(opf, 'dc:title') || textOf(opf, 'title');
  const author = textOf(opf, 'dc:creator') || textOf(opf, 'creator');
  const lang = (textOf(opf, 'dc:language') || textOf(opf, 'language') || '').toLowerCase();
  const ppd = (spineEl?.getAttribute('page-progression-direction') || '').toLowerCase();
  const dir = ppd === 'rtl' || /^(ar|fa|he|ur)/.test(lang) ? 'rtl' : 'ltr';

  /* ----- table of contents ----- */
  const toc = [];
  const navItem = [...manifest.values()].find((m) => /\bnav\b/.test(m.props));
  try {
    if (navItem && find(navItem.path)) {
      const nd = parseHtml(await find(navItem.path).async('string'));
      const nav = [...nd.querySelectorAll('nav')].find((n) => (n.getAttribute('epub:type') || n.getAttribute('type') || '').includes('toc')) || nd.querySelector('nav');
      const walk = (ol, level) => {
        for (const li of ol.children) {
          const a = li.querySelector(':scope > a, :scope > span');
          if (a) toc.push({ label: a.textContent.replace(/\s+/g, ' ').trim(), href: a.getAttribute('href') ? resolvePath(navItem.path, a.getAttribute('href')) : '', level });
          const sub = li.querySelector(':scope > ol');
          if (sub) walk(sub, level + 1);
        }
      };
      const ol = nav?.querySelector('ol');
      if (ol) walk(ol, 0);
    }
    if (!toc.length) {
      const ncxItem = manifest.get(spineEl?.getAttribute('toc')) || [...manifest.values()].find((m) => /dtbncx/.test(m.type));
      if (ncxItem && find(ncxItem.path)) {
        const nx = parseXml(await find(ncxItem.path).async('string'));
        const walk = (el, level) => {
          for (const np of Array.from(el.children).filter((c) => c.localName === 'navPoint')) {
            const label = np.getElementsByTagName('text')[0]?.textContent.replace(/\s+/g, ' ').trim() || '';
            const src = np.getElementsByTagName('content')[0]?.getAttribute('src');
            toc.push({ label, href: src ? resolvePath(ncxItem.path, src) : '', level });
            walk(np, level + 1);
          }
        };
        const map = tags(nx, 'navMap')[0];
        if (map) walk(map, 0);
      }
    }
  } catch (e) { console.warn('TOC parse failed', e); }

  /* ----- cover ----- */
  let coverPath = '';
  const metaCover = tags(opf, 'meta').find((m) => m.getAttribute('name') === 'cover');
  const byProp = [...manifest.values()].find((m) => /cover-image/.test(m.props));
  const byMeta = metaCover ? manifest.get(metaCover.getAttribute('content')) : null;
  const guess = [...manifest.values()].find((m) => /^image\//.test(m.type) && /cover/i.test(m.id + m.path));
  coverPath = (byProp || byMeta || guess || {}).path || '';

  /* ----- resources ----- */
  const urlCache = new Map();
  async function resUrl(path) {
    if (!path) return '';
    if (urlCache.has(path)) return urlCache.get(path);
    const f = find(path);
    if (!f) return '';
    const data = await f.async('blob');
    const url = URL.createObjectURL(new Blob([data], { type: mimeFor(path, [...manifest.values()].find((m) => m.path === path)?.type) }));
    urlCache.set(path, url);
    return url;
  }

  async function rewriteCss(css, cssPath) {
    const re = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g;
    const jobs = [];
    css.replace(re, (m, q, u) => { if (!/^(data:|#)/.test(u)) jobs.push(u); return m; });
    const map = new Map();
    await Promise.all([...new Set(jobs)].map(async (u) => map.set(u, await resUrl(resolvePath(cssPath, u)))));
    css = css.replace(re, (m, q, u) => (map.get(u) ? `url("${map.get(u)}")` : m));
    // drop @import (cannot be resolved offline from a blob)
    return css.replace(/@import[^;]+;/g, '');
  }

  async function chapter(index) {
    const item = spine[index];
    const raw = await find(item.path).async('string');
    let doc = new DOMParser().parseFromString(raw, 'application/xhtml+xml');
    if (doc.querySelector('parsererror') || !doc.body) doc = parseHtml(raw);
    doc.querySelectorAll('script, iframe, object, embed, audio, video').forEach((n) => n.remove());

    let css = '';
    for (const link of Array.from(doc.querySelectorAll('link[rel~="stylesheet"]'))) {
      const p = resolvePath(item.path, link.getAttribute('href'));
      const f = p && find(p);
      if (f) css += (await rewriteCss(await f.async('string'), p)) + '\n';
      link.remove();
    }
    for (const st of Array.from(doc.querySelectorAll('style'))) {
      css += (await rewriteCss(st.textContent, item.path)) + '\n';
      st.remove();
    }

    const attrs = [['img', 'src'], ['image', 'href'], ['image', 'xlink:href']];
    for (const [sel, attr] of attrs) {
      for (const el of Array.from(doc.querySelectorAll(sel))) {
        const v = el.getAttribute(attr);
        if (!v || /^(data:|blob:)/.test(v)) continue;
        const url = await resUrl(resolvePath(item.path, v));
        if (url) el.setAttribute(attr, url); else if (sel === 'img') el.removeAttribute('src');
      }
    }
    doc.querySelectorAll('img').forEach((i) => { i.removeAttribute('srcset'); i.removeAttribute('width'); i.removeAttribute('height'); });
    const body = doc.body ? doc.body.innerHTML : '';
    const bodyDir = doc.body?.getAttribute('dir') || doc.documentElement.getAttribute('dir') || '';
    return { css, body, dir: bodyDir || dir, path: item.path };
  }

  function chapterIndexForHref(href) {
    const p = (href || '').split('#')[0];
    return spine.findIndex((s) => s.path === p);
  }

  async function coverBlob() {
    if (!coverPath) return null;
    const f = find(coverPath);
    if (!f) return null;
    return new Blob([await f.async('blob')], { type: mimeFor(coverPath, manifest.get([...manifest.keys()].find((k) => manifest.get(k).path === coverPath))?.type) });
  }

  const totalSize = spine.reduce((a, s) => a + s.size, 0);
  const offsets = []; { let acc = 0; for (const s of spine) { offsets.push(acc / totalSize); acc += s.size; } }

  return {
    title, author, lang, dir, spine, toc, chapter, chapterIndexForHref, coverBlob, offsets, totalSize,
    destroy() { urlCache.forEach((u) => URL.revokeObjectURL(u)); urlCache.clear(); },
  };
}
