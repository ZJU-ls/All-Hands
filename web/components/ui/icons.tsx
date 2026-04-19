/**
 * 1-line SVGs — the ONLY allowed icon surface in allhands.
 *
 * Rules (see product/03-visual-design.md §2.6):
 *   - 1.5px stroke, round linecap + linejoin
 *   - currentColor only (no fills, no multi-color)
 *   - One per semantic need; adding new icons requires updating the spec
 *
 * Icon-library usage (lucide, heroicons, phosphor, tabler) is forbidden.
 */

import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Base({ size = 16, children, ...rest }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M3.5 8.5 L6.5 11.5 L12.5 4.5" />
    </Base>
  );
}

export function ArrowRightIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M3 8 H12 M8 4 L12 8 L8 12" />
    </Base>
  );
}

export function ExternalIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M6 4 H4 V12 H12 V10 M9 3 H13 V7 M13 3 L8 8" />
    </Base>
  );
}

export function CopyIcon(props: IconProps) {
  return (
    <Base {...props}>
      <rect x="5" y="5" width="8" height="8" rx="1.5" />
      <path d="M11 5 V3.5 A1 1 0 0 0 10 2.5 H4 A1 1 0 0 0 3 3.5 V10 A1 1 0 0 0 4 11 H5" />
    </Base>
  );
}

export function PlusIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M8 3 V13 M3 8 H13" />
    </Base>
  );
}

export function MinusIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M3 8 H13" />
    </Base>
  );
}

/**
 * SunIcon / MoonIcon — used only by the theme toggle.
 * They are not generic decorations; do not import them elsewhere.
 */
export function SunIcon(props: IconProps) {
  return (
    <Base {...props}>
      <circle cx="8" cy="8" r="3" />
      <path d="M8 1.5 V3 M8 13 V14.5 M1.5 8 H3 M13 8 H14.5 M3.3 3.3 L4.4 4.4 M11.6 11.6 L12.7 12.7 M3.3 12.7 L4.4 11.6 M11.6 4.4 L12.7 3.3" />
    </Base>
  );
}

export function MoonIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M13 9.5 A5.5 5.5 0 1 1 6.5 3 A4.5 4.5 0 0 0 13 9.5 Z" />
    </Base>
  );
}

/**
 * LogoDotgrid — 3x3 grid, primary five corners + center (X pattern).
 * Only used as the app brand mark.
 */
export function LogoDotgrid({ size = 14 }: { size?: number }) {
  const gap = 2;
  const dot = (size - gap * 2) / 3;
  const primary = "var(--color-primary)";
  const cells = Array.from({ length: 9 }, (_, i) => i);
  const on = new Set([0, 2, 4, 6, 8]);
  return (
    <div
      className="grid grid-cols-3"
      style={{ width: size, height: size, gap }}
      aria-hidden="true"
    >
      {cells.map((i) => (
        <div
          key={i}
          style={{
            width: dot,
            height: dot,
            borderRadius: 1,
            background: on.has(i) ? primary : "transparent",
          }}
        />
      ))}
    </div>
  );
}
