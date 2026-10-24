import type { JSX } from 'react';

export function BrandMark({ size = 28 }: { size?: number } = {}): JSX.Element {
  return (
    <svg
      className="brand-mark"
      viewBox="0 0 64 64"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id="tv-brand-gradient" x1="8" y1="4" x2="56" y2="60" gradientUnits="userSpaceOnUse">
          <stop stopColor="#5eead4" />
          <stop offset="1" stopColor="#818cf8" />
        </linearGradient>
      </defs>
      <path
        d="M32 3.5 56 12v18.6c0 13.2-9.5 24.6-24 29.9C17.5 55.2 8 43.8 8 30.6V12L32 3.5Z"
        fill="#0b1220"
        stroke="url(#tv-brand-gradient)"
        strokeWidth="3"
      />
      <path
        d="M22.5 31.6l6.6 6.6L42 24.6"
        fill="none"
        stroke="url(#tv-brand-gradient)"
        strokeWidth="4.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
