import React from 'react';

/**
 * QuoteForge brand mark: a machined hex nut (CNC / "Forge") with a "Q" cut into
 * it — the bore ring is the Q's bowl and the part-off notch is its tail ("Quote").
 * Scales cleanly from a 16px favicon to a large splash. Uses its own gradient, so
 * it reads on any background; pass `mono` to render a flat currentColor version.
 */
export default function Logo({
  size = 32,
  className,
  mono = false,
}: {
  size?: number;
  className?: string;
  mono?: boolean;
}) {
  const fill = mono ? 'currentColor' : 'url(#qfGrad)';
  const ink = mono ? 'var(--card, #fff)' : '#ffffff';
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      className={className}
      role="img"
      aria-label="QuoteForge"
    >
      <defs>
        <linearGradient id="qfGrad" x1="4" y1="2" x2="36" y2="38" gradientUnits="userSpaceOnUse">
          <stop stopColor="#3b82f6" />
          <stop offset="1" stopColor="#4f46e5" />
        </linearGradient>
      </defs>
      {/* Hex nut */}
      <path
        d="M20 2.2 L35.6 11.1 L35.6 28.9 L20 37.8 L4.4 28.9 L4.4 11.1 Z"
        fill={fill}
      />
      {/* Q bowl — the machined bore */}
      <circle cx="20" cy="20" r="8.3" fill="none" stroke={ink} strokeWidth="3.1" />
      {/* Q tail — part-off notch */}
      <rect
        x="22.4"
        y="24.1"
        width="9"
        height="3.3"
        rx="1.65"
        transform="rotate(45 25 26)"
        fill={ink}
      />
    </svg>
  );
}
