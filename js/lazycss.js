// Loads the stylesheet of a section the first time it is opened (so the rest of the app does not pay for it at start-up).
const done = new Map();
/** loadCss('css/calc.css') -> Promise that resolves when the sheet is applied (or after a short wait if it cannot be loaded) */
export function loadCss(href) {
  if (done.has(href)) return done.get(href);
  const p = new Promise((res) => {
    const l = document.createElement('link');
    l.rel = 'stylesheet'; l.href = href;
    l.onload = () => res(true); l.onerror = () => res(false);
    document.head.append(l);
    setTimeout(() => res(false), 4000);
  });
  done.set(href, p);
  return p;
}
