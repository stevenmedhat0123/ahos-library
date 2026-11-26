// Hub artwork: one small animated picture per section, drawn as inline SVG and moved only with CSS transforms / dashes (see css/hub.css).
// The colours come from --g1 / --g2 set on the picture, so each section keeps its own colours. Everything is static markup: cheap to build.

const A = (inner) => `<svg viewBox="0 0 400 300" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">${inner}</svg>`;
const ORBS = '<circle class="orb o1" cx="300" cy="96" r="92" fill="var(--g1)" opacity=".26"/><circle class="orb o2" cx="86" cy="214" r="74" fill="var(--g2)" opacity=".22"/>';
const f = (n) => Math.round(n * 100) / 100;

/** A cog: teeth around a ring with a hole, as one even-odd path. */
function gear(cx, cy, r, teeth, depth, hole) {
  const step = (Math.PI * 2) / teeth;
  let d = '';
  for (let k = 0; k < teeth; k++) {
    const a = k * step;
    for (const [off, rad] of [[-0.3, r], [-0.15, r + depth], [0.15, r + depth], [0.3, r]]) {
      const x = cx + Math.cos(a + off * step * 2) * rad; const y = cy + Math.sin(a + off * step * 2) * rad;
      d += (d ? 'L' : 'M') + f(x) + ' ' + f(y);
    }
  }
  return `${d}ZM${f(cx - hole)} ${cy}a${hole} ${hole} 0 1 0 ${hole * 2} 0a${hole} ${hole} 0 1 0 ${-hole * 2} 0Z`;
}
const star = (x, y, s, cls, d) => `<path class="${cls}" style="--d:${d}s;transform-origin:${x}px ${y}px" d="M${x} ${y - s}L${x + s * 0.28} ${y - s * 0.28}L${x + s} ${y}L${x + s * 0.28} ${y + s * 0.28}L${x} ${y + s}L${x - s * 0.28} ${y + s * 0.28}L${x - s} ${y}L${x - s * 0.28} ${y - s * 0.28}Z" fill="#fff"/>`;

const BOARD_PATH = 'M40 232C92 130 142 270 192 168S292 96 362 176';

