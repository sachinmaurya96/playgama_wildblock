import { memo } from 'react';

/**
 * Animated voxel-diorama backdrop for the menus: sunset sky, drifting blocky
 * clouds, pine ridges, a cabin with a glowing window and chimney smoke, a river
 * with a waterfall, a grazing Mossback and a hopping Pufftail. Pure SVG + CSS.
 */
function hillPath(seed: number, base: number, amp: number, step: number, w = 1600): string {
  let d = `M0 900 L0 ${base}`;
  let y = base;
  for (let x = 0; x <= w; x += step) {
    const n = Math.sin(x * 0.004 + seed) * amp + Math.sin(x * 0.011 + seed * 2) * amp * 0.4;
    const ny = Math.round((base - n) / 16) * 16;
    d += ` L${x} ${y} L${x} ${ny}`;
    y = ny;
  }
  return `${d} L${w} ${y} L${w} 900 Z`;
}

function Pine({ x, y, s = 1, c = '#2f5a3a' }: { x: number; y: number; s?: number; c?: string }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <rect x="-5" y="-16" width="10" height="18" fill="#5a3a24" />
      <rect x="-30" y="-44" width="60" height="28" fill={c} />
      <rect x="-22" y="-68" width="44" height="26" fill={c} />
      <rect x="-14" y="-90" width="28" height="24" fill={c} />
      <rect x="-6" y="-104" width="12" height="16" fill={c} />
      <rect x="-30" y="-44" width="60" height="6" fill="rgba(255,255,255,0.08)" />
    </g>
  );
}

function Broadleaf({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <rect x="-6" y="-40" width="12" height="42" fill="#6b4a2b" />
      <rect x="-40" y="-92" width="80" height="56" rx="6" fill="#4f8a3a" />
      <rect x="-28" y="-114" width="56" height="30" rx="6" fill="#5f9a45" />
      <rect x="-40" y="-92" width="80" height="10" fill="rgba(255,240,180,0.12)" />
      <rect x="10" y="-80" width="10" height="10" fill="#f2b233" />
      <rect x="-24" y="-66" width="9" height="9" fill="#e0553a" />
    </g>
  );
}

