// The AHOS mark: a glossy play button on a fan of media cards (photo, PDF, video). Same artwork as the app icon.
let uid = 0;

// Artwork only (no background). `p` makes the gradient ids unique when several marks are on one page.
export function markArt(p = 'm') {
  const id = (n) => `${p}-${n}`;
  return `<defs>
  <linearGradient id="${id('blue')}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5CC8FF"/><stop offset="1" stop-color="#1D4FEA"/></linearGradient>
  <linearGradient id="${id('red')}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FF6B7D"/><stop offset="1" stop-color="#C9143B"/></linearGradient>
  <linearGradient id="${id('vio')}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8E5BFF"/><stop offset="1" stop-color="#3A1BB0"/></linearGradient>
  <linearGradient id="${id('play')}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FF4F6E"/><stop offset=".5" stop-color="#B83DFF"/><stop offset="1" stop-color="#2F86FF"/></linearGradient>
  <linearGradient id="${id('gloss')}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".75"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
  <radialGradient id="${id('glow')}" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#9B5CFF" stop-opacity=".55"/><stop offset="1" stop-color="#9B5CFF" stop-opacity="0"/></radialGradient>
  <clipPath id="${id('cl')}"><rect x="-82" y="-112" width="164" height="224" rx="28"/></clipPath>
  <filter id="${id('sh')}" x="-30%" y="-30%" width="160%" height="170%"><feGaussianBlur in="SourceAlpha" stdDeviation="9"/><feOffset dy="10" result="b"/><feComponentTransfer><feFuncA type="linear" slope=".55"/></feComponentTransfer><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter>
</defs>
<circle cx="256" cy="268" r="210" fill="url(#${id('glow')})"/>
<g transform="translate(150 286) rotate(-15)" filter="url(#${id('sh')})">
  <rect x="-82" y="-112" width="164" height="224" rx="28" fill="url(#${id('blue')})"/>
  <g clip-path="url(#${id('cl')})">
    <circle cx="-36" cy="-56" r="19" fill="#FFE27A"/>
    <path d="M-90 120 V40 L-36 -8 L10 50 L36 22 L90 76 V120Z" fill="#fff" opacity=".9"/>
    <path d="M-90 120 V74 L-44 40 L-6 84 L30 60 L90 104 V120Z" fill="#0F2E9C" opacity=".35"/>
    <rect x="-82" y="-112" width="164" height="104" fill="url(#${id('gloss')})" opacity=".35"/>
  </g>
</g>
<g transform="translate(362 286) rotate(15)" filter="url(#${id('sh')})">
  <rect x="-82" y="-112" width="164" height="224" rx="28" fill="url(#${id('red')})"/>
  <g clip-path="url(#${id('cl')})">
    <path d="M40 -112 H82 V-70Z" fill="#fff" opacity=".3"/>
    <g fill="none" stroke="#fff" stroke-width="8" stroke-linecap="round" stroke-linejoin="round">
      <path d="M-8 -14 V20 M-8 -14 H0 a9 9 0 0 1 0 18 H-8"/>
      <path d="M22 -14 V20 M22 -14 H29 a17 17 0 0 1 0 34 H22"/>
      <path d="M56 20 V-14 H74 M56 3 H70"/>
    </g>
    <g fill="#fff" opacity=".8"><rect x="-8" y="56" width="80" height="9" rx="4.5"/><rect x="-8" y="76" width="54" height="9" rx="4.5"/></g>
    <rect x="-82" y="-112" width="164" height="104" fill="url(#${id('gloss')})" opacity=".3"/>
  </g>
</g>
<g transform="translate(256 258)" class="mk-card" filter="url(#${id('sh')})">
  <rect x="-98" y="-136" width="196" height="272" rx="44" fill="url(#${id('vio')})"/>
  <rect x="-98" y="-136" width="196" height="272" rx="44" fill="none" stroke="#fff" stroke-opacity=".35" stroke-width="2.5"/>
  <g fill="#fff" opacity=".28">
    <rect x="-89" y="-92" width="9" height="15" rx="3"/><rect x="-89" y="-58" width="9" height="15" rx="3"/><rect x="-89" y="-24" width="9" height="15" rx="3"/><rect x="-89" y="10" width="9" height="15" rx="3"/><rect x="-89" y="44" width="9" height="15" rx="3"/><rect x="-89" y="78" width="9" height="15" rx="3"/>
    <rect x="80" y="-92" width="9" height="15" rx="3"/><rect x="80" y="-58" width="9" height="15" rx="3"/><rect x="80" y="-24" width="9" height="15" rx="3"/><rect x="80" y="10" width="9" height="15" rx="3"/><rect x="80" y="44" width="9" height="15" rx="3"/><rect x="80" y="78" width="9" height="15" rx="3"/>
  </g>
  <path d="M-98 -92 a44 44 0 0 1 44 -44 H54 a44 44 0 0 1 44 44 V-30 C40 -62 -40 -62 -98 -30Z" fill="url(#${id('gloss')})" opacity=".42"/>
  <g class="mk-play">
    <circle r="68" cy="6" fill="url(#${id('play')})"/>
    <circle r="68" cy="6" fill="none" stroke="#fff" stroke-opacity=".9" stroke-width="5"/>
    <path d="M-20 -30 L40 6 L-20 42Z" fill="#fff" stroke="#fff" stroke-width="14" stroke-linejoin="round"/>
    <ellipse cx="-12" cy="-30" rx="40" ry="20" fill="url(#${id('gloss')})" opacity=".55"/>
  </g>
  <path class="mk-spark" d="M92 -118 L98 -100 L116 -94 L98 -88 L92 -70 L86 -88 L68 -94 L86 -100Z" fill="#fff"/>
</g>`;
}

export function mark(cls = '') {
  return `<svg class="mark ${cls}" viewBox="0 0 512 512" aria-hidden="true">${markArt('m' + ++uid)}</svg>`;
}
