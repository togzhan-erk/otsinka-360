import React from 'react';

// Text-only wordmark — no icon. Script typeface (Mrs Saint Delafield, loaded
// in public/index.html) in the brand pink accent color.
function Logo({ className, style, title = 'bloomo' }) {
  return (
    <span
      className={className}
      role="img"
      aria-label={title}
      style={{
        fontFamily: "'Mrs Saint Delafield', cursive",
        fontSize: '2.2rem',
        lineHeight: 1,
        color: 'var(--color-accent-pink)',
        ...style,
      }}
    >
      {title}
    </span>
  );
}

// Compact variant of the same wordmark — used wherever a smaller brand mark
// is needed (e.g. the report header) instead of the full-size logo.
export function LogoIcon({ className, style, title = 'bloomo' }) {
  return (
    <span
      className={className}
      role="img"
      aria-label={title}
      style={{
        fontFamily: "'Mrs Saint Delafield', cursive",
        fontSize: '1.5rem',
        lineHeight: 1,
        color: 'var(--color-accent-pink)',
        ...style,
      }}
    >
      {title}
    </span>
  );
}

export default Logo;
