import React from 'react';

function Logo({ className, title = 'Growth 360' }) {
  return (
    <svg
      className={className}
      viewBox="0 0 380 150"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={title}
    >
      <path d="M 91.8 40.9 A 38 38 0 1 1 48.2 40.9" fill="none" stroke="#2F4A3E" strokeWidth="7" strokeLinecap="round" />
      <circle cx="91.8" cy="40.9" r="5" fill="#E29147" />
      <g>
        <path d="M70,98 C 70,86 70,80 70,70" stroke="#2F4A3E" strokeWidth="4" strokeLinecap="round" fill="none" />
        <path d="M68,74 C 58,72 51,64 53,54 C 62,56 69,65 68,74 Z" fill="#3F6152" />
        <path d="M72,74 C 82,72 89,64 87,54 C 78,56 71,65 72,74 Z" fill="#E29147" />
      </g>
      <text x="138" y="70" fontFamily="'Fraunces', Georgia, serif" fontSize="38" fontWeight="600" fill="#2F4A3E">Growth</text>
      <text x="139" y="104" fontFamily="'Plus Jakarta Sans', system-ui, sans-serif" fontSize="26" fontWeight="600" letterSpacing="5" fill="#E29147">360°</text>
    </svg>
  );
}

export default Logo;
