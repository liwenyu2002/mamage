import React from 'react';

export function LiquidGlassDefs() {
  return (
    <svg className="mamage-liquid-glass-defs" aria-hidden="true" focusable="false">
      <defs>
        <filter id="mamage-liquid-glass" x="-35%" y="-35%" width="170%" height="170%" colorInterpolationFilters="sRGB">
          <feTurbulence type="fractalNoise" baseFrequency="0.008 0.014" numOctaves="2" seed="12" result="glassNoise" />
          <feGaussianBlur in="glassNoise" stdDeviation="1.35" result="glassMap" />
          <feDisplacementMap in="SourceGraphic" in2="glassMap" scale="38" xChannelSelector="R" yChannelSelector="G" result="refracted" />
          <feGaussianBlur in="refracted" stdDeviation="0.2" />
        </filter>
      </defs>
    </svg>
  );
}