export const ART = {
  comments: () => A(`${ORBS}
    <g class="bub b1"><rect x="150" y="40" width="190" height="72" rx="28" fill="var(--g1)"/><path d="M300 108l24 28 2-32z" fill="var(--g1)"/><circle cx="205" cy="76" r="8" fill="#fff"/><circle cx="238" cy="76" r="8" fill="#fff"/><circle cx="271" cy="76" r="8" fill="#fff"/></g>
    <g class="bub b2"><rect x="56" y="134" width="176" height="62" rx="26" fill="var(--g2)"/><path d="M92 192l-20 26 38-8z" fill="var(--g2)"/><rect x="86" y="154" width="112" height="9" rx="4.5" fill="#fff" opacity=".92"/><rect x="86" y="172" width="70" height="9" rx="4.5" fill="#fff" opacity=".7"/></g>
    <g class="bub b3"><rect x="204" y="204" width="150" height="58" rx="26" fill="#fff" opacity=".94"/><path d="M279 218l5.6 11.6 12.4 1.7-9 8.7 2.2 12.5-11.2-5.9-11.2 5.9 2.2-12.5-9-8.7 12.4-1.7z" fill="var(--g1)"/></g>`),

  calc: () => A(`${ORBS}${['+', '−', '×', '÷', 'π', '√', '=', '%'].map((s, i) => {
    const x = 44 + (i % 4) * 84 + (i % 2) * 10; const y = 52 + Math.floor(i / 4) * 104 + (i % 3) * 8;
    return `<g class="cpx" style="--d:${f(i * 0.37)}s"><rect x="${x}" y="${y}" width="64" height="64" rx="20" fill="${i % 3 === 0 ? 'var(--g1)' : i % 3 === 1 ? 'var(--g2)' : '#fff'}" ${i % 3 === 2 ? 'opacity=".94"' : ''}/><text x="${x + 32}" y="${y + 45}" text-anchor="middle" font-size="34" font-weight="700" font-family="system-ui,sans-serif" fill="${i % 3 === 2 ? 'var(--g1)' : '#fff'}">${s}</text></g>`;
  }).join('')}`),

  player: () => A(`${ORBS}
    <g class="fan c1" style="--r:-27deg"><rect x="150" y="62" width="100" height="150" rx="16" fill="#FF5C7A"/><path d="M186 118v38l32-19z" fill="#fff"/></g>
    <g class="fan c2" style="--r:-9deg"><rect x="150" y="62" width="100" height="150" rx="16" fill="#4FA8FF"/><path d="M164 192l24-30 18 20 12-12 18 22z" fill="#fff" opacity=".95"/><circle cx="190" cy="104" r="11" fill="#fff"/></g>
    <g class="fan c3" style="--r:9deg"><rect x="150" y="62" width="100" height="150" rx="16" fill="#FFB84F"/><rect x="168" y="98" width="64" height="8" rx="4" fill="#fff"/><rect x="168" y="120" width="64" height="8" rx="4" fill="#fff" opacity=".8"/><rect x="168" y="142" width="44" height="8" rx="4" fill="#fff" opacity=".8"/></g>
    <g class="fan c4" style="--r:27deg"><rect x="150" y="62" width="100" height="150" rx="16" fill="#A78BFA"/><path d="M186 176V108l30-8v66" fill="none" stroke="#fff" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/><circle cx="178" cy="178" r="12" fill="#fff"/><circle cx="208" cy="170" r="12" fill="#fff"/></g>`),

  // Videos: a cinema screen with film-strip holes, a second card behind it and a play-head under it
  videos: () => A(`${ORBS}
    <circle class="rip" cx="200" cy="124" r="40" fill="none" stroke="#fff" stroke-width="3"/><circle class="rip r2" cx="200" cy="124" r="40" fill="none" stroke="#fff" stroke-width="3"/><circle class="rip r3" cx="200" cy="124" r="40" fill="none" stroke="#fff" stroke-width="3"/>
    <rect x="96" y="30" width="208" height="150" rx="24" fill="var(--g2)" opacity=".5" transform="rotate(-7 200 105)"/>
    <rect class="tvs" x="70" y="42" width="260" height="164" rx="28" fill="var(--g1)"/>
    ${[0, 1, 2, 3, 4].map((i) => `<rect x="82" y="${58 + i * 27}" width="13" height="16" rx="4" fill="#fff" opacity=".55"/><rect x="305" y="${58 + i * 27}" width="13" height="16" rx="4" fill="#fff" opacity=".55"/>`).join('')}
    <path d="M180 88v72l62-36z" fill="#fff"/>
    <rect x="86" y="232" width="228" height="11" rx="5.5" fill="#fff" opacity=".35"/><rect class="ppr" x="86" y="232" width="228" height="11" rx="5.5" fill="#fff"/>
    <circle class="dotp" cx="86" cy="237.5" r="9" fill="#fff"/>`),

  photos: () => A(`${ORBS}
    <g class="fl" style="--d:0s"><rect x="58" y="52" width="170" height="146" rx="20" fill="#fff"/><rect x="72" y="66" width="142" height="96" rx="11" fill="var(--g2)" opacity=".5"/><circle cx="108" cy="92" r="12" fill="#fff"/><path d="M72 162l40-42 30 30 22-18 50 32z" fill="var(--g1)"/></g>
    <g class="fl" style="--d:1.5s"><rect x="172" y="104" width="170" height="146" rx="20" fill="#fff"/><rect x="186" y="118" width="142" height="96" rx="11" fill="var(--g1)" opacity=".55"/><circle cx="296" cy="144" r="12" fill="#fff"/><path d="M186 214l36-40 28 26 24-20 54 34z" fill="var(--g2)"/></g>`),

  audio: () => A(`${ORBS}
    <g class="spin"><circle cx="118" cy="150" r="82" fill="#fff" opacity=".95"/><circle cx="118" cy="150" r="60" fill="none" stroke="var(--g2)" stroke-width="3" opacity=".5"/><circle cx="118" cy="150" r="38" fill="none" stroke="var(--g2)" stroke-width="3" opacity=".5"/><circle cx="118" cy="150" r="24" fill="var(--g1)"/><circle cx="118" cy="150" r="6" fill="#fff"/></g>
    ${[0, 1, 2, 3, 4, 5, 6].map((i) => `<rect class="eq" style="--d:${f(i * 0.23)}s" x="${230 + i * 20}" y="${86 + (i % 3) * 8}" width="12" height="${100 - (i % 3) * 16}" rx="6" fill="${i % 2 ? '#fff' : 'var(--g1)'}"/>`).join('')}`),

  docs: () => A(`${ORBS}
    <g class="paper"><rect x="132" y="46" width="170" height="214" rx="18" fill="var(--g2)" opacity=".5" transform="rotate(7 217 153)"/><rect x="98" y="30" width="190" height="240" rx="20" fill="#fffdf4"/><path d="M258 30l30 30h-30z" fill="var(--g2)"/>
    <rect x="122" y="58" width="76" height="34" rx="9" fill="var(--g1)"/><text x="160" y="82" text-anchor="middle" font-size="22" font-weight="800" font-family="system-ui,sans-serif" fill="#fff">PDF</text>
    ${[0, 1, 2, 3, 4].map((i) => `<rect class="ln" style="--d:${f(i * 0.32)}s" x="122" y="${114 + i * 27}" width="${146 - (i % 3) * 30}" height="8" rx="4" fill="#bcc7b4"/>`).join('')}</g>`),

  board: () => A(`${ORBS}
    <path class="draw" pathLength="1" d="${BOARD_PATH}" fill="none" stroke="var(--g1)" stroke-width="12" stroke-linecap="round"/>
    <path class="draw d2" pathLength="1" d="M92 92a44 44 0 1 0 .1 0" fill="none" stroke="var(--g2)" stroke-width="9" stroke-linecap="round"/>
    <path class="draw d3" pathLength="1" d="M250 236h104M250 258h64" fill="none" stroke="#fff" stroke-width="8" stroke-linecap="round" opacity=".85"/>
    <g class="pen"><path d="M0 0L6-16 30-40 40-30 16-6Z" fill="#fff"/><path d="M0 0L6-16 16-6Z" fill="var(--g1)"/></g>`),

  note: () => A(`${ORBS}
    <g class="paper"><rect x="104" y="28" width="192" height="240" rx="20" fill="#fffdf4"/><path d="M266 28l30 30h-30z" fill="var(--g2)"/><rect x="128" y="56" width="92" height="13" rx="6.5" fill="var(--g1)"/>
    ${[0, 1, 2, 3, 4, 5].map((i) => `<rect class="ln" style="--d:${f(i * 0.32)}s" x="128" y="${96 + i * 27}" width="${144 - (i % 3) * 30}" height="8" rx="4" fill="#bcc7b4"/>`).join('')}
    <path class="tick" d="M244 232l12 12 24-26" fill="none" stroke="var(--g1)" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/></g>`),

  settings: () => A(`${ORBS}
    <path class="gear g1" d="${gear(150, 156, 54, 10, 14, 20)}" fill="var(--g1)" fill-rule="evenodd"/>
    <path class="gear g2" d="${gear(266, 206, 38, 8, 11, 14)}" fill="var(--g2)" fill-rule="evenodd"/>
    <path class="gear g3" d="${gear(262, 86, 28, 7, 9, 10)}" fill="#fff" opacity=".9" fill-rule="evenodd"/>`),

  // AHOS Tube: a link, a phone that plays the video, and the download that keeps it for offline
  tube: () => A(`${ORBS}
    <g class="tubeph"><rect x="122" y="18" width="156" height="252" rx="32" fill="#fff"/>
      <rect x="134" y="44" width="132" height="158" rx="18" fill="var(--g1)"/><path d="M180 96v54l46-27z" fill="#fff"/>
      <rect x="176" y="27" width="48" height="7" rx="3.5" fill="var(--g1)" opacity=".28"/>
      <rect x="140" y="216" width="92" height="8" rx="4" fill="var(--g1)" opacity=".3"/><rect x="140" y="234" width="60" height="8" rx="4" fill="var(--g1)" opacity=".18"/></g>
    <g class="lnk"><rect x="34" y="70" width="78" height="38" rx="19" fill="none" stroke="#fff" stroke-width="11" transform="rotate(-28 73 89)"/><rect x="58" y="96" width="78" height="38" rx="19" fill="none" stroke="var(--g2)" stroke-width="11" transform="rotate(-28 97 115)"/></g>
    <g class="dlg"><circle cx="318" cy="222" r="42" fill="var(--g2)"/><circle class="ring" cx="318" cy="222" r="42" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" pathLength="100"/>
      <path class="dl" d="M318 204v30M305 224l13 13 13-13" fill="none" stroke="#fff" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/></g>`),

  alarm: () => A(`${ORBS}
    <g class="clk"><circle cx="200" cy="158" r="92" fill="#fff"/><circle cx="200" cy="158" r="78" fill="none" stroke="var(--g1)" stroke-width="7" opacity=".35"/>
    ${[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((i) => { const a = i * Math.PI / 6; return `<line x1="${f(200 + Math.sin(a) * 66)}" y1="${f(158 - Math.cos(a) * 66)}" x2="${f(200 + Math.sin(a) * (i % 3 ? 72 : 76))}" y2="${f(158 - Math.cos(a) * (i % 3 ? 72 : 76))}" stroke="var(--g1)" stroke-width="${i % 3 ? 4 : 6}" stroke-linecap="round"/>`; }).join('')}
    <line class="hand m" x1="200" y1="158" x2="200" y2="102" stroke="var(--g1)" stroke-width="8" stroke-linecap="round"/><line class="hand h" x1="200" y1="158" x2="238" y2="158" stroke="var(--g2)" stroke-width="9" stroke-linecap="round"/><circle cx="200" cy="158" r="9" fill="var(--g2)"/></g>
    <g class="bell bl"><path d="M96 92a62 62 0 0 1 56-42l-6 30z" fill="var(--g2)"/></g><g class="bell br"><path d="M304 92a62 62 0 0 0-56-42l6 30z" fill="var(--g2)"/></g>
    <path class="wave" d="M62 110q-16 24 0 48M42 100q-26 34 0 68M338 110q16 24 0 48M358 100q26 34 0 68" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round"/>`),

  ownComments: () => A(`${ORBS}
    <g class="bub b1"><rect x="64" y="52" width="196" height="76" rx="30" fill="var(--g1)"/><path d="M104 124l-22 28 40-8z" fill="var(--g1)"/><rect x="94" y="78" width="120" height="10" rx="5" fill="#fff" opacity=".92"/><rect x="94" y="98" width="76" height="10" rx="5" fill="#fff" opacity=".7"/></g>
    <g class="bub b2"><path d="M290 150l66 24v44c0 36-26 56-66 70-40-14-66-34-66-70v-44z" fill="#fff" opacity=".95"/><path d="M262 214l20 20 36-42" fill="none" stroke="var(--g1)" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/></g>`),

  subs: () => A(`${ORBS}
    <g class="key"><circle cx="124" cy="150" r="46" fill="none" stroke="var(--g1)" stroke-width="18"/><path d="M170 150h156M272 150v36M306 150v26" fill="none" stroke="var(--g1)" stroke-width="18" stroke-linecap="round"/></g>
    ${star(300, 70, 22, 'tw', 0)}${star(86, 70, 14, 'tw', 0.6)}${star(336, 232, 16, 'tw', 1.1)}${star(120, 240, 20, 'tw', 1.6)}`),

  recovery: () => A(`${ORBS}
    <g class="bin"><path d="M120 120h160l-12 140a12 12 0 0 1-12 11H144a12 12 0 0 1-12-11z" fill="var(--g1)"/><rect x="104" y="96" width="192" height="18" rx="9" fill="var(--g2)"/><rect x="170" y="76" width="60" height="16" rx="8" fill="var(--g2)"/></g>
    <g class="up"><path d="M200 218v-72M170 176l30-30 30 30" fill="none" stroke="#fff" stroke-width="13" stroke-linecap="round" stroke-linejoin="round"/></g>`),

  devices: () => A(`${ORBS}
    <rect x="76" y="86" width="76" height="136" rx="16" fill="var(--g1)"/><rect x="88" y="100" width="52" height="86" rx="6" fill="#fff" opacity=".9"/>
    <rect x="206" y="98" width="140" height="98" rx="12" fill="var(--g2)"/><rect x="216" y="108" width="120" height="78" rx="5" fill="#fff" opacity=".9"/><rect x="190" y="204" width="172" height="13" rx="6.5" fill="var(--g2)"/>
    <path class="flow" d="M160 154h38" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round" stroke-dasharray="3 14"/>`),
  release: () => A(`${ORBS}
    <g class="rocket"><path d="M200 36c44 32 58 92 44 152h-88c-14-60 0-120 44-152z" fill="#fff" opacity=".96"/><circle cx="200" cy="108" r="24" fill="var(--g1)"/><circle cx="200" cy="108" r="12" fill="#fff" opacity=".85"/><path d="M158 150l-38 44 44-8zM242 150l38 44-44-8z" fill="var(--g2)"/><path class="flame" d="M176 198h48l-24 54z" fill="var(--g1)"/></g>
    ${star(88, 70, 16, 'tw', 0)}${star(318, 84, 20, 'tw', 0.8)}${star(336, 226, 14, 'tw', 1.4)}${star(70, 232, 18, 'tw', 2)}`),
};


