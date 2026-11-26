// A tiny PDF writer: every board page becomes one JPEG-backed PDF page. No libraries, so it stays light.
const enc = new TextEncoder();

export function buildPdf(pages) {
  // pages: [{ w, h (points), jpeg: Uint8Array, pw, ph (pixels) }]
  const chunks = [];
  const offsets = [];
  let len = 0;
  const put = (x) => { const b = typeof x === 'string' ? enc.encode(x) : x; chunks.push(b); len += b.length; };
  const obj = (n, body) => { offsets[n] = len; put(`${n} 0 obj\n`); put(body); put('\nendobj\n'); };
  const nObj = 2 + pages.length * 3;

  put('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, `<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, i) => `${3 + i * 3} 0 R`).join(' ')}] >>`);
  pages.forEach((p, i) => {
    const pg = 3 + i * 3, ct = pg + 1, im = pg + 2;
    const W = +p.w.toFixed(2), H = +p.h.toFixed(2);
    obj(pg, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /XObject << /Im0 ${im} 0 R >> >> /Contents ${ct} 0 R >>`);
    const stream = `q ${W} 0 0 ${H} 0 0 cm /Im0 Do Q`;
    obj(ct, `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    offsets[im] = len;
    put(`${im} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${p.pw} /Height ${p.ph} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`);
    put(p.jpeg);
    put('\nendstream\nendobj\n');
  });
  const xref = len;
  put(`xref\n0 ${nObj + 1}\n0000000000 65535 f \n`);
  for (let n = 1; n <= nObj; n++) put(String(offsets[n]).padStart(10, '0') + ' 00000 n \n');
  put(`trailer\n<< /Size ${nObj + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(chunks, { type: 'application/pdf' });
}
