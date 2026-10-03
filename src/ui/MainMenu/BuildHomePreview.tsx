import { memo } from 'react';

/**
 * Build Home backdrop: an original, stylised voxel illustration of a modern
 * two-level house with a glass living room, timber cladding, a pool and a
 * warm sunset. Pure SVG (no image assets), shown when hovering the Build Home
 * button and behind the new-project dialog.
 */
export const BuildHomePreview = memo(function BuildHomePreview({ visible = true }: { visible?: boolean }) {
  return (
    <div className={`menu-bg build-preview ${visible ? 'show' : ''}`} aria-hidden>
      <svg viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice">
        <defs>
          <linearGradient id="bh-sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#2d3f6e" />
            <stop offset="0.38" stopColor="#8d6d9c" />
            <stop offset="0.66" stopColor="#f09a6c" />
            <stop offset="0.86" stopColor="#ffc98a" />
            <stop offset="1" stopColor="#ffe2b0" />
          </linearGradient>
          <radialGradient id="bh-sun" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0" stopColor="#fff4d6" />
            <stop offset="0.3" stopColor="#ffd28a" stopOpacity="0.95" />
            <stop offset="1" stopColor="#ff9a5a" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="bh-glass" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#ffd49a" />
            <stop offset="1" stopColor="#f3a765" />
          </linearGradient>
          <linearGradient id="bh-glass-cool" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#9fb9d6" />
            <stop offset="1" stopColor="#f0b98a" />
          </linearGradient>
          <linearGradient id="bh-pool" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#5fc2d8" />
            <stop offset="1" stopColor="#2f86b0" />
          </linearGradient>
          <linearGradient id="bh-ground" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#6f9a4c" />
            <stop offset="1" stopColor="#4f7a38" />
          </linearGradient>
        </defs>
        <rect width="1600" height="900" fill="url(#bh-sky)" />
        <circle cx="1210" cy="520" r="260" fill="url(#bh-sun)" />
        <circle cx="1210" cy="520" r="62" fill="#fff0cc" opacity="0.9" />
        {/* distant hills */}
        <path d="M0 610 L0 560 L160 560 L160 544 L352 544 L352 528 L560 528 L560 544 L800 544 L800 560 L1040 560 L1040 540 L1300 540 L1300 556 L1600 556 L1600 610 Z" fill="#7a6a8e" opacity="0.55" />
        <path d="M0 640 L0 590 L240 590 L240 576 L480 576 L480 592 L720 592 L720 580 L1000 580 L1000 596 L1360 596 L1360 584 L1600 584 L1600 640 Z" fill="#5f6f6a" opacity="0.6" />
        {/* lawn */}
        <rect x="0" y="620" width="1600" height="280" fill="url(#bh-ground)" />
        {/* house: ground floor */}
        <g className="bh-house">
          {/* terrace / deck */}
          <rect x="300" y="664" width="920" height="24" fill="#a87a52" />
          <rect x="300" y="664" width="920" height="6" fill="#c89868" />
          {/* ground floor body */}
          <rect x="360" y="508" width="700" height="156" fill="#ece8e0" />
          {/* timber cladding block */}
          <rect x="360" y="508" width="180" height="156" fill="#8a5e3c" />
          {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
            <rect key={i} x={368 + i * 20} y="508" width="4" height="156" fill="#6f4a2e" />
          ))}
          {/* glass living room */}
          <rect x="560" y="524" width="470" height="140" fill="url(#bh-glass)" />
          {[0, 1, 2, 3, 4].map((i) => (
            <rect key={i} x={560 + i * 94} y="524" width="6" height="140" fill="#2a2a2e" />
          ))}
          <rect x="1024" y="524" width="6" height="140" fill="#2a2a2e" />
          <rect x="560" y="522" width="470" height="6" fill="#2a2a2e" />
          {/* interior silhouettes: sofa, lamp, plant */}
          <rect x="620" y="620" width="120" height="30" fill="#b67a55" opacity="0.8" />
          <rect x="620" y="604" width="120" height="18" fill="#c9926c" opacity="0.8" />
          <rect x="800" y="560" width="6" height="90" fill="#3a3030" opacity="0.7" />
          <rect x="788" y="548" width="30" height="16" fill="#fff2c8" />
          <rect x="930" y="600" width="40" height="50" fill="#4f7a45" opacity="0.8" />
          {/* upper floor (cantilevered) */}
          <rect x="470" y="392" width="640" height="116" fill="#f4f2ec" />
          <rect x="470" y="392" width="640" height="10" fill="#dcd8cf" />
          <rect x="500" y="420" width="250" height="72" fill="url(#bh-glass-cool)" />
          <rect x="500" y="420" width="250" height="5" fill="#2a2a2e" />
          <rect x="622" y="420" width="5" height="72" fill="#2a2a2e" />
          <rect x="800" y="420" width="120" height="72" fill="url(#bh-glass)" />
          <rect x="858" y="420" width="5" height="72" fill="#2a2a2e" />
          <rect x="960" y="420" width="120" height="88" fill="#3d4146" />
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <rect key={i} x={966 + i * 20} y="420" width="6" height="88" fill="#4b5056" />
          ))}
          {/* flat roof slab with thin overhang */}
          <rect x="450" y="380" width="690" height="14" fill="#e2ded6" />
          <rect x="450" y="392" width="690" height="3" fill="#b9b4aa" />
          {/* glass balcony railing */}
          <rect x="1060" y="486" width="140" height="22" fill="#e2ded6" />
          <rect x="1070" y="452" width="130" height="34" fill="#bfe0ea" opacity="0.45" />
          <rect x="1070" y="452" width="130" height="3" fill="#2a2a2e" />
          {/* wall lights */}
          <rect x="548" y="560" width="6" height="12" fill="#fff0c0" />
          <circle cx="551" cy="566" r="14" fill="#ffe2a0" opacity="0.25" />
        </g>
        {/* pool */}
        <rect x="700" y="700" width="560" height="70" fill="#d9d4ca" />
        <rect x="712" y="708" width="536" height="54" fill="url(#bh-pool)" />
        <rect x="740" y="716" width="180" height="4" fill="#bff0ff" opacity="0.7" className="bh-ripple" />
        <rect x="980" y="734" width="220" height="4" fill="#bff0ff" opacity="0.6" className="bh-ripple d2" />
        <rect x="1100" y="714" width="40" height="3" fill="#ffd9a0" opacity="0.8" />
        {/* loungers */}
        <rect x="1290" y="724" width="90" height="14" fill="#f1ece2" />
        <rect x="1360" y="708" width="20" height="18" fill="#f1ece2" />
        <rect x="1296" y="738" width="6" height="12" fill="#6b5a4a" />
        <rect x="1370" y="738" width="6" height="12" fill="#6b5a4a" />
        {/* hedges + trees */}
        <rect x="120" y="630" width="200" height="40" rx="6" fill="#3f6d34" />
        <rect x="1250" y="636" width="240" height="36" rx="6" fill="#3f6d34" />
        <g transform="translate(230 640)">
          <rect x="-6" y="-120" width="12" height="122" fill="#6b4a2b" />
          <rect x="-54" y="-200" width="108" height="92" rx="10" fill="#4d7f3c" />
          <rect x="-36" y="-236" width="72" height="44" rx="10" fill="#5a9046" />
        </g>
        <g transform="translate(1500 650)">
          <rect x="-5" y="-170" width="10" height="172" fill="#7a5a3a" />
          <rect x="-70" y="-182" width="70" height="14" fill="#3f7a3a" transform="rotate(-18 0 -176)" />
          <rect x="0" y="-182" width="70" height="14" fill="#4f8a44" transform="rotate(18 0 -176)" />
          <rect x="-60" y="-176" width="60" height="12" fill="#4f8a44" transform="rotate(30 0 -170)" />
          <rect x="0" y="-176" width="60" height="12" fill="#3f7a3a" transform="rotate(-30 0 -170)" />
        </g>
        {/* stepping-stone path */}
        {[0, 1, 2, 3, 4].map((i) => (
          <rect key={i} x={430 + i * 12} y={700 + i * 36} width="70" height="18" fill="#cfc8ba" />
        ))}
        {/* warm vignette */}
        <rect width="1600" height="900" fill="#2a1a10" opacity="0.08" />
      </svg>
    </div>
  );
});