/* The small picture inside each tile: a little illustration of what the section is (white shapes + the section's own colours on its tile). */
const T = (inner) => `<svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">${inner}</svg>`;
export const TILE = {
  comments: () => T(`<rect x="10" y="14" width="58" height="40" rx="17" fill="#fff"/><path d="M26 52l-9 15 21-9z" fill="#fff"/><circle cx="26" cy="34" r="4.6" fill="var(--g1)"/><circle cx="39" cy="34" r="4.6" fill="var(--g1)"/><circle cx="52" cy="34" r="4.6" fill="var(--g1)"/>
    <rect x="36" y="50" width="54" height="34" rx="15" fill="#fff" opacity=".6"/><path d="M76 82l8 11-17-6z" fill="#fff" opacity=".6"/><path d="M63 60l2.6 5.4 5.9.8-4.3 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z" fill="var(--g2)"/>`),
  calc: () => T(`<rect x="22" y="9" width="56" height="82" rx="13" fill="#fff"/><rect x="29" y="17" width="42" height="19" rx="6" fill="var(--g1)" opacity=".9"/><text x="66" y="32" text-anchor="end" font-size="14" font-weight="800" font-family="system-ui,sans-serif" fill="#fff">42</text>
    ${[0, 1, 2].map((r) => [0, 1, 2].map((c) => `<rect x="${29 + c * 15}" y="${44 + r * 15}" width="11" height="11" rx="3.4" fill="${c === 2 ? 'var(--g2)' : 'var(--g1)'}" opacity="${c === 2 ? 1 : 0.55}"/>`).join('')).join('')}`),
  player: () => T(`<g transform="rotate(-24 50 86)"><rect x="33" y="22" width="34" height="54" rx="8" fill="#FF5C7A"/><path d="M44 42v14l12-7z" fill="#fff"/></g>
    <g transform="rotate(-8 50 86)"><rect x="33" y="22" width="34" height="54" rx="8" fill="#4FA8FF"/><circle cx="43" cy="36" r="4" fill="#fff"/><path d="M38 66l8-10 6 7 4-4 6 7z" fill="#fff"/></g>
    <g transform="rotate(8 50 86)"><rect x="33" y="22" width="34" height="54" rx="8" fill="#FFB84F"/><rect x="39" y="35" width="22" height="3.6" rx="1.8" fill="#fff"/><rect x="39" y="44" width="22" height="3.6" rx="1.8" fill="#fff" opacity=".8"/><rect x="39" y="53" width="14" height="3.6" rx="1.8" fill="#fff" opacity=".8"/></g>
    <g transform="rotate(24 50 86)"><rect x="33" y="22" width="34" height="54" rx="8" fill="#A78BFA"/><path d="M45 62V40l12-3v20" fill="none" stroke="#fff" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/><circle cx="42" cy="62" r="4.6" fill="#fff"/><circle cx="54" cy="58" r="4.6" fill="#fff"/></g>`),
  videos: () => T(`<rect x="10" y="22" width="80" height="56" rx="15" fill="#fff"/><path d="M42 36v28l24-14z" fill="var(--g1)"/><rect x="22" y="84" width="56" height="5" rx="2.5" fill="#fff" opacity=".6"/>`),
  photos: () => T(`<rect x="12" y="18" width="76" height="64" rx="13" fill="#fff"/><circle cx="35" cy="38" r="7.5" fill="var(--g2)"/><path d="M12 70l24-24 17 17 12-10 23 21v2a10 10 0 0 1-10 10H22a10 10 0 0 1-10-10z" fill="var(--g1)" opacity=".9"/>`),
  audio: () => T(`<path d="M38 68V30l36-9v38" fill="none" stroke="#fff" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/><circle cx="28" cy="70" r="12" fill="#fff"/><circle cx="64" cy="61" r="12" fill="#fff"/><circle cx="28" cy="70" r="4.5" fill="var(--g1)"/><circle cx="64" cy="61" r="4.5" fill="var(--g1)"/>`),
  docs: () => T(`<path d="M22 8h38l20 20v62a4 4 0 0 1-4 4H22a4 4 0 0 1-4-4V12a4 4 0 0 1 4-4z" fill="#fff"/><path d="M60 8l20 20H64a4 4 0 0 1-4-4z" fill="var(--g2)" opacity=".85"/><rect x="28" y="46" width="40" height="22" rx="6" fill="var(--g1)"/><text x="48" y="62" text-anchor="middle" font-size="13" font-weight="800" font-family="system-ui,sans-serif" fill="#fff">PDF</text><rect x="28" y="76" width="34" height="4.4" rx="2.2" fill="var(--g1)" opacity=".4"/>`),
  board: () => T(`<rect x="10" y="18" width="80" height="54" rx="9" fill="#fff"/><path d="M20 58c8-18 14 6 22-10s16 4 26-8" fill="none" stroke="var(--g1)" stroke-width="5" stroke-linecap="round"/><circle cx="74" cy="34" r="6" fill="none" stroke="var(--g2)" stroke-width="3.6"/>
    <path d="M52 92l4-13 22-22 9 9-22 22z" fill="#fff"/><path d="M52 92l4-13 9 9z" fill="var(--g1)"/><path d="M78 57l4-4 9 9-4 4z" fill="var(--g2)"/>`),
  note: () => T(`<path d="M20 10h42l18 18v60a4 4 0 0 1-4 4H20a4 4 0 0 1-4-4V14a4 4 0 0 1 4-4z" fill="#fff"/><path d="M62 10l18 18H66a4 4 0 0 1-4-4z" fill="var(--g2)" opacity=".85"/><rect x="26" y="20" width="28" height="7" rx="3.5" fill="var(--g1)"/>
    <rect x="26" y="38" width="46" height="4.4" rx="2.2" fill="var(--g1)" opacity=".4"/><rect x="26" y="50" width="46" height="4.4" rx="2.2" fill="var(--g1)" opacity=".4"/><rect x="26" y="62" width="32" height="4.4" rx="2.2" fill="var(--g1)" opacity=".4"/><path d="M56 76l6 6 12-13" fill="none" stroke="var(--g2)" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>`),
  settings: () => T(`<path d="${gear(40, 44, 20, 9, 6, 8).replace(/\d+\.?\d*/g, (m) => m)}" fill="#fff" fill-rule="evenodd"/><path d="${gear(70, 71, 14, 7, 4.5, 5.5)}" fill="#fff" opacity=".72" fill-rule="evenodd"/>`),
  tube: () => T(`<rect x="8" y="16" width="84" height="54" rx="15" fill="#fff"/><path d="M42 30v26l23-13z" fill="var(--g1)"/><path d="M50 76v12M43 83l7 7 7-7" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>`),
  alarm: () => T(`<circle cx="50" cy="55" r="33" fill="#fff"/><path d="M50 36v20l13 8" fill="none" stroke="var(--g1)" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/><path d="M14 38a24 24 0 0 1 20-24l-4 14z" fill="#fff" opacity=".78"/><path d="M86 38a24 24 0 0 0-20-24l4 14z" fill="#fff" opacity=".78"/><path d="M26 86l8-9M74 86l-8-9" stroke="#fff" stroke-width="6" stroke-linecap="round"/>`),
  ownComments: () => T(`<rect x="8" y="14" width="58" height="38" rx="16" fill="#fff"/><path d="M24 50l-8 14 20-8z" fill="#fff"/><rect x="20" y="26" width="32" height="5" rx="2.5" fill="var(--g1)"/><rect x="20" y="36" width="20" height="5" rx="2.5" fill="var(--g1)" opacity=".55"/>
    <path d="M70 50l20 7v14c0 11-8 17-20 21-12-4-20-10-20-21V57z" fill="#fff" opacity=".92"/><path d="M62 72l6 6 11-13" fill="none" stroke="var(--g2)" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>`),
  subs: () => T(`<circle cx="32" cy="50" r="17" fill="none" stroke="#fff" stroke-width="9"/><path d="M48 50h40M76 50v11M86 50v8" fill="none" stroke="#fff" stroke-width="9" stroke-linecap="round"/><path d="M64 22l2.4 5.8 6.1.4-4.7 3.9 1.5 6-5.3-3.2-5.3 3.2 1.5-6-4.7-3.9 6.1-.4z" fill="#fff" opacity=".8"/>`),
  recovery: () => T(`<path d="M24 38h52l-4 46a5 5 0 0 1-5 4.6H33a5 5 0 0 1-5-4.6z" fill="#fff"/><rect x="18" y="28" width="64" height="8" rx="4" fill="#fff" opacity=".8"/><rect x="40" y="19" width="20" height="8" rx="4" fill="#fff" opacity=".8"/><path d="M50 76V50M40 60l10-10 10 10" fill="none" stroke="var(--g1)" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>`),
  devices: () => T(`<rect x="8" y="30" width="30" height="52" rx="7" fill="#fff"/><rect x="13" y="37" width="20" height="30" rx="2.5" fill="var(--g1)" opacity=".55"/><rect x="44" y="24" width="48" height="36" rx="5" fill="#fff" opacity=".92"/><rect x="49" y="29" width="38" height="26" rx="2" fill="var(--g2)" opacity=".6"/><rect x="38" y="64" width="62" height="6" rx="3" fill="#fff"/>`),
  release: () => T(`<path d="M50 8c15 11 20 32 15 54H35C30 40 35 19 50 8z" fill="#fff"/><circle cx="50" cy="35" r="8" fill="var(--g1)"/><path d="M35 50l-13 15 15-3zM65 50l13 15-15-3z" fill="#fff" opacity=".78"/><path d="M42 66h16l-8 20z" fill="#fff" opacity=".7"/>`),
};
export const tileArt = (id) => (TILE[id] || TILE.settings)();