export const MenuBackground = memo(function MenuBackground() {
  return (
    <div className="menu-bg" aria-hidden>
      <svg viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice">
        <defs>
          <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#3f5f9a" />
            <stop offset="0.45" stopColor="#c98a8a" />
            <stop offset="0.75" stopColor="#f5b77a" />
            <stop offset="1" stopColor="#ffd9a0" />
          </linearGradient>
          <radialGradient id="sun" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0" stopColor="#fff6d0" />
            <stop offset="0.35" stopColor="#ffd98a" stopOpacity="0.9" />
            <stop offset="1" stopColor="#ffb070" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="river" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#7fc4e0" />
            <stop offset="1" stopColor="#3f86b8" />
          </linearGradient>
          <linearGradient id="fall" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#bfe8f5" />
            <stop offset="1" stopColor="#6fb3d6" />
          </linearGradient>
        </defs>
        <rect width="1600" height="900" fill="url(#sky)" />
        <circle className="mb-sun" cx="1120" cy="430" r="260" fill="url(#sun)" />
        <rect x="1080" y="390" width="80" height="80" fill="#fff4d6" />
        {/* stars fading in */}
        <g className="mb-stars" fill="#fff">
          {Array.from({ length: 40 }, (_, i) => (
            <rect key={i} x={(i * 397) % 1600} y={(i * 131) % 300} width={i % 5 === 0 ? 4 : 2} height={i % 5 === 0 ? 4 : 2} style={{ animationDelay: `${(i % 7) * 0.6}s` }} />
          ))}
        </g>
        {/* clouds */}
        {[0, 1, 2, 3].map((i) => (
          <g key={i} className="mb-cloud" style={{ animationDuration: `${90 + i * 35}s`, animationDelay: `${-i * 30}s` }} transform={`translate(0 ${80 + i * 70})`}>
            <rect x="0" y="16" width="220" height="36" fill="#fff" opacity="0.8" />
            <rect x="40" y="0" width="120" height="30" fill="#fff" opacity="0.85" />
            <rect x="20" y="44" width="180" height="10" fill="#e8c8c8" opacity="0.7" />
          </g>
        ))}
        {/* far ridges */}
        <path d={hillPath(1.3, 520, 90, 32)} fill="#7a7aa8" opacity="0.75" />
        <path d={hillPath(4.1, 590, 70, 32)} fill="#5f7a8a" />
        {[80, 260, 420, 600, 1300, 1480].map((x, i) => (
          <Pine key={x} x={x} y={600 - (i % 3) * 16} s={0.6 + (i % 2) * 0.15} c="#3f5f55" />
        ))}
        {/* mid hills */}
        <path d={hillPath(2.2, 660, 50, 48)} fill="#4f7f45" />
        {/* waterfall + river */}
        <rect x="360" y="560" width="70" height="140" fill="url(#fall)" />
        <g className="mb-fall-streaks" fill="#ffffff" opacity="0.55">
          <rect x="372" y="560" width="6" height="40" />
          <rect x="396" y="600" width="5" height="50" />
          <rect x="414" y="570" width="6" height="36" />
        </g>
        <path d="M300 700 L480 700 L560 740 L760 760 L1000 800 L1200 900 L700 900 L520 820 L380 760 L300 740 Z" fill="url(#river)" />
        <g className="mb-shimmer" fill="#fff" opacity="0.6">
          <rect x="420" y="728" width="40" height="4" />
          <rect x="640" y="770" width="60" height="4" />
          <rect x="880" y="820" width="50" height="4" />
          <rect x="560" y="800" width="30" height="3" />
        </g>
        <g className="mb-mist" fill="#fff">
          <circle cx="380" cy="700" r="18" opacity="0.4" />
          <circle cx="420" cy="705" r="22" opacity="0.35" />
          <circle cx="400" cy="690" r="14" opacity="0.45" />
        </g>
        {/* near meadow */}
        <path d="M0 900 L0 720 L160 720 L160 704 L300 704 L300 740 L380 760 L520 820 L700 900 Z" fill="#6f9f4a" />
        <path d="M1200 900 L1000 800 L1060 780 L1060 764 L1260 764 L1260 748 L1600 748 L1600 900 Z" fill="#6f9f4a" />
        <rect x="0" y="720" width="160" height="8" fill="#8fbf5a" />
        <rect x="1060" y="764" width="200" height="8" fill="#8fbf5a" />
        <rect x="1260" y="748" width="340" height="8" fill="#8fbf5a" />
        <Broadleaf x={120} y={722} s={1.1} />
        <Pine x={1520} y={750} s={1.2} c="#2f5a3a" />
        <Pine x={1420} y={750} s={0.9} c="#35603f" />
        {/* cabin */}
        <g transform="translate(1180 766)">
          <rect x="-80" y="-90" width="160" height="90" fill="#b0804a" />
          {[0, 1, 2, 3, 4].map((i) => (
            <rect key={i} x="-80" y={-90 + i * 18} width="160" height="3" fill="#8a5a32" />
          ))}
          <path d="M-100 -86 L0 -150 L100 -86 Z" fill="#d8b45a" />
          <path d="M-100 -86 L0 -150 L100 -86 L100 -80 L0 -140 L-100 -80 Z" fill="#b8943a" />
          <rect x="40" y="-160" width="22" height="44" fill="#8a5a4a" />
          <rect x="-20" y="-56" width="36" height="56" fill="#6b4424" />
          <circle cx="8" cy="-28" r="3" fill="#e0b23d" />
          <rect className="mb-window" x="36" y="-66" width="30" height="28" fill="#ffd27a" />
          <rect x="49" y="-66" width="4" height="28" fill="#8a5a32" />
          <rect x="36" y="-54" width="30" height="4" fill="#8a5a32" />
          <g className="mb-smoke" fill="#f0e8e0">
            <rect x="44" y="-180" width="14" height="14" />
            <rect x="50" y="-204" width="18" height="18" />
            <rect x="42" y="-232" width="22" height="22" />
          </g>
        </g>
        {/* mossback */}
        <g className="mb-moss" transform="translate(1380 752)">
          <rect x="-50" y="-44" width="100" height="40" fill="#9a7a56" />
          <rect x="-52" y="-54" width="104" height="14" fill="#6f9a45" />
          <rect x="-40" y="-60" width="16" height="8" fill="#8fbf5a" />
          <rect x="10" y="-62" width="14" height="10" fill="#8fbf5a" />
          <rect x="-44" y="-6" width="12" height="20" fill="#6a4a30" />
          <rect x="30" y="-6" width="12" height="20" fill="#6a4a30" />
          <g className="mb-moss-head">
            <rect x="46" y="-40" width="34" height="30" fill="#a8845e" />
            <rect x="66" y="-26" width="20" height="14" fill="#d8bf9a" />
            <rect x="56" y="-34" width="7" height="8" fill="#fbf7ee" />
            <rect x="58" y="-32" width="4" height="5" fill="#2a1e18" />
            <rect x="50" y="-54" width="4" height="16" fill="#6b4424" />
            <rect x="70" y="-54" width="4" height="16" fill="#6b4424" />
          </g>
        </g>
        {/* pufftail */}
        <g className="mb-puff" transform="translate(260 722)">
          <rect x="-16" y="-30" width="32" height="28" fill="#efe3cf" />
          <rect x="-26" y="-34" width="18" height="18" fill="#ffffff" />
          <rect x="4" y="-50" width="6" height="22" fill="#efe3cf" />
          <rect x="12" y="-48" width="6" height="20" fill="#efe3cf" />
          <rect x="6" y="-22" width="6" height="7" fill="#2a1e18" />
        </g>
        {/* fireflies */}
        <g className="mb-flies" fill="#fff6a0">
          {Array.from({ length: 14 }, (_, i) => (
            <rect key={i} x={200 + ((i * 113) % 1200)} y={560 + ((i * 71) % 220)} width="5" height="5" style={{ animationDelay: `${i * 0.37}s` }} />
          ))}
        </g>
        {/* foreground grass tufts */}
        <g fill="#5f8f3a">
          {Array.from({ length: 30 }, (_, i) => (
            <rect key={i} x={(i * 173) % 1600} y={870 - (i % 3) * 6} width="6" height={24 + (i % 4) * 6} />
          ))}
        </g>
      </svg>
      <div className="menu-vignette" />
    </div>
  );
});
