// Loads the bundled pdf.js (legacy build) lazily and exposes ready-to-use options.
let mod;

export async function loadPdfjs() {
  if (!mod) {
    mod = await import('../lib/pdfjs/pdf.min.mjs');
    mod.GlobalWorkerOptions.workerSrc = new URL('../lib/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
  }
  return mod;
}

const base = (p) => new URL('../lib/pdfjs/' + p, import.meta.url).href;

export function pdfParams(data) {
  return {
    data,
    cMapUrl: base('cmaps/'),
    cMapPacked: true,
    standardFontDataUrl: base('standard_fonts/'),
    wasmUrl: base('wasm/'),
    isEvalSupported: false,
  };
}
