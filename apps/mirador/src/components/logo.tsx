/**
 * JOYCO brand mark — the square logo, all shapes `currentColor` so it inherits
 * text color (size + color via className). Vendored from the hub
 * (components/logos/logo.tsx) so mirador uses the real brand asset, not an
 * invented one. The two animated bars react to a `group/logo` hover parent.
 */
export const Logo = (props: React.SVGProps<SVGSVGElement>) => {
  return (
    <svg
      width="40"
      height="40"
      viewBox="0 0 128 128"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      {...props}
    >
      <path
        d="M112.937 86.4519L86.5654 113.033H68.2617V14.8552H112.937V86.4519Z"
        fill="currentColor"
      />
      <rect
        x="15"
        y="14.8552"
        width="46.8145"
        height="67.1709"
        fill="currentColor"
        className="origin-top-left transition-transform duration-300 ease-out [transform-box:fill-box] group-hover/logo:[transform:scaleY(0.3656)]"
      />
      <rect
        x="15"
        y="88.4734"
        width="46.8145"
        height="24.5596"
        fill="currentColor"
        className="origin-bottom-left transition-transform duration-300 ease-out [transform-box:fill-box] group-hover/logo:[transform:scaleY(2.735)]"
      />
      <rect
        x="15"
        y="21.4553"
        width="46.6105"
        height="9.8527"
        fill="currentColor"
      />
      <circle cx="109.132" cy="110.276" r="3.86842" fill="currentColor" />
    </svg>
  );
};
