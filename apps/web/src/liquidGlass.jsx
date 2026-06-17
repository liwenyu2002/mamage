import React from 'react';

export function LiquidGlassDefs() {
  return (
    <svg className="mamage-liquid-glass-defs" aria-hidden="true" focusable="false">
      <defs>
        <filter id="mamage-liquid-glass" x="-35%" y="-35%" width="170%" height="170%" colorInterpolationFilters="sRGB">
          <feTurbulence type="fractalNoise" baseFrequency="0.008 0.014" numOctaves="2" seed="12" result="glassNoise" />
          <feGaussianBlur in="glassNoise" stdDeviation="1.8" result="glassMap" />
          <feDisplacementMap in="SourceGraphic" in2="glassMap" scale="56" xChannelSelector="R" yChannelSelector="G" result="refracted" />
          <feGaussianBlur in="refracted" stdDeviation="0.32" result="softRefracted" />
          <feSpecularLighting in="glassMap" surfaceScale="7" specularConstant="0.5" specularExponent="32" lightingColor="#ffffff" result="specular">
            <fePointLight x="-120" y="-160" z="220" />
          </feSpecularLighting>
          <feComposite in="specular" in2="softRefracted" operator="in" result="specularClip" />
          <feComposite in="softRefracted" in2="specularClip" operator="arithmetic" k1="0" k2="1" k3="0.28" k4="0" />
        </filter>
      </defs>
    </svg>
  );
}
