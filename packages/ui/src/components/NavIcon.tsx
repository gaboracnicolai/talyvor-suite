import { cn } from '../lib/cn'

// The sidebar's line icons, per brand-v4 BRAND.md §Icons: a 24px grid, 1.6px stroke, round caps and
// joins, drawn in currentColor so a row's icon takes the row's own text colour. `route` and `prove`
// are the brand icons' own paths (svg/icon-route-*.svg, svg/icon-prove-*.svg); the rest are drawn to
// the same grid and stroke.
const ICONS = {
  home: (
    <path d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z" />
  ),
  approvals: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="m8.5 12.2 2.4 2.4 4.6-4.9" />
    </>
  ),
  wallet: (
    <>
      <rect x="3.5" y="5.5" width="17" height="13.5" rx="2" />
      <path d="M20.5 9.5h-4a2.75 2.75 0 0 0 0 5.5h4" />
      <path d="M16.6 12.25h.01" />
    </>
  ),
  statement: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <path d="M3.5 9h17M7 12.5h5M7 15.5h5M15.5 12.5H17M15.5 15.5H17" />
    </>
  ),
  coins: (
    <>
      <ellipse cx="12" cy="6.5" rx="6.5" ry="2.5" />
      <path d="M5.5 6.5v5c0 1.4 2.9 2.5 6.5 2.5s6.5-1.1 6.5-2.5v-5" />
      <path d="M5.5 11.5v5c0 1.4 2.9 2.5 6.5 2.5s6.5-1.1 6.5-2.5v-5" />
    </>
  ),
  chat: (
    <path d="M5 4.5h14a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5h-8.5L6 20v-3.5H5A1.5 1.5 0 0 1 3.5 15V6A1.5 1.5 0 0 1 5 4.5z" />
  ),
  grid: (
    <>
      <rect x="4" y="4" width="6.5" height="6.5" rx="1.5" />
      <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5" />
      <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5" />
      <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5" />
    </>
  ),
  upload: (
    <path d="M12 15.5V4.5M7.5 9 12 4.5 16.5 9M4.5 15v3.5A1.5 1.5 0 0 0 6 20h12a1.5 1.5 0 0 0 1.5-1.5V15" />
  ),
  tag: (
    <>
      <path d="M3.5 12.2V5A1.5 1.5 0 0 1 5 3.5h7.2l8.3 8.3a1.5 1.5 0 0 1 0 2.1l-6.4 6.4a1.5 1.5 0 0 1-2.1 0z" />
      <circle cx="8" cy="8" r="1.3" />
    </>
  ),
  receipt: (
    <path d="M6 3.5h12v17l-2-1.4-2 1.4-2-1.4-2 1.4-2-1.4-2 1.4zM9 8.5h6M9 12h6M9 15.5h3.5" />
  ),
  prove: (
    <path d="M12 3l7 2.8v5.4c0 4.4-2.9 7.9-7 9.8-4.1-1.9-7-5.4-7-9.8V5.8zM8.8 12.2l2.2 2.2 4.3-4.6" />
  ),
  issues: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="2.5" />
      <path d="m8.5 12.2 2.4 2.4 4.6-4.9" />
    </>
  ),
  board: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <path d="M9.2 4.5v15M14.8 4.5v15" />
    </>
  ),
  cycle: (
    <path d="M19.5 12a7.5 7.5 0 0 1-13.1 5M4.5 12a7.5 7.5 0 0 1 13.1-5M17.6 3.5V7h-3.5M6.4 20.5V17h3.5" />
  ),
  folder: (
    <path d="M3.5 7A1.5 1.5 0 0 1 5 5.5h4.3l2 2.2H19a1.5 1.5 0 0 1 1.5 1.5V18a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 18z" />
  ),
  docs: (
    <path d="M6.5 3.5h8l4 4v13h-12zM14.5 3.5v4h4M9.5 12h6M9.5 15.5h6" />
  ),
  page: <path d="M6.5 3.5h8l4 4v13h-12zM14.5 3.5v4h4" />,
  plug: (
    <path d="M9 3.5v4M15 3.5v4M6.5 7.5h11v3a5.5 5.5 0 0 1-11 0zM12 16v4.5" />
  ),
  key: (
    <>
      <circle cx="8" cy="15" r="4" />
      <path d="m10.9 12.1 8.6-8.6M16.5 6.5 19 9M14 9l2 2" />
    </>
  ),
  route: <path d="M3 6h4.5c3 0 4 6 8 6M3 18h4.5c3 0 4-6 8-6M3 12h12.5M15.5 8l4 4-4 4" />,
  sliders: (
    <>
      <path d="M4 8h9M17 8h3M4 16h3M11 16h9" />
      <circle cx="15" cy="8" r="2" />
      <circle cx="9" cy="16" r="2" />
    </>
  ),
  card: (
    <>
      <rect x="3" y="5.5" width="18" height="13" rx="2" />
      <path d="M3 10h18M7 14.5h3" />
    </>
  ),
  layers: <path d="M12 3.5 20.5 8 12 12.5 3.5 8zM3.5 12 12 16.5l8.5-4.5M3.5 16 12 20.5l8.5-4.5" />,
  chart: <path d="M4.5 19.5h15M7.5 16v-5M12 16V6.5M16.5 16V8.5" />,
  ledger: (
    <path d="M5 5a1.5 1.5 0 0 1 1.5-1.5H19v15H6.5A1.5 1.5 0 0 0 5 20zM5 20a1.5 1.5 0 0 0 1.5 1.5H19v-3M9 7.5h6" />
  ),
  price: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M14.5 9.2c-.4-.9-1.3-1.5-2.5-1.5-1.5 0-2.5.8-2.5 2s1 1.7 2.5 2 2.5.9 2.5 2.1-1 2-2.5 2c-1.2 0-2.1-.6-2.5-1.5M12 6v1.7M12 16.3V18" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <circle cx="12" cy="12" r="6" />
      <path d="M12 3.5V6M12 18v2.5M3.5 12H6M18 12h2.5M6 6l1.8 1.8M16.2 16.2 18 18M6 18l1.8-1.8M16.2 7.8 18 6" />
    </>
  ),
  members: (
    <>
      <circle cx="9" cy="8.5" r="3.5" />
      <path d="M3 19.5c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5M15.5 5.2a3.5 3.5 0 0 1 0 6.6M17.5 14.3c2 .7 3.5 2.6 3.5 5.2" />
    </>
  ),
  fold: <path d="m8 4.5 4 4 4-4M8 19.5l4-4 4 4" />,
  unfold: <path d="m8 9 4-4 4 4M8 15l4 4 4-4" />,
  // B29.8 — the Home cards' Developers icon and the arrow each card ends on.
  code: <path d="m8 7.5-4.5 4.5L8 16.5M16 7.5l4.5 4.5-4.5 4.5M13.5 5l-3 14" />,
  arrow: <path d="M4.5 12h15M13.5 6l6 6-6 6" />,
  server: (
    <>
      <rect x="4" y="4" width="16" height="7" rx="1.5" />
      <rect x="4" y="13" width="16" height="7" rx="1.5" />
      <path d="M7.5 7.5h.01M7.5 16.5h.01" />
    </>
  ),
} as const

export type NavIconName = keyof typeof ICONS

export interface NavIconProps {
  name: NavIconName
  className?: string
}

/** A 20px line icon for a sidebar row. Decorative: the row's label names the destination. */
export function NavIcon({ name, className }: NavIconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={20}
      height={20}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      data-icon={name}
      className={cn('shrink-0', className)}
    >
      {ICONS[name]}
    </svg>
  )
}