/** Markup of the picture for a section (a neutral one for sections that have none). */
export const artFor = (id) => (ART[id] || ART.settings)();

/* Tile outlines: every section has its own shape. Polygon ones are rounded with a tiny Bézier at each corner and used as an SVG clip-path
   (objectBoundingBox units); the others are plain border-radius in CSS. */
const SHAPE_POLY = {
  hex: [[0.25, 0.04], [0.75, 0.04], [1, 0.5], [0.75, 0.96], [0.25, 0.96], [0, 0.5]],
  octagon: [[0.3, 0], [0.7, 0], [1, 0.3], [1, 0.7], [0.7, 1], [0.3, 1], [0, 0.7], [0, 0.3]],
  shield: [[0.5, 0], [1, 0.14], [1, 0.56], [0.5, 1], [0, 0.56], [0, 0.14]],
  fold: [[0, 0], [0.72, 0], [1, 0.28], [1, 1], [0, 1]],
  diamond: [[0.5, 0.02], [0.98, 0.5], [0.5, 0.98], [0.02, 0.5]],
};
function roundedPoly(pts, r) {
  const n = pts.length; let d = '';
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i + n - 1) % n]; const p1 = pts[i]; const p2 = pts[(i + 1) % n];
    const v1 = [p0[0] - p1[0], p0[1] - p1[1]]; const v2 = [p2[0] - p1[0], p2[1] - p1[1]];
    const l1 = Math.hypot(v1[0], v1[1]); const l2 = Math.hypot(v2[0], v2[1]);
    const k1 = Math.min(r, l1 / 2) / l1; const k2 = Math.min(r, l2 / 2) / l2;
    const a = [p1[0] + v1[0] * k1, p1[1] + v1[1] * k1]; const b = [p1[0] + v2[0] * k2, p1[1] + v2[1] * k2];
    d += `${i ? 'L' : 'M'}${f(a[0])} ${f(a[1])}Q${f(p1[0])} ${f(p1[1])} ${f(b[0])} ${f(b[1])}`;
  }
  return d + 'Z';
}
/** The shapes a tile can have (the first is the plain rounded square). */
export const SHAPE_LIST = ['squircle', 'circle', 'diamond', 'hex', 'octagon', 'shield', 'bubble', 'fold'];
/** Puts the hidden <svg> with the clip-paths in the page once (the Hub and the Settings previews both use them). */
export function ensureShapeDefs() {
  if (document.getElementById('hs-defs')) return;
  const d = document.createElement('div');
  d.id = 'hs-defs'; d.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden'; d.innerHTML = shapeDefs();
  document.body.append(d);
}
/** One hidden <svg> with a clipPath per polygon shape (id hs-<name>); put it once in the page. */
export function shapeDefs() {
  const paths = Object.entries(SHAPE_POLY).map(([k, pts]) => `<clipPath id="hs-${k}" clipPathUnits="objectBoundingBox"><path d="${roundedPoly(pts, 0.11)}"/></clipPath>`).join('');
  return `<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false"><defs>${paths}</defs></svg>`;
}
/** section id -> shape name (hex | octagon | shield | fold | diamond are clip-paths; bubble | squircle | wide | circle are CSS) */
export const SHAPES = { alarm: 'circle', comments: 'bubble', calc: 'diamond', player: 'squircle', videos: 'squircle', photos: 'bubble', audio: 'circle', docs: 'fold', board: 'hex', note: 'fold', settings: 'octagon', tube: 'wide', ownComments: 'circle', subs: 'shield', recovery: 'squircle', devices: 'hex', release: 'diamond' };
