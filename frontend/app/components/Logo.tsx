"use client";

import { useTheme } from "../lib/theme";

// Brand mark: the "theke" wordmark and its standalone glyph (the abstract
// "th" bracket shape used alone at small sizes). Unlike the old brand, this
// one is a single flat color that must contrast with the surrounding
// surface - so unlike most static brand assets, it switches its fill with
// the in-app theme (navy on light backgrounds, white on dark ones) rather
// than being fixed regardless of theme.
function useLogoFill(): string {
  const { theme } = useTheme();
  return theme === "dark" ? "#fff" : "#1b2a4a";
}

export function LogoMark({ size = 40 }: { size?: number }) {
  const fill = useLogoFill();
  const height = size * (230.4 / 204.03);
  return (
    <svg width={size} height={height} viewBox="0 0 204.03 230.4" aria-hidden="true">
      <rect fill={fill} x="64.73" y="54.63" width="11.47" height="121.15" />
      <rect
        fill={fill}
        x="113.83"
        y="73.34"
        width="11.47"
        height="102.23"
        transform="translate(-22.97 27.15) rotate(-11.83)"
      />
      <rect
        fill={fill}
        x="137.92"
        y="81.57"
        width="11.47"
        height="93.48"
        transform="translate(-43.71 83.67) rotate(-28.37)"
      />
      <path fill={fill} d="M88.48,54.63h19.33c-7.35,29.64-7.94,74.98-8.17,121.15h-11.16V54.63Z" />
      <path fill={fill} d="M52.45,175.77h-19.33c7.35-29.64,7.94-74.98,8.17-121.15h11.16v121.15Z" />
    </svg>
  );
}

export function Logo({ size = 40 }: { size?: number; withWordmark?: boolean }) {
  const fill = useLogoFill();
  const height = size * (230.4 / 434.43);
  return (
    <svg width={size * 1.88} height={height} viewBox="0 0 434.43 230.4" aria-hidden="true">
      <path
        fill={fill}
        d="M92.65,160.03c-3.18,4.95-8.13,9.09-16.03,9.09-14.41,0-16.7-12.05-16.7-22.32v-43.89h-10.79v-3.84h10.79v-12.12c4.43-1.48,10.12-6.06,12.71-10.12v22.24h18.62v3.84h-18.62v50.1c0,8.57,3.25,11.38,7.39,11.38,4.43,0,7.98-3.7,9.61-6.5l3.03,2.14Z"
      />
      <path
        fill={fill}
        d="M166.04,163.35h12.19v3.84h-36.21v-3.84h11.23v-46.33c0-9.98-4.29-14.41-10.86-14.41-13.01,0-19.8,17.14-20.1,26.53v34.21h12.12v3.84h-37.09v-3.84h12.27v-95.77h-12.27v-3.84c9.9,0,17.29-.52,24.98-2.29v54.24c3.25-8.5,10.12-18.47,23.79-18.47,12.86,0,19.95,8.5,19.95,24.38v41.75Z"
      />
      <path
        fill={fill}
        d="M241.12,154.41c-5.39,8.2-15.15,14.7-26.82,14.7-17.44,0-33.77-14.63-33.77-36.06s15.59-35.84,33.47-35.84,26.53,14.93,26.53,30.74c0,.89,0,1.77-.07,2.66h-45.96c-.37,21.65,7.39,33.92,22.39,33.92,9.53,0,16.77-5.32,21.43-12.27l2.81,2.14ZM226.42,126.78c.52-13.08-3.69-25.79-14.56-25.79s-16.26,11.31-17.14,25.79h31.7Z"
      />
      <path
        fill={fill}
        d="M315.39,163.35h9.83v3.84h-33.62v-3.84h9.09l-19.95-30.52-10.27,11.01v19.51h11.16v3.84h-36.13v-3.84h12.27v-95.77h-12.27v-3.84c9.98,0,17.29-.59,24.98-2.29v76.92l21.58-23.2c3.1-3.25,4.43-6.06,4.43-8.13,0-2.59-2-4.14-5.1-4.14h-2.14v-3.84h33.1v3.84h-.81c-6.35,0-15.96,3.55-25.86,14.04l-6.06,6.5,25.79,39.9Z"
      />
      <path
        fill={fill}
        d="M385.31,154.41c-5.39,8.2-15.15,14.7-26.82,14.7-17.44,0-33.77-14.63-33.77-36.06s15.59-35.84,33.47-35.84,26.53,14.93,26.53,30.74c0,.89,0,1.77-.07,2.66h-45.96c-.37,21.65,7.39,33.92,22.39,33.92,9.53,0,16.77-5.32,21.43-12.27l2.81,2.14ZM370.6,126.78c.52-13.08-3.69-25.79-14.56-25.79s-16.26,11.31-17.14,25.79h31.7Z"
      />
      <g>
        <rect fill={fill} x="193.21" y="71.54" width="39.31" height="3.72" />
        <path fill={fill} d="M193.21,67.55v-6.27c9.62,2.38,24.33,2.58,39.31,2.65v3.62h-39.31Z" />
        <path fill={fill} d="M232.52,79.25v6.27c-9.62-2.38-24.33-2.58-39.31-2.65v-3.62h39.31Z" />
      </g>
    </svg>
  );
}
